"""Original HEVC/AAC clip for the codec returned by the user's real QQ source."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).parents[1]/'mv-probe/generate-fixtures.py')
fixtures=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
out=Path(sys.argv[1]);out.mkdir(exist_ok=True,parents=True)
clip=out/'mv-hevc.mp4'
subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=24:duration=4',
                '-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=4',
                '-vf',fixtures.frame_code_filter(),'-c:v','libx265','-preset','ultrafast',
                '-x265-params','log-level=error:pools=1:frame-threads=1','-crf','34','-pix_fmt','yuv420p',
                '-tag:v','hvc1','-c:a','aac','-b:a','64k','-movflags','+faststart','-shortest',str(clip)],check=True)
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(clip),'-f','null','-'],check=True)
manifest=json.loads((out/'fixture-manifest.json').read_text())
manifest[clip.name]={'sha256':hashlib.sha256(clip.read_bytes()).hexdigest(),'bytes':clip.stat().st_size,
                     'probe':json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(clip)]))}
(out/'fixture-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
