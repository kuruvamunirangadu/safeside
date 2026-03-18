from __future__ import annotations

import json
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Callable, Deque, Dict, List, Optional, TextIO

from backend.robot_state import RobotMode


LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
_file_lock = threading.Lock()
_current_file: Optional[TextIO] = None
_current_path: Optional[Path] = None


def _sanitize_name(name: Optional[str]) -> str:
    raw = (name or "session").strip()
    filtered = "".join(ch for ch in raw if ch.isalnum() or ch in {"-", "_"})
    return filtered or "session"


def start_record(session_name: Optional[str] = None) -> str:
    global _current_file, _current_path
    timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    safe_name = _sanitize_name(session_name)
    target = LOG_DIR / f"{safe_name}_{timestamp}.jsonl"
    with _file_lock:
        if _current_file:
            try:
                _current_file.close()
            except Exception:
                pass
        _current_path = target
        _current_file = target.open("a", encoding="utf-8")
    return target.name


def stop_record() -> None:
    global _current_file, _current_path
    with _file_lock:
        if _current_file:
            try:
                _current_file.close()
            except Exception:
                pass
        _current_file = None
        _current_path = None


def write_frame(state_dict: Dict[str, object]) -> None:
    global _current_file, _current_path
    if not isinstance(state_dict, dict):
        return
    line = json.dumps({
        "ts": time.time(),
        "state": state_dict,
    }, separators=(",", ":")) + "\n"
    with _file_lock:
        file = _current_file
    if file is None:
        start_record()
    with _file_lock:
        if _current_file is None:
            return
        try:
            _current_file.write(line)
            _current_file.flush()
        except Exception:
            # Stop recording on write failure to avoid repeated errors.
            try:
                _current_file.close()
            except Exception:
                pass
            _current_file = None
            _current_path = None


def list_sessions() -> List[str]:
    try:
        entries = [p.name for p in LOG_DIR.glob("*.jsonl") if p.is_file()]
    except FileNotFoundError:
        return []
    return sorted(entries, reverse=True)


def current_session_path() -> Optional[Path]:
    with _file_lock:
        return _current_path

class DigitalTwinRecorder:
    """Persists adapter events to a JSONL feed for digital twin consumers."""

    def __init__(
        self,
        output_path: Path,
        *,
        max_bytes: int = 5_000_000,
        history: int = 200,
    ) -> None:
        self._path = Path(output_path)
        self._max_bytes = max_bytes
        self._recent: Deque[Dict[str, object]] = deque(maxlen=history)
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path:
        return self._path

    def record(self, entry: Dict[str, object]) -> None:
        line = json.dumps(entry, separators=(",", ":")) + "\n"
        with self._lock:
            self._rotate(len(line))
            with self._path.open("a", encoding="utf-8") as stream:
                stream.write(line)
            self._recent.append(entry)

    def recent(self, limit: int = 10) -> List[Dict[str, object]]:
        limit = max(1, min(limit, self._recent.maxlen or limit))
        with self._lock:
            return list(self._recent)[-limit:]

    def history_size(self) -> int:
        with self._lock:
            return len(self._recent)

    def _rotate(self, next_size: int) -> None:
        if not self._path.exists():
            return
        try:
            current_size = self._path.stat().st_size
        except OSError:
            return
        if current_size + next_size <= self._max_bytes:
            return
        backup = self._path.with_suffix(self._path.suffix + ".prev")
        try:
            if backup.exists():
                backup.unlink()
            self._path.rename(backup)
        except OSError:
            # If rotation fails, fall back to truncating the file to keep fresh data.
            try:
                with self._path.open("w", encoding="utf-8"):
                    pass
            except OSError:
                return


class RobotAdapterTwin:
    """Feeds the digital twin recorder with the current safety snapshot."""

    def __init__(
        self,
        snapshot_provider: Callable[[], Dict[str, object]],
        recorder: DigitalTwinRecorder,
        *,
        include_full_state: bool = False,
    ) -> None:
        self._snapshot_provider = snapshot_provider
        self._recorder = recorder
        self._include_full_state = include_full_state
        self._last_event: Optional[Dict[str, object]] = None
        self.name = "DigitalTwin"

    def apply_mode(self, mode: RobotMode) -> None:
        snapshot = self._snapshot_provider()
        event: Dict[str, object] = {
            "time": datetime.utcnow().isoformat() + "Z",
            "mode": mode.value,
            "position": dict(snapshot.get("position", {})),
            "velocity": dict(snapshot.get("velocity", {})),
            "battery_level": snapshot.get("battery_level"),
            "risk_level": snapshot.get("predictive_risk_state", {}).get("level"),
            "risk_score": snapshot.get("predictive_risk_state", {}).get("score"),
            "trust_level": snapshot.get("trust_state", {}).get("level"),
        }
        if self._include_full_state:
            event["state"] = snapshot
        self._recorder.record(event)
        self._last_event = event

    def recent_events(self, limit: int = 10) -> List[Dict[str, object]]:
        return self._recorder.recent(limit)

    def describe(self) -> Dict[str, object]:
        return {
            "name": self.name,
            "last_event": self._last_event,
            "history_count": self._recorder.history_size(),
            "path": str(self._recorder.path),
        }

    def shutdown(self) -> None:
        # No special resources to release; method provided for API symmetry.
        return