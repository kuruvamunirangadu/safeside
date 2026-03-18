from __future__ import annotations

import math
import threading
import time
from typing import Dict, Optional

from backend.robot_state import RobotMode, RobotState


class PredictiveRiskModule:
    """Background worker that estimates near-future risk for the robot."""

    def __init__(
        self,
        state: RobotState,
        update_interval: float = 0.2,
        boundary_radius: float = 0.8,
        projection_horizon: float = 1.0,
        max_speed: float = 1.5,
    ) -> None:
        self._state = state
        self._update_interval = update_interval
        self._boundary_radius = boundary_radius
        self._warning_band = 0.35  # meters before boundary where risk starts to increase
        self._projection_horizon = projection_horizon
        self._max_speed = max_speed
        self._shutdown = threading.Event()
        self._override_lock = threading.Lock()
        self._override: Optional[Dict[str, object]] = None
        self._thread = threading.Thread(target=self._run, name="PredictiveRiskThread", daemon=True)
        self._previous_speed = 0.0
        self._thread.start()

    def stop(self) -> None:
        if self._shutdown.is_set():
            return
        self._shutdown.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def _run(self) -> None:
        while not self._shutdown.is_set():
            try:
                override = self._current_override()
                if override is not None:
                    self._state.apply_predictive_risk(override["score"], override["details"])
                else:
                    snapshot = self._state.snapshot()
                    risk_score, details = self._compute_risk(snapshot)
                    self._state.apply_predictive_risk(risk_score, details)
            except Exception as exc:  # pragma: no cover - defensive logging hook
                # If logging is configured, this will surface in the Flask logs.
                print(f"[PredictiveRiskModule] error: {exc}")
            time.sleep(self._update_interval)

    def _compute_risk(self, snapshot: Dict[str, object]) -> tuple[float, Dict[str, object]]:
        mode = snapshot.get("mode", "IDLE")
        position = snapshot.get("position", {"x": 0.0, "y": 0.0})
        velocity = snapshot.get("velocity", {"vx": 0.0, "vy": 0.0})
        px = float(position.get("x", 0.0))
        py = float(position.get("y", 0.0))
        vx = float(velocity.get("vx", 0.0))
        vy = float(velocity.get("vy", 0.0))

        speed = math.hypot(vx, vy)
        radial_distance = math.hypot(px, py)
        distance_to_edge = self._boundary_radius - radial_distance
        projected_px = px + vx * self._projection_horizon
        projected_py = py + vy * self._projection_horizon
        projected_radial = math.hypot(projected_px, projected_py)
        projected_margin = self._boundary_radius - projected_radial

        # Baseline risk factors.
        distance_factor = 0.0
        if distance_to_edge <= 0:
            distance_factor = 1.0
        elif distance_to_edge <= self._warning_band:
            distance_factor = max(0.0, 1.0 - (distance_to_edge / self._warning_band))

        projection_factor = 0.0
        if projected_margin < 0:
            projection_factor = min(1.0, abs(projected_margin) / max(0.05, self._warning_band / 2))

        speed_factor = min(1.0, speed / self._max_speed)
        acceleration = abs(speed - self._previous_speed) / max(self._update_interval, 1e-6)
        accel_factor = min(1.0, acceleration / 3.0)  # assume 3 m/s^2 max acceleration of concern
        self._previous_speed = speed

        # Combine weighted factors; projection dominates when predicting hazard breach.
        raw_score = (
            distance_factor * 0.55
            + speed_factor * 0.25
            + projection_factor * 0.85
            + accel_factor * 0.15
        )
        risk_score = max(0.0, min(1.0, raw_score))

        reason: Optional[str] = None
        if distance_to_edge <= 0:
            reason = "Robot beyond safe boundary"
        elif projection_factor >= 0.7:
            reason = "Projected trajectory crosses hazard boundary"
        elif distance_factor >= 0.6:
            reason = f"Close to hazard edge ({distance_to_edge:.2f} m margin)"
        elif speed_factor >= 0.8:
            reason = "High speed near hazard"
        elif accel_factor >= 0.7:
            reason = "Abrupt acceleration"
        else:
            reason = "Risk nominal"

        # If the robot is halted or paused, clamp risk down but keep reason informative.
        if mode in {RobotMode.HALTED.value, RobotMode.PAUSED.value}:
            risk_score = 0.0
            reason = "Robot stationary"

        details: Dict[str, object] = {
            "reason": reason,
            "distance_to_hazard": round(distance_to_edge, 3),
            "log_reason": reason,
        }
        if risk_score >= 0.9:
            details["transition_reason"] = reason or "Predictive risk critical"
        elif risk_score >= 0.7:
            details["transition_reason"] = reason or "Predictive risk high"

        return risk_score, details

    def inject_override(
        self,
        score: float,
        duration: float,
        reason: str,
        **details: object,
    ) -> Dict[str, object]:
        """Temporarily override predictive risk output for experimentation."""

        normalized_score = max(0.0, min(1.0, float(score)))
        duration = max(0.1, float(duration))
        expires_at = time.monotonic() + duration
        override_details: Dict[str, object] = dict(details)
        override_details.setdefault("reason", reason)
        override_details.setdefault("log_reason", reason)
        override_details.setdefault("transition_reason", reason)
        override_details.setdefault("override", True)
        override_details.setdefault("source", "experiment_override")
        override = {
            "score": normalized_score,
            "details": override_details,
            "expires_at": expires_at,
        }
        with self._override_lock:
            self._override = override
        return dict(override)

    def clear_override(self) -> None:
        with self._override_lock:
            self._override = None

    def override_status(self) -> Optional[Dict[str, object]]:
        override = self._current_override()
        if override is None:
            return None
        remaining = max(0.0, override["expires_at"] - time.monotonic())
        status = dict(override)
        status["remaining"] = remaining
        return status

    def _current_override(self) -> Optional[Dict[str, object]]:
        now = time.monotonic()
        with self._override_lock:
            override = self._override
            if not override:
                return None
            if float(override.get("expires_at", 0.0)) <= now:
                self._override = None
                return None
            return dict(override)