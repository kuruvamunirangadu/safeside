from __future__ import annotations

import math
import random
import threading
import time
from typing import Dict, Optional, Tuple

from backend.robot_state import RobotMode, RobotState
from robot_sim import digital_twin


class RobotSimulator:
    """Kinematic simulator with simple scenario controls."""

    ALLOWED_SCENARIOS = {"edge_approach", "crowd_pass", "random_walk", "default"}

    def __init__(self, state: RobotState, update_interval: float = 0.1) -> None:
        self._state = state
        self._update_interval = update_interval
        self._shutdown = threading.Event()
        self._mode_lock = threading.Lock()
        self._control_lock = threading.Lock()
        self._mode: RobotMode = RobotMode.IDLE
        self._paused = False
        self._scenario: Optional[Tuple[str, Dict[str, object]]] = None
        self._angle = 0.0
        self._rng = random.Random()
        self._thread = threading.Thread(target=self._run, name="RobotSimThread", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._shutdown.is_set():
            return
        self._shutdown.set()
        if self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def set_mode(self, mode: RobotMode) -> None:
        with self._mode_lock:
            self._mode = mode

    def reset(self) -> None:
        with self._control_lock:
            self._paused = False
            self._scenario = None
            self._angle = 0.0
        with self._mode_lock:
            self._mode = RobotMode.IDLE
        self._state.reset(source="simulator", reason="Simulation reset")

    def set_scenario(self, name: Optional[str], params: Optional[Dict[str, object]] = None) -> bool:
        normalized = (name or "default").strip() if isinstance(name, str) else "default"
        if normalized == "default":
            scenario_name: Optional[str] = None
        elif normalized in self.ALLOWED_SCENARIOS:
            scenario_name = normalized
        else:
            return False
        with self._control_lock:
            if scenario_name is None:
                self._scenario = None
            else:
                self._scenario = (scenario_name, dict(params or {}))
        return True

    def pause(self) -> None:
        with self._control_lock:
            self._paused = True

    def resume(self) -> None:
        with self._control_lock:
            self._paused = False

    def current_scenario(self) -> Optional[Dict[str, object]]:
        with self._control_lock:
            if self._scenario is None:
                return None
            name, params = self._scenario
            return {"name": name, "params": dict(params)}

    def is_paused(self) -> bool:
        with self._control_lock:
            return self._paused

    def _current_mode(self) -> RobotMode:
        with self._mode_lock:
            return self._mode

    def _current_controls(self) -> Tuple[bool, Optional[Tuple[str, Dict[str, object]]]]:
        with self._control_lock:
            return self._paused, self._scenario

    def _motion_update(
        self,
        mode: RobotMode,
        scenario: Optional[Tuple[str, Dict[str, object]]],
        dt: float,
    ) -> Tuple[float, float, float, float]:
        if mode is RobotMode.CAUTION:
            base_speed = 0.5
        elif mode is RobotMode.WARNING:
            base_speed = 0.7
        else:
            base_speed = 1.0

        scenario_name = scenario[0] if scenario else "default"
        params = scenario[1] if scenario else {}

        if scenario_name == "edge_approach":
            multiplier = float(params.get("speed_multiplier", 1.2))
            vx = base_speed * multiplier
            vy = 0.0
        elif scenario_name == "crowd_pass":
            self._angle += 0.12
            lateral = math.sin(self._angle * 1.4)
            vx = base_speed * 0.6
            vy = lateral * base_speed * 0.6
        elif scenario_name == "random_walk":
            vx = self._rng.uniform(-1.0, 1.0) * base_speed
            vy = self._rng.uniform(-1.0, 1.0) * base_speed
        else:
            self._angle += 0.15
            vx = math.cos(self._angle) * base_speed
            vy = math.sin(self._angle) * base_speed

        dx = vx * dt
        dy = vy * dt
        return vx, vy, dx, dy

    def _run(self) -> None:
        while not self._shutdown.is_set():
            paused, scenario = self._current_controls()
            mode = self._current_mode()
            dt = self._update_interval
            if paused:
                self._state.update_motion({"x": 0.0, "y": 0.0}, {"vx": 0.0, "vy": 0.0})
                self._state.tick()
                digital_twin.write_frame(self._state.snapshot())
                time.sleep(dt)
                continue
            if mode in (RobotMode.RUNNING, RobotMode.CAUTION, RobotMode.WARNING):
                vx, vy, dx, dy = self._motion_update(mode, scenario, dt)
                self._state.update_motion({"x": dx, "y": dy}, {"vx": vx, "vy": vy})
                if mode is RobotMode.CAUTION:
                    drain_rate = 0.0005
                elif mode is RobotMode.WARNING:
                    drain_rate = 0.0008
                else:
                    drain_rate = 0.001
                self._state.drain_battery(drain_rate)
            else:
                self._state.update_motion({"x": 0.0, "y": 0.0}, {"vx": 0.0, "vy": 0.0})
            self._state.tick()
            digital_twin.write_frame(self._state.snapshot())
            time.sleep(dt)
