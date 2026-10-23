#!/usr/bin/env python3
"""Compile the pinned real C function, with only queue/wakeup boundaries replaced.

This proves clock accounting, not Android execution or physical audio output.
The same assertions must reject upstream and two weakened candidate variants.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
PREFIX = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
struct buffer_state { int64_t end_time_ns; bool playing, paused; int wakeup; };
struct driver { bool write; };
struct ao { struct buffer_state *buffer_state; struct driver *driver;
            void (*wakeup_cb)(void *); void *wakeup_ctx; int samplerate; };
static int available, wakes, broadcasts;
#define mp_assert assert
#define MP_TIME_S_TO_NS(x) ((int64_t)((x) * 1000000000.0))
static int read_buffer(struct ao *ao, void **data, int samples,
                       bool *eof, bool pad_silence) { return available; }
static void mp_cond_broadcast(int *p) { broadcasts++; }
static void wake(void *p) { wakes++; }
'''
MAIN = r'''
int main(void) {
    const struct { int requested, copied, rate; bool pad, playing, paused; } cases[] = {
        {2400,1024,16000,false,true,false},
        {2400,1349,16000,false,true,false},
        {2400,915,16000,false,true,false},
        {2400,2400,16000,false,true,false},
        {2400,0,16000,false,true,false},
        {2400,1024,16000,true,true,false},
        {1024,1,44100,false,true,false},
        {2400,1024,16000,false,false,false},
        {2400,1024,16000,false,true,true},
    };
    for (int i=0; i<sizeof(cases)/sizeof(cases[0]); i++) {
        struct buffer_state b = {.end_time_ns=123, .playing=cases[i].playing,
                                  .paused=cases[i].paused};
        struct driver driver = {0};
        struct ao ao = {&b, &driver, wake, NULL, cases[i].rate};
        available=cases[i].copied; wakes=broadcasts=0;
        const int64_t now=1000000000;
        int64_t predicted=now+MP_TIME_S_TO_NS(cases[i].requested/(double)ao.samplerate);
        bool eof=false;
        int copied=ao_read_data_locked(&ao,NULL,cases[i].requested,predicted,&eof,cases[i].pad);
        int64_t expected=available==0 ? 123 : predicted;
        if (available>0 && !cases[i].pad)
            expected-=MP_TIME_S_TO_NS((cases[i].requested-available)/(double)ao.samplerate);
        if (copied!=available || llabs(b.end_time_ns-expected)>1) {
            fprintf(stderr,"case %d expected_end=%lld actual_end=%lld\n",i+1,
                    (long long)expected,(long long)b.end_time_ns);
            return 1;
        }
        bool underrun=available<cases[i].requested && cases[i].playing && !cases[i].paused;
        assert(wakes==underrun && broadcasts==underrun);
        assert(b.playing==(underrun ? false : cases[i].playing));
    }
    puts("9 actual C accounting cases passed");
}
'''


def function(source):
    start = source.index('static int ao_read_data_locked(')
    end = source.index('{', start) + 1
    depth = 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('upstream', type=Path)
    args = parser.parse_args()
    meta = json.loads((HERE / 'trace-source.json').read_text())
    original = (args.upstream / 'audio/out/buffer.c').read_bytes()
    assert hashlib.sha256(original).hexdigest() == meta['upstreamBufferSha256']
    with tempfile.TemporaryDirectory(prefix='mpv-short-read-check-') as directory:
        root = Path(directory)
        target = root / 'audio/out/buffer.c'
        target.parent.mkdir(parents=True)
        target.write_bytes(original)
        subprocess.run(['git', 'apply', str(HERE / 'short-read-clock.patch')], cwd=root, check=True)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == meta['patchedBufferSha256']
        fixed = function(target.read_text())
        variants = {
            'fixed': (fixed, True),
            'upstream': (function(original.decode()), False),
            'subtract-padded-tail': (fixed.replace('if (!pad_silence)', 'if (true)'), False),
            'overwrite-empty-end': (fixed.replace('if (pos > 0)', 'if (pos >= 0)'), False),
        }
        for name, (body, should_pass) in variants.items():
            c = root / (name + '.c')
            binary = c.with_suffix('')
            c.write_text(PREFIX + body + MAIN)
            subprocess.run(['cc', '-std=c11', str(c), '-o', str(binary)], check=True)
            result = subprocess.run([str(binary)], text=True, capture_output=True)
            assert (result.returncode == 0) == should_pass, name + ': ' + result.stdout + result.stderr
            print(name + ': ' + ('passed' if should_pass else 'rejected') + ' — ' + (result.stdout + result.stderr).strip())


if __name__ == '__main__':
    main()
