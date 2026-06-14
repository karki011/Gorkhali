# Phantom Evals

Test cases verifying that each Phantom triggers correctly and produces expected behavior.

## Structure

```
evals/
  evals.json   — all test cases (30 total, 3 per skill × 10 skills)
  README.md    — this file
```

## Schema

Each eval entry:

| Field | Description |
|---|---|
| `id` | Unique integer |
| `skill` | Skill name (e.g., `phantom:start`) |
| `prompt` | Realistic user message |
| `should_trigger` | `true` = skill should activate, `false` = near-miss |
| `expected_behavior` | What the skill should do when triggered |

## Coverage

| Skill | IDs | Trigger | No-Trigger |
|---|---|---|---|
| `phantom:start` | 1–3 | 1, 2 | 3 |
| `phantom:verify` | 4–6 | 4, 5 | 6 |
| `phantom:fix` | 7–9 | 7, 8 | 9 |
| `phantom:review` | 10–12 | 10, 11 | 12 |
| `phantom:hound` | 13–15 | 13, 14 | 15 |
| `phantom:wrap` | 16–18 | 16, 17 | 18 |
| `phantom:scout` | 19–21 | 19, 20 | 21 |
| `phantom:recruit` | 22–24 | 22, 23 | 24 |
| `phantom:pause` | 25–27 | 25, 26 | 27 |
| `phantom:resume` | 28–30 | 28, 29 | 30 |

## How to Run

### Manual eval (per Anthropic guidelines)

Send each prompt to Claude Code and verify:
1. The correct skill triggers (check skill name in response)
2. The behavior matches `expected_behavior`
3. Near-miss prompts route to a different skill (not the tested one)

### Automated eval script (future)

```bash
# Example structure — adapt to your eval runner
jq -c '.evals[]' evals.json | while read eval; do
  skill=$(echo $eval | jq -r '.skill')
  prompt=$(echo $eval | jq -r '.prompt')
  should=$(echo $eval | jq -r '.should_trigger')
  echo "Testing $skill (should_trigger=$should): $prompt"
  # Run your eval harness here
done
```

## Design Principles

**Realistic prompts**: Evals use natural, varied phrasing — casual AND formal — not synthetic test strings. Per Anthropic guidelines, prompts reflect how real users actually talk.

**Near-miss discipline**: Each skill has one near-miss (`should_trigger: false`) that shares surface keywords but needs a *different* skill. This prevents false positive triggers.

**Consistent domain**: All prompts use a coherent fictional feature (multi-currency support, CP-4521) so context flows naturally across test cases.

## Adding New Evals

1. Read the target skill's command file in `${CLAUDE_PLUGIN_ROOT}/commands/`
2. Note the `description` field — that's what the skill router uses for matching
3. Write 2 trigger prompts (one casual, one formal) and 1 near-miss
4. Add to `evals.json` with the next available `id`
5. Ensure `expected_behavior` references specific steps from the skill's implementation
