# Miscompile Confidence Ladder

## Purpose

This W8-05a artifact turns the broader
`docs/design/miscompile-confidence-design.md` into a bounded release ladder.
It names which evidence belongs in fast local checks, extended local checks,
release lanes, and research lanes.

| Level   | Evidence                                                                                                                              | Gate                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Level 1 | real full-image fixture OptIR observation differential from `tests/unit/validation/miscompile-confidence/fixture-observation.test.ts` | `agent:check` through `bun test` |
| Level 2 | generated .wr arithmetic programs                                                                                                     | `verify:extended`                |
| Level 3 | QEMU and backend stress release lane using `scripts/verify-qemu.ts` and `scripts/verify-release.ts`                                   | `verify:release`                 |
| Level 4 | research/formal lanes: herd7 memory litmus, larger generated-source corpus, Lean differential verdicts                                | no release dependency            |

## Level Definitions

Level 1 is the fast fixture differential already seeded by W4. It compares
unoptimized and optimized OptIR observations for real validation fixtures and
must stay cheap enough for normal `bun test`.

Level 2 is generated straight-line source or source-shaped arithmetic. W8-05b
adds only one tiny deterministic seed under
`tests/unit/validation/miscompile-confidence/generated-arithmetic-seed.test.ts`.
The larger generator, source compiler path, corpus minimizer, and QEMU
execution are outside this artifact-only task.

Level 3 is the slow release lane. It may use QEMU and stress cases, but it must
remain an explicit local package script, never a hidden remote-only gate.

Level 4 is research/formal evidence. Herd7 and Lean differential work can raise
confidence, but no current release task depends on those lanes until they are
separately approved and converted into bounded local scripts.

## Boundary

This ladder does not claim the remediation plan is complete. It records where
evidence belongs so future work can add depth without making every agent run
every research system for ordinary changes.
