#!/usr/bin/env python3
"""Independently verify a test receiver's URI grant, file bytes, and real pixels."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys


def verify(kind, result):
    if kind == "missing":
        if result != {"success": False, "category": "missing-stream"}:
            raise ValueError("receiver accepted a missing stream")
        return result
    if (result.get("success") is not True or result.get("mime") != "image/png" or
            result.get("scheme") != "content" or result.get("readGrant") is not True or
            not isinstance(result.get("senderUid"), int) or result["senderUid"] <= 0 or
            not isinstance(result.get("receiverUid"), int) or result["receiverUid"] <= 0 or
            result["senderUid"] == result["receiverUid"] or
            result.get("reads") != (1 if kind == "received" else 2) or
            result.get("width") != 1000 or not 600 < result.get("height", 0) <= 2000 or
            not 0 < result.get("bytes", 0) <= 8 * 1024 * 1024 or
            not re.fullmatch(r"[a-f0-9]{64}", result.get("sha256", ""))):
        raise ValueError("missing independent UID, valid URI grant or complete image")
    return result


def image(result, path):
    verify("reread", result)
    data = Path(path).read_bytes()
    if len(data) != result["bytes"] or hashlib.sha256(data).hexdigest() != result["sha256"]:
        raise ValueError("receiver copy differs from the read attachment")
    spec = importlib.util.spec_from_file_location("share_card", Path(__file__).with_name("share_card.py"))
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    pixels = checker.inspect(path)
    if pixels["height"] != result["height"] or pixels["bodyWhitePixels"] < 1000:
        raise ValueError("selected lyrics missing from received image")
    return {"receiver": result, "pixels": pixels}


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        import unittest

        class Checks(unittest.TestCase):
            def setUp(self):
                self.good = dict(success=True, mime="image/png", scheme="content", readGrant=True,
                                 senderUid=10001, receiverUid=10002, reads=2, width=1000,
                                 height=802, bytes=8000, sha256="a" * 64)

            def test_complete_receiver(self):
                verify("reread", self.good)
                verify("received", {**self.good, "reads": 1})
                verify("missing", {"success": False, "category": "missing-stream"})

            def test_bad_reports(self):
                for field, value in [("success", False), ("scheme", "file"), ("mime", "text/plain"),
                                     ("readGrant", False), ("receiverUid", 10001), ("reads", 1),
                                     ("width", 0), ("height", 600), ("bytes", 0), ("sha256", "bad")]:
                    with self.subTest(field=field), self.assertRaises(ValueError):
                        verify("reread", {**self.good, field: value})

            def test_accepted_missing_stream_rejected(self):
                with self.assertRaises(ValueError):
                    verify("missing", self.good)

        unittest.main(argv=[sys.argv[0]])
    else:
        kind, filename = sys.argv[1:3]
        result = json.loads(Path(filename).read_text())
        print(json.dumps(image(result, sys.argv[3]) if kind == "image" else verify(kind, result)))
