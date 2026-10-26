#!/usr/bin/env python3
"""Verify actual native public-node snapshots before host input taps."""
import json
from pathlib import Path
import re
import sys


def target(text, label):
    if not re.search(r'(?m)^INSTRUMENTATION_CODE: -1\s*$', text):
        raise ValueError('public UI snapshot did not complete')
    fields = dict(re.findall(r'(?m)^INSTRUMENTATION_RESULT: ([a-zA-Z]+)=([^\r\n]*)', text))
    if fields.get('matches') != '1':
        raise ValueError('target not unique')
    node = json.loads(fields['match'])
    tree = json.loads(fields['tree'])
    matching = [n for n in tree if n.get('visible') is True and n.get('enabled') is True
                and n.get('clickable') is True and n.get('package') == 'fun.upup.musicfree'
                and label in [n.get('text'), n.get('description')]]
    if matching != [node]:
        raise ValueError('reported target not unique in the actual tree')
    if (node.get('package') != 'fun.upup.musicfree' or node.get('enabled') is not True
            or node.get('visible') is not True or node.get('clickable') is not True
            or label not in [node.get('text'), node.get('description')]):
        raise ValueError('incorrect actual public UI target')
    left, top, right, bottom = node['bounds']
    if not all(type(v) is int for v in node['bounds']) or not (0 <= left < right <= 10000 and 0 <= top < bottom <= 10000):
        raise ValueError('invalid bounds')
    return (left + right) // 2, (top + bottom) // 2


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        import unittest
        class Checks(unittest.TestCase):
            def raw(self, code=-1, **change):
                node = dict(package='fun.upup.musicfree', enabled=True, visible=True, clickable=True,
                            text='', description='更多操作', bounds=[849, 1277, 944, 1371])
                node.update(change)
                return f'INSTRUMENTATION_RESULT: tree={json.dumps([node])}\nINSTRUMENTATION_RESULT: match={json.dumps(node)}\nINSTRUMENTATION_RESULT: matches=1\nINSTRUMENTATION_CODE: {code}\n'
            def test_actual_label_and_bounds(self):
                self.assertEqual(target(self.raw(), '更多操作'), (896, 1324))
            def test_wrong_foreground_or_hidden_target_rejected(self):
                for change in [dict(package='other'), dict(visible=False), dict(enabled=False), dict(clickable=False), dict(description='other')]:
                    with self.assertRaises(ValueError): target(self.raw(**change), '更多操作')
            def test_incomplete_ambiguous_or_invalid_bounds_rejected(self):
                for text in [self.raw(code=0), self.raw().replace('matches=1', 'matches=2'), self.raw(bounds=[0, 0, 0, 0]), '']:
                    with self.assertRaises(ValueError): target(text, '更多操作')
            def test_reported_match_must_belong_to_unique_raw_tree(self):
                raw = self.raw()
                tree = re.search(r'(?m)^INSTRUMENTATION_RESULT: tree=(.*)$', raw)[1]
                duplicated = json.dumps(json.loads(tree) * 2)
                for changed in [raw.replace('tree=' + tree, 'tree=[]'), raw.replace('tree=' + tree, 'tree=' + duplicated)]:
                    with self.assertRaises(ValueError): target(changed, '更多操作')
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            print(*target(Path(sys.argv[1]).read_text(), sys.argv[2]))
        except (ValueError, OSError, KeyError, IndexError, TypeError) as error:
            print(f'public UI rejected: {error}', file=sys.stderr)
            sys.exit(1)
