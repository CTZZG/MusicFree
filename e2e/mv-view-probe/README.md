# Product native view in Fabric Release

This diagnostic uses `-PmvViewProbe=true`, a separate applicationId
`fun.upup.musicfree.mvprobe`, debug test certificate and this directory's JS
entry. The normal App entry/menu/bundle is unchanged. No third-party API key
or media URL is passed to this workflow. Fixtures are original generated media.

The actual product module and `MusicFreeMpvVideo` ViewManager run under
Release R8, Hermes and Fabric. The test requires actual outgoing audio capture,
MV start0, real rendered H264 seek frame144, clipping/overlay pixels, new-view
ownership, portrait/landscape layout, background detach/foreground reattach,
HEVC seek frame24, and return to the captured audio position with advancing
audio. It checks one native mpv instance throughout. Host frame decoding and
the JSON/log checker independently reject incomplete or inconsistent evidence.
Both video generations must also reach an owned native EOF before the next
explicit zero-start/return load. The original audio stop capture remains live
and exact; a video EOF must not make returning to that stored audio stop impossible.
Rotation uses WindowManager and must result in an actual landscape image.

Run `python3 -I e2e/mv-view-probe/test_verify.py` for host rejection controls.
These mocked-image checker controls are not device rendering evidence.
`capture.py` always decodes a real screenshot crop during the device run.
Original failed/pending screenshot and error logs are retained.

This is the P0 RN mounting/lifecycle gate. It is not the final music-page UI,
physical audio, ARM hardware decoding, real-provider Android acceptance or
the final product Beta. Do not merge its JS entry into the normal App entry.
