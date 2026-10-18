#!/usr/bin/env bash
# 同一宿主、同一个运行中的模拟器，按旧/新/旧测冷启动。只复用已构建的 APK。
# 每组清除应用数据、走真实首页和插件前提，仍预热1次+记录10次；不设速度通过线。
set -uo pipefail
BASELINE=${1:?baseline APK}
CANDIDATE=${2:?candidate APK}
REF=${3:?script commit}
OUT=${4:?output directory}
HERE="$(cd "$(dirname "$0")" && pwd)"
PKG=fun.upup.musicfree
mkdir -p "$OUT"
if [ ! -s "$BASELINE" ] || [ ! -s "$CANDIDATE" ] || cmp -s "$BASELINE" "$CANDIDATE"; then
    echo 'Comparison needs two nonempty, different APKs.' >&2
    exit 1
fi
sha256sum "$BASELINE" "$CANDIDATE" > "$OUT/compare-apks.sha256" || exit 1
lscpu > "$OUT/compare-host-cpu.txt"
adb shell getprop > "$OUT/compare-device.txt"
status=0
for variant in baseline-before candidate baseline-after; do
    apk=$BASELINE
    source_commit=${E2E_PERF_BASELINE_COMMIT:-unknown}
    if [ "$variant" = candidate ]; then
        apk=$CANDIDATE
        source_commit=${E2E_APK_COMMIT:-unknown}
    fi
    # 每组从相同的首次启动条件准备；不复用前一组的配置、插件或 ART profile。
    if ! adb shell pm list packages "$PKG" > "$OUT/packages-$variant.txt" 2>&1; then
        status=1
        break
    fi
    if tr -d '\r' < "$OUT/packages-$variant.txt" | grep -qx "package:$PKG"; then
        if ! adb uninstall "$PKG" > "$OUT/uninstall-$variant.txt" 2>&1; then
            status=1
            break
        fi
    fi
    E2E_SUITE=perf E2E_PERF_COLD_ONLY=1 E2E_PERF_RUNS=10 E2E_APK_COMMIT="$source_commit" \
        E2E_APK_SOURCE="same-device A/B/A: $variant; $(basename "$apk")" \
        bash "$HERE/run.sh" "$apk" "$REF" "$OUT/$variant" || { status=1; break; }
done

# 即使中途失败也保留已完成组的结果；缺组/缺样本必须失败，不能拿较快的一组充完整对照。
python3 -I - "$OUT" "$status" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
failed = int(sys.argv[2]) != 0
rows, metrics = [], {}
for variant in ('baseline-before', 'candidate', 'baseline-after'):
    directory = root / variant
    results = directory / 'results.tsv'
    if results.exists():
        for line in results.read_text().splitlines():
            fields = line.split('\t') if '\t' in line else line.split('\\t')
            if len(fields) < 2:
                failed = True
                continue
            rows.append([fields[0], variant + ': ' + fields[1], fields[2] if len(fields) > 2 else ''])
            failed |= fields[0] != 'PASS'
    try:
        raw = [json.loads(line) for line in (directory / 'perf.jsonl').read_text().splitlines() if line.strip()]
        summary = json.loads((directory / 'perf-summary.json').read_text())
        assert len(raw) == 11 and all(row['phase'] == 'cold' for row in raw)
        assert sorted(row['run'] for row in raw) == list(range(11))
        assert all(row['warmup'] is (row['run'] == 0) for row in raw)
        assert summary and all(value['n'] == 10 for value in summary.values())
        metrics[variant] = summary['cold_home_drawn_ms']
    except (AssertionError, OSError, ValueError, KeyError, TypeError):
        rows.append(['FAIL', variant + ': 冷启动对照完整性', '需要预热1+有效10次，包含主页首帧指标'])
        failed = True
if len({row[1] for row in rows}) != len(rows):
    failed = True
if failed and all(row[0] == 'PASS' for row in rows):
    rows.append(['FAIL', '冷启动对照准备', '至少一组未完成，见原始启动/卸载记录'])
(root / 'results.tsv').write_text(''.join('\t'.join(row) + '\n' for row in rows))
(root / 'compare-summary.json').write_text(json.dumps({'passed': not failed, 'metrics': metrics}, indent=2))
with (root / 'summary.md').open('w') as out:
    out.write('## 同机冷启动对照（旧 / 新 / 旧）\n\n每组预热1次+记录10次，重新安装并准备同样的插件；只记录，不设速度门限。\n\n')
    out.write('| 组 | 主页首帧中位数(ms) | P95(ms) |\n|---|---:|---:|\n')
    for variant, value in metrics.items():
        out.write(f"| {variant} | {value['median']} | {value['p95']} |\n")
    out.write(f"\n完成检查：{sum(row[0] == 'PASS' for row in rows)} PASS / {sum(row[0] != 'PASS' for row in rows)} FAIL。\n")
sys.exit(1 if failed else 0)
PY
