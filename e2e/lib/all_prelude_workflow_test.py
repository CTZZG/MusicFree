#!/usr/bin/env python3
"""Check that the real workflow wires both independently tested starting states."""
from pathlib import Path


def check_workflow(text: str) -> None:
    check = text[text.index("\n    check-version:"):text.index("\n    build-beta:")]
    e2e = text[text.index("\n    e2e:"):]
    assert "resolve_workflow_preludes \"$SELECTED_SUITE\" \"$SELECTED_PRELUDE\"" in check
    assert "e2e_preludes: ${{ steps.e2e_plan.outputs.preludes }}" in check
    assert "needs.check-version.result == 'success'" in e2e
    assert "fail-fast: false" in e2e
    assert "max-parallel: 1" in e2e
    assert "prelude: ${{ fromJSON(needs.check-version.outputs.e2e_preludes) }}" in e2e
    assert "E2E_ALL_PRELUDE: ${{ matrix.prelude }}" in e2e
    assert "format('e2e-results-{0}-{1}', github.run_id, matrix.prelude)" in e2e
    assert "format('e2e-results-{0}', github.run_id)" in e2e
    assert "inputs.e2e_all_prelude != 'both' && hashFiles('e2e-results/summary.md')" in e2e
    assert "uses: reactivecircus/android-emulator-runner@v2" in e2e


workflow = Path(__file__).resolve().parents[2] / ".github/workflows/build-beta.yml"
source = workflow.read_text()
check_workflow(source)
for old, new in [
    ("fail-fast: false", "fail-fast: true"),
    ("max-parallel: 1", "max-parallel: 2"),
    ("E2E_ALL_PRELUDE: ${{ matrix.prelude }}", "E2E_ALL_PRELUDE: both"),
    ("format('e2e-results-{0}-{1}', github.run_id, matrix.prelude)",
     "format('e2e-results-{0}', github.run_id)"),
    ("inputs.e2e_all_prelude != 'both' && hashFiles('e2e-results/summary.md')",
     "hashFiles('e2e-results/summary.md')"),
]:
    assert old in source
    try:
        check_workflow(source.replace(old, new, 1))
    except AssertionError:
        continue
    raise AssertionError(f"workflow accepted weakened prelude wiring: {old}")
print("All-suite workflow wiring and five negative controls passed")
