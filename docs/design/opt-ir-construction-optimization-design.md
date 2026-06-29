# OptIR Construction And Optimization Design

## Purpose

OptIR construction and optimization is the compiler phase after proof and
resource checking and before AArch64 machine IR lowering. It consumes one
successful `CheckedMirProgram`, its `CheckedFactPacket`, the concrete layout
and ABI facts referenced by that packet, and a target optimization surface. It
returns optimized OptIR plus the certified facts and provenance still valid
after rewriting.

Checked MIR is the proof boundary. OptIR is the rewrite workbench. This phase
must not treat raw Proof MIR facts, source assertions, stdlib wrappers, or
host-side assumptions as optimization authority. Every proof-powered rewrite
must be justified by a checked fact packet entry, by a fact derived from such
an entry through a pass invariant, or by ordinary IR semantics independent of
Wrela proofs.

The phase has two jobs:

```text
construction:
  translate accepted executable MIR into canonical, layout-aware, SSA OptIR
  import certified facts into queryable indexes
  erase proof-only operations only after their erasure facts are preserved

optimization:
  run fact-aware whole-image rewrites over OptIR
  preserve, drop, or derive facts explicitly after each pass
  keep enough provenance to explain every optimization-relevant decision
```

The output remains above physical target choices. It may know the selected
target's data model, endian rules, vector feature set, ABI classifications, and
platform/runtime effect catalogs, but it must not assign physical registers,
stack slots, instruction encodings, final call locations, relocation addresses,
or PE/COFF sections.

## Goals

- Lower checked MIR plus the certified fact packet and checked optimization
  evidence into a separate OptIR data structure designed for rewrites.
- Keep checked MIR as the proof source of truth and OptIR as a derived,
  verifiable artifact.
- Erase proof-only operations only after preserving the certified erasure,
  ownership, bounds, layout, terminal, and effect facts that make erasure safe.
- Normalize field access, enum cases, calls, branches, constants, layout terms,
  validated-buffer reads, and platform/runtime operations into canonical OptIR
  operations.
- Model runtime values in SSA with block arguments instead of phi nodes.
- Model memory through explicit regions and, where useful, memory SSA versions
  or per-region effect tokens.
- Expose ownership/noalias, field-disjointness, bounds, layout/endian,
  volatility, terminal, platform-effect, runtime-effect, and ABI facts through
  pass APIs.
- Preserve source, HIR, Proof MIR, checked MIR, mono, layout, and target
  provenance for diagnostics, debug output, pass traces, and optimization
  explanations.
- Run mandatory semantic inlining for proof wrappers, validation helpers,
  monomorphized generic shims, resource wrappers, single-call thunks, and
  contract-preserving platform/runtime wrappers.
- Run budgeted whole-program inlining inside a shared scope-expansion fixpoint
  over the closed monomorphized call graph.
- Run budgeted whole-program specialization: binding-time-driven partial
  evaluation that bakes statically known configuration, schema, and
  certified-fact structure into specialized clones and straight-line residual
  code over the closed monomorphized image.
- Handle recursive SCCs, code-size growth, cold paths, loop nesting, external
  roots, callbacks, and platform/runtime effect boundaries conservatively.
- Run ordinary scalar and memory optimizations: constant folding, SCCP, DCE,
  GVN/CSE, copy propagation, branch simplification, LICM, dead-store
  elimination, load/store forwarding, scalar replacement, stack promotion, and
  escape analysis.
- Run Wrela-specific optimizations: move/copy elision from ownership facts,
  zero-copy validated-buffer reads, bounds-check elimination, endian-aware
  field-load folding, parser pipeline collapse, terminal cleanup pruning,
  wrapper elimination, and platform call specialization.
- Run bounded fact-gated e-graph rewriting as a production pass over selected
  local regions, using certified fact queries to unlock rewrite rules and a
  deterministic local extraction policy to choose the replacement.
- Keep vector-capable types and operations in OptIR from the beginning, and
  ship fact-gated SLP vectorization plus certified loop vectorization for loops
  whose trip count, memory dependencies, bounds, effects, and tail behavior are
  certified.
- Verify OptIR structural invariants and fact-preservation invariants after
  construction, after major pass groups, and before target lowering.
- Produce deterministic output and deterministic pass diagnostics.
- Keep filesystem access, package loading, parsing, HIR construction,
  monomorphization, layout computation, proof checking, machine lowering,
  linking, and binary writing outside this phase.

## Production Optimization Bets

The production OptIR implementation should prove the core Wrela optimization
thesis: checked proofs turn expensive analyses into certified queries, and
those queries unlock rewrites that ordinary compilers must either guard,
approximate, or abandon. The optimizer should ship a set of mutually
reinforcing bets that work as one safety and performance spine, not as
independent optional experiments.

The bets are:

| Bet                                   | Production commitment                                                                                                                                                                                                                                        | E-graph leverage                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| certified fact query system           | expose typed fact APIs for aliasing, bounds, layout/endian, volatility, effects, terminal behavior, ABI, erasure                                                                                                                                             | rewrite rules can ask fact queries instead of pattern-matching comments or rerunning analysis                                                                    |
| zero-copy validated-buffer pipeline   | lower validated reads to packet/source region loads with certified bounds and endian/layout metadata                                                                                                                                                         | field reads, derived fields, bounds checks, and byte-shuffle patterns become saturatable slices                                                                  |
| proof erasure and semantic inlining   | erase proof-only values and inline proof/validation/resource/platform wrappers after preserving certified facts                                                                                                                                              | wrapper calls, proof copies, and validation scaffolding become removable e-graph equivalences                                                                    |
| ownership/noalias memory optimization | use ownership, noalias, and field-disjointness facts for copy elision, forwarding, scalar replacement, promotion                                                                                                                                             | memory CSE, load forwarding, dead stores, and move/copy erasure get precise legality gates                                                                       |
| effect-aware region scheduling        | model platform, runtime, volatile, firmware-table, image-device, stack, packet, and constant regions explicitly                                                                                                                                              | e-graph imports only effect-safe slices and can rewrite effect boundaries only through contracts                                                                 |
| negative-information pruning          | use certified and derived impossibility facts to remove unreachable checks, arms, cleanup, impossible cases, and dead paths                                                                                                                                  | bounds-branch deletion, terminal cleanup pruning, and parser-state collapse become fact-gated                                                                    |
| whole-program specialization          | run ahead-of-time binding-time-driven partial evaluation over the closed image: compile-time-evaluate static operations, drive static branches/switches, bounded-unroll static loops, and clone callees on canonical static-argument signatures under budget | specialization exposes unrolled, driven, offset-folded straight-line regions the e-graph then saturates; both share fact queries and rewrite-legality validation |
| bounded fact-gated e-graph rewriting  | run deterministic local equality saturation over selected regions with fixed fuel and rewrite-legality validation                                                                                                                                            | combines the other bets into a rewrite-search pass instead of relying only on greedy peepholes                                                                   |
| fact-gated vectorization              | ship SLP and certified loop vectorization only for certified bounds, alias, layout, effect, trip-count, and tail facts                                                                                                                                       | e-graph can prepare vector idioms and canonicalize scalar loop bodies before vector extraction                                                                   |

These bets are not independent features. The e-graph pass depends on the fact
query system for legality, on proof erasure and mandatory inlining to expose
small expression regions, on region/effect modeling to keep memory rewrites
sound, and on provenance/fact lineage so extracted replacements remain
explainable and verifiable. Whole-program specialization is a sibling rewrite
search: it depends on inlining and constant exposure to reveal static bindings,
reuses the same fact queries, path certificates, and rewrite-legality
validation, and feeds the e-graph the straight-line regions it saturates.

The production e-graph rule set should target these bets directly:

- endian load folding over certified validated-buffer field reads
- bounds-branch deletion when validation and layout facts dominate the access
- move/copy erasure for proof-backed ownership transfers and wrapper values
- layout arithmetic folding over canonical layout terms and byte ranges
- field-disjoint memory CSE and load forwarding under noalias/effect gates
- parser-state collapse from validation/read/derived-field chains to direct
  loads and switches
- platform/runtime wrapper collapse only when effect, ABI, terminal, and
  capability-flow facts prove equivalence
- vector idiom preparation for adjacent loads, endian decodes, compares, and
  certified loop bodies before SLP or loop vector extraction

The flagship production demonstration should be a zero-copy validated packet
parser: high-level Wrela source with validation, proof wrappers,
resource/session state, and safe field APIs optimizes into direct packet
loads, endian decodes, switches, and effect-safe calls, with no redundant
bounds checks, copies, parser state objects, or proof-only runtime state.

The acceptance shape for that demonstration is exact:

- proof wrappers, validation wrappers, resource wrappers, and safe field API
  thunks are gone from executable OptIR after mandatory semantic inlining and
  cleanup
- packet/source reads are canonical `OptIrMemoryAccess` operations over
  packet/source regions with cited bounds, layout, endian, volatility, and path
  facts
- rejected parse paths remain only where they are semantically observable, and
  removed rejection checks cite preserved path certificates
- derived fields are expressed as direct loads, endian decodes, masks,
  compares, switches, or vector operations rather than materialized parser
  state objects
- ownership transfers, move/copy helpers, and cleanup paths are removed only
  when ownership, noalias, terminal, and effect facts prove no runtime work
  remains
- the optimized snapshot records every eliminated check, copy, wrapper, and
  parser state with the fact chain and provenance that licensed the rewrite

This demonstration is gated on the full production handoff: certificate bundle,
packet-validation attestation, checked path certificate table, and checked
semantic-inline policy table. If any of those upstream artifacts are absent,
the demonstration does not silently fall back to performance inlining or
heuristic wrapper detection; construction reports the missing handoff contract.

## Non-Goals

- This phase does not accept or reject Wrela programs semantically. Proof and
  resource checking already made that decision.
- This phase does not re-run proof/resource checking, re-prove source
  requirements, infer platform contracts, or trust source-written proof text.
- This phase does not recover source intent from syntax. It consumes checked
  MIR, layout facts, target surfaces, and provenance IDs produced earlier.
- This phase does not discover reachability, instantiate generics, compute type
  layout, or classify ABI shapes from source types.
- This phase does not make the standard library privileged. Stdlib wrappers are
  optimized like other source wrappers only when facts, checked summaries, and
  executable body semantics allow it.
- This phase does not reorder, remove, vectorize, or merge volatile, MMIO,
  firmware-table, image-device, terminal, or platform-effect operations unless
  the selected target contract explicitly permits that rewrite.
- This phase does not lower to final AArch64 machine instructions, assign
  registers, choose spill slots, lay out stack frames, emit symbols, or create
  relocations.
- This phase does not consult optimization scorecard baselines, benchmark data,
  or offline search results during production compilation.
- This phase does not run unbounded equality saturation, whole-image
  superoptimization, or recursive whole-pipeline trial optimization. E-graph
  rewriting is a bounded local pass with explicit fuel, scope, fact guards,
  extraction policy, and rewrite-legality validation.
- This phase does not run unbounded, online, or runtime/JIT specialization.
  Whole-program specialization is ahead-of-time and bounded by clone-variant
  caps, code-size budget, unroll limit, and fuel. It specializes only on static
  inputs already present in the closed image, never changes physical type layout
  or ABI shape, and does not specialize across recursive or maybe-recursive SCCs
  except by a finite contract-preserving unroll rule.
- This phase does not implement speculative general-purpose loop vectorization
  for arbitrary runtime loops. Production loop vectorization handles only loops
  with certified trip-count or tail behavior, certified lane bounds, proven
  memory independence, and effect-safe bodies.
- This phase does not implement incremental compilation or cached OptIR
  optimization.

## Trusted Computing Base

The optimizer must be honest about what production verification proves.
Bookkeeping verification and rewrite-legality validation prove that a rewrite
is a well-formed application of a catalogued rule or pass obligation, that the
cited facts are in scope, and that preserved facts still line up with the
rewritten OptIR. They are not a theorem prover for the semantic soundness of
every rule in the catalog.

Production compilation trusts:

- the checked MIR, checked fact packet, certificate bundle, path certificate
  table, semantic-inline policy table, and validation attestation produced by
  proof/resource checking
- the selected layout/ABI fact program and target platform/runtime catalogs,
  each authenticated by fingerprint
- the closed OptIR operation semantics and effect-derivation tables
- the typed fact importer that maps checked packet entries, checked summaries,
  Proof MIR references, layout facts, and catalog entries into `OptIrFactQuery`
  answers
- the rewrite rule catalog's reviewed `gate => invariant` judgments
- pass implementations and their reviewed pass contracts
- the rewrite-legality validator's replay of rule applications and obligation
  records
- the OptIR interpreter only for passes that explicitly run production
  translation validation

Merge gates trust:

- the OptIR interpreter and differential harness used for rule/pass tests
- deterministic generators and fake target/runtime/firmware surfaces used by
  those tests
- rule-soundness and pass-invariant test fixtures

Rule-soundness and pass-invariant tests are required merge gates, but they are
not production authority unless the same interpreter check is explicitly run by
a production pass. Production authority is the checked input plus the reviewed
compiler implementation. A rule whose gate is wrong can still miscompile; the
design therefore keeps rule catalogs closed, typed, reviewed, differentially
tested, replayable, and eligible for bounded translation validation.

The optimizer must not add anything else to this trust base. Source proof text,
stdlib package identity, scorecard baselines, host timing, raw packet envelopes
without authenticated semantic interpretation, and successful past optimization
runs are not authority.

## Repository Shape

```text
src/
  opt-ir/
    index.ts
    ids.ts
    program.ts
    values.ts
    types.ts
    cfg.ts
    cfg-edits.ts
    operations.ts
    operation-schema.ts
    terminators.ts
    regions.ts
    effects.ts
    constants.ts
    calls.ts
    layout-access.ts
    vector-types.ts
    operation-semantics.ts
    operation-effects.ts
    provenance.ts
    diagnostics.ts
    deterministic-sort.ts
    deterministic-ids.ts

    facts/
      fact-index.ts
      fact-query.ts
      fact-import-schema.ts
      fact-lineage.ts
      fact-preservation.ts
      subject-remapping.ts
      bounds-facts.ts
      alias-facts.ts
      layout-facts.ts
      effect-facts.ts
      abi-facts.ts
      capability-facts.ts
      private-state-facts.ts
      path-certificates.ts

    lower/
      lower-checked-mir.ts
      proof-erasure.ts
      region-builder.ts
      block-argument-builder.ts
      canonical-operations.ts
      validated-buffer-reads.ts
      call-lowering.ts
      provenance-builder.ts

    analyses/
      dominance.ts
      loop-tree.ts
      call-graph.ts
      scc.ts
      liveness.ts
      escape-analysis.ts
      alias-analysis.ts
      memory-ssa.ts
      effect-tokens.ts
      range-analysis.ts
      value-numbering.ts
      binding-time-analysis.ts

    egraph/
      egraph.ts
      equivalence-class.ts
      rewrite-rule.ts
      fact-gated-rule.ts
      rule-catalog.ts
      saturation.ts
      extraction.ts
      egraph-cost.ts
      region-selection.ts
      egraph-diagnostics.ts
      translation-validation.ts

    passes/
      pipeline.ts
      mandatory-inlining.ts
      whole-program-inlining.ts
      whole-program-specialization.ts
      scalar-simplification.ts
      sccp.ts
      dce.ts
      gvn.ts
      copy-propagation.ts
      cfg-simplification.ts
      licm.ts
      memory-optimization.ts
      scalar-replacement.ts
      stack-promotion.ts
      wrela-optimizations.ts
      fact-gated-egraph.ts
      slp-vectorization.ts
      loop-vectorization.ts
      vectorization-cleanup.ts
      cleanup.ts

    policy/
      optimization-profile.ts
      pass-order-policy.ts
      expansion-budget.ts
      inline-policy.ts
      specialization-policy.ts
      memory-policy.ts
      vector-policy.ts
      local-policy.ts
      egraph-extraction-policy.ts
      decision-log.ts

    verify/
      structural-verifier.ts
      ssa-verifier.ts
      region-verifier.ts
      fact-verifier.ts
      operation-metadata-verifier.ts
      operation-schema-verifier.ts
      cfg-edit-verifier.ts
      path-certificate-verifier.ts
      rewrite-legality.ts
      pass-invariant-schema.ts
      pass-schedule-consistency.ts
      pass-verifier.ts

tests/
  support/
    opt-ir/
      opt-ir-fakes.ts
      checked-mir-fixtures.ts
      fact-packet-fixtures.ts
      target-optimization-fakes.ts
      opt-ir-interpreter.ts
      opt-ir-differential.ts

  unit/
    opt-ir/
      operation-semantics.test.ts
      operation-schema.test.ts
      fact-import-schema.test.ts
      construction.test.ts
      proof-erasure.test.ts
      canonical-operations.test.ts
      fact-index.test.ts
      fact-preservation.test.ts
      cfg-edge-preservation.test.ts
      region-builder.test.ts
      memory-ssa.test.ts
      mandatory-inlining.test.ts
      whole-program-inlining.test.ts
      binding-time-analysis.test.ts
      whole-program-specialization.test.ts
      scalar-simplification.test.ts
      memory-optimization.test.ts
      wrela-optimizations.test.ts
      fact-gated-egraph.test.ts
      egraph-translation-validation.test.ts
      egraph-rule-soundness.test.ts
      loop-vectorization.test.ts
      vector-types.test.ts
      verifier.test.ts

  integration/
    opt-ir/
      checked-mir-to-opt-ir.test.ts
      optimized-opt-ir-interpreter.test.ts
      fact-preserving-rewrites.test.ts
      validated-buffer-optimization.test.ts
      platform-effect-boundaries.test.ts
      deterministic-output.test.ts
```

