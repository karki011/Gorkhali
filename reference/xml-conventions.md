# XML Tag Conventions

Based on Anthropic's production patterns. Hybrid: XML for compartment boundaries, markdown inside.

## Tag Vocabulary

| Tag | Purpose | Example |
|-----|---------|---------|
| `<instructions>` | Core task steps | Wrap the main "what to do" section |
| `<context>` | Background knowledge injected | Wrap learnings, session state |
| `<constraints>` | Hard rules, prohibitions | Iron Laws, non-negotiables |
| `<references>` | Bundled reference docs | Wrap hook-injected content |
| `<examples>` / `<example>` | Few-shot examples | Artifact JSON examples |
| `<output_format>` | Expected output shape | JSON schemas, report templates |
| `<{behavior_name}>` | Self-describing directives | `<no_git_until_wrap>`, `<verify_before_done>` |
| `<ALLCAPS_NAME>` | Safety-critical only | `<NEVER_COMMIT_SECRETS>` |

## Rules

1. **Hybrid pattern**: XML tags define compartments. Markdown headers organize content inside.
2. **Max 5-10 top-level tags per file.** More = over-tagging.
3. **Max 2 nesting levels.** Deeper = diminishing returns.
4. **Self-describing tags** for behavioral rules. Tag name IS the summary.
5. **ALLCAPS reserved** for genuine safety gates. Not routine instructions.
6. **No `antml:` prefix** — reserved by Anthropic, stripped by API.
7. **No XML in frontmatter** — prohibited by skill runtime.

## Pattern: Skill File Structure

```markdown
---
name: team:example
description: "..."
---

<instructions>
## What To Do
1. Step one
2. Step two
</instructions>

<constraints>
- Never do X
- Always do Y before Z
</constraints>

<no_git_until_wrap>
All work is local. Commits only in wrap.
</no_git_until_wrap>

<output_format>
Write artifact to `state/sessions/{TICKET}/example.json`:
{ "_meta": {...}, "result": "..." }
</output_format>
```

## Token Cost

~1 extra token per tag pair vs markdown header. 10 sections = 10 tokens. Negligible at compartment level. Over-tagging at 20+ nested sections wastes 100+ tokens.
