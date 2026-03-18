# Phase 5 – Adapter Integration Notes

This iteration expands the safety supervisor with a pluggable adapter layer so multiple downstream consumers can receive mode transitions in lockstep.

## Adapter Chain
- The safety core now attaches to an `AdapterChain` that fan-outs mode updates to each registered adapter.
- The simulator adapter continues to drive the internal kinematic loop.
- New adapters can be registered at startup or dynamically (see `RobotState.attach_adapter`).

## Digital Twin Recorder
- Added `RobotAdapterTwin` which logs every mode transition, position, velocity, risk, and trust summary into `docs/digital_twin_feed.jsonl`.
- The backing `DigitalTwinRecorder` keeps a small in-memory history and automatically rotates the JSONL file when it exceeds ~5 MB.
- Recent twin events can be queried via `GET /api/adapter/trace?limit=25`.
- Front-end now surfaces adapter connectivity, members, and a live trace panel so operators can confirm the twin feed is active.

## Next Steps
1. Replace the recorder with a real digital twin transport (e.g., MQTT or ROS bridge).
2. Allow hot registration/unregistration of adapters over an admin API for hardware switchover.
3. Visualize twin log entries in the UI to correlate simulator and twin telemetry.
