#!/usr/bin/env python3
"""Recompute P0 facts and decode real frames. Never accept summary alone."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def verify(root, expected_native):
    output = {}
    for kind in ['texture', 'surface']:
        files = root / kind / 'files'
        summary = json.loads((files / 'summary.json').read_text())
        assert summary['passed'] is True and summary['phase'] == 'complete', summary
        assert summary['surface'] == kind and summary['instancesCreated'] == 1
        assert summary['attaches'] >= 2 and summary['detaches'] >= 1
        if kind == 'texture':
            assert summary['textureFrameUpdates'] >= 2
        assert json.loads((files / 'native-manifest.json').read_text()) == expected_native
        events = [json.loads(row) for row in (files / 'events.jsonl').read_text().splitlines()]
        assert all(e['surface'] == kind for e in events)

        def one(name):
            rows = [e for e in events if e['event'] == name]
            assert len(rows) == 1, (name, len(rows))
            return rows[0]

        stopped = one('audio-stop')['position']
        assert len([e for e in events if e['event'] == 'instance']) == 1
        assert abs(one('video-start')['position']) < .25
        assert 37.6 <= stopped < 40
        restored = one('audio-restored')
        assert restored['expected'] == stopped and abs(restored['actual'] - stopped) < .25
        assert restored['vid'] == 'no'
        paused = one('paused')
        assert abs(paused['after'] - paused['before']) < .02
        background = one('background')
        assert background['after'] - background['before'] > .5
        promoted = one('promoted')
        assert promoted['file'] == 'audio.m4a' and promoted['vid'] == 'no'
        assert .2 < promoted['position'] < 3
        loaded_a = [e for e in events if e['event'] == 'loaded' and e['file'] == 'mv-a.mp4']
        assert len(loaded_a) == 1 and loaded_a[0]['vo'] == 'gpu-next'
        assert loaded_a[0]['videoCodec'] is not None
        frames = [e for e in events if e['event'] == 'frame']
        assert {e['name'] for e in frames} == {'a-first.png', 'a-later.png', 'a-seek.png', 'a-reattach.png'}
        decoded = {}
        for frame in frames:
            path = files / frame['name']
            raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                                           '-vf', 'scale=48:48', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
            assert len(raw) == 48 * 48 * 3
            # Testsrc has coloured regions: a black surface/album placeholder cannot pass.
            colourful = sum(max(raw[i:i+3]) - min(raw[i:i+3]) > 70 and max(raw[i:i+3]) > 100
                            for i in range(0, len(raw), 3))
            assert colourful > 300, (kind, frame['name'], colourful)
            dominant = [sum(pixel[c] > 120 and pixel[c] > max(pixel[(c+1)%3], pixel[(c+2)%3]) + 55
                            for pixel in zip(raw[::3], raw[1::3], raw[2::3])) for c in range(3)]
            assert min(dominant) > 10, (kind, frame['name'], dominant)
            decoded[frame['name']] = {'decodedSha256': hashlib.sha256(raw).hexdigest(),
                                     'colourfulPixels': colourful, 'primaryColourPixels': dominant}
        assert decoded['a-first.png']['decodedSha256'] != decoded['a-later.png']['decodedSha256']
        output[kind] = {'summary': summary, 'actualAudioStop': stopped, 'restoredAudio': restored['actual'],
                         'video': loaded_a[0], 'frames': decoded, 'events': len(events)}
    return {'scope': 'standalone current-AAR proof only; RN, app lifecycle, physical output and real source pending',
            'surfaces': output}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('root', type=Path)
    p.add_argument('--native', required=True, type=Path)
    args = p.parse_args()
    result = verify(args.root, json.loads(args.native.read_text()))
    (args.root / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'acceptedSurfaceKinds': list(result['surfaces']), 'scope': result['scope']}))
