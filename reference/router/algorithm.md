# Classification Algorithm

```
1. Hard overrides (skip scoring):
   - user_explicit_route -> use it ("just do it" = DIRECT, "let's brainstorm" = BRAINSTORM)
   - security_sensitive -> FULL
   - schema_migration -> FULL

2. Compute uncertainty (0.0 = certain, 1.0 = ambiguous):
   uncertainty = weighted_sum([
     (domain_novelty,              0.30),
     (ambiguity_markers,           0.25),
     (competing_patterns,          0.20),
     (missing_acceptance_criteria, 0.25),
   ])

3. Compute scope (0.0 = trivial, 1.0 = massive):
   scope = weighted_sum([
     (normalize(file_count, 1, 20),  0.40),
     (normalize(package_span, 1, 5), 0.30),
     (layer_span > 1 ? 1.0 : 0.0,   0.30),
   ])

4. Apply learnings correction:
   correction = lookup routing-history in learnings/shadows.md
   adjusted_uncertainty = uncertainty * (1 + correction.bias)  // bias: -0.3 to +0.3
   (correction.bias is maintained by `node scripts/route-bias.js` - dry-run first,
   measured from per-route outcomes; it refuses below the minimum sample)

5. Route selection:
   adjusted_uncertainty < 0.15 AND scope < 0.2 AND file_count <= 2
     AND no bug/defect keywords                  -> LITE
   adjusted_uncertainty < 0.2 AND scope < 0.3  -> DIRECT
   adjusted_uncertainty < 0.4 AND scope < 0.6  -> PLAN
   adjusted_uncertainty >= 0.4 AND scope < 0.6 -> BRAINSTORM
   scope >= 0.6                                -> FULL
   else                                        -> BRAINSTORM (default: more ceremony when uncertain)

   LITE sits BELOW DIRECT and never escapes the safety floors: bug/defect
   keywords trigger the defect-proof gate (never LITE), and the hard overrides
   above (security_sensitive, schema_migration) still force FULL.
```
