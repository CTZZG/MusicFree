#!/usr/bin/env bash
# 编出 mmkv-seed（往旧版 MMKV 存储里写测试数据的小工具，见 seed.cpp）：
#
#   e2e/mmkv-seed/build.sh <输出的可执行文件>
#
# 取 Tencent/MMKV 的 v2.4.0（0.7.3 和现在的应用用的都是这个版本的核心），按提交号核对，
# 再用 cmake 编。需要 git、cmake、C++20 编译器。
set -euo pipefail

OUT=${1:?用法：e2e/mmkv-seed/build.sh <输出文件>}
HERE="$(cd "$(dirname "$0")" && pwd)"
MMKV_TAG=v2.4.0
MMKV_COMMIT=23d652c17e8c2023bb50f1c92e862a2304eaa2a2

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git -c advice.detachedHead=false clone -q --depth 1 --branch "$MMKV_TAG" \
    https://github.com/Tencent/MMKV.git "$WORK/mmkv"
actual=$(git -C "$WORK/mmkv" rev-parse HEAD)
if [ "$actual" != "$MMKV_COMMIT" ]; then
    echo "MMKV $MMKV_TAG 的提交号不对：$actual（应为 $MMKV_COMMIT）" >&2
    exit 1
fi

cmake -S "$HERE" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release \
    -DMMKV_SOURCE_DIR="$WORK/mmkv" > "$WORK/cmake.log" || { cat "$WORK/cmake.log" >&2; exit 1; }
cmake --build "$WORK/build" --target mmkv-seed -j "$(nproc)" > "$WORK/build.log" 2>&1 ||
    { tail -n 40 "$WORK/build.log" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
cp "$WORK/build/mmkv-seed" "$OUT"
echo "mmkv-seed：$OUT（MMKV $MMKV_TAG $MMKV_COMMIT）"
