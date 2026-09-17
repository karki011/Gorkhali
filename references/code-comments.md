# No code comments, in every mode

Do not add explanatory code comments. This is a global engineering rule for all
Gorkhali work: autonomous tasks, manually approved tasks, large changes, tests,
refactors, repairs, and PR-feedback fixes. It does not depend on the 300-line limit.

Write clear names, small functions, and explicit control flow instead of comments,
including docblocks that merely explain implementation. Record design rationale
in the PR or appropriate documentation. Test code follows the same rule.

Keep legally required license/attribution notices and machine-consumed directives
when required, such as a shebang, build tag, or justified tool suppression. These
are narrow exceptions, not a place to hide explanations. Do not sweep unrelated
existing comments away. Preserve existing public contracts and resolve conflicting
documentation requirements rather than silently deleting them.

Inspector checks the current diff for added comments on every verification,
including after ship. Auditor independently reviews the policy when it runs.
Both report added explanatory comments as blocking and record
`comments:{addedExplanatory:0,exceptions:[]}` for a pass. Each exception names
`file`, `kind` (`license` or `tool-directive`), and a concrete `reason`. A passing
record without this evidence is rejected. Human approval does not waive this rule.
