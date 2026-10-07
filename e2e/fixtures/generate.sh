#!/usr/bin/env bash
# 生成模拟器测试用的几段纯音（提交在仓库里，测试插件从 raw.githubusercontent.com 读取）。
# 需要 ffmpeg（带 libmp3lame）。改了这里要重新生成并提交这些 mp3。
set -euo pipefail
cd "$(dirname "$0")"
tone() { # 文件名 频率 秒数
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "sine=frequency=$2:sample_rate=22050:duration=$3" \
        -ac 1 -c:a libmp3lame -b:a 32k "$1"
}
tone tone-a.mp3 440 30
tone tone-b.mp3 554 30
tone tone-c.mp3 659 30
tone short.mp3 330 6
