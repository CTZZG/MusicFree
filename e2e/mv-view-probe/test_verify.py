"""Host rejection controls. Mocked image boundaries are not device evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('view_verify',Path(__file__).with_name('verify.py'))
verify=importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


def fixture():
    phases=['seek-paused','new-owner','landscape','portrait','background','foreground','hevc','returned-audio']
    events=[]
    for i,phase in enumerate(phases):
        events.append({'phase':phase,'probeOwner':1,'position':6,'at':i,
            'rect':{'width':800 if phase=='landscape' else 400},
            'video':{'instance':7,'kind':'audio' if phase=='returned-audio' else 'mv',
                     'loadGeneration':103 if phase=='hevc' else 101,'surfaceAttached':phase!='returned-audio',
                     'surfaceOwner':1 if i==0 else 2,'codec':'hevc' if phase=='hevc' else 'h264','vo':'gpu-next'}})
    return {'status':'passed','probeOwner':1,'fabric':True,'rejectedStaleRequest':True,'capturedAudio':37.,'events':events,
        'background':{'before':6.1,'after':8.5},
        'returnAudio':{'audioBefore':37.01,'audioAfter':37.8,'video':{'kind':'audio','surfaceAttached':False}}}


RAW='''MpvVideoOutput attached=true owner=1 generation=101 instance=7
MpvVideoOutput attached=false owner=1 generation=101 instance=7
MpvVideoOutput attached=true owner=2 generation=101 instance=7
MvViewHost MV_VIEW_BACKGROUND_BEGIN
MpvVideoOutput attached=false owner=2 generation=101 instance=7
MvViewHost MV_VIEW_BACKGROUND_END
MpvVideoOutput attached=true owner=2 generation=101 instance=7
MpvVideoOutput attached=false owner=2 generation=101 instance=7
MpvVideoOutput attached=true owner=2 generation=103 instance=7
MpvVideoOutput attached=false owner=2 generation=103 instance=7
'''


class Controls(unittest.TestCase):
    def check(self,data=None,raw=RAW,frames=None):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'result.json').write_text(json.dumps(data or fixture()))
            (root/'logcat.txt').write_text(raw)
            def capture(_,phase,expected=None):
                actual=(frames or {}).get(phase,24 if phase=='hevc' else 192 if phase=='foreground' else 144)
                if expected is not None: assert abs(actual-expected)<=1
                return actual
            with patch.object(verify.capture,'capture',capture):return verify.verify(root)

    def test_complete_control(self): self.assertTrue(self.check()['fabricRelease'])
    def test_requires_actual_fabric(self):
        d=fixture();d['fabric']=False
        with self.assertRaises(AssertionError):self.check(d)
    def test_old_rendered_frame_rejected(self):
        with self.assertRaises(AssertionError):self.check(frames={'seek-paused':87})
    def test_return_audio_cannot_stay_paused(self):
        d=fixture();d['returnAudio']['audioAfter']=37.01
        with self.assertRaises(AssertionError):self.check(d)
    def test_return_does_not_use_mv_position(self):
        d=fixture();d['returnAudio']['audioBefore']=6.;d['returnAudio']['audioAfter']=7.
        with self.assertRaises(AssertionError):self.check(d)
    def test_missing_background_lifecycle_rejected(self):
        raw=RAW.replace('MpvVideoOutput attached=false owner=2 generation=101 instance=7\nMvViewHost MV_VIEW_BACKGROUND_END','MvViewHost MV_VIEW_BACKGROUND_END')
        with self.assertRaises(AssertionError):self.check(raw=raw)
    def test_wrong_owner_destroy_rejected(self):
        with self.assertRaises(AssertionError):self.check(raw=RAW.replace('attached=false owner=1','attached=false owner=2'))
    def test_more_than_one_engine_rejected(self):
        d=fixture();d['events'][4]['video']['instance']=8
        with self.assertRaises(AssertionError):self.check(d)
    def test_stale_frame_after_background_rejected(self):
        with self.assertRaises(AssertionError):self.check(frames={'foreground':144})
    def test_absent_rotation_rejected(self):
        d=fixture();d['events'][2]['rect']['width']=400
        with self.assertRaises(AssertionError):self.check(d)
    def test_old_component_checkpoint_rejected(self):
        d=fixture();d['events'][0]['probeOwner']=0
        with self.assertRaises(AssertionError):self.check(d)


if __name__=='__main__':unittest.main()