`src/opt-ir` may depend on checked MIR public types, certified fact packet
public types, mono instance IDs, layout fact IDs, semantic target IDs, shared
diagnostics/source-origin types, and target optimization surfaces supplied by
dependency injection.

It must not depend on filesystem APIs, Bun APIs, package manifests, frontend
syntax trees, HIR builder internals, monomorphization internals, proof checker
internals, target instruction selectors, register allocators, linkers, PE/COFF
writers, or host runtime state.

The repository shape is an ownership map, not a requirement to create every
file before the core operation model and fact importer exist. Implementations
may collapse adjacent modules while preserving the public boundaries and tests.

## Public API

The phase should expose construction and optimization as separate public
operations, plus a convenience operation for the normal compiler pipeline:

```ts
export interface ConstructOptIrInput {
  readonly checkedMir: CheckedMirProgram;
  readonly checkedEvidence: CheckedMirOptimizationEvidence;
  readonly layoutFacts: AuthenticatedLayoutFactProgram;
  readonly target: OptIrTargetSurface;
  readonly options?: OptIrConstructionOptions;
}

export interface CheckedMirOptimizationEvidence {
  readonly certificates: CheckedCertificateBundle;
  readonly packetValidation: CheckedFactPacketValidationAttestation;
  readonly pathCertificates: CheckedPathCertificateTable;
  readonly semanticInlinePolicies: CheckedSemanticInlinePolicyTable;
}

export interface AuthenticatedLayoutFactProgram {
  readonly fingerprint: LayoutFactProgramFingerprint;
  readonly program: LayoutFactProgram;
}

export type ConstructOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: OptIrProgram;
      readonly facts: OptIrFactSet;
      readonly provenance: OptIrProvenanceMap;
      readonly diagnostics: readonly OptIrDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly OptIrDiagnostic[];
    };

export interface OptimizeOptIrInput {
  readonly program: OptIrProgram;
  readonly facts: OptIrFactSet;
  readonly target: OptIrTargetSurface;
  readonly policy: OptIrOptimizationPolicy;
}

export type OptimizeOptIrResult =
  | {
      readonly kind: "ok";
      readonly program: OptimizedOptIrProgram;
      readonly facts: OptIrFactSet;
      readonly provenance: OptIrProvenanceMap;
      readonly decisionLog: readonly LocalPolicyDecisionLog[];
      readonly diagnostics: readonly OptIrDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly OptIrDiagnostic[];
    };

export function constructOptIr(input: ConstructOptIrInput): ConstructOptIrResult;

export function optimizeOptIr(input: OptimizeOptIrInput): OptimizeOptIrResult;

export function buildOptimizedOptIr(
  input: ConstructOptIrInput & {
    readonly policy: OptIrOptimizationPolicy;
  },
): OptimizeOptIrResult;
```

`kind: "ok"` may include warning, note, trace, or optimization-explanation
diagnostics. Any structural invalidity, missing required fact authority,
invalid fact-preservation claim, unsupported reachable operation, or target
surface mismatch returns `kind: "error"`.

`CheckedMirProgram` owns the accepted MIR graph, function certificate IDs,
summaries, checked fact packet, terminal graph certificate, and checked origin
map. `checkedEvidence` owns the certificate records, packet-validation
attestation, path-certificate table, and semantic-inline policy table that
those IDs reference. `layoutFacts` owns the authenticated concrete layout and
ABI fact records referenced by the packet. Construction authenticates that
every checked packet dependency on a certificate, path certificate, semantic
inline policy, layout record, or ABI record resolves through this selected
handoff; it does not treat IDs embedded in packet envelopes as sufficient by
themselves.

The returned `provenance` fields are snapshots of `program.provenance`, not a
second source of authority. Optimization inputs accept the program and fact set
only; the optimizer reads provenance from the program it is transforming.
Consumers that want a sidecar map for diagnostics receive a stable snapshot
whose fingerprint must match the returned program. A stale or independently
constructed provenance map is never accepted as optimization input.

Facts use the opposite ownership model: `OptIrFactSet` is the authoritative
sidecar, and the program may only store `OptIrFactId` references plus derived
indexes that are rebuilt from that set. Construction and optimization APIs
therefore carry `(program, facts)` together. A fact referenced by an operation,
path certificate, rewrite obligation, or diagnostic must resolve in the
current `OptIrFactSet`, and a fact answer is never recovered from program
metadata alone.

## Target Optimization Surface

OptIR construction is target-selected but not machine lowering. The target
surface contains facts and feature gates that affect optimization legality:

```ts
export interface OptIrTargetSurface {
  readonly targetId: TargetId;
  readonly dataModel: TargetDataModelFacts;
  readonly abi: TargetAbiSurface;
  readonly platformEffects: OptIrPlatformEffectSurface;
  readonly runtimeEffects: OptIrRuntimeEffectSurface;
  readonly vector: TargetVectorSurface;
  readonly atomicAndVolatile: TargetMemoryEffectSurface;
  readonly intrinsicLowering: TargetIntrinsicCatalog;
}

export interface OptIrEffectRegionRequirement {
  readonly region: OptIrRegionSelector;
  readonly mode: "observe" | "mutate" | "advancePrivateState" | "terminal";
  readonly token: "none" | "readVersion" | "orderedEffect";
  readonly crossRegionObserves: readonly OptIrRegionSelector[];
}

export interface OptIrPlatformEffectSurface {
  readonly catalogFingerprint: ProofAuthorityFingerprint;
  readonly requirementsFor: (
    target: OptIrPlatformCallTarget,
  ) => readonly OptIrEffectRegionRequirement[];
}

export interface OptIrRuntimeEffectSurface {
  readonly catalogFingerprint: ProofAuthorityFingerprint;
  readonly requirementsFor: (
    target: OptIrRuntimeCallTarget,
  ) => readonly OptIrEffectRegionRequirement[];
}

export interface TargetVectorSurface {
  readonly enabled: boolean;
  readonly legalLaneTypes: readonly OptIrScalarType[];
  readonly legalLaneCounts: readonly number[];
  readonly preferredByteWidths: readonly number[];
  readonly supportsUnalignedPacketLoads: boolean;
  readonly supportsEndianSwapVectorIdioms: boolean;
}
```

The target surface does not supply optimization authority by itself. It says
which rewrites are legal on the selected target once OptIR facts prove their
preconditions. For example, the AArch64 target may report that NEON vector
loads are available, but the vectorizer still needs alignment, bounds,
aliasing, volatility, and effect facts before forming a vector load.

Current upstream platform/runtime catalogs describe effects mostly in
place-bound terms such as `readsMemory`, `writesMemory`, `platformEffect`,
`advancesPrivateState`, consumed capabilities, and produced capabilities.
`OptIrTargetSurface` owns the normalization from those checked catalog entries
to region requirements and cross-region observation edges. The optimizer may
not invent region precision that the catalog did not provide; if a place-bound
effect cannot be resolved to a precise region selector, it becomes
`externalUnknown` or a conservative ordered effect over every externally
visible region named by the call.

## Input Contract

The required input is a successful `CheckedMirProgram`:

```text
CheckedMirProgram
  accepted Proof MIR graph
  checked function certificate IDs
  function summaries
  checked fact packet
  terminal graph certificate
  origin map

CheckedMirOptimizationEvidence
  certificate records referenced by checked MIR and packet entries
  packet-validation attestation from proof/resource checking
  path certificate table
  semantic-inline policy table

AuthenticatedLayoutFactProgram
  layout/ABI fact records
  layout program fingerprint
```

Before constructing OptIR, the phase validates:

- every reachable checked function has an accepted entry certificate
- every reachable block and edge referenced by executable MIR has an accepted
  state certificate
- every checked fact packet entry has a known kind, valid subject, valid scope,
  resolvable dependencies, and a certificate record in `checkedEvidence`
- `checkedEvidence.packetValidation` names the same checked fact packet,
  certificate bundle, accepted functions, summaries, terminal graph, origin
  map, and authority fingerprints as this construction input
- every path-scoped checked fact resolves through
  `checkedEvidence.pathCertificates`
- every mandatory semantic-inline classification resolves through
  `checkedEvidence.semanticInlinePolicies`
- every layout/ABI fact referenced by checked facts exists in the layout fact
  program selected for this image and matches the authenticated layout
  fingerprint
- every platform/runtime effect fact names an entry in the selected target's
  catalog with a matching authority fingerprint
- every erasure fact names a proof-only or zero-runtime value whose executable
  uses have been accepted by the checker
- every origin referenced by checked MIR or the packet resolves through the
  checked origin map

This validation is not a second proof check. It is boundary authentication. A
malformed packet, stale target catalog, mismatched layout program, or missing
origin map is a compiler-pipeline error, not an optimization opportunity.

## OptIR Program Model

OptIR is a whole-image program made of functions, blocks, block arguments,
operations, terminators, regions, fact references, and provenance records. The
authoritative fact records live in the accompanying `OptIrFactSet`.

```ts
export interface OptIrProgram {
  readonly programId: OptIrProgramId;
  readonly targetId: TargetId;
  readonly functions: OptIrFunctionTable;
  readonly regions: OptIrRegionTable;
  readonly constants: OptIrConstantTable;
  readonly callGraph: OptIrCallGraph;
  readonly provenance: OptIrProvenanceMap;
}

export interface OptIrFunction {
  readonly functionId: OptIrFunctionId;
  readonly monoInstanceId: MonoInstanceId;
  readonly signature: OptIrFunctionSignature;
  readonly blocks: readonly OptIrBlock[];
  readonly edges: OptIrEdgeTable;
  readonly entryBlock: OptIrBlockId;
  readonly externalRoot: OptIrExternalRootKind | undefined;
  readonly summary: OptIrFunctionSummary;
  readonly origin: OptIrOriginId;
}

export type OptIrSemanticInlinePolicy =
  | {
      readonly kind: "mandatory";
      readonly reason:
        | "proofWrapper"
        | "validationHelper"
        | "monomorphizedShim"
        | "resourceWrapper"
        | "singleCallThunk"
        | "platformWrapper"
        | "runtimeWrapper";
      readonly source: "checkedSummary";
      readonly certificateId: CheckedFunctionSummaryCertificateId;
    }
  | { readonly kind: "eligible"; readonly reason: "ordinaryPerformanceInline" }
  | { readonly kind: "forbidden"; readonly reason: OptIrInlineBoundaryReason };

export interface OptIrFunctionSummary {
  readonly checkedSummary: CheckedFunctionSummary;
  readonly semanticInlinePolicy: OptIrSemanticInlinePolicy;
  readonly requiredFacts: readonly OptIrSummaryRequirement[];
  readonly observedRegions: readonly OptIrSummaryRegionEffect[];
  readonly consumedRegions: readonly OptIrSummaryRegionEffect[];
  readonly mutatedRegions: readonly OptIrSummaryRegionEffect[];
  readonly producedRegions: readonly OptIrSummaryRegionEffect[];
  readonly returnedFacts: readonly OptIrSummaryReturnedFact[];
  readonly invalidations: readonly CheckedFactInvalidation[];
  readonly capabilityEffects: readonly OptIrCapabilityEffect[];
  readonly privateStateEffects: readonly OptIrPrivateStateEffect[];
  readonly terminalBehavior: TerminalAnswer;
  readonly divergence: readonly CheckedDivergenceFact[];
}

export interface OptIrBlock {
  readonly blockId: OptIrBlockId;
  readonly parameters: readonly OptIrBlockParameter[];
  readonly operations: readonly OptIrOperation[];
  readonly terminator: OptIrTerminator;
  readonly origin: OptIrOriginId;
}

export interface OptIrCfgEdge {
  readonly edgeId: OptIrEdgeId;
  readonly from: OptIrBlockId;
  readonly to: OptIrBlockId;
  readonly ordinal: number;
  readonly kind: OptIrEdgeKind;
  readonly arguments: readonly OptIrValueId[];
  readonly condition?: OptIrValueId;
  readonly switchCase?: OptIrSwitchCaseKey;
  readonly origin: OptIrOriginId;
}

export type OptIrEdgeKind =
  | "jump"
  | "branchTrue"
  | "branchFalse"
  | "switchCase"
  | "switchDefault"
  | "exceptional"
  | "synthetic";
```

CFG edges are first-class records, not implicit successor slots inside a
terminator. A terminator owns the control decision, but each successor it names
must reference an `OptIrCfgEdge` record in the function's `edges` table. Edge
IDs are allocated during construction from checked MIR control-flow edges and
then re-homed by passes through explicit CFG edit records. No path certificate,
block-argument check, branch deletion, inlining substitution, or e-graph
single-entry/single-exit replacement may refer to a successor without a stable
edge ID.

Splitting an edge creates new edge IDs plus an edge-implication record saying
which new edge path implies the old edge. Cloning a block creates cloned edge
IDs tied to the clone origin. Deleting a branch removes only the unreachable
edge records and records why the surviving edge implies the original path
condition. These records are consumed by path-certificate re-homing and by the
block-argument verifier.

SSA joins use block arguments. A branch, switch, or jump supplies arguments to
the successor block:

```text
block entry(source: packet_region, len: usize):
  ok = ge len, 14
  branch ok, header(source, len), reject()

block header(source: packet_region, len: usize):
  ethertype = load source + 12 : be u16
  switch ethertype, ipv4(), ipv6(), reject()
```

There are no phi instructions. Every `OptIrValueId` has exactly one defining
operation or block parameter, a stable type, a dominance relation, and an
origin. Values that exist only to carry proof evidence are not runtime values
after proof erasure.

