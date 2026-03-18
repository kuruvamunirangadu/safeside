from __future__ import annotations

import logging
import threading
from typing import Dict, List, Tuple

from backend.robot_state import ModeAdapter, RobotMode
from robot_sim.simulator import RobotSimulator

logger = logging.getLogger(__name__)


class AdapterChainError(RuntimeError):
    """Raised when one or more adapters fail to apply a mode."""

    def __init__(self, failures: List[Tuple[str, Exception]]) -> None:
        self.failures = failures
        message = "; ".join(f"{name}: {exc}" for name, exc in failures) or "Adapter chain failure"
        super().__init__(message)


class AdapterChain:
    """Broadcasts mode changes to multiple adapters."""

    def __init__(self, *adapters: ModeAdapter) -> None:
        self._adapters: List[ModeAdapter] = list(adapters)
        self._lock = threading.Lock()
        self.name = "AdapterChain"

    def register(self, adapter: ModeAdapter) -> None:
        with self._lock:
            self._adapters.append(adapter)

    def unregister(self, adapter: ModeAdapter) -> None:
        with self._lock:
            self._adapters = [item for item in self._adapters if item is not adapter]

    def describe(self) -> Dict[str, object]:
        members = []
        for adapter in self._snapshot():
            member: Dict[str, object] = {
                "name": getattr(adapter, "name", adapter.__class__.__name__),
            }
            describe = getattr(adapter, "describe", None)
            if callable(describe):
                try:
                    info = describe() or {}
                except Exception as exc:  # pragma: no cover - defensive logging
                    member["describe_error"] = str(exc)
                else:
                    if isinstance(info, dict):
                        member.update(info)
            members.append(member)
        return {"name": self.name, "members": members}

    def _snapshot(self) -> List[ModeAdapter]:
        with self._lock:
            return list(self._adapters)

    def apply_mode(self, mode: RobotMode) -> None:
        failures: List[Tuple[str, Exception]] = []
        for adapter in self._snapshot():
            try:
                adapter.apply_mode(mode)
            except Exception as exc:  # pragma: no cover - defensive logging
                name = getattr(adapter, "name", adapter.__class__.__name__)
                logger.warning("Adapter '%s' failed to apply mode %s: %s", name, mode.value, exc)
                failures.append((name, exc))
        if failures:
            raise AdapterChainError(failures)

    def shutdown(self) -> None:
        for adapter in self._snapshot():
            shutdown = getattr(adapter, "shutdown", None)
            if callable(shutdown):
                try:
                    shutdown()
                except Exception as exc:  # pragma: no cover - defensive logging
                    name = getattr(adapter, "name", adapter.__class__.__name__)
                    logger.warning("Adapter '%s' shutdown error: %s", name, exc)


class RobotAdapterSim:
    """Translates safety core mode changes into simulator commands."""

    def __init__(self, simulator: RobotSimulator) -> None:
        self._simulator = simulator
        self.name = "Simulator"
        self._last_mode: RobotMode = RobotMode.IDLE

    def apply_mode(self, mode: RobotMode) -> None:
        logger.info("Adapter applying mode: %s", mode.value)
        self._simulator.set_mode(mode)
        self._last_mode = mode

    def shutdown(self) -> None:
        try:
            self._simulator.set_mode(RobotMode.IDLE)
        except Exception as exc:  # pragma: no cover - defensive stop
            logger.warning("Failed to set simulator to IDLE during shutdown: %s", exc)
        self._simulator.stop()

    def describe(self) -> Dict[str, object]:
        return {"name": self.name, "last_mode": self._last_mode.value}