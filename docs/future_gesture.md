# Gesture Control Roadmap

## Current Fallback
- Spacebar shortcut triggers the existing `emergency_stop` command after operator confirmation.
- Provides an immediate alternative to voice control for rapid shutdowns.

## Recommended Webcam Gesture Pipeline
1. **Capture**: Use `navigator.mediaDevices.getUserMedia({ video: true })` to stream frames into a hidden canvas.
2. **Detect**: Run an on-device model such as MediaPipe Hands, PoseNet, or BlazeFace to classify raised-hand or stop-sign gestures.
3. **Decide**: Apply simple heuristics (e.g., confidence threshold, sustained detection over N frames) to avoid false positives.
4. **Act**: When a stop gesture is confirmed, call the existing `sendCommand("emergency_stop")` path.

## Notes & References
- MediaPipe Hands quickstart: https://developers.google.com/mediapipe/solutions/vision/hand_landmarker
- TensorFlow.js PoseNet guide: https://www.tensorflow.org/js/models
- BlazeFace (lightweight face detector): https://github.com/tensorflow/tfjs-models/tree/master/blazeface

## Future Enhancements
- Stream anonymized keypoints to the backend for redundant verification.
- Provide operator feedback (e.g., flashing banner) when gesture detection arms or triggers.
- Add configurable cooldowns to prevent oscillating stop commands.
