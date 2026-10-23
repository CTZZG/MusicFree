#!/usr/bin/env python3
"""Associate AO counters with the six untouched clock windows; do not infer audible output."""
import argparse
import importlib.util
import json
from pathlib import Path
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path)
    args = parser.parse_args()
    rows = [json.loads(x) for x in (args.results / 'audiotrack-seek-clock.jsonl').read_text().splitlines()]
    log = (args.results / 'logcat.txt').read_text(errors='replace')
    traces = []
    for line in log.splitlines():
        if 'AO_CLOCK_DIAGNOSTIC ' not in line:
            continue
        fields = dict(re.findall(r'(\w+)=([^\s]+)', line.split('AO_CLOCK_DIAGNOSTIC ', 1)[1]))
        try:
            for key in ['epoch', 'epoch_after', 'rate', 'requested', 'copied', 'written_before',
                        'write_result', 'head', 'timestamp', 'stable', 'read_boot_ns']:
                fields[key] = int(fields[key])
            fields['latency'] = float(fields['latency'])
        except (KeyError, ValueError) as error:
            raise AssertionError('malformed AO diagnostic record') from error
        # pos=0 does not update buffer.c's end_time_ns; preserve cross-reset rows
        # without mislabelling an empty read as a committed clock overestimate.
        fields['unusedRequestSeconds'] = ((fields['requested'] - fields['copied']) / fields['rate']
                                         if 0 < fields['copied'] < fields['requested'] else 0.0)
        if fields not in traces:
            traces.append(fields)
    cases = []
    for row in rows:
        early = [x for x in traces if row['startedAtMs'] - 100 <= x['read_boot_ns'] / 1e6 <= row['startedAtMs'] + 300]
        cases.append({'case': row['case'], 'target': row['target'],
                      'firstDelta': row['samples'][0]['raw'] - row['target'] if row['samples'] else None,
                      'startedAtMs': row['startedAtMs'], 'earlyAoReads': early})
    summary = {'diagnosticOnly': True, 'aoReads': len(traces), 'cases': cases,
               'physicalOutputMeasured': False, 'acceptanceLimitsChanged': False,
               'nativeCaptureLines': [x for x in log.splitlines() if 'source replacement[' in x]}
    (args.results / 'ao-clock-analysis.json').write_text(json.dumps(summary, indent=2) + '\n')
    assert traces and all(x['earlyAoReads'] for x in cases), 'missing early AO counts; no root-cause conclusion'
    assert json.loads((args.results / 'capture-health.json').read_text())['complete'] is True, 'incomplete host capture'
    assert not (args.results / 'logcat-error.txt').read_text().strip(), 'host capture reported an error'
    for phase in ('start', 'end'):
        assert re.search(r'\sMPVClockTrace\s*:\s*mpv-diagnostic-' + phase + r'\s*$', log, re.M), 'missing actual diagnostic marker'
    instrument = (args.results / 'instrumentation.log').read_text()
    assert re.search(r'^INSTRUMENTATION_CODE: -1\s*$', instrument, re.M), 'instrumentation failed'
    codes = re.findall(r'^INSTRUMENTATION_STATUS_CODE: (-?\d+)\s*$', instrument, re.M)
    expected = max(map(int, re.findall(r'^INSTRUMENTATION_STATUS: numtests=(\d+)\s*$', instrument, re.M)), default=0)
    assert expected > 0 and codes.count('0') == expected and set(codes) <= {'1', '0'}, 'incomplete native test methods'
    summary['nativeMethodCount'] = expected
    validator = Path(__file__).resolve().parents[1] / 'check-seek-clock.py'
    spec = importlib.util.spec_from_file_location('unchanged_clock_gate', validator)
    gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gate)
    summary['unchangedClockGate'] = gate.validate(rows)
    (args.results / 'ao-clock-analysis.json').write_text(json.dumps(summary, indent=2) + '\n')
    assert (args.results / 'regression-shell-exit.txt').read_text().strip() == '0', 'original device regression failed; inspect raw evidence'
    print(json.dumps({'aoReads': len(traces), 'cases': len(cases), 'clock': summary['unchangedClockGate']}))


if __name__ == '__main__':
    main()
