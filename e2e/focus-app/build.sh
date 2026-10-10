#!/usr/bin/env bash
# 不用 Gradle，直接用 Android SDK 的命令行工具打出“视频”替身 APK（见 HoldFocusActivity）。
#
#   e2e/focus-app/build.sh <输出的 APK 路径>
#
# 需要 ANDROID_HOME（或 ANDROID_SDK_ROOT）里装了 build-tools 和至少一个 platform，以及 JDK 17。
set -euo pipefail

OUT=${1:?用法：e2e/focus-app/build.sh <输出的 APK 路径>}
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
    echo "找不到 Android SDK（ANDROID_HOME / ANDROID_SDK_ROOT）" >&2
    exit 1
fi
BUILD_TOOLS=$(ls -d "$SDK"/build-tools/* | sort -V | tail -n 1)
PLATFORM=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -n 1)
ANDROID_JAR="$PLATFORM/android.jar"
echo "build-tools: $BUILD_TOOLS"
echo "platform: $PLATFORM"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/classes" "$WORK/dex"

javac -source 8 -target 8 -nowarn -Xlint:-options \
    -bootclasspath "$ANDROID_JAR" \
    -d "$WORK/classes" \
    $(find "$HERE/src" -name '*.java')
"$BUILD_TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$WORK/dex" \
    $(find "$WORK/classes" -name '*.class')
"$BUILD_TOOLS/aapt2" link -o "$WORK/unsigned.apk" -I "$ANDROID_JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    --min-sdk-version 26 --target-sdk-version 34 \
    --version-code 1 --version-name 1.0
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
keytool -genkeypair -keystore "$WORK/e2e.keystore" -storepass e2e-focus -keypass e2e-focus \
    -alias e2e -keyalg RSA -keysize 2048 -validity 30 -dname "CN=MusicFree E2E" > /dev/null 2>&1
"$BUILD_TOOLS/apksigner" sign --ks "$WORK/e2e.keystore" --ks-pass pass:e2e-focus \
    --key-pass pass:e2e-focus --out "$OUT" "$WORK/aligned.apk"
"$BUILD_TOOLS/apksigner" verify "$OUT"
echo "已打出 $OUT"
