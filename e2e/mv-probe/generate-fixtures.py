#!/usr/bin/env python3
"""Small original clips for output proof, not a commercial MV source."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def frame_code_filter():
    # An actual frame-number barcode, not a label populated from player time-pos.
    filters = ['drawbox=x=352:y=40:w=344:h=64:color=black:t=fill',
               'drawbox=x=360:y=56:w=24:h=32:color=magenta:t=fill',
               'drawbox=x=668:y=56:w=24:h=32:color=cyan:t=fill']
    for bit in range(10):
        filters.append(f"drawbox=x={392 + bit * 28}:y=56:w=24:h=32:color=white:t=fill:enable='bitand(n,{1 << bit})'")
    return ','.join(filters)


def generate(output):
    output.mkdir(parents=True, exist_ok=True)
    common = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    subprocess.run(common + ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=90',
                             '-c:a', 'aac', '-b:a', '64k', str(output / 'audio.m4a')], check=True)
    for name, source, frequency in [('mv-a.mp4', 'testsrc2', 660), ('mv-b.mp4', 'testsrc', 880)]:
        subprocess.run(common + ['-f', 'lavfi', '-i', f'{source}=size=1280x720:rate=24:duration=24',
                                 '-f', 'lavfi', '-i', f'sine=frequency={frequency}:sample_rate=48000:duration=24',
                                 '-vf', frame_code_filter(),
                                 '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34',
                                 '-pix_fmt', 'yuv420p', '-g', '24', '-c:a', 'aac', '-b:a', '64k',
                                 '-movflags', '+faststart', '-shortest', str(output / name)], check=True)
    manifest = {}
    for file in sorted(output.glob('*')):
        if file.suffix not in ['.mp4', '.m4a']:
            continue
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                                   '-show_format', '-of', 'json', str(file)]))
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(file), '-f', 'null', '-'], check=True)
        manifest[file.name] = {'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                               'bytes': file.stat().st_size, 'probe': probe}
    (output / 'fixture-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    generate(parser.parse_args().output)
