# Proof-Check Lean Differential Roadmap

## Scope

W8-06a is a roadmap only. It does not implement a TypeScript-to-Lean runner and
does not add a release dependency. The existing local Lean wrapper is
`scripts/verify-lean.ts`; proof-check coverage status belongs in
`proof-model/COVERAGE.md` when W8-03b expands it.

## Exchange Schema

Judgment instances should be exported as deterministic JSON:

```json
{
  "domain": "sessions",
  "judgment": "open-obligation",
  "facts": []
}
```

The full schema should include:

| Field         | Meaning                                                         |
| ------------- | --------------------------------------------------------------- |
| `domain`      | proof-check domain file, for example `sessions` or `validation` |
| `judgment`    | named checker judgment exported by the TS domain                |
| `facts`       | sorted input fact records with stable subject keys              |
| `context`     | resource limits, target fingerprints, and trusted contract IDs  |
| `tsVerdict`   | accepted/rejected plus stable diagnostics from TypeScript       |
| `leanVerdict` | accepted/rejected plus modeled counterexample or theorem name   |

## First Lane

The first lane should be a sessions-domain verdict differential because session
obligations are proof-relevant but narrow enough to model. Inputs come from
committed proof-check fixtures and generated must-reject cases. Outputs are a
JSONL corpus, a TS verdict file, and a Lean verdict file compared by a local
script.

## Risks

- The Lean model may cover fewer facts than the TS checker.
- TS and Lean may name equivalent facts differently unless the schema owns
  canonical subject keys.
- Resource-limit behavior must be modeled explicitly or excluded from the first
  lane.
- Licensing for any imported formal model must be checked before vendoring.

## Owner And Dependency

Owner boundary: proof-check maintainers own TS judgment export and diagnostics;
proof-model maintainers own Lean executable verdicts. No release checklist item
depends on this roadmap until a later task adds a bounded local script and a
coverage audit.