`OptIrFunctionSummary` is an authenticated projection of
`CheckedMirProgram.summaries` plus `checkedEvidence.semanticInlinePolicies`. It
may normalize checked place effects to OptIR regions and target effects, but it
must not recover wrapper intent from source syntax or body shape. A function is
marked `semanticInlinePolicy: "mandatory"` only when the checked evidence
carries the classification and certificate. Body shape may reject a mandatory
inline as unsafe; it may not create the mandatory label.

Mandatory semantic inlining is therefore an upstream handoff dependency, not an
OptIR heuristic. Production OptIR requires proof/resource checking,
monomorphization, and lowering to export `CheckedSemanticInlinePolicyTable`.
Mono and lowering may classify generated shims and single-call thunks they
create. Proof/resource checking authenticates wrapper policies against checked
summaries, effect summaries, ABI facts, erasure facts, capability flow, and
private-state behavior before the optimizer may treat them as mandatory.

## Canonical Operation Set

OptIR should use a closed, boring operation vocabulary. Source-shaped
constructs become canonical value, memory, call, and control operations:

| Checked MIR shape             | Canonical OptIR shape                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| scalar local value            | SSA value or block argument                                                           |
| copy scalar                   | value alias, copy operation only when needed by later lowering                        |
| move resource                 | no runtime operation when ownership facts prove runtime identity                      |
| field projection              | layout path plus concrete offset, or aggregate extract/insert for register aggregates |
| aggregate field load          | address/range computation plus typed load                                             |
| enum case construction        | tag constant plus payload aggregate or target layout write                            |
| enum match                    | tag load/extract plus switch with block arguments                                     |
| source call                   | direct call with source summary, ABI facts, and effect summary                        |
| runtime helper call           | runtime call or intrinsic with runtime effect token                                   |
| platform primitive call       | platform call or intrinsic with platform effect token and ABI facts                   |
| branch                        | conditional branch with canonical boolean condition                                   |
| match/switch                  | switch over canonical scalar tag or discriminant                                      |
| integer/string/zero constants | interned typed constants                                                              |
| layout term                   | canonical layout value, byte range, address, size, or alignment term                  |
| validated-buffer read         | packet/source region access with certified bounds, layout path, and endian decode     |
| terminal exit                 | terminal call plus terminal terminator, trap, panic, or unreachable as appropriate    |
| proof-only operation          | erased after checked erasure facts are imported                                       |

Constants are canonicalized by type and normalized value. Layout terms are
canonicalized by layout fact key, field path, byte offset expression, byte
width, alignment, and endian marker. Calls are canonicalized by callee kind,
target ID, ABI shape, effect summary, argument list, and terminal behavior.

The operation model is a closed discriminated union. Each operation names its
result values, operand values, region/effect behavior, semantic flags, and
origin:

```ts
export type OptIrOperation =
  | OptIrConstantOperation
  | OptIrScalarOperation
  | OptIrAggregateOperation
  | OptIrLayoutOperation
  | OptIrMemoryOperation
  | OptIrCallOperation
  | OptIrVectorOperation
  | OptIrProofErasedMarker;

export type OptIrTerminator =
  | OptIrJumpTerminator
  | OptIrBranchTerminator
  | OptIrSwitchTerminator
  | OptIrReturnTerminator
  | OptIrPanicTerminator
  | OptIrTrapTerminator
  | OptIrTerminalCallTerminator
  | OptIrUnreachableTerminator;

export interface OptIrOperationHeader {
  readonly operationId: OptIrOperationId;
  readonly results: readonly OptIrValueId[];
  readonly operands: readonly OptIrValueId[];
  readonly effects: OptIrOperationEffect;
  readonly semantics: OptIrOperationSemantics;
  readonly origin: OptIrOriginId;
}
```

`OptIrOperationSemantics` records purity, overflow mode, trap behavior,
constant-folding eligibility, vector lane behavior, and whether the operation
is allowed to disappear when unused. `OptIrOperationEffect` records region
reads, region writes, effect-token inputs and outputs, volatility, atomicity,
platform/runtime boundaries, terminal behavior, capability flow, and
private-state generation. A pass may not infer these flags from an operation
name alone; they are part of the operation contract and are verified after
rewrites.

These fields are not free-form authority. Operation constructors derive
`OptIrOperationSemantics` and `OptIrOperationEffect` from the closed operation
variant, operand/result types, target surface, region table, and call/effect
catalog entries. Passes may request a new operation; they may not hand-author
purity or effect flags. Verifiers recompute semantics/effects from the same
closed derivation tables and reject any operation whose cached metadata does
not match. Debug dumps may print the cached metadata, but optimization legality
uses the recomputed view.

Validated-buffer reads should not remain source-shaped. They lower to a
canonical access over a packet/source region:

```ts
export interface OptIrMemoryAccess {
  readonly region: OptIrRegionId;
  readonly byteOffset: OptIrValueId | OptIrConstantId;
  readonly byteWidth: bigint;
  readonly alignment: bigint;
  readonly valueType: OptIrType;
  readonly endian: "target" | "little" | "big";
  readonly volatility: OptIrVolatility;
  readonly layoutPath?: LayoutFieldPath;
  readonly boundsAuthority: OptIrBoundsAuthority;
}

export type OptIrBoundsAuthority =
  | { readonly kind: "constructionSize" }
  | { readonly kind: "certifiedFact"; readonly factId: OptIrFactId }
  | {
      readonly kind: "passDerivedFact";
      readonly factId: OptIrFactId;
      readonly obligationId: RewriteLegalityObligationId;
    }
  | { readonly kind: "runtimeGuard"; readonly guard: OptIrRuntimeBoundsGuard };

export interface OptIrRuntimeBoundsGuard {
  readonly guardOperation: OptIrOperationId;
  readonly successEdge: OptIrEdgeId;
  readonly checkedByteRange: OptIrByteRangeExpression;
  readonly dominatesAccess: true;
}
```

`boundsAuthority` is mandatory so verification never has to infer why an access
is legal from absence. Stack, constant, and fully materialized aggregate
accesses may use `constructionSize` when construction-time size and lifetime
rules prove the byte range. Check-free packet/source and validated-payload
accesses cite `certifiedFact` or `passDerivedFact`. Checked-at-runtime accesses
cite the retained guard operation and the success edge on which the guard
dominates the access.

Zero-copy reads, bounds-check elimination, vector lane access, and e-graph
bounds rewrites may use a packet/source access only after the fact query can
cite a certified or pass-derived bounds fact at the rewritten program point.
They may not treat `runtimeGuard` as a removable proof unless the rewrite also
derives a replacement bounds fact and records the obligation that licensed
removing the guard.

After any pass removes a dominating runtime bounds check, every now-check-free
`packetSource` or `validatedPayload` access in the affected path must be
updated to cite the certified or pass-derived fact that licensed the removal.
A post-BCE packet/source access whose `boundsAuthority.kind` is still
`runtimeGuard` is valid only if the cited guard operation still exists and the
cited success edge still dominates the access. If the guard is gone,
verification rejects the rewrite.

If the wire endian matches the target endian, the read may be represented as a
canonical endian load whose byte order is `target`. If it differs, the
canonical form remains an endian load with explicit `little` or `big` order.
OptIR does not erase the endian marker into an unqualified host-endian
aggregate load. AArch64 lowering chooses whether the final sequence is a plain
load, load plus byte-swap, bit extraction, or a target-supported endian-load
idiom.

## Operation Semantics Baseline

OptIR rewrites depend on precise operation semantics. The IR must not inherit
undefined behavior or target folklore from lower layers.

- executable OptIR values have defined types and values; there is no implicit
  LLVM-style poison or undef value in executable OptIR
- integer operations name their overflow mode explicitly: wrapping, checked,
  trapping, widening, saturating, or target-intrinsic
- constants are interned by type, normalized value, and target data-model
  interpretation
- loads and stores are defined by region, byte range, alignment, endian marker,
  volatility, and effect-token or region-version ordering
- an out-of-bounds access is not an optimization hint; it is either guarded by
  a retained runtime check, proven impossible by a valid fact, or rejected by
  construction/verification
- panics, traps, terminal calls, `Never` results, and unreachable terminators
  are distinct terminator semantics, not interchangeable control-flow shapes
- calls carry source/runtime/platform target kind, ABI shape, effect summary,
  terminal behavior, capability flow, and private-state behavior
- aggregate materialization is explicit; field extracts, field inserts, layout
  paths, and byte ranges are canonical operations with provenance
- vector masks have explicit lane count and inactive-lane behavior; masked
  loads, stores, selects, and comparisons do not create hidden undefined lanes
- branch and switch operations use canonical boolean or scalar discriminants
  and pass all joined values through block arguments

## Closed Operation Schemas

Every executable OptIR operation variant has a closed schema. The schema is the
source of truth for constructor validation, verifier recomputation, interpreter
execution, e-graph import/export, and lowering eligibility.

```ts
export interface OptIrOperationSchema {
  readonly operationKind: OptIrOperationKind;
  readonly operandSchema: readonly OptIrOperandSchema[];
  readonly resultSchema: readonly OptIrResultSchema[];
  readonly typeRule: OptIrTypeRuleId;
  readonly semanticsRule: OptIrSemanticsRuleId;
  readonly effectRule: OptIrEffectRuleId;
  readonly interpreterRule: OptIrInterpreterRuleId;
  readonly canonicalForm: OptIrCanonicalFormId;
  readonly loweringRequirement: OptIrLoweringRequirement;
}
```

The schema is not debug metadata. A constructor must use the schema to derive
result types, semantics, and effects. The verifier recomputes the same fields
from the schema and rejects drift. The interpreter dispatches by
`interpreterRule`, not by ad hoc operation-name matching. An e-graph rule may
import an operation only when the operation schema says the imported operands,
effects, memory authority, and trap behavior are interpreter-complete for the
selected slice.

Representative schema obligations:

| Operation family      | Required closed semantics                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| integer arithmetic    | operand/result widths, signedness interpretation, overflow mode, trap/panic behavior, constant-fold rule  |
| field/layout access   | layout key, byte range expression, endian marker, aggregate materialization rule, provenance requirement  |
| memory load/store     | region, byte range, alignment, volatility, bounds authority, effect-token or region-version ordering      |
| calls                 | target kind, ABI shape, call/return value mapping, effect summary, terminal behavior, capability flow     |
| branches and switches | discriminant type, successor edge records, block-argument arity/type rule, unreachable-successor handling |
| vectors               | lane type/count, mask semantics, inactive-lane behavior, scalar equivalence, target feature requirements  |
| proof-erased markers  | no executable result, lineage/provenance only, verifier rule that no runtime use remains                  |

The optimized OptIR interpreter covers the closed core schema before production
rewrite catalogs are accepted. When a future operation cannot be interpreted,
it must be marked non-interpreter-complete, excluded from production
translation validation, and ineligible for e-graph rules that require
interpreter-backed equality until its schema is completed.

## Memory Regions And Effects

OptIR memory is organized into explicit regions. Regions give alias analysis,
effect ordering, escape analysis, and platform-boundary handling a shared
vocabulary.

```ts
export type OptIrRegionKind =
  | "stackLocal"
  | "sourceAggregate"
  | "packetSource"
  | "validatedPayload"
  | "imageDevice"
  | "firmwareTable"
  | "runtimeMemory"
  | "constantData"
  | "globalData"
  | "externalUnknown";

export interface OptIrRegion {
  readonly regionId: OptIrRegionId;
  readonly kind: OptIrRegionKind;
  readonly owner: OptIrRegionOwner;
  readonly lifetime: OptIrRegionLifetime;
  readonly aliasClass: OptIrAliasClassId;
  readonly layout?: LayoutFactKey;
  readonly volatility: OptIrVolatility;
  readonly effects: OptIrRegionEffectPolicy;
  readonly origin: OptIrOriginId;
}
```

Regions are not a replacement for facts. A `packetSource` region is not
automatically safe to read at any byte offset. A read is legal only when the
access itself is in bounds by ordinary size information, by a certified bounds
fact, or by a fact derived by an accepted optimization invariant.

Region ownership and lifetime are constructed by explicit rules:

- a non-escaping mutable local place becomes `stackLocal`
- a source aggregate whose address escapes, whose fields are borrowed through
  an aliasing API, or whose ABI requires material storage becomes
  `sourceAggregate`
- a validated packet's original bytes become `packetSource`
- a `validatedPayload` region is a read-only view over a byte range of a
  backing `packetSource` region; its alias class records the backing region,
  byte-range expression, and validation certificate
- image devices, firmware tables, runtime-owned memory, globals, constants,
  and external pointers become distinct region kinds only when the selected
  target surface can classify them
- an address-taken value that can flow to a callback, exported root, unknown
  runtime call, or unknown platform call is marked escaped and either remains
  in an externally visible region or is joined into `externalUnknown`

`aliasClass` is the stable key used by alias analysis to relate regions that
may denote overlapping storage. Two region IDs are not disjoint merely because
their region kinds differ. A `validatedPayload` alias class must point back to
its `packetSource` class, and disjointness between two payload views requires
field-disjointness, byte-range, or noalias facts.

Memory modeling can be mixed:

- immutable constant regions do not need memory SSA tokens
- stack-local regions can use memory SSA versions when forwarding, scalar
  replacement, or dead-store elimination needs precision
- packet/source regions usually use read-only region versions plus certified
  bounds facts
- firmware-table, image-device, volatile, atomic, runtime, and platform-effect
  regions use per-region effect tokens when ordering matters
- `externalUnknown` regions conservatively alias all externally visible memory
  unless noalias or effect facts prove otherwise

Every memory operation has a minimum representation that all passes can rely
on: a region ID, access width and alignment, volatility, layout path when
known, and either a read-only region version or explicit input/output effect
tokens for ordered or mutable regions. Optional memory SSA is an additional
index over that baseline, not a different semantics.

Effect tokens are explicit SSA values:

```text
token1 = platform_call write_console(token0, system_table, buffer)
token2 = volatile_store token1, region firmware_table, address, value
```

Operations that touch multiple ordered regions consume and produce one token
per ordered region. A platform call that may observe the system table, mutate
the console, and update a runtime memory map is represented as a token
fork/join at the operation boundary:

```text
(console1, system_table1, memory_map1) =
  platform_call get_memory_map(console0, system_table0, memory_map0, args)
```

Subsequent operations on only `console` use `console1`. Operations on only
`memory_map` use `memory_map1`. Two token chains are independently reorderable
only when their regions are disjoint and the platform/runtime effect catalog
has no cross-region observation edge between them. A later operation that
requires a combined boundary consumes all required region tokens explicitly.

Effect-token completeness is checked against the normalized target surface.
For every platform call, runtime call, volatile/atomic operation, firmware-table
access, image-device access, terminal operation, or private-state advance, the
operation must consume and produce every region token required by the catalog
entry. Dropping one required token thread is a verifier failure even if the
remaining token def-use graph is otherwise dominant and ordered.

### Target-Effect Normalization Examples

Checked proof/resource effects are place-bound and source-shaped. OptIR must
normalize them into region requirements before any pass can reason about
motion, inlining, specialization, e-graph import, or vectorization.

| Source or catalog case        | OptIR normalization                                                                                                   | Optimization consequence                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| unknown external call         | consumes and produces `externalUnknown` plus every escaped region token reachable from its ABI arguments              | no motion across it except for pure values and regions proven disjoint by effect facts   |
| multi-region platform call    | one input/output token per observed or mutated region, plus catalog cross-region observation edges                    | a slice must import all token threads or cut before/after the call                       |
| callback-capable runtime call | consumes callback-visible regions and marks callback roots as external observation points                             | inlining/specialization may not assume callback-invisible private state                  |
| firmware-table read           | read from `firmwareTable` with volatility/catalog ordering and layout provenance                                      | CSE or load motion only when the catalog allows repeated reads and no intervening writer |
| image-device access           | `imageDevice` region with device-specific volatility, atomicity, and terminal/error behavior                          | vectorization and e-graph import are rejected unless the target contract permits them    |
| private-state advance         | consumes generation token for the private state, produces the next generation, records capability/private-state facts | specialization must key static facts by generation and reject stale clones               |
| terminal platform call        | terminal call terminator with effect-token outputs only for diagnostics/provenance                                    | cleanup may prune following blocks but may not reorder earlier observable effects        |

