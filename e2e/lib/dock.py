#!/usr/bin/env python3
"""检查主页上的迷你播放器有没有盖住底部标签栏。

  maestro hierarchy --compact | dock.py
      迷你播放器在标签栏上方才返回 0，打印两者的位置；盖住了、或者找不到标签栏，
      打印原因并返回 1

迷你播放器的读屏标签是“歌曲: <歌名> 歌手: <歌手>”，标签栏是“首页、搜索、资料库、设置”
四个按钮。读屏树里被盖住的元素也在，所以比的是两者在屏幕上的位置（包含动画位移）。

  dock.py --self-test
"""
import re
import sys

TAB_LABELS = ("首页", "搜索", "资料库", "设置")
MINI_PLAYER = re.compile(r"^歌曲: .+ 歌手: ")
A11Y_TEXT = re.compile(r"accessibilityText=([^;\"]*)")
BOUNDS = re.compile(r"bounds=\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
# 位置换算会有一两个像素的误差
TOLERANCE_PX = 2


def find_elements(text):
    mini, tabs = None, []
    for line in text.splitlines():
        label = A11Y_TEXT.search(line)
        bounds = BOUNDS.search(line)
        if not label or not bounds or "clickable=true" not in line:
            continue
        name = label.group(1).strip()
        box = tuple(int(value) for value in bounds.groups())
        if MINI_PLAYER.search(name) and mini is None:
            mini = box
        elif name in TAB_LABELS:
            tabs.append(box)
    return mini, tabs


def check(text):
    """返回 (是否正常, 说明)"""
    mini, tabs = find_elements(text)
    if not tabs:
        return False, "找不到底部标签栏"
    tabs_top = min(box[1] for box in tabs)
    tabs_bottom = max(box[3] for box in tabs)
    if mini is None:
        return False, f"找不到迷你播放器（标签栏 y={tabs_top}–{tabs_bottom}）"
    if mini[3] > tabs_top + TOLERANCE_PX:
        return False, f"迷你播放器 y={mini[1]}–{mini[3]} 盖住了标签栏 y={tabs_top}–{tabs_bottom}"
    return True, f"迷你播放器 y={mini[1]}–{mini[3]}，标签栏 y={tabs_top}–{tabs_bottom}"


SAMPLE_OK = """238,12,"accessibilityText=歌曲: E2E Tone A 歌手: E2E Artist; clickable=true; bounds=[32,1981][776,2138]; enabled=true; class=android.widget.Button",239
211,18,"accessibilityText=首页; clickable=true; bounds=[58,2175][291,2301]; enabled=true; class=android.view.View",210
215,19,"text=首页; bounds=[145,2254][203,2291]; enabled=true; class=android.widget.TextView",211
216,18,"accessibilityText=搜索; clickable=true; bounds=[302,2175][535,2301]; enabled=true; selected=true; class=android.view.View",210
221,18,"accessibilityText=资料库; clickable=true; bounds=[545,2175][779,2301]; enabled=true; class=android.view.View",210
226,18,"accessibilityText=设置; clickable=true; bounds=[789,2175][1022,2301]; enabled=true; class=android.view.View",210
"""


def self_test():
    ok, detail = check(SAMPLE_OK)
    assert ok, detail
    assert detail == "迷你播放器 y=1981–2138，标签栏 y=2175–2301", detail

    covered = SAMPLE_OK.replace("bounds=[32,1981][776,2138]", "bounds=[32,2160][776,2317]")
    ok, detail = check(covered)
    assert not ok and "盖住了标签栏" in detail, detail

    no_tabs = "\n".join(line for line in SAMPLE_OK.splitlines() if "歌曲" in line)
    ok, detail = check(no_tabs)
    assert not ok and detail == "找不到底部标签栏", detail

    no_player = "\n".join(line for line in SAMPLE_OK.splitlines() if "歌曲" not in line)
    ok, detail = check(no_player)
    assert not ok and "找不到迷你播放器" in detail, detail
    print("dock.py self-test ok")


def main(argv):
    if argv[1:2] == ["--self-test"]:
        self_test()
        return 0
    ok, detail = check(sys.stdin.read())
    print(detail)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
