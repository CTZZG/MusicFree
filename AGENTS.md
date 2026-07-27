# MusicFree Codex Operating Contract

## Continuity

At the start of work, after resume, and immediately after automatic or manual context compaction:

1. Inspect live Git state before editing.
2. Reconcile the newest user message with live source and fresh command output.
3. Read any task-specific tracked document named by the user; local ignored
   planning or handoff files are optional and may not exist in a clean clone.
4. Check for running command cells before starting duplicate work.

Never treat the most recent assistant commentary or an automatic chat summary as the complete task state. Live source, Git state, fresh command output, and the newest user instruction take precedence.

If an automatic summary conflicts with source or current Git state, assume the
summary is incomplete. In particular, do not infer an HTTP-only or HTTPS-only
WebDAV policy from compressed context; verify the live implementation and
tests before changing transport behavior.

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

Run validation proportionate to the change. A device/tool/environment gap must
stay recorded as an open external gate; do not turn implementation, static
review, or a warning-only audit into a claim that runtime acceptance passed.
