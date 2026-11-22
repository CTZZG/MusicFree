// Explicit -PmvViewProbe=true entry. This module is absent from the normal App bundle.
import React, {useEffect, useRef, useState} from 'react';
import {AppRegistry, View, Text, StyleSheet, PixelRatio, useWindowDimensions} from 'react-native';
import RNFS from 'react-native-fs';
import * as SplashScreen from 'expo-splash-screen';
import MpvVideo from '../../src/components/mpvVideo';
import NativeMpvPlayer from '../../src/core/playerAdapter/nativeMpvPlayer';
import {createProbeOwner} from './ownership';

const dir = RNFS.ExternalDirectoryPath + '/mv-view-probe';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const requireValue = (value, message) => { if (!value) throw new Error(message); };

function Probe() {
  const size = useWindowDimensions();
  const box = useRef(null);
  const [identity, setIdentity] = useState(null);
  const [mount, setMount] = useState(0);
  const [phase, setPhase] = useState('starting');
  const frames = useRef(new Set());
  useEffect(() => {
    const owner=createProbeOwner(NativeMpvPlayer);
    const native=owner.bridge;
    const until=owner.until;
    const report = {status: 'running', events: [], probeOwner:owner.id, fabric: !!global.nativeFabricUIManager};
    const save = async () => {
      owner.check();
      await RNFS.writeFile(dir + '/result.json', JSON.stringify(report), 'utf8');
      owner.check();
    };
    const rect = () => new Promise(resolve => box.current.measureInWindow((x,y,width,height) => resolve({x,y,width,height,density:PixelRatio.get()})));
    const checkpoint = async name => {
      owner.check();
      setPhase(name);
      const data = {phase:name,probeOwner:owner.id,at:Date.now(),position:await native.getPosition(),video:await native.getVideoInfo(),rect:await rect()};
      report.events.push(data);await save();
      await RNFS.writeFile(dir + '/phase.txt', name, 'utf8');
      await until(() => RNFS.exists(dir + '/continue-' + owner.id + '-' + name), 'host checkpoint missing: ' + name, 30000);
    };
    const active = async generation => (await native.getAudioInfo())?.loadGeneration === generation;
    const load = async (file, generation, extra = {}) => {
      await native.loadAndPlay({url:'file://' + dir + '/' + file, mediaId:'probe-audio', loadGeneration:generation,prepareToken:0,queueRevision:1,autoPlay:false,title:'MV Fabric probe',...extra});
      await until(() => active(generation), 'native file never activated');
    };
    const run = async () => {
      await RNFS.mkdir(dir); await save();
      await SplashScreen.hideAsync();
      requireValue(report.fabric, 'Fabric must actually be active in Release');
      await until(() => RNFS.exists(dir + '/audio.m4a'), 'fixture audio missing', 30000);
      await native.initialize({progressIntervalMs:100});
      await load('audio.m4a', 100);
      await native.seekTo(37);
      await until(async () => Math.abs(await native.getPosition()-37)<0.25, 'initial audio seek');
      try {
        await native.loadAndPlay({url:'file://'+dir+'/mv-a.mp4',mediaId:'probe-audio',loadGeneration:999,prepareToken:0,queueRevision:1,autoPlay:false,renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:99});
        throw new Error('stale generation accepted');
      } catch (error) {
        requireValue(String(error.message).includes('stale rendition replacement'),'wrong stale-generation result');
        report.rejectedStaleRequest=true;
      }
      requireValue(await active(100)&&Math.abs(await native.getPosition()-37)<.25,'stale request changed original audio');
      const captured = await native.loadAndPlay({url:'file://'+dir+'/mv-a.mp4',mediaId:'probe-audio',loadGeneration:101,prepareToken:0,queueRevision:1,autoPlay:false,title:'MV',renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:100});
      report.capturedAudio = captured;
      requireValue(Number.isFinite(captured)&&Math.abs(captured-37)<0.25, 'actual outgoing audio capture');
      await until(() => active(101), 'video never activated');
      requireValue(await native.getPosition()<0.25,'MV must start at zero');
      setIdentity({mediaId:'probe-audio',loadGeneration:101});
      // A paused first frame is a real draw, not a timer-populated success.
      await until(() => frames.current.has(101), 'RN native view never emitted a real frame');
      await native.seekTo(6);
      await until(async () => Math.abs(await native.getPosition()-6)<0.25, 'video seek');
      await checkpoint('seek-paused'); // Host independently reads the rendered frame barcode.
      const oldOwner=(await native.getVideoInfo()).surfaceOwner;
      setMount(1);
      await until(async () => {const info=await native.getVideoInfo();return info.surfaceAttached&&info.surfaceOwner>oldOwner;},'new owner did not attach');
      await checkpoint('new-owner');
      await checkpoint('landscape');
      await checkpoint('portrait');
      await native.resume();
      const before = await native.getPosition();
      await checkpoint('background');
      const after = await native.getPosition();
      requireValue(after>before+0.5,'same MV audio did not advance over background');
      report.background={before,after};
      await checkpoint('foreground');
      // Exercise the real terminal identity, rather than depending on the host's
      // screenshot speed to keep this short clip alive between checkpoints.
      const completeVideo = async generation => {
        if (!(await native.getVideoInfo()).completed) {
          const duration=await native.getDuration();
          requireValue(Number.isFinite(duration)&&duration>1,'missing video duration');
          await native.seekTo(duration-.25);await native.resume();
        }
        await until(async()=>{const info=await native.getVideoInfo();return info.completed&&info.loadGeneration===generation;},'owned video EOF missing');
        const info=await native.getVideoInfo();
        report.completedVideos=[...(report.completedVideos||[]),info];await save();
      };
      await completeVideo(101);
      await load('mv-hevc.mp4',103,{renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:101});
      setIdentity({mediaId:'probe-audio',loadGeneration:103});
      await until(()=>frames.current.has(103),'HEVC did not render in product native view');
      requireValue(/hevc|h\.265/i.test((await native.getVideoInfo()).codec||''),'wrong HEVC decoder');
      await native.seekTo(1);
      await until(async()=>Math.abs(await native.getPosition()-1)<.25,'HEVC seek');
      await checkpoint('hevc');
      await completeVideo(103);
      setIdentity(null);
      await load('audio.m4a',104,{renditionKind:'audio',positionMode:'restore-audio',expectedMediaId:'probe-audio',expectedLoadGeneration:103,startPosition:captured});
      await until(async () => Math.abs(await native.getPosition()-captured)<0.25,'return audio position');
      const audioInfo=await native.getVideoInfo();
      requireValue(audioInfo.kind==='audio'&&!audioInfo.surfaceAttached,'video leaked into audio');
      await native.resume();const audioBefore=await native.getPosition();
      await wait(900);const audioAfter=await native.getPosition();
      requireValue(audioAfter>audioBefore+0.5,'returned audio is not playing');
      report.returnAudio={audioBefore,audioAfter,video:audioInfo};
      await checkpoint('returned-audio');
      report.status='passed';await save();
    };
    run().catch(async error => {
      if(!owner.isCurrent())return;
      report.status='failed';report.error=String(error.message);
      report.failedVideo=await native.getVideoInfo().catch(()=>null);
      report.failedRect=await rect();
      if(!owner.isCurrent())return;
      await save();setPhase('FAILED: '+error.message);
    }).catch(error=>{if(owner.isCurrent())console.error('MV probe report failed: '+error.message);});
    return () => { owner.dispose().catch(()=>{}); };
  }, []);
  return <View onLayout={()=>{}} style={styles.root}>
    <Text style={styles.text}>Fabric Release · {phase}</Text>
    <View ref={box} collapsable={false} style={[styles.box,{width:Math.min(size.width-32,(size.height-100)*16/9),aspectRatio:16/9}]}>
      {identity&&<MpvVideo key={mount} {...identity} style={StyleSheet.absoluteFill} outputVisible={true} onVideoFrame={e=>frames.current.add(e.nativeEvent.loadGeneration)}/>}
      <View style={styles.overlay}><Text style={styles.overlayText}>MV</Text></View>
    </View>
    <Text style={styles.text}>Native texture · clipped corners · shared mpv</Text>
  </View>;
}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:'#203040',alignItems:'center',justifyContent:'center'},box:{borderRadius:24,overflow:'hidden',backgroundColor:'black'},overlay:{position:'absolute',right:12,top:12,backgroundColor:'#ffff00',padding:8},overlayText:{color:'black'},text:{color:'white',margin:12}});
AppRegistry.registerComponent('MusicFree',()=>Probe);
