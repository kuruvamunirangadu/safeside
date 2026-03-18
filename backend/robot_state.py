from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime
from enum import Enum
from typing import Any, Deque, Dict, List, Optional, Protocol


class RobotMode(str, Enum):
    """Supported robot operating modes."""

    IDLE = "IDLE"
    RUNNING = "RUNNING"
    CAUTION = "CAUTION"
    WARNING = "WARNING"
    PAUSED = "PAUSED"
    HALTED = "HALTED"


class InvalidTransitionError(RuntimeError):
    """Raised when a safety mode transition request is not allowed."""


class ModeAdapter(Protocol):
    def apply_mode(self, mode: RobotMode) -> None:
        ...


class RobotState:
    """Thread-safe container for the robot's runtime state and event log."""

    MAX_EVENTS = 200

    def __init__(self, adapter: Optional[ModeAdapter] = None) -> None:
        self._lock = threading.Lock()
        self._mode: RobotMode = RobotMode.IDLE
        self._position = {"x": 0.0, "y": 0.0}
        self._velocity = {"vx": 0.0, "vy": 0.0}
        self._battery_level = 1.0  # 1.0 == 100 %
        self._last_update = time.time()
        self._events: Deque[Dict[str, object]] = deque(maxlen=self.MAX_EVENTS)
        self._human_state: Dict[str, Optional[object]] = {}
        self._risk_state: Dict[str, Optional[object]] = {}
        self._trust_state: Dict[str, Optional[object]] = {}
        self._adapter: Optional[ModeAdapter] = adapter
        self._adapter_state: Dict[str, Optional[object]] = {
            "attached": adapter is not None,
            "adapter_name": self._adapter_label(adapter),
            "last_mode": self._mode.value,
            "last_update": None,
            "last_error": None,
            "members": [],
            "details": None,
        }
        if adapter is not None:
            description = self._adapter_description(adapter)
            self._adapter_state.update(
                details=description,
                members=description.get("members", []),
            )
        self._reset_human_state(initial=True)
        self._reset_risk_state(initial=True)
        self._reset_trust_state(initial=True)
        self._last_tick = time.time()

    def get_mode(self) -> RobotMode:
        with self._lock:
            return self._mode

    def attach_adapter(self, adapter: ModeAdapter) -> None:
        with self._lock:
            self._adapter = adapter
            description = self._adapter_description(adapter)
            self._adapter_state.update(
                attached=True,
                adapter_name=description.get("name"),
                members=description.get("members", []),
                details=description,
                last_error=None,
            )
            current_mode = self._mode
        self._notify_adapter(current_mode)

    def detach_adapter(self) -> None:
        with self._lock:
            self._adapter = None
            self._adapter_state.update(
                attached=False,
                adapter_name=None,
                last_error=None,
                last_update=datetime.utcnow().isoformat() + "Z",
                members=[],
                details=None,
            )

    def resume(self, source: str, reason: Optional[str] = None) -> None:
        self._transition(RobotMode.RUNNING, source, reason or "Resume command")

    def pause(self, source: str, reason: Optional[str] = None) -> None:
        self._transition(RobotMode.PAUSED, source, reason or "Pause command")

    def caution_on(self, source: str, reason: Optional[str] = None) -> None:
        self._transition(RobotMode.CAUTION, source, reason or "Caution engaged")

    def caution_off(self, source: str, reason: Optional[str] = None) -> None:
        self._transition(RobotMode.RUNNING, source, reason or "Caution cleared")

    def emergency_stop(self, source: str, reason: Optional[str] = None) -> None:
        self._transition(RobotMode.HALTED, source, reason or "Emergency stop")

    def reset(self, source: str = "system", reason: Optional[str] = None) -> None:
        with self._lock:
            previous_mode = self._mode
            self._mode = RobotMode.IDLE
            self._position = {"x": 0.0, "y": 0.0}
            self._velocity = {"vx": 0.0, "vy": 0.0}
            self._battery_level = 1.0
            self._last_update = time.time()
            self._log_event(previous_mode, RobotMode.IDLE, source, reason or "System reset")
            self._reset_human_state()
            self._reset_risk_state()
            self._reset_trust_state()
        self._notify_adapter(RobotMode.IDLE)

    def update_motion(self, position_delta: Dict[str, float], velocity: Dict[str, float]) -> None:
        """Apply motion deltas coming from the simulator."""
        with self._lock:
            self._position["x"] += position_delta.get("x", 0.0)
            self._position["y"] += position_delta.get("y", 0.0)
            self._velocity.update(**velocity)
            self._last_update = time.time()

    def drain_battery(self, amount: float) -> None:
        """Decrease the battery level but keep it within 0..1."""
        with self._lock:
            self._battery_level = max(0.0, min(1.0, self._battery_level - amount))
            self._last_update = time.time()

    def tick(self) -> None:
        now = time.time()
        with self._lock:
            dt = now - getattr(self, "_last_tick", now)
            self._last_tick = now
            if dt <= 0:
                return
            current_mode = self._mode
            risk_score = float(self._risk_state.get("score", 0.0) or 0.0)
            safe_seconds = float(self._trust_state.get("safe_seconds", 0.0) or 0.0)
            if current_mode in (RobotMode.RUNNING, RobotMode.CAUTION) and risk_score < 0.3:
                safe_seconds += dt
                self._trust_state["safe_seconds"] = round(safe_seconds, 3)
                if safe_seconds >= 60.0:
                    self._adjust_trust_locked(0.1, "trust_model", "Sustained low-risk operation")
                    self._trust_state["safe_seconds"] = 0.0
            else:
                self._trust_state["safe_seconds"] = 0.0

    def snapshot(self) -> Dict[str, object]:
        """Return a serializable copy of the current state."""
        with self._lock:
            return {
                "mode": self._mode.value,
                "position": dict(self._position),
                "velocity": dict(self._velocity),
                "battery_level": round(self._battery_level * 100.0, 2),
                "last_update": self._last_update,
                "risk_score": float(self._risk_state.get("score", 0.0) or 0.0),
                "human_safety_state": dict(self._human_state),
                "predictive_risk_state": dict(self._risk_state),
                "trust_state": dict(self._trust_state),
                "adapter_status": dict(self._adapter_state),
            }

    def recent_events(self, limit: int = 20) -> List[Dict[str, object]]:
        with self._lock:
            events = list(self._events)[-limit:]
        return list(reversed(events))

    def _transition(self, target: RobotMode, source: str, reason: str) -> None:
        with self._lock:
            current = self._mode
            if current is target:
                # no transition required, but log to keep operator intent
                self._log_event(current, target, source, reason + " (no-op)")
                return
            self._validate_transition(current, target)
            trust_ok = self._validate_trust_transition(current, target, source)
            if not trust_ok:
                trust_level = self._trust_state.get("level", "MEDIUM")
                raise InvalidTransitionError(
                    f"Trust level {trust_level} blocks {source} transition to {target.value}"
                )
            self._mode = target
            self._last_update = time.time()
            self._log_event(current, target, source, reason)
        self._notify_adapter(target)
        self._update_trust_on_transition(current, target, source)

    def _validate_transition(self, current: RobotMode, target: RobotMode) -> None:
        if current is RobotMode.HALTED and target is not RobotMode.IDLE:
            raise InvalidTransitionError("Cannot leave HALTED without reset")
        if current is RobotMode.PAUSED and target is RobotMode.CAUTION:
            raise InvalidTransitionError("Cannot go from PAUSED to CAUTION directly")
        if current is RobotMode.IDLE and target in (RobotMode.PAUSED, RobotMode.CAUTION, RobotMode.WARNING):
            raise InvalidTransitionError(f"Cannot transition from IDLE to {target.value}")

    def _validate_trust_transition(self, current: RobotMode, target: RobotMode, source: str) -> bool:
        level = str(self._trust_state.get("level", "MEDIUM") or "MEDIUM")
        is_human_source = bool(source and "human" in source)

        if target is RobotMode.RUNNING:
            if not is_human_source:
                if level == "LOW" and current in (RobotMode.PAUSED, RobotMode.CAUTION, RobotMode.WARNING):
                    return False
                if source == "predictive_risk" and current is RobotMode.WARNING and level == "LOW":
                    return False
                if source == "predictive_risk" and current is RobotMode.CAUTION and level != "HIGH":
                    return False

        return True

    def record_feeling(self, feeling: Optional[str], reason: Optional[str]) -> bool:
        feel_norm = (feeling or "").strip().upper() or None
        stress_score = self._feeling_to_stress(feel_norm)
        timestamp = datetime.utcnow().isoformat() + "Z"
        reason_text = reason or (f"Feeling reported: {feel_norm}" if feel_norm else "Feeling update")
        escalated = False

        with self._lock:
            previous_mode = self._mode
            self._human_state.update(
                last_feeling=feel_norm,
                stress_score=stress_score,
                last_reason=reason,
                updated_at=timestamp,
            )

            self._log_event(previous_mode, previous_mode, "human_feeling", reason_text)

            if feel_norm == "DANGEROUS" and previous_mode is RobotMode.RUNNING:
                self._mode = RobotMode.CAUTION
                self._last_update = time.time()
                self._log_event(
                    previous_mode,
                    RobotMode.CAUTION,
                    "human_feeling",
                    reason or "Human reported danger",
                )
                escalated = True
        if escalated:
            self._notify_adapter(RobotMode.CAUTION)
            self._update_trust_on_transition(previous_mode, RobotMode.CAUTION, "human_feeling")

        return escalated

    def apply_predictive_risk(self, score: float, details: Optional[Dict[str, object]] = None) -> None:
        details = details or {}
        normalized_score = max(0.0, min(1.0, float(score)))
        level = self._risk_level(normalized_score)
        timestamp = datetime.utcnow().isoformat() + "Z"
        summary_reason: Optional[str] = None
        trust_level: str = "MEDIUM"

        with self._lock:
            previous_score = float(self._risk_state.get("score", 0.0) or 0.0)
            previous_level = str(self._risk_state.get("level", "LOW") or "LOW")
            current_mode = self._mode
            trust_level = str(self._trust_state.get("level", "MEDIUM") or "MEDIUM")

            self._risk_state.update(
                score=round(normalized_score, 3),
                level=level,
                reason=details.get("reason"),
                distance_to_hazard=details.get("distance_to_hazard"),
                updated_at=timestamp,
            )

            summary_reason = details.get("log_reason") or details.get("reason")
            if not summary_reason:
                summary_reason = f"Risk level {level} (score {normalized_score:.2f})"

            if previous_level != level or abs(previous_score - normalized_score) >= 0.1:
                self._log_event(current_mode, current_mode, "predictive_risk", summary_reason)

            now_monotonic = time.time()
            stable_run_start = self._trust_state.get("stable_run_start")
            if level == "LOW" and current_mode is RobotMode.RUNNING:
                if not stable_run_start:
                    self._trust_state["stable_run_start"] = now_monotonic
                else:
                    try:
                        elapsed = now_monotonic - float(stable_run_start)
                    except (TypeError, ValueError):
                        elapsed = 0.0
                    if elapsed >= 6.0:
                        self._adjust_trust_locked(0.04, "predictive_risk", "Stable autonomous operation")
                        self._trust_state["stable_run_start"] = now_monotonic
            else:
                self._trust_state["stable_run_start"] = None

            trust_level = str(self._trust_state.get("level", "MEDIUM") or "MEDIUM")

        target_mode: Optional[RobotMode] = None
        transition_reason = details.get("transition_reason") or details.get("reason") or summary_reason
        if not transition_reason:
            transition_reason = f"Predictive risk {level}"

        if level in {"HIGH", "CRITICAL"}:
            with self._lock:
                current_mode = self._mode
            if level == "CRITICAL" and current_mode in (RobotMode.RUNNING, RobotMode.WARNING):
                target_mode = RobotMode.CAUTION
            elif level == "HIGH" and current_mode is RobotMode.RUNNING:
                if trust_level != "LOW":
                    target_mode = RobotMode.WARNING
        elif level == "LOW":
            with self._lock:
                current_mode = self._mode
                trust_level = str(self._trust_state.get("level", "MEDIUM") or "MEDIUM")
            if current_mode is RobotMode.WARNING:
                target_mode = RobotMode.RUNNING
                transition_reason = "Risk level returned to LOW"
            elif current_mode is RobotMode.CAUTION and trust_level == "HIGH":
                target_mode = RobotMode.RUNNING
                transition_reason = "High trust auto-resume after low risk"

        if target_mode is not None:
            try:
                self._transition(target_mode, "predictive_risk", transition_reason)
            except InvalidTransitionError as exc:
                # Manual overrides or trust gating take precedence over predictive automation.
                with self._lock:
                    current_mode = self._mode
                self._log_event(current_mode, current_mode, "trust_model", str(exc))

    def _log_event(self, previous: RobotMode, new: RobotMode, source: str, reason: str) -> None:
        event = {
            "time": datetime.utcnow().isoformat() + "Z",
            "from": previous.value,
            "to": new.value,
            "source": source,
            "reason": reason,
        }
        self._events.append(event)

    def _notify_adapter(self, mode: RobotMode) -> None:
        adapter = self._adapter
        if adapter is None:
            timestamp = datetime.utcnow().isoformat() + "Z"
            with self._lock:
                self._adapter_state.update(
                    attached=False,
                    adapter_name=None,
                    last_mode=mode.value,
                    last_update=timestamp,
                    members=[],
                    details=None,
                )
            return
        try:
            adapter.apply_mode(mode)
        except Exception as exc:  # pragma: no cover - defensive logging
            timestamp = datetime.utcnow().isoformat() + "Z"
            description = self._adapter_description(adapter)
            with self._lock:
                self._adapter_state.update(
                    attached=True,
                    adapter_name=self._adapter_label(adapter),
                    last_mode=mode.value,
                    last_update=timestamp,
                    last_error=str(exc),
                    members=description.get("members", []),
                    details=description,
                )
                self._log_event(mode, mode, "adapter_error", f"Adapter failure: {exc}")
            return
        timestamp = datetime.utcnow().isoformat() + "Z"
        description = self._adapter_description(adapter)
        with self._lock:
            self._adapter_state.update(
                attached=True,
                adapter_name=description.get("name"),
                last_mode=mode.value,
                last_update=timestamp,
                last_error=None,
                members=description.get("members", []),
                details=description,
            )

    def _reset_human_state(self, initial: bool = False) -> None:
        timestamp = None if initial else datetime.utcnow().isoformat() + "Z"
        state = {
            "last_feeling": None,
            "stress_score": 0.0,
            "last_reason": None,
            "updated_at": timestamp,
        }
        if initial:
            self._human_state = state
        else:
            self._human_state.update(state)

    def _reset_risk_state(self, initial: bool = False) -> None:
        timestamp = None if initial else datetime.utcnow().isoformat() + "Z"
        state = {
            "score": 0.0,
            "level": "LOW",
            "reason": None,
            "distance_to_hazard": None,
            "updated_at": timestamp,
        }
        if initial:
            self._risk_state = state
        else:
            self._risk_state.update(state)

    def _reset_trust_state(self, initial: bool = False) -> None:
        timestamp = None if initial else datetime.utcnow().isoformat() + "Z"
        state = {
            "level": "MEDIUM",
            "score": 0.5,
            "last_adjustment": timestamp,
            "last_reason": None,
            "last_source": None,
            "human_interventions": 0,
            "ai_interventions": 0,
            "stable_run_start": None,
            "last_transition": None,
            "last_transition_from": None,
            "last_transition_to": None,
            "last_transition_source": None,
            "safe_seconds": 0.0,
            "emergency_count": 0,
        }
        if initial:
            self._trust_state = state
        else:
            self._trust_state.update(state)

    def _update_trust_on_transition(self, previous: RobotMode, new: RobotMode, source: str) -> None:
        timestamp = datetime.utcnow().isoformat() + "Z"
        with self._lock:
            self._trust_state["last_transition"] = timestamp
            self._trust_state["last_transition_from"] = previous.value
            self._trust_state["last_transition_to"] = new.value
            self._trust_state["last_transition_source"] = source

            if new is not RobotMode.RUNNING:
                self._trust_state["stable_run_start"] = None

            is_human = bool(source and "human" in source)
            if is_human and new is RobotMode.HALTED:
                self._trust_state["emergency_count"] = int(self._trust_state.get("emergency_count", 0)) + 1
                self._trust_state["human_interventions"] = int(self._trust_state.get("human_interventions", 0)) + 1
                self._adjust_trust_locked(-0.3, source, "Human emergency halt")
                self._trust_state["safe_seconds"] = 0.0
            elif is_human and new is RobotMode.CAUTION:
                self._trust_state["human_interventions"] = int(self._trust_state.get("human_interventions", 0)) + 1
                self._adjust_trust_locked(-0.15, source, "Human caution intervention")
            elif is_human and new is RobotMode.PAUSED:
                self._trust_state["human_interventions"] = int(self._trust_state.get("human_interventions", 0)) + 1
                self._adjust_trust_locked(-0.05, source, "Human pause intervention")
            elif new is RobotMode.HALTED:
                self._trust_state["emergency_count"] = int(self._trust_state.get("emergency_count", 0)) + 1
                self._adjust_trust_locked(-0.1, source or "system", "Emergency halt")
                self._trust_state["safe_seconds"] = 0.0
            elif source == "predictive_risk" and new in (RobotMode.WARNING, RobotMode.CAUTION):
                self._trust_state["ai_interventions"] = int(self._trust_state.get("ai_interventions", 0)) + 1
                self._adjust_trust_locked(-0.05, source, f"Predictive risk set {new.value}")
            elif source == "predictive_risk" and new is RobotMode.RUNNING and previous in (RobotMode.WARNING, RobotMode.CAUTION):
                self._adjust_trust_locked(0.05, source, "Predictive auto-resume")
            elif is_human and new is RobotMode.RUNNING and previous in (RobotMode.PAUSED, RobotMode.CAUTION):
                self._adjust_trust_locked(0.03, source, "Human confirmed safe resume")

    def _adjust_trust_locked(self, delta: float, source: str, reason: str) -> None:
        current_score = float(self._trust_state.get("score", 0.5) or 0.5)
        new_score = max(0.0, min(1.0, current_score + delta))
        old_level = str(self._trust_state.get("level", "MEDIUM") or "MEDIUM")
        new_level = self._trust_level_for_score(new_score)
        timestamp = datetime.utcnow().isoformat() + "Z"

        self._trust_state["score"] = round(new_score, 3)
        self._trust_state["level"] = new_level
        self._trust_state["last_adjustment"] = timestamp
        self._trust_state["last_reason"] = reason
        self._trust_state["last_source"] = source

        if old_level != new_level:
            self._log_event(self._mode, self._mode, "trust_model", f"Trust level {old_level} → {new_level} (score {new_score:.2f})")

    @staticmethod
    def _trust_level_for_score(score: float) -> str:
        if score >= 0.75:
            return "HIGH"
        if score <= 0.35:
            return "LOW"
        return "MEDIUM"

    @staticmethod
    def _feeling_to_stress(feeling: Optional[str]) -> float:
        mapping = {
            "SAFE": 0.0,
            "UNSURE": 0.5,
            "DANGEROUS": 1.0,
        }
        return mapping.get(feeling or "", 0.0)

    @staticmethod
    def _risk_level(score: float) -> str:
        if score >= 0.9:
            return "CRITICAL"
        if score >= 0.7:
            return "HIGH"
        if score >= 0.4:
            return "ELEVATED"
        return "LOW"

    @staticmethod
    def _adapter_label(adapter: Optional[ModeAdapter]) -> Optional[str]:
        if adapter is None:
            return None
        name = getattr(adapter, "name", None)
        if name:
            return str(name)
        return adapter.__class__.__name__

    def _adapter_description(self, adapter: Optional[ModeAdapter]) -> Dict[str, Any]:
        if adapter is None:
            return {}
        description: Dict[str, Any] = {"name": self._adapter_label(adapter)}
        describe = getattr(adapter, "describe", None)
        if callable(describe):
            try:
                info = describe() or {}
            except Exception as exc:  # pragma: no cover - defensive logging
                description["describe_error"] = str(exc)
            else:
                if isinstance(info, dict):
                    description.update(info)
        members = description.get("members")
        if isinstance(members, list):
            normalized: List[Dict[str, Any]] = []
            for member in members:
                if isinstance(member, dict):
                    normalized.append(member)
                else:
                    normalized.append({"name": str(member)})
            description["members"] = normalized
        else:
            description["members"] = []
        return description