Example: a source proof may say a platform wrapper only reads the memory map.
The target catalog decides whether that means a pure read of a `memory_map`
region, an ordered firmware-table observation, a console-observable firmware
query, or an unknown external call. If the selected catalog entry is unknown,
the normalized operation uses `externalUnknown`; no checked proof text can
upgrade it to a narrower effect.

Passes may reorder operations only when the region/effect model and fact index
both allow it. A noalias fact can prove two stack regions disjoint. It does not
allow a volatile firmware-table read to move across a platform call unless the
platform effect catalog also proves the call cannot observe or mutate that
region.

Memory SSA construction is deterministic. The optimizer must build memory SSA
for every function before running load/store forwarding, dead-store
elimination, scalar replacement of mutable aggregates, stack promotion, or
e-graph import of a memory slice. It may skip the index for functions with no
mutable non-volatile region and no pass that asks for memory precision. The
trigger depends only on OptIR operation kinds, region kinds, and the fixed pass
pipeline, never on profiling data, hash iteration order, or previous failed
optimization attempts.

## Certified Fact APIs

Certified facts are imported into query indexes. Passes should not iterate over
raw packet arrays and interpret ad hoc strings. They ask typed questions:

```ts
export interface OptIrFactQuery {
  owns(value: OptIrValueId, at: OptIrProgramPoint): OwnershipAnswer;
  mustNotAlias(left: OptIrMemoryRef, right: OptIrMemoryRef, at: OptIrProgramPoint): FactAnswer;
  fieldsDisjoint(left: OptIrFieldRef, right: OptIrFieldRef): FactAnswer;
  provesInBounds(access: OptIrMemoryAccess, at: OptIrProgramPoint): BoundsAnswer;
  layoutOf(subject: OptIrLayoutSubject): LayoutFactAnswer;
  endianOfLayoutAccess(access: OptIrMemoryAccess): EndianAnswer;
  volatilityOf(region: OptIrRegionId): OptIrVolatility;
  callEffects(call: OptIrCallTarget): OptIrEffectSummary;
  terminalBehavior(target: OptIrCallTarget): TerminalAnswer;
  abiShape(subject: OptIrAbiSubject): AbiFactAnswer;
  capabilityFlow(edge: OptIrCapabilityFlowSubject, at: OptIrProgramPoint): CapabilityFlowAnswer;
  provesImpossible(subject: OptIrImpossibilitySubject, at: OptIrProgramPoint): ImpossibilityAnswer;
  privateStateGeneration(
    subject: OptIrPrivateStateSubject,
    at: OptIrProgramPoint,
  ): PrivateStateGenerationAnswer;
  erasureOf(value: CheckedMirValueId): ErasureAnswer;
}
```

Each answer carries the facts used:

```ts
export interface FactAnswer {
  readonly kind: "yes" | "no" | "unknown";
  readonly factsUsed: readonly OptIrFactId[];
  readonly explanation: readonly string[];
}
```

This lets passes record decision logs, lets rewrite-legality validation check
that a rewrite cited the right facts, and lets debug output explain why a
check, copy, branch, wrapper, or load disappeared.

Facts have lineage:

```ts
export interface OptIrFactLineage {
  readonly factId: OptIrFactId;
  readonly source:
    | {
        readonly kind: "checkedPacket";
        readonly factId: CheckedPacketFactId;
        readonly scope: CheckedFactScope;
        readonly invalidatedBy: readonly CheckedFactInvalidation[];
      }
    | { readonly kind: "passDerived"; readonly passId: OptimizationPassId };
  readonly dependencies: readonly OptIrFactId[];
  readonly preservationPolicy: FactPreservationPolicyId;
  readonly origin: OptIrOriginId;
}
```

`endianOfLayoutAccess` is not a separate checked packet fact kind. It is a
typed query over `layoutAbi` facts and the selected authenticated
`LayoutFactProgram`, including wire integer encodings such as `le` and `be`.
The query answer cites the layout/ABI facts that establish the byte order.

Fact import is the bridge from the broad checked-packet envelope to typed
optimization queries. The importer decodes each `CheckedPacketFact` by kind,
subject, scope, dependency set, invalidation triggers, certificate reference,
and origin, then resolves the authenticated semantic source named by that
entry. It populates typed indexes for bounds, aliasing, ownership, layout,
effects, ABI, capability flow, private-state generation, erasure, and terminal
behavior. If a packet entry is syntactically valid but lacks the semantic
source needed for a typed query, that query returns `unknown`; passes may not
recover authority by inspecting the raw packet entry directly.

The current checked fact packet is envelope-shaped: kind, subject, scope,
dependencies, invalidations, certificate, and origin. It is not, by itself, a
kind-specific payload format. Production OptIR must therefore define the
semantic source for every typed query:

| Packet kind         | Typed OptIR answers                                      | Semantic source beyond envelope                                       |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `ownership`         | `owns`, move/copy erasure, transfer identity             | checked state certificate, subject place/value, ownership patch rule  |
| `noalias`           | `mustNotAlias`, escape and forwarding legality           | checked loan/ownership certificate and subject/dependency places      |
| `fieldDisjointness` | `fieldsDisjoint`, field-sensitive memory CSE             | checked place projection keys and layout field paths                  |
| `erasure`           | `erasureOf`, proof-only value removal                    | erasure certificate plus Proof MIR value/place representation         |
| `validatedBuffer`   | `provesInBounds`, validation dominance, path certificate | validation certificate, Proof MIR access shape, layout `readRequires` |
| `packetSource`      | packet/source region link and source length facts        | packet/source subject pair, dependencies, and validation edge         |
| `privateState`      | `privateStateGeneration`                                 | private-state subject generation and certificate                      |
| `platformEffect`    | `callEffects`, volatility/effect ordering                | platform catalog contract normalized by `OptIrTargetSurface`          |
| `capabilityFlow`    | `capabilityFlow`                                         | consumed/produced capability schemas and call/summary certificate     |
| `terminalClosure`   | `terminalBehavior`                                       | terminal graph certificate and callee/primitive terminal summary      |
| `exitClosure`       | terminal/exit cleanup reachability                       | terminal graph certificate and exit closure dependencies              |
| `layoutAbi`         | `layoutOf`, `endianOfLayoutAccess`, `abiShape`           | selected authenticated `LayoutFactProgram` and ABI fact key           |
| `origin`            | provenance contributor                                   | checked origin map                                                    |

`provesImpossible` has no separate checked packet kind. It is a typed query
over existing certified sources such as `validatedBuffer`, `layoutAbi`,
`terminalClosure`, `exitClosure`, enum/range facts imported from Proof MIR,
and pass-derived range/control facts whose lineage cites those sources. An
impossibility answer must still carry `factsUsed`; if the contradiction is only
an optimizer inference, the answer cites the pass-derived fact plus its checked
dependencies.

If an answer needs information that cannot be reconstructed from the envelope,
the accepted checked summary, the referenced Proof MIR node, the selected
layout program, or the authenticated target catalog, construction must return
`unknown` for that query or fail boundary validation when the operation
requires a check-free certified fact. Adding a new typed query requires adding
its semantic source to this table and tests for missing, stale, and
insufficient entries.

## Fact Import Schemas

Each checked packet kind has a closed import schema. The importer must validate
the schema before populating typed indexes. It must not reconstruct semantics
by concatenating subject keys, dependency keys, origin strings, or certificate
IDs ad hoc.

```ts
export interface CheckedFactImportSchema {
  readonly kind: CheckedPacketFactKind;
  readonly subject: CheckedFactSubjectSchema;
  readonly dependencies: readonly CheckedFactDependencySchema[];
  readonly certificateRules: readonly CheckedCertificateRuleSchema[];
  readonly proofMirLookup: CheckedProofMirLookupSchema;
  readonly typedAnswers: readonly OptIrTypedFactAnswerKind[];
}
```

Schema requirements:

| Kind                | Required subject shape                          | Required dependencies                                  | Certificate rule                                    | Proof MIR/layout/catalog lookup                                      |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| `ownership`         | `place` or `value`                              | owner place/value, transition certificate dependencies | ownership or state certificate                      | resolve place/value liveness and resource kind at the scoped point   |
| `noalias`           | `place`, `value`, or `edge` naming both sides   | both place/value IDs plus loan or ownership cert       | loan-disjointness or ownership-transfer certificate | resolve both memory refs and scope dominance                         |
| `fieldDisjointness` | projected `place`/field subject                 | base place plus field/layout dependencies              | loan-disjointness or layout-read certificate        | resolve projection paths through layout facts                        |
| `erasure`           | proof-only `place` or `value`                   | erased subject plus replacement fact dependencies      | erasure certificate                                 | resolve Proof MIR representation and prove no executable use remains |
| `validatedBuffer`   | validation result, edge, or packet/source place | validation edge, layout fact, source length facts      | layout-read or core entailment certificate          | resolve read byte range, domination edge, and path certificate       |
| `packetSource`      | `packetSource` pair                             | packet place, source place, validation dependencies    | packet-source certificate                           | create backing packet/source region link                             |
| `privateState`      | `privateState` with generation                  | prior generation or transition dependencies            | private-state transition certificate                | resolve generation equality and invalidation triggers                |
| `platformEffect`    | `call` or authority subject                     | authority entry, call ID, affected place dependencies  | authority/platform-effect certificate               | resolve platform contract and normalized region requirements         |
| `capabilityFlow`    | `call`, `place`, or authority subject           | consumed and produced capability place dependencies    | platform/runtime/source-call transfer certificate   | resolve capability endpoints and call/result substitution            |
| `terminalClosure`   | `terminal` subject                              | terminal graph and effect dependencies                 | terminal graph certificate                          | resolve terminal behavior and successor reachability                 |
| `exitClosure`       | `function`, `block`, or `edge`                  | exit certificates and terminal graph dependencies      | exit-closure or terminal certificate                | resolve cleanup reachability and exit edge set                       |
| `layoutAbi`         | `layout` subject                                | layout fact key and ABI dependencies                   | layout/ABI certificate                              | resolve selected authenticated layout fact program                   |
| `origin`            | `mirOrigin` or source subject                   | origin-map entry                                       | origin certificate                                  | resolve checked origin map                                           |

Every schema has negative tests for wrong subject kind, missing dependency,
wrong certificate rule, stale scope, mismatched authority fingerprint, missing
Proof MIR node, and mismatched layout fingerprint. Optional query precision is
allowed only by returning `unknown`; it must not create a weaker yes-answer
from a partially matched envelope.

The default policy for a pass is conservative: drop every fact whose subject,
dependency, upstream scope, upstream invalidation trigger, dominance relation,
region, effect token, call result, or layout/ABI interpretation may have
changed. A pass may preserve or derive facts only by declaring a checked
preservation policy and passing fact preservation verification. The verifier
must consult both the upstream `CheckedFactScope` and the upstream
`CheckedFactInvalidation[]` before a checked packet fact survives a rewrite.

## Path Certificates

Path-scoped facts require their own preservation object. They are the common
case for validated-buffer bounds, rejection-path pruning, parser collapse, and
branch deletion, and they are also where an optimizer can most easily delete a
check on the wrong path.

```ts
export interface OptIrPathCertificate {
  readonly certificateId: OptIrPathCertificateId;
  readonly sourceFact: OptIrFactId;
  readonly sourceScope: CheckedFactScope;
  readonly requiredEdges: readonly OptIrEdgeId[];
  readonly requiredDominators: readonly OptIrBlockId[];
  readonly excludedEdges: readonly OptIrEdgeId[];
  readonly invalidationTriggers: readonly CheckedFactInvalidation[];
  readonly origin: OptIrOriginId;
}

export interface OptIrEdgeImplication {
  readonly oldEdge: OptIrEdgeId;
  readonly newPath: readonly OptIrEdgeId[];
  readonly conditionFacts: readonly OptIrFactId[];
  readonly cfgEdit: OptIrCfgEditId;
}
```

Upstream `CheckedPathCertificateId` is opaque by itself. Production OptIR
requires `checkedEvidence.pathCertificates` to resolve every path-scoped fact
to required edges, dominators, excluded alternatives, and invalidation
triggers. If a path-scoped checked fact lacks a matching checked path
certificate record, boundary validation fails. Non-path queries may still
return `unknown` when optional facts are absent, but path-scoped facts are not
accepted without their preservation data.

During construction, upstream `ProofMirControlEdgeId` and checked MIR edge
origins are mapped into fresh `OptIrEdgeId` records. The mapping is stored in
the construction provenance index and is used exactly once to create the
initial `OptIrPathCertificate` table. After construction, all path preservation
uses `OptIrEdgeId`; later passes must not reach back to Proof MIR edge IDs to
recover a path fact.

A CFG rewrite may preserve a path certificate only by proving that the
rewritten edge set implies the original required path condition, excludes the
same failing alternatives, and does not cross any upstream invalidation
trigger. Block cloning, edge splitting, branch folding, inlining, and e-graph
region replacement must either re-home the certificate to caller-local or
rewritten edges or drop every path-scoped fact that depends on it. Runtime
check removal, zero-copy reads, parser-state collapse, and vector lane access
must fail closed when the required path certificate cannot be preserved.

Path-certificate re-homing is implication-based:

1. Every required old edge must map to a non-empty new edge path whose
   conditions imply the old edge condition.
2. Every excluded old edge must be absent, unreachable, or mapped to an
   excluded new path.
3. Every required dominator must still dominate the certificate use after block
   cloning, edge splitting, branch folding, or subgraph replacement.
4. No rewritten path may cross a checked invalidation trigger unless the pass
   derives a replacement fact after that trigger.
5. The new certificate receives a new `OptIrPathCertificateId` with lineage to
   the checked certificate, the CFG edit record, and every fact used to prove
   implication.

The original certificate is immutable. A pass either constructs a new
caller-local or rewrite-local certificate through this algorithm, or drops all
facts that cite the old certificate.

## Provenance Model

OptIR provenance must survive aggressive rewriting. The optimizer needs it for
debugging, diagnostics, scorecard artifacts, and optimization explanations.

```ts
export interface OptIrOrigin {
  readonly originId: OptIrOriginId;
  readonly sourceSpan?: SourceSpanId;
  readonly hirOrigin?: HirOriginId;
  readonly monoInstance?: MonoInstanceId;
  readonly proofMirNode?: ProofMirNodeRef;
  readonly checkedMirNode?: CheckedMirNodeRef;
  readonly layoutFact?: LayoutFactKey;
  readonly checkedFact?: CheckedPacketFactId;
  readonly synthetic?: OptIrSyntheticOrigin;
}
```

When a pass combines operations, the resulting origin should preserve the
primary user-facing source span plus contributor origins. For example, a
bounds-check elimination explanation should be able to name the eliminated
check, the packet length fact, the layout field range, and the validation edge
that certified the packet/source relationship.

Synthetic origins are allowed, but they must point back to the pass and input
origins that created them. A synthetic operation with no contributor is valid
only for target- or compiler-owned scaffolding such as a generated trap block
or a debug-only verifier sentinel.

## Deterministic IDs

