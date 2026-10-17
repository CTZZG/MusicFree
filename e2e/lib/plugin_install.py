#!/usr/bin/env python3
"""Verify mounted fixture plugins from the app's persisted cache, not a dismissed dialog."""
import copy
import hashlib
import json
from pathlib import Path
import re
import runpy
import subprocess
import sys

decode = runpy.run_path(str(Path(__file__).with_name("kvstore.py")))["decode"]


def ready(cache_text, meta_text, name, expected_hash):
    cache, meta = decode(cache_text), decode(meta_text)
    plugins = []
    for key, value in cache.items():
        if not key.endswith(".js") or value["t"] != "s":
            continue
        plugin = json.loads(value["v"])
        if not isinstance(plugin, dict):
            raise ValueError("plugin cache entry is not an object")
        if plugin.get("name") == name:
            plugins.append((key, plugin))
    if len(plugins) != 1:
        raise ValueError(f"expected one mounted {name}, found {len(plugins)}")
    key, plugin = plugins[0]
    instance = plugin.get("instance", {})
    if not isinstance(instance, dict) or plugin.get("path") != key or instance.get("platform") != name:
        raise ValueError("mounted fixture identity/path mismatch")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_hash) or plugin.get("hash") != expected_hash:
        raise ValueError("mounted fixture does not match the pinned source bytes")
    methods, types = plugin.get("supportedMethods"), instance.get("supportedSearchType")
    if not isinstance(methods, list) or "search" not in methods or not isinstance(types, list) or "music" not in types:
        raise ValueError("mounted fixture cannot search music")
    disabled_entry = meta.get("disabledPlugins", {"t": "s", "v": "[]"})
    if disabled_entry["t"] != "s":
        raise ValueError("disabledPlugins is not a string entry")
    disabled = json.loads(disabled_entry["v"])
    if not isinstance(disabled, list) or any(not isinstance(x, str) for x in disabled):
        raise ValueError("disabledPlugins is not a list of names")
    if name in disabled:
        raise ValueError("mounted fixture is disabled")
    return {"name": name, "hash": expected_hash, "registered": True, "enabled": True, "searchMusic": True}


def install_errors(text):
    entries = decode(text)
    events = json.loads(entries.get("events", {"v": "[]"})["v"])
    if not isinstance(events, list):
        raise ValueError("diagnostic events are not a list")
    result = []
    for event in events:
        if isinstance(event, dict) and str(event.get("method", "")).startswith("install"):
            row = {key: event.get(key) for key in ("method", "pluginName", "message", "createdAt", "severity")}
            # Store only installation diagnostics, never the plugin-cache snapshot or URLs.
            for key, value in row.items():
                if isinstance(value, str):
                    row[key] = re.sub(r"https?://\S+", "<remote-url>", value)
            result.append(row)
    return result[-20:]


def self_test():
    root = Path(__file__).resolve().parents[2]
    assert 'getOrCreateMMKV("plugin.cache")' in (root / "src/core/pluginManager/index.ts").read_text()
    assert 'getOrCreateMMKV("plugin-meta")' in (root / "src/core/pluginManager/meta.ts").read_text()
    name, digest = "E2E 测试源 A", "a" * 64
    key = "/data/user/0/test/plugins/a.js"
    plugin = {"name": name, "path": key, "hash": digest,
              "instance": {"platform": name, "supportedSearchType": ["music"]}, "supportedMethods": ["search"]}
    def cache(p=plugin):
        return json.dumps({"version": 1, "entries": {key: {"t": "s", "v": json.dumps(p)}}})
    def meta(disabled=None):
        return json.dumps({"version": 1, "entries": {"disabledPlugins": {"t": "s", "v": json.dumps(disabled or [])}}})
    assert ready(cache(), meta(), name, digest)["enabled"]
    bad = [("", meta()), ('{"version":1,"entries":{}}', meta()), (cache(), meta([name]))]
    for field, value in [("name", "other"), ("hash", "b" * 64), ("path", "/wrong.js"),
                         ("supportedMethods", []), ("supportedMethods", "search"),
                         ("instance", {"platform": name, "supportedSearchType": ["album"]}),
                         ("instance", {"platform": name, "supportedSearchType": "music"})]:
        changed = copy.deepcopy(plugin)
        changed[field] = value
        bad.append((cache(changed), meta()))
    for c, m in bad:
        try:
            ready(c, m, name, digest)
        except (ValueError, KeyError, TypeError):
            continue
        raise AssertionError("accepted absent/wrong/disabled fixture")
    events = {"version": 1, "entries": {"events": {"t": "s", "v": json.dumps([
        {"method": "search", "message": "unrelated"},
        {"method": "install:network", "message": "failed https://example.com/?token=private"},
    ])}}}
    errors = install_errors(json.dumps(events))
    assert len(errors) == 1 and "private" not in errors[0]["message"]
    print(f"plugin-install evidence self-test: {len(bad) + 2} checks passed")


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["--self-test"]:
            self_test()
        elif sys.argv[1] == "hash":
            code = subprocess.check_output(["git", "-C", sys.argv[2], "show", f"{sys.argv[3]}:e2e/plugins/{sys.argv[4]}"])
            print(hashlib.sha256(code).hexdigest())
        elif sys.argv[1] == "ready":
            print(json.dumps(ready(Path(sys.argv[2]).read_text(), Path(sys.argv[3]).read_text(), sys.argv[4], sys.argv[5]), ensure_ascii=False))
        elif sys.argv[1] == "errors":
            print(json.dumps(install_errors(sys.stdin.read()), ensure_ascii=False))
        else:
            raise ValueError("unknown plugin-install command")
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
