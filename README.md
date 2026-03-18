# Humanoid Safety Supervisor

End-to-end sandbox for evaluating humanoid robot safety controls. The project couples a Flask backend, a simulated robot, and a browser-based operator console. It walks through six build phases, progressively adding logging, human inputs, predictive risk, adaptive trust, adapter fan-out, and risk experimentation.

## Quick start

1. **Install dependencies**

   ```cmd
   cd \Users\kuruv\project\safe
   python -m pip install -r backend\requirements.txt
   ```

2. **Run the backend**

   ```cmd
   python -m backend.app
   ```

   The app serves JSON APIs under `/api/*` and the dashboard at `http://127.0.0.1:5000/` (Flask dev server).

3. **Open the console**
   - Browse to `http://127.0.0.1:5000/`.
   - Top row shows the workflow simulation humanoid and the operator perception figure.
   - Use the control panel to send mode commands, record human feelings, trigger emergency stops (button, voice, or spacebar), and drive predictive risk experiments.

## Features by phase

| Phase | Highlights |
| ----- | ---------- |
| 0 | Flask scaffold, simulator loop, basic UI shell |
| 1 | Event logging, `/api/events` endpoint |
| 2 | Human feeling capture with auto-escalation |
| 3 | Predictive risk module triggering WARNING/CAUTION |
| 4 | Adaptive trust gating for autonomous transitions |
| 5 | Adapter chain, simulator + digital twin feed, UI trace |
| 6 | Scenario recording/playback, risk override experiments, and multimodal stop inputs (button, voice, spacebar) |

## Key modules

- `backend/app.py` – Flask API, adapter wiring, risk override endpoints, serves frontend assets.
- `backend/robot_state.py` – Thread-safe safety supervisor, event log, trust management, adapter notifications.
- `backend/predictive_risk.py` – Predictive risk estimator plus temporary overrides for experiments.
- `robot_sim/simulator.py` – Background motion simulation reflecting mode transitions.
- `robot_sim/adapter.py` – Adapter chain infrastructure and simulator connector.
- `robot_sim/digital_twin.py` – JSONL recorder feeding the adapter trace.
- `frontend/` – Operator dashboard with live telemetry, controls, adapter trace, humanoid workflow view, and operator perception mirror.

## Dashboard visuals

- **Workflow simulation** – Canvas humanoid tracks the robot pose, mode coloring, trail history, and velocity vector.
- **Operator perception** – Companion canvas reflects human feeling, stress pulse, and latest notes with live previews from the form.
- **Risk banner** – Predictive risk alerts surface above controls, syncing with overrides and estimator output.

## API overview

- `GET /api/status` – Full state snapshot (mode, telemetry, human, risk, trust, adapter).
- `POST /api/command` – Apply safety commands (pause, resume, caution, emergency stop, etc.).
- `GET /api/events` – Recent safety events.
- `POST /api/human_state` – Update feelings/reasons from human supervisors.
- `GET|POST|DELETE /api/risk/override` – Inject or clear predictive risk overrides.
- `GET /api/adapter/trace` – Recent entries from the digital twin recorder.
- `POST /api/trace/start`, `POST /api/trace/stop`, `GET /api/trace/list`, `GET /api/trace/get/<file>` – Scenario recording control and session retrieval.

## Safety inputs

- **Voice command (Web Speech API)** – Voice STOP button listens for phrases containing “stop”, “halt”, or “emergency” and routes to `emergency_stop`.
- **Keyboard fallback** – Spacebar shortcut confirms before issuing `emergency_stop` for quick, no-microphone access.
- **Future gestures** – See `docs/future_gesture.md` for a MediaPipe/TF.js webcam pipeline plan.

## Development notes

- The backend runs in debug mode by default; do not expose directly to production.
- Frontend assets are served statically by Flask – changes auto-reload when debug mode restarts.
- Each phase has notes in `docs/phase*.md`; `docs/summary.md` captures the overall roadmap.

## Next steps

- [x] Consolidate trust scoring/gating in `RobotState` and add simulator control APIs.
- [x] Add risk graphs and state machine visualizer.
- [x] Add scenario playback.
- [x] Add voice safety input plus keyboard emergency fallback (gesture pipeline is planned).
- [ ] Stream adapters to real hardware or ROS/MQTT middleware.
- [x] Add minimal automated tests for trust gating, predictive overrides, and adapter error handling.
- [x] Capture experiment sessions (Phase 6) for replay/regression.
- [x] Extend the dashboard with trend charts and scenario playback analytics.

---
Created December 2025; built with GPT-5-Codex assistance.
