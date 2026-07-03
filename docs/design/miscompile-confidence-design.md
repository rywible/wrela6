# Miscompile Confidence Design

## Purpose

Miscompile confidence is the correctness phase that follows full image
validation. Full image validation proves that representative programs travel
through the real pipeline and become well-formed, self-contained `.efi`
artifacts. This phase proves something stronger: that compiled programs
compute the right answers.

The existing verification stack is heavily structural. Proof checking, OptIR
structural/SSA verification, the machine IR verifier suite, the allocation
verifier, the object module verifier, the linker validators, and the PE parser
all check that intermediate artifacts are well formed and internally
consistent. None of them, except e-graph translation validation, checks that a
transformation preserved the meaning of the program. Instruction selection,
register allocation, branch relaxation, and the optimization pipeline are
verified for shape, not for semantics.

Wrela makes semantic verification unusually tractable. Accepted programs are
deterministic and have no undefined behavior, so every accepted program has one
correct behavior under the compiler's declared observation contract. Within
that contract, differential testing has no semantically ignorable
disagreements: any mismatch between two evaluations of the same accepted
program is a bug in the compiler, the generator, or an oracle. This phase
builds the oracle chain and the generators needed to exploit that property at
every stage boundary from Checked MIR to executed firmware bytes, and adds
executable soundness evidence for the proof checker that guards the top of
that chain. The contract is deliberately layered: sequential observations,
device-observed ordering, firmware-host behavior, oracle correctness, and
proof-checker soundness each get their own evidence lane instead of pretending
one oracle can prove all of them.

The phase has eleven pillars:

```text
oracle chain:
  executable reference semantics at Checked MIR, OptIR, machine IR, physical
  IR, and decoded-bytes levels, with tracked operation and opcode coverage

generated-program differential testing:
  random interpreter-complete programs through optimization passes, lowering,
  allocation, and encoding, compared against the reference semantics, with
  source programs in the required corpus

source-level end-to-end generation:
  grammar- and type-directed `.wr` programs with generator-known expected
  behavior, including proof-relevant shapes, through Checked MIR, minimal
  images, production images, and QEMU

external encoding cross-check:
  test-time round-trips of instruction encodings against an independent
  assembler/disassembler, never as production authority

oracle cross-validation:
  semantic golden fixtures that compare interpreter opcode behavior against
  QEMU single-instruction observations for every supported opcode form

behavioral end-to-end execution:
  value-carrying observation markers, fixture input matrices, optimization
  profile differentials, firmware-host fault simulation, and interpreter
  reference checks wired into full image validation and QEMU smoke

upper pipeline oracle:
  a Checked MIR reference interpreter so the source-to-OptIR half of the
  pipeline is checked behaviorally, not only structurally

proof checker soundness evidence:
  differential testing of the TypeScript proof checker's verdicts and modeled
  fact judgments against the Lean models' executable checkers, expansion of
  the modeled fragment, decision-table-derived proof-checker components,
  formal observation equivalence, and a committed must-reject corpus

memory-order sufficiency evidence:
  barrier conservation plus committed herd7-backed litmus/axiomatic checks that validate
  device-observed ordering obligations against target barrier selections

verification completion and suite strength:
  wiring the remaining dormant verifiers, per-stage verification evidence,
  allocation semantic validation, coverage-guided generation, seeded
  configuration swarming, and mutation audits of the test suite itself

determinism hardening:
  cross-process and cross-platform replay checks for generated corpora,
  minimized reproducers, reports, diagnostics, and emitted artifacts
```

## Phase Boundary

This phase adds no semantic transformation and no new production code
generation stage. It adds oracles, generators, comparators, proof-checker
soundness components, and audit harnesses around the existing pipeline:

```text
miscompile confidence request
  + generated program corpus (seeded)
  + fixture observation matrices
  + oracle chain configuration
  + optional external assembler configuration
  + optional QEMU/OVMF configuration
  -> generate or load programs
  -> evaluate reference semantics per program
  -> compile through real pipeline stages under test
  -> evaluate each downstream representation
  -> compare observations pairwise, fail closed on any disagreement
  -> MiscompileConfidenceReport
```

Production compiles are unchanged except where this design explicitly wires
existing dormant verifiers into the production path (frame verification,
per-stage verification evidence, allocation semantic validation, and barrier
conservation where memory-order obligations enter the backend) or replaces a
modeled proof-checker decision with a Lean decision-table-derived component.
Everything else is test, script, and audit infrastructure.

## Relationship To Existing Phases

- `docs/design/compiler-pipeline-design.md` names a differential testing
  strategy with interpreters at several levels. This design is the concrete
  version of that strategy for the levels that matter most for miscompiles.
- `docs/design/full-image-validation-design.md` provides the acceptance
  harness, fixture corpus, reference checker framework, and QEMU machinery.
  This design extends that harness with behavioral observations and an
  interpreter reference checker, and reuses its report conventions.
- `docs/testing/fuzzing-strategy.md` defines frontend fuzz families, committed
  seeds, and the minimize-and-promote discipline. This design extends the same
  discipline past the frontend into OptIR, lowering, backend, and end-to-end
  execution.
- `src/opt-ir/interpreter.ts`, `src/opt-ir/differential.ts`,
  `src/target/aarch64/interpreter/`, and
  `src/opt-ir/egraph/translation-validation.ts` already exist. This design
  promotes them from spot-check tools to the load-bearing oracle chain.
- `proof-model/` proves resource safety, not functional correctness of
  compilation. Nothing in this design weakens or replaces the proof checker;
  the oracle chain covers the orthogonal question the Lean model deliberately
  does not.

## Threat Model

The stages most able to silently change program meaning, and the evidence this
phase adds for each:

| Stage                                                           | Failure mode                                                                                                                                                        | New evidence                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| OptIR optimization passes                                       | rewrite changes values, memory, effects, or trap behavior                                                                                                           | pass-level and whole-schedule differential vs OptIR interpreter on generated programs                                                                |
| Instruction selection / lowering                                | wrong opcode, operand, extension, memory order, or ABI shape                                                                                                        | lowering differential: machine IR interpreter vs OptIR interpreter                                                                                   |
| Register allocation, spill, remat, move resolution              | value lands in wrong register or slot, clobber missed                                                                                                               | physical IR execution differential plus allocation semantic validation                                                                               |
| Pseudo-expansion, post-RA schedule, peepholes                   | reordering or expansion changes semantics                                                                                                                           | physical IR execution differential                                                                                                                   |
| Memory ordering and barrier sufficiency                         | required `dmb`/`dsb`, acquire/release suffix, or MMIO/device ordering edge is missing, weakened, or insufficient while sequential values still match                | barrier conservation plus committed herd7-backed litmus/axiomatic checking against target barrier selections                                         |
| Instruction encoding                                            | correct instruction, wrong bytes                                                                                                                                    | decoded-bytes execution plus external assembler cross-check                                                                                          |
| Branch relaxation, literal pools, veneers, layout               | wrong offsets or targets after layout fixed point                                                                                                                   | decoded-bytes execution across layout-stressing generated functions                                                                                  |
| Linker relocation application                                   | wrong final addresses                                                                                                                                               | linked decoded-bytes execution, existing slow linked-layout validator, plus end-to-end QEMU observations                                             |
| Whole pipeline integration                                      | any of the above composed                                                                                                                                           | end-to-end behavioral matrix: interpreter vs QEMU vs expected observations                                                                           |
| Source → Checked MIR (frontend, semantic, HIR, mono, proof-MIR) | source lowers to the wrong but well-formed program, which every downstream oracle then faithfully executes                                                          | Checked MIR reference interpreter plus source-level generated programs with generator-known expected behavior                                        |
| Firmware host interaction                                       | target driver mishandles boot service failures, watchdog expiry, allocation failure, or runtime host effects                                                        | firmware-host simulation with injected failures behind `hostEffects` seams                                                                           |
| Interpreter/oracle semantics                                    | a shared interpreter bug causes every differential lane using that oracle to agree on the wrong behavior                                                            | QEMU single-instruction semantic golden fixtures plus hand-authored semantic fixtures                                                                |
| Proof checker acceptance and fact certification                 | unsound acceptance or wrong certified facts license illegal downstream optimization; no differential lane can see it because the accepted IR is executed as written | differential verdict/fact comparison, modeled-fragment expansion, Lean decision-table-derived checker components, and a committed must-reject corpus |
| Harness determinism and coverage collapse                       | generated corpus stops reaching risky code, or differential results depend on process/platform state                                                                | coverage-guided generation plus cross-process and cross-platform determinism checks                                                                  |

A shared misunderstanding is the residual risk of any self-checking system:
the encoder and the catalog decoder derive from the same records, and the
interpreters are written by the same project. Cross-level projection maps
also join the TCB because they decide which machine-level events correspond to
source-level observations. The mitigations are scoped by trust domain:
end-to-end behavior uses interpreter/QEMU-system/human-expectation
triangulation; encoding, single-instruction semantics, proof-model verdicts,
and memory-order litmus verdicts use fixture-feeding external authorities with
staleness identities; projection contracts are reviewed explicitly. Default
`agent:check` still cannot independently prove encoding-table correctness
beyond known-byte fixtures, catalog ownership tests, and committed external
verdict fixtures; configured authority-regeneration lanes are the release
audit for those trust surfaces.

## Production Commitments

```text
oracle:
  maintain executable reference semantics with explicit, tracked coverage of
  every closed operation and opcode inventory entry

generation:
  generate seeded, bounded, interpreter-complete random programs at the OptIR
  and source levels, with minimized failures promoted to named regression tests

source:
  generate grammar- and type-directed `.wr` programs with generator-known
  expected behavior, including proof-relevant shapes, and run them through the
  full pipeline end to end

differential:
  compare observations across every adjacent pair of pipeline representations
  for every generated and fixture program, failing closed on disagreement

encoding:
  cross-check the encoding catalog against an external assembler at test time
  when configured, without adding any production dependency or authority

oracle-validation:
  cross-check interpreter opcode semantics against QEMU single-instruction
  golden fixtures for every supported opcode form

behavior:
  make end-to-end fixtures observe computed values, not just liveness markers,
  check them against both the reference interpreter and expectations, and
  simulate firmware-host failures through injected host effects

upper pipeline:
  maintain a Checked MIR reference interpreter so behavioral evidence starts
  at the proof checker's output, not at OptIR

soundness:
  compare the proof checker's accept/reject decisions and modeled certified
  fact judgments against the Lean executable checkers, extend the modeled
  fragment until skip rates close, derive checker decision tables from Lean for
  modeled-fragment decisions, and maintain a growing must-reject corpus

memory-model:
  validate memory-order facts and target barrier selections with
  committed herd7-backed litmus/axiomatic checks, not only sequential
  observations

verification:
  wire dormant verifiers into production, record per-stage verification
  evidence honestly, semantically validate register allocation, and conserve
  declared barrier obligations

audit:
  measure the test suite's ability to catch injected defects in high-risk
  modules, guide generators toward uncovered compiler branches, and report
  uncaught mutants deterministically

determinism:
  replay differential lanes across processes and supported platforms with
  stable reports and identical artifacts
```

## Goals

- Establish the OptIR interpreter as the canonical executable semantics for
  accepted programs after OptIR construction.
- Track interpreter completeness explicitly: every OptIR operation kind and
  every closed AArch64 opcode form is either supported by its interpreter or
  listed in a committed exclusion catalog with a reason.
- Build a seeded random OptIR program generator producing interpreter-complete
  programs with configurable pressure profiles (arithmetic, control flow,
  memory, calls, spill pressure, branch-distance stress).
- Build grammar- and type-directed source-level `.wr` generation that feeds
  the full frontend, semantic, HIR, mono, proof-MIR, Checked MIR, OptIR,
  backend, link, and image-validation pipeline end to end.
- Give generated source programs generator-known expected behavior. V1 has one
  allowed expected-behavior kind: `constructive`, where the generator tracks the
  symbolic result of the program it emits. A separate source evaluator is not a
  v1 option; it would be a second `.wr` interpreter and must be designed as an
  oracle lane before it can carry confidence credit.
- Include proof-relevant generated source shapes once the surface syntax for
  sessions, obligations, validation flow, private state, and layout facts is
  stable enough to generate without excessive rejection.
- Run every production optimization pass, and the full production schedule,
  differentially against the OptIR interpreter over the generated corpus.
- Run lowering differentially: lowered machine IR executed by the machine IR
  interpreter must match the OptIR interpreter observation for the same
  program and inputs.
- Extend the machine IR interpreter to execute post-allocation physical IR so
  allocation, spill, frame, pseudo-expansion, scheduling, and peephole output
  is executed, not just inspected.
- Execute decoded bytes: decode emitted `.text` through the encoding catalog
  back into physical instruction records and execute them, closing the
  encode/decode loop behaviorally.
- Execute linked decoded bytes from the final `.text` layout so default checks
  behaviorally cover relocation application without requiring QEMU.
- Add production allocation semantic validation: the allocated function must
  be a value-preserving renaming of the virtual-register function.
- Add barrier conservation validation for declared memory-order obligations,
  feeding the stronger memory-order sufficiency lane.
- Add memory-order litmus/axiomatic checking for barrier sufficiency and
  device-observed ordering, using imported memory-order facts, selected
  acquire/release suffixes, barrier domains, MMIO/device publication shapes,
  target barrier sequences, committed herd7 verdict fixtures, and env-gated
  herd7 regeneration as inputs.
