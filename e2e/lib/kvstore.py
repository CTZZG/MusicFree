#!/usr/bin/env python3
"""读应用的键值存储文件（/data/data/<包名>/files/kvstore/<store id>.json）。

文件是整份 JSON：{"version": 1, "entries": {键: {"t": "s"|"n"|"b", "v": 值}}}，
见 src/utils/keyValueStore/snapshotCodec.ts。端到端测试用 adb root 读出来交给这里。

  kvstore.py file-name <store id>
      store 在 kvstore 目录里的文件名（和应用一样：encodeURIComponent 编码后把 % 换成 +，
      见 src/utils/keyValueStore/filePersistence.ts）

  adb shell cat <文件> | kvstore.py check
      能按应用的格式解析：输出键的个数；解析不了输出原因、返回 1
      （下面几个命令解析不了时也返回 1，原因写到 stderr）

  adb shell cat <文件> | kvstore.py keys
      每行一个键

  adb shell cat <文件> | kvstore.py find <文字>
      值里含有这段文字的键，每行一个（没有就不输出）

  adb shell cat <文件> | kvstore.py sheet-ids
      歌单 store（LocalSheet.<id>）里的歌，每行一个 "平台/id"

  kvstore.py --self-test
"""
import json
import sys
import urllib.parse

MIGRATION_FLAG_KEY = "$migratedFromMMKV"


def file_name(store_id):
    # encodeURIComponent 不编码的字符：字母数字和 - _ . ! ~ * ' ( )
    return urllib.parse.quote(store_id, safe="-_.!~*'()").replace("%", "+") + ".json"


def decode(text):
    """返回 entries；格式不对抛 ValueError（和应用一样整份不认）。"""
    snapshot = json.loads(text)
    if not isinstance(snapshot, dict) or snapshot.get("version") != 1:
        raise ValueError(f"不是应用的存储格式：version={snapshot.get('version') if isinstance(snapshot, dict) else type(snapshot).__name__}")
    entries = snapshot.get("entries")
    if not isinstance(entries, dict):
        raise ValueError("没有 entries")
    for key, value in entries.items():
        if not isinstance(value, dict) or value.get("t") not in ("s", "n", "b") or "v" not in value:
            raise ValueError(f"键 {key} 的值格式不对")
    return entries


def find(entries, text):
    return [key for key, value in entries.items() if text in str(value["v"])]


def sheet_ids(entries):
    data = entries.get("data")
    if not data or data["t"] != "s":
        return []
    songs = json.loads(data["v"])
    return [f"{song.get('platform')}/{song.get('id')}" for song in songs if isinstance(song, dict)]


SAMPLE = json.dumps({
    "version": 1,
    "entries": {
        MIGRATION_FLAG_KEY: {"t": "s", "v": "2026-10-10T00:00:00.000Z"},
        "tone-a": {"t": "s", "v": json.dumps({"lyricOffset": 1.5, "e2eLegacy": "旧版种子"}, ensure_ascii=False)},
        "data": {"t": "s", "v": json.dumps([
            {"id": "tone-a", "platform": "E2E 测试源 A", "title": "E2E Tone A"},
            {"id": "tone-c", "platform": "E2E 测试源 A", "title": "E2E Tone C"},
        ], ensure_ascii=False)},
        "count": {"t": "n", "v": 3},
    },
}, ensure_ascii=False)


def self_test():
    assert file_name("music.DownloadTasks") == "music.DownloadTasks.json"
    assert file_name("MediaExtra.E2E 测试源 A") == "MediaExtra.E2E+20+E6+B5+8B+E8+AF+95+E6+BA+90+20A.json", file_name("MediaExtra.E2E 测试源 A")
    assert file_name("MediaExtra.a+b") == "MediaExtra.a+2Bb.json"
    assert file_name("LocalSheet.favorite") == "LocalSheet.favorite.json"
    entries = decode(SAMPLE)
    assert len(entries) == 4
    assert find(entries, "旧版种子") == ["tone-a"]
    assert find(entries, "没有这段") == []
    assert sheet_ids(entries) == ["E2E 测试源 A/tone-a", "E2E 测试源 A/tone-c"]
    for broken in ("", "{", "[]", '{"version": 2, "entries": {}}', '{"version": 1}',
                   '{"version": 1, "entries": {"k": {"t": "x", "v": 1}}}'):
        try:
            decode(broken)
        except ValueError:
            continue
        raise AssertionError(f"应当解析失败：{broken!r}")
    print("kvstore.py self-test ok")


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    if argv[1:2] == ["file-name"] and len(argv) == 3:
        print(file_name(argv[2]))
        return 0
    command = argv[1] if len(argv) > 1 else ""
    if command not in ("check", "keys", "find", "sheet-ids") or (command == "find") != (len(argv) == 3):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        entries = decode(sys.stdin.read())
    except ValueError as error:
        # json.JSONDecodeError 也是 ValueError。check 的输出拿来写进检查结果，其余命令的输出是数据，
        # 原因写到 stderr，免得被当成键
        print(f"解析不了：{error}", file=sys.stdout if command == "check" else sys.stderr)
        return 1
    if command == "check":
        print(f"{len(entries)} 个键")
    elif command == "keys":
        for key in entries:
            print(key)
    elif command == "find":
        for key in find(entries, argv[2]):
            print(key)
    else:
        for song in sheet_ids(entries):
            print(song)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
