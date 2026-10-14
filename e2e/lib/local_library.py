#!/usr/bin/env python3
"""本地音乐库端到端测试（library.sh）用的读取和检查。

应用的本地音乐列表存在 AsyncStorage 里（键 local-music-sheet），也就是
/data/data/<包名>/databases/RKStorage 这个 SQLite 文件的 catalystLocalStorage 表。library.sh 用 adb root
把数据库文件（和 -wal）拷出来交给这里。

  local_library.py entries <RKStorage 文件>
      本地音乐里标题以 "E2E Lib" 开头的歌，按标题、键排序，输出一行 JSON 数组：
      [{"key": "平台/id", "title": ..., "path": ...}]（path 是应用记的文件位置，MediaStore 导入的是 content URI）

  adb shell content query --uri content://media/external/audio/media ... | local_library.py media-rows
      把 content query 的输出转成一行 JSON 数组：
      [{"uri": "content://media/external/audio/media/<_id>", "file": _data, "title": ..., "duration": ..., "music": ...}]

  local_library.py ready <media 文件> <设备上的文件路径>...
      这些文件在 MediaStore 里都有了、而且扫完了（是音乐、标题是 E2E Lib 开头、有时长），否则返回 1

  local_library.py gone <media 文件> <设备上的文件路径>...
      这些文件在 MediaStore 里都没有了，否则返回 1

  local_library.py check <entries 文件> <media 文件> <标题> [key=<键>] [file=<设备上的文件路径>]
      这首在本地音乐里正好一条，指向 MediaStore 里一个现有的同名文件；给了 key 就要求键不变，
      给了 file 就要求指向这个文件。通过输出一行说明，不通过输出原因、返回 1

  local_library.py same <之前的 entries 文件> <之后的 entries 文件>
      两次的条目完全一样（键、标题、路径），不一样输出差别、返回 1

  local_library.py key <entries 文件> <标题>
      这首（只有一条时）的键

  maestro hierarchy --compact | local_library.py row <标题>
      本地音乐列表里这首的读屏标签：缺失文件输出 missing，正常 ok，找不到 absent

  local_library.py --self-test
"""
import json
import re
import sqlite3
import sys

STORAGE_KEY = "local-music-sheet"
TITLE_PREFIX = "E2E Lib"
MEDIA_URI = "content://media/external/audio/media/"
MISSING_SUFFIX = "文件不存在"
A11Y_TEXT = re.compile(r"accessibilityText=([^;\"]*)")


def local_path(item):
    url = item.get("url")
    if isinstance(url, str) and (url.startswith("file://") or url.startswith("content://")):
        return url
    internal = item.get("$")
    if isinstance(internal, dict) and isinstance(internal.get("localPath"), str):
        return internal["localPath"]
    return None


def entries_from_value(value):
    items = json.loads(value) if value else []
    if not isinstance(items, list):
        raise ValueError(f"{STORAGE_KEY} 不是数组：{type(items).__name__}")
    result = [
        {"key": f"{item.get('platform')}/{item.get('id')}", "title": item.get("title"), "path": local_path(item)}
        for item in items
        if isinstance(item, dict) and str(item.get("title") or "").startswith(TITLE_PREFIX)
    ]
    return sorted(result, key=lambda entry: (entry["title"], entry["key"]))


def read_entries(db_path):
    connection = sqlite3.connect(db_path)
    try:
        row = connection.execute(
            "SELECT value FROM catalystLocalStorage WHERE key = ?", (STORAGE_KEY,)
        ).fetchone()
    finally:
        connection.close()
    return entries_from_value(row[0] if row else None)


def parse_media_rows(text):
    """content query 每行 "Row: 0 _id=31, _data=/storage/..., title=..."，值里没有 ", "（测试文件都是这样起名的）。"""
    rows = []
    for line in text.splitlines():
        line = line.strip()
        match = re.match(r"^Row: \d+ (.*)$", line)
        if not match:
            continue
        fields = {}
        for part in match.group(1).split(", "):
            name, _, value = part.partition("=")
            fields[name] = value
        if "_id" not in fields:
            raise ValueError(f"没有 _id：{line}")
        rows.append({
            "uri": MEDIA_URI + fields["_id"],
            "file": fields.get("_data"),
            "title": fields.get("title"),
            "duration": int(fields["duration"]) if fields.get("duration", "NULL").isdigit() else None,
            "music": fields.get("is_music") == "1",
        })
    return sorted(rows, key=lambda row: row["file"] or "")


