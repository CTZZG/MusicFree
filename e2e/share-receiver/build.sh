#!/usr/bin/env bash
# Build a test-only, separate-UID ACTION_SEND receiver using the SDK, with a disposable public test key.
set -euo pipefail

OUT=${1:?用法：e2e/share-receiver/build.sh <输出的 APK 路径>}
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
"$BUILD_TOOLS/d8" --min-api 34 --lib "$ANDROID_JAR" --output "$WORK/dex" \
    $(find "$WORK/classes" -name '*.class')
"$BUILD_TOOLS/aapt2" link -o "$WORK/unsigned.apk" -I "$ANDROID_JAR" \
    --manifest "$HERE/AndroidManifest.xml" \
    --min-sdk-version 34 --target-sdk-version 34 \
    --version-code 1 --version-name 1.0
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
keytool -genkeypair -keystore "$WORK/e2e.keystore" -storepass e2e-share -keypass e2e-share \
    -alias e2e -keyalg RSA -keysize 2048 -validity 30 -dname "CN=MusicFree E2E" > /dev/null 2>&1
"$BUILD_TOOLS/apksigner" sign --ks "$WORK/e2e.keystore" --ks-pass pass:e2e-share \
    --key-pass pass:e2e-share --out "$OUT" "$WORK/aligned.apk"
"$BUILD_TOOLS/apksigner" verify "$OUT"
echo "已打出 $OUT"
