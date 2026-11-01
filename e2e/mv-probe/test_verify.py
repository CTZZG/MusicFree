"""Checker controls with explicitly synthetic reports, never device evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

spec = importlib.util.spec_from_file_location('probe_verify', Path(__file__).with_name('verify.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(frame, black=False):
    rows = []
    for y in range(96):
        row = bytearray([0])
        for x in range(96):
            rgb = (0, 0, 0) if black else [(240, 20, 20), (20, 240, 20), (20, 20, 240)][x // 32]
            if not black and frame * 8 <= x < frame * 8 + 8 and 30 <= y < 60:
                rgb = (255, 255, 255)
            row.extend(rgb)
        rows.append(row)
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 96, 96, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b'')


class CheckerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.native = {'aarSha256': 'synthetic-selftest-only', 'payloads': {}}
        for kind in ['texture', 'surface']:
            files = self.root / kind / 'files'; files.mkdir(parents=True)
            summary = {'passed': True, 'phase': 'complete', 'surface': kind, 'instancesCreated': 1,
                       'attaches': 2, 'detaches': 1, 'textureFrameUpdates': 30}
            (files / 'summary.json').write_text(json.dumps(summary))
            (files / 'native-manifest.json').write_text(json.dumps(self.native))
            events = [
                {'event': 'audio-stop', 'position': 37.7},
                {'event': 'audio-restored', 'expected': 37.7, 'actual': 37.7, 'vid': 'no'},
                {'event': 'paused', 'before': 1.2, 'after': 1.2},
                {'event': 'background', 'before': 6.1, 'after': 7.1},
                {'event': 'promoted', 'file': 'audio.m4a', 'vid': 'no', 'position': .4},
                {'event': 'loaded', 'file': 'mv-a.mp4', 'vo': 'gpu-next', 'videoCodec': 'h264'},
                {'event': 'instance', 'id': 1},
                {'event': 'video-start', 'position': 0},
            ]
            for i, name in enumerate(['a-first.png', 'a-later.png', 'a-seek.png', 'a-reattach.png']):
                (files / name).write_bytes(png(i))
                events.append({'event': 'frame', 'name': name, 'position': .8 if i == 0 else 2})
            for e in events: e['surface'] = kind
            self.write_events(kind, events)

    def tearDown(self): self.temp.cleanup()
    def write_events(self, kind, events):
        (self.root / kind / 'files/events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events))
    def events(self): return [json.loads(s) for s in (self.root / 'texture/files/events.jsonl').read_text().splitlines()]
    def reject(self, mutate):
        events = self.events(); mutate(events); self.write_events('texture', events)
        with self.assertRaises((AssertionError, FileNotFoundError)): module.verify(self.root, self.native)
    def test_complete_control(self): self.assertEqual(len(module.verify(self.root, self.native)['surfaces']), 2)
    def test_summary_alone_rejected(self):
        (self.root / 'texture/files/events.jsonl').unlink()
        with self.assertRaises(FileNotFoundError): module.verify(self.root, self.native)
    def test_wrong_restore_rejected(self): self.reject(lambda rows: rows[1].update(actual=8))
    def test_old_seek_inherited_rejected(self): self.reject(lambda rows: rows[7].update(position=37.7))
    def test_paused_motion_rejected(self): self.reject(lambda rows: rows[2].update(after=2))
    def test_no_background_progress_rejected(self): self.reject(lambda rows: rows[3].update(after=6.1))
    def test_prepared_video_leak_rejected(self): self.reject(lambda rows: rows[4].update(vid='auto'))
    def test_duplicate_event_rejected(self): self.reject(lambda rows: rows.append(copy.deepcopy(rows[0])))
    def test_black_frame_rejected(self):
        (self.root / 'texture/files/a-first.png').write_bytes(png(0, black=True))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)
    def test_frozen_frame_rejected(self):
        (self.root / 'texture/files/a-later.png').write_bytes(png(0))
        with self.assertRaises(AssertionError): module.verify(self.root, self.native)


if __name__ == '__main__': unittest.main()
