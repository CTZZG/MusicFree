"""Execute the real driver command under -e/pipefail, with an unavailable phase file."""
from pathlib import Path
import subprocess

script=Path(__file__).with_name('run.sh').read_text()
line=next(s.strip() for s in script.splitlines() if s.strip().startswith('current=$(adb shell cat'))
prefix='REMOTE=/synthetic; adb() { return 1; }; '
result=subprocess.run(['bash','-euo','pipefail','-c',prefix+line+'; test -z "$current"'],capture_output=True)
assert result.returncode==0, 'missing phase must remain pending, not abort'
old=line.replace(' || true','')
negative=subprocess.run(['bash','-euo','pipefail','-c',prefix+old+'; test -z "$current"'],capture_output=True)
assert negative.returncode!=0, 'old early-exit control did not reproduce'
print('Actual driver missing-phase check passed; old early-exit negative control rejected')
