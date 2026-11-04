# Normal App MV acceptance

`e2e_suite=mv` installs the normal Release APK through the existing Beta workflow.
It does not use `-PmvViewProbe`, a replacement entry point, private APIs or user
subscriptions/keys. The test-only UI observer reads public nodes; shell input
uses their actual bounds. Source and APK commits are recorded separately.

The separate `e2e mv <40-character script SHA>` query keeps the original seven-row
queue unchanged. Its original audio A/B has different duration/content from the
self-generated video. The three small committed clips are test resources read
from public fixed GitHub URLs, never production APK assets:

- H264/AAC 720p and360p,48s: same declared timeline, real frame barcode.
- HEVC/AAC720p,24s: distinct picture/edit, plus an intentionally missing URL.
- Rebuild using `python3 e2e/mv/generate-fixtures.py`. Check `manifest.json` and
  fully decode all outputs. FFmpeg build/version can change compressed hashes;
  committed bytes/hashes define each run's input.

The scenario uses actual More/cover candidates, inline/fullscreen/Back, rotate,
Home/foreground, same-cut quality, explicit different-cut restart, return to the
captured audio checkpoint, actual404 fallback, and rendered-video EOF into native
prepared audio. Paused picture captures use native ready clocks and independent
frame/payload decoding. This does not establish physical sound, real-phone ARM
hardware decode, all third-party providers or mobile-network byte consumption.

`evidence.py` cross-checks raw native generation/instance/commit/ready/Surface
facts, original-song identity/progress filtered from KV, actual public UI bounds,
PNG frame codes/picture identity and completed recording coverage. Edited summary
JSON is not a substitute for original files. All original audio gates remain
unchanged. Original private settings are never copied into artifacts.

Startup clock-ready does not establish a rendered frame. Before the test issues
pause or seek, the public observer must see the frame-driven waiting label gone,
then a single startup PNG must decode to the actual clip. Native ready, UI
observation and that PNG share one original 15-second budget. No bad first image
is retried. The published MV session intentionally uses the original song title
with ` · MV`; the returned audio session uses the original title alone.
Optional observer arguments are omitted when empty: `adb shell` joins argv into
a remote shell command, so an empty `-e` value must not consume the next option.
Host transport cases exercise the actual snapshot helper through this boundary.

Host checks:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -I e2e/mv/test_evidence.py
PYTHONDONTWRITEBYTECODE=1 python3 -I e2e/mv/test_driver.py
PYTHONDONTWRITEBYTECODE=1 python3 -I e2e/lib/ui_observer.py --self-test
```

These checks use synthetic transport/native rows and actual codec files; they do
not count as device execution. First failures are retained. Pure harness fixes
reuse the already verified candidate APK through `e2e_apk_run_id`, without a new
build. A product change requires local verification and one appropriate new
candidate; never retry a failed assertion to obtain a green run.
