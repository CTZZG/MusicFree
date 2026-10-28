#!/usr/bin/env python3
"""Filter private snapshots to these synthetic fixtures and portable UI fields only."""
import json
import sys

ORDER = ["shortcuts", "recent", "continue", "discovery"]


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
    raise ValueError(kind)


def check(config, sheets, legacy=False):
    assert config["order"] == ORDER and config["view"] == "list", config
    restored = [row for row in sheets if row["title"] == "E2E Backup Playlist"]
    assert len(restored) == 1, sheets
    sheet = restored[0]
    assert sheet["id"] != "e2e-original-backup-id" and sheet["id"] != "favorite"
    assert sheet["description"] == "E2E backup description" and sheet["artist"] == "E2E Backup Artist"
    assert sheet["coverImg"] == "https://example.org/e2e-backup-cover.png" and sheet["createAt"] == 1234
    org = config["organization"]
    assert org["pinnedIds"] == [sheet["id"]] and org["groupBySheetId"] == {sheet["id"]: "E2E Backup Group"}, org
    if legacy:
        restored_legacy = [row for row in sheets if row["title"] == "E2E Legacy Playlist"]
        assert len(restored_legacy) == 1 and restored_legacy[0]["description"] == "E2E legacy description"
    return {"restoredId": sheet["id"], "metadata": True, "remappedGroupsAndPins": True, "legacy": legacy, "order": config["order"]}


def self_test():
    config = {"order": ORDER, "view": "list", "organization": {"pinnedIds": ["new-id"], "groupBySheetId": {"new-id": "E2E Backup Group"}}}
    sheets = [{"id": "new-id", "title": "E2E Backup Playlist", "description": "E2E backup description", "artist": "E2E Backup Artist", "coverImg": "https://example.org/e2e-backup-cover.png", "createAt": 1234}]
    check(config, sheets)
    for mutate in [lambda row: row.update(id="e2e-original-backup-id"), lambda row: row.update(description=None), lambda row: row.update(coverImg=None)]:
        bad = [dict(sheets[0])]
        mutate(bad[0])
        try:
            check(config, bad)
        except AssertionError:
            pass
        else:
            raise AssertionError("invalid restore accepted")
    safe = extract(json.dumps({"version": 1, "entries": {"secret": {"t": "s", "v": '"hidden"'}}}), "config")
    assert "hidden" not in json.dumps(safe)
    print("backup restore checker: 5 cases passed")


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
        print(json.dumps(check(config, sheets, "--legacy" in sys.argv[4:]), ensure_ascii=False))
    else:
        raise ValueError(command)
