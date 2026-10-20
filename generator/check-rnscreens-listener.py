#!/usr/bin/env python3
"""Compile the actual screens proxy/listener with host framework-boundary shims.

This verifies C++ synchronization and ownership, not Android JNI or UI behavior.
--tsan is an additional local diagnostic; normal CI does not assume a TSAN runtime.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--sources', type=Path, default=ROOT / 'node_modules/react-native-screens')
parser.add_argument('--tsan', action='store_true')
args = parser.parse_args()
fixture = ROOT / 'tests/native/rnscreens'
with tempfile.TemporaryDirectory(prefix='musicfree-screens-') as directory:
    directory = Path(directory)
    include = directory / 'include'
    for header in ['fbjni/fbjni.h', 'react/fabric/JFabricUIManager.h', 'react/fabric/Binding.h',
                   'react/renderer/componentregistry/ComponentDescriptorFactory.h',
                   'react/renderer/scheduler/Scheduler.h', 'react/renderer/mounting/MountingOverrideDelegate.h',
                   'react/renderer/mounting/ShadowView.h', 'react/renderer/mounting/ShadowViewMutation.h']:
        target = include / header
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('#include "shims.h"\n')
    binary = directory / 'listener-test'
    command = [os.environ.get('CXX', 'g++'), '-std=c++20', '-g', '-O1', '-pthread',
               '-I' + str(include), '-I' + str(fixture), '-I' + str(args.sources / 'android/src/main/cpp'),
               '-I' + str(args.sources / 'cpp'), str(fixture / 'listener-test.cpp'),
               str(args.sources / 'android/src/main/cpp/NativeProxy.cpp'),
               str(args.sources / 'cpp/RNSScreenRemovalListener.cpp'), '-o', str(binary)]
    if args.tsan:
        command += ['-fsanitize=thread', '-fno-omit-frame-pointer', '-no-pie']
    subprocess.run(command, check=True)
    subprocess.run([str(binary)] + (['--race-only'] if args.tsan else []), check=True, timeout=45)
