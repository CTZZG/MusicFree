#!/usr/bin/env bash
# Uses the checked-in AAR unchanged. No Gradle, app dependencies or release keys.
set -euo pipefail
OUT=${1:?usage: build.sh output.apk}
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
TOOLS="$SDK/build-tools/36.0.0"
ANDROID_JAR="$SDK/platforms/android-36/android.jar"
test -f "$ANDROID_JAR"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/assets" "$WORK/jni" "$(dirname "$OUT")"
python3 "$HERE/generate-fixtures.py" "$WORK/assets"
python3 - "$ROOT" "$WORK" <<'PY'
import hashlib,json,pathlib,sys,zipfile
root,work=map(pathlib.Path,sys.argv[1:])
aar=root/'android/app/libs/libmpv-release.aar'
manifest={'aarSha256':hashlib.sha256(aar.read_bytes()).hexdigest(),'payloads':{}}
with zipfile.ZipFile(aar) as z:
    (work/'classes.jar').write_bytes(z.read('classes.jar'))
    for name in z.namelist():
        if name.startswith('jni/x86_64/') and name.endswith('.so'):
            data=z.read(name);dest=work/'jni'/name.replace('jni/','lib/',1)
            dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
            manifest['payloads'][name]=hashlib.sha256(data).hexdigest()
(work/'assets/native-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
STDLIB=${KOTLIN_STDLIB:-$WORK/kotlin-stdlib.jar}
if [ ! -f "$STDLIB" ]; then
    curl --fail --silent --show-error --location \
        https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.jar \
        --output "$STDLIB"
fi
python3 - "$STDLIB" <<'PY'
import hashlib,pathlib,sys
assert hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest() == 'd6f91b7b0f306cca299fec74fb7c34e4874d6f5ec5b925a0b4de21901e119c3f'
PY
# Android's stub LambdaMetafactory has no bootstrap method. Compile Java 8
# lambdas against the JDK API, then let D8 desugar with the actual Android jar.
"${JAVAC:-javac}" -source 8 -target 8 -nowarn -Xlint:-options \
    -classpath "$ANDROID_JAR:$WORK/classes.jar:$STDLIB" -d "$WORK/classes" \
    "$HERE/src/ProbeActivity.java" "$HERE/src/FrameCode.java"
mapfile -t CLASS_FILES < <(find "$WORK/classes" -name '*.class' -print)
"$TOOLS/d8" --min-api 34 --lib "$ANDROID_JAR" --output "$WORK/dex" \
    "${CLASS_FILES[@]}" "$WORK/classes.jar" "$STDLIB"
"$TOOLS/aapt2" link -o "$WORK/unsigned.apk" -I "$ANDROID_JAR" \
    --manifest "$HERE/AndroidManifest.xml" -A "$WORK/assets" \
    --min-sdk-version 34 --target-sdk-version 34 --version-code 1 --version-name 1.0
(cd "$WORK/dex" && zip -q "$WORK/unsigned.apk" classes.dex)
(cd "$WORK/jni" && zip -q -r "$WORK/unsigned.apk" lib)
"$TOOLS/zipalign" -f -p 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
keytool -genkeypair -keystore "$WORK/test.keystore" -storepass mv-probe-test -keypass mv-probe-test \
    -alias test -keyalg RSA -keysize 2048 -validity 30 -dname 'CN=MusicFree MV P0 Test' >/dev/null 2>&1
"$TOOLS/apksigner" sign --ks "$WORK/test.keystore" --ks-pass pass:mv-probe-test \
    --out "$OUT" "$WORK/aligned.apk"
"$TOOLS/apksigner" verify "$OUT"
cp "$WORK/assets/native-manifest.json" "${OUT%.apk}-native.json"
cp "$WORK/assets/fixture-manifest.json" "${OUT%.apk}-fixtures.json"
