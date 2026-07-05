# Giant File Split Map

Current `src/**/*.ts` files at or above 900 `wc -l` lines, re-audited for W7-04a after Waves 1-6. The fast audit stores the matching `split("\n")` measured counts, which are one higher for newline-terminated files, and rejects stale rows for files that shrink below the threshold.

| File                                                             | Lines | Owner boundary                         | Prerequisite             | Notes                                                     |
| ---------------------------------------------------------------- | ----: | -------------------------------------- | ------------------------ | --------------------------------------------------------- |
| `src/target/aarch64/backend/object/layout-encode-fixed-point.ts` |   997 | AArch64 object layout encoding         | W0-05 split prerequisite | Extract fixed-point layout passes from encode helpers.    |
| `src/opt-ir/lower/lower-checked-mir.ts`                          |   996 | Opt IR lowering                        | W0-05 split prerequisite | Split checked MIR lowering by statement/value boundary.   |
| `src/proof-check/domains/validation.ts`                          |   988 | Proof-check validation domain          | W0-05 split prerequisite | Split validation facts, transitions, and diagnostics.     |
| `src/proof-check/kernel/registry/transition-helpers.ts`          |   979 | Proof-check transition registry        | W0-05 split prerequisite | Split transition lookup and normalization helpers.        |
| `src/mono/mono-hir.ts`                                           |   976 | Monomorphized HIR model                | W0-05 split prerequisite | Separate model declarations from builders and formatters. |
| `src/target/aarch64/backend/verify/encoding-object-verifier.ts`  |   972 | AArch64 object verification            | W0-05 split prerequisite | Split verifier checks by object section.                  |
| `src/target/aarch64/backend/object/object-module.ts`             |   972 | AArch64 object module assembly         | W0-05 split prerequisite | Split module state from section and symbol emit helpers.  |
| `src/target/aarch64/lower/lower-function.ts`                     |   964 | AArch64 function lowering              | W0-05 split prerequisite | Split function setup, block lowering, and finalization.   |
| `src/proof-check/domains/source-calls.ts`                        |   951 | Proof-check source-call domain         | W0-05 split prerequisite | Split source-call facts from transition rules.            |
| `src/proof-check/domains/facts.ts`                               |   951 | Proof-check fact domain                | W0-05 split prerequisite | Split fact canonicalization, comparison, and diagnostics. |
| `src/proof-mir/draft/draft-graph-builder.ts`                     |   945 | Proof MIR draft graph building         | W0-05 split prerequisite | Split graph node creation from edge and fact recording.   |
| `src/target/aarch64/backend/api/machine-lowering.ts`             |   944 | AArch64 machine lowering API           | W0-05 split prerequisite | Split public orchestration from lowerer configuration.    |
| `src/proof-check/authority/authority-term-canonicalization.ts`   |   943 | Proof-check authority canonicalization | W0-05 split prerequisite | Split term normalization from authority comparison.       |
| `src/proof-mir/domains/effects-resources.ts`                     |   931 | Proof MIR effects/resources domain     | W0-05 split prerequisite | Split resource facts from effect normalization.           |
| `src/target/uefi-aarch64/runtime-helper-instructions.ts`         |   929 | UEFI AArch64 runtime helpers           | W0-05 split prerequisite | Split helper instruction catalogs by runtime concern.     |