def ready(media, files):
    rows = {row["file"]: row for row in media}
    return all(
        file in rows and rows[file]["music"] and (rows[file]["title"] or "").startswith(TITLE_PREFIX)
        and (rows[file]["duration"] or 0) > 0
        for file in files
    )


def gone(media, files):
    present = {row["file"] for row in media}
    return not any(file in present for file in files)


def check(entries, media, title, key=None, file=None):
    matches = [entry for entry in entries if entry["title"] == title]
    if len(matches) != 1:
        raise AssertionError(f"「{title}」在本地音乐里有 {len(matches)} 条：{json.dumps(matches, ensure_ascii=False)}")
    entry = matches[0]
    rows = {row["uri"]: row for row in media}
    row = rows.get(entry["path"])
    if row is None:
        raise AssertionError(f"「{title}」指向 {entry['path']}，MediaStore 里没有这个文件")
    if row["title"] != title:
        raise AssertionError(f"「{title}」指向 {row['file']}，那是「{row['title']}」")
    if key is not None and entry["key"] != key:
        raise AssertionError(f"「{title}」的键变了：{key} → {entry['key']}")
    if file is not None and row["file"] != file:
        raise AssertionError(f"「{title}」指向 {row['file']}，应当指向 {file}")
    return f"一条，键 {entry['key']}，指向 {row['file']}"


def same(before, after):
    if before == after:
        return f"{len(after)} 条，键和路径都没变"
    gone = [entry for entry in before if entry not in after]
    new = [entry for entry in after if entry not in before]
    raise AssertionError(
        f"变了：少了 {json.dumps(gone, ensure_ascii=False)}，多了 {json.dumps(new, ensure_ascii=False)}"
    )


def key_of(entries, title):
    matches = [entry for entry in entries if entry["title"] == title]
    if len(matches) != 1:
        raise AssertionError(f"「{title}」在本地音乐里有 {len(matches)} 条")
    return matches[0]["key"]


def row_status(hierarchy, title):
    found = None
    for line in hierarchy.splitlines():
        label = A11Y_TEXT.search(line)
        if not label:
            continue
        text = label.group(1).strip()
        if text == title or text.startswith(f"{title}, "):
            if MISSING_SUFFIX in text:
                return "missing"
            found = "ok"
    return found or "absent"