All IDs created by construction or optimization are allocated from explicit
namespaces. Determinism is not allowed to depend on map iteration order, hash
seeds, worker scheduling, wall-clock timing, or whether a previous candidate
rewrite failed.

Construction IDs are derived from stable checked MIR, layout, fact-packet, and
target-surface IDs whenever possible. When construction must synthesize an
OptIR value, block, region, origin, or fact, it allocates from a deterministic
preorder over functions, blocks, statements, operands, regions, and fact
dependencies.

Pass-created IDs use a stable pass-run namespace:

```text
(optimization profile version,
 pass pipeline index,
 pass id,
 function id,
 rewrite region id,
 creation role,
 deterministic ordinal)
```

Before mutating a function, a pass computes the complete list of candidates it
will visit in stable order and allocates ordinals from that list. Preserved
operations keep their existing IDs only when their semantic role and dominance
position are unchanged; replacements receive new IDs with synthetic origins
that point to the original operations and facts. Pass-derived facts, synthetic
origins, rewrite regions, path certificates, e-classes, e-nodes, vector packs,
and memory-SSA versions all follow this rule.

E-graph IDs are deterministic within the imported region. Import order is the
stable order of referenced OptIR operations and operands. Rule applications
are sorted by stable rule ID, match root, operand IDs, and fact IDs. Extraction
ties are broken by the checked-in extraction policy, then by replacement root
ID. A saturated e-graph that reaches fuel must still produce the same debug
dump and the same unchanged OptIR for identical inputs.

## Construction Flow

OptIR construction is deterministic:

```text
Checked MIR + certified fact packet + checked optimization evidence
  -> boundary validation
  -> region table construction
  -> function and block skeleton construction
  -> scalar SSA/block-argument lowering
  -> canonical operation lowering
  -> certified fact import
  -> proof erasure
  -> construction cleanup
  -> structural, SSA, region, and fact verification
```

Region construction runs before operation lowering so loads, stores, calls, and
validated-buffer reads all target stable regions. It creates regions for
place-backed locals, source aggregates whose address escapes, packet/source
relationships, validated payload views, constant data, globals, image devices,
firmware tables, runtime-owned memory, and external unknown memory.

Function skeleton construction allocates `OptIrFunctionId`, `OptIrBlockId`,
and block parameters in canonical order from checked MIR IDs. Loop-header
parameters and branch-join parameters should be predeclared when checked MIR
already has SSA information. Where checked MIR represents a value through a
place, construction decides whether it remains place-backed or becomes an SSA
value based on address-taking, mutation, join, loop-carried use, and escape
facts.

Proof erasure happens after facts are imported:

```text
1. import checked erasure facts
2. map erased Proof MIR values and operations to OptIR provenance records
3. preserve facts that depend on erased values through lineage
4. remove proof-only operations from executable OptIR
5. verify no executable operation depends on an erased proof-only value
```

If any executable operation still depends on an erased value, construction
fails. The optimizer must never silently materialize proof-only values at
runtime.

## Pass Pipeline

The production pipeline should be staged:

```text
Checked MIR + certified fact packet + checked optimization evidence
  -> OptIR construction, fact import, proof erasure, and canonicalization
  -> construction cleanup and verification
  -> mandatory semantic inlining
  -> cleanup and verification
  -> bounded scope-expansion fixpoint:
       budgeted whole-program inlining
       whole-program specialization
       SCCP-driven cleanup
       verification after each committed mutation
  -> scalar simplification
  -> memory and region optimization
  -> Wrela-specific optimization rounds
  -> bounded fact-gated e-graph rewriting
  -> vector preparation, SLP vectorization, and certified loop vectorization
  -> final cleanup and verification
  -> AArch64 machine IR lowering
```

Cleanup is not a single pass. It includes copy propagation, trivial block
merging, unreachable block removal, DCE, constant folding, and fact-index
maintenance required to keep the next pass group simple.

Passes run with a fixed order in production builds. Debug builds may allow
selective pass disabling, pass dumping, decision-log emission, and verifier
after-each-pass mode. Offline scorecard and search tooling may explore pass
orders, but those recommendations do not change production policy until a
human-reviewed compiler policy update lands.

## Pass Ordering Rationale

There is no provably optimal total pass order; the optimal order is
program-specific and intractable to search at compile time. The production
pipeline is therefore a fixed, human-reviewed order chosen for determinism,
bounded compile time, and reviewability, not a claim of per-program optimality.
Three properties make that fixed order principled rather than folklore.

Correctness is not allowed to depend on a lucky pass order. Every pass
`invalidatesByDefault`, and facts survive only by passing preservation. A pass
that runs before a fact it could use simply sees `unknown` and does less; it
never miscompiles. However, arbitrary permutations are not valid production
schedules: the pipeline builder rejects any order that violates declared
preconditions, stale-analysis recomputation, effect-token availability, or
fixpoint fuel bounds. Any verifier-accepted schedule is correct; the reviewed
production schedule is the only schedule shipped.

The order follows a forced partial order: build up, clean up, then commit.
Construction, fact import, and proof erasure run first. Scope-expanding passes
(inlining, specialization) run before the simplification that consumes their
exposed structure. Analyses run before the transforms that read them and are
invalidated after. Destructive or lowering-committing passes (vectorization,
select/cmov preparation) run late and ideally once, because later passes cannot
see through the form they produce. The default staging is:

```text
construct/import/erase/canonicalize         -> cleanup fixpoint
mandatory semantic inlining                 -> cleanup fixpoint
{ whole-program inlining, specialization, SCCP } -> bounded mutual fixpoint
scalar simplification cluster               -> fixpoint
memory and region optimization              -> scalar cleanup
Wrela fact rounds                           -> fixpoint
bounded fact-gated e-graph
vectorization (prep, SLP, loop, cleanup)
final cleanup fixpoint                      -> lowering
```

Enabling clusters iterate to a fixpoint; expensive or destructive passes run in
a bounded number of rounds. Whole-program inlining, specialization, and
SCCP-driven cleanup are interleaved as one budgeted worklist fixpoint rather
than staged as separate one-shot passes, because each exposes new constant
arguments, dead edges, and inline candidates for the others. The shared
scope-expansion budget and fuel (see Scope-Expansion Budget) keep the fixpoint
terminating and deterministic. Every pass in a fixpoint must be idempotent, and
each fixpoint is bounded by explicit fuel so it terminates regardless of input.

The fixed order is a checked artifact, not a comment. A pass declares exactly
one `OptIrPassContract` (see Fact Preservation And Verification); its scheduling
facet is the part the pipeline builder reads to order and re-run passes:

```ts
export interface OptIrPassSchedulingContract {
  readonly requires: readonly OptIrFormOrFactPrecondition[];
  readonly produces: readonly OptIrFormOrFactPostcondition[];
  readonly invalidatesAnalyses: readonly OptIrAnalysisId[];
  readonly idempotent: boolean;
  readonly fuel: OptIrPassFuelPolicy;
}
```

This is a facet of the single per-pass contract, not a second contract object.
`passId`, fact preservation, and rewrite-legality obligations live on the
enclosing `OptIrPassContract`, so a pass's scheduling and fact-preservation
declarations cannot drift to different passes or fall out of sync.

The pipeline builder verifies that the production order is enabling-consistent:
no pass is scheduled before a producer of one of its preconditions, every
invalidated analysis is recomputed before its next consumer, and every declared
fixpoint contains only idempotent, fuel-bounded passes. Production scheduling
may be demand-driven within this contract: a worklist over `(pass, region)`
items re-runs only the passes whose preconditions a mutation may have newly
satisfied, ordered by stable IDs and bounded by global fuel. This yields
fixpoint quality without blindly re-running every pass, while staying
deterministic.

Local ordering sensitivity is dissolved, not ordered. Two mechanisms remove
order decisions instead of tuning them. SCCP combines constant propagation and
unreachable-block elimination into one monotone fixpoint, because separated they
are strictly weaker. The bounded fact-gated e-graph applies all of its catalog
rewrites to saturation and extracts by cost, so within an e-graph region the
order of those rewrites is a non-question. Passes that can be expressed as local
rewrite rules — folding, GVN, copy propagation, bounds-branch deletion, endian
folding, move/copy erasure, layout arithmetic, parser-state collapse, and
field-disjoint CSE — should migrate into the e-graph catalog over time so the
ordered-pass surface shrinks to the transforms that genuinely cannot be local
rewrites: interprocedural inlining/specialization, memory-SSA-dependent memory
optimization, and the vectorization commitment.

Order tuning stays offline. Pass-order search, threshold sweeps, and
feature-classified order profiles are scorecard-lab activities. They may
recommend a new production order, or a small finite set of reviewed order
profiles selected at compile time by a deterministic static classifier, but a
recommendation becomes production authority only after human review lands it as
ordinary compiler policy. Production compilation never searches pass orders,
consults scorecard baselines, or selects an order from benchmark data.

## Production Policy Files

Optimization profitability is governed by checked-in policy files, not by
scorecard state or machine-local measurements. A policy value is authority only
when it is committed in `src/opt-ir/policy/`, covered by deterministic tests,
and loaded through the selected optimization profile.

The first production policy surface should include:

| Policy file                   | Required meanings                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pass-order-policy.ts`        | fixed pass order, fixpoint membership, maximum rounds, demand-driven worklist priority                      |
| `expansion-budget.ts`         | per-function, per-SCC, and whole-image code-size budget; reserve/commit/release rules; recursion refusal    |
| `inline-policy.ts`            | callee-size units, callsite-benefit units, loop-depth penalty, external-root/callback/effect boundaries     |
| `specialization-policy.ts`    | static-argument signature keys, max variants per function/SCC, clone dedup, unroll and residualization fuel |
| `egraph-extraction-policy.ts` | max e-nodes/e-classes/iterations, extraction weights, uncertainty penalty, rule-family enables              |
| `memory-policy.ts`            | stack-promotion size limits, SROA aggregate limits, DSE/forwarding region classes, escape cutoffs           |
| `vector-policy.ts`            | SLP pack widths, loop vector widths, tail-plan costs, register-pressure estimate, target-feature gates      |

Policy values must use deterministic static features:

```text
operation count
estimated byte size
loop depth
known cold structural context
external-root or callback reachability
effect boundary kind
region kind and volatility
estimated live vector/scalar values
available target feature bits
fact-query answers and uncertainty
```

They must not use wall-clock time already spent, host CPU counters, scorecard
baselines, benchmark labels, previous successful compilation choices, hash
iteration order, or source names as profitability signals. A policy may contain
concrete numeric thresholds, but every threshold must name its unit. For
example, inline size is counted in normalized OptIR operation units, e-graph
fuel is counted in rule applications and e-node/e-class caps, and register
pressure is estimated from OptIR live ranges before physical register
allocation.

## Mandatory Semantic Inlining

Mandatory semantic inlining removes abstraction layers whose runtime purpose
was to carry proof, validation, resource, generic, or platform-contract shape.
It runs before budgeted performance inlining because these wrappers often
unlock canonical operations and facts that ordinary optimization needs.

Mandatory candidates are imported from `OptIrFunctionSummary.semanticInlinePolicy`
with `kind: "mandatory"`. The accepted checked summary, not source syntax or
construction-time body-shape recovery, classifies the wrapper reason.
Mandatory reasons include:

- proof wrappers whose body exists only to package `requires` or `ensures`
- validation helpers that immediately expose a checked validation result
- monomorphized generic shims whose type abstraction is gone after mono
- resource/newtype wrappers that do not change runtime representation
- single-call internal thunks produced by lowering or wrapper libraries
- contract-preserving platform wrappers around a certified primitive
- contract-preserving runtime wrappers around a compiler-runtime helper

A candidate is inlined only when all of these are true:

- the callee body is available in the closed image
- the call is not an externally required ABI boundary that must remain as a
  callable symbol
- inlining preserves terminal behavior, panic behavior, and divergence facts
- inlining preserves platform/runtime effect order and capability flow
- any proof/resource-only parameters have already been erased or have erasure
  facts
- the callee's ABI wrapper obligations are not observable at the call site
- fact preservation for the call-result and callee-summary facts succeeds

Contract-preserving platform wrappers are especially strict. Inlining may
remove a source wrapper around a platform primitive only when the wrapper's
certified effect summary, required facts, produced facts, capability flow,
volatility, terminal behavior, and ABI facts are equivalent to the wrapped
primitive plus ordinary pure computation. A wrapper that logs, mutates state,
performs validation with observable failure, changes error policy, or touches a
different region is not a mandatory inline candidate.

If a wrapper is marked as mandatory by the checked summary but cannot be proven
safe to inline, optimization returns `kind: "error"` with an internal compiler
diagnostic. That usually means an earlier phase mislabeled the wrapper, omitted
a required fact, or kept an observable boundary hidden behind a proof-only
abstraction. Budgeted performance inlining may decline a candidate and keep the
call; mandatory semantic inlining may not.

Inlining owns an explicit fact re-homing step. Checked facts imported from a
callee body are keyed by callee function, block, edge, value, place, statement,
and call IDs. After inlining, any preserved callee-body fact must be remapped
to caller-owned OptIR subjects and caller-owned scopes:

```text
callee fact
  -> inline substitution for values, places, regions, block arguments, and calls
  -> caller dominance and effect-token validation
  -> upstream scope/invalidation validation
  -> new pass-derived fact with checked-packet lineage
```

Facts whose subjects cannot be remapped are dropped. `path` facts are dropped
unless the inliner produces a caller-local path certificate that proves the
same accepted path condition after block cloning and edge rewiring. Capability
flow and private-state generation facts are preserved only when the inliner
proves that consumed/produced capabilities, state generations, and terminal or
effect boundaries are identical after substitution.

## Budgeted Whole-Program Inlining

After mandatory inlining and cleanup, budgeted whole-program inlining becomes a
participant in the bounded scope-expansion fixpoint over the closed
monomorphized call graph. It may reserve budget, commit an inline, and enqueue
SCCP cleanup or specialization work, but it does not own a separate one-shot
pipeline slot.

Whole-image monomorphization rejects reachable source recursion, so source-call
recursive SCCs should normally be absent. The inliner still computes SCCs
because the graph can contain external roots, platform/runtime callbacks,
compiler-generated thunks, recovery nodes, future extension edges, and
conservative indirect-call summaries. Any recursive or maybe-recursive SCC is
handled with a no-inline default unless a future feature defines a finite,
contract-preserving unroll rule.

Inlining policy is local and bounded. It may use:

- callee size and estimated post-cleanup size
- static cold-path classification from rejection, panic, trap, terminal, or
  checked-summary divergence structure
- loop nesting depth
- constant argument exposure
- noalias, bounds, layout, and terminal facts exposed by the callee summary
- effect-token boundaries
- expected cleanup opportunities after mandatory wrappers are gone
- code-size budgets per function, per SCC, and per image, debited from the shared
  scope-expansion budget (see Scope-Expansion Budget)
- external-root and callback boundary constraints
- local register-pressure estimates

Inlining policy must not use:

- scorecard baselines
- benchmark data
- recursive whole-pipeline trial optimization
- host CPU measurements
- unbounded pass-order search

External roots keep their externally visible ABI entry symbol. The inliner may
inline callees into an external root's body, but it must not remove or rename
the root boundary. Callback functions and address-taken functions are similarly
conservative: their bodies may be optimized, but their callable identity
survives unless escape analysis proves the address never leaves a closed,
rewritable context.

Platform and runtime effect boundaries are hard boundaries by default.
Inlining may expose pure argument preparation, wrapper validation, and
representation shims around such calls, but it must not duplicate, delete,
merge, or reorder the effectful call itself unless the platform/runtime catalog
and rewrite-legality validation approve the exact rewrite.

## Scope-Expansion Budget

Budgeted whole-program inlining and whole-program specialization both grow code,
and they run as one interleaved fixpoint (see Pass Ordering Rationale). They must
not hold independent budgets: two separately-capped passes can each stay under
their own limit while together exceeding the real code-size growth limit. The two
passes therefore share one budget ledger; only their profitability heuristics are
pass-specific.

```ts
export interface OptIrExpansionBudget {
  readonly perFunctionGrowth: OptIrCodeSizeBudget;
  readonly perSccGrowth: OptIrCodeSizeBudget;
  readonly perImageGrowth: OptIrCodeSizeBudget;
  readonly fixpointFuel: OptIrFuel;
}

