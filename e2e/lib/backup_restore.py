#!/usr/bin/env python3
"""Filter private snapshots to these synthetic fixtures and portable UI fields only."""
import json
import sys

ORDER = ["shortcuts", "recent", "continue", "discovery"]
SONGS = [
    {"id": "e2e-backup-old", "title": "Z Old Song", "$timestamp": 100, "$sortIndex": 0},
    {"id": "e2e-backup-new", "title": "A New Song", "$timestamp": 200, "$sortIndex": 0},
]


def extract(raw, kind):
    snapshot = json.loads(raw)
    assert snapshot.get("version") == 1 and isinstance(snapshot.get("entries"), dict)
    entries = snapshot["entries"]
    def value(key, default=None):
        entry = entries.get(key)
        return json.loads(entry["v"]) if isinstance(entry, dict) and entry.get("t") == "s" else default
    if kind == "config":
        return {"order": value("theme.homeSectionOrder"), "view": value("library.playlistView"),
                "organization": value("library.playlistOrganization", {})}
    if kind == "index":
        return [{key: row.get(key) for key in ["id", "title", "coverImg", "description", "artist", "createAt"]}
                for row in value("data", []) if row.get("title") in ("E2E Backup Playlist", "E2E Legacy Playlist")]
    if kind == "songs":
        songs = value("data", [])
        assert isinstance(songs, list) and len(songs) == 2
        # Export only the exact synthetic fixture fields, never unrelated songs.
        assert {song.get("id") for song in songs} == {song["id"] for song in SONGS}
        return {"sort": entries.get("meta.sort", {}).get("v"),
                "songs": [{key: song.get(key) for key in SONGS[0]} for song in songs]}
    raise ValueError(kind)


def check(config, sheets, songs, legacy=False):
    assert config["order"] == ORDER and config["view"] == "list", config
    restored = [row for row in sheets if row["title"] == "E2E Backup Playlist"]
    assert len(restored) == 1, sheets
    sheet = restored[0]
    assert sheet["id"] != "e2e-original-backup-id" and sheet["id"] != "favorite"
    assert sheet["description"] == "E2E backup description" and sheet["artist"] == "E2E Backup Artist"
    assert sheet["coverImg"] == "https://example.org/e2e-backup-cover.png" and sheet["createAt"] == 1234
    org = config["organization"]
    assert org["pinnedIds"] == [sheet["id"]] and org["groupBySheetId"] == {sheet["id"]: "E2E Backup Group"}, org
    assert songs == {"sort": "time-rev", "songs": SONGS}, songs
    if legacy:
        restored_legacy = [row for row in sheets if row["title"] == "E2E Legacy Playlist"]
        assert len(restored_legacy) == 1 and restored_legacy[0]["description"] == "E2E legacy description"
    return {"restoredId": sheet["id"], "metadata": True, "remappedGroupsAndPins": True, "legacy": legacy, "order": config["order"],
            "songOrder": [song["id"] for song in songs["songs"]], "addedMetadata": True, "sort": songs["sort"]}


def self_test():
    config = {"order": ORDER, "view": "list", "organization": {"pinnedIds": ["new-id"], "groupBySheetId": {"new-id": "E2E Backup Group"}}}
    sheets = [{"id": "new-id", "title": "E2E Backup Playlist", "description": "E2E backup description", "artist": "E2E Backup Artist", "coverImg": "https://example.org/e2e-backup-cover.png", "createAt": 1234}]
    songs = {"sort": "time-rev", "songs": SONGS}
    check(config, sheets, songs)
    for mutate in [lambda row: row.update(id="e2e-original-backup-id"), lambda row: row.update(description=None), lambda row: row.update(coverImg=None)]:
        bad = [dict(sheets[0])]
        mutate(bad[0])
        try:
            check(config, bad, songs)
        except AssertionError:
            pass
        else:
            raise AssertionError("invalid restore accepted")
    safe = extract(json.dumps({"version": 1, "entries": {"secret": {"t": "s", "v": '"hidden"'}}}), "config")
    assert "hidden" not in json.dumps(safe)
    for bad in [
        {"sort": "time-rev", "songs": list(reversed(SONGS))},
        {"sort": "time-rev", "songs": [dict(SONGS[0], **{"$timestamp": 999}), SONGS[1]]},
        {"sort": "time", "songs": SONGS},
    ]:
        try:
            check(config, sheets, bad)
        except AssertionError:
            pass
        else:
            raise AssertionError("invalid song order or metadata accepted")
    raw = {"version": 1, "entries": {"data": {"t": "s", "v": json.dumps(SONGS)}, "meta.sort": {"t": "s", "v": "time-rev"}}}
    assert extract(json.dumps(raw), "songs") == songs
    print("backup restore checker: 9 cases passed")


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "--self-test":
        self_test()
    elif command == "extract":
        print(json.dumps(extract(sys.stdin.read(), sys.argv[2]), ensure_ascii=False))
    elif command == "check":
        with open(sys.argv[2], encoding="utf-8") as stream:
            config = json.load(stream)
        with open(sys.argv[3], encoding="utf-8") as stream:
            sheets = json.load(stream)
        with open(sys.argv[4], encoding="utf-8") as stream:
            songs = json.load(stream)
        print(json.dumps(check(config, sheets, songs, "--legacy" in sys.argv[5:]), ensure_ascii=False))
    else:
        raise ValueError(command)
