# Phantom workflow

Use the portable Phantom skills under `skills/`. The public actions compile to
one provider-neutral workflow contract; there is no separate command or agent
prompt layer.

## Responsibilities

Phantom may assign bounded role passes such as planning, implementation,
verification, review, investigation, or visual inspection. Roles are
responsibilities in the workflow graph, not checked-in agent definitions.
Delegation is conditional: use it only when work is independently sizeable and
parallelizable, and keep the active agent for work that fits in a handful of
tool calls.

Compute profiles are defined by
`skills/phantom/references/model-policy.json` and resolved through
`skills/phantom/references/model-presets.json`. Do not hard-code a provider
model outside that controlled adapter registry.

## Usage

Invoke the installed `phantom:start` skill with a ticket or task description.
Implementation and draft-PR shipping require separate authorization.