export interface OptIrExpansionBudgetLedger {
  reserve(
    scope: OptIrBudgetScope,
    estimatedGrowth: OptIrCodeSizeDelta,
  ): OptIrBudgetReservation | "denied";
  commit(reservation: OptIrBudgetReservation): void;
  release(reservation: OptIrBudgetReservation): void;
  remaining(scope: OptIrBudgetScope): OptIrCodeSizeBudget;
}
```

The ledger lives in `policy/expansion-budget.ts`. Inlining and specialization own
profitability heuristics in `policy/inline-policy.ts` and
`policy/specialization-policy.ts`, but both debit the same ledger. A candidate is
admitted only when `reserve` succeeds against every scope it grows — per-function,
per-SCC, and per-image — after which the pass performs the rewrite and `commit`s,
or `release`s the reservation if the rewrite is abandoned. The interleaved
fixpoint stops when no remaining candidate can reserve budget or `fixpointFuel`
reaches zero.

Accounting is deterministic. Growth estimates are computed from OptIR operation
counts and clone/unroll sizes in stable ID order, never from wall-clock time or
previous attempts. Reservation, commit, and release follow the deterministic
worklist order, so the same OptIR, target surface, and budget admit the same set
of inlines and specializations. Statically cold code is not charged growth it
will not incur: a candidate the cold-path classifier declines is never reserved.

## Whole-Program Specialization

Whole-program specialization is binding-time-driven partial evaluation over the
closed monomorphized image. It turns general, configuration-driven Wrela source
— schema-driven serializers, grammar-driven parsers, register-map-driven
drivers, policy-driven pipelines — into specialized clones and straight-line
residual code by baking in the static structure those programs otherwise
re-interpret at runtime. It is the value-level generalization of
monomorphization: where mono specializes generic code against statically known
types, specialization specializes any function against statically known values,
control structure, and certified facts.

Specialization is a sibling of the e-graph. Both are bounded, deterministic,
fact-aware rewrite searches that must pass the same rewrite-legality validation.
They differ in shape and compose:

- the e-graph is intra-region equality saturation that rewrites one effect-safe
  slice in place
- specialization is interprocedural value-driven cloning and control-flow
  driving that residualizes the dynamic remainder of a call
- specialization exposes static straight-line structure — unrolled loops, driven
  switches, folded offsets — that the Wrela-specific passes and the e-graph then
  refine locally

Specialization runs inside the bounded scope-expansion fixpoint with budgeted
whole-program inlining and SCCP-driven cleanup. Inlining exposes constant
arguments and merges trivial wrappers; specialization then drives static
control and clones callees; SCCP removes newly dead paths and exposes more
static bindings. The shared budget and fixpoint fuel determine when that
mutual expansion stops before the later scalar and Wrela-specific rounds clean
up the residual.

Binding-time sources. A value or control decision is static only when it is
computable at compile time from OptIR semantics and certified facts, never from
source text or unverified host assumptions. The permitted static binding sources
are:

- interned typed constants and constant block arguments revealed by SCCP,
  inlining, or a dominating switch edge
- canonical layout terms and layout/ABI/data-model facts queried through
  `layoutOf`, `endianOfLayoutAccess`, and `abiShape`
- statically known callee identity in the closed call graph
- pure operation results that constant-fold from static operands under the
  operation's declared `OptIrOperationSemantics`
- private-state generations and capability tokens whose `privateStateGeneration`
  / `capabilityFlow` answers are exact at the program point
- impossibility facts from `provesImpossible` that make a branch, arm, or case
  statically dead

A value derived only from static bindings is static; any value that consumes a
dynamic operand, an unknown call result, or an out-of-scope fact is dynamic.
Binding-time analysis is a deterministic monotone fixpoint over operations and
block arguments in stable ID order. It never consults profiling data, host
timing, or previous specialization attempts.

Transforms. Within budget, specialization performs four transforms, each backed
by a named rewrite invariant:

- compile-time evaluation of static pure operations into interned constants
  (`pureAlgebraicEquivalence`, `layoutEndianEquivalence`)
- control-flow driving: a branch or switch with a static discriminant keeps only
  its taken successor, and the dead arms and now-unreachable blocks are removed
  (`terminalReachabilityEquivalence`, plus `boundsDominanceElimination` when the
  driven condition is a certified bounds check)
- bounded loop unrolling when the loop trip structure is static and within the
  unroll budget
- polyvariant function cloning: a call with a non-trivial static-argument
  signature is redirected to a specialized clone of the callee with those
  arguments baked in; the dynamic arguments remain parameters
  (`ownershipRuntimeIdentity` plus the effect, capability, and private-state
  invariants the clone touches)

Clones are deduplicated by a canonical static-argument signature, so two call
sites with the same static arguments share one clone. The signature canonicalizes
static operands by interned constant ID, layout fact key, callee identity, and
the exact facts cited as static, in stable order. Cloning, driving, and unrolling
re-home facts and path certificates exactly as inlining does: callee-body facts
are remapped to clone-owned subjects and scopes, `path` facts are dropped unless
a clone-local path certificate proves the same accepted path condition, and a
driven-branch deletion preserves the dominating path certificate or drops every
path-scoped fact that depended on the removed edge.

Boundaries and budgets. Specialization is bounded by the same discipline as
inlining and the e-graph:

- per-function clone-variant caps, a per-function, per-SCC, and per-image
  code-size budget shared with inlining through the scope-expansion ledger (see
  Scope-Expansion Budget), a maximum unroll factor, and explicit fuel; a
  candidate that would exceed budget stays general
- statically cold code — rejection, panic, trap, terminal, or checked-summary
  divergence structure — is not specialized; cold paths stay general and shared
- recursive and maybe-recursive SCCs are not specialized across by default; a
  finite, contract-preserving static-driven unroll is the only exception, and
  only when the driving condition is statically decreasing
- external roots keep their externally visible general entry symbol;
  specialization may add internal clones reached from a root but must not remove,
  rename, or specialize the root boundary itself; callbacks and address-taken
  functions keep their callable identity unless escape analysis proves the
  address never leaves a closed, rewritable context
- platform and runtime effect calls are hard boundaries: specialization may bake
  static arguments and hand a narrowed call to platform call specialization, but
  it must not duplicate, delete, merge, or reorder the effectful call beyond what
  the catalog and rewrite-legality validation approve; volatile, MMIO,
  firmware-table, and image-device operations are never specialized away
- a clone specialized on a private-state generation or capability token is
  invalid past any of that fact's invalidation triggers and is rejected by
  verification if reached there

Specialization changes control flow and values, not physical representation. It
must not re-lay out a type, change a region's layout key, or alter ABI shape;
layout remains an authenticated input to this phase. The static inputs must live
in the closed image: specialization is ahead-of-time, does not specialize on
values known only at runtime, and does not invent runtime dispatch that selects
among clones by a dynamic value unless an ordinary switch over a dynamic
discriminant already existed.

Worked example. A general field reader driven by a runtime descriptor, after
inlining into a schema-driven parse loop, exposes a static descriptor table and
a dynamic packet:

```text
block parse(buf: packet_region, schema: const schema_table):
  // schema is static; buf is dynamic
  loop field in schema.fields:        // schema.fields length is static
    kind   = field.kind               // static
    offset = field.offset             // static
    switch kind, read_u16_be(buf, offset), read_u32_le(buf, offset), read_varint(buf, offset)
```

Specialization unrolls the static loop, drives each static `switch kind` to its
single taken arm, folds each static `offset` to a constant byte range, and — with
the validated buffer's bounds facts in scope — leaves only the dynamic loads:

```text
block parse_ipv4(buf: packet_region):
  total_len = load buf + 2 : be u16
  ttl       = load buf + 8 : u8
  proto     = load buf + 9 : u8
  ...
```

The descriptor walk, the per-field `kind` dispatch, and the static offset
arithmetic are gone; only the byte work that depends on the dynamic packet
remains. The rewrite carries a `specializationResidualEquivalence` obligation
decomposing into the static-evaluation, branch-driving, and bounds-dominance
invariants, with provenance naming the original general `parse` and every fact
gate the residual used.

## Ordinary Scalar And Memory Optimizations

The ordinary optimization suite is intentionally conventional. The unusual part
is that passes can query certified Wrela facts instead of rediscovering them
from low-level patterns.

Scalar optimizations:

- constant folding over typed constants, layout constants, and target data
  model constants
- sparse conditional constant propagation over SSA values and block arguments
- dead-code elimination for unused pure operations and unreachable blocks
- global value numbering and common subexpression elimination for pure values
- copy propagation and block-argument simplification
- branch simplification, switch simplification, and unreachable edge removal
- compare simplification from range, enum, and layout facts
- select/cmov preparation where target lowering benefits and effects allow it

Memory optimizations:

- load/store forwarding inside one region version or effect-token chain
- dead-store elimination for non-volatile stores that are overwritten before
  any possible read or effect observation
- scalar replacement of aggregates whose fields are independently tracked
- stack promotion for non-escaping local regions
- escape analysis for address-taken locals, wrappers, buffers, and callback
  values
- LICM for pure and region-safe operations out of loops
- redundant bounds-check removal when the fact index proves the checked range
- deterministic memory SSA construction before passes that require precise
  memory versions

All memory rewrites are fact-sensitive. A load from a packet source can move
across pure arithmetic, but not across a platform call that may mutate or
invalidate the source. A dead store to an image device region is never dead
unless the target contract says the store is non-observable and replaceable.
A volatile load is never commoned with another volatile load by ordinary CSE.

## Wrela-Specific Optimizations

Wrela-specific passes are where proof acceptance becomes performance authority.
They should be implemented as ordinary OptIR passes with explicit fact uses,
not as hidden behavior in target lowering.

Move/copy elision:

- remove runtime moves of affine/linear/resource wrappers when ownership facts
  prove the transfer is a change of authority, not a byte copy
- remove defensive copies when noalias and escape facts prove the source cannot
  be observed through another region
- preserve observable destructor, terminal, or platform cleanup effects

Zero-copy validated-buffer reads:

- lower validated field reads directly to packet/source region loads when the
  packet/source relationship and byte-range facts prove the access safe
- reuse loaded packet bytes across derived field computations when alias and
  effect facts keep the packet immutable
- avoid materializing intermediate parsed structs unless their address escapes
  or ABI requires a material object

Bounds-check elimination:

- remove runtime range checks whose byte range is implied by checked
  validated-buffer facts, layout `readRequires`, source length facts, or pass
  derived range facts
- re-home the licensing bounds fact onto every check-free packet/source access
  that the removed check used to guard
- preserve the check on paths where the proof fact is path-scoped and the CFG
  rewrite cannot preserve the path certificate
- report the fact chain in debug explanations

Endian-aware field-load folding:

- fold byte loads, shifts, masks, and swaps into one canonical endian load when
  layout facts prove field width, offset, and wire endian
- delay final instruction choice until AArch64 lowering so the backend can pick
  load, rev, ubfx, or vector idioms
- never fold volatile or firmware-table access unless the target contract
  allows the combined access form

Parser pipeline collapse:

- collapse validate, branch, read, derived-field, and case-dispatch pipelines
  into direct region loads and switches when validation facts dominate reads
- avoid materializing parser state machines whose states are proof-only or
  single-use
- retain cold rejection paths and diagnostics origins

Terminal cleanup pruning:

- remove cleanup blocks proven unreachable after terminal calls, traps, panics,
  or `Never` results
- remove resource cleanup that the checker certified as proof-only or already
  transferred
- preserve platform/runtime cleanup calls with observable effects

Wrapper elimination:

- eliminate newtype, resource, validation, generic, and contract wrappers after
  mandatory inlining exposes representation identity
- preserve external ABI wrappers, callbacks, and exported names
- preserve provenance so optimized debug output can explain the original source
  wrapper

Platform call specialization:

- specialize a platform call when constants, ABI facts, and target catalog
  facts select a narrower intrinsic or direct sequence
- specialize firmware-table field access when layout facts prove the table
  field path and volatility/effect rules permit the access shape
- never replace a platform call with ordinary memory operations unless the
  platform primitive contract names that lowering as equivalent

## Bounded Fact-Gated E-Graph Rewriting

Bounded fact-gated e-graph rewriting is part of the production OptIR
optimization system, not a later research add-on. It is the compiler's local
rewrite-search pass for cases where greedy peepholes leave too much on the
table but a global optimization oracle would be too expensive and too hard to
reason about.

The pass runs equality saturation over selected local OptIR regions:

```text
candidate region
  -> import pure value/memory/effect-safe expression slice into e-graph
  -> saturate with syntactic and fact-gated rewrite rules under fixed fuel
  -> extract one replacement with deterministic local cost policy
  -> rewrite OptIR slice
  -> attach fact lineage and optimization explanation
  -> run structural, effect, dominance, fact, and rewrite-legality validation
