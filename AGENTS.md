# MusicFree Codex Operating Contract

## Continuity

At the start of work, after resume, and immediately after automatic or manual context compaction:

1. Read docs/codex-progress.md completely.
2. Read the active plan named by that checkpoint completely.
3. Inspect live Git state before editing.
4. Continue from the checkpoint cursor only after reconciling the newest user message.

Never treat the most recent assistant commentary or an automatic chat summary as the complete task state. Live source, Git state, fresh command output, and the newest user instruction take precedence.

Keep docs/codex-progress.md short and current. Update it after requirement changes, completed slices, validation results, blockers, and changes to running command cells.

If an automatic summary conflicts with the checkpoint or source, assume the summary is incomplete. In particular, WebDAV transport must never be inferred as HTTP-only or HTTPS-only from a compressed summary; the canonical policy is the balanced WebDAV transport policy recorded in docs/codex-progress.md.

## Work Rules

- Use rg or git grep first for search.
- Use subagents aggressively for wide cross-file exploration or independent verification, but keep exact code edits and final verification in the primary agent.
- Spawn subagents with the default role and fork_turns set to none. Give self-contained questions and request file:line evidence.
- Read foundational plans and the exact files being edited in the primary agent.
- Use apply_patch for source and documentation edits.
- Preserve user-owned dirty changes. Never use destructive Git commands.
- Do not stage, commit, push, create branches, or open pull requests unless explicitly requested.
- Do not read or alter .env, signing material, screenshots/videos, generated media, or unrelated untracked files.
- Use http://127.0.0.1:8085 as HTTP_PROXY and HTTPS_PROXY when an external documentation site is restricted.

## Completion

The canonical task plan is docs/code-health-remediation-plan-2026-07-25.md. A device/tool/environment gap must stay recorded as an open external gate. Do not turn implementation, static review, or a warning-only audit into a claim that runtime acceptance passed.