- Declare the committed herd model's expressible fragment and classify every
  required publication shape as directly checked, conservative proxy, or
  hand-reviewed rule, with Device-nGnRE residue explicitly owned by the target
  memory model.
- Add an environment-gated external assembler cross-check that round-trips
  every known-byte fixture and a fuzzed sample of catalog operand combinations
  through `llvm-mc` or an equivalent tool and diffs the bytes.
- Add interpreter cross-validation against QEMU single-instruction semantics
  for the supported AArch64 opcode set, with committed semantic golden
  fixtures generated once and reviewed like known-byte fixtures.
- Make full-image-validation markers value-carrying and add fixture input
  observation matrices so QEMU smoke asserts computed results.
- Add firmware-host simulation with fault injection behind the existing
  `hostEffects` seams: boot service failures, watchdog expiry, allocation
  failure, filesystem/write failures in QEMU harness setup, and runtime
  service failures where the target surface exposes them.
- Add an `interpreter-reference` checker to the full image validation checker
  set that executes the case's optimized OptIR and compares its observation
  against the case's expected markers and status.
- Add optimization profile differentials: a minimal legal profile and the
  production profile must produce observation-equivalent images for the same
  source.
- Add seeded configuration swarming once pass contracts declare the dependency
  surface needed to enumerate legal pass-order permutations; policy variants
  and register model variants must all be observation-equivalent.
- Build a Checked MIR reference interpreter (level -1) with its own coverage
  contract, compare it against fixture expectations and against OptIR
  construction, and run it as a full-image-validation reference checker
  alongside the OptIR interpreter.
- Compare the TypeScript proof checker's accept/reject decisions and modeled
  certified fact judgments against the Lean executable checkers over a seeded
  bounded-program corpus, with verdict/fact projections cached in a committed
  fixture so the lane runs without a local Lean toolchain.
- Extend the Lean modeled fragment to cover layout entailment arithmetic,
  dominance reasoning, and unbounded CFG shapes needed by production proof
  checking; outside-modeled-fragment skip rates must trend to zero for
  proof-relevant generated programs.
- Derive v1 proof-checker decision tables from the Lean development for the
  modeled fragment so the core soundness argument becomes constructive rather
  than only differential.
- Formalize the observation equivalence relation in the Lean sidecar and link
  pass legality obligations to that relation for the modeled optimization
  fragment.
- Maintain a committed must-reject corpus, including proof-relevant mutants
  of accepted fixtures, where every entry must be rejected with the expected
  diagnostic family.
- Wire `frame-verifier` into the backend function pipeline.
- Replace the blanket `passedAArch64BackendVerification()` summary with
  per-stage evidence recorded by each stage as it actually runs.
- Implement `diagnosticMode` on backend compile or remove the field.
- Run the OptIR fact verifier at optimizer checkpoints under a strict policy.
- Add a mutation audit script for high-risk modules with a deterministic
  uncaught-mutant report.
- Add coverage-guided generation that mutates seeds toward unexplored pass
  branches, lowering selections, allocation cases, linker layouts, and proof
  checker branches when random generation plateaus.
- Add cross-process and cross-platform determinism checks for differential
  lanes, generated corpora, minimized reproducers, reports, and emitted
  artifacts.
- Keep every harness deterministic: committed seeds, stable keys, sorted
  reports, reproducible single-case replay.

## Non-Goals

- This phase does not add a second production compiler or make any interpreter
  a production execution path.
- This phase does not make external tools (`llvm-mc`, `objdump`, capstone,
  user-mode QEMU, system-mode QEMU, herd7, Lean) production authority.
  Accepted production checks remain local and deterministic; external tools
  gate audit/regeneration lanes and produce reviewed fixtures only.
- This phase does not attempt scheduler-style deterministic simulation of the
  pure compiler core. The simulation lane is scoped to firmware-host and
  target-driver boundaries where `hostEffects` injection exposes real IO and
  firmware failure behavior.
- This phase does not prove the interpreters correct. Interpreters are TCB
  members mitigated by triangulation, simplicity requirements, known-byte
  semantic fixtures, and QEMU single-instruction cross-validation. They remain
  TCB unless and until an interpreter fragment is formally derived.
- This phase does not claim QEMU TCG itself proves weak-memory behavior.
  Memory-order confidence comes from explicit litmus/axiomatic checking over
  Wrela's memory-order facts and selected barrier sequences, with herd7 as the
  env-gated external authority and QEMU used only for ordinary execution
  observations and single-instruction semantics.
- This phase does not require user-mode QEMU, system-mode QEMU, `llvm-mc`,
  herd7, Lean, or firmware images for default `agent:check`, but phase
  completion requires at least one configured environment for system-mode QEMU
  behavioral rows, user-mode QEMU single-instruction cross-validation, external
  encoding audit, herd7 verdict regeneration, and Lean
  regeneration/decision-table checks.
- This phase does not require generated source to cover arbitrary user
  programs. It requires a reviewed, expanding generated fragment with
  generator-known expected behavior, including proof-relevant shapes once their
  syntax is stable.
- This phase does not prove every possible future TypeScript proof-checker
  extension sound. It requires modeled-fragment expansion, verdict/fact
  differential evidence, must-reject pressure, and Lean decision-table-derived
  checker components for the modeled fragment.
- This phase does not chase optimization quality (missed optimizations); a
  legal but slow compilation is a pass.

## Trusted Computing Base

This phase reduces trust in the transformation pipeline by adding evaluation
paths, but the evaluation paths themselves join the TCB:

- the Checked MIR interpreter and the OptIR interpreter with their shared
  memory/effect observation model
- the machine IR / physical IR interpreter
- the catalog byte decoder used for decoded-bytes execution
- the cross-level observation projection maps, including ABI return
  flattening, region-to-address binding, frame/spill filtering, and QEMU
  marker projection
- the random program generators (a generator that only emits trivial programs
  silently weakens every downstream check)
- the source-level generator and its constructive expected-behavior derivation
- fixture observation matrices and golden expected values (expectations are
  computed by a human from source semantics, never derived from compiler or
  interpreter output)
- the Proof MIR to Lean model translation and the committed Lean verdict/fact
  fixture
- Lean decision-table-derived TypeScript checker components and their
  component-level staleness and boundary tests
- the Lean observation-equivalence formalization and its mapping to TypeScript
  observation reports
- the memory-order litmus/axiomatic model, committed herd7 verdict fixtures,
  target memory-model parameters, and lowering from Wrela memory-order facts
  into litmus obligations
- QEMU single-instruction harnesses and committed semantic golden fixtures
- firmware-host fakes and injected `hostEffects` fault schedules
- coverage instrumentation and coverage-guided seed mutation heuristics
- the external tool invocation and diff logic in the encoding audit lane

Mitigations, in order of strength:

- Triangulation: for end-to-end cases, the reference interpreter, the compiled
  image under QEMU, and manually computed expectations must all agree. A bug
  in any single path surfaces as a disagreement.
- Independence: the decoded-bytes path shares the catalog with the encoder, so
  it is credited only with catching layout, relaxation, and patch bugs, never
  encoding-table bugs. Encoding-table trust comes from known-byte fixtures
  plus the external cross-check lane.
- Credit scoping: levels 1, 2, and 3 may share the same AArch64 core stepper.
  That makes them one semantic oracle for instruction behavior; level 2 adds
  allocation/frame evidence and level 3 adds byte/layout evidence, not a fresh
  semantic implementation.
- Simplicity: interpreters must remain direct-dispatch, allocation-light,
  case-per-operation implementations. No shared helper code between an
  interpreter and the transformation it checks beyond type definitions.
- Coverage honesty: unsupported operations and opcodes fail closed in
  differential lanes (`unsupported` is a skip with a stable reason recorded in
  the report, never a silent pass), and the exclusion catalog is a committed,
  reviewed file.
- Generator audits: generator distributions are tested (operation-kind
  histograms, CFG shape statistics) so coverage collapse is visible.
- Cross-validation: source-generated expectations, Checked MIR interpretation,
  OptIR/machine/byte interpreters, live system-mode QEMU behavioral execution,
  user-mode QEMU single-instruction fixtures, Lean-modeled proof judgments,
  and herd7-backed litmus verdicts are deliberately different evidence paths.
  No one path is allowed to declare the whole phase green by itself.

## External Authority Pattern

Every externalized trust domain introduced by this phase has exactly one
designated environment-gated external authority. Fixture-feeding authorities
produce committed normalized verdict fixtures that fail closed when stale.
Live-triangulation authorities run only in configured environments and record
their identity in the report; they do not feed default verdict fixtures.
External tools never become production authority, and their output is never
accepted live without review. Trust domains with no credible independent
external authority, such as constructive source generation or observation-map
provenance, stay in the local TCB and must be covered by the TCB mitigations
instead of getting a decorative tool lane.

Fixture-feeding authorities:

| Trust domain                   | Local required evidence                                    | External authority and env gate                              | Committed fixture/verdict                                                                | Failure policy                                                                                        |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AArch64 encoding catalog       | known-byte fixtures, catalog ownership tests, byte decoder | `llvm-mc` via `WRELA_LLVM_MC` and `WRELA_LLVM_MC_TRIPLE`     | normalized external-assembly byte verdicts for known fixtures and seeded operand samples | fixture-backed default checks fail on stale verdicts; configured audit fails on any byte disagreement |
| AArch64 instruction semantics  | hand-authored semantic fixtures and interpreter catalogs   | user-mode QEMU via `WRELA_QEMU_AARCH64_USER`                 | semantic golden fixtures per supported opcode form                                       | default fixture-backed cross-validation fails on stale fixtures; configured regeneration must match   |
| Proof-checker modeled fragment | TypeScript verdict/fact checks and must-reject corpus      | Lean sidecar executable checkers via `WRELA_LEAN_LAKE`       | Lean verdict/fact fixtures plus component derivation metadata                            | stale generator, translation, theorem, or component metadata fails before comparing verdicts          |
| Memory-order sufficiency       | barrier conservation and target memory-model declarations  | herd7 via `WRELA_HERD7` with the committed target/herd model | normalized allowed/forbidden verdict fixtures for every required litmus obligation       | stale or missing verdict fixture fails required profiles; configured herd7 regeneration must match    |

Live-triangulation authorities:

| Trust domain                  | Local required evidence                                | Live authority and env gate                                                                                                       | Report identity                                                                                        | Failure policy                                                                     |
| ----------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| End-to-end firmware execution | interpreter-reference checker and fixture expectations | system-mode QEMU/AAVMF via `WRELA_QEMU_AARCH64_SYSTEM`, `WRELA_QEMU_AARCH64_EFI_CODE`, and `WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE` | normalized QEMU binary identity, firmware-code identity, firmware-vars template identity, machine args | missing env is an optional skip by default; requested or release lanes fail closed |

The pattern is deliberately one-authority-per-domain and one-mode-per-env-var.
User-mode QEMU for single-instruction semantic fixtures and system-mode QEMU
for firmware smoke use different binaries and may not share a generic
unsuffixed QEMU gate. Adding a second external tool for the same trust domain
is allowed only as a separate design change that states which tool owns the
committed verdict and how disagreements are triaged.

Uniform fixture staleness is part of the fixture contract:

```ts
export interface AuthorityFixtureIdentity {
  readonly authorityKey: "llvm-mc" | "qemu-aarch64-user" | "herd7" | "lean-executable-checker";
  readonly authorityMode:
    | "encoding"
    | "single-instruction-semantics"
    | "memory-order-litmus"
    | "proof-verdict-fact";
  readonly toolIdentity: string;
  readonly modelOrCatalogFingerprint: string;
  readonly rendererOrGeneratorVersion: string;
  readonly inputCorpusFingerprint: string;
  readonly fixtureSchemaVersion: number;
  readonly seedKey?: string;
}

export interface LiveAuthorityRunIdentity {
  readonly authorityKey: "qemu-aarch64-system";
  readonly authorityMode: "firmware-behavior";
  readonly toolIdentity: string;
  readonly firmwareCodeIdentity: string;
  readonly firmwareVarsTemplateIdentity: string;
  readonly machineArgsIdentity: string;
}
```

`toolIdentity` is the normalized tool name/version/features, never an absolute
host path. `modelOrCatalogFingerprint` is the owned input model for the trust
domain: encoding catalog for `llvm-mc`, opcode catalog plus target-surface
fingerprint for user-mode QEMU, committed herd model plus target memory model
for herd7, and Lean source/theorem/translation fingerprints for Lean.
`rendererOrGeneratorVersion` names the assembly renderer, single-instruction
harness generator, litmus generator, or Lean fixture generator. A changed
identity field without a regenerated fixture is stale and fails before verdict
comparison. Live-triangulation QEMU reports use the same field names where
applicable, but they are `LiveAuthorityRunIdentity` records, not committed
default verdict identities.

## Cross-Design Obligations

This phase is allowed to demand evidence from other designs, but those demands
must have owners. These obligations are now on the critical path for
miscompile-confidence acceptance.

