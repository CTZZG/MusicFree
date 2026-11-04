# Isolated fullscreen diagnosis

This branch reuses the verified d550 Release APK. It changes no product code.
Do not merge its scenario/verification overrides into PR64 or production.

Beta247 proved the original H264 picture within 6313ms and the paused inline
frame126. Its first fullscreen image was completely black at the actual public
surface bounds. Two output recreations occurred during that transition. That
does not establish the cause: an earlier viewport-only implementation produced
a real cropped EGL frame, so reverting it without evidence is unsafe.

This controlled probe takes one image per distinct state: fullscreen paused,
later still paused, explicitly playing, paused again, returned inline paused,
and entering fullscreen while already playing. It uses public controls only.
No seek follows the verified initial inline seek. Every original image remains;
missing frame codes are recorded as diagnostic facts, never retried into PASS.
Collection success is **not** full normal-MV acceptance. The source APK hash,
raw UI/session/native/PNG/video evidence is required for interpretation.
