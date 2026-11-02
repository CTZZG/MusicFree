import importlib.util
import json
import re
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec=importlib.util.spec_from_file_location('capture_checker',Path(__file__).with_name('capture.py'))
capture=importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def verify(root):
    d=json.loads((root/'result.json').read_text())
    assert d['status']=='passed' and d['fabric'] is True and d['rejectedStaleRequest'] is True, d
    phases=['seek-paused','new-owner','landscape','portrait','background','foreground','hevc','returned-audio']
    assert [e['phase'] for e in d['events']]==phases
    assert abs(d['capturedAudio']-37)<.25
    instances={e['video']['instance'] for e in d['events']}
    assert len(instances)==1 and next(iter(instances))>0, 'more than one native player'
    raw=(root/'logcat.txt').read_text(errors='replace')
    leases=re.findall(r'MpvVideoOutput.*?attached=(true|false) owner=(\d+) generation=(\d+) instance=(\d+)',raw)
    assert leases, 'missing raw native surface lifecycle'
    owner=None
    for attached,view,generation,instance in leases:
        assert int(instance) in instances
        if attached=='true':
            assert owner is None, 'two surfaces attached at once'
            owner=(view,generation)
        else:
            assert owner==(view,generation), 'detached wrong owner'
            owner=None
    assert owner is None, 'surface leaked into returned audio'
    first_owner=str(d['events'][0]['video']['surfaceOwner'])
    assert any(a=='false' and v==first_owner for a,v,g,i in leases), 'old owner never detached'
    # The same second view detaches for Home, then reattaches without reloading generation101.
    second=str(d['events'][1]['video']['surfaceOwner'])
    second_events=[a for a,v,g,i in leases if v==second and g=='101']
    assert second_events[:3]==['true','false','true'], 'background surface was not released/rebound'
    assert raw.count('MV_VIEW_BACKGROUND_BEGIN')==raw.count('MV_VIEW_BACKGROUND_END')==1
    background=raw.split('MV_VIEW_BACKGROUND_BEGIN',1)[1].split('MV_VIEW_BACKGROUND_END',1)[0]
    assert re.search(r'MpvVideoOutput.*attached=false owner='+second+r' generation=101 ',background)
    assert not re.search(r'MpvVideoOutput.*attached=true ',background), 'background kept a visible surface'
    frames={}
    for phase in phases[:-1]:
        e=next(x for x in d['events'] if x['phase']==phase)
        assert e['video']['kind']=='mv' and e['video']['loadGeneration']==(103 if phase=='hevc' else 101)
        assert e['video']['surfaceAttached'] is True and e['video']['vo']=='gpu-next'
        frames[phase]=capture.capture(root,phase,144 if phase in phases[:4] else (24 if phase=='hevc' else None))
        if phase=='hevc': assert 'hevc' in e['video']['codec'].lower() or '265' in e['video']['codec']
    assert d['events'][1]['video']['surfaceOwner']>d['events'][0]['video']['surfaceOwner']
    assert d['events'][2]['rect']['width']>d['events'][0]['rect']['width'], 'landscape did not actually relayout'
    assert d['background']['after']>d['background']['before']+.5
    assert frames['foreground']>frames['background'], 'stale frame after background'
    r=d['returnAudio']
    assert r['video']['kind']=='audio' and r['video']['surfaceAttached'] is False
    assert abs(r['audioBefore']-d['capturedAudio'])<.25
    assert r['audioAfter']>r['audioBefore']+.5
    summary={'fabricRelease':True,'actualFrames':frames,'returnAudio':r,'background':d['background'],'fullAppUI':False,'physicalAudio':False}
    (root/'independent-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    return summary


if __name__=='__main__':
    print(json.dumps(verify(Path(sys.argv[1])),indent=2))