| Obligation                                        | Owning design surface                                                                                                                                           | Required output                                                                                                                       | Why this phase depends on it                                                                                              | Failure if absent                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Observation-contract home                         | `docs/design/miscompile-confidence-design.md`; optimizer, backend, and compiler-pipeline docs reference this section                                            | authoritative `ProgramObservation` relation, projection rules, trap/step-limit policy, and address-map provenance requirements        | pass legality, interpreter comparison, QEMU projection, and Lean observation equivalence must share one contract          | no lane may claim semantic equivalence outside this contract                                            |
| Memory-order obligation-record emission           | `docs/design/opt-ir-to-aarch64-machine-ir-design.md` and `docs/design/aarch64-backend-design.md`                                                                | stable obligation records for every imported memory-order fact and every selected/removal barrier decision                            | barrier conservation and herd7 sufficiency need a record to compare, not a reconstructed guess                            | memory-order lanes fail with `missing-obligation-record:<operationKey>`                                 |
| Pass-contract manifests                           | `docs/design/opt-ir-construction-optimization-design.md` and `src/opt-ir/policy/pass-order-policy.ts`                                                           | per-pass preserved/invalidated facts, ordering dependencies, fixpoint groups, and trapping/effect introduction/removal/reorder policy | configuration swarming cannot enumerate legal permutations from pass order alone                                          | configuration swarm stays blocked and cannot be counted as confidence evidence                          |
| Target-surface memory-model content               | `docs/design/opt-ir-to-aarch64-machine-ir-design.md`, `docs/design/aarch64-backend-design.md`, and target docs                                                  | target memory-model parameters, barrier-domain rules, region memory types, device publication shapes, and herd model identity         | memory-order sufficiency needs authenticated target rules before it can ask herd7 about forbidden outcomes                | required memory-order profiles fail with `missing-target-memory-model:<targetKey>`                      |
| Wrapper-reason producers                          | `docs/design/opt-ir-construction-optimization-design.md`, `docs/design/full-image-validation-design.md`, and `docs/design/uefi-aarch64-target-driver-design.md` | stable wrapper reasons for source/runtime/platform wrappers and the producer responsible for each required lowering contract          | `minimal` profile, platform-effect observation, and firmware-host fault simulation depend on knowing why a wrapper exists | profile differential and firmware-host fault lanes block with `missing-wrapper-reason:<wrapperKey>`     |
| Lean decision-table production checker components | `docs/design/proof-resource-checking-design.md` and `proof-model/`                                                                                              | component boundary, derivation metadata, staleness keys, generated decision tables, and TypeScript wrapper diagnostics                | this design may replace modeled TypeScript decisions only when the production checker owns the generated component        | modeled-fragment derivation cannot replace a production decision and remains differential-only evidence |

## Oracle Chain

### Reference semantics

The observation contract is the compiler semantics contract for this phase,
not a private testing convenience. This section is the authoritative v1 home
for `ProgramObservation`; wave 1 adds cross-references from optimizer,
backend, and compiler-pipeline legality docs to this section. Extracting the
contract into a broader semantics-owned design requires a later design change,
not an implementation-time choice. The harness may implement the contract, but
it does not get to redefine it to match a pass.

The normalized observation shape extends the existing interpreter observation
types:

```ts
export type ObservedValue =
  | {
      readonly kind: "integer";
      readonly widthBits: number;
      readonly signedness: "bits" | "signed" | "unsigned";
      readonly value: bigint;
    }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "aggregate"; readonly fields: readonly ObservedValue[] }
  | { readonly kind: "pointer"; readonly regionKey: string; readonly byteOffset: bigint };

export interface ProgramObservation {
  readonly returnValues: readonly ObservedValue[];
  readonly memory: readonly MemoryRegionObservation[];
  readonly effects: readonly EffectObservation[];
  readonly proofTrace?: readonly ProofErasureObservation[];
  readonly outcome: "returned" | "trapped" | "step-limit-exceeded";
  readonly trapFamily?: string;
}
```

Two non-step-limit observations are equivalent when outcomes match, returned
values match, observed memory regions match byte for byte, and effect
sequences match in order and payload after applying the lane's declared
projection map. Trap equivalence compares trap occurrence and reason family; a
pass may not convert a trapping execution into a non-trapping one, or change
the first observed trap family, unless a narrower semantics document explicitly
proves that both trap families are indistinguishable for that operation class.

Step limits are a harness failure by default, not a transformation-invariant
observable. Accepted generated programs in v1 are terminating by construction.
Each generator emits a structural execution bound with a reviewed multiplier
for lower levels, and the baseline level must return or trap under that bound
before the case can be used in a differential comparison. If any compared
level returns or traps and another exceeds its limit, the lane is `mismatch`.
If every compared level exceeds its limit, the lane is
`failed:step-limit-exceeded:<caseKey>`, not `equivalent` and not `skipped`.
Nontermination or fuel-exhaustion tests may be added later only as a separate
lane with its own observation contract.

Each lane owns a reviewed projection map into `ProgramObservation`:

- Value projection preserves integer width and bit pattern. Signedness is
  metadata used by trap and marker renderers; equality of ordinary integer
  values is bitwise at the declared width. Aggregates are flattened only by the
  source ABI projection, not by target lowering helpers.
- Region projection binds source memory regions to machine address ranges with
  an `ObservationAddressMap`. The map is not trusted merely because the
  compiler emitted it. Every entry carries provenance:
  `(logicalRegionKey, sourceBindingKey, allocationOriginKey, symbolOrFrameKey,
byteSize, initialContentDigest)`. `logicalRegionKey` and
  `sourceBindingKey` come from the fixture or source generator before lowering;
  `symbolOrFrameKey` and address ranges come from layout/link output; the
  projection checker validates that these sources compose one-to-one, are
  range-disjoint, preserve initial-content digests or canary markers, and cover
  every observed pointer/address without inventing a matching region after the
  fact. Two same-shaped regions that can be consistently swapped by a broken
  compiler must either have distinct source-level identity markers/canaries or
  be excluded from address-sensitive confidence credit. Machine writes to frame
  slots, spill slots, callee-save saves/restores, literal pools, padding, and
  helper-private scratch are internal unless they alias an observed source
  region. A wild store into an observed range remains visible even if the
  address is machine derived.
- Pointer projection compares `(regionKey, byteOffset)` when the source value
  is a pointer. Raw machine addresses are comparable only after the address map
  proves they are inside a known observed region.
- Effect projection records ordered platform/runtime calls, volatile/MMIO
  accesses, marker writes, traps, and fixture source reads. Ordinary spill
  traffic is not an effect. Barrier instructions are recorded for
  conservation, but their hardware sufficiency is not established by the
  sequential observation relation.
- Runtime and platform calls use a validation-owned call catalog that specifies
  argument projection, return projection, memory effects, and marker payload
  encoding. Interpreters may not call production lowering helpers to answer
  those questions.
- Fixture byte binding is part of the projection map: each fixture case names
  the source primitive or runtime source that receives its byte vector, and the
  same binding key is used at levels -1, 0, and QEMU classification.
- Level -1 proof-only commands produce `proofTrace` entries. The level -1 vs
  level 0 comparison applies an erasure projection that removes those entries
  from the behavioral trace, then separately checks that every required
  proof-erasure marker was produced. A required proof-erasure marker is the
  stable `(functionInstanceId, commandId, proofActionKind, erasedStateKey)`
  record for every Checked MIR command that opens, closes, discharges, consumes,
  invalidates, or erases proof-only state while producing no runtime value.
  Missing, duplicated, or reordered required markers fail the level -1 erasure
  check even when behavioral observations match.
- The QEMU lane is a projection comparison, not the same relation as adjacent
  IR lanes: serial markers and exit status are projected into the same marker
  observation vocabulary as the interpreter reference checker.

### Level -1: Checked MIR interpreter (upper pipeline oracle)

A new reference interpreter over the proof checker's output
(`CheckedMirProgram`), executing the program the upper half of the pipeline
actually produced:

- Direct-dispatch evaluation of the runtime subset of `CheckedMirProgram.mir`:
  Proof MIR blocks, statements, terminators, calls, places, runtime values,
  layout-typed memory access, and the checked fact packet needed to bind
  layout/source regions. `CheckedMirProgram` is Proof MIR plus certificates,
  summaries, facts, terminal graph, and origin map; the interpreter must define
  the command/value/memory/call semantics over that concrete model before any
  differential lane can depend on it.
- Proof-only commands evaluate as no-ops in the behavioral projection and as
  recorded `proofTrace` entries in the erasure projection, so erasure is
  checked without forcing level -1 traces to equal level 0 traces literally.
- Coverage contract mirroring the other levels: every checked MIR construct
  is `supported` or `excluded:<stable-reason>`.
- Fixture bytes bind to the fixture source primitive exactly as in the
  `interpreter-reference` checker, so behavioral fixtures evaluate at this
  level too.

This level exists because every lane below it shares a blind spot: if the
frontend, semantic checking, HIR lowering, monomorphization, or proof-MIR
construction lowers source to the wrong but well-formed program, the OptIR
oracle faithfully executes the wrong program and every differential lane
passes. Level -1 closes half of that gap immediately (Checked MIR vs OptIR
construction, and Checked MIR vs hand-computed fixture expectations) and is the
comparison anchor for source-level generation.

What it cannot see: a bug between source text and Checked MIR that also fools
the hand-computed expectation. That residue is covered by fixture expectation
review (expectations are computed from source semantics by a human, never
derived from compiler output) and by source-level generation with
generator-known expected behavior.

### Level 0: OptIR interpreter (canonical)

`src/opt-ir/interpreter.ts` is the reference. Requirements added by this
phase:

- `validateOptIrSliceIsInterpreterComplete` grows into a coverage contract:
  a committed catalog maps every operation kind in
  `src/opt-ir/operation-kinds.ts` to `supported` or
  `excluded:<stable-reason>`. A new operation kind fails the coverage test
  until classified.
- Whole-function and multi-function interpretation (calls between generated
  functions), not only straight-line slices.
- Deterministic input binding: a program's parameter list plus a seeded input
  vector generator produce the evaluation inputs.

### Level 1: machine IR interpreter

`src/target/aarch64/interpreter/machine-ir-interpreter.ts` executes
virtual-register machine IR. Requirements:

- Opcode coverage contract mirroring level 0: every opcode form in the closed
  inventory is `supported` or `excluded:<stable-reason>`; the exclusion list
  shrinks as a tracked metric.
- Call support sufficient to execute multi-function generated programs with
  the private and public conventions the backend plans.
- Return projection uses a validation-owned ABI observation table. The table is
  tested against hand-written ABI fixtures and is not imported from lowering or
  call-sequence emission code.

### Level 2: physical IR interpreter

A new execution mode over post-allocation, post-pseudo-expansion physical
instruction IR (`src/target/aarch64/backend/finalization/physical-instruction-ir.ts`):

- Physical register file (GPR, SIMD, NZCV, SP) plus frame memory.
- Executes prologue/epilogue, spills, reloads, parallel-copy resolution
  output, and peephole/scheduler output as emitted.
- Shares the memory/effect model with level 1; implemented as a register-file
  binding layer over the same core stepper where that does not violate the
  simplicity rule.
- Physical opcode coverage has its own catalog because pseudo-expansion and
  post-RA forms can expose instruction shapes that virtual-register machine IR
  never emits. Shared stepper behavior is credited once; this level's added
  evidence is allocation, frame, ABI, and scheduling shape.

### Level 3: decoded-bytes execution

- Decode `.text` section bytes through the encoding catalog into physical
  instruction records (the object verifier already proves decodability; this
  path materializes the decoded form).
- Execute the decoded records with the level 2 interpreter, resolving
  intra-module branch targets from the object module's symbol and relocation
  records.
- Execute linked final `.text` in default checks as well, using the linked image
  layout and relocation application results rather than object-module-local
  records. This is still decoded-bytes execution, but it closes the default
  gap where relocation application is structurally validated yet no linked
  image bytes are executed unless QEMU is configured.
- Credited scope: layout, branch relaxation, veneer, literal pool, and patch
  correctness. Not credited for encoding-table correctness (shared catalog).

### Oracle equivalences checked

```text
level -1 (Checked MIR)      == fixture expectations            behavioral fixtures
level -1 (Checked MIR)      == level 0 (OptIR, constructed)    after OptIR construction
level 0 (OptIR, pre-pass)   == level 0 (OptIR, post-pass)      per pass
level 0 (OptIR, pre-sched)  == level 0 (OptIR, post-schedule)  whole schedule
level 0 (OptIR)             == level 1 (machine IR)            after lowering
level 1 (machine IR)        == level 2 (physical IR)           after backend
level 2 (physical IR)       == level 3 (decoded bytes)         after object emission
level 2 (physical IR)       == level 3 (linked decoded bytes)  after link
level 0 (OptIR)             == QEMU projection                 end-to-end cases
```

Each equivalence lane reports `equivalent`, `mismatch` (with case inputs,
trace, and stable detail), or `skipped:<unsupported-reason>`.

## Generated-Program Differential Testing

### OptIR program generator

A new generator family under `tests/support/opt-ir/generated-programs/`:

```ts
export interface OptIrGeneratorProfile {
  readonly profileKey: string;
  readonly maxFunctions: number;
  readonly maxBlocksPerFunction: number;
  readonly maxOperationsPerBlock: number;
  readonly operationWeights: OptIrOperationWeightTable;
  readonly memoryShape: "none" | "scalar-slots" | "regions";
  readonly callShape: "none" | "acyclic-calls";
  readonly pressure: readonly ("spill" | "branch-distance" | "constant-width")[];
}
```

