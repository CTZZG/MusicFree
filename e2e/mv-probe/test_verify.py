"""Checker controls with explicitly synthetic reports, never device evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import sys
import zlib

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('probe_verify', Path(__file__).with_name('verify.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(frame, black=False):
    # Explicitly synthetic video with the same barcode format as the real fixture.
    width, height = 640, 360
    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            rgb = (0, 0, 0) if black else [(240, 20, 20), (20, 240, 20), (20, 20, 240)][min(2, x * 3 // width)]
            if not black and 176 <= x < 348 and 20 <= y < 52:
                rgb = (0, 0, 0)
                if 28 <= y < 44:
                    if 180 <= x < 192: rgb = (255, 0, 255)
                    if 334 <= x < 346: rgb = (0, 255, 255)
                    for bit in range(10):
                        if 196 + bit * 14 <= x < 208 + bit * 14 and frame & (1 << bit): rgb = (255, 255, 255)
            row.extend(rgb)
        rows.append(row)
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')


class CheckerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = {'aarSha256': 'synthetic-selftest-only', 'payloads': {}}
        for kind in ['texture', 'surface']:
            files = self.root / kind / 'files'; files.mkdir(parents=True)
            summary = {'passed': True, 'phase': 'complete', 'surface': kind, 'instancesCreated': 1,
                       'attaches': 3, 'detaches': 2, 'textureFrameUpdates': 30}
            (files / 'summary.json').write_text(json.dumps(summary))
            (files / 'native-manifest.json').write_text(json.dumps(self.native))
            events = []

            def add(event, time, phase, **fields):
                events.append(dict(event=event, uptimeMs=time, phase=phase, surface=kind, instanceId=1, **fields))

            def state(position, time, file):
                return dict(position=position, uptimeMs=time, file=file, paused=False, vid='no', vo=None,
                            attached=False, attachment=0, instanceId=1)

            def frame(name, index, time, phase, attachment, surface_id):
                (files / name).write_bytes(png(index))
                add('frame', time, phase, name=name, frameIndex=index, position=index / 24,
                    width=640, height=360, updates=index, attachment=attachment, surfaceId=surface_id)

            def seek(target, time, phase):
                add('seek-request', time, phase, target=target)
                add('mpv-event', time + 10, phase, id=20)
                add('mpv-event', time + 20, phase, id=21)
                add('seek-ready', time + 30, phase, target=target, actual=target, seekObserved=True, restartObserved=True)

            add('instance', 100, 'audio', id=1)
            add('audio-stop', 200, 'audio', position=37.7)
            add('attach', 300, 'video-a', count=1, attachment=1, surfaceId=101)
            add('loaded', 400, 'video-a', file='mv-a.mp4', vo='gpu-next', videoCodec='h264')
            add('video-start', 500, 'video-a', position=0)
            frame('a-first.png', 24, 600, 'video-a', 1, 101)
            frame('a-later.png', 48, 700, 'video-a', 1, 101)
            add('paused', 800, 'video-a', before=2, after=2)
            seek(6, 850, 'video-a')
            frame('a-seek.png', 144, 950, 'video-a', 1, 101)
            add('detach', 1000, 'background-wait', count=1, attachment=1, surfaceId=101)
            add('background', 2001, 'background-wait', before=6.2, after=7.2,
                beforeState=state(6.2, 1100, 'mv-a.mp4'), afterState=state(7.2, 2000, 'mv-a.mp4'))
            add('attach', 2050, 'foreground-wait', count=2, attachment=2, surfaceId=102)
            frame('a-reattach.png', 192, 2100, 'foreground-wait', 2, 102)
            add('detach', 2200, 'return-audio', count=2, attachment=2, surfaceId=102)
            seek(37.7, 2300, 'return-audio')
            add('audio-restored', 2500, 'return-audio', expected=37.7, actual=37.7, vid='no')
            add('audio-resumed', 3501, 'return-audio', beforeState=state(37.7, 2600, 'audio.m4a'),
                afterState=state(38.6, 3500, 'audio.m4a'))
            add('attach', 3600, 'prepared-eof', count=3, attachment=3, surfaceId=102)
            add('promoted', 4000, 'prepared-eof', file='audio.m4a', vid='no', position=.4)
            self.write_events(kind, events)

    def tearDown(self): self.temp.cleanup()
    def write_events(self, kind, events):
        (self.root / kind / 'files/events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    def events(self): return [json.loads(s) for s in (self.root / 'texture/files/events.jsonl').read_text().splitlines()]
    def event(self, rows, name, phase=None):
        return next(e for e in rows if e['event'] == name and (phase is None or e['phase'] == phase))
    def reject(self, mutate):
        events = self.events(); mutate(events); self.write_events('texture', events)
        with self.assertRaises((AssertionError, FileNotFoundError)): module.verify(self.root, self.native)
    def test_complete_control(self): self.assertEqual(len(module.verify(self.root, self.native)['surfaces']), 2)
    def test_summary_alone_rejected(self):
        (self.root / 'texture/files/events.jsonl').unlink()
        with self.assertRaises(FileNotFoundError): module.verify(self.root, self.native)
    def test_wrong_restore_rejected(self): self.reject(lambda rows: self.event(rows, 'audio-restored').update(actual=8))
    def test_old_seek_inherited_rejected(self): self.reject(lambda rows: self.event(rows, 'video-start').update(position=37.7))
    def test_paused_motion_rejected(self): self.reject(lambda rows: self.event(rows, 'paused').update(after=3))
    def test_no_background_progress_rejected(self): self.reject(lambda rows: self.event(rows, 'background').update(after=6.2))
    def test_prepared_video_leak_rejected(self): self.reject(lambda rows: self.event(rows, 'promoted').update(vid='auto'))
    def test_duplicate_event_rejected(self): self.reject(lambda rows: rows.append(copy.deepcopy(rows[0])))
    def test_black_frame_rejected(self):
        (self.root / 'texture/files/a-first.png').write_bytes(png(0, black=True))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)
    def test_frozen_frame_rejected(self):
        (self.root / 'texture/files/a-later.png').write_bytes(png(24))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)
    def test_stale_seek_frame_rejected(self):
        (self.root / 'texture/files/a-seek.png').write_bytes(png(87))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)
    def test_forged_seek_position_rejected(self):
        def mutate(rows):
            next(e for e in rows if e.get('name') == 'a-seek.png')['frameIndex'] = 87
        (self.root / 'texture/files/a-seek.png').write_bytes(png(87))
        self.reject(mutate)
    def test_missing_seek_completion_rejected(self):
        self.reject(lambda rows: rows.remove(next(e for e in rows if e['event'] == 'mpv-event' and e['id'] == 21)))
    def test_stale_seek_completion_rejected(self):
        def mutate(rows):
            request = self.event(rows, 'seek-request', 'video-a')
            request['uptimeMs'] = 875  # Both native events happened before this request.
            rows.sort(key=lambda e: e['uptimeMs'])
        self.reject(mutate)
    def test_audio_not_resumed_rejected(self):
        self.reject(lambda rows: rows.remove(self.event(rows, 'audio-resumed')))
    def test_audio_resume_paused_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['afterState'].update(paused=True))
    def test_audio_resume_stalled_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['afterState'].update(position=37.7))
    def test_audio_resume_wrong_file_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['afterState'].update(file='mv-b.mp4'))
    def test_audio_resume_position_jump_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['beforeState'].update(position=50))
    def test_audio_resume_video_output_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['afterState'].update(vo='gpu-next'))
    def test_background_not_detached_rejected(self):
        self.reject(lambda rows: rows.remove(self.event(rows, 'detach', 'background-wait')))
    def test_foreground_not_attached_rejected(self):
        self.reject(lambda rows: rows.remove(self.event(rows, 'attach', 'foreground-wait')))
    def test_background_still_owned_rejected(self):
        self.reject(lambda rows: self.event(rows, 'background')['beforeState'].update(attached=True, attachment=1))
    def test_detach_wrong_owner_rejected(self):
        self.reject(lambda rows: self.event(rows, 'detach', 'background-wait').update(surfaceId=999))
    def test_frame_wrong_owner_rejected(self):
        self.reject(lambda rows: next(e for e in rows if e.get('name') == 'a-reattach.png').update(attachment=1))
    def test_audio_wrong_instance_rejected(self):
        self.reject(lambda rows: self.event(rows, 'audio-resumed')['afterState'].update(instanceId=2))
    def test_reattach_stale_frame_rejected(self):
        (self.root / 'texture/files/a-reattach.png').write_bytes(png(144))
        self.reject(lambda rows: next(e for e in rows if e.get('name') == 'a-reattach.png').update(frameIndex=144))
    def test_summary_counts_mismatch_rejected(self):
        path = self.root / 'texture/files/summary.json'; value = json.loads(path.read_text()); value['attaches'] = 5
        path.write_text(json.dumps(value))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)


if __name__ == '__main__': unittest.main()
