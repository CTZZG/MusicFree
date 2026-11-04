#!/usr/bin/env python3
"""Small, original, reproducible App MV fixtures. No external music or credentials."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('coded_frames', HERE.parent / 'mv-probe/generate-fixtures.py')
frames = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frames)


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    for name, source, duration, frequency, encoder, scale in [
        ('h264-720.mp4', 'testsrc2', 48, 660, 'libx264', False),
        ('h264-360.mp4', 'testsrc2', 48, 660, 'libx264', True),
        ('hevc-720.mp4', 'testsrc', 24, 880, 'libx265', False),
    ]:
        args = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                f'{source}=size=1280x720:rate=24:duration={duration}',
                '-f', 'lavfi', '-i', f'sine=frequency={frequency}:sample_rate=48000:duration={duration}',
                '-vf', frames.frame_code_filter() + (',scale=640:360' if scale else ''),
                '-c:v', encoder, '-preset', 'veryfast', '-crf', '34', '-threads', '1',
                '-pix_fmt', 'yuv420p', '-g', '24']
        if encoder == 'libx265':
            args += ['-x265-params', 'log-level=error:pools=1:frame-threads=1', '-tag:v', 'hvc1']
        args += ['-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-shortest', str(output / name)]
        subprocess.run(args, check=True)
    manifest = {}
    for path in sorted(output.glob('*.mp4')):
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path), '-f', 'null', '-'], check=True)
        manifest[path.name] = {'bytes': path.stat().st_size,
                               'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                               'probe': json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({k: {'bytes': v['bytes'], 'sha256': v['sha256']} for k, v in manifest.items()}))


if __name__ == '__main__':
    generate(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / 'fixtures/mv')
