"""Accept actual logcat tag/message pairs, never echoed adb shell commands."""
import json
import re
import sys
from pathlib import Path

PHASES = ['begin', 'network-off', 'offline-checked', 'network-on', 'end']
LINE = re.compile(r'^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+I\s+MFOfflineProbe\s*:\s*(.*)$')


def markers(text, token):
    return [m[1].removesuffix(':' + token) for line in text.splitlines()
            if (m := LINE.fullmatch(line)) and m[1].endswith(':' + token)]


def check(text, token):
    observed = markers(text, token)
    assert observed == PHASES, observed
    return {'token': token, 'actualMarkers': observed, 'fullCapture': True,
            'bytes': len(text.encode()), 'scope': 'driver startup diagnostics, not product performance/audio proof'}


def self_test():
    def line(message):
        return '10-29 07:09:00.001 1000 1001 I MFOfflineProbe: ' + message
    token = 'unique-token'
    good = '\n'.join(line(p + ':' + token) for p in PHASES)
    assert check(good, token)['fullCapture']
    for bad in [good.replace(line('end:' + token), ''), good.replace(token, 'other-token'),
                '\n'.join('10-29 07:09:00.001 1000 1001 I adbd: log -t MFOfflineProbe ' + p + ':' + token for p in PHASES),
                good + '\n' + line('end:' + token), good.replace('network-off:', 'unexpected:')]:
        try:
            check(bad, token)
        except AssertionError:
            pass
        else:
            raise AssertionError('incomplete or echoed capture accepted')
    print('offline capture: 6 cases passed')


if __name__ == '__main__':
    command = sys.argv[1]
    if command == '--self-test':
        self_test()
    elif command == 'marker':
        path = Path(sys.argv[2])
        text = path.read_text(errors='replace') if path.exists() else ''
        raise SystemExit(0 if sys.argv[4] in markers(text, sys.argv[3]) else 1)
    elif command == 'check':
        print(json.dumps(check(Path(sys.argv[2]).read_text(errors='replace'), Path(sys.argv[3]).read_text().strip())))
    else:
        raise ValueError(command)
