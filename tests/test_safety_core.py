import time

from backend.predictive_risk import PredictiveRiskModule
from backend.robot_state import RobotMode, RobotState


class FailingAdapter:
    def apply_mode(self, mode: RobotMode) -> None:
        raise RuntimeError("simulated adapter failure")


def wait_until(predicate, timeout: float = 1.0, interval: float = 0.02) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def test_trust_gating_blocks_predictive_auto_resume_when_low() -> None:
    state = RobotState()
    state.resume("human-ui", "start mission")
    state.apply_predictive_risk(0.8, {"reason": "high risk"})

    assert state.get_mode() is RobotMode.WARNING

    with state._lock:
        state._trust_state["level"] = "LOW"
        state._trust_state["score"] = 0.2

    state.apply_predictive_risk(0.1, {"reason": "risk back to low"})

    assert state.get_mode() is RobotMode.WARNING
    events = state.recent_events(10)
    assert any(evt["source"] == "trust_model" for evt in events)


def test_predictive_override_applies_and_expires() -> None:
    state = RobotState()
    module = PredictiveRiskModule(state, update_interval=0.05)

    try:
        module.inject_override(0.92, duration=0.25, reason="test override", testcase=True)
        applied = wait_until(
            lambda: state.snapshot()["predictive_risk_state"].get("score", 0.0) >= 0.9,
            timeout=1.0,
        )
        assert applied

        assert module.override_status() is not None
        time.sleep(0.3)
        assert module.override_status() is None
    finally:
        module.stop()


def test_adapter_failure_is_captured_in_status_and_events() -> None:
    state = RobotState(adapter=FailingAdapter())
    state.resume("human-ui", "start despite adapter issue")

    snapshot = state.snapshot()
    adapter_status = snapshot["adapter_status"]
    assert adapter_status["attached"] is True
    assert "simulated adapter failure" in (adapter_status["last_error"] or "")

    events = state.recent_events(10)
    assert any(evt["source"] == "adapter_error" for evt in events)


def test_snapshot_has_single_trust_source() -> None:
    state = RobotState()
    snapshot = state.snapshot()

    assert "trust_state" in snapshot
    assert "trust_manager" not in snapshot
