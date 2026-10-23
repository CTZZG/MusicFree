# AO clock counter experiment — diagnostic branch only

This branch is not a release candidate and must not be merged as a replacement
for the normal device workflow. It dispatches the existing workflow filename on
this isolated branch, builds one traced x86_64 library and a copy of a debug APK,
then runs the original full proxy/device script, including
`AudioTrackSeekClockTest` (one method, six windows), the real-JS replacement flows
and their frozen control. The clock test's only source addition is a log observer
forwarding the counter messages; assertions, windows, sample selection and restore
targets are unchanged. The player module already forwards logs in real-JS flows.

The product AAR is never replaced. The derived producer pins the same sources,
NDK/API and startup helper, plus the counter-only driver patch. APK inspection
requires a debuggable source, exactly one changed runtime payload and matching
public debug certificates for target/test. There is no release signing or publish
step. All other ABI binaries remain untouched.

Logs record requested/copied/written frames, reset epochs, timestamp state and
CLOCK_BOOTTIME at each early read. The latter can be associated with the existing
raw samples' `elapsedRealtime` timestamps. Cross-reset rows are retained. Nothing
clamps positions, changes seek/pause/focus or relaxes 250ms / 0.25s.

`ao-clock-analysis.json` retains early AO rows per case. A successful diagnostic
does not itself prove a root cause or physical audio output: review the actual
rows against the first raw read, including reset races. A failed clock assertion
also retains raw evidence; do not rerun it just to get green.

Normal PR52 acceptance uses its own unchanged workflow and the product AAR, not
this instrumented APK. Remove this temporary experiment when the investigation
is finished; any product fix needs its own four-ABI rebuild and original gates.
