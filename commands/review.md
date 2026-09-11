---
name: review
description: "Run one independent Auditor review of the current diff. Read-only; reports findings in chat. Does not gate shipping or run checks."
allowed-tools: ["Agent", "Read", "Bash", "Grep", "Glob", "LS", "Skill"]
user-invocable: true
---

# /gorkhali:review

An on-demand second opinion on the current diff, separate from the review step inside `/gorkhali:verify`. Read-only: it never edits code, never runs a fix loop, and never blocks shipping by itself.

## Procedure

1. Resolve the current diff and changed-file list. Read any repository review conventions that apply.
2. Spawn one read-only Auditor over the whole diff. Auditor checks correctness, security, regressions, broken references and contracts, simplification opportunities, and any consumer left calling something the diff removed or renamed.
3. Read Auditor's own fixed record for its verdict (`pass`, `fail`, or `blocked`) and its findings. Never take the verdict from chat alone. If the record is missing, ask Auditor once to resend it before reporting `blocked`.

## Report

In chat, give:

- the verdict;
- each finding, with file, line, and severity (`blocking` or `advisory`);
- for a user-visible change, whether it still needs the user's own confirmation through `/gorkhali:visual`.

A `blocking` finding means the next step is `/gorkhali:fix`. An `advisory` finding is worth knowing and never blocks. This command writes no ship-level gate of its own; `/gorkhali:verify` and `/gorkhali:wrap` own that.
