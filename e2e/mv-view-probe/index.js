// Explicit -PmvViewProbe=true entry. This module is absent from the normal App bundle.
import React, {useEffect, useRef, useState} from 'react';
import {AppRegistry, View, Text, StyleSheet, PixelRatio, useWindowDimensions} from 'react-native';
import RNFS from 'react-native-fs';
import * as SplashScreen from 'expo-splash-screen';
import MpvVideo from '../../src/components/mpvVideo';
import NativeMpvPlayer from '../../src/core/playerAdapter/nativeMpvPlayer';

const dir = RNFS.ExternalDirectoryPath + '/mv-view-probe';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const requireValue = (value, message) => { if (!value) throw new Error(message); };
async function until(test, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await wait(50); }
  throw new Error(message);
}

function Probe() {
  const size = useWindowDimensions();
  const box = useRef(null);
  const [identity, setIdentity] = useState(null);
  const [mount, setMount] = useState(0);
  const [phase, setPhase] = useState('starting');
  const frames = useRef(new Set());
  useEffect(() => {
    const report = {status: 'running', events: [], fabric: !!global.nativeFabricUIManager};
    const save = async () => RNFS.writeFile(dir + '/result.json', JSON.stringify(report), 'utf8');
    const rect = () => new Promise(resolve => box.current.measureInWindow((x,y,width,height) => resolve({x,y,width,height,density:PixelRatio.get()})));
    const checkpoint = async name => {
      setPhase(name);
      const data = {phase:name,at:Date.now(),position:await NativeMpvPlayer.getPosition(),video:await NativeMpvPlayer.getVideoInfo(),rect:await rect()};
      report.events.push(data);await save();
      await RNFS.writeFile(dir + '/phase.txt', name, 'utf8');
      await until(() => RNFS.exists(dir + '/continue-' + name), 'host checkpoint missing: ' + name, 30000);
    };
    const active = async generation => (await NativeMpvPlayer.getAudioInfo())?.loadGeneration === generation;
    const load = async (file, generation, extra = {}) => {
      await NativeMpvPlayer.loadAndPlay({url:'file://' + dir + '/' + file, mediaId:'probe-audio', loadGeneration:generation,prepareToken:0,queueRevision:1,autoPlay:false,title:'MV Fabric probe',...extra});
      await until(() => active(generation), 'native file never activated');
    };
    const run = async () => {
      await RNFS.mkdir(dir); await save();
      await SplashScreen.hideAsync();
      requireValue(report.fabric, 'Fabric must actually be active in Release');
      await until(() => RNFS.exists(dir + '/audio.m4a'), 'fixture audio missing', 30000);
      await NativeMpvPlayer.initialize({progressIntervalMs:100});
      await load('audio.m4a', 100);
      await NativeMpvPlayer.seekTo(37);
      await until(async () => Math.abs(await NativeMpvPlayer.getPosition()-37)<0.25, 'initial audio seek');
      try {
        await NativeMpvPlayer.loadAndPlay({url:'file://'+dir+'/mv-a.mp4',mediaId:'probe-audio',loadGeneration:999,prepareToken:0,queueRevision:1,autoPlay:false,renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:99});
        throw new Error('stale generation accepted');
      } catch (error) {
        requireValue(String(error.message).includes('stale rendition replacement'),'wrong stale-generation result');
        report.rejectedStaleRequest=true;
      }
      requireValue(await active(100)&&Math.abs(await NativeMpvPlayer.getPosition()-37)<.25,'stale request changed original audio');
      const captured = await NativeMpvPlayer.loadAndPlay({url:'file://'+dir+'/mv-a.mp4',mediaId:'probe-audio',loadGeneration:101,prepareToken:0,queueRevision:1,autoPlay:false,title:'MV',renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:100});
      report.capturedAudio = captured;
      requireValue(Number.isFinite(captured)&&Math.abs(captured-37)<0.25, 'actual outgoing audio capture');
      await until(() => active(101), 'video never activated');
      requireValue(await NativeMpvPlayer.getPosition()<0.25,'MV must start at zero');
      setIdentity({mediaId:'probe-audio',loadGeneration:101});
      // A paused first frame is a real draw, not a timer-populated success.
      await until(() => frames.current.has(101), 'RN native view never emitted a real frame');
      await NativeMpvPlayer.seekTo(6);
      await until(async () => Math.abs(await NativeMpvPlayer.getPosition()-6)<0.25, 'video seek');
      await checkpoint('seek-paused'); // Host independently reads the rendered frame barcode.
      const oldOwner=(await NativeMpvPlayer.getVideoInfo()).surfaceOwner;
      setMount(1);
      await until(async () => {const info=await NativeMpvPlayer.getVideoInfo();return info.surfaceAttached&&info.surfaceOwner>oldOwner;},'new owner did not attach');
      await checkpoint('new-owner');
      await checkpoint('landscape');
      await checkpoint('portrait');
      await NativeMpvPlayer.resume();
      const before = await NativeMpvPlayer.getPosition();
      await checkpoint('background');
      const after = await NativeMpvPlayer.getPosition();
      requireValue(after>before+0.5,'same MV audio did not advance over background');
      report.background={before,after};
      await checkpoint('foreground');
      await load('mv-hevc.mp4',103,{renditionKind:'mv',positionMode:'start-zero',expectedMediaId:'probe-audio',expectedLoadGeneration:101});
      setIdentity({mediaId:'probe-audio',loadGeneration:103});
      await until(()=>frames.current.has(103),'HEVC did not render in product native view');
      requireValue(/hevc|h\.265/i.test((await NativeMpvPlayer.getVideoInfo()).codec||''),'wrong HEVC decoder');
      await NativeMpvPlayer.seekTo(1);
      await until(async()=>Math.abs(await NativeMpvPlayer.getPosition()-1)<.25,'HEVC seek');
      await checkpoint('hevc');
      setIdentity(null);
      await load('audio.m4a',104,{renditionKind:'audio',positionMode:'restore-audio',expectedMediaId:'probe-audio',expectedLoadGeneration:103,startPosition:captured});
      await until(async () => Math.abs(await NativeMpvPlayer.getPosition()-captured)<0.25,'return audio position');
      const audioInfo=await NativeMpvPlayer.getVideoInfo();
      requireValue(audioInfo.kind==='audio'&&!audioInfo.surfaceAttached,'video leaked into audio');
      await NativeMpvPlayer.resume();const audioBefore=await NativeMpvPlayer.getPosition();
      await wait(900);const audioAfter=await NativeMpvPlayer.getPosition();
      requireValue(audioAfter>audioBefore+0.5,'returned audio is not playing');
      report.returnAudio={audioBefore,audioAfter,video:audioInfo};
      await checkpoint('returned-audio');
      report.status='passed';await save();
    };
    run().catch(async error => { report.status='failed';report.error=String(error.message);await save();setPhase('FAILED: '+error.message); });
    return () => { NativeMpvPlayer.destroy().catch(()=>{}); };
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
