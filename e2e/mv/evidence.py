#!/usr/bin/env python3
"""Independently inspect normal-App UI/native logs and the actual coded pixels."""
import importlib.util
import hashlib
import datetime
import json
from pathlib import Path
import re
import subprocess
import sys
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


ui = module('public_ui', HERE.parent / 'lib/ui_observer.py')
frames = module('coded_frame', HERE.parent / 'mv-probe/verify.py')
READY = re.compile(r'rendition ready\[(\d+)\]: kind=(audio|mv) position=([^ ]+) paused=(true|false)')
COMMIT = re.compile(r'rendition committed\[(\d+)\]: kind=(audio|mv) mode=([^ ]+) captured=([^ ]+) target=([^ ]+) instance=(\d+)')
LEASE = re.compile(r'MpvVideoOutput.*?attached=(true|false) owner=(\d+) generation=(\d+) instance=(\d+)')


def finite(value):
    number = float(value)
    if not 0 <= number < 1e9:
        raise ValueError('invalid native position')
    return number


def ready_rows(raw):
    if raw.count('rendition ready[') != len(READY.findall(raw)):
        raise ValueError('partial native ready evidence')
    return [dict(generation=int(g), kind=k, position=finite(p), paused=pause == 'true')
            for g, k, p, pause in READY.findall(raw)]


def commits(raw):
    return [dict(generation=int(g), kind=k, mode=mode,
                 captured=None if captured == 'null' else finite(captured),
                 target=None if target == 'null' else finite(target), instance=int(instance))
            for g, k, mode, captured, target, instance in COMMIT.findall(raw)]


def node(text, label):
    ui.target(text, label, True)  # Require the actual unique, visible node and completed instrumentation.
    fields = dict(re.findall(r'(?m)^INSTRUMENTATION_RESULT: ([a-zA-Z]+)=([^\r\n]*)', text))
    return json.loads(fields['match'])


def seek_point(text, fraction):
    n = node(text, '播放进度')
    left, top, right, bottom = n['bounds']
    if not 0 <= fraction <= 1:
        raise ValueError('invalid seek fraction')
    # A public drag, not a private player command. Native ready position is
    # independently measured afterward; this does not assert a pixel-perfect target.
    return round(left + (right - left) * fraction), (top + bottom) // 2


def persist(text):
    entries = module('kv_snapshot', HERE.parent / 'lib/kvstore.py').decode(text)
    def value(key, default):
        raw = entries.get(key, {}).get('v')
        return default if raw is None else json.loads(raw)
    item = value('music.musicItem', {})
    queue = value('music.playList', [])
    assert item.get('id') in ('mv-audio-a', 'mv-audio-b') and item.get('platform') == 'E2E 测试源 A'
    assert all(x.get('id') in ('mv-audio-a', 'mv-audio-b') for x in queue)
    fields = ('id', 'platform', 'duration')
    return dict(item={k: item.get(k) for k in fields}, queue=[{k: x.get(k) for k in fields} for x in queue],
                progress=value('music.progress', None), containsVideoUrl='/fixtures/mv/' in json.dumps([item, queue]),
                rate=value('music.rate', 100))


def picture_identity(cropped, phase, frame):
    name = 'hevc-720.mp4' if phase in ('hevc', 'alternate', 'first-hevc') else 'h264-360.mp4' if phase == 'quality' else 'h264-720.mp4'
    source = HERE.parent / 'fixtures/mv' / name
    expected_hash = json.loads((source.parent / 'manifest.json').read_text())[name]['sha256']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash
    expected = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-ss', str(frame / 24), '-i', str(source), '-frames:v', '1', '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    actual = subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(cropped), '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    assert len(expected) == len(actual) == 160 * 90 * 3
    # Interior pixels identify the actual clip, excluding barcode/rounding/controls.
    differences = [abs(actual[i] - expected[i]) for y in range(22, 68) for x in range(25, 135)
                   for i in range((y * 160 + x) * 3, (y * 160 + x) * 3 + 3)]
    mean_error = sum(differences) / len(differences)
    assert mean_error < 20, ('different video payload or obstructed picture', phase, mean_error)
    return dict(fixture=name, sha256=expected_hash, meanPixelError=mean_error)


