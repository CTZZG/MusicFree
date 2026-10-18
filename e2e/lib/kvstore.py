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

  adb shell cat <文件> | kvstore.py sheet-paths
      歌单 store 里的歌和它记的本地文件位置，每行 "平台/id<Tab>位置"（没有本地文件的位置为空）

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


def sheet_paths(entries):
    data = entries.get("data")
    if not data or data["t"] != "s":
        return []
    result = []
    for song in json.loads(data["v"]):
        if not isinstance(song, dict):
            continue
        url = song.get("url")
        internal = song.get("$") if isinstance(song.get("$"), dict) else {}
        if isinstance(url, str) and url.startswith(("file://", "content://")):
            path = url
        else:
            path = internal.get("localPath") if isinstance(internal.get("localPath"), str) else ""
        result.append(f"{song.get('platform')}/{song.get('id')}\t{path}")
    return result


def check_source(entries, title, download=False):
    if download:
        tasks = json.loads(entries.get("terminalTasks", {}).get("v", "[]"))
        matches = [x for x in tasks if x.get("musicItem", {}).get("title") == title]
        assert len(matches) == 1, f"完成记录数不为 1：{len(matches)}"
        task = matches[0]
        item, source = task["musicItem"], task.get("resolvedSource", {})
        assert task["status"] == 4, f"未完成：{task['status']}"
        assert (item["platform"], item["id"]) == ("E2E 测试源 A", "fallback"), item
        assert (source.get("kind"), source.get("platform"), source.get("id")) == ("remembered", "E2E 测试源 B", "fallback"), source
        assert source.get("quality") == task.get("quality") == "128k", (source, task.get("quality"))
        assert not any(key in source for key in ("url", "headers", "cek", "ekey")), source
        return json.dumps(source, ensure_ascii=False)
    remembered = json.loads(entries.get("music.alternateSources", {}).get("v", "{}"))
    record = remembered.get("E2E 测试源 A@fallback", {}).get("item", {})
    assert (record.get("platform"), record.get("id"), record.get("title")) == ("E2E 测试源 B", "fallback", title), record
    return json.dumps(record, ensure_ascii=False)


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
    assert sheet_paths(entries) == ["E2E 测试源 A/tone-a\t", "E2E 测试源 A/tone-c\t"]
    local_songs = {"data": {"t": "s", "v": json.dumps([
        {"id": "a", "platform": "本地", "$": {"localPath": "content://media/external/audio/media/31"}},
        {"id": "b", "platform": "本地", "url": "content://media/external/audio/media/32", "$": {"localPath": "content://old"}},
    ], ensure_ascii=False)}}
    assert sheet_paths(local_songs) == ["本地/a\tcontent://media/external/audio/media/31", "本地/b\tcontent://media/external/audio/media/32"]
    for broken in ("", "{", "[]", '{"version": 2, "entries": {}}', '{"version": 1}',
                   '{"version": 1, "entries": {"k": {"t": "x", "v": 1}}}'):
        try:
            decode(broken)
        except ValueError:
            continue
        raise AssertionError(f"应当解析失败：{broken!r}")
    source = {"kind": "remembered", "platform": "E2E 测试源 B", "id": "fallback", "quality": "128k"}
    task = {"status": 4, "quality": "128k", "musicItem": {"platform": "E2E 测试源 A", "id": "fallback", "title": "E2E Fallback"}, "resolvedSource": source}
    def snapshot_task(value):
        return {"terminalTasks": {"t": "s", "v": json.dumps([value])}}
    assert json.loads(check_source(snapshot_task(task), "E2E Fallback", True)) == source
    for field, value in (("status", 5), ("quality", "320k"), ("musicItem", {"platform": "E2E 测试源 B", "id": "fallback", "title": "E2E Fallback"}), ("resolvedSource", {**source, "platform": "E2E 测试源 A"}), ("resolvedSource", {**source, "url": "https://example.com"}), ("resolvedSource", {})):
        try:
            check_source(snapshot_task({**task, field: value}), "E2E Fallback", True)
        except AssertionError:
            continue
        raise AssertionError(f"错误的下载记录被接受：{field}")
    remembered = {"music.alternateSources": {"t": "s", "v": json.dumps({"E2E 测试源 A@fallback": {"item": {"platform": "E2E 测试源 B", "id": "fallback", "title": "E2E Fallback"}}})}}
    check_source(remembered, "E2E Fallback")
    try:
        check_source({}, "E2E Fallback")
    except AssertionError:
        pass
    else:
        raise AssertionError("缺失的备用记录被接受")
    print("kvstore.py self-test ok")


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    if argv[1:2] == ["file-name"] and len(argv) == 3:
        print(file_name(argv[2]))
        return 0
    command = argv[1] if len(argv) > 1 else ""
    if command not in ("check", "keys", "find", "sheet-ids", "sheet-paths", "remembered-source", "download-source") or (command in ("find", "remembered-source", "download-source")) != (len(argv) == 3):
        print(__doc__, file=sys.stderr)
        return 2
    try:
        entries = decode(sys.stdin.read())
    except ValueError as error:
        # json.JSONDecodeError 也是 ValueError。check 的输出拿来写进检查结果，其余命令的输出是数据，
        # 原因写到 stderr，免得被当成键
        print(f"解析不了：{error}", file=sys.stdout if command == "check" else sys.stderr)
        return 1
    if command in ("remembered-source", "download-source"):
        try:
            print(check_source(entries, argv[2], command == "download-source"))
        except (AssertionError, ValueError, KeyError, TypeError) as error:
            print(str(error), file=sys.stderr)
            return 1
    elif command == "check":
        print(f"{len(entries)} 个键")
    elif command == "keys":
        for key in entries:
            print(key)
    elif command == "find":
        for key in find(entries, argv[2]):
            print(key)
    elif command == "sheet-paths":
        for line in sheet_paths(entries):
            print(line)
    else:
        for song in sheet_ids(entries):
            print(song)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
