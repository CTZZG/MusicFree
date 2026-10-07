#!/usr/bin/env bash
# 生成模拟器测试用的几段纯音（提交在仓库里，测试插件从 raw.githubusercontent.com 读取）。
# 需要 ffmpeg（带 libmp3lame）。改了这里要重新生成并提交这些 mp3。
set -euo pipefail
cd "$(dirname "$0")"
tone() { # 文件名 频率 秒数
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "sine=frequency=$2:sample_rate=16000:duration=$3" \
        -ac 1 -c:a libmp3lame -b:a 16k "$1"
}
# 主流程里的几首要够长：整套检查要两三分钟，歌中途播完自己切走会干扰判断
tone tone-a.mp3 440 180
tone tone-b.mp3 554 180
tone tone-c.mp3 659 180
# 20 秒就播完，用来检查在后台播完后自动接下一首（Maestro 点完歌退出要好几秒，太短会错过）
tone short.mp3 330 20