def capture(root, phase):
    bounds = node((root / f'ui-surface-{phase}.txt').read_text(), 'MV 视频画面')['bounds']
    left, top, right, bottom = bounds
    width, height = right - left, bottom - top
    original = root / f'{phase}.png'
    screen = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', str(original)]))['streams'][0]
    assert 0 <= left < right <= screen['width'] and 0 <= top < bottom <= screen['height']
    assert width >= 320 and height >= 180, 'actual video area too small to decode'
    cropped = root / f'{phase}-video.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-y', '-i', str(original), '-vf', f'crop={width}:{height}:{left}:{top}', '-frames:v', '1', '-update', '1', str(cropped)], check=True)
    frame, _, _ = frames.decode_frame(cropped)
    raw = (root / f'log-{phase}.txt').read_text(errors='replace')
    starts = commits(raw)
    assert starts and starts[-1]['kind'] == 'mv'
    generation = starts[-1]['generation']
    leases = LEASE.findall(raw)
    assert leases and leases[-1][0] == 'true' and int(leases[-1][2]) == generation
    native = [r for r in ready_rows(raw) if r['generation'] == generation]
    assert native, 'missing actual native ready clock'
    metadata = re.findall(r'rendition ready\[' + str(generation) + r'\]:[^\n]*videoCodec=([^ ]+) width=(\d+) height=(\d+) vo=([^ ]+) hwdec=([^ \r\n]+)', raw)
    assert metadata, 'missing actual decoded video parameters'
    codec, decoded_width, decoded_height, vo, hwdec = metadata[-1]
    expected_width, expected_height = (640, 360) if phase == 'quality' else (1280, 720)
    assert (int(decoded_width), int(decoded_height)) == (expected_width, expected_height)
    assert re.search('hevc|h265', codec.lower().replace('.', '')) if phase in ('hevc', 'alternate', 'first-hevc') else re.search('h264|avc', codec.lower().replace('.', ''))
    assert vo == 'gpu-next'

    if phase not in ('before-home', 'foreground', 'first-h264', 'first-hevc'):
        expected = round(native[-1]['position'] * 24)
        assert native[-1]['paused'] is True and abs(frame - expected) <= 1, ('rendered frame differs from actual paused ready position', phase, frame, expected)
    identity = picture_identity(cropped, phase, frame)
    if phase in ('first-h264', 'first-hevc'):
        budget = json.loads((root / f'{phase}-budget.json').read_text())
        assert (0 < budget['startedAtMs'] <= budget['capturedAtMs'] <= budget['deadlineMs']
                and budget['deadlineMs'] - budget['startedAtMs'] == 15000), 'first picture exceeded the shared15s budget'
        # The observer's absent-label report is checked against its actual tree.
        ui.target((root / f'ui-surface-{phase}.txt').read_text(), 'MV 视频画面', True, '正在等待 MV 画面…')
    result = dict(phase=phase, videoCodec=codec, decodedWidth=int(decoded_width), decodedHeight=int(decoded_height), vo=vo, hwdec=hwdec, pictureIdentity=identity, bounds=bounds, screen=screen, frame=frame, commit=starts[-1], ready=native[-1], lease=leases[-1])
    (root / f'frame-{phase}.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def verify_native(raw, first, returned):
    starts = commits(raw)
    assert len(starts) >= 3
    instances = {v['instance'] for v in starts}
    instances.update(int(v[3]) for v in LEASE.findall(raw))
    assert len(instances) == 1 and next(iter(instances)) > 0, 'more than one native player'
    leases = LEASE.findall(raw)
    active = None
    for attached, owner, generation, instance in leases:
        identity = (owner, generation)
        if attached == 'true':
            assert active is None, 'two live Surface owners'
            active = identity
        else:
            assert active == identity, 'wrong Surface release'
            active = None
    assert active is None, 'video Surface leaked into prepared audio'
    initial = next(v for v in starts if v['kind'] == 'mv' and v['mode'] == 'start-zero')
    assert initial['target'] == 0 and initial['captured'] is not None and initial['captured'] > 1
    audio = [v for v in starts if v['kind'] == 'audio' and v['mode'] == 'restore-audio']
    assert audio
    first_ready = None
    checkpoint = None
    for event in starts:
        if event['kind'] == 'mv' and checkpoint is None:
            checkpoint = event['captured']
            assert checkpoint is not None and checkpoint > 1
        elif event['kind'] == 'audio':
            assert checkpoint is not None and abs(event['target'] - checkpoint) < .000001
            ready = next(v for v in ready_rows(raw) if v['generation'] == event['generation'])
            assert ready['kind'] == 'audio' and abs(ready['position'] - checkpoint) <= .25
            if first_ready is None: first_ready = ready
            checkpoint = None
    assert abs(returned['position'] / 1000 - initial['captured']) <= .5 and returned['state'] == 'PAUSED'
    assert first['title'] == returned['title'] == 'E2E MV Song A'
    assert raw.count('MV_APP_HOME_BEGIN') == raw.count('MV_APP_HOME_END') == 1
    background = raw.split('MV_APP_HOME_BEGIN', 1)[1].split('MV_APP_HOME_END', 1)[0]
    assert re.search(r'MpvVideoOutput.*attached=false ', background), 'Surface not released inside Home window'
    assert not re.search(r'MpvVideoOutput.*attached=true ', background), 'Surface attached while Home visible'
    for layout in ('FULLSCREEN', 'INLINE', 'ROTATION'):
        begin, end = f'MV_APP_LAYOUT_{layout}_BEGIN', f'MV_APP_LAYOUT_{layout}_END'
        assert raw.count(begin) == raw.count(end) == 1, 'missing or duplicated layout window'
        span = raw.split(begin, 1)[1].split(end, 1)[0]
        assert not re.search(r'Set property: (?:vid|vo)=|refresh seek|loadAndPlay\[\d+\]|rendition committed\[', span), 'layout reset the video chain or sought'
    assert re.search(r'END_FILE completed: endedMediaId=.*mv-audio-a.*promotedMediaId=.*mv-audio-b.*autoAdvanced=true', raw), 'no rendered-video-to-prepared-audio promotion'
    # A JS loadfile after native EOF would reset/reload the prepared successor.
    end = raw.rsplit('autoAdvanced=true', 1)[1]
    assert not re.search(r'loadAndPlay\[\d+\]', end), 'prepared audio was subsequently reloaded'
    return dict(instance=next(iter(instances)), captured=initial['captured'], returnReady=first_ready,
                videoLoads=len([v for v in starts if v['kind'] == 'mv']), audioReturns=len(audio), actualPreparedPromotion=True)


def verify(root):
    phases = ['inline', 'fullscreen', 'returned-inline', 'landscape', 'portrait', 'before-home', 'foreground', 'quality', 'alternate', 'hevc', 'first-h264', 'first-hevc']
    facts = {p: json.loads((root / f'frame-{p}.json').read_text()) for p in phases}
    assert facts['landscape']['screen']['width'] > facts['landscape']['screen']['height']
    assert facts['landscape']['bounds'][2] - facts['landscape']['bounds'][0] > facts['portrait']['bounds'][2] - facts['portrait']['bounds'][0]
    assert facts['foreground']['frame'] > facts['before-home']['frame'], 'stale foreground frame'
    assert len({facts[p]['commit']['generation'] for p in phases[:7]}) == 1
    assert facts['hevc']['commit']['generation'] != facts['inline']['commit']['generation']
    raw = (root / 'native-stream.txt').read_text(errors='replace')
    assert raw.count('MV_APP_RECORD_BEGIN') == raw.count('MV_APP_RECORD_END') == 1
    marks = re.findall(r'(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*MV_APP_RECORD_(BEGIN|END)', raw)
    assert [kind for _, kind in marks] == ['BEGIN', 'END']
    stamp = lambda text: datetime.datetime.strptime('2026-' + text, '%Y-%m-%d %H:%M:%S.%f')
    covered = (stamp(marks[1][0]) - stamp(marks[0][0])).total_seconds()
    duration = float(json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(root / 'app.mp4')]))['format']['duration'])
    assert 0 < covered <= duration + 1, 'recording ended before the scenarios'
    source = json.loads((root / 'source.json').read_text())
    assert all(re.fullmatch('[a-f0-9]{40}', source[k]) for k in ('apkCommit', 'scriptCommit'))
    assert re.fullmatch('[a-f0-9]{64}', source['apkSha256'])
    result = verify_native(raw, json.loads((root / 'session-original.json').read_text()), json.loads((root / 'session-returned-audio.json').read_text()))
    assert result['audioReturns'] == 2, 'missing explicit return or real failed-video fallback'
    failed = json.loads((root / 'session-missing-restored.json').read_text())
    assert failed['title'] == 'E2E MV Song A' and failed['state'] == 'PAUSED' and abs(failed['position'] / 1000 - result['captured']) <= .5
    for phase in phases:
        saved = json.loads((root / f'persist-{phase}.json').read_text())
        assert saved['item']['id'] == 'mv-audio-a' and saved['item']['duration'] == 480
        assert [x['id'] for x in saved['queue']] == ['mv-audio-a', 'mv-audio-b']
        assert saved['containsVideoUrl'] is False and abs(saved['progress'] - result['captured']) <= .25
    assert facts['quality']['commit']['mode'] == 'preserve-mv'
    assert abs(facts['quality']['commit']['target'] - facts['quality']['commit']['captured']) < .000001
    assert facts['alternate']['commit']['mode'] == 'start-zero' and facts['alternate']['commit']['target'] == 0
    before = json.loads((root / 'session-before-home.json').read_text())
    background = json.loads((root / 'session-background.json').read_text())
    assert before['state'] == background['state'] == 'PLAYING' and background['position'] >= before['position'] + 500
    prepared = json.loads((root / 'session-prepared-audio.json').read_text())
    assert prepared['title'] == 'E2E MV Song B' and prepared['state'] == 'PLAYING'
    # Actual crop/frame decoding is repeated; edited summary JSON cannot replace the PNGs.
    for phase in phases:
        assert capture(root, phase)['frame'] == facts[phase]['frame']
    result.update(frames={k: v['frame'] for k, v in facts.items()}, fullNormalAppUI=True, physicalAudioVerified=False, hardwareDecoderVerified=False)
    (root / 'independent-summary.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'persist': print(json.dumps(persist(sys.stdin.read()), ensure_ascii=False))
        elif command == 'count-ready': print(len(READY.findall(sys.stdin.read())))
        elif command == 'ready':
            rows = ready_rows(Path(sys.argv[2]).read_text(errors='replace'))
            index = int(sys.argv[3]); assert len(rows) > index
            print(json.dumps(rows[index]))
        elif command == 'seek-point': print(*seek_point(Path(sys.argv[2]).read_text(), float(sys.argv[3])))
        elif command == 'capture': print(json.dumps(capture(Path(sys.argv[2]), sys.argv[3])))
        elif command == 'verify': print(json.dumps(verify(Path(sys.argv[2]))))
        else: raise ValueError('unknown evidence command')
    except (ValueError, KeyError, IndexError, AssertionError, OSError) as error:
        print(f'MV evidence rejected: {error}', file=sys.stderr)
        sys.exit(1)
