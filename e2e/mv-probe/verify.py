#!/usr/bin/env python3
"""Recompute P0 facts and decode real frames. Never accept summary alone."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def decode_frame(path):
    stream = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', str(path)
    ]))['streams'][0]
    width, height = stream['width'], stream['height']
    assert width >= 320 and height >= 180, ('frame size', width, height)
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    assert len(raw) == width * height * 3
    scale = min(width / 1280, height / 720)

    def pixel(x, y):
        x = int((width - 1280 * scale) / 2 + x * scale + .5)
        y = int((height - 720 * scale) / 2 + y * scale + .5)
        offset = (y * width + x) * 3
        return raw[offset:offset + 3]

    left, right = pixel(372, 72), pixel(680, 72)
    assert left[0] >= 160 and left[2] >= 160 and left[1] <= 90, ('missing magenta frame guard', path)
    assert right[1] >= 160 and right[2] >= 160 and right[0] <= 90, ('missing cyan frame guard', path)
    frame = 0
    for bit in range(10):
        rgb = pixel(404 + bit * 28, 72)
        if min(rgb) > 170:
            frame |= 1 << bit
        else:
            assert max(rgb) <= 85, ('invalid frame bit', path, bit, list(rgb))
    assert frame < 576, ('frame beyond fixture', frame)
    return frame, width, height


def verify_surface_events(events, summary, instance):
    active = None
    attaches, detaches = [], []
    for e in events:
        if e['event'] in ('attach', 'detach', 'frame', 'background', 'audio-restored', 'audio-resumed'):
            assert e['instanceId'] == instance, ('wrong mpv owner', e)
        if e['event'] == 'attach':
            assert active is None and e['surfaceId'] > 0, ('attach while owned', e)
            attaches.append(e)
            assert e['count'] == e['attachment'] == len(attaches)
            active = (e['attachment'], e['surfaceId'])
        elif e['event'] == 'detach':
            assert active == (e['attachment'], e['surfaceId']), ('detach wrong owner', e)
            detaches.append(e)
            assert e['count'] == len(detaches)
            active = None
        elif e['event'] == 'frame':
            assert active == (e['attachment'], e['surfaceId']), ('frame from detached/stale owner', e)
        elif e['event'] in ('background', 'audio-restored', 'audio-resumed'):
            assert active is None, ('video surface remained attached', e)
    assert summary['attaches'] == len(attaches) == 3
    assert summary['detaches'] == len(detaches) == 2
    assert [e['phase'] for e in attaches] == ['video-a', 'foreground-wait', 'prepared-eof']
    assert [e['phase'] for e in detaches] == ['background-wait', 'return-audio']
    return attaches, detaches


def verify_audio_interval(event, instance, file):
    before, after = event['beforeState'], event['afterState']
    for state in (before, after):
        assert state['instanceId'] == instance and state['file'] == file
        assert state['paused'] is False and state['vid'] == 'no'
        assert state['vo'] in (None, 'null'), ('video output still selected', state)
        assert state['attached'] is False and state['attachment'] == 0
    assert before['uptimeMs'] < after['uptimeMs'] <= event['uptimeMs']
    assert after['uptimeMs'] - before['uptimeMs'] >= 900
    assert after['position'] - before['position'] > .5
    return before, after


def verify(root, expected_native):
    output = {}
    for kind in ['texture', 'surface']:
        files = root / kind / 'files'
        summary = json.loads((files / 'summary.json').read_text())
        assert summary['passed'] is True and summary['phase'] == 'complete', summary
        assert summary['surface'] == kind and summary['instancesCreated'] == 1
        if kind == 'texture':
            assert summary['textureFrameUpdates'] >= 2
        assert json.loads((files / 'native-manifest.json').read_text()) == expected_native
        events = [json.loads(row) for row in (files / 'events.jsonl').read_text().splitlines()]
        assert all(e['surface'] == kind for e in events)
        assert all(a['uptimeMs'] <= b['uptimeMs'] for a, b in zip(events, events[1:])), 'unordered events'

        def one(name, phase=None):
            rows = [e for e in events if e['event'] == name and (phase is None or e['phase'] == phase)]
            assert len(rows) == 1, (name, len(rows))
            return rows[0]

        stopped = one('audio-stop')['position']
        instance = one('instance')['id']
        assert instance > 0
        attaches, detaches = verify_surface_events(events, summary, instance)
        assert abs(one('video-start')['position']) < .25
        assert 37.6 <= stopped < 40
        restored = one('audio-restored')
        assert restored['expected'] == stopped and abs(restored['actual'] - stopped) < .25
        assert restored['vid'] == 'no'
        paused = one('paused')
        assert abs(paused['after'] - paused['before']) < .02
        background = one('background')
        assert background['after'] - background['before'] > .5
        bg_before, bg_after = verify_audio_interval(background, instance, 'mv-a.mp4')
        assert (background['before'], background['after']) == (bg_before['position'], bg_after['position'])
        assert detaches[0]['uptimeMs'] <= bg_before['uptimeMs'] < bg_after['uptimeMs'] < attaches[1]['uptimeMs']
        resume_before, resume_after = verify_audio_interval(one('audio-resumed'), instance, 'audio.m4a')
        assert restored['uptimeMs'] <= resume_before['uptimeMs'] < resume_after['uptimeMs'] < attaches[2]['uptimeMs']
        assert abs(resume_before['position'] - stopped) < .25
        promoted = one('promoted')
        assert promoted['file'] == 'audio.m4a' and promoted['vid'] == 'no'
        assert .2 < promoted['position'] < 3
        loaded_a = [e for e in events if e['event'] == 'loaded' and e['file'] == 'mv-a.mp4']
        assert len(loaded_a) == 1 and loaded_a[0]['vo'] == 'gpu-next'
        assert loaded_a[0]['videoCodec'] is not None
        frames = [e for e in events if e['event'] == 'frame']
        assert len(frames) == 4
        assert {e['name'] for e in frames} == {'a-first.png', 'a-later.png', 'a-seek.png', 'a-reattach.png'}
        decoded = {}
        for frame in frames:
            path = files / frame['name']
            index, width, height = decode_frame(path)
            assert index == frame['frameIndex'] and (width, height) == (frame['width'], frame['height'])
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
                                     'colourfulPixels': colourful, 'primaryColourPixels': dominant,
                                     'frameIndex': index, 'frameSeconds': index / 24}
        assert decoded['a-first.png']['decodedSha256'] != decoded['a-later.png']['decodedSha256']
        assert decoded['a-later.png']['frameIndex'] > decoded['a-first.png']['frameIndex']
        seek_frame = next(e for e in frames if e['name'] == 'a-seek.png')
        assert abs(decoded['a-seek.png']['frameSeconds'] - 6) <= 1 / 24 + 1e-6, 'stale seek frame'
        assert abs(seek_frame['position'] - 6) < .25
        assert decoded['a-reattach.png']['frameIndex'] >= int(bg_after['position'] * 24) - 1, 'stale reattached frame'
        reattached = next(e for e in frames if e['name'] == 'a-reattach.png')
        assert attaches[1]['uptimeMs'] <= reattached['uptimeMs'] < detaches[1]['uptimeMs']
        assert reattached['attachment'] == attaches[1]['attachment']
        for phase, target in [('video-a', 6), ('return-audio', stopped)]:
            request, ready = one('seek-request', phase), one('seek-ready', phase)
            assert request['target'] == ready['target'] == target and abs(ready['actual'] - target) < .25
            assert ready['seekObserved'] is True and ready['restartObserved'] is True
            assert request['instanceId'] == ready['instanceId'] == instance
            native = [e for e in events[events.index(request) + 1:events.index(ready)]
                      if e['event'] == 'mpv-event' and e['phase'] == phase]
            seek_events = [e for e in native if e['id'] == 20]
            assert seek_events, 'no actual SEEK'
            assert any(e['id'] == 21 and e['uptimeMs'] >= seek_events[0]['uptimeMs'] for e in native), 'no actual seek restart'
            assert ready['uptimeMs'] <= (seek_frame if phase == 'video-a' else restored)['uptimeMs']
        output[kind] = {'summary': summary, 'actualAudioStop': stopped, 'restoredAudio': restored['actual'],
                         'audioResume': {'before': resume_before['position'], 'after': resume_after['position']},
                         'video': loaded_a[0], 'frames': decoded, 'events': len(events),
                         'surfaceEvents': {'attaches': attaches, 'detaches': detaches}}
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
