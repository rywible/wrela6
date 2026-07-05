# Proof Model Coverage

Status values are `proved`, `modeled-no-theorem`, or `not-modeled`.

| TypeScript domain                                               | Lean coverage                 | Status             |
| --------------------------------------------------------------- | ----------------------------- | ------------------ |
| `src/proof-check/domains/attempts.ts`                           | `Wrela/ProofMIR/Model12.lean` | modeled-no-theorem |
| `src/proof-check/domains/cross-core-ownership.ts`               | none                          | not-modeled        |
| `src/proof-check/domains/erasure.ts`                            | `Wrela/ProofMIR/Model8.lean`  | modeled-no-theorem |
| `src/proof-check/domains/extension-gates.ts`                    | none                          | not-modeled        |
| `src/proof-check/domains/extensions.ts`                         | none                          | not-modeled        |
| `src/proof-check/domains/facts.ts`                              | `Wrela/ProofMIR/Model3.lean`  | modeled-no-theorem |
| `src/proof-check/domains/function-entry-state.ts`               | `Wrela/ProofMIR/Model1.lean`  | modeled-no-theorem |
| `src/proof-check/domains/initial-state.ts`                      | `Wrela/ProofMIR/Model0.lean`  | modeled-no-theorem |
| `src/proof-check/domains/layout-entailment.ts`                  | none                          | not-modeled        |
| `src/proof-check/domains/loans.ts`                              | `Wrela/ProofMIR/Model7.lean`  | modeled-no-theorem |
| `src/proof-check/domains/loops.ts`                              | `Wrela/ProofMIR/Model10.lean` | modeled-no-theorem |
| `src/proof-check/domains/mir-operation-metadata.ts`             | none                          | not-modeled        |
| `src/proof-check/domains/mir-place-bindings.ts`                 | `Wrela/ProofMIR/Model2.lean`  | modeled-no-theorem |
| `src/proof-check/domains/mir-requirement-terms.ts`              | `Wrela/ProofMIR/Model4.lean`  | modeled-no-theorem |
| `src/proof-check/domains/mir-source-call-transfer.ts`           | none                          | not-modeled        |
| `src/proof-check/domains/ownership-hidden-place-analysis.ts`    | none                          | not-modeled        |
| `src/proof-check/domains/ownership-place-model.ts`              | `Wrela/ProofMIR/Model5.lean`  | modeled-no-theorem |
| `src/proof-check/domains/ownership-transfer.ts`                 | `Wrela/ProofMIR/Model6.lean`  | modeled-no-theorem |
| `src/proof-check/domains/ownership.ts`                          | `Wrela/ProofMIR/Model6.lean`  | modeled-no-theorem |
| `src/proof-check/domains/place-key-references.ts`               | none                          | not-modeled        |
| `src/proof-check/domains/platform-contract-effects.ts`          | none                          | not-modeled        |
| `src/proof-check/domains/platform-contract-transfer.ts`         | none                          | not-modeled        |
| `src/proof-check/domains/private-state.ts`                      | none                          | not-modeled        |
| `src/proof-check/domains/runtime-contract-transfer.ts`          | none                          | not-modeled        |
| `src/proof-check/domains/source-call-types.ts`                  | none                          | not-modeled        |
| `src/proof-check/domains/source-calls.ts`                       | none                          | not-modeled        |
| `src/proof-check/domains/stream-loop.ts`                        | none                          | not-modeled        |
| `src/proof-check/domains/summary-input.ts`                      | none                          | not-modeled        |
| `src/proof-check/domains/take-session-operations.ts`            | none                          | not-modeled        |
| `src/proof-check/domains/take-session-stream-operations.ts`     | none                          | not-modeled        |
| `src/proof-check/domains/take-session-support.ts`               | none                          | not-modeled        |
| `src/proof-check/domains/take-session-types.ts`                 | none                          | not-modeled        |
| `src/proof-check/domains/take-sessions.ts`                      | none                          | not-modeled        |
| `src/proof-check/domains/terminal.ts`                           | `Wrela/ProofMIR/Model11.lean` | modeled-no-theorem |
| `src/proof-check/domains/validated-buffer-parameter-binding.ts` | none                          | not-modeled        |
| `src/proof-check/domains/validated-buffers.ts`                  | `Wrela/ProofMIR/Model9.lean`  | modeled-no-theorem |
| `src/proof-check/domains/validation-arm-cleanup.ts`             | none                          | not-modeled        |
| `src/proof-check/domains/validation-state-patches.ts`           | none                          | not-modeled        |
| `src/proof-check/domains/validation-state-queries.ts`           | none                          | not-modeled        |
| `src/proof-check/domains/validation.ts`                         | `Wrela/ProofMIR/Model9.lean`  | modeled-no-theorem |
| `src/proof-check/domains/yield-resume.ts`                       | none                          | not-modeled        |
