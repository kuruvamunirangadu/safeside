from __future__ import annotations

import atexit
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.predictive_risk import PredictiveRiskModule
from backend.robot_state import InvalidTransitionError, RobotMode, RobotState
from robot_sim.adapter import AdapterChain, RobotAdapterSim
from robot_sim import digital_twin
from robot_sim.digital_twin import DigitalTwinRecorder, RobotAdapterTwin
from robot_sim.simulator import RobotSimulator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    state = RobotState()
    simulator = RobotSimulator(state)
    adapter_chain = AdapterChain()
    simulator_adapter = RobotAdapterSim(simulator)
    adapter_chain.register(simulator_adapter)

    project_root = Path(__file__).resolve().parent.parent
    frontend_path = project_root / "frontend"
    twin_log_path = project_root / "docs" / "digital_twin_feed.jsonl"
    twin_recorder = DigitalTwinRecorder(twin_log_path)
    twin_adapter = RobotAdapterTwin(state.snapshot, twin_recorder)
    adapter_chain.register(twin_adapter)

    state.attach_adapter(adapter_chain)
    risk_module = PredictiveRiskModule(state)
    atexit.register(adapter_chain.shutdown)
    atexit.register(risk_module.stop)
    atexit.register(digital_twin.stop_record)

    def sim_status() -> Dict[str, Any]:
        return {
            "paused": simulator.is_paused(),
            "scenario": simulator.current_scenario(),
        }

    def apply_action(action: str, source: str, reason: Optional[str]) -> Dict[str, Any]:
        normalized = action.lower()
        reason_text = reason or ""

        try:
            if normalized in ("start", "resume", "run"):
                state.resume(source, reason_text or "Resume command")
                message = "Robot running"
            elif normalized == "pause":
                state.pause(source, reason_text or "Pause command")
                message = "Robot paused"
            elif normalized in ("emergency_stop", "emergency"):
                state.emergency_stop(source, reason_text or "Emergency halt")
                message = "Emergency halt engaged"
            elif normalized in ("caution", "caution_on"):
                state.caution_on(source, reason_text or "Caution engaged")
                message = "Caution mode engaged"
            elif normalized in ("caution_off", "run_clear"):
                state.caution_off(source, reason_text or "Caution cleared")
                message = "Returned to running"
            elif normalized == "reset":
                state.reset(source=source, reason=reason_text or "System reset")
                message = "System reset"
            else:
                message = f"Unknown action '{action}'"
                logger.warning(message)
                return {"ok": False, "message": message}
        except InvalidTransitionError as exc:
            logger.info("Rejected action '%s': %s", action, exc)
            return {"ok": False, "message": str(exc)}

        logger.info("Action '%s' applied -> %s", action, message)
        return {"ok": True, "message": message}

    @app.route("/api/status", methods=["GET"])
    def get_status() -> Any:
        return jsonify(state.snapshot())

    @app.route("/api/sim/reset", methods=["POST"])
    def sim_reset() -> Any:
        simulator.reset()
        return jsonify({"ok": True, "message": "Simulator reset", **sim_status()})

    @app.route("/api/sim/set_scenario", methods=["POST"])
    def sim_set_scenario() -> Any:
        payload = request.get_json(silent=True) or {}
        scenario = payload.get("scenario")
        params = payload.get("params") or {}
        if params and not isinstance(params, dict):
            return jsonify({"ok": False, "message": "params must be an object"}), 400
        if not simulator.set_scenario(scenario, params):
            return jsonify({"ok": False, "message": "unknown scenario"}), 400
        return jsonify({"ok": True, "scenario": simulator.current_scenario(), **sim_status()})

    @app.route("/api/sim/pause", methods=["POST"])
    def sim_pause() -> Any:
        simulator.pause()
        return jsonify({"ok": True, **sim_status()})

    @app.route("/api/sim/resume", methods=["POST"])
    def sim_resume() -> Any:
        simulator.resume()
        return jsonify({"ok": True, **sim_status()})

    @app.route("/api/trace/start", methods=["POST"])
    def trace_start() -> Any:
        payload = request.get_json(silent=True) or {}
        name = payload.get("name")
        filename = digital_twin.start_record(name)
        return jsonify({"ok": True, "file": filename})

    @app.route("/api/trace/stop", methods=["POST"])
    def trace_stop() -> Any:
        digital_twin.stop_record()
        return jsonify({"ok": True})

    @app.route("/api/trace/list", methods=["GET"])
    def trace_list() -> Any:
        sessions = digital_twin.list_sessions()
        return jsonify({"ok": True, "sessions": sessions})

    @app.route("/api/trace/get/<path:filename>", methods=["GET"])
    def trace_get(filename: str) -> Any:
        base = digital_twin.LOG_DIR.resolve()
        target = (base / filename).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            return jsonify({"ok": False, "message": "Invalid session"}), 400
        if not target.exists() or not target.is_file():
            return jsonify({"ok": False, "message": "Session not found"}), 404
        with target.open("r", encoding="utf-8") as stream:
            content = stream.read()
        return app.response_class(content, mimetype="application/json")

    @app.route("/api/command", methods=["POST"])
    def post_command() -> Any:
        payload = request.get_json(silent=True) or {}
        action = payload.get("action")
        if not action:
            return jsonify({"ok": False, "message": "Missing action"}), 400
        source = payload.get("source", "human")
        reason = payload.get("reason")
        feeling = payload.get("feeling")

        result = apply_action(action, source, reason)
        feeling_escalated = False
        if feeling is not None or reason:
            feeling_escalated = state.record_feeling(feeling, reason)
        status = state.snapshot()
        response: Dict[str, Any] = {"result": result, "state": status}
        if feeling is not None or reason:
            response["human_response"] = {"escalated": feeling_escalated}
            if feeling_escalated and result.get("ok"):
                response["result"]["message"] = (
                    result["message"] + " – Safety escalated to CAUTION"
                )
        return jsonify(response), (200 if result.get("ok") else 400)

    @app.route("/api/events", methods=["GET"])
    def get_events() -> Any:
        limit = request.args.get("limit", default=20, type=int)
        limit = max(1, min(100, limit))
        events = state.recent_events(limit)
        return jsonify({"events": events})

    @app.route("/api/adapter/trace", methods=["GET"])
    def get_adapter_trace() -> Any:
        limit = request.args.get("limit", default=10, type=int)
        limit = max(1, min(100, limit))
        events = twin_adapter.recent_events(limit)
        return jsonify({
            "events": events,
            "path": str(twin_recorder.path),
        })

    @app.route("/api/risk/override", methods=["POST"])
    def post_risk_override() -> Any:
        payload = request.get_json(silent=True) or {}
        try:
            score = payload["score"]
            duration = payload.get("duration", 3.0)
        except KeyError:
            return jsonify({"ok": False, "message": "Missing score"}), 400
        reason = payload.get("reason", "Experiment override")
        details = payload.get("details", {})
        if not isinstance(details, dict):
            return jsonify({"ok": False, "message": "details must be an object"}), 400
        override = risk_module.inject_override(score, duration, reason, **details)
        response = {
            "ok": True,
            "override": {
                "score": override["score"],
                "details": override["details"],
                "expires_at": override["expires_at"],
            },
        }
        return jsonify(response)

    @app.route("/api/risk/override", methods=["DELETE"])
    def delete_risk_override() -> Any:
        risk_module.clear_override()
        return jsonify({"ok": True})

    @app.route("/api/risk/override", methods=["GET"])
    def get_risk_override() -> Any:
        status = risk_module.override_status()
        return jsonify({"override": status})

    @app.route("/", defaults={"filename": "index.html"})
    @app.route("/<path:filename>")
    def serve_frontend(filename: str) -> Any:
        if filename.startswith("api/"):
            return jsonify({"ok": False, "message": "Not Found"}), 404
        target = (frontend_path / filename).resolve()
        try:
            target.relative_to(frontend_path.resolve())
        except ValueError:
            return jsonify({"ok": False, "message": "Invalid path"}), 400
        if target.is_file():
            return send_from_directory(frontend_path, filename)
        return send_from_directory(frontend_path, "index.html")

    @app.route("/api/human_state", methods=["POST"])
    def post_human_state() -> Any:
        payload = request.get_json(silent=True) or {}
        feeling = payload.get("feeling")
        reason = payload.get("reason")
        if feeling is None and not reason:
            return jsonify({"ok": False, "message": "Missing feeling or reason"}), 400

        escalated = state.record_feeling(feeling, reason)
        status = state.snapshot()
        message = "Feeling recorded"
        if escalated:
            message += " – Safety escalated to CAUTION"
        logger.info("Human feeling update: feeling=%s reason=%s escalated=%s", feeling, reason, escalated)
        return jsonify({"ok": True, "message": message, "state": status, "escalated": escalated})

    @app.route("/api/ping", methods=["GET"])
    def ping() -> Any:
        return jsonify({"ok": True})

    logger.info("Safety Core API ready")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