Requirements:

- Programs are well typed, SSA-valid, terminator-complete, and
  interpreter-complete by construction; the structural verifier and the
  coverage contract run on every generated program as a generator self-check.
- Deterministic from `(profileKey, seed)`. Seeds are committed per fuzz
  family, per `docs/testing/fuzzing-strategy.md`.
- Distribution tests keep the generator honest: operation-kind histograms and
  CFG statistics over a fixed seed range are asserted within bounds, so a
  refactor cannot quietly collapse coverage.
- Required v1 profiles: `scalar-arith`, `branchy-scalar`, `memory-roundtrip`,
  `call-graph-small`, `spill-pressure`, `branch-distance-stress` (functions
  large enough to force relaxation and literal pool placement).

Facts: generated programs carry no certified facts in v1. Passes gated on
facts must treat the empty fact set as "gate closed" and perform only
unconditionally legal rewrites, which is itself a property worth checking.
Fact-carrying generation is wave 8 and must have its own soundness argument:
facts are either true by construction from the generator's typed derivation, or
are derived from source-level generation by a checker lane outside the
optimizer under test. Wave 8 may not synthesize arbitrary "plausible" fact
packets and then call mismatches expected noise.

### Input vectors and budgets

Differential strength is program coverage times input coverage. Every
generated program receives deterministic input vectors from
`tests/support/opt-ir/generated-programs/input-vectors.ts`:

- Scalar inputs are biased toward `0`, `1`, `-1`, min/max signed values,
  unsigned max, powers of two, adjacent-to-power values, and width-specific
  wraparound edges.
- Branchy profiles include paired vectors chosen to flip each generated branch
  condition when the generator can solve the local predicate cheaply.
- Memory profiles treat initial region contents as inputs. Each observed region
  has deterministic byte patterns (`zero`, `ones`, `index`, `alternating`,
  boundary constants) plus at least one random seeded pattern.
- Call profiles vary argument aliasing only when the source/IR contract allows
  aliasing; otherwise aliasing attempts are rejected by the generator
  self-check rather than smuggled into the corpus.

The table below is the canonical lane inventory. Public API lane keys,
repository scripts/tests, coverage-summary fields, and acceptance criteria are
projections of this table; a required lane missing from this table is a design
bug. Default `agent:check` budgets are fixed numbers, not "whatever still
feels fast" after implementation.

Requirement classes:

- `default-required`: runs in ordinary handoff checks once its wave lands.
- `default-required+ci`: runs in ordinary handoff checks locally and has an
  additional supported-platform CI matrix requirement before phase completion.
- `fixture-backed-required`: default checks consume committed fixtures; an
  env-gated regeneration lane must also pass in at least one configured
  environment before phase completion.
- `nightly-required`: scheduled or explicitly requested, never in ordinary
  `agent:check`.

| Lane key                                | Requirement class       | Default or fixture budget                                                                                                    | Coverage/fixture authority                                                                             | Skip policy                                                                                     |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `checked-mir-differential`              | default-required        | all behavioral fixture rows plus committed source-generated smoke rows; 30 seconds                                           | Checked MIR construct catalog and fixture expectations                                                 | unsupported construct skips must stay within catalog budget                                     |
| `source-generation-differential`        | default-required        | 12 seeds per required source profile, profile-declared inputs, 3 modules, 8 items/module, 40 statements/function; 60 seconds | source grammar/proof coverage catalog and constructive expected-behavior records                       | no evaluator-backed expectations; proof-relevant skips must name modeled-fragment gap           |
| `opt-ir-pass-differential`              | default-required        | 24 seeds per required v1 profile, 8 inputs, 3 functions, 8 blocks/function, 48 operations/function; 45 seconds               | OptIR operation catalog and input-vector manifest                                                      | unsupported OptIR operation skips within budget only                                            |
| `opt-ir-schedule-differential`          | default-required        | same seed/input/size budget as `opt-ir-pass-differential`; 45 seconds                                                        | OptIR operation catalog and production schedule manifest                                               | same as pass differential                                                                       |
| `lowering-differential`                 | default-required        | 16 seeds per backend-capable profile, 6 inputs, 3 functions, 6 blocks/function, 40 operations/function; 45 seconds           | machine opcode catalog and lowering fact records                                                       | unsupported opcode/form skips within budget only                                                |
| `backend-differential`                  | default-required        | same backend-capable seed/input/size budget as `lowering-differential`; 45 seconds                                           | physical opcode catalog, allocation trace, frame catalog                                               | unsupported backend CFG shape is failure unless rejected before allocation                      |
| `decoded-bytes-differential`            | default-required        | same backend-capable budget; `branch-distance-stress` may use one large body; 45 seconds                                     | byte decoder catalog and object-layout records                                                         | shared encoding-table trust is not credited; unsupported decoded form skips within budget       |
| `linked-decoded-bytes-differential`     | default-required        | same backend-capable budget over linked final `.text`; 45 seconds                                                            | linked layout, relocation, and address-map fixtures                                                    | missing linked address-map provenance is failure                                                |
| `barrier-conservation`                  | default-required        | every memory-order obligation emitted by default generated and fixture cases; 20 seconds                                     | memory-order obligation records and barrier-removal records                                            | missing or weakened obligation is failure, not skip                                             |
| `memory-order-sufficiency`              | fixture-backed-required | all required publication-shape verdict fixtures plus expressible-fragment classification; 20 seconds                         | committed herd7-normalized verdict fixtures, Device-nGnRE rule table, and target memory-model identity | missing target rules or over-credited proxy verdicts fail required profiles                     |
| `interpreter-qemu-cross-validation`     | fixture-backed-required | committed semantic fixture set for every supported opcode form; 30 seconds                                                   | QEMU single-instruction semantic golden fixtures                                                       | stale fixture or uncovered supported opcode form is failure                                     |
| `profile-differential`                  | default-required        | all behavioral fixture rows under `minimal` and `production`; 30 seconds                                                     | wrapper-reason catalog and fixture observation matrix                                                  | missing wrapper reason blocks the lane                                                          |
| `firmware-host-fault-simulation`        | default-required        | 8 seeds per required fault profile, fixture-declared inputs; 30 seconds                                                      | `hostEffects` fake schedule catalog and cleanup expectations                                           | missing fakeable effect for required wrapper is failure                                         |
| `configuration-swarm`                   | nightly-required        | bounded legal swarm smoke; nightly starts at 10x default generated seeds                                                     | pass-contract manifest                                                                                 | blocked until every swarmed pass has a manifest                                                 |
| `coverage-guided-generation`            | default-required        | committed high-risk coverage keys and deterministic seed mutations; 30 seconds                                               | stable coverage-key catalog                                                                            | lost high-risk key is failure                                                                   |
| `encoding-external-audit`               | fixture-backed-required | committed external byte verdicts for all known-byte fixtures plus seeded legal operand sample; 30 seconds                    | `llvm-mc` normalized byte verdict fixtures                                                             | stale verdict fixture fails default checks; configured audit fails on disagreement              |
| `interpreter-reference`                 | default-required        | all committed full-image behavioral fixture rows; 30 seconds                                                                 | fixture observation matrix and runtime call catalog                                                    | mismatch with human expectation fails                                                           |
| `proof-soundness-differential`          | fixture-backed-required | committed Lean verdict/fact fixture range, initially 64 programs; 30 seconds                                                 | Lean verdict/fact fixture and translation-fidelity tests                                               | `outside-modeled-fragment` skip rate must trend by profile and hit required-profile zero target |
| `proof-modeled-fragment-derivation`     | fixture-backed-required | required decision-table component fixtures and boundary programs; 30 seconds                                                 | Lean decision-table derivation metadata and component staleness keys                                   | stale component metadata fails before verdict comparison                                        |
| `observation-equivalence-formalization` | fixture-backed-required | committed TypeScript/Lean observation round-trip fixtures; 20 seconds                                                        | Lean observation-equivalence fixtures                                                                  | comparator divergence is failure                                                                |
| `proof-must-reject`                     | default-required        | every committed must-reject and proof-relevant mutant case; 30 seconds                                                       | must-reject corpus with expected diagnostic families                                                   | accepted mutant is failure                                                                      |
| `cross-process-platform-determinism`    | default-required+ci     | local cross-process replay sample; supported-platform CI matrix                                                              | deterministic report/artifact comparison fixtures                                                      | first byte mismatch fails with artifact key                                                     |
| `mutation-audit`                        | nightly-required        | required module list, committed mutation catalog, narrowest covering test command                                            | uncaught-mutant report                                                                                 | uncaught mutant requires tracked owner or blocks acceptance                                     |

Nightly/script budgets start at 10x the relevant default seed count with the
same input distribution and may grow monotonically. Lowering a committed
default budget or moving a lane to a weaker requirement class requires a
design-doc change naming the replacement coverage source.

### Pass-level differential properties

For every pass in the production schedule
(`src/opt-ir/policy/pass-order-policy.ts`):

```text
property pass-preserves-observations(pass, profile):
  for random program P and random input vectors I1..In:
    P' = run pass on P
    structural verifier accepts P'
    for each Ii: observe(level0, P, Ii) == observe(level0, P', Ii)
```

And for the whole schedule:

```text
property schedule-preserves-observations(profile):
  observe(level0, P, Ii) == observe(level0, optimize(P), Ii)
```

The existing `compareOptIrSlices` comparator is generalized to whole programs.
Runs per property and profile are tuned so the full differential suite stays
within the budgets above; a larger nightly seed range is a script lane, not an
`agent:check` lane.

### Lowering and backend differential properties

```text
property lowering-preserves-observations(profile):
  M = lowerOptIrToAArch64(P)
  observe(level0, P, Ii) == observe(level1, M, Ii)

property backend-preserves-observations(profile):
  (Phys, Obj) = compileAArch64Object(M)
  observe(level1, M, Ii) == observe(level2, Phys, Ii)
  observe(level2, Phys, Ii) == observe(level3, decode(Obj), Ii)
```

Lanes report skips with stable reasons when a generated program reaches an
excluded opcode; the skip rate per profile is a tracked report metric so
interpreter coverage growth is driven by real generator demand.

### Coverage and skip governance

Coverage catalogs are committed source artifacts, not ad hoc test fixtures.
Every `excluded:<stable-reason>` entry names an owner, the reason the construct
cannot yet be interpreted, the lanes affected, and either an expiry wave or a
review note that says why the exclusion is intentionally permanent.

Default required lanes may pass with skips only while both conditions hold:

- The lane's skip rate is at or below 10% for every required profile and at or
  below 5% for the aggregate default run.
- No single operation kind, opcode form, or proof construct accounts for more
  than half of the lane's skips. A temporary exception requires a per-lane
  override in the canonical lane inventory or the exclusion catalog that names
  the construct, owner, tracked issue, expiry wave, and replacement evidence.
  The generic owner field on every exclusion entry is not enough.

Crossing either threshold makes the lane `failed` with
`skip-budget-exceeded:<lane>:<profile>`, not top-level `passed`. Optional
environment-gated lanes (`llvm-mc`, user-mode QEMU, system-mode QEMU, herd7
regeneration, Lean regeneration) report
`skipped:missing-env` without failing default `agent:check`, but a user or CI
job that explicitly requires the lane turns that same missing environment into
`failed`.

### Failure handling

- Every mismatch report includes the seed, profile, case index, input vector,
  both observations, and the divergent trace suffix.
- A replay entry point (`bun scripts/replay-differential-case.ts --seed ...`)
  reproduces one case deterministically.
- Minimization shrinks by dropping functions, blocks, and operations while the
  mismatch persists; the minimized program is committed as a named regression
  test with the original seed recorded, per the existing fuzzing discipline.

## Source-Level End-To-End Generation

OptIR generation catches lower-pipeline miscompiles quickly, but it cannot
prove the source-to-Checked-MIR half of the compiler. This phase therefore
adds a second generator family under `tests/support/source-generation/` that
emits complete `.wr` programs and expected observations.

```ts
export interface SourceGeneratorProfile {
  readonly profileKey: string;
  readonly grammarFeatures: readonly SourceGrammarFeatureKey[];
  readonly typeFeatures: readonly SourceTypeFeatureKey[];
  readonly proofFeatures: readonly SourceProofFeatureKey[];
  readonly maxModules: number;
  readonly maxItemsPerModule: number;
  readonly maxStatementsPerFunction: number;
  readonly expectedBehaviorKind: "constructive";
}
```

Requirements:

- Generated source must parse, resolve names, type check, monomorphize, build
  Proof MIR, pass proof checking, and compile through full image validation
  without using internal compiler structures as generator shortcuts.
- Expected observations are generator-known and constructive. For v1
  computational profiles, the generator constructs expressions from an
  expression DSL that carries symbolic results. For proof-relevant profiles,
  expected behavior may be marker/status oriented while proof obligations are
  checked by the Checked MIR interpreter, proof-soundness lanes, and
  must-reject mutants. Adding a separate source evaluator is an
  oracle-design change, not an enum extension.
- Required source profiles: `source-scalar-arith`, `source-branch-memory`,
  `source-validation-layout`, `source-session-obligations`,
  `source-private-state`, and `source-platform-effects`.