```

The important design rule is that facts unlock rewrites. A syntactic rewrite
may fire when ordinary OptIR semantics prove equivalence. A fact-gated rewrite
fires only when `OptIrFactQuery` returns a positive answer and the e-graph
records the exact facts used.

Examples:

| Rewrite family            | Example rewrite                                           | Required fact gate                                             |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| endian load folding       | byte loads + shifts + masks -> canonical endian load      | layout path, byte width, endian, alignment, bounds             |
| bounds-branch deletion    | range check + success branch -> success successor         | in-bounds fact in scope and path certificate preserved         |
| move/copy erasure         | wrapper move/copy -> value alias or no operation          | ownership, noalias, erasure, and no observable cleanup effect  |
| layout arithmetic folding | offset + constant layout term -> canonical byte range     | layout fact key and normalized layout term equivalence         |
| parser-state collapse     | validate/read/derived-field chain -> direct field load    | validation edge, packet/source fact, layout read requirements  |
| field-disjoint memory CSE | reload after disjoint store -> previous load              | noalias or field-disjointness plus effect-token compatibility  |
| platform wrapper collapse | source wrapper call -> primitive call plus pure arguments | equivalent platform effect, ABI, terminal, and capability flow |
| vector idiom preparation  | adjacent scalar or loop-carried operations -> vector form | lane bounds, alias/effect safety, endian legality, volatility  |

The e-graph pass is deliberately bounded:

- scope is one function, loop body, straight-line region, parser slice, or
  small single-entry/single-exit subgraph selected by the pass
- node count, e-class count, rewrite iterations, rule applications, extraction
  candidates, and compile-time budget all have explicit limits
- recursive inlining, whole-program extraction, pass-order search, benchmark
  lookup, and scorecard-baseline lookup are not allowed
- rules are deterministic and sorted by stable rule ID
- extraction is deterministic and uses only the local policy feature
  vocabulary, not offline scorecard authority
- a saturated region may be left unchanged when the pass reaches fuel, loses
  required facts, or cannot verify the extracted replacement

Region selection is deterministic and checked into the compiler policy. The
selector walks functions, loop trees, blocks, and operations in stable ID order
and forms candidates in this priority order:

1. parser validation/read/dispatch slices with preserved path certificates
2. canonical loop bodies that already satisfy loop-vectorization shape checks
3. single-entry/single-exit straight-line memory slices inside one compatible
   region-version or effect-token window
4. pure scalar expression DAGs rooted at branches, stores, returns, calls, or
   vector-pack candidates

Candidate boundaries stop at volatile operations, terminal operations,
callbacks, unknown calls, external roots, and platform/runtime effect
boundaries unless a target catalog rule explicitly permits importing that
boundary. Overlapping candidates are resolved by the priority list, then by
smaller containing region, then by stable root operation ID. Region selection
does not use scorecard data, profile data, wall-clock budgets already spent, or
previous extraction success.

An effect-token window may contain a vector of region tokens, not just one
linear token. If a candidate includes an operation that consumes or produces
multiple ordered region tokens, the candidate must include all token inputs,
all token outputs, and all intervening operations on those token threads, or it
must cut the region boundary before or after the multi-token operation. The
selector may not import the `console` token from a platform call while treating
the same call's `system_table` or `memory_map` token as outside the slice.

The pass should use the same cost vocabulary as the local policy and offline
scorecard where possible:

```text
work
control shape
memory shape
runtime checks
fact use
registerability
selectability
code shape
uncertainty
```

That vocabulary is shared for accountability, not authority. Production
extraction chooses one replacement from a bounded local e-graph. The offline
scorecard can later audit whether those choices improved representative cases,
but production extraction does not consult scorecard baselines or benchmark
data.

Extraction weights live in a checked-in production policy module such as
`src/opt-ir/policy/egraph-extraction-policy.ts`. The policy is versioned,
reviewed, and loaded only through the compiler's normal optimization profile.
It may reuse scorecard feature names, but it must not import scorecard
baselines, benchmark results, search-lab artifacts, machine-local timing data,
or generated weight files. Offline scorecard runs may propose a policy change;
that proposal becomes production authority only after it is reviewed and
committed as ordinary compiler policy.

The e-graph owns its own pass contract:

```ts
export interface FactGatedRewriteRule {
  readonly ruleId: OptimizationRewriteRuleId;
  readonly name: string;
  readonly pattern: EGraphPattern;
  readonly replacement: EGraphReplacement;
  readonly gate: FactGate;
  readonly obligation: RewriteInvariant;
  readonly preserves: readonly FactPreservationRule[];
}

export type FactGate =
  | { readonly kind: "none" }
  | { readonly kind: "bounds"; readonly query: BoundsGateQuery }
  | { readonly kind: "alias"; readonly query: AliasGateQuery }
  | { readonly kind: "layout"; readonly query: LayoutGateQuery }
  | { readonly kind: "effect"; readonly query: EffectGateQuery }
  | { readonly kind: "abi"; readonly query: AbiGateQuery }
  | { readonly kind: "terminal"; readonly query: TerminalGateQuery }
  | { readonly kind: "capabilityFlow"; readonly query: CapabilityFlowGateQuery }
  | { readonly kind: "privateState"; readonly query: PrivateStateGateQuery }
  | { readonly kind: "conjunction"; readonly gates: readonly FactGate[] };

export interface EGraphExtractionRecord {
  readonly regionId: OptIrRewriteRegionId;
  readonly chosenRoot: EGraphNodeId;
  readonly cost: LocalPolicyFeatureVector;
  readonly rulesApplied: readonly OptimizationRewriteRuleId[];
  readonly factsUsed: readonly OptIrFactId[];
  readonly legalityChain: readonly RewriteLegalityObligationId[];
  readonly origin: OptIrOriginId;
}
```

E-graph equality is trusted only through the rewrite rule catalog. Every rule
must be a closed schema with a declared semantic invariant and a fact gate that
is sufficient for that invariant. Production extraction replays the rule chain
from the original e-class to the chosen replacement and validates every
`RewriteLegalityObligation` before the OptIR slice is rewritten. A rule that
cites a real but insufficient fact is invalid even when that fact is in scope.

Every e-graph rule has a rule-soundness test suite. Pure algebraic rules are
checked by OptIR interpreter differential tests over generated operands and
edge cases for overflow, traps, poison-free integer semantics, and constants.
Fact-gated rules are tested with fake fact indexes that vary scope,
invalidations, path certificates, volatility, endian encodings, layout keys,
alias relations, and effect-token boundaries. Memory and platform rules are
tested against interpreter traces that compare values plus region/effect
observations. These tests are not a replacement for production
rewrite-legality validation; they are a required merge gate for adding or
changing a rule in the catalog.

Production e-graph extraction also runs bounded translation validation when
the imported slice is interpreter-complete. The validator evaluates the
original slice and extracted replacement over a deterministic finite input set
derived from operand types, constants, range facts, layout bounds, masks, and
edge cases. For memory/effect slices, it uses fake regions and fake
platform/runtime traces supplied by dependency injection. The input set is
stable for identical OptIR and target surfaces; it never uses host randomness
or timing. If the original and replacement disagree, extraction is rejected and
the original OptIR remains unchanged.

Some slices are not interpreter-complete, such as opaque callbacks,
uninterpreted platform effects, or target intrinsics without an OptIR semantic
model. Those slices may still be rewritten only through catalog-approved rules
and rewrite-legality validation, but the extraction record must say
`translationValidation: "notApplicable"` with the stable reason. A rule family
that repeatedly needs `notApplicable` should either gain interpreter semantics
or remain outside the e-graph catalog.

An extracted replacement is accepted only when:

- every operation in the replacement has a valid OptIR type
- every value, region version, and effect token use is dominated by its
  definition
- every memory operation preserves required region and effect ordering
- every volatile, firmware-table, image-device, platform, runtime, terminal,
  and callback boundary is preserved or rewritten by a catalog-approved rule
- every fact used by every rule is still in scope at the rewritten program
  point
- every rule in the extraction has a validated rewrite-legality obligation
  whose required facts match the rule's gate and whose invariant matches the
  reviewed gate-to-invariant schema
- every preserved or derived fact has valid lineage
- the replacement's provenance includes the original region and every fact-gate
  origin used by the extraction
- translation validation passed, or was explicitly not applicable for a stable
  catalog-approved reason

If any check fails, the e-graph pass leaves the original OptIR unchanged and
emits a debug diagnostic when pass tracing is enabled. A failed extraction is
not a user-facing semantic error.

## Vector-Capable OptIR

OptIR should contain vector-capable types and operations from construction so
SLP and certified loop vectorization can ship in the production optimization
system:

```text
vector<u8, 16>
vector<u16, 8>
vector<u32, 4>
vector_mask<lanes>
vector_load
vector_store
vector_masked_load
vector_masked_store
vector_shuffle
vector_compare
vector_select
vector_byte_swap
```

Scalar passes should preserve vector values they do not understand and reject
rewrites that would break vector type invariants. Target features decide which
vector operations are legal for AArch64 lowering.

Masked vector operations define inactive lanes explicitly:

- `vector_masked_load(mask, access, passthrough)` returns the loaded lane when
  `mask[lane]` is true and the corresponding `passthrough[lane]` when it is
  false
- `vector_masked_store(mask, access, value)` stores only active lanes and has
  no memory effect for inactive lanes
- `vector_select(mask, active, inactive)` returns `active[lane]` or
  `inactive[lane]` by lane

The loop vectorizer may represent scalar tails with exact-multiple facts,
masked operations with passthrough operands, or an explicit scalar epilogue.
It must record which tail plan was chosen in the rewrite-legality obligation.

SLP vectorization handles straight-line groups because Wrela packet and layout
code naturally creates adjacent loads, masks, comparisons, and stores. The SLP
pass should look for:

- adjacent packet/source field reads with compatible bounds facts
- adjacent constant-width endian decodes
- repeated validation comparisons over neighboring fields
- small fixed-width copies and sets over non-volatile regions
- parser table checks that can be represented as vector compares

The loop vectorizer handles only loops whose safety and shape are certified. It
should look for:

- loops over validated packet/source ranges with certified bounds for every
  vector lane
- loops with a certified trip count, certified vector-width multiple, or
  certified scalar-tail plan
- loops whose carried values are scalar recurrences, recognized reductions, or
  region/effect tokens the vectorizer can preserve exactly
- loops whose memory accesses are noalias, field-disjoint, read-only, or
  dependency-analyzed through region versions
- loops whose body has no volatile, MMIO, firmware-table, image-device,
  terminal, callback, or platform/runtime effect boundary unless a catalog rule
  explicitly permits the vector form
- loops whose endian conversions, layout strides, and ABI-visible materialized
  values have legal scalar fallback and legal vector lowering

Both vectorizers must be fact-gated:

- every lane access is in bounds
- the region is not volatile, MMIO, firmware-table, or image-device memory
  unless the target contract permits vector access
- the access alignment and unaligned-access policy are legal
- alias/effect facts allow grouping the operations
- endian transformations have a legal scalar or vector lowering
- code-size and register-pressure policy accepts the rewrite

The production loop vectorizer is intentionally fact-gated. It does not try to vectorize
unknown-trip-count loops by adding speculative guards, overlap checks, or
runtime alignment probes. It either has the certified facts needed for the
vector form and any scalar tail, or it leaves the loop scalar.

## Fact Preservation And Verification

Every pass declares one contract covering what it may preserve and derive, the
rewrite-legality obligations it can discharge, and its scheduling facet:

```ts
export interface OptIrPassContract {
  readonly passId: OptimizationPassId;
  readonly invalidatesByDefault: true;
  readonly preserves: readonly FactPreservationRule[];
  readonly derives: readonly FactDerivationRule[];
  readonly rewriteObligations: readonly RewriteLegalityObligation[];
  readonly scheduling: OptIrPassSchedulingContract;
  readonly requiresVerifierAfterRun: boolean;
}
```

The preservation rule is intentionally mechanical:

```ts
export interface FactPreservationRule {
  readonly ruleId: FactPreservationRuleId;
  readonly factKind: CheckedPacketFactKind | PassDerivedFactKind;
  readonly subject: FactSubjectPreservation;
  readonly scope: FactScopePreservation;
  readonly dependencies: FactDependencyPreservation;
  readonly cfg: CfgPreservationEffect;
  readonly memory: MemoryPreservationEffect;
  readonly invalidations: InvalidationPreservationCheck;
  readonly result: FactPreservationResultKind;
}

export type FactSubjectPreservation =
  | { readonly kind: "identity" }
  | { readonly kind: "substitution"; readonly table: SubjectRemapTableId }
  | { readonly kind: "projection"; readonly rule: SubjectProjectionRuleId }
  | { readonly kind: "drop" };

export type FactScopePreservation =
  | { readonly kind: "sameScope" }
  | { readonly kind: "callerLocal"; readonly inlineSite: OptIrCallId }
  | { readonly kind: "cloneLocal"; readonly clone: OptIrCloneId }
  | { readonly kind: "rewrittenRegion"; readonly region: OptIrRewriteRegionId }
  | { readonly kind: "drop" };

export interface SubjectRemapTable {
  readonly values: ReadonlyMap<OptIrValueId, OptIrValueId>;
  readonly blocks: ReadonlyMap<OptIrBlockId, OptIrBlockId>;
  readonly edges: ReadonlyMap<OptIrEdgeId, OptIrEdgeId>;
  readonly calls: ReadonlyMap<OptIrCallId, OptIrCallId>;
  readonly regions: ReadonlyMap<OptIrRegionId, OptIrRegionId>;
  readonly layoutPaths: ReadonlyMap<LayoutFieldPath, LayoutFieldPath>;
}
```

The verifier applies a rule to each candidate fact in this order:

1. Decode the fact into its typed subject, scope, dependencies, invalidation
   triggers, region/effect requirements, and path-certificate references.
2. Apply the subject rule. Identity requires the subject object to be
   unchanged. Substitution must map every value, block, edge, call, region, and
   layout path used by the subject. Projection may only narrow a fact when the
   reviewed projection rule says the narrower subject implies the old subject.
3. Apply the scope rule. The new scope must dominate every use of the
   preserved fact and must not include paths where the old fact was absent.
4. Remap dependencies. Every dependency is either preserved by an earlier rule,
   replaced by a derived fact with lineage to the dependency, or causes the
   candidate fact to be dropped.
5. Check CFG effects. Edge splits, branch folds, block clones, block merges,
   and subgraph replacements must provide `OptIrCfgEdit` records and edge
   implications for every path-sensitive subject.
6. Check memory effects. Region IDs, alias classes, byte ranges, layout paths,
   memory-SSA versions, and effect-token chains must be identical, substituted,
   or proven equivalent by a named memory preservation rule.
7. Check invalidations. No preserved fact may cross a checked invalidation
   trigger, platform/runtime effect boundary, private-state generation
   advance, capability transfer, or layout/ABI reinterpretation unless a
   reviewed derivation rule creates a new post-trigger fact.
8. Emit a new fact record. Checked facts are never mutated in place; preserved
   facts become OptIR facts with lineage to the checked packet entry,
   preservation rule, rewrite obligation, and remapped provenance.

CFG preservation uses a closed edit vocabulary:

```ts
export type OptIrCfgEdit =
  | {
      readonly kind: "edgeSplit";
      readonly oldEdge: OptIrEdgeId;
      readonly newEdges: readonly OptIrEdgeId[];
    }
  | {
      readonly kind: "blockClone";
      readonly oldBlock: OptIrBlockId;
      readonly newBlock: OptIrBlockId;
    }
  | {
      readonly kind: "branchFold";
      readonly oldTerminator: OptIrOperationId;
      readonly survivingEdge: OptIrEdgeId;
      readonly removedEdges: readonly OptIrEdgeId[];
    }
  | {
      readonly kind: "blockMerge";
      readonly oldBlocks: readonly OptIrBlockId[];
      readonly newBlock: OptIrBlockId;
    }
  | {
      readonly kind: "regionReplacement";
      readonly oldRegion: OptIrRewriteRegionId;
      readonly newRegion: OptIrRewriteRegionId;
    };
```

The pass that edits the CFG must provide these records before fact
preservation runs. The verifier rejects any path-scoped fact whose required or
excluded edge is missing from the edit records.

Memory preservation has the same shape. A store/load forwarding fact may
survive only when the memory edit proves the read byte range, write byte range,
region alias class, volatility, endian interpretation, and effect-token order
are unchanged or replaced by an equivalent named rule. A scalar-replacement
fact may re-home a region fact to SSA values only when the region does not
escape, every byte range is accounted for, and destruction/cleanup effects are
preserved or proven absent. E-graph memory rewrites use this same memory edit
record; they do not get a separate shortcut.

Path-certificate preservation is a specialization of CFG preservation. A path
certificate may be re-homed only when the CFG edit records provide edge
implications for all required and excluded edges and the dominance checker
proves the new certificate's dominators at every use site. If the path
certificate cannot be re-homed, every fact whose `lineage` cites it is dropped
before the rewritten program is exposed to later passes.

A pass has exactly one `OptIrPassContract`. Fact preservation, rewrite-legality,
and scheduling (`OptIrPassSchedulingContract`, defined in Pass Ordering
Rationale) are facets of that single object, declared together against one
`passId` and validated together. There is no separate scheduling-contract
record to keep in sync: `pass-verifier.ts` checks the fact and rewrite-legality
facets, and `pass-schedule-consistency.ts` checks the scheduling facet, but both
read the same contract.

OptIR has two verification layers:

```text
bookkeeping verification:
  checks that the rewritten IR is structurally valid and that preserved facts
  still point at valid subjects, scopes, dependencies, and origins

rewrite-legality validation:
  checks that each rewrite rule or pass transform is licensed by its declared
  semantic invariant and by the specific certified facts it cited
