"""Host negative controls; generated video files are real, native/UI rows are synthetic."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('mv_evidence', Path(__file__).with_name('evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)

RAW = '''MpvPlayerModule rendition committed[2]: kind=mv mode=start-zero captured=37.125 target=0.0 instance=7
MpvVideoOutput attached=true owner=1 generation=2 instance=7
MpvPlayerModule rendition ready[2]: kind=mv position=0.0 paused=true
MV_APP_HOME_BEGIN
MpvVideoOutput attached=false owner=1 generation=2 instance=7
MV_APP_HOME_END
MpvVideoOutput attached=true owner=1 generation=2 instance=7
MpvVideoOutput attached=false owner=1 generation=2 instance=7
MpvPlayerModule rendition committed[3]: kind=audio mode=restore-audio captured=6.0 target=37.125 instance=7
MpvPlayerModule rendition ready[3]: kind=audio position=37.125 paused=true
MpvPlayerModule rendition committed[4]: kind=mv mode=start-zero captured=37.125 target=0.0 instance=7
MpvVideoOutput attached=true owner=2 generation=4 instance=7
MpvPlayerModule rendition ready[4]: kind=mv position=0.0 paused=false
MpvVideoOutput attached=false owner=2 generation=4 instance=7
MpvPlayerModule END_FILE completed: endedMediaId=fixture@mv-audio-a promotedMediaId=fixture@mv-audio-b autoAdvanced=true
'''
FIRST = dict(title='E2E MV Song A', position=37125, state='PAUSED')


class Evidence(unittest.TestCase):
    def test_actual_capture_return_and_eof_contract(self):
        self.assertTrue(evidence.verify_native(RAW, FIRST, FIRST)['actualPreparedPromotion'])

    def test_changed_audio_checkpoint_and_bad_first_ready_rejected(self):
        for raw in [RAW.replace('target=37.125', 'target=6.0'), RAW.replace('position=37.125', 'position=36.8')]:
            with self.assertRaises(AssertionError): evidence.verify_native(raw, FIRST, FIRST)

    def test_first_bad_ready_cannot_be_replaced_by_a_later_good_read(self):
        raw = RAW.replace('position=37.125', 'position=36.8 paused=true\nMpvPlayerModule rendition ready[3]: kind=audio position=37.125')
        with self.assertRaises(AssertionError): evidence.verify_native(raw, FIRST, FIRST)

    def test_other_player_missing_detach_and_background_attach_rejected(self):
        for raw in [RAW.replace('instance=7', 'instance=8', 1), RAW.replace('attached=false', 'attached=true'), RAW.replace('MV_APP_HOME_END', 'MpvVideoOutput attached=true owner=1 generation=2 instance=7\nMV_APP_HOME_END')]:
            with self.assertRaises(AssertionError): evidence.verify_native(raw, FIRST, FIRST)

    def test_js_restart_does_not_substitute_for_prepared_audio(self):
        for raw in [RAW.replace('autoAdvanced=true', 'autoAdvanced=false'), RAW + 'loadAndPlay[5]: source=http\n']:
            with self.assertRaises(AssertionError): evidence.verify_native(raw, FIRST, FIRST)

    def test_nullable_and_nonfinite_native_clock_not_a_ready_sample(self):
        for value in ['null', 'NaN', '-1', 'Infinity']:
            with self.assertRaises(ValueError): evidence.ready_rows(RAW.replace('position=37.125', f'position={value}'))

    def test_filtered_persist_contains_only_the_synthetic_song_fields(self):
        song = dict(id='mv-audio-a', platform='E2E 测试源 A', duration=480)
        entries = {k: dict(t='s', v=json.dumps(v)) for k, v in {'music.musicItem': song, 'music.playList': [song], 'music.progress': 37.125, 'pluginSecret': 'do-not-export'}.items()}
        result = evidence.persist(json.dumps(dict(version=1, entries=entries)))
        self.assertNotIn('do-not-export', json.dumps(result))
        self.assertEqual(result['progress'], 37.125)
        self.assertFalse(result['containsVideoUrl'])

    def test_public_node_requires_real_completed_unique_visible_tree(self):
        node = dict(package='fun.upup.musicfree', visible=True, enabled=True, clickable=False,
                    text='', description='播放进度', bounds=[100, 200, 900, 260])
        raw = 'INSTRUMENTATION_RESULT: tree=' + json.dumps([node]) + '\nINSTRUMENTATION_RESULT: match=' + json.dumps(node) + '\nINSTRUMENTATION_RESULT: matches=1\nINSTRUMENTATION_CODE: -1\n'
        self.assertEqual(evidence.seek_point(raw, .5), (500, 230))
        for invalid in [raw.replace('CODE: -1', 'CODE: 0'), raw.replace('matches=1', 'matches=2'), raw.replace('"visible": true', '"visible": false')]:
            with self.assertRaises(ValueError): evidence.seek_point(invalid, .5)

    def test_real_fixture_frame144_and_wrong_video_identity(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name, phase, expected in [('h264-720.mp4', 'inline', True), ('h264-360.mp4', 'quality', True), ('hevc-720.mp4', 'inline', False)]:
                image = root / (name + '.png')
                subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-ss', '6', '-i', str(Path(__file__).parents[1] / 'fixtures/mv' / name), '-frames:v', '1', '-update', '1', str(image)], check=True)
                frame, _, _ = evidence.frames.decode_frame(image)
                self.assertEqual(frame, 144)
                if expected:
                    phase_image = root / f'{phase}.png'
                    phase_image.write_bytes(image.read_bytes())
                    width, height = (640, 360) if phase == 'quality' else (1280, 720)
                    n = dict(package='fun.upup.musicfree', visible=True, enabled=True, clickable=False, text='', description='MV 视频画面', bounds=[0, 0, width, height])
                    (root / f'ui-surface-{phase}.txt').write_text('INSTRUMENTATION_RESULT: tree=' + json.dumps([n]) + '\nINSTRUMENTATION_RESULT: match=' + json.dumps(n) + '\nINSTRUMENTATION_RESULT: matches=1\nINSTRUMENTATION_CODE: -1\n')
                    (root / f'log-{phase}.txt').write_text(f'MpvPlayerModule rendition committed[2]: kind=mv mode=start-zero captured=37.125 target=0.0 instance=7\nMpvVideoOutput attached=true owner=1 generation=2 instance=7\nMpvPlayerModule rendition ready[2]: kind=mv position=6.0 paused=true videoCodec=h264 width={width} height={height} vo=gpu-next hwdec=no\n')
                    self.assertEqual(evidence.capture(root, phase)['frame'], 144)
                    self.assertLess(evidence.picture_identity(image, phase, frame)['meanPixelError'], 10)
                else:
                    with self.assertRaises(AssertionError): evidence.picture_identity(image, phase, frame)

    def test_startup_requires_real_pixels_absent_waiting_and_the_same_15s_budget(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            phase = 'first-h264'
            picture = root / f'{phase}.png'
            subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-ss', '6', '-i',
                            str(Path(__file__).parents[1] / 'fixtures/mv/h264-720.mp4'),
                            '-frames:v', '1', '-update', '1', str(picture)], check=True)
            n = dict(package='fun.upup.musicfree', visible=True, enabled=True, clickable=False,
                     text='', description='MV 视频画面', bounds=[0, 0, 1280, 720])
            def raw(tree):
                return ('INSTRUMENTATION_RESULT: tree=' + json.dumps(tree) +
                        '\nINSTRUMENTATION_RESULT: match=' + json.dumps(n) +
                        '\nINSTRUMENTATION_RESULT: matches=1\nINSTRUMENTATION_RESULT: blockedLabel=正在等待 MV 画面…'
                        '\nINSTRUMENTATION_RESULT: blockedMatches=0\nINSTRUMENTATION_CODE: -1\n')
            ui_file = root / f'ui-surface-{phase}.txt'
            ui_file.write_text(raw([n]))
            (root / f'log-{phase}.txt').write_text(
                'MpvPlayerModule rendition committed[2]: kind=mv mode=start-zero captured=37.125 target=0.0 instance=7\n'
                'MpvVideoOutput attached=true owner=1 generation=2 instance=7\n'
                'MpvPlayerModule rendition ready[2]: kind=mv position=0.01 paused=false videoCodec=h264 width=1280 height=720 vo=gpu-next hwdec=no\n')
            budget_file = root / f'{phase}-budget.json'
            good = dict(startedAtMs=1000, capturedAtMs=6000, deadlineMs=16000)
            budget_file.write_text(json.dumps(good))
            self.assertEqual(evidence.capture(root, phase)['frame'], 144)
            for bad in [dict(good, capturedAtMs=16001), dict(good, deadlineMs=16001)]:
                budget_file.write_text(json.dumps(bad))
                with self.assertRaises(AssertionError): evidence.capture(root, phase)
            budget_file.write_text(json.dumps(good))
            ui_file.write_text(raw([n, dict(package='fun.upup.musicfree', visible=True,
                                           text='正在等待 MV 画面…')]))
            with self.assertRaises(ValueError): evidence.capture(root, phase)
            ui_file.write_text(raw([n]))
            subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-y', '-f', 'lavfi', '-i',
                            'color=c=black:s=1280x720', '-frames:v', '1', '-update', '1', str(picture)], check=True)
            with self.assertRaises((ValueError, AssertionError)): evidence.capture(root, phase)


if __name__ == '__main__':
    unittest.main()