- Every generated source case is compared through four paths:

```text
generator-known expectation == level -1 (Checked MIR)
level -1 (Checked MIR)      == level 0 (OptIR)
minimal-profile image       == production-profile image
production-profile image    == QEMU projection when configured
```

- Source generation includes negative generation too: invalid resource flows,
  missing layout facts, invalid validation consumption, session/obligation
  leaks, and private-state misuse become must-reject corpus entries with
  expected diagnostic families.
- Source-level minimization shrinks modules, items, statements, expressions,
  and proof-relevant constructs while preserving parseability and the mismatch
  or rejection predicate.

## Coverage-Guided Generation

Seeded random generation stays deterministic, but it should not stay blind.
This phase adds a coverage-guided script lane once the default random suite is
stable:

- Instrument pass branches, e-graph rule gates, lowering selections, allocator
  decisions, branch-relaxation cases, linker relocation families, proof-checker
  rule branches, and interpreter opcode paths with stable coverage keys.
- Mutate existing OptIR and source seeds toward uncovered stable keys while
  preserving generator contracts and replayability. Mutations are deterministic
  from `(baseSeed, coverageKey, mutationOrdinal)`.
- Promote any seed that reaches a previously uncovered high-risk key into the
  committed seed set or a nightly seed corpus. Silent coverage regressions
  fail with `coverage-guidance:lost-key:<stableKey>`.
- Coverage guidance does not replace distribution audits. A generator can pass
  branch coverage and still be distributionally weak; both reports are kept.

Coverage keys are manual instrumentation points, not an auto-discovered
coverage dump. The required key set lives in
`tests/support/coverage-guidance/coverage-keys.ts` and is reviewed like a
fixture:

```ts
export interface MiscompileCoverageKey {
  readonly stableKey: string;
  readonly owner: string;
  readonly wave: number;
  readonly sourcePath: string;
  readonly riskReason: string;
  readonly family:
    | "opt-ir-pass"
    | "lowering-selection"
    | "allocation"
    | "layout-link"
    | "proof-check"
    | "interpreter";
}
```

V1 caps the required key set at 180 keys total: 40 OptIR pass keys, 30
lowering-selection keys, 30 allocation keys, 25 layout/link keys, 35
proof-check keys, and 20 interpreter keys. Adding keys beyond the cap requires
removing lower-value keys or changing this design. Unregistered dynamic keys,
seed-derived keys, per-node IDs, and host-path keys are ignored for guidance
credit and fail the coverage-key audit if emitted by a required lane. A lost
required key fails with `coverage-guidance:lost-key:<stableKey>`; an uncovered
new branch without a registered key is a review finding, not automatic scope
growth.

## Allocation Semantic Validation

A production verifier, not only a test lane, because allocation bugs are the
classic silent miscompile and validation is cheap relative to allocation:

- After allocation, spill/remat repair, and move resolution, run a symbolic
  value-flow check in the style of register allocation translation validation:
  walk virtual and physical functions in parallel, tracking which symbolic
  virtual values each physical register and spill slot holds, and require that
  every use site reads the value the virtual program read and every
  return/call boundary presents the values the virtual program presented.
- Clobber sets at call boundaries invalidate symbolic contents; reading an
  invalidated location is a verification failure.
- Failures surface as `AARCH64_BACKEND_ALLOCATION_FAILED` diagnostics with
  stable details naming the instruction, location, expected symbolic value,
  and found symbolic value, through the existing verification summary path.
- Join handling follows the Rideau-Leroy register-allocation validation shape:
  interpret resolved parallel copies on predecessor edges, then require
  symbolic equality for every virtual value live-in at the join. Values not
  live at the join may differ. Loops are handled by a monotone worklist over
  block-entry symbolic states until a fixed point or a real contradiction.
- A production fail-closed result is allowed only for an actual validation
  contradiction, unsupported backend CFG shape, or missing liveness/move
  metadata that the backend promised to produce. Legal reducible joins and
  loops in accepted backend IR must be accepted by the verifier; otherwise the
  verifier is incomplete and cannot be wired into production compiles yet.
- If a future backend intentionally emits an unsupported irreducible or
  exceptional-control-flow shape, the backend input contract must reject that
  shape before allocation or the allocation verifier must be extended before
  production can emit it.

## Barrier Conservation Validation

Sequential interpreters can record barrier instructions, but they cannot prove
that barriers are strong enough for hardware or device observation. This phase
therefore adds a narrower checkable contract instead of overstating the oracle:

- Lowering emits a stable memory-order obligation record for every OptIR
  operation whose imported facts require acquire/release, sequentially
  consistent, device-ordered, compiler-only, or barrier-domain behavior.
- Planning, pseudo-expansion, and post-RA scheduling preserve those obligations
  through stable origin keys. A barrier may be removed only with a
  fact-justified removal record that names the original obligation, the
  replacement instruction suffix or stronger surrounding barrier, and the
  target memory-order rule that permits the removal.
- The verifier compares pre-pass and post-pass obligation inventories. Missing
  obligations, weakened domains, reordered MMIO/device publications without a
  dependency edge, or unowned barrier removals fail with
  `AARCH64_BACKEND_BARRIER_CONSERVATION_FAILED`.
- Passing this lane means "the backend conserved its declared barrier
  obligations." It does not mean the declarations are sufficient for the
  device protocol; that claim belongs to the memory-order sufficiency lane.

## Memory-Order Sufficiency Checking

Barrier conservation proves the backend did not drop its declared obligations.
The sufficiency lane checks whether those obligations are strong enough for
the device and cross-core patterns Wrela claims to support.

Inputs:

- imported memory-order and region-type facts (`relaxed`, `acquire`,
  `release`, `acquireRelease`, `sequentiallyConsistent`, `deviceOrdered`,
  `compilerOnlyOrdered`, region memory type, barrier domain, publication
  shape)
- selected machine instructions and barrier sequences (`ldar`, `stlr`, LSE
  suffixes, `dmb`, `dsb`, MMIO notifications)
- target memory-model declarations from the authenticated target surface
- publication/observation patterns from runtime and platform primitives

External authority:

```text
WRELA_HERD7    path to herd7
```

The validation-owned memory-order checker lowers each obligation to a
committed litmus file plus a normalized expected verdict fixture. The default
suite checks the committed verdict fixture without requiring herd7 locally.
When `WRELA_HERD7` is configured, the regeneration lane runs herd7 with the
committed target model, normalizes allowed/forbidden outcomes, and fails if the
fresh verdict differs from the checked-in fixture. A missing, stale, or
over-broad verdict fixture is a required-lane failure, not an optional skip.
Every verdict fixture stores an `AuthorityFixtureIdentity` with
`authorityKey: "herd7"`, the committed herd/target model fingerprint, litmus
generator version, publication-shape corpus fingerprint, fixture schema
version, and seed key when generation is sampled.

### Expressible fragment and Device-nGnRE residue

The committed herd model has a declared expressible fragment. V1 only credits
herd7 verdicts for:

- normal-memory release/acquire and sequentially consistent publication
  patterns that the committed model represents directly
- selected AArch64 acquire/release instructions and `dmb`/`dsb` domains that
  appear in the target barrier-selection table
- abstract device events only when the model states exactly which endpoint
  observation is represented

Each publication shape records
`memoryOrderCheckKind: "directly-checked" | "conservative-proxy" |
"hand-reviewed-rule"`. A `conservative-proxy` verdict can justify a compiler
barrier choice, but it cannot claim that a real device endpoint observed a
write unless the hand-reviewed rule table below supplies that missing step.

| Publication shape             | V1 check kind      | herd7 credit                                                            | Residual rule required before claiming device observation                        |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `descriptorWrite`             | directly-checked   | normal-memory payload writes are ordered before release publication     | none beyond target memory-model identity                                         |
| `virtioAvailIndexPublication` | directly-checked   | descriptor/ring writes are ordered before the avail-index release       | none beyond target memory-model identity                                         |
| `ringDoorbellPublication`     | conservative-proxy | normal-memory writes are ordered before the modeled MMIO doorbell event | Device-nGnRE write-completion residue must be discharged by target rule          |
| `usedRingObservation`         | directly-checked   | acquire observation orders later payload reads                          | if the observation is via MMIO, Device-nGnRE read-side target rule must be cited |
| `firmwareCallBoundary`        | hand-reviewed-rule | no herd7 credit unless a concrete litmus is listed for the boundary     | target wrapper contract must name the firmware ordering rule                     |
| `ordinarySynchronization`     | directly-checked   | target-declared acquire/release pair forbids the listed bad outcome     | none beyond target memory-model identity                                         |

