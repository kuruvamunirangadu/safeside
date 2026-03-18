# Phase 6 – Experimental Safety Scenarios

This phase introduces tooling to explore "what-if" scenarios by injecting synthetic predictive risk values and observing how the rest of the safety stack responds.

## Predictive Risk Overrides
- `PredictiveRiskModule` now supports a temporary override (`inject_override`) that publishes a specified score and metadata for a configurable duration.
- Overrides stop automatically after the timer elapses or can be cleared manually.
- Override state is exposed via `/api/risk/override` supporting `GET`, `POST`, and `DELETE`.

## Experiment Console Controls
- The front-end adds a **Risk Experiment** panel allowing operators to set score, duration, reason, and extra JSON details.
- Overrides drive the predictive risk UI, adapter chain, and the new digital-twin trace so operators can validate downstream behavior.
- Active overrides highlight their remaining time and summary in the console.

## Next Steps
1. Capture override sessions in structured experiment reports for reproducibility.
2. Allow multiple overlapping scenarios with priority rules instead of a single override slot.
3. Feed override scenarios into automated regression tests to validate adaptive trust and adapter responses.