```

Bookkeeping verification checks include:

- every value has one definition
- block arguments match predecessor terminator arguments
- dominance holds for value, region-version, and effect-token uses
- region uses respect lifetime and alias-class rules
- volatile, terminal, platform-effect, and runtime-effect operations preserve
  ordering constraints
- effectful operations consume and produce every region token required by the
  normalized target/runtime effect surface
- facts used by a rewrite were in scope at the rewritten program point
- preserved facts still reference existing subjects and unchanged dependencies
- derived facts name their pass, dependencies, and origin
- path-scoped facts are dropped after CFG edits unless the pass proves the path
  certificate is preserved

Rewrite-legality validation checks include:

- every rewrite rule has a stable rule ID, closed operand/result schema,
  semantic invariant, required fact gates, and preservation contract
- every fact gate used by a rewrite matches the rule's reviewed
  `gate => invariant` schema, not merely an in-scope fact
- every rewrite records a `RewriteLegalityRecord` naming the rule, original
  region, replacement region, facts used, invariant kind, and provenance
- every pass-specific transform decomposes into named invariants or a reviewed
  pass schema with typed operands, required facts, subject remapping, CFG edit,
  memory edit, and call edit rules
- every fact-derived rewrite cites the exact checked packet facts or
  pass-derived facts required by its invariant
- every extraction from an e-graph carries a replayable rule-application chain
  from original expression class to chosen replacement

```ts
export type RewriteInvariant =
  | { readonly kind: "pureAlgebraicEquivalence" }
  | { readonly kind: "layoutEndianEquivalence" }
  | { readonly kind: "boundsDominanceElimination" }
  | { readonly kind: "ownershipRuntimeIdentity" }
  | { readonly kind: "noaliasMemoryEquivalence" }
  | { readonly kind: "effectBoundaryEquivalence" }
  | { readonly kind: "terminalReachabilityEquivalence" }
  | { readonly kind: "abiWrapperEquivalence" }
  | { readonly kind: "capabilityFlowEquivalence" }
  | { readonly kind: "privateStateEquivalence" }
  | { readonly kind: "vectorLaneEquivalence" }
  | {
      readonly kind: "conjunction";
      readonly invariants: readonly RewriteInvariant[];
    }
  | {
      readonly kind: "passSpecificInvariant";
      readonly schema: PassInvariantSchemaId;
      readonly checker: PassInvariantCheckerId;
      readonly decomposesTo: NonEmptyReadonlyArray<RewriteInvariant>;
    };

export interface PassInvariantSchema {
  readonly schemaId: PassInvariantSchemaId;
  readonly passId: OptimizationPassId;
  readonly operands: readonly PassInvariantOperandSchema[];
  readonly requiredFacts: readonly FactGate[];
  readonly checker: PassInvariantCheckerId;
  readonly decomposesTo: NonEmptyReadonlyArray<RewriteInvariant>;
}

export interface RewriteLegalityObligation {
  readonly obligationId: RewriteLegalityObligationId;
  readonly invariant: RewriteInvariant;
  readonly requiredFacts: readonly OptIrFactId[];
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly origin: OptIrOriginId;
}
```

Passes may attach optimization explanations, but explanations are not
authority. Rewrite-legality records, fact lineage, and bookkeeping verification
together are the production accountability mechanism: they prove the rewrite is
a well-formed application of reviewed compiler rules with the required facts in
scope. Semantic soundness still relies on the trusted rule catalog and pass
invariants named in the trusted computing base. A rewrite with valid in-scope
facts but no matching rewrite-legality obligation is rejected.

Named invariants are expected for production passes:

| Pass family                     | Required invariant coverage                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| constant folding, SCCP, GVN     | `pureAlgebraicEquivalence`, `layoutEndianEquivalence`                                                                                                                                                                                      |
| DCE and branch simplification   | `terminalReachabilityEquivalence`, `boundsDominanceElimination` when gated                                                                                                                                                                 |
| LICM, DSE, forwarding, SROA     | `noaliasMemoryEquivalence`, `effectBoundaryEquivalence`                                                                                                                                                                                    |
| move/copy and wrapper elision   | `ownershipRuntimeIdentity`, `abiWrapperEquivalence`                                                                                                                                                                                        |
| parser collapse and BCE         | `boundsDominanceElimination`, `layoutEndianEquivalence`, path preservation                                                                                                                                                                 |
| platform/runtime specialization | `effectBoundaryEquivalence`, `abiWrapperEquivalence`, `capabilityFlowEquivalence`                                                                                                                                                          |
| private-state rewrites          | `privateStateEquivalence`, `effectBoundaryEquivalence`                                                                                                                                                                                     |
| whole-program specialization    | `passSpecificInvariant: specializationResidualEquivalence` decomposing to static-evaluation, branch-driving, `boundsDominanceElimination`, `ownershipRuntimeIdentity`, and the effect/capability/private-state invariants its clones touch |
| SLP and loop vectorization      | `vectorLaneEquivalence`, `noaliasMemoryEquivalence`, `effectBoundaryEquivalence`                                                                                                                                                           |

`passSpecificInvariant` is not a free-form escape hatch. In production it must
name a reviewed `PassInvariantSchema`, a first-class typed checker, and a
non-empty decomposition into named invariants. A pass that can only assert
"this is correct" in prose is not eligible to run in production optimization.
Whole-program specialization's `specializationResidualEquivalence` is the
canonical production instance: a typed residual-equivalence checker that
decomposes into the static-evaluation, control-flow-driving, and memory/effect
invariants each clone and driven branch touches.

## Diagnostics And Debug Output

Most user-facing semantic errors should already have been reported before this
phase. OptIR diagnostics are mainly compiler diagnostics, debug traces, and
optimization explanations:

- invalid checked MIR or malformed checked fact packet at the boundary
- unsupported checked MIR operation in OptIR lowering
- missing target optimization surface entry
- failed mandatory semantic inline
- invalid fact-preservation claim
- verifier failure after a pass
- disabled optimization with explanation in debug mode
- removed check/copy/wrapper/load explanation in debug mode

Optimization explanations should be source-level when possible:

```text
removed bounds check at packet.wr:42:13
  access: ipv4.total_length @ byte range [2, 4)
  facts:
    validation edge proves packet source length >= 20
    layout fact proves total_length width = 2
    layout/ABI fact proves wire endian = big
  preserving:
    source span, HIR origin, Proof MIR read, checked fact packet entries
```

Debug dumps should be deterministic and should sort functions, blocks,
operations, regions, facts, and pass logs by stable IDs.

## Output Contract

The phase output is:

```text
OptimizedOptIrProgram
  optimized functions
  canonical blocks and SSA values
  explicit regions, memory versions, and effect tokens
  source/runtime/platform calls still above machine lowering
  vector-capable operations where legal

OptIrFactSet
  authoritative preserved-fact sidecar
  checked-packet facts still valid after rewrites
  pass-derived facts with lineage
  dropped-fact records in debug builds

OptIrProvenanceMap
  snapshot of returned program.provenance
  source/HIR/mono/Proof MIR/checked MIR/layout/fact origins
  synthetic optimization origins

LocalPolicyDecisionLog
  emitted only in debug or scorecard modes
```

AArch64 lowering consumes optimized OptIR plus the preserved fact set. It may
use facts that remain valid, such as noalias, ABI, layout/endian, volatility,
terminal, and effect facts, but it must not resurrect facts dropped by OptIR
passes.

## Testing Strategy

Unit tests should cover:

- deterministic OptIR ID allocation and table ordering
- stable CFG edge allocation, edge-implication records, and block-argument
  verification after edge splits, branch folds, and block clones
- boundary validation for checked MIR and checked fact packets
- closed operation-schema derivation for types, semantics, effects,
  interpreter rules, canonical forms, and verifier recomputation
- region construction for stack, packet, validated payload, constant, image
  device, firmware table, runtime, and external memory
- scalar SSA and block-argument construction
- canonical lowering for fields, enums, branches, calls, constants, layout
  terms, validated-buffer reads, terminal calls, and proof erasure
- fact import mapping from envelope-shaped packet entries plus checked
  summaries, Proof MIR references, layout facts, and catalogs into typed query
  answers
- fact query APIs and fact lineage records, including `unknown` results for
  missing semantic sources
- fact preservation and invalidation across CFG, call, region, and layout
  rewrites
- subject remapping, CFG edit records, memory edit records, and
  path-certificate re-homing for preserved facts
- memory SSA and effect-token construction, including completeness checks for
  multi-region platform/runtime calls
- target-effect normalization for unknown calls, callbacks, firmware-table
  access, image-device access, private-state advances, and terminal calls
- mandatory semantic inlining success and rejection cases
- budgeted whole-program inlining budget, SCC, cold-path, loop-depth,
  external-root, callback, and effect-boundary decisions
- binding-time analysis classification determinism, monotonicity, and
  static/dynamic boundaries from constants, layout facts, callee identity,
  private-state, capability, and impossibility facts
- whole-program specialization: compile-time evaluation, static branch/switch
  driving, bounded unrolling, polyvariant clone dedup by static-argument
  signature, clone-variant and code-size budgets, cold-path and recursive-SCC
  refusal, external-root and effect-boundary preservation, and fact and
  path-certificate re-homing into clones
- shared scope-expansion budget: the inline-and-specialize fixpoint cannot exceed
  the combined per-function, per-SCC, and per-image code-size budget;
  deterministic reserve/commit/release; and fixpoint-fuel termination
- scalar simplification, SCCP, DCE, GVN/CSE, copy propagation, CFG
  simplification, and LICM
- dead-store elimination, load/store forwarding, scalar replacement, stack
  promotion, and escape analysis
- Wrela-specific move/copy elision, zero-copy reads, bounds-check elimination,
  endian folding, parser collapse, terminal cleanup pruning, wrapper
  elimination, and platform call specialization
- bounded fact-gated e-graph rewriting, including rule determinism, fuel
  limits, fact-gate lookup, extraction determinism, rejected extraction
  fallback, and fact-lineage preservation
- e-graph rule soundness and negative fact-gate tests for every rule catalog
  entry, including valid-but-insufficient fact cases
- rewrite invariant coverage for capability flow, private-state generation,
  conjunction invariants, and production pass-specific schemas
- vector type invariants, SLP legality checks, and certified loop-vectorization
  legality checks, including masked inactive-lane and scalar-tail semantics
- pass scheduling-contract enabling-consistency (no pass before a producer of
  its precondition), analysis recomputation before consumers, fixpoint
  idempotence and fuel termination, and demand-driven worklist determinism
- production policy file validation for inline, specialization, e-graph, memory,
  and vector thresholds, including deterministic feature extraction and
  rejection of scorecard or host-runtime inputs
- verifier failures for stale values, invalid block arguments, broken
  dominance, illegal effect reordering, stale facts, and path-fact misuse

Integration tests should cover:

- public API lowering from checked MIR fixtures into OptIR
- optimized OptIR interpreter comparison with checked MIR interpreter on small
  pure programs
- operation-schema fixtures proving constructor metadata, verifier recompute,
  and interpreter dispatch agree
- fake firmware/platform effect traces proving effect order is preserved
- fake platform/runtime catalog entries that require multiple region tokens and
  fail when a pass drops one token thread
- CFG rewrite fixtures proving edge implications and path certificates survive
  edge splits, branch folds, and inlining clones only when the implication holds
- rule-level OptIR interpreter differential tests for algebraic, layout,
  memory, effect, platform-wrapper, and vector-preparation rewrites
- validated-buffer parser fixtures where bounds checks and intermediate parser
  states disappear
- specialization fixtures where a schema-driven or config-driven engine
  residualizes to straight-line code, the general entry survives for external
  roots, clones dedup by static-argument signature, and a clone specialized on a
  stale private-state generation is rejected
- e-graph fixtures that fold endian loads, erase proof-backed copies, preserve
  effect tokens, and leave the original region unchanged after an unverifiable
  extraction
- loop-vectorization fixtures that prove certified trip counts, scalar tails,
  noalias memory lanes, and effect-safe loop bodies are required before a loop
  is vectorized
- replacement-stdlib wrapper fixtures proving stdlib wrappers receive no
  special authority
- deterministic snapshots from equivalent checked MIR and target inputs
- debug explanation output for eliminated checks, copies, wrappers, and
  endian-folded reads

Fakes should be supplied through dependency injection for target optimization
surfaces, checked fact packets, platform effect catalogs, runtime catalogs, and
firmware observations. Runtime source remains dependency-free. Property
generators may use test-only dependencies.

## Build Order

The implementation should proceed in narrow, verifiable slices:

1. Define OptIR IDs, tables, scalar and vector types, block/value/operation
   variants, stable CFG edge records, region records, provenance, diagnostics,
   operation
   semantics/effect derivation tables, vector verifier stubs, and structural
   verifier.
2. Implement the OptIR interpreter for the closed core operation semantics,
   including fakeable memory/effect traces and deterministic differential-test
   harnesses.
3. Implement checked MIR boundary validation, checked optimization evidence
   handoff validation, trusted-base tests, and certified fact import from
   envelope entries plus checked summaries, Proof MIR references, path
   certificates, layout facts, and catalogs.
4. Implement fact import schemas for every checked packet kind with negative
   tests for subject, dependency, certificate, authority, path, and layout
   mismatches.
5. Implement region construction, scalar SSA/block-argument lowering, and
   canonical operation lowering for pure scalar/control-flow fragments.
6. Implement proof erasure with erasure-fact preservation and verifier checks.
7. Add validated-buffer read lowering, layout/endian access terms, bounds
   queries, impossibility queries, and checked path-certificate preservation.
8. Add call lowering for source, runtime, and platform calls with normalized
   region/effect-token summaries and ABI facts.
9. Pass the Core OptIR acceptance gate: closed operation schemas, interpreter
   coverage for the core schema, stable edge/path-certificate verification,
   target-effect normalization examples as tests, provenance snapshots, fact
   import schemas, fact-preservation calculus, and deterministic construction
   all passing.
10. Add checked-summary semantic-inline policy import, mandatory semantic
    inlining, and cleanup.
11. Add the scope-expansion worklist shell, budgeted whole-program inlining
    participant, decision logs, and the shared scope-expansion budget ledger.
12. Add whole-program specialization as a participant in the same
    scope-expansion worklist, with binding-time analysis, compile-time
    evaluation, static control-flow driving, bounded loop unrolling, polyvariant
    clone dedup by static-argument signature, the shared scope-expansion budget,
    unroll and fuel limits, fact and path-certificate re-homing into clones, the
    `specializationResidualEquivalence` pass-invariant schema, and external-root,
    effect-boundary, cold-path, and recursive-SCC guards.
13. Add ordinary scalar and memory optimization passes.
14. Add Wrela-specific optimization passes.
15. Add bounded fact-gated e-graph rewriting with deterministic region
    selection, checked-in extraction policy, replayable rule chains, production
    translation validation, rule soundness tests, typed rewrite invariants, and
    production rules for endian folding, bounds-branch deletion, move/copy
    erasure, layout arithmetic folding, field-disjoint CSE, parser-state
    collapse, wrapper collapse, and vector idiom preparation.
16. Add SLP vectorization and certified loop vectorization with legality
    infrastructure for lane bounds, trip counts, tails, memory independence,
    effects, endian conversion, and register-pressure policy.
17. Add scorecard capture hooks.

The Core OptIR acceptance gate is not a downscope boundary and does not reduce
the production optimization scope. It is the point at which the IR itself is
considered implementable enough for advanced optimization work: construction,
verification, provenance, facts, effects, path certificates, and interpreter
semantics must be stable before mandatory inlining, scope expansion, e-graphs,
or vectorization are allowed to depend on them.

Output: optimized OptIR plus preserved certified facts and provenance.