Device-nGnRE residue is reviewed against the Arm Architecture Reference Manual
for A-profile, DDI0487, section
[B2.10.2 "Device memory"](https://developer.arm.com/documentation/ddi0487/mc/-Part-B-The-AArch64-Application-Level-Architecture/-Chapter-B2-The-AArch64-Application-Level-Memory-Model/-B2-10-Memory-types-and-attributes/-B2-10-2-Device-memory?lang=en),
and Arm's
[Device memory](https://developer.arm.com/documentation/107565/0101/Memory-system/Memory-types-and-attributes/Device-memory)
overview. The rule table is committed with the target memory model:

| Device rule                                       | Source section                                             | V1 compiler obligation                                                                                                                   | What herd7 does not prove                                                               |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| non-Gathering (`nG`)                              | DDI0487 B2.10.2 Device memory                              | preserve individual MMIO access count and width; no coalescing or widening in lowering/scheduling                                        | endpoint side-effect completion                                                         |
| non-Reordering (`nR`)                             | DDI0487 B2.10.2 Device memory                              | preserve relative order of modeled Device accesses and reject scheduler moves across device-order barriers                               | ordering between a device endpoint side effect and unrelated normal-memory observations |
| Early Write Acknowledgement (`E`) in Device-nGnRE | DDI0487 B2.10.2 Device memory; Early Write Acknowledgement | require a target rule such as a completion read, poll, firmware contract, or stronger nGnRnE mapping before claiming endpoint completion | that a completed `dmb`/`dsb` means the peripheral endpoint has consumed the write       |

The `ringDoorbellPublication` row is therefore deliberately weaker than a
device-completion proof in v1: it proves that the compiler selected and
preserved the strongest declared sequence and that the normal-memory portion
of the publication is ordered. It does not prove endpoint completion for
Device-nGnRE without an explicit target rule. Wave 12 is blocked until every
required publication shape is classified by this table.

The lane lowers each supported publication shape into a small litmus or
axiomatic obligation:

```text
descriptorWrite -> descriptor payload stores before descriptor publication
virtioAvailIndexPublication -> descriptor stores visible before avail index
ringDoorbellPublication -> avail-index publication before modeled MMIO notify
usedRingObservation -> acquire observation before payload read
firmwareCallBoundary -> conservative full-system ordering at call boundary
ordinarySynchronization -> target-declared acquire/release pair
```

For each obligation, the checker proves one of:

- the selected instruction/barrier sequence forbids the bad outcome under the
  target memory model
- the obligation is intentionally over-conservative and uses a stronger
  target-declared sequence
- the target surface lacks enough information, which is a failure in required
  profiles and `skipped:missing-target-memory-model` only in optional
  experimental targets

Reports include the fact key, operation key, publication shape, selected
sequence, target rule, and forbidden outcome. This lane is not QEMU-based:
QEMU TCG may execute the bytes for integration smoke, but the memory-order
claim comes from the explicit model.

## External Encoding Cross-Check

Fixture-backed by default and environment-gated for regeneration, mirroring
the external authority pattern:

```text
WRELA_LLVM_MC            path to llvm-mc (or compatible assembler driver)
WRELA_LLVM_MC_TRIPLE     defaults to aarch64-unknown-none
```

- Lane 1 (fixtures): for every entry in `RPI5_KNOWN_BYTE_FIXTURES`, the
  default suite checks the committed normalized external-assembly verdict. When
  configured, regeneration renders the fixture's assembly text, assembles
  externally, and diffs against the committed bytes. Any diff fails the audit
  with
  `encoding-audit:fixture-mismatch:<fixtureId>`.
- Lane 2 (fuzzed operands): for a seeded sample of catalog entries with
  randomized legal operands (registers, immediates within encodable ranges),
  the default suite checks the committed external verdict fixture. Regeneration
  encodes with the production encoder, assembles the rendered text externally,
  and diffs.
- Lane 3 (disassembly spot check, optional): disassemble emitted `.text` from
  generated-program objects and compare mnemonic/operand rendering for a
  seeded sample of instructions.
- When the environment is not configured, the regeneration audit reports
  `skipped:missing-env` with the required variables named, while the
  fixture-backed default lane still runs and fails on stale or missing verdict
  fixtures.
- Every committed verdict fixture stores an `AuthorityFixtureIdentity` with
  `authorityKey: "llvm-mc"`, normalized tool identity, encoding catalog
  fingerprint, assembly renderer version, operand-sample corpus fingerprint,
  fixture schema version, and seed key for fuzzed operands.
- The assembly text renderer lives in test support and is validation-owned;
  production modules never render assembly text for this purpose.
- External tool output never becomes production authority; a passing local
  suite with a failing external audit is a release blocker to be resolved by
  humans, not by code that trusts one side automatically.

## Interpreter Cross-Validation

The machine, physical, and decoded-byte lanes depend on the AArch64
interpreter. This phase adds semantic golden fixtures that compare supported
opcode behavior against QEMU single-instruction execution.

- The single-instruction harness uses user-mode QEMU from
  `WRELA_QEMU_AARCH64_USER`, not the system-mode firmware runner.
- For each supported opcode form, generate or hand-author a bounded set of
  operand/value/memory cases that cover edge values, flag behavior, trap
  families, memory access widths, register aliases, and barrier/effect-token
  behavior where sequentially observable.
- Execute each case through the project interpreter and through a tiny
  generated QEMU harness that runs one instruction sequence with controlled
  register and memory state. The QEMU harness is env-gated, but its resulting
  semantic golden fixture is committed and checked by default.
- Golden fixtures record inputs, expected registers, expected NZCV, observed
  memory, trap family, and effect classification. They do not record timing or
  microarchitectural behavior.
- A stale fixture fails when opcode semantics, fixture generation, or the
  target catalog changes without regeneration. A QEMU disagreement blocks
  release until humans decide whether the interpreter, fixture, or target
  assumption is wrong.
- Every committed semantic fixture stores an `AuthorityFixtureIdentity` with
  `authorityKey: "qemu-aarch64-user"`, normalized user-mode QEMU identity,
  opcode catalog plus target-surface fingerprint, single-instruction harness
  generator version, operand-case corpus fingerprint, fixture schema version,
  and seed key when generation is sampled.
- The lane is credited with interpreter semantic cross-validation, not with
  proving the AArch64 architecture or QEMU correct.

## Behavioral End-To-End Execution

Extensions to the full image validation phase:

### Value-carrying markers

- Fixture console markers carry computed values:
  `WRELA_PACKET_COUNTER_OK:<count>` instead of a fixed string. The smoke
  classifier grows a `valueMarker` form that parses the suffix and compares
  against the case's expected value.
- The `PacketCounterImage` fixture contract is amended so
  `write_packet_counter_marker(count)` renders the count into the marker. The
  computed arithmetic in the flagship fixture becomes observable.

### Fixture observation matrices

Each behavioral fixture declares a table of input bytes and expected
observations:

```ts
export interface FixtureObservationCase {
  readonly caseKey: string;
  readonly fixtureBytes: readonly number[];
  readonly expected:
    | { readonly kind: "marker"; readonly marker: string }
    | { readonly kind: "status"; readonly status: string };
}
```

`PacketCounterImage` v1 matrix covers at minimum: the success case, the
too-short buffer, the over-limit buffer, the `fits` failure, the
`ignored`-kind branch, and boundary values of `counter_delta` (0, 1, 255).
Each row compiles once and runs per-row when the fixture source provider is
parameterized, or compiles per-row when it is not; either way the matrix is
part of the acceptance gate, with QEMU rows gated on the system-mode smoke
configuration (`WRELA_QEMU_AARCH64_SYSTEM` plus AAVMF firmware variables).

### Interpreter reference checker

A ninth reference checker in the full image validation set:

```text
interpreter-reference:
  execute the case's optimized OptIR through the level 0 interpreter with the
  fixture bytes bound to the fixture source primitive, and compare the
  observed marker writes and return status against the case expectations
```

Allowed inputs: optimized OptIR program, fixture observation case, runtime
call catalog. Output: per-case observation equality evidence. This makes the
oracle chain and the acceptance harness meet: interpreter, QEMU, and
hand-written expectations triangulate every behavioral case.

### Optimization profile differential

- Define a `minimal` optimization profile: construction cleanup, mandatory
  semantic inlining, and nothing else — the least transformation that still
  satisfies lowering's input contract. A pass is allowed in `minimal` only when
  all wrapper reasons and required producers for that lowering contract are
  implemented; otherwise the profile definition is incomplete and the lane is
  blocked rather than silently expanded.
- Every behavioral fixture compiles under both `minimal` and `production`
  profiles; both images must produce equivalent observations (interpreter
  lane always; QEMU lane when configured).
- This is the "second compiler for free": most optimizer miscompiles appear
  as a disagreement between the two profiles without any oracle needed.

## Firmware-Host Fault Simulation

The compiler core is deterministic and pure; firmware-host interaction is not.
This phase adds deterministic fault simulation at the target-driver boundary
using the existing injected `hostEffects` pattern.

Fault profiles:

- QEMU harness setup: temporary-directory creation, artifact writes, startup
  script writes, firmware variable-store copy, process launch, timeout,
  process failure, serial-output truncation, and cleanup failure.
- UEFI runtime and boot-service wrappers: allocation failure, watchdog setup
  failure, console write failure, memory-map query failure, exit-boot-services
  retry/failure, and runtime service failure where the target surface exposes a
  fakeable effect.
- Platform primitive wrappers: malformed fixture source bytes, short reads,
  over-limit buffers, unavailable device state, and injected status-code
  returns.

Requirements:

- Fault schedules are deterministic from `(fixtureKey, faultProfileKey, seed)`
  and use fakes through dependency injection. They do not mock global state or
  patch production modules.
- Each fault case declares the expected marker/status observation and the
  cleanup expectations for host artifacts. A case that panics, leaks host
  artifacts, drops diagnostics, or produces nondeterministic report ordering
  fails.
- Simulation evidence is scoped to host and firmware boundary behavior. It
  does not replace QEMU smoke, byte validation, or semantic differential
  lanes.

## Proof Checker Soundness Evidence

An unsound proof-checker acceptance is the one miscompile class no
differential lane in this design can see: the accepted IR is wrong before any
transformation runs, and every oracle faithfully executes it. It is also the
deepest trust assumption in the system, because certified facts license
downstream rewrites. This phase adds four evidence lanes: differential
verdict/fact comparison, must-reject pressure, modeled-fragment expansion with
Lean decision-table checker components, and formal observation equivalence for
the pass legality contract.

### Lane 1: differential against the Lean executable checkers

The Lean sidecar (`proof-model/`) already contains executable checkers with
machine-checked soundness theorems (Models 8, 9, and 12 in particular). This
lane uses them as a verdict and modeled-fact oracle for the modeled fragment:

- A translation module in test support maps bounded Proof MIR programs into
  the Lean model's command/CFG shapes. The translation is deliberately small
  and covers only the modeled fragment: field-sensitive places, loans,
  obligations, session members, validation flow, private-state facts,
  terminal returns, `Attempt`-style fallible consumes, and bounded CFGs.
- A seeded generator (extending the existing
  `smallProofMirProgramArbitrary()` family) produces bounded programs inside
  the modeled fragment, biased toward accept/reject boundaries: off-by-one
  obligation discharge, branch-join disagreements, facts consumed after
  private-state advance, tokens discharged through the wrong session, and
  validation results used twice.
- For each program, the TypeScript checker's accept/reject decision is
  compared with the Lean checker's decision. Any disagreement fails the lane:
  a TypeScript accept with a Lean reject is a candidate soundness hole; a
  TypeScript reject with a Lean accept is a completeness gap, reported
  separately so strictness regressions stay visible.
- For accepted programs inside the modeled fragment, compare the modeled
  certified fact/authority judgments as well as the verdict bit. The fixture
  records a stable projection of each modeled fact kind, subject, scope,
  dependency, invalidation, and authority entry. Accept/accept with a divergent
  fact packet is a soundness finding because downstream rewrites consume facts,
  not just the accept bit.
- The Lean toolchain is environment-gated like QEMU and `llvm-mc`
  (`WRELA_LEAN_LAKE` naming the `lake` binary). The lane precomputes Lean
  verdicts and modeled fact projections for the committed seed range into a
  checked-in fixture, so the default test run compares against the fixture
  without needing Lean installed; a configured environment regenerates and
  re-verifies the fixture. A stale fixture (generator or translation changed
  without regeneration) fails closed.
- Translation fidelity gets its own tests because the Lean lane has only two
  paths, not the three-way triangulation used by end-to-end behavior. Required
  translation tests include canonical round trips for the modeled fragment,
  translating the must-reject corpus through the Lean path where representable
  and requiring Lean rejection, and negative fixtures for constructs that must
  report `outside-modeled-fragment` instead of being approximated.
- Untranslatable programs are `skipped:outside-modeled-fragment` with the
  construct named, and the skip rate is a tracked report metric: it measures
  exactly how much of the real checker the Lean model can vouch for, and it
  is the driving demand signal for extending the Lean models.

### Lane 2: must-reject corpus

Soundness bugs surface as wrongful acceptance, so acceptance needs adversarial
pressure independent of the Lean fragment:

- A committed corpus of programs that must be rejected, each annotated with
  the invariant it violates and the expected diagnostic family: leaked
  obligations, use-after-move, double validation consumption,
  cross-session discharge, terminal fallthrough, layout reads without
  `fits` facts, and facts surviving private-state advance.
- Mutation-derived cases: take accepted fixture programs and apply targeted
  proof-relevant mutations (drop a discharge, duplicate a consume, reorder a
  fact dependency); every mutant must be rejected. An accepted mutant fails
  the lane and is a candidate soundness finding.
- The corpus grows by the same discipline as differential failures: every
  soundness-adjacent bug ever found, in any lane, adds its minimized
  must-reject program here permanently.

### Lane 3: modeled-fragment expansion and decision-table derivation

The Lean-modeled fragment must grow until it covers the proof-relevant surface
that source generation and production lowering actually exercise:

- layout entailment arithmetic: bounded affine terms, comparison entailment,
  `layoutFits`, `payloadEnd`, field availability, range constraints, and
  unsigned-overflow requirements
- dominance and fact lifetime: branch/loop dominance, stale fact invalidation,
  private-state generation advance, and path-scoped fact availability
- unbounded CFG shapes through induction-friendly summaries rather than only
  fixed-size generated graphs
- ABI and platform facts that license downstream backend behavior, including
  memory-order and layout ABI facts

For each expanded fragment, v1 derives a finite decision table from the Lean
development and checks that table with a small TypeScript verifier. Each
component records `componentKey`, Lean source/theorem hash, modeled-fragment
schema hash, generator version, table hash, emitted TypeScript wrapper hash,
and diagnostic-shaping version. A component is stale if any recorded input
changes without regenerating the table, and stale components fail before any
verdict comparison runs. Hand-written TypeScript remains allowed around the
table for IO-free plumbing, diagnostic shaping, and integration, but the
soundness-critical accept/reject or fact-judgment decision must be table
derived. Direct Lean code extraction can replace the decision-table mechanism
only in a later design revision that gives the extracted code the same
component-level staleness and boundary-test story.

Acceptance for this lane is not "skip rate reported"; it is
`outside-modeled-fragment` at zero for required proof-relevant source
generation profiles and all committed proof-soundness corpus entries.

### Lane 4: formal observation equivalence

The observation contract is formalized in the Lean sidecar for the fragment
that optimization legality depends on:

- observed values, memory regions, effect order, trap families, proof erasure,
  and step-limit failure policy
- projection obligations for OptIR-to-machine values, ABI returns, memory
  regions, and internal frame/spill traffic
- pass legality theorems or checked obligations that say a modeled rewrite
  preserves the formal observation relation

The TypeScript observation comparator exports canonical fixtures into the Lean
format and imports Lean-approved equivalence fixtures back into tests. A
change to the TypeScript comparator that diverges from the Lean relation fails
the observation-equivalence tests.

### What this does and does not establish

Together the lanes establish that the TypeScript checker agrees with a
machine-verified checker on verdicts and modeled fact judgments, rejects a
curated and mutation-generated adversarial corpus, and routes the required
modeled-fragment decisions through Lean decision-table artifacts. They do not
prove future checker extensions sound automatically: new proof-checker
features must enter the modeled fragment, a decision-table-derived checker
component, or an explicitly excluded experimental surface before they can
participate in required source-generation profiles.

## Configuration Swarming

A seeded script lane (not in default `agent:check`):

- First add a pass-contract manifest for every swarmed pass: preserved
  analyses, invalidated analyses, required facts, produced facts, required
  ordering predecessors, allowed fixpoint groups, and whether the pass may
  introduce, remove, or reorder potentially trapping operations. The manifest
  has separate `mayIntroducePotentialTrap`, `mayRemovePotentialTrap`, and
  `mayReorderPotentialTrapRelativeToEffects` fields. A missing reorder field
  fails closed as `false`; a `true` value must name the observation-contract
  theorem or checked obligation that preserves first-trap family and ordered
  effects. `pass-order-policy.ts` alone is not enough evidence to decide legal
  permutations.
- Enumerate legal pass-order permutations within that manifest. Fixpoint
  groups may reorder internally only when their contracts say the order is
  commutative for the observation contract; cross-group ordering respects
  declared dependencies.
- Enumerate policy variants (inlining thresholds, vectorization on/off,
  e-graph on/off) and register model variants already expressible through the
  target surface (reduced allocatable sets to force spill pressure).
- For each swarm configuration and each generated/fixture program: compile and
  require observation equivalence with the production configuration through
  the oracle chain.
- Report: configuration key, program key, equivalence status. Committed seed;
  bounded configuration count per run; nightly cadence.

## Verification Completion

Production changes, all small and fail-closed:

- Wire `frame-verifier.ts` into the backend function pipeline after frame
  layout, with its runs recorded in the verification summary.
- Replace `passedAArch64BackendVerification()` blanket summaries: each stage
  records its own `verifierRun` as it executes, and the summary is the
  accumulated record. A stage without a dedicated check records
  `status: "passed"` with `stableDetail: "structural-only"` so the summary
  stops overstating evidence.
- Implement `diagnosticMode` on `CompileAArch64ObjectInput`: `strict` runs the
  OptIR fact verifier at optimizer checkpoints, enables allocation semantic
  validation trace retention, and keeps rewrite-legality records; `default`
  keeps current behavior; or, if this proves low-value once the above land,
  delete the field. Declared-but-unread configuration is worse than either.
- Run the OptIR `fact-verifier` at optimizer checkpoints in test and strict
  modes so stale fact subjects fail near their cause instead of at backend
  import.

## Mutation Audit

A deterministic audit of the test suite itself:

- `scripts/mutation-audit.ts` applies a closed set of source mutations
  (operator swap, comparison flip, constant nudge, branch inversion, early
  return, clobber-set element drop) to a configured module list, runs the
  narrowest test command covering each module, and records caught/uncaught
  per mutant.
- Required v1 module list: `object/encoding-*.ts`, `allocation/allocator.ts`,
  `allocation/move-resolution.ts`, `object/branch-relaxation.ts`,
  `passes/memory-optimization.ts`, `passes/licm.ts`,
  `frame/prologue-epilogue.ts`, `src/linker/relocation-application.ts`.
- Mutants are generated from a committed seed and mutation catalog so the
  report is reproducible; uncaught mutants are the actionable output and feed
  new differential profiles or fixtures.
- Scheduled/nightly lane; never in `agent:check`.

## Public API Shape

Harness types live in validation-owned modules, not production compiler
modules. The lane-key union is a code projection of the canonical lane
inventory above:

```ts
export type MiscompileConfidenceLaneKey =
  | "checked-mir-differential"
  | "source-generation-differential"
  | "opt-ir-pass-differential"
  | "opt-ir-schedule-differential"
  | "lowering-differential"
  | "backend-differential"
  | "decoded-bytes-differential"
  | "linked-decoded-bytes-differential"
  | "barrier-conservation"
  | "memory-order-sufficiency"
  | "interpreter-qemu-cross-validation"
  | "profile-differential"
  | "firmware-host-fault-simulation"
  | "configuration-swarm"
  | "coverage-guided-generation"
  | "encoding-external-audit"
  | "interpreter-reference"
  | "proof-soundness-differential"
  | "proof-modeled-fragment-derivation"
  | "observation-equivalence-formalization"
  | "proof-must-reject"
  | "cross-process-platform-determinism"
  | "mutation-audit";

export interface MiscompileConfidenceCaseReport {
  readonly caseKey: string;
  readonly lane: MiscompileConfidenceLaneKey;
  readonly programKey: string;
  readonly seed: string;
  readonly status: "equivalent" | "mismatch" | "skipped" | "failed";
  readonly required: boolean;
  readonly stableDetail: string;
  readonly skipReason?: string;
  readonly mismatch?: MiscompileObservationMismatch;
}

export interface MiscompileObservationMismatch {
  readonly inputVectorKey: string;
  readonly leftLevel: string;
  readonly rightLevel: string;
  readonly leftObservation: string;
  readonly rightObservation: string;
  readonly divergentTraceSuffix: readonly string[];
}

export interface MiscompileConfidenceReport {
  readonly schema: "wrela.miscompile-confidence";
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed" | "skipped";
  readonly authorityFixtures: readonly AuthorityFixtureIdentity[];
  readonly liveAuthorityRuns: readonly LiveAuthorityRunIdentity[];
  readonly coverage: MiscompileCoverageSummary;
  readonly cases: readonly MiscompileConfidenceCaseReport[];
}

export interface MiscompileCoverageSummary {
  readonly optIrOperationKinds: CoverageCounts;
  readonly sourceGrammarFeatures: CoverageCounts;
  readonly sourceProofFeatures: CoverageCounts;
  readonly machineOpcodeForms: CoverageCounts;
  readonly physicalOpcodeForms: CoverageCounts;
  readonly checkedMirConstructs: CoverageCounts;
  readonly proofModeledFragment: CoverageCounts;
  readonly memoryOrderPublicationShapes: CoverageCounts;
  readonly qemuCrossValidatedOpcodeForms: CoverageCounts;
  readonly skipRateByLane: readonly {
    readonly lane: MiscompileConfidenceLaneKey;
    readonly profileKey?: string;
    readonly rate: string;
    readonly budgetStatus: "within-budget" | "exceeded";
  }[];
}

export interface CoverageCounts {
  readonly supported: number;
  readonly excluded: number;
  readonly excludedKeys: readonly string[];
}
```

Reports use closed unions, stable details, and deterministic ordering, and may
be snapshotted. Top-level status is computed, not hand-authored:

- `failed` if any required case is `mismatch` or `failed`, any required lane
  exceeds its skip budget, any required coverage catalog has an unclassified
  entry, or a requested optional lane cannot run.
- `skipped` only when no required lane ran because the caller requested an
  optional-only configuration whose environment was missing.
- `passed` only when every required lane is equivalent and all required skip
  rates are within budget. A high skip rate cannot produce top-level `passed`
  merely because every executed case matched.

## Repository Shape

The repository tree below is an implementation projection of the canonical lane
inventory, not a second source of truth. If a lane key, script, test, coverage
field, or acceptance row disagrees with the canonical table, the table wins and
the projection must be fixed.

```text
docs/
  design/
    miscompile-confidence-design.md

scripts/
  run-differential-suite.ts
  replay-differential-case.ts
  run-source-generation-suite.ts
  encoding-external-audit.ts
  qemu-single-instruction-audit.ts
  memory-order-sufficiency-check.ts
  regenerate-herd7-verdict-fixtures.ts
  firmware-host-fault-simulation.ts
  configuration-swarm.ts
  coverage-guided-generation.ts
  cross-process-determinism.ts
  mutation-audit.ts
  regenerate-lean-verdict-fact-fixture.ts
  regenerate-qemu-semantic-fixtures.ts

src/
  opt-ir/
    interpreter.ts                     (coverage contract, whole-program eval)
    passes/
      pass-contract-manifest.ts        (swarming legality input)
  proof-check/
    lean-derived/
      modeled-fragment-checker.ts      (generated decision-table verifier, no host deps)
    interpreter/
      checked-mir-interpreter.ts       (new, level -1)
  target/aarch64/
    interpreter/
      machine-ir-interpreter.ts        (opcode coverage growth)
      physical-ir-interpreter.ts       (new, level 2)
      decoded-bytes-execution.ts       (new, level 3)
      linked-decoded-bytes-execution.ts (new, linked level 3)
    backend/
      verify/
        allocation-semantic-verifier.ts (new, production)
        barrier-conservation-verifier.ts (new, production/test evidence)

tests/
  support/
    opt-ir/generated-programs/
      generator.ts
      profiles.ts
      input-vectors.ts
      minimizer.ts
      distribution-audit.ts
    source-generation/
      generator.ts
      profiles.ts
      expected-behavior.ts
      minimizer.ts
      proof-shapes.ts
    coverage-guidance/
      coverage-keys.ts
      seed-mutation.ts
    miscompile-confidence/
      observation.ts
      lanes.ts
      report.ts
      memory-order-sufficiency.ts
      herd7-verdict-fixtures.ts
      qemu-semantic-fixtures.ts
      firmware-host-faults.ts
      authority-fixture-identity.ts
    proof-check/soundness/
      lean-model-translation.ts
      lean-verdict-fact-fixture.ts
      lean-observation-equivalence.ts
      decision-table-component-fixtures.ts
      boundary-program-generators.ts
      must-reject-corpus/
    target/aarch64/
      interpreter-coverage-catalog.ts
  unit/
    opt-ir/generated-program-generator.test.ts
    source-generation/source-generator.test.ts
    source-generation/source-expected-behavior.test.ts
    miscompile-confidence/memory-order-sufficiency.test.ts
    miscompile-confidence/herd7-verdict-fixtures.test.ts
    miscompile-confidence/qemu-semantic-fixtures.test.ts
    miscompile-confidence/coverage-guidance.test.ts
    proof-check/checked-mir-interpreter.test.ts
    proof-check/lean-model-translation.test.ts
    proof-check/lean-observation-equivalence.test.ts
    proof-check/lean-derived-checker.test.ts
    target/aarch64/physical-ir-interpreter.test.ts
    target/aarch64/decoded-bytes-execution.test.ts
    target/aarch64/backend/allocation-semantic-verifier.test.ts
  integration/
    miscompile-confidence/
      checked-mir-differential.test.ts
      source-generation-differential.test.ts
      opt-ir-pass-differential.test.ts
      opt-ir-schedule-differential.test.ts
      lowering-differential.test.ts
      backend-differential.test.ts
      decoded-bytes-differential.test.ts
      linked-decoded-bytes-differential.test.ts
      barrier-conservation.test.ts
      memory-order-sufficiency.test.ts
      firmware-host-fault-simulation.test.ts
      coverage-guided-generation.test.ts
      cross-process-determinism.test.ts
      profile-differential.test.ts
    proof-check/
      proof-soundness-differential.test.ts   (fixture-backed by default)
      proof-modeled-fragment-derivation.test.ts
      observation-equivalence-formalization.test.ts
      proof-must-reject.test.ts
  system/
    miscompile-confidence/
      encoding-external-audit.test.ts          (env-gated)
      qemu-behavioral-matrix.test.ts           (env-gated)
      qemu-single-instruction-audit.test.ts    (env-gated)
      herd7-verdict-regeneration.test.ts       (env-gated)
      lean-verdict-fact-regeneration.test.ts   (env-gated)
      cross-platform-determinism.test.ts       (CI matrix)
```

Production runtime source remains dependency-free. Interpreter code is
production source (it is pure and dependency-free) but is never on the compile
path; audit tests enforce that no production compile module imports an
interpreter. Generators, comparators, and harnesses live in test support and
scripts. External tool, user-mode QEMU, system-mode QEMU, herd7, and Lean
invocations live in scripts and env-gated system tests only.

## Determinism

- Every lane is deterministic from `(profileKey, seed, configuration)`.
- Committed seeds per lane; failures record the full replay key.
- Reports sort by `(lane, caseKey)` with stable details only; no timings,
  paths, or host data in report bodies.
- The mutation audit derives mutants from a committed catalog and seed.
- QEMU observation classification follows the full-image-validation rules:
  classification results are deterministic even though serial output is not.

### Cross-process and cross-platform checks

The deterministic report contract is itself tested:

- Cross-process: run the default differential suite twice in fresh processes
  with the same committed seeds and compare generated programs, minimized
  replay keys, reports, diagnostics, and emitted artifacts byte for byte.
- Cross-platform: run the same deterministic suite on every supported
  development platform in CI. Paths, temporary directories, process IDs,
  timings, locale, CPU count, filesystem traversal order, and host endianness
  may not appear in stable report bodies.
- Cross-toolchain: configured `llvm-mc`, user-mode QEMU, system-mode QEMU,
  herd7, and Lean lanes record tool identity separately from stable results. A
  tool-version change can require fixture regeneration, but it may not silently
  change default report ordering or replay keys.
- Any nondeterministic mismatch fails with
  `miscompile-determinism:<artifact>:<firstMismatchKey>` and preserves both
  reports as debug artifacts.

## Error Handling

- Differential lanes fail closed: `mismatch` fails the suite; `skipped`
  requires a cataloged reason; an interpreter crash or generator contract
  violation is `failed`, never `skipped`.
- Oracle disagreement between levels 1/2/3 with level 0 agreement still fails:
  a wrong oracle is a finding, not noise.
- Missing external tools, user-mode QEMU, system-mode QEMU, herd7, or Lean env:
  `skipped:missing-env` in optional lanes, failure in lanes explicitly
  requested as required.
- Minimization failure preserves the unminimized reproducer; a case that
  cannot be replayed from its recorded key is itself a suite failure.

## Testing Strategy

Unit tests:

- generator produces structurally valid, interpreter-complete programs across
  all profiles and a seed range
- source generator produces parseable, type-checkable, proof-checkable `.wr`
  programs with generator-known expected behavior across all required source
  profiles
- generator distribution audit stays within committed bounds
- coverage-guidance mutation preserves generator contracts and reaches
  targeted stable coverage keys deterministically
- observation equality: value, memory, effect, trap, and trace comparisons
- Lean observation-equivalence fixtures agree with TypeScript comparator
  behavior
- interpreter coverage catalogs reject unclassified operation kinds/opcodes
- user-mode QEMU semantic fixture importer rejects stale opcode semantics and
  malformed golden fixtures
- physical IR interpreter: register file, frame slots, parallel copy output,
  NZCV semantics against known-byte semantic fixtures
- decoded-bytes execution: decode/execute round trip on hand-built objects,
  branch target resolution through symbols and relocations
- linked decoded-bytes execution: final `.text` address mapping and relocation
  projection from linked image layout
- allocation semantic verifier: catches seeded wrong-register, missed-clobber,
  wrong-slot, lost-copy, and join-merge defects; accepts correct allocations
  with loops
- barrier conservation verifier: catches missing, weakened, reordered, and
  unowned-removal barrier obligations
- memory-order sufficiency checker rejects bad outcomes for required
  publication shapes and reports missing target memory-model data
- firmware-host fault schedules are deterministic and exercise every declared
  `hostEffects` failure family without leaking host artifacts
- Checked MIR interpreter: construct evaluation, proof-only command erasure
  markers, fixture byte binding, coverage catalog rejection
- Lean model translation: modeled-fragment round trips, outside-fragment
  constructs report stable skip reasons, must-reject cases translate to Lean
  rejection when representable
- Lean decision-table-derived checker components agree with source TypeScript
  wrapper diagnostics, reject malformed generated artifacts, and fail closed on
  component-level staleness
- minimizer preserves the mismatch predicate while shrinking
- report determinism and replay-key round trip

Integration tests:

- Checked MIR differential: level -1 vs fixture expectations and vs level 0
  across OptIR construction, over the behavioral fixture corpus
- source-generation differential: generator-known expectations vs Checked MIR,
  Checked MIR vs OptIR, minimal profile vs production profile, and QEMU
  projection when configured
- pass and schedule differential lanes over committed seed ranges per profile
- lowering, backend, decoded-bytes, linked decoded-bytes, and barrier
  conservation lanes
- memory-order sufficiency over committed publication-shape fixtures and
  generated memory-order profiles
- firmware-host fault simulation over QEMU harness setup, UEFI wrapper, and
  platform primitive fault profiles
- coverage-guided generation reaches required high-risk coverage keys without
  losing committed random-distribution bounds
- profile differential over behavioral fixtures
- interpreter-reference checker inside full image validation cases
- proof-soundness differential against the committed Lean verdict/fact fixture,
  failing closed on stale fixtures and divergent modeled fact packets
- proof modeled-fragment derivation over required layout, dominance, unbounded
  CFG, ABI, platform, and memory-order fact surfaces
- observation-equivalence formalization round trip between TypeScript
  observation reports and Lean fixtures
- cross-process determinism over default generated corpora, reports,
  diagnostics, minimized reproducers, and emitted artifacts
- must-reject corpus: every entry rejected with the expected diagnostic
  family; every proof-relevant mutant of accepted fixtures rejected
- regression corpus: every previously minimized mismatch replays green

System tests (env-gated):

- encoding external audit lanes 1–3
- system-mode QEMU behavioral matrix for value-carrying fixtures
- user-mode QEMU single-instruction semantic fixture regeneration and
  re-verification
- herd7 verdict fixture regeneration and re-verification
- Lean verdict/fact fixture regeneration and re-verification
- configuration swarm smoke (small bounded swarm)
- cross-platform determinism in the supported CI matrix

Audit tests:

- no production compile-path module imports interpreters, generators, or
  harness modules
- interpreter modules share no transformation-implementation code with the
  stages they check
- every closed opcode/operation inventory entry appears in a coverage catalog
- every required source grammar/proof feature appears in the source-generation
  coverage catalog
- every required memory-order publication shape appears in the sufficiency
  catalog
- every Lean decision-table-derived checker artifact has recorded derivation
  metadata, component-level staleness keys, and boundary tests
- verification summaries contain per-stage evidence, no blanket passes

## Build Waves

### Wave 1: Observation Model And Coverage Contracts

Shared observation types and comparators; OptIR operation coverage catalog;
machine opcode coverage catalog; cross-level projection contracts;
whole-program OptIR interpretation with seeded input vectors. Unit tests for
equality semantics, projection semantics, and coverage rejection. Cross-design
obligation: `Observation-contract home`.

### Wave 2: OptIR Generator And Pass Differentials

Generator with `scalar-arith`, `branchy-scalar`, and `memory-roundtrip`
profiles; distribution audits; pass-level and whole-schedule differential
lanes; minimizer and replay script. This wave delivers the single largest
confidence gain and depends on nothing downstream.

### Wave 3: Lowering Differential

Machine IR interpreter coverage growth driven by generator demand; lowering
differential lane; skip-rate reporting; `call-graph-small` profile.

### Wave 4: Backend Execution And Allocation Validation

Physical IR interpreter; backend differential lane with `spill-pressure`
profile; complete allocation semantic verifier with join/loop validation wired
into production; barrier conservation verifier; frame verifier wiring;
per-stage verification evidence; `diagnosticMode` implemented or removed.

### Wave 5: Bytes And Encoding Trust

Decoded-bytes and linked decoded-bytes execution with
`branch-distance-stress` profile; external encoding audit script and
env-gated system test; assembly text renderer in test support.

### Wave 6: Behavioral End-To-End

Value-carrying markers and classifier support; fixture observation matrices
for `PacketCounterImage`; `interpreter-reference` checker in full image
validation; `minimal` optimization profile and profile differential lane;
system-mode QEMU behavioral matrix system test. Cross-design obligation:
`Wrapper-reason producers`.

### Wave 7: Swarming And Suite Audits

Pass-contract manifest, configuration swarm script and bounded system smoke;
mutation audit script, catalog, and required module list; nightly lane
documentation. Cross-design obligation: `Pass-contract manifests`.

### Wave 8: Fact-Carrying Generation

Generator synthesis of valid-by-construction fact packets (memory order,
range, remat authority) so fact-gated e-graph rewrites, remat, and
security-label paths fire under differential testing; extend swarm policies
over fact-gated passes.

### Wave 9: Upper Pipeline Oracle

Checked MIR interpreter (level -1) with its coverage catalog; checked-MIR
differential lane against fixture expectations and against level 0 across
OptIR construction; registration as a full-image-validation reference checker
next to `interpreter-reference`. May begin any time after wave 1; it depends
only on the observation model.

### Wave 10: Proof Soundness Evidence

Must-reject corpus and proof-relevant mutant lane first (no new
infrastructure beyond the mutation catalog); then the Lean model translation,
boundary-biased bounded-program generator, verdict/fact fixture,
fixture-backed differential lane, and env-gated regeneration test. The
must-reject lane may run in parallel with waves 2–9; the Lean comparison is a
TCB-heavy lane and is complete only after translation-fidelity tests and fact
projection checks land.

### Wave 11: Source-Level Generation

Grammar- and type-directed `.wr` source generator; constructive expected
behavior for computational profiles; source minimizer; source differential
lane comparing generator expectations, Checked MIR, OptIR, minimal image,
production image, and QEMU projection when configured. Add proof-relevant
source profiles once their syntax is stable.

### Wave 12: Memory-Order Sufficiency

Memory-order publication-shape catalog; target memory-model declarations;
litmus/axiomatic obligation lowering; committed herd7 verdict fixtures and
env-gated regeneration; expressible-fragment and Device-nGnRE residue table;
sufficiency checker for descriptor publication, virtio avail index
publication, ring doorbell publication, used ring observation, firmware call
boundaries, and ordinary synchronization. This wave closes the
barrier-sufficiency gap that sequential interpreters cannot see. Cross-design
obligations: `Memory-order obligation-record emission` and
`Target-surface memory-model content`.

### Wave 13: Oracle Cross-Validation

User-mode QEMU single-instruction harness; semantic golden fixture format; fixture
generation/regeneration script; default fixture-backed interpreter
cross-validation for every supported opcode form. This wave reduces trust in
the shared AArch64 interpreter stepper.

### Wave 14: Proof Derivation And Formal Observation

Lean modeled-fragment expansion for layout entailment arithmetic, dominance,
unbounded CFG summaries, ABI facts, platform facts, and memory-order facts;
Lean decision-table-derived checker components with component-level staleness;
formal observation equivalence in Lean; round-trip fixtures between
TypeScript reports and Lean observation fixtures; modeled-fragment skip rate
driven to zero for required proof-relevant profiles. Cross-design obligation:
`Lean decision-table production checker components`.

### Wave 15: Firmware-Host Fault Simulation

Fault profiles behind `hostEffects`; fakes for QEMU harness setup failures,
UEFI wrapper failures, platform primitive failures, cleanup failures, and
timeout/truncation behavior; deterministic fault schedules and expected
marker/status observations.

### Wave 16: Coverage Guidance And Determinism Hardening

Stable coverage keys across passes, lowering, allocation, linker, proof
checking, and interpreters; deterministic seed mutation toward uncovered
high-risk keys; cross-process determinism checks; supported-platform CI matrix
for report/artifact determinism; cross-toolchain fixture regeneration
discipline for configured external tools.

## Acceptance Criteria

The phase is complete when:

- every `default-required` and `fixture-backed-required` lane in the canonical
  lane inventory has its coverage catalog, fixture authority, or verdict
  fixture present, reviewed, and classified, with no unowned exclusions
- every fixture-backed external authority fixture records a complete
  `AuthorityFixtureIdentity`, and every configured system-mode QEMU behavioral
  run records a complete `LiveAuthorityRunIdentity`
- the generator produces all six v1 profiles deterministically with passing
  distribution audits
- every `default-required`, `default-required+ci`, and
  `fixture-backed-required` lane in the canonical inventory runs its local
  default or fixture-backed check green over the committed budget in
  `agent:check`-eligible time, with per-lane skip rates within budget
- allocation semantic validation runs in every production backend compile and
  accepts correct joins/loops; its runs appear in verification summaries
- barrier conservation runs wherever memory-order obligations enter the
  backend, and memory-order sufficiency covers the device-ordering claim
- frame verification runs in every production backend compile
- verification summaries carry per-stage evidence with no blanket passes
- the external encoding audit default fixture check passes, and lanes 1 and 2
  regenerate in at least one configured `llvm-mc` environment
- `PacketCounterImage` markers carry computed values, its observation matrix
  passes through the interpreter-reference checker, and system-mode QEMU rows
  pass in a configured environment
- the `minimal`/`production` profile differential passes for every behavioral
  fixture
- configuration swarming has pass-contract manifests for every swarmed pass,
  and the bounded nightly swarm smoke either passes or reports an owned blocker
  for each illegal/missing pass contract
- the Checked MIR interpreter has a reviewed coverage catalog and the
  checked-MIR differential lane passes over the behavioral fixture corpus
- the must-reject corpus covers every named proof invariant family and every
  proof-relevant mutant of accepted fixtures is rejected
- the proof-soundness differential lane passes against a committed Lean
  verdict/fact fixture, the fixture regenerates cleanly in at least one
  configured Lean environment, modeled fact packets match on accepted
  programs, and the outside-modeled-fragment skip rate is within budget
- source-level generation covers every required source profile, expected
  behavior is generator-known, source minimization works, and generated cases
  pass the expectation/Checked-MIR/OptIR/minimal-image/production-image
  comparison matrix
- required proof-relevant source profiles have zero
  `outside-modeled-fragment` skips after Lean modeled-fragment expansion
- Lean decision-table-derived proof-checker components cover the required
  modeled fragment, with component-level staleness checks and boundary tests
  proving malformed generated artifacts are rejected
- the Lean observation-equivalence formalization round-trips with TypeScript
  observation reports and is referenced by pass legality obligations for the
  modeled optimization fragment
- memory-order sufficiency classifies every required publication shape as
  `directly-checked`, `conservative-proxy`, or `hand-reviewed-rule`; all
  directly checked shapes pass against the authenticated target memory model
  and committed herd7 verdict fixtures; configured herd7 regeneration matches
  the fixtures; every Device-nGnRE residue required by a proxy shape has a
  hand-reviewed Arm-rule table row; and missing/insufficient target rules are
  failures rather than skips
- QEMU single-instruction semantic fixtures cover every supported opcode form,
  default fixture-backed interpreter cross-validation passes, and fixture
  regeneration passes in at least one configured user-mode QEMU environment
- firmware-host fault simulation covers every required `hostEffects` fault
  profile with deterministic reports, expected markers/statuses, and verified
  cleanup behavior
- coverage-guided generation reaches every required high-risk coverage key
  while preserving generator distribution bounds
- cross-process determinism passes locally, and the `default-required+ci`
  cross-platform determinism matrix passes on supported platforms or reports
  an owned platform-specific blocker
- at least one previously unknown defect class is represented in the committed
  regression corpus (a differential suite that has never caught anything is
  either young or broken; track this honestly)
- the mutation audit runs on the required module list and its uncaught-mutant
  report is empty or has a tracked owner per entry

The concrete output is that a change to source lowering, proof checking,
certified facts, optimization passes, instruction selection, register
allocation, memory-order lowering, branch relaxation, relocation application,
encoding, interpreter semantics, target-driver host handling, or deterministic
reporting is caught by a deterministic, replayable check before handoff. The
remaining risk is no longer an unnamed structural blind spot; it must be either
represented in a required lane, recorded as an owned blocker, or explicitly
kept out of the supported surface.

## Design Defaults

- The OptIR interpreter is the canonical semantics for accepted programs;
  every other evaluation path is checked against it, directly or transitively.
- Differential lanes fail closed; skips are cataloged, counted, and reported.
- Oracles never share transformation code with the stages they check.
- External tools, user-mode QEMU, system-mode QEMU, herd7, and the Lean
  checkers are triangulation or fixture authorities, never production
  authority.
- Fixture expectations are computed by humans from source semantics, never
  derived from compiler or oracle output.
- Every random artifact is reproducible from a committed seed and replay key.
- Minimized failures become named regression tests and stay green forever.
- Residual trust gaps are named, measured, and paired with a committed next
  step; an unstated assumption is treated as a design defect.
- Structural verification remains necessary; this phase adds the behavioral
  evidence it cannot provide.
