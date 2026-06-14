---
name: phantom:loop
description: "Portable entry that runs one /phantom:queue pass and tells you how to keep looping. One invocation = one pass — it never self-launches /loop. Alias: /phantom:q."
argument-hint: "[--status]"
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS"]
---

> **Preamble Tier: T2** — loads `_shared.md` + `_shared-repo-detection.md`

# /phantom:loop

1. Invoke `/phantom:queue` for ONE pass — reuse it, do not reimplement gates/poll/dedup/spawn/reap. Pass `--status` through if present.
2. After the pass, print ONE line: that it ran one pass, and how to keep looping —

   > Ran one pass. To keep looping: `/loop /phantom:loop`. This never self-launches `/loop`.

`/phantom:q` is the alias of this skill — identical behavior.
