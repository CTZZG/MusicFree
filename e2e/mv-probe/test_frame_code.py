#!/usr/bin/env python3
"""Cross-check the real H.264 fixture/filter with both actual frame decoders.

This is a host codec/Java check, never Android rendering evidence.
"""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def main():
    generate = module('fixtures', 'generate-fixtures.py')
    verify = module('checker', 'verify.py')
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        clip = root / 'coded.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                        'testsrc2=size=1280x720:rate=24:duration=24', '-vf', generate.frame_code_filter(),
                        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '34', '-pix_fmt', 'yuv420p',
                        '-g', '24', str(clip)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', str(clip), '-vf',
                        "select='eq(n,0)+eq(n,87)+eq(n,144)+eq(n,575)',scale=640:360,pad=640:1304:0:(oh-ih)/2",
                        '-fps_mode', 'passthrough', str(root / 'frame-%d.png')], check=True)
        # Compile the actual Android probe helper without Android boundary stubs.
        driver = root / 'CodeCheck.java'
        driver.write_text('''package fun.upup.musicfree.e2e.mvprobe;
import java.nio.file.*;
public class CodeCheck {
    public static void main(String[] a) throws Exception {
        int width = Integer.parseInt(a[0]), height = Integer.parseInt(a[1]), expected = Integer.parseInt(a[3]);
        byte[] raw = Files.readAllBytes(Paths.get(a[2]));
        FrameCode.Pixels pixels = (x, y) -> {
            int offset = (y * width + x) * 3;
            return ((raw[offset] & 255) << 16) | ((raw[offset+1] & 255) << 8) | (raw[offset+2] & 255);
        };
        if (FrameCode.read(width, height, pixels) != expected) throw new AssertionError("wrong decoded frame");
        if (FrameCode.read(width, height, (x,y) -> 0) != -1) throw new AssertionError("black frame accepted");
        if (FrameCode.read(1, 1, pixels) != -1) throw new AssertionError("invalid dimensions accepted");
        System.out.println("Java frame " + expected + " decoded; black/small controls rejected");
    }
}''')
        subprocess.run([os.environ.get('JAVAC', 'javac'), '-source', '8', '-target', '8', '-Xlint:-options', '-d', str(root),
                        str(HERE / 'src/FrameCode.java'), str(driver)], check=True)
        for i, expected in enumerate((0, 87, 144, 575), 1):
            path = root / f'frame-{i}.png'
            index, width, height = verify.decode_frame(path)
            assert index == expected, (index, expected)
            raw = root / 'frame.rgb'
            raw.write_bytes(subprocess.check_output(['ffmpeg', '-v', 'error', '-xerror', '-i', str(path),
                                                    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']))
            subprocess.run(['java', '-cp', str(root), 'fun.upup.musicfree.e2e.mvprobe.CodeCheck',
                            str(width), str(height), str(raw), str(expected)], check=True)
        print('Four H.264 -> PNG -> Python/actual Java frame decoders passed (host only)')


if __name__ == '__main__':
    main()