def self_test():
    import os
    import tempfile

    sheet = [
        {"id": "b", "platform": "本地", "title": "E2E Lib Two", "url": "content://media/external/audio/media/32"},
        {"id": "a", "platform": "本地", "title": "E2E Lib One", "$": {"localPath": "content://media/external/audio/media/31"}},
        {"id": "x", "platform": "E2E 测试源 A", "title": "E2E Tone A"},
        "垃圾",
    ]
    with tempfile.TemporaryDirectory() as directory:
        db_path = os.path.join(directory, "RKStorage")
        connection = sqlite3.connect(db_path)
        connection.execute("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute("INSERT INTO catalystLocalStorage VALUES (?, ?)", (STORAGE_KEY, json.dumps(sheet, ensure_ascii=False)))
        connection.commit()
        connection.close()
        entries = read_entries(db_path)
        empty_path = os.path.join(directory, "empty")
        connection = sqlite3.connect(empty_path)
        connection.execute("CREATE TABLE catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.commit()
        connection.close()
        assert read_entries(empty_path) == []
    assert entries == [
        {"key": "本地/a", "title": "E2E Lib One", "path": "content://media/external/audio/media/31"},
        {"key": "本地/b", "title": "E2E Lib Two", "path": "content://media/external/audio/media/32"},
    ], entries

    media = parse_media_rows(
        "Row: 0 _id=32, _data=/storage/emulated/0/Music/E2E-Library/E2ELibTwo.mp3, title=E2E Lib Two, duration=44000, is_music=1\r\n"
        "Row: 1 _id=31, _data=/storage/emulated/0/Music/E2E-Library/E2ELibOne.mp3, title=E2E Lib One, duration=40000, is_music=1\n"
        "Row: 2 _id=40, _data=/storage/emulated/0/Music/E2E-Copies/E2ELibOne.mp3, title=E2E Lib One, duration=NULL, is_music=0\n"
    )
    assert [row["uri"] for row in media] == [MEDIA_URI + "40", MEDIA_URI + "31", MEDIA_URI + "32"], media
    assert media[0]["duration"] is None and not media[0]["music"] and media[1]["music"]
    assert parse_media_rows("No result found.\n") == []
    one = "/storage/emulated/0/Music/E2E-Library/E2ELibOne.mp3"
    copy = "/storage/emulated/0/Music/E2E-Copies/E2ELibOne.mp3"
    assert ready(media, [one, "/storage/emulated/0/Music/E2E-Library/E2ELibTwo.mp3"])
    assert not ready(media, [one, copy])
    assert not ready(media, [one, "/storage/emulated/0/Music/E2E-Moved/E2ELibOne.mp3"])
    assert gone(media, ["/storage/emulated/0/Music/E2E-Moved/E2ELibOne.mp3"]) and not gone(media, [copy])

    assert "/E2ELibOne.mp3" in check(entries, media, "E2E Lib One", key="本地/a")
    check(entries, media, "E2E Lib One", file="/storage/emulated/0/Music/E2E-Library/E2ELibOne.mp3")
    failures = [
        lambda: check(entries, media, "E2E Lib Three"),
        lambda: check(entries + [dict(entries[0], key="本地/c")], media, "E2E Lib One"),
        lambda: check(entries, media, "E2E Lib One", key="本地/z"),
        lambda: check(entries, media, "E2E Lib One", file="/storage/emulated/0/Music/E2E-Copies/E2ELibOne.mp3"),
        lambda: check(entries, [row for row in media if not row["uri"].endswith("/31")], "E2E Lib One"),
        lambda: check([dict(entries[0], path=MEDIA_URI + "32")], media, "E2E Lib One"),
        lambda: same(entries, entries[:1]),
        lambda: same(entries, [entries[0], dict(entries[1], path=MEDIA_URI + "40")]),
        lambda: key_of(entries + [dict(entries[0], key="本地/c")], "E2E Lib One"),
    ]
    for index, failure in enumerate(failures):
        try:
            failure()
        except AssertionError:
            continue
        raise AssertionError(f"第 {index} 个错误的情况被接受了")
    assert same(entries, list(entries)).startswith("2 条")
    assert key_of(entries, "E2E Lib Two") == "本地/b"

    hierarchy = (
        'View accessibilityText=E2E Lib One, E2E Library, 文件不存在; bounds=[0,100][100,200] clickable=true\n'
        'View accessibilityText=E2E Lib One 更多操作; bounds=[0,100][100,200] clickable=true\n'
        'View accessibilityText=E2E Lib Two, E2E Library; bounds=[0,200][100,300] clickable=true\n'
        'View accessibilityText=歌曲: E2E Lib Three 歌手: E2E Library; clickable=true\n'
    )
    assert row_status(hierarchy, "E2E Lib One") == "missing"
    assert row_status(hierarchy, "E2E Lib Two") == "ok"
    assert row_status(hierarchy, "E2E Lib Three") == "absent"
    print("local_library.py self-test ok")


def load(path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def main(argv):
    command = argv[1] if len(argv) > 1 else ""
    try:
        if command == "--self-test":
            self_test()
        elif command == "entries" and len(argv) == 3:
            print(json.dumps(read_entries(argv[2]), ensure_ascii=False))
        elif command == "media-rows" and len(argv) == 2:
            print(json.dumps(parse_media_rows(sys.stdin.read()), ensure_ascii=False))
        elif command in ("ready", "gone") and len(argv) >= 4:
            return 0 if (ready if command == "ready" else gone)(load(argv[2]), argv[3:]) else 1
        elif command == "check" and len(argv) >= 5:
            options = dict(arg.split("=", 1) for arg in argv[5:])
            if set(options) - {"key", "file"}:
                raise ValueError(f"不认识的参数：{argv[5:]}")
            print(check(load(argv[2]), load(argv[3]), argv[4], options.get("key"), options.get("file")))
        elif command == "same" and len(argv) == 4:
            print(same(load(argv[2]), load(argv[3])))
        elif command == "key" and len(argv) == 4:
            print(key_of(load(argv[2]), argv[3]))
        elif command == "row" and len(argv) == 3:
            print(row_status(sys.stdin.read(), argv[2]))
        else:
            print(__doc__, file=sys.stderr)
            return 2
    except (AssertionError, ValueError, KeyError, OSError, sqlite3.Error) as error:
        print(str(error))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
