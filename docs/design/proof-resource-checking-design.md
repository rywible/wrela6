# Proof And Resource Checking Design

## Purpose

Proof and resource checking is the compiler phase after Proof MIR construction
and before checked MIR, certified optimization facts, and OptIR construction.
It consumes one closed `ProofMirProgram`, the selected target's catalog-owned
platform and runtime contracts, the selected target's type-intrinsic fact
catalog, and the proof-semantics companion judgments required for that target.
It proves that every reachable CFG path respects Wrela's proof, resource,
ownership, validation, layout, private-state, platform, terminal, and extension
rules.

Proof MIR is explicit but not trusted. It records blocks, edges, places, facts,
calls, obligations, sessions, validations, attempts, layout terms, terminal
exits, private-state generations, platform edges, runtime calls, and gated
extension records. This checker is the first phase that accepts or rejects those
records as executable language behavior. On success it returns checked MIR plus
a certified fact packet that later optimization and lowering phases may rely on.
On failure it returns deterministic diagnostics with counterexample paths.

The checker does not infer source intent or recompute earlier compiler facts.
It consumes source origins, HIR/mono proof IDs, layout fact keys, platform
contract IDs, and Proof MIR stable IDs as authority. When it proves a fact, it
records the exact origin and dependencies that made the fact true. When it
rejects a program, it reports the path and state difference that made the
judgment fail.

In this document, "certified fact" means a fact produced by this checker from
accepted Proof MIR and trusted target/layout/runtime/type-invariant catalogs. It
does not mean that source-written proof text, a `ProofMirFact` record, or a
platform declaration is trusted by itself.

## Contract Stability And Semantics Gates

The production checker contract covers ordinary source functions, source-call
summaries, sealed/type-intrinsic facts, certified platform calls,
compiler-runtime calls, moves, uses, consumes, field-sensitive loans, fact
propagation, requirement entailment, take/session obligations, validation and
attempt splits, private-state threading, validated-buffer reads, terminal
closure, panic/divergence, exits, and checked fact packet emission.

The proof-semantics companion is part of the production checker surface, not an
optional development add-on. A target profile declares the companion judgments it
requires, and the checker refuses to accept a program whose reachable Proof MIR
uses a language construct without the corresponding target-selected judgment.
The UEFI AArch64 production profile requires the coroutine yield/resume,
stream-loop, cross-core ownership, terminal closure, loop convergence, and fact
entailment judgments because those constructs are part of the normal language
surface for that target.

The core checker and the companion have separate jobs. The core checker owns
state storage, deterministic graph traversal, ordinary statement/edge transfer,
source-call transfer, platform/runtime contract transfer, requirement expansion,
canonical term normalization, authority lookup, packet construction, companion
request normalization, returned-certificate envelope validation, replay of
companion state patches, and diagnostic assembly. The companion owns the trusted
judgment algorithms for language rules whose soundness is not just local state
mutation: loops, extensions, terminal reachability, cross-core ownership, and
entailment beyond direct core authority membership.

Companion certificate validation is not a second proof of soundness. It checks
only that the selected companion returned a deterministic certificate for the
exact normalized request, with the expected fingerprint, judgment kind, subject
key, dependency keys, and closed output schema. The soundness of the companion's
accepted judgment is trusted and lives in the TCB below.

These Proof MIR records and semantic-sensitive checks require companion
judgments:

| Feature area           | Checker contract status                                                                                                                   | Required before success is allowed                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Coroutine yield/resume | Core-check no live linear obligations, enabled gate, capability borrow, and fact invalidation; validate frame boundary and resume state   | companion yield safety and frame convergence judgment          |
| Cross-core ownership   | Validate operation authority, transfer brands, worker/session effects, and ownership return                                               | companion cross-core ownership and move-ring transfer judgment |
| Stream loops           | Validate loop-carried member state and session closure                                                                                    | companion stream-loop convergence judgment                     |
| Loop convergence       | Core-check exact loop-state equality and finite core meets; validate non-exact loop-carried state, generations, resources, and invariants | companion loop convergence and diagnostic explanation judgment |
| Fact entailment        | Validate entailment certificates constructed from core facts and companion-defined rules                                                  | companion fact entailment judgment with stable certificates    |
| Terminal closure       | Core-check local exit has no live proof/resource state; validate whole-image terminal reachability to certified platform effects          | companion terminal-closure graph judgment                      |

If a reachable Proof MIR function contains an extension record whose semantics
gate is not enabled, or if the companion does not provide the required judgment,
the checker emits proof diagnostics and does not return checked MIR. It must not
erase the record, approximate the missing rule, or turn it into an ordinary call.

Exact state equality is a valid core join outcome for simple joins, but the
production companion must also define deterministic non-exact joins and loop
convergence over loop-carried resources, private-state generations, stream
members, and extension state. Any non-exact join must produce a concrete meet,
deterministic certificates, and deterministic counterexample diagnostics.

Core entailment handles only the closed structural fragment listed in this
document: identity, authority membership, equality substitution, comparison
chains, layout-term normalization, bounded integer intervals, and live
type-intrinsic facts. The core checker validates certificate envelopes and
dependency membership for that fragment. The companion provides the trusted
judgment for any target/language-specific entailment rule outside it. A
requirement is accepted only when the final certificate validates against the
selected authority path and every referenced authority entry exists.

## Trusted Computing Base

Proof checking is fail-closed, but it is not self-contained formal
verification. Acceptance safety rests on this trusted computing base:

- the selected platform, runtime, type-fact, layout, and ABI catalogs are
  correct for the target profile they claim to describe
- the proof-semantics companion is sound for every judgment it accepts,
  including loop convergence, enabled-extension transfer, non-core entailment,
  terminal closure, and cross-core ownership
- canonical serialization is injective over each schema domain, so two distinct
  authority records cannot serialize to the same byte stream before hashing
- whole-image monomorphization correctly computes the reachable function set,
  preserves monomorphic proof identities, and rejects reachable source-call
  recursion before proof checking
- the Proof MIR builder preserves fact roles, place/value identity, origin
  mapping, layout references, edge effects, private-state generations, and
  source-call/platform contract IDs without aliasing distinct source concepts
- layout construction correctly translates validated-buffer layout programs,
  concrete ABI facts, object-size limits, and layout read requirements

The checker validates fingerprints, stable IDs, dependency membership, and
replayable state transitions at its boundary. It does not prove that catalog
content, layout facts, monomorphization reachability, or companion algorithms
are semantically correct. Companion and catalog implementations therefore need
their own audit surface: versioned schemas, golden canonical bytes, independent
fixtures, differential tests against the reference checker, and negative tests
that demonstrate forged, stale, out-of-target, and dependency-mismatched
certificates are rejected.

For the UEFI AArch64 production profile, the companion is not a rare escape
hatch. Yield/resume, stream-loop convergence, cross-core ownership and memory
ordering, non-exact loop convergence, terminal graph closure, and non-core
entailment are ordinary language behavior. If the selected companion is unsound
for those judgments, proof checking may accept an unsound program even though
all certificate envelopes and reducer patches are well formed. The checker's
job is to minimize that trusted surface, validate every boundary, and fail
closed when the required companion judgment is absent or mismatched.

## Required Pipeline Extensions

The checker relies on the previous phases preserving proof-relevant identity.
Most of the needed data already exists in Proof MIR, mono, and layout. These
remaining contracts must be explicit before this phase is treated as production
complete:

| Owning phase                 | Required extension                                                                                                                           | Checker dependency                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Semantic target surface      | Expose normalized catalog-owned platform preconditions, postconditions, consumed capabilities, produced capabilities, and effects            | platform primitive call checking without trusting source text |
| Semantic target surface      | Replace raw-text requirement surfaces with checked requirement/fact terms or a catalog contract schema                                       | deterministic requirement entailment                          |
| Semantic target surface      | Expose sealed/type-intrinsic fact catalogs keyed by concrete type, brand, capability, and live value scope                                   | cross-call positive facts without source-call `ensures`       |
| Semantic target surface      | Replace feature names, capability kinds, effect kinds, match cases, and fact kinds used as authority with branded stable IDs                 | no display string participates in proof authority             |
| Target/runtime selection     | Pass the selected runtime catalog and target feature set as checker input, with stable fingerprints                                          | runtime helpers cannot mint trusted facts from untrusted MIR  |
| Whole-image monomorphization | Preserve instantiated platform contract IDs, source requirement IDs, ensured facts, owner/function type arguments, and monomorphic edge keys | catalog contract expansion for each platform call             |
| Whole-image monomorphization | Emit an explicit `reachableFunctions` set with deterministic reachability reasons and source function declared requirements                  | source-call precondition and summary checking                 |
| Proof MIR builder            | Preserve every Proof MIR fact role, dependency, layout term, private-state generation, edge effect, exit policy, and origin                  | path-sensitive state transition and diagnostics               |
| Proof MIR builder            | Embed `reachableFunctions` and reachability reasons in `ProofMirProgram`; current function tables alone are not sufficient                   | proof checking does not reject structurally valid dead tables |
| Proof-semantics companion    | Define deterministic loop convergence, enabled-extension safety, fact entailment, terminal closure, and cross-core ownership judgments       | acceptance rules for gated or semantic-sensitive checks       |
| Checked MIR handoff          | Define the stable checked fact packet schema consumed by OptIR, optimization, and AArch64 lowering                                           | no optimizer may rely on uncertified or lost proof facts      |
| Diagnostic rendering         | Preserve origin mapping from Proof MIR IDs to source/HIR/mono origins through checked MIR                                                    | counterexample paths stay source-level after MIR checking     |

The checker repeats fail-closed validation for these contracts at its boundary.
It does not compensate for missing catalog contracts by trusting
source-declared `requires`, stdlib wrappers, proof fact records, host runtime
state, or display strings.

`ProofCheckPlatformContractCatalog` is built only after the semantic target
surface translates raw requirement placeholders, source text, and target
surface declarations into normalized `ProofCheckFactTerm` values. The checker
API never consumes raw `CheckedRequirementSurfacePlaceholder`-style records.
Likewise, the existing runtime catalog shape must be extended with stable
fingerprints and canonical entry authority before it can be accepted as a
`ProofCheckRuntimeCatalog`.

The current `ProofMirProgram` and `ProofMirRuntimeCatalog` model types do not
yet expose every field listed above. This document treats `reachableFunctions`,
runtime fingerprints, and branded authority IDs as required upstream extensions,
not as fields the checker may infer from display strings or table membership.

## Goals

- Consume one structurally valid `ProofMirProgram`.
- Consume the selected target's normalized platform primitive contract catalog.
- Consume and authenticate the selected target's runtime catalog.
- Consume the selected target's sealed/type-intrinsic fact catalog.
- Consume the proof-semantics companion rules required for the selected target.
- Check fact propagation and requirement entailment path-sensitively.
- Check source-call preconditions and import only certified source-call summary
  facts.
- Check catalog-owned platform primitive preconditions, postconditions,
  capability flow, effects, ABI/layout references, and private-state effects.
- Check compiler-runtime call contracts using the selected target runtime
  catalog, while authenticating any runtime catalog copy embedded in Proof MIR.
- Check move, use, consume, borrow, release, field projection, noalias, and
  ownership rules over structured places.
- Track field-sensitive loans so whole-object, ancestor, descendant, and
  disjoint-field conflicts are judged correctly.
- Check `take` sessions, opened obligations, session members, discharge, and
  closure on every exit path.
- Check validation and attempt obligations as single-use resources with
  branch-specific states and convergent joins.
- Check terminal calls, terminal return closure, panic/divergence, and
  whole-image terminal reachability to certified platform effects.
- Thread private-state generations and reject stale predicate facts after state
  advancement.
- Check validated-buffer reads against ordered layout facts, packet/source
  relationships, payload-end facts, field availability, range constraints,
  unsigned-overflow obligations, and `layout.fits` entailment.
- Check deterministic loop convergence and enabled-extension safety using the
  core exact-state rule or the proof-semantics companion.
- Emit deterministic proof-failure diagnostics with counterexample paths,
  state snapshots, missing facts, stale facts, divergent joins, and origin
  mappings.
- Emit checked MIR on success while preserving stable function, block, edge,
  value, place, call, layout, fact, and origin IDs.
- Emit a checked fact packet containing certified ownership/noalias facts,
  field-disjointness facts, erased proof/resource values, validated-buffer
  bounds, packet/source relationships, private-state generation facts, platform
  primitive effects and capability flow, terminal/exit closure facts, concrete
  layout/ABI facts, and origin mappings.
- Keep filesystem access, package loading, parsing, HIR lowering,
  monomorphization, layout computation, Proof MIR construction, optimization,
  target lowering, code generation, linking, and PE/COFF emission outside this
  phase.

## Non-Goals

- This phase does not parse source, resolve names, typecheck declarations,
  certify platform declarations, select an image root, instantiate generics,
  compute reachability, or compute layout.
- This phase does not discover reachability from source. It treats
  `ProofMirProgram.reachableFunctions` and `ProofMirImage.externalRoots` as the
  closed reachable image produced by monomorphization, then validates that every
  reachable referenced function/call target is inside that closed image or is a
  certified platform/runtime boundary. Function table entries outside the
  reachable set are structural input only.
- This phase does not build Proof MIR or repair structurally invalid Proof MIR.
  Structural Proof MIR validation remains part of the builder boundary.
- This phase does not trust source-written platform contracts, stdlib source,
  vendored packages, or replacement stdlib source as privileged authority.
- This phase does not run a general-purpose SMT solver. Entailment is
  deterministic, bounded, certificate-producing, and owned by the core checker
  plus enabled companion rules.
- This phase does not erase proof-only values from the executable program. It
  certifies the erasure plan in the fact packet; later lowering removes erased
  values using that certificate.
- This phase does not optimize, inline, eliminate dead code, choose registers,
  lower platform primitives to target instructions, or produce OptIR.
- This phase does not invent platform effects or ABI facts. It references
  catalog, runtime, and `LayoutFactProgram` records by stable keys.
- This phase does not implement incremental or cached proof checking.

## Repository Shape

```text
src/
  proof-check/
    index.ts
    proof-checker.ts
    ids.ts
    diagnostics.ts
    input-contract.ts
    kernel/
      checker-kernel.ts
      transition-api.ts
      state.ts
      state-key.ts
      state-patch.ts
      state-reducer.ts
      graph-worklist.ts
      counterexample-builder.ts
    authority/
      canonical-serialization.ts
      platform-contracts.ts
      runtime-authority.ts
      type-fact-authority.ts
      semantics-companion.ts
    model/
      fact-language.ts
      fact-environment.ts
      fact-packet.ts
      checked-mir.ts
      function-summary.ts
      certificates.ts
    domains/
      facts.ts
      source-calls.ts
      platform-runtime.ts
      ownership.ts
      loans.ts
      take-sessions.ts
      validation-attempt.ts
      private-state.ts
      terminal.ts
      validated-buffers.ts
      extensions.ts
    validation/
      input-validator.ts
      packet-validator.ts

tests/
  support/
    proof-check/
      proof-check-fakes.ts
      proof-check-fixtures.ts
      counterexample-fixtures.ts

  unit/
    proof-check/
      diagnostics.test.ts
      input-validator.test.ts
      checker-kernel.test.ts
      state-patch-reducer.test.ts
      transition-api.test.ts
      state-key.test.ts
      fact-normalization.test.ts
      entailment.test.ts
      layout-entailment.test.ts
      type-invariant-entailment.test.ts
      place-relation.test.ts
      field-disjointness.test.ts
      move-use-consume.test.ts
      loan-conflicts.test.ts
      obligation-state.test.ts
      session-state.test.ts
      validation-transfer.test.ts
      attempt-transfer.test.ts
      private-fact-threading.test.ts
      source-call-transfer.test.ts
      platform-contract-transfer.test.ts
      runtime-contract-transfer.test.ts
      divergence-transfer.test.ts
      loop-convergence.test.ts
      extensions.test.ts
      fact-packet-builder.test.ts
      packet-validator.test.ts

  integration/
    proof-check/
      proof-and-resource-checker.test.ts
      call-requirements.test.ts
      source-call-summaries.test.ts
      platform-contracts.test.ts
      move-use-consume.test.ts
      field-sensitive-loans.test.ts
      validation-and-attempts.test.ts
      take-session-closure.test.ts
      private-state-threading.test.ts
      validated-buffer-bounds.test.ts
      terminal-graph-checker.test.ts
      terminal-closure.test.ts
      deterministic-diagnostics.test.ts
      checked-fact-packet.test.ts
      public-api.test.ts
```

The tree is intentionally organized around a small executable checker kernel.
The public checker delegates to the kernel; domain modules produce typed
transition patches; only `kernel/state-reducer.ts` applies those patches to
`ProofCheckState`. Domain files may be split further only when the extracted
file has one stable owner and communicates through `ProofCheckTransition`,
`ProofCheckStatePatch`, diagnostics, certificates, or packet entries. A domain
module must not reach across to mutate another domain's maps directly.

`src/proof-check` may depend on `src/proof-mir`, `src/layout`, `src/mono`,
semantic IDs and target contract models, shared diagnostic/source-origin types,
and pure target/runtime catalogs supplied through dependency injection. Checked
MIR wrapper types live under `src/proof-check/model` until another compiler
phase needs them as an independent package.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing, AST
views, name resolution, semantic surface internals, HIR lowering internals,
Proof MIR lowering internals, optimization passes, target code generators,
linkers, or PE/COFF emission.

This repository shape refines the proof boundary in
`docs/design/compiler-pipeline-design.md`. The pipeline roadmap remains the
end-to-end phase map; this document defines the checker and checked MIR handoff.

## Public API

Proof and resource checking is exported from `src/proof-check/index.ts`. Once a
top-level compiler barrel exists, it should re-export this API next to
`buildProofMir`:

```ts
import { buildProofMir } from "./src/proof-mir";
import { checkProofAndResources } from "./src/proof-check";

const mirResult = buildProofMir({
  program: monoResult.program,
  layout: layoutResult.facts,
  target: selectedTarget.proofMir,
});

if (mirResult.kind === "ok") {
  const checkedResult = checkProofAndResources({
    mir: mirResult.mir,
    layout: layoutResult.facts,
    platformContracts: selectedTarget.proofContracts,
    runtimeCatalog: selectedTarget.runtimeCatalog,
    typeFacts: selectedTarget.typeFacts,
    semantics: selectedTarget.proofSemantics,
  });
}
```

`selectedTarget.proofMir`, `selectedTarget.proofContracts`,
`selectedTarget.runtimeCatalog`, `selectedTarget.typeFacts`, and
`selectedTarget.proofSemantics` are projections of one selected target context.
The checker rejects mixed projections from different target IDs, feature sets,
or authority fingerprints.

The phase returns checked MIR only when all proof obligations succeed:

```ts
export interface CheckProofAndResourcesInput {
  readonly mir: ProofMirProgram;
  readonly layout: LayoutFactProgram;
  readonly platformContracts: ProofCheckPlatformContractCatalog;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly semantics: ProofSemanticsCompanion;
}

export type CheckProofAndResourcesResult =
  | {
      readonly kind: "ok";
      readonly checked: CheckedMirProgram;
      readonly diagnostics: readonly ProofCheckNonErrorDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    };

export function checkProofAndResources(
  input: CheckProofAndResourcesInput,
): CheckProofAndResourcesResult;
```

`checkProofAndResources` does not combine diagnostics from earlier phases. The
caller owns diagnostic aggregation and source-order presentation across the
whole pipeline. `kind: "ok"` may include warning or note diagnostics only. Any
error diagnostic makes the result `kind: "error"` and no checked MIR or fact
packet is returned. The checked fact packet has exactly one source of truth:
`checked.facts`. Callers that want the packet read it from the returned
`CheckedMirProgram`.

```ts
export type ProofCheckNonErrorDiagnostic = ProofCheckDiagnostic & {
  readonly severity: "warning" | "note";
};
```

## Authority Catalog Schemas

The checker receives normalized proof-check catalogs. These are not the current
semantic-surface raw-text records; they are the post-extension target authority
records consumed by this phase.

Every trusted authority has a fingerprint:

```ts
export interface ProofAuthorityFingerprint {
  readonly authorityKind: "platform" | "runtime" | "typeFacts" | "layout" | "semantics";
  readonly targetId: TargetId;
  readonly version: string;
  readonly digestAlgorithm: "sha256";
  readonly digestHex: string;
}
```

Authority schemas use branded stable IDs for all proof-relevant atoms:

```ts
export type BrandedStableId<Kind extends string> = string & {
  readonly __proofCheckStableId: Kind;
};

export type TargetFeatureId = BrandedStableId<"targetFeature">;
export type ProofCapabilityKindId = BrandedStableId<"proofCapabilityKind">;
export type PlatformEffectKindId = BrandedStableId<"platformEffectKind">;
export type RuntimeEffectKindId = BrandedStableId<"runtimeEffectKind">;
export type SyntheticBinderId = BrandedStableId<"syntheticBinder">;
export type MatchCaseKey = BrandedStableId<"matchCase">;
export type OptimizationPassId = BrandedStableId<"optimizationPass">;
export type CheckedFactKindId = BrandedStableId<"checkedFactKind">;
```

Human-readable labels may be attached to these IDs for diagnostics, but labels
are never compared for authority, equality, ordering, fingerprinting, or packet
preservation.

Fingerprints are computed from schema-owned canonical serialization. The
encoding must be injective over the schema domain: every record kind, field
name, optional-field state, array boundary, union variant, and scalar value is
tagged and length-delimited before hashing. Record schemas declare their field
order explicitly; maps and sets first normalize to sorted entry arrays. A
fingerprint is a stable content identifier, not the only equality check at
trust boundaries. When Proof MIR embeds cached authority copies, the checker
compares canonical entry keys and normalized entry contents after fingerprint
validation.

Canonical serialization rules:

- dictionary keys sort by code-unit order; schema records use declared field
  order
- arrays sort by the record's declared stable key unless order is semantic
- integers and `bigint` values serialize as base-10 strings without separators
- branded IDs serialize through their stable compiler key, not object identity
- strings are length-delimited before hashing
- optional fields serialize as either `absent` or their normalized value
- union variants serialize a closed variant tag before their payload
- record kind tags are included before record fields
- per-field tags are included even when the field order is fixed
- no host paths, timestamps, process IDs, object insertion order, or display-only
  labels participate

The byte grammar is shared by platform, runtime, type-fact, layout, and
semantics authorities:

```text
value       = absent | bool | int | string | bytes | id | array | map | record | union
absent      = "N"
bool        = "B" ("0" | "1")
int         = "I" sign digit-count ":" digits
string      = "S" byte-count ":" utf8-bytes
bytes       = "Y" byte-count ":" raw-bytes
id          = "D" id-kind ":" byte-count ":" stable-id-utf8-bytes
array       = "A" item-count ":" value*
map         = "M" item-count ":" (value value)*
record      = "R" record-kind ":" field-count ":" field*
field       = "F" field-name-byte-count ":" field-name-utf8-bytes value
union       = "U" variant-name-byte-count ":" variant-name-utf8-bytes value
```

Integers are base-10 mathematical integers with `+` or `-` sign and no leading
zeroes except `+0`. Strings are encoded as UTF-8 bytes from the exact normalized
compiler string value; serialization performs no Unicode normalization and
rejects unpaired surrogate or non-scalar input. Floating point, `NaN`,
`Infinity`, `undefined`, object identity, host pointers, and functions are not
serializable authority values. Every authority schema must include golden byte
vectors for at least one empty record, one nested record, one union variant, one
absent optional field, and one non-ASCII diagnostic label that is excluded from
the authority payload.

The selected `ProofCheckRuntimeCatalog` wraps the existing
`ProofMirRuntimeCatalog` shape with fingerprint and canonical-entry authority:

```ts
export interface ProofCheckRuntimeCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly features: readonly TargetFeatureId[];
  get(runtimeId: ProofMirRuntimeOperationId): ProofCheckRuntimeOperation | undefined;
  entries(): readonly ProofCheckRuntimeOperation[];
}
```

The selected platform contract catalog is already declaration-certified by
semantic surface checking, but proof checking consumes normalized requirement
terms and effects:

```ts
export interface ProofCheckPlatformContractCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  get(input: {
    readonly targetId: TargetId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: PlatformContractId;
  }): ProofCheckPlatformContract | undefined;
  entries(): readonly ProofCheckPlatformContract[];
}

export interface ProofCheckPlatformContract {
  readonly targetId: TargetId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly signature: ProofCheckCallableSignature;
  readonly preconditions: readonly ProofCheckRequirementTerm[];
  readonly postconditions: readonly ProofCheckFactTerm[];
  readonly guardedPostconditions: readonly ProofCheckGuardedPostcondition[];
  readonly consumedCapabilities: readonly ProofCheckPlaceBinder[];
  readonly producedCapabilities: readonly ProofCheckPlaceBinder[];
  readonly effects: readonly ProofCheckContractEffect[];
  readonly authorityKey: string;
}

export interface ProofCheckGuardedPostcondition {
  readonly when: readonly ProofCheckRequirementTerm[];
  readonly then: readonly ProofCheckFactTerm[];
  readonly otherwisePreserves?: readonly ProofCheckFactTerm[];
  readonly authorityKey: string;
}
```

Postconditions may be relational. A catalog can state facts such as
`result.written_len == input.written_len`, `result.capacity == input.capacity`,
or `output.brand == input.brand` by using pre-state and post-state binders in
one normalized fact term. This is the required channel for consuming platform
functions that preserve descriptor, length, capacity, brand, or packet/source
relationships across ownership transfer.

Guarded postconditions cover value-dependent effects. For example,
`WritableBuffer.write_u8(offset, value)` can state:

- precondition: `offset < preState(buffer.capacity)`
- if `offset == preState(buffer.initialized_prefix)`, then
  `postState(buffer.initialized_prefix) == preState(buffer.initialized_prefix) + 1`
- if `offset < preState(buffer.initialized_prefix)`, then
  `postState(buffer.initialized_prefix) == preState(buffer.initialized_prefix)`
- otherwise the initialized prefix is not advanced

The `send(buffer, len)` terminal requirement `len <= buffer.initialized_prefix`
is then checked against the current post-call fact environment. Sparse writes
do not produce a stronger initialized-prefix fact.

Type-intrinsic facts are trusted facts carried by live sealed values,
capabilities, packets, and branded resources:

```ts
export interface ProofCheckTypeFactCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  get(input: ProofCheckTypeFactLookup): readonly ProofCheckTypeFactCatalogEntry[];
  entries(): readonly ProofCheckTypeFactCatalogEntry[];
}

export interface ProofCheckTypeFactCatalogEntry {
  readonly concreteType: MonoCheckedType;
  readonly brand?: MonoInstantiatedProofId<BrandId>;
  readonly capabilityKind?: ProofCapabilityKindId;
  readonly facts: readonly ProofCheckTypeFactSchema[];
  readonly invalidatedBy: readonly ProofCheckTypeFactInvalidation[];
  readonly authorityKey: string;
}

export type ProofCheckTypeFactInvalidation =
  | { readonly kind: "moveTransfers" }
  | { readonly kind: "consumeRemoves" }
  | { readonly kind: "privateStateAdvance"; readonly place: ProofCheckPlaceBinder }
  | { readonly kind: "platformEffect"; readonly effectKind: PlatformEffectKindId }
  | { readonly kind: "runtimeEffect"; readonly effectKind: RuntimeEffectKindId }
  | { readonly kind: "validationSplit" }
  | { readonly kind: "attemptSplit" };
```

The proof-semantics companion is a fingerprinted closed judgment interface, not
a loose helper:

```ts
export interface ProofSemanticsCompanion {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly schemaVersion: string;
  readonly providedJudgments: readonly ProofSemanticsJudgmentKind[];
  judge(request: ProofSemanticsJudgmentRequest): ProofSemanticsJudgmentResult;
}

export interface ProofSemanticsCertificate {
  readonly certificateId: ProofSemanticsCertificateId;
  readonly judgment: ProofSemanticsJudgmentKind;
  readonly companionFingerprint: ProofAuthorityFingerprint;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}

export type ProofSemanticsJudgmentRequest =
  | { readonly kind: "entailment"; readonly input: ProofEntailmentJudgmentInput }
  | { readonly kind: "stateJoin"; readonly input: ProofStateJoinJudgmentInput }
  | { readonly kind: "loopConvergence"; readonly input: ProofLoopConvergenceJudgmentInput }
  | { readonly kind: "terminalClosure"; readonly input: ProofTerminalClosureJudgmentInput }
  | { readonly kind: "yieldResume"; readonly input: ProofYieldResumeJudgmentInput }
  | { readonly kind: "crossCoreOwnership"; readonly input: ProofCrossCoreOwnershipJudgmentInput }
  | { readonly kind: "streamLoop"; readonly input: ProofStreamLoopJudgmentInput }
  | { readonly kind: "extensionTransfer"; readonly input: ProofExtensionTransferJudgmentInput };

export type ProofSemanticsJudgmentResult =
  | ProofEntailmentJudgmentResult
  | ProofStateJoinJudgmentResult
  | ProofLoopConvergenceJudgmentResult
  | ProofTerminalClosureJudgmentResult
  | ProofYieldResumeJudgmentResult
  | ProofCrossCoreOwnershipJudgmentResult
  | ProofStreamLoopJudgmentResult
  | ProofExtensionTransferJudgmentResult;

export type ProofSemanticsJudgmentError = {
  readonly kind: "error";
  readonly requestKind: ProofSemanticsJudgmentRequest["kind"];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
};

export type ProofEntailmentJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "entailment";
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofStateJoinJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "stateJoin";
      readonly meet: ProofCheckStateDigest;
      readonly patch: ProofCheckStatePatch<"stateJoin">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofLoopConvergenceJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "loopConvergence";
      readonly variants: readonly ProofLoopVariantCertificate[];
      readonly finalReplay: ProofLoopReplayCertificate;
      readonly headerMeet: ProofCheckStateDigest;
      readonly patch: ProofCheckStatePatch<"loopConvergence">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofTerminalClosureJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "terminalClosure";
      readonly closure: CheckedTerminalGraphCertificate;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofYieldResumeJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "yieldResume";
      readonly suspendState: ProofCheckStateDigest;
      readonly resumeState: ProofCheckStateDigest;
      readonly patch: ProofCheckStatePatch<"yieldResume">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofCrossCoreOwnershipJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "crossCoreOwnership";
      readonly transfer: CheckedCapabilityFlowFact;
      readonly ordering: CheckedCrossCoreOrderingFact;
      readonly patch: ProofCheckStatePatch<"crossCoreOwnership">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofStreamLoopJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "streamLoop";
      readonly memberState: CheckedStreamMemberStateFact;
      readonly patch: ProofCheckStatePatch<"streamLoop">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;

export type ProofExtensionTransferJudgmentResult =
  | {
      readonly kind: "ok";
      readonly requestKind: "extensionTransfer";
      readonly extensionKind: ProofMirExtensionKind;
      readonly patch: ProofCheckStatePatch<"extensionTransfer">;
      readonly certificate: ProofSemanticsCertificate;
    }
  | ProofSemanticsJudgmentError;
```

`judge` must be pure and deterministic for the same normalized request. It must
return one result whose `requestKind` exactly matches the request. Certificate
IDs, patch entries, variant keys, replay plans, and diagnostics are sorted by
stable keys. A certificate is accepted only when its companion fingerprint
matches the selected input, its schema version is supported, its judgment kind
is declared in `providedJudgments`, its subject key matches the normalized
checker request, and every dependency key names a checked state/fact/catalog
entry. The core checker then sends the typed patch to the checker-owned state
reducer and rejects the result unless the patch kind and entries are allowed by
the request type. The companion may not introduce new places, catalog facts,
authority entries, capabilities, obligations, loans, private-state generations,
terminal effects, or cross-core ordering facts that are not named by the typed
request and result schema.

Patch permissions are closed per judgment:

| Request kind         | Patch permissions                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `entailment`         | no state patch; certificate only                                                                                      |
| `stateJoin`          | drop/weaken facts, intersect packet/source facts, move place state only to a core meet, close path-local certificates |
| `loopConvergence`    | same as `stateJoin`, plus generation-role remapping for named loop-carried private state                              |
| `terminalClosure`    | no state patch; terminal graph certificate only                                                                       |
| `yieldResume`        | add suspend/resume frame facts and drop invalidated path facts; no ownership, loan, obligation, or capability change  |
| `crossCoreOwnership` | transfer exactly the named source place/capability to the named destination core and add the named ordering fact      |
| `streamLoop`         | close exactly the named yielded member, update that stream's outstanding-member set, and drop member-local facts      |
| `extensionTransfer`  | only the patch entries declared by the selected extension schema and named in the request                             |

For companion patches, the reducer proves schema validity and replay
consistency, not semantic soundness. It rejects, for example, a
`crossCoreOwnership` result that closes an unrelated obligation, leaves the
source place owned on both cores, produces a capability not named in the request,
uses the wrong brand, omits the required ordering fact, or drops a
private-state fact outside the transfer dependency set. If the patch stays
inside the typed cross-core schema, the proof that the transfer is
memory-ordering-sound is the companion's trusted judgment, not a fact the core
re-derives.

## Fact And Requirement Terms

Requirements, facts, postconditions, and type-intrinsic facts share one
normalized term language, but not every fact term is legal in requirement
position:

```ts
export type ProofCheckRequirementTerm =
  | ProofCheckComparisonTerm
  | ProofCheckPredicateTerm
  | ProofCheckLayoutFitsTerm
  | ProofCheckPayloadEndTerm
  | ProofCheckFieldAvailableTerm
  | ProofCheckRangeConstraintTerm
  | ProofCheckNoUnsignedOverflowTerm
  | ProofCheckCapabilityTerm
  | ProofCheckPacketSourceTerm;

export type ProofCheckFactTerm =
  | ProofCheckRequirementTerm
  | {
      readonly kind: "matchRefinement";
      readonly scrutinee: ProofCheckOperandTerm;
      readonly caseKey: MatchCaseKey;
      readonly polarity: "matched" | "excluded";
    }
  | {
      readonly kind: "terminalCall";
      readonly call: ProofMirCallId | ProofMirTerminatorId;
      readonly terminalKind: "platformExit" | "abortNoUnwind" | "doesNotReturn";
    };

export interface ProofCheckComparisonTerm {
  readonly kind: "comparison";
  readonly left: ProofCheckOperandTerm;
  readonly operator: "eq" | "ne" | "lt" | "le" | "gt" | "ge";
  readonly right: ProofCheckOperandTerm;
}

export interface ProofCheckPredicateTerm {
  readonly kind: "predicate";
  readonly predicateFunctionId: FunctionId;
  readonly arguments: readonly ProofCheckOperandTerm[];
  readonly privateState?: ProofCheckPrivateStateBinder;
}

export interface ProofCheckLayoutFitsTerm {
  readonly kind: "layoutFits";
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
}

export interface ProofCheckPayloadEndTerm {
  readonly kind: "payloadEnd";
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
}

export interface ProofCheckFieldAvailableTerm {
  readonly kind: "fieldAvailable";
  readonly source: ProofCheckPlaceBinder;
  readonly fieldId: FieldId;
}

export interface ProofCheckRangeConstraintTerm {
  readonly kind: "rangeConstraint";
  readonly left: ProofCheckOperandTerm;
  readonly relation: "<=" | "<" | ">=" | ">";
  readonly right: ProofCheckOperandTerm;
  readonly width: LayoutTypeKey;
}

export interface ProofCheckNoUnsignedOverflowTerm {
  readonly kind: "noUnsignedOverflow";
  readonly expression: ProofCheckOperandTerm;
  readonly width: LayoutTypeKey;
}

export interface ProofCheckCapabilityTerm {
  readonly kind: "capability";
  readonly capability: ProofCheckPlaceBinder;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly brand?: ProofCheckBrandBinder;
}

export interface ProofCheckPacketSourceTerm {
  readonly kind: "packetSource";
  readonly packet: ProofCheckPlaceBinder;
  readonly source: ProofCheckPlaceBinder;
}

export type ProofCheckOperandTerm =
  | {
      readonly kind: "place";
      readonly place: ProofCheckPlaceBinder;
      readonly projection: readonly ProofCheckTermProjection[];
    }
  | { readonly kind: "value"; readonly value: ProofCheckValueBinder }
  | { readonly kind: "layoutTerm"; readonly term: ProofMirLayoutTermReference }
  | {
      readonly kind: "literal";
      readonly literal: MonoLiteralValue;
      readonly numeric?: ProofCheckNumericDomain;
    }
  | { readonly kind: "preState"; readonly operand: ProofCheckOperandTerm }
  | { readonly kind: "postState"; readonly operand: ProofCheckOperandTerm };

export type ProofCheckPlaceBinder =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly index: number; readonly parameterId?: ParameterId }
  | { readonly kind: "argument"; readonly index: number; readonly parameterId?: ParameterId }
  | { readonly kind: "result" }
  | { readonly kind: "subject" }
  | { readonly kind: "proofMirPlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "synthetic"; readonly id: SyntheticBinderId };

export type ProofCheckValueBinder =
  | { readonly kind: "proofMirValue"; readonly valueId: ProofMirValueId }
  | { readonly kind: "resultValue" }
  | { readonly kind: "synthetic"; readonly id: SyntheticBinderId };

export type ProofCheckBrandBinder =
  | { readonly kind: "proofBrand"; readonly brandId: MonoInstantiatedProofId<BrandId> }
  | { readonly kind: "subjectBrand" }
  | { readonly kind: "sourceBrand"; readonly place: ProofCheckPlaceBinder };

export interface ProofCheckPrivateStateBinder {
  readonly place: ProofCheckPlaceBinder;
  readonly generation: "current" | ProofMirPrivateStateGenerationId;
}

export interface ProofCheckNumericDomain {
  readonly widthBits: number;
  readonly signedness: "signed" | "unsigned" | "mathematical";
  readonly overflow: "checked" | "wrapping" | "saturating" | "layoutExact";
}
```

`terminalCall` and `matchRefinement` are facts only. `preState` and `postState`
operands are legal only in catalog postconditions, runtime postconditions, and
summary-instantiation facts. They may not nest inside another `preState` or
`postState`, and they are rejected in ordinary source requirements. Capability
requirements are legal because platform/runtime contracts may require a live
capability, but the capability kind is a branded `ProofCapabilityKindId`, never
a display string.

Binders resolve against a call site, source summary, platform/runtime contract,
type-intrinsic subject, or current checker state. Substitution is capture-free:
receiver, parameter, result, pre-state, post-state, type argument, layout-term,
packet, source, and capability binders are replaced by stable Proof MIR IDs
before entailment. Normalization then:

- resolves field projections to structured `ProofMirPlaceProjection` paths
- normalizes numeric widths, signedness, and overflow policy
- normalizes commutative equality operands by stable operand key
- preserves non-commutative comparison order
- attaches private-state generation requirements to predicate terms
- replaces catalog binder names with stable subject IDs
- emits a canonical term key used by diagnostics and certificates

## Input Contract

The primary input is a structurally valid `ProofMirProgram`. The checker still
validates the boundary invariants that affect trust:

- target IDs match between Proof MIR layout facts, the selected layout facts,
  the selected runtime catalog, the selected platform contract catalog, and the
  semantics companion
- the embedded `ProofMirProgram.layout` has the same stable fingerprint and
  layout table contents as the selected `layout` input
- the embedded `ProofMirProgram.runtimeCatalog` has the same stable fingerprint,
  target ID, feature set, operation IDs, schemas, effects, and ABI references as
  the selected `runtimeCatalog` input
- every function, block, edge, value, place, fact, layout term, call, runtime
  call, platform edge, private-state generation, and origin reference exists
- `ProofMirProgram.reachableFunctions` is a closed set with deterministic
  reachability reasons from monomorphization; every external root points to a
  reachable function and every reachable source call target is inside that set
- functions present in `ProofMirProgram.functions` but absent from
  `reachableFunctions` are validated structurally only; they receive no proof
  state, summary, packet entries, or source-level proof diagnostics
- the source-call graph over `ProofMirProgram.reachableFunctions` is acyclic,
  matching whole-image monomorphization's reachable-recursion rejection policy
- every platform edge has a catalog-owned contract with the same target,
  primitive, contract ID, instantiated signature shape, and ABI reference
- every runtime call has a runtime catalog entry available for the selected
  target and features
- every type-intrinsic fact referenced by the checker is present in the selected
  type fact catalog for that concrete type, brand, capability, and scope
- every enabled extension record has a companion judgment
- every terminal function has a statically known terminal call graph
- every exit closure policy is one of the closed Proof MIR policies

Because monomorphization owns reachability, the checker requires an explicit
reachable set instead of treating every function table entry as executable
image behavior. If mono over-approximates, it must mark the extra functions as
reachable with reasons and accept that proof checking will check them. If mono
keeps unused function bodies for debugging or identity preservation, they stay
outside `reachableFunctions` and are checked only for structural Proof MIR
well-formedness.

Platform contract lookup is deliberately two-step. `ProofMirPlatformEdge`
contains the Proof MIR edge ID, primitive ID, ABI reference, and origin. The
checker resolves the richer contract authority through
`ProofMirProgram.proofMetadata.platformContractEdges.get(edgeId)`, verifies the
mono edge's target ID, primitive ID, contract ID, certificate, instantiated type
arguments, monomorphic edge key, source requirement IDs, and ensured facts, then
matches that record against the selected `platformContracts` input. If any part
of the chain is absent or mismatched, the platform call has no trusted contract.

The checker treats `ProofMirFact.role` as a claim about how the fact should be
used, not as proof that the fact is true:

- `evidence` facts become active only when produced by a checked statement,
  edge, branch refinement, layout operation, predicate call, source-call
  summary, live type-intrinsic fact, or catalog effect.
- `requirement` facts must be entailed by the active fact environment at the
  point where they are required.
- `trustedAxiom` facts are accepted only when their authority is a closed
  catalog/layout/runtime/type-invariant source.
- `candidate` facts may be used for diagnostics and packet explanations but do
  not become certified unless an entailment rule proves them.

A `trustedAxiom` is not accepted because it claims a trusted source kind. The
checker must verify membership in the selected authority: platform contract
entry, runtime catalog entry, layout fact record, type-intrinsic fact entry, or
semantics-companion certificate. The certified axiom key includes the authority
fingerprint and entry key, so a forged Proof MIR fact cannot mint trusted
evidence by choosing the right role or label.

## Output Contract

`CheckedMirProgram` preserves the accepted Proof MIR control-flow and identity
space. It is a proof boundary wrapper, not a destructive rewrite:

```ts
export interface CheckedMirProgram {
  readonly mir: ProofMirProgram;
  readonly checkedFunctions: CheckedMirFunctionTable;
  readonly summaries: CheckedFunctionSummaryTable;
  readonly facts: CheckedFactPacket;
  readonly terminalGraph: CheckedTerminalGraphCertificate;
  readonly originMap: CheckedOriginMap;
}

export interface CheckedMirOptimizationEvidence {
  readonly certificates: CheckedCertificateBundle;
  readonly packetValidation: CheckedFactPacketValidationAttestation;
  readonly pathCertificates: CheckedPathCertificateTable;
  readonly semanticInlinePolicies: CheckedSemanticInlinePolicyTable;
}

export interface CheckedCertificateBundle {
  readonly core: readonly ProofCheckCoreCertificate[];
  readonly semantics: readonly ProofSemanticsCertificate[];
  readonly summaryInstantiations: readonly CheckedSummaryInstantiationCertificate[];
}

export interface CheckedFactPacketValidationAttestation {
  readonly packetFingerprint: CheckedFactPacketFingerprint;
  readonly certificateBundleFingerprint: CheckedCertificateBundleFingerprint;
  readonly acceptedFunctionFingerprint: CheckedFunctionTableFingerprint;
  readonly summaryFingerprint: CheckedFunctionSummaryTableFingerprint;
  readonly terminalGraphFingerprint: CheckedTerminalGraphFingerprint;
  readonly originMapFingerprint: CheckedOriginMapFingerprint;
  readonly authorityFingerprints: readonly ProofAuthorityFingerprint[];
}

export interface CheckedPathCertificate {
  readonly certificateId: CheckedPathCertificateId;
  readonly requiredEdges: readonly ProofMirControlEdgeId[];
  readonly requiredDominators: readonly ProofMirBlockId[];
  readonly excludedEdges: readonly ProofMirControlEdgeId[];
  readonly invalidationTriggers: readonly CheckedFactInvalidation[];
}

export type CheckedPathCertificateTable = ReadonlyMap<
  CheckedPathCertificateId,
  CheckedPathCertificate
>;

export interface CheckedMirFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly entryStateCertificate: ProofCheckCertificateId;
  readonly exitCertificates: readonly ProofCheckCertificateId[];
  readonly summaryCertificate: CheckedFunctionSummaryCertificateId;
  readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
}
```

`checkedFunctions` does not duplicate the MIR graph. It records acceptance
certificate IDs for each Proof MIR function: entry state, accepted block-entry
states, exits, terminal/divergence outcomes, and the exported source-call
summary. `CheckedMirOptimizationEvidence` carries the records and attestations
later phases need to authenticate those IDs without re-running proof checking.
The executable shape remains `mir`; the proof authority is `checkedFunctions`,
`summaries`, `facts`, and the optimization evidence bundle.

The checked fact packet plus `CheckedMirOptimizationEvidence` are the
optimization authority emitted by this phase. The packet carries facts and
scope; the evidence bundle carries certificate records, validation attestation,
path preservation data, and semantic-inline policy:

```ts
export interface CheckedFactPacket {
  readonly ownership: readonly CheckedOwnershipFact[];
  readonly noalias: readonly CheckedNoAliasFact[];
  readonly fieldDisjointness: readonly CheckedFieldDisjointnessFact[];
  readonly erasures: readonly CheckedErasureFact[];
  readonly validatedBuffers: readonly CheckedValidatedBufferFact[];
  readonly packetSources: readonly CheckedPacketSourceFact[];
  readonly privateState: readonly CheckedPrivateStateFact[];
  readonly platformEffects: readonly CheckedPlatformEffectFact[];
  readonly capabilityFlow: readonly CheckedCapabilityFlowFact[];
  readonly terminalClosure: readonly CheckedTerminalClosureFact[];
  readonly exitClosure: readonly CheckedExitClosureFact[];
  readonly layoutAbi: readonly CheckedLayoutAbiFact[];
  readonly origins: readonly CheckedOriginFact[];
}
```

The closed packet fact kinds for this phase are:

```ts
export type CheckedPacketFactKind =
  | "ownership"
  | "noalias"
  | "fieldDisjointness"
  | "erasure"
  | "validatedBuffer"
  | "packetSource"
  | "privateState"
  | "platformEffect"
  | "capabilityFlow"
  | "terminalClosure"
  | "exitClosure"
  | "layoutAbi"
  | "origin";
```

`CheckedFactKindId` is the branded stable ID form of this closed union. A packet
entry whose kind is not in the selected compiler's closed fact-kind table is an
invalid packet entry, even if its label is human-readable.

All packet categories use a common envelope:

```ts
export interface CheckedFactPacketEntry<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
> {
  readonly factId: CheckedPacketFactId;
  readonly kind: Kind;
  readonly subject: Subject;
  readonly scope: CheckedFactScope;
  readonly dependencies: readonly CheckedFactDependency[];
  readonly invalidatedBy: readonly CheckedFactInvalidation[];
  readonly certificate: ProofCheckCertificateId;
  readonly origin: CheckedOriginFact;
}
```

```ts
export type CheckedFactSubject =
  | { readonly kind: "place"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "value"; readonly valueId: ProofMirValueId }
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | {
      readonly kind: "block";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "edge";
      readonly functionInstanceId: MonoInstanceId;
      readonly edgeId: ProofMirControlEdgeId;
    }
  | {
      readonly kind: "call";
      readonly functionInstanceId: MonoInstanceId;
      readonly callId: ProofMirCallId;
    }
  | { readonly kind: "layout"; readonly layoutKey: LayoutFactKey }
  | {
      readonly kind: "authority";
      readonly fingerprint: ProofAuthorityFingerprint;
      readonly entryKey: string;
    }
  | {
      readonly kind: "packetSource";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | {
      readonly kind: "privateState";
      readonly placeId: ProofMirPlaceId;
      readonly generation: ProofMirPrivateStateGenerationId;
    }
  | { readonly kind: "terminal"; readonly terminalKey: CheckedTerminalClosureKey };

export type CheckedFactDependency =
  | { readonly kind: "proofMirFact"; readonly factId: ProofMirFactId }
  | { readonly kind: "proofMirPlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "proofMirValue"; readonly valueId: ProofMirValueId }
  | { readonly kind: "proofMirEdge"; readonly edgeId: ProofMirControlEdgeId }
  | { readonly kind: "proofMirCall"; readonly callId: ProofMirCallId }
  | { readonly kind: "layoutFact"; readonly layoutKey: LayoutFactKey }
  | {
      readonly kind: "authorityEntry";
      readonly fingerprint: ProofAuthorityFingerprint;
      readonly entryKey: string;
    }
  | { readonly kind: "coreCertificate"; readonly certificateId: ProofCheckCoreCertificateId }
  | { readonly kind: "semanticsCertificate"; readonly certificateId: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiation";
      readonly certificateId: CheckedSummaryInstantiationCertificateId;
    }
  | {
      readonly kind: "packetSource";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | { readonly kind: "privateGeneration"; readonly generation: ProofMirPrivateStateGenerationId };

export type CheckedFactDependencyKind = CheckedFactDependency["kind"];

export type CheckedFactInvalidation =
  | { readonly kind: "placeMutation"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "placeMove"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "placeConsume"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "loanConflict"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "privateStateAdvance"; readonly placeId: ProofMirPlaceId }
  | {
      readonly kind: "platformEffect";
      readonly effectKind: PlatformEffectKindId;
      readonly subject: CheckedFactSubject;
    }
  | {
      readonly kind: "runtimeEffect";
      readonly effectKind: RuntimeEffectKindId;
      readonly subject: CheckedFactSubject;
    }
  | {
      readonly kind: "packetSourceSplit";
      readonly packet: ProofMirPlaceId;
      readonly source: ProofMirPlaceId;
    }
  | { readonly kind: "callResultRewrite"; readonly callId: ProofMirCallId }
  | { readonly kind: "cfgRewrite"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "abiRewrite"; readonly layoutKey: LayoutFactKey }
  | { readonly kind: "authorityChange"; readonly fingerprint: ProofAuthorityFingerprint };
```

```ts
export type ProofCheckCertificateId =
  | { readonly kind: "core"; readonly id: ProofCheckCoreCertificateId }
  | { readonly kind: "semantics"; readonly id: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiation";
      readonly id: CheckedSummaryInstantiationCertificateId;
    };

export interface ProofCheckCoreCertificate {
  readonly certificateId: ProofCheckCoreCertificateId;
  readonly rule:
    | "coreEntailment"
    | "authorityMembership"
    | "ownershipTransfer"
    | "loanDisjointness"
    | "layoutReadRequirement"
    | "erasure"
    | "packetSource"
    | "initialState"
    | "exitClosure";
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}
```

Dependencies may name Proof MIR values, places, blocks, edges, calls, facts,
layout records, authority catalog entries, function summaries, companion
certificates, and packet/source relationships. Invalidation entries are closed
unions such as place mutation, consume, private-state advance, CFG rewrite,
call-result rewrite, ABI rewrite, packet/source split, or authority change.

Every packet entry has:

- stable subject IDs from Proof MIR, mono, layout, or the target catalog
- a fact kind from a closed union
- dependency IDs or certificate IDs explaining why it is true
- an origin mapping for diagnostics and debug output
- a validity scope from the closed `CheckedFactScope` union

`CheckedFactScope` is part of the handoff contract with optimization:

```ts
export type CheckedFactScope =
  | { readonly kind: "wholeImage" }
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | {
      readonly kind: "blockEntry";
      readonly functionInstanceId: MonoInstanceId;
      readonly blockId: ProofMirBlockId;
    }
  | {
      readonly kind: "edge";
      readonly functionInstanceId: MonoInstanceId;
      readonly edgeId: ProofMirControlEdgeId;
    }
  | {
      readonly kind: "afterStatement";
      readonly functionInstanceId: MonoInstanceId;
      readonly statementId: ProofMirStatementId;
    }
  | {
      readonly kind: "callResult";
      readonly functionInstanceId: MonoInstanceId;
      readonly callId: ProofMirCallId;
    }
  | { readonly kind: "path"; readonly certificateId: CheckedPathCertificateId };
```

Scope rules are semantic, not presentation metadata:

- `wholeImage` facts survive a rewrite only when that pass declares a
  `PacketPreservationPolicy` for the fact kind, subject kind, and authority
  dependency class; scope alone does not preserve them.
- `function` facts require dominance by the function entry state and are
  invalidated by any pass that changes the function's externally visible
  resource, terminal, ABI, or capability behavior, unless the pass declares a
  checked preservation policy for that fact kind.
- `blockEntry` facts hold at the canonical accepted state for that block and
  require dominance from the entry block to the block.
- `edge` facts hold only along that accepted control edge after edge facts and
  effects are applied.
- `afterStatement` facts hold after that statement's transfer and before the
  block terminator or any later statement mutates a dependent subject.
- `callResult` facts are tied to the produced call result, produced
  capabilities, and imported callee summary.
- `path` facts require the named path certificate. OptIR and target lowering
  must conservatively discard `path` facts on any CFG edit unless the editing
  pass has a checked preservation predicate for that exact certificate kind.

Optimization and target lowering may consume packet facts. They must not infer
additional ownership, noalias, bounds, ABI, terminal, or capability facts unless
those facts are derived by a checked optimization pass with its own invariant.
The default policy for every pass is to drop every packet fact whose dependency
or subject may have changed.

```ts
export interface PacketPreservationPolicy {
  readonly passId: OptimizationPassId;
  readonly preservedKinds: readonly CheckedFactKindId[];
  readonly preservedScopes: readonly CheckedFactScope["kind"][];
  readonly requiredUnchangedDependencies: readonly CheckedFactDependencyKind[];
  readonly invalidatesByDefault: true;
}
```

## Checker State

The executable checker carries one unified proof/resource state:

```text
ProofCheckState
  places: owned / moved / consumed / uninitialized / proof-only-erased
  loans: active shared/exclusive loans with structured place paths
  obligations: open and discharged obligation IDs
  sessions: live session/member tokens with brands and optional obligations
  validations: pending results, live source buffers, live packet tokens
  attempts: pending attempt results and declared affine inputs
  facts: active facts with dependencies and private-state generation
  privateState: current generation per private-state place
  layout: bound layout terms, validated-buffer bounds, packet/source links
  capabilities: live platform/runtime/image capabilities and their brands
  terminal: reached terminal discharge/platform closure facts
  divergence: reachable panic/abort/does-not-return exits
  erasures: proof-only values and resource-only tokens safe to erase
```

All transitions go through this state through one reducer. Domain transfer
functions inspect `ProofCheckState`, but they do not mutate it. They return
typed patches plus diagnostics and certificates; only `reduceProofCheckState`
applies patches to ownership, facts, loans, capabilities, private state,
terminal state, packet/source links, obligations, sessions, validations, and
attempts. This mirrors the proof-derived invariant that accepted returns close
loans, obligations, members, validations, sources, packets, and terminal
requirements in one state.

```ts
export interface ProofCheckTransition {
  readonly transitionId: ProofCheckTransitionId;
  readonly functionInstanceId: MonoInstanceId;
  readonly location: ProofCheckProgramPoint;
  readonly inputState: ProofCheckState;
  readonly operation: ProofCheckOperation;
}

export type ProofCheckTransitionResult =
  | {
      readonly kind: "ok";
      readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly diagnostics: readonly ProofCheckDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type ProofCheckPatchKind =
  | "coreTransfer"
  | "stateJoin"
  | "loopConvergence"
  | "yieldResume"
  | "crossCoreOwnership"
  | "streamLoop"
  | "extensionTransfer"
  | "terminalClosure";

export interface ProofCheckStatePatch<Kind extends ProofCheckPatchKind> {
  readonly kind: Kind;
  readonly transitionId: ProofCheckTransitionId;
  readonly entries: readonly ProofCheckStatePatchEntry[];
  readonly certificate: ProofCheckCertificateId;
}

export type ProofCheckStatePatchEntry =
  | {
      readonly kind: "placeState";
      readonly place: ProofMirPlaceId;
      readonly state: CheckedPlaceState;
    }
  | { readonly kind: "loan"; readonly action: "open" | "close"; readonly loan: CheckedLoanState }
  | {
      readonly kind: "fact";
      readonly action: "add" | "drop" | "weaken";
      readonly fact: CheckedActiveFact;
    }
  | {
      readonly kind: "obligation";
      readonly action: "open" | "discharge" | "close";
      readonly obligation: CheckedObligationState;
    }
  | {
      readonly kind: "session";
      readonly action: "open" | "close";
      readonly session: CheckedSessionState;
    }
  | {
      readonly kind: "validation";
      readonly action: "open" | "consume" | "close";
      readonly validation: CheckedValidationState;
    }
  | {
      readonly kind: "attempt";
      readonly action: "open" | "consume" | "close";
      readonly attempt: CheckedAttemptState;
    }
  | { readonly kind: "privateState"; readonly advance: ProofCheckPrivateStateAdvance }
  | {
      readonly kind: "capability";
      readonly action: "produce" | "consume" | "transfer";
      readonly capability: CheckedCapabilityState;
    }
  | { readonly kind: "terminal"; readonly terminal: CheckedTerminalClosureFact }
  | { readonly kind: "divergence"; readonly divergence: CheckedDivergenceFact }
  | { readonly kind: "layout"; readonly layout: CheckedValidatedBufferFact }
  | { readonly kind: "packetSource"; readonly packetSource: CheckedPacketSourceFact }
  | { readonly kind: "erasure"; readonly erasure: CheckedErasureFact };

export function reduceProofCheckState(
  state: ProofCheckState,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
): ProofCheckStateReductionResult;
```

The reducer validates every patch entry against the current state and the patch
kind. A domain cannot manufacture a live resource by emitting an add entry; the
entry must match a rule that the reducer knows how to replay. Companion-returned
patches use the same reducer path as core transfers.

State comparison is canonical and deterministic. State keys sort maps, sets,
facts, loans, obligations, members, validations, packet links, and capabilities
by stable IDs.

Joins compute a common accepted state, not just an equality verdict. For
resource, ownership, capability, private-state, packet/source, obligation,
session, validation, attempt, and terminal components, all incoming states must
have either exact agreement, a core-defined meet, or a companion-certified meet.
The meet must be no stronger than either input: it may drop facts or path-local
refinements, but it may not create ownership, capabilities, live resources, or
private-state freshness that neither path produced. Active facts, branch
refinements, layout intervals, and path certificates are intersected by stable
fact key unless a closed core rule or companion judgment proves a weaker common
fact. Non-exact companion joins must return the meet state and a replayable
patch; an "equivalent" verdict without a concrete meet is rejected.

## Initial State Construction

Initial state is authority-seeded, not source-seeded, and the seed set depends
on why the function is being checked.

- receiver and parameters enter from the checked function signature with their
  concrete resource kinds and observe/consume modes
- ordinary source-bodied functions start with symbolic assumptions for their
  own declared requirements; those assumptions let the body be checked, are
  recorded in the exported summary's `requiredFacts`, and are not optimization
  authority until a caller or root discharges them
- symbolic predicate assumptions over a private-state receiver or parameter are
  bound to that subject's entry generation; `advancePrivateState` invalidates
  them exactly like proved predicate facts
- `ProofMirImage.externalRoots` define the selected image entry and target
  callbacks; each root must map to a reachable function and a target profile
  entry
- external roots are checked with image-entry facts from the selected profile;
  root declared requirements must be entailed by image-entry facts, firmware ABI
  facts, target-seeded facts, or selected catalog facts before the root body is
  accepted
- image device capabilities are minted only for external roots and target
  callbacks from selected target device-surface records and the mono
  image-device origin/brand records
- target-seeded platform capabilities are minted only for external roots from
  selected image profile arguments, firmware entry ABI facts, and platform/type
  fact catalog entries
- ordinary non-root functions receive no image device capability and no
  target-seeded platform capability unless it is passed as a receiver,
  parameter, or accepted source-call result
- type-intrinsic facts for parameters, receiver, image devices, and seeded
  capabilities are activated only after the subject's concrete type, brand, and
  capability kind match the selected `ProofCheckTypeFactCatalog`
- no source declaration, stdlib wrapper, or Proof MIR fact can create an initial
  capability without matching target authority

The initial-state certificate records the function instance, entry reason
(`ordinarySource`, `imageEntry`, `targetCallback`, or `externalRoot`),
parameter/receiver places, symbolic precondition assumptions, seeded
capabilities, type facts, layout ABI facts, root discharge certificates, and
authority fingerprints used to construct the state.

## Graph Algorithm

The checker uses a deterministic worklist per function:

1. Build the initial function state from the signature, parameters, receiver,
   proof-only inputs, live type-intrinsic facts on parameters, and either
   ordinary symbolic preconditions or external-root image/target seed facts.
2. Visit blocks in stable block order, with outgoing edges processed in stable
   edge order.
3. Apply statement transfers in source order inside a block.
4. Apply terminator transfer, then edge facts/effects, then deliver the state
   to the target block or exit.
5. At ordinary control-flow joins, compute the canonical meet described in
   `Checker State`; facts and refinements are intersected or weakened while
   resources and capabilities require exact agreement, a core meet, or a
   companion-certified meet.
6. At loop headers, use `ProofMirBlockStateMerge.boundaryResources` plus the
   companion loop judgment. The companion defines which resources are
   loop-carried, which facts are invariant, which private-state generations are
   advanced-per-iteration, and which state components must converge exactly.
7. On exits, check the exit closure policy after edge effects and crossed-scope
   cleanup.

The checker records a predecessor witness for every accepted state. If a
transition fails, the counterexample builder reconstructs the path from
function entry to the failed statement, terminator, edge, join, loop header, or
exit.

Join processing is operationally defined:

1. A predecessor edge delivers an incoming state, edge certificate, and staged
   packet entries to the target block's join slot. Staged packet entries are not
   committed to the function packet builder until the target block receives an
   accepted entry state.
2. The join slot records one incoming candidate per stable predecessor edge and
   companion variant key. A later candidate for the same predecessor replaces
   the older one only when its state key changes because an upstream accepted
   state changed.
3. For acyclic joins, the checker waits until every reachable predecessor has
   either delivered a candidate or been proven unreachable. For loop headers,
   it uses the loop convergence protocol and backedge replay rule below.
4. The join checker computes the core meet first. Exact equality accepts
   immediately. Core meets may drop or weaken facts, intersect packet/source
   facts, and compute closed resource meets; they may not create ownership,
   capabilities, obligations, sessions, validations, attempts, private-state
   freshness, or terminal facts.
5. If the core meet cannot handle a reachable non-exact state pair and the
   selected companion has no matching typed judgment, the join fails.
6. When a meet is accepted, the reducer applies the meet patch and produces the
   target block's accepted entry state. If the accepted state key differs from a
   previous accepted entry state for the same block and variant, all successor
   work derived from the previous state is invalidated, descendant staged packet
   entries are discarded, and successors are requeued in stable order.
7. When a meet fails, the checker emits one root join diagnostic with the
   divergent component keys and suppresses successor diagnostics that would
   depend on the missing joined state.

Packet entries remain tied to the transition or path certificate that produced
them. A packet entry generated speculatively after a block whose entry state is
later replaced is discarded and regenerated from the new accepted state. This
keeps the final packet a function of accepted states only, not of worklist
history.

The worklist is finite by construction:

- each block has at most one accepted canonical entry state unless a companion
  loop certificate explicitly names a finite set of loop-carried state variants
- every companion state variant has a stable variant key and a declared maximum
  visit count derived from the loop header, boundary resources, and invariant
  certificate
- a declared visit count is not sufficient by itself; after the bound is
  reached, the checker replays one additional transfer from each accepted
  backedge into the loop header and requires the resulting header meet to be an
  already accepted `(variantKey, stateKey)` pair
- loop convergence certificates name the backedge IDs, variant keys,
  loop-carried resources, generation roles, invariant facts, allowed dropped
  refinements, visit bound, and final replay witness
- a reachable loop header requires a selected loop-convergence judgment; targets
  without one may accept acyclic functions only, unless their companion
  explicitly declares exact loop-state equality as its loop judgment
- private-state generations inside loops are represented by companion-certified
  generation roles such as `entry`, `currentIteration`, `nextIteration`, and
  `closed`, not by unbounded fresh dense IDs at the loop header
- a block whose incoming states fail to converge is rejected immediately; the
  checker does not keep widening silently
- unreachable blocks are checked structurally by Proof MIR validation but do not
  receive a proof state; if an unreachable block is the target of a reachable
  edge, it becomes reachable and is checked normally
- the checker accumulates deterministic diagnostics per failed transition and
  per failed join, then suppresses cascades that depend on a missing state from
  an already-reported predecessor
- state caches are keyed by function ID, block ID, companion variant key, and
  canonical state key

Divergence is checked, not ignored. A `panic` terminator, runtime/platform
`mayPanic` edge, or `doesNotReturn` call creates a divergence exit state. A
panic that unwinds none and aborts the image may use an `abortNoUnwind` function
boundary, but it must still satisfy the exit policy selected for that edge. A
call or terminator proven `doesNotReturn` makes successor source code
unreachable; it does not discharge obligations by pretending a normal return
exists.

Every early-exit edge re-runs crossed-scope closure at the edge itself.
`return`, `break`, `continue`, `yield`, and fallible `?` error edges cannot
cross a live linear obligation, live validation source, live packet, live stream
member, open session, or pending attempt unless the edge's own transfer closes,
returns, transfers, or terminally discharges that state. The checker does not
wait until function exit to discover an obligation leaked across a branch.

## Whole-Image Driver

The checker runs interprocedurally over the closed acyclic reachable source-call
graph:

1. Validate the input contract and build the source-call graph from
   `ProofMirProgram.reachableFunctions` and `ProofMirProgram.callGraph`.
2. Reject any source-call cycle as a proof-check input error. Reachable source
   recursion should have been rejected by monomorphization; seeing it here means
   the checker cannot build sound summaries.
3. Topologically order source functions so callees are checked before callers.
4. Check each source-bodied function with the per-function graph algorithm.
5. Export a `CheckedFunctionSummary` only after the callee body, exits,
   divergence, terminal behavior, private-state effects, and packet entries are
   accepted.
6. When checking a caller, import only already-accepted callee summaries.
7. After all functions are accepted, run whole-image terminal closure over the
   accepted source/platform call graph and attach terminal certificates to the
   packet.

Bodyless certified platform functions and compiler runtime operations are graph
leaves whose behavior comes only from the selected authority catalogs. If a
source call targets a function that lacks an accepted summary, the checker emits
a source-call summary diagnostic and rejects the image.

Function body checking is modular. A non-root source function's declared
requirements become symbolic assumptions at its own entry and required facts in
its summary. They are discharged only by source-call transfer in callers or by
root-entry checking for external roots. This prevents the callee body from
silently relying on image capabilities that are unavailable to ordinary callers.

## Fact Propagation And Entailment

Facts are normalized before use. Normalization preserves fact kind, operands,
layout term references, private-state generation, target/catalog authority, and
origin. It does not simplify by display text.

The core entailment engine supports:

- direct fact identity
- boolean and enum-case refinements from branches and switches
- comparison complements, equality substitution, and transitive comparison
  chains over operands with the same normalized width and signedness
- constant integer interval checks from layout terms and checked integer ranges,
  with explicit width, signedness, and overflow behavior
- `layout.fits(end)`, `payloadEnd(end)`, `fieldAvailable(field)`,
  `rangeConstraint(left relation right)`, and `noUnsignedOverflow(expression)`
  relationships from layout facts
- predicate facts tied to the current private-state generation
- source-call summary facts imported from accepted callees
- type-intrinsic facts tied to live sealed values, brands, capabilities, and
  packet/source relationships
- platform/runtime ensured facts whose contract call succeeded
- terminal-call facts whose terminal graph certificate accepts the path

Integer and layout entailment is bounded but precise for the compiler facts it
accepts:

- all integer operands carry normalized bit width and signedness
- mixed signedness entailment requires an explicit checked conversion fact
- arithmetic facts use checked overflow policy from the source operation,
  layout term, or target ABI surface
- wrapping arithmetic facts are not interchangeable with mathematical integer
  facts unless a companion certificate proves the conversion
- interval endpoints are inclusive and carry provenance
- layout-term equality is by `ProofMirLayoutTermReference` path plus certified
  normalization, not by rendered expression text
- equality substitution preserves private-state generation, packet/source
  identity, and layout unit

The engine returns either a certificate or a missing-proof explanation. It must
not use nondeterministic solver search. If two entailment paths are possible,
it chooses the path with the lexicographically smallest stable certificate key.

Contradictions are not proof fuel. When adding a fact, the fact environment
checks it against active facts over the same normalized operands, private-state
generation, packet/source subject, and numeric domain. A contradictory branch
refinement may make the edge unreachable if the terminator proves that edge
cannot execute. Otherwise, a contradiction in a reachable state is a proof
diagnostic and no requirement is discharged from that state. The checker never
uses explosive reasoning from an inconsistent fact environment.

Core layout entailment is a bounded arithmetic procedure over the selected
`LayoutFactProgram`:

- each layout term normalizes to an affine expression over layout constants,
  source-length symbols, field-value symbols, and checked casts
- coefficients are non-negative integers and every expression carries a
  `LayoutTypeKey`, signedness, and overflow policy
- field-value symbols get intervals from concrete field width, validation
  guards, prior field reads, `rangeConstraint` facts, and explicit checked casts
- `noUnsignedOverflow(expression)` is proved by interval upper bounds within the
  target size type
- `layoutFits(source, end)` is proved only when the checker has `0 <= end`,
  `end <= source.len`, all required dependency fields are available, and every
  addition/cast in `end` has a no-overflow certificate
- a runtime validation guard such as source `layout.fits else ...` may produce
  the `layoutFits(source, end)` fact on the `Ok` edge only when the guard is
  bound to the exact normalized layout end term and dominates that edge
- the procedure closes only over terms present in the layout program,
  validation guard, source requirements, and active facts; it does not invent
  arbitrary arithmetic lemmas or invoke solver search

For `Packet.validate`, the generated validator must bind the payload end term
`2 + usize(payload_len)` to the successful validation edge. The checker then
accepts the `Ok` packet facts only when the `layout.fits` guard, source-length
requirements, `payload_len: u8` interval, and no-overflow facts certify that
same normalized end term. Later payload reads consume the certified
`payloadEnd(end)` and `layoutFits(source, end)` facts.

Requirement checking expands:

- `requireFact` statements
- `ProofMirCall.requirements`
- callee declared requirements at call sites
- external-root declared requirements at root entry
- validated-buffer read requirements
- platform primitive preconditions
- runtime call preconditions
- terminal closure requirements

Each requirement is checked at the program point where it is needed. Satisfying
a requirement in one branch does not make it available in another branch unless
the fact is also present in the joined state.

## Source Calls And Type-Intrinsic Facts

Source functions are checked bodies, not trusted summaries. The checker checks a
callee body under its declared symbolic requirements, builds a
`CheckedFunctionSummary` for every accepted source-bodied function, and imports
that summary at source-call sites only after the caller discharges the summary's
required facts.

```ts
export interface CheckedFunctionSummary {
  readonly functionInstanceId: MonoInstanceId;
  readonly requiredFacts: readonly CheckedRequirementFact[];
  readonly observedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly consumedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly mutatedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly producedPlaces: readonly CheckedSummaryPlaceEffect[];
  readonly returnedFacts: readonly CheckedSummaryFact[];
  readonly invalidatedFacts: readonly CheckedFactInvalidation[];
  readonly privateStateEffects: readonly CheckedPrivateStateFact[];
  readonly producedCapabilities: readonly CheckedCapabilityFlowFact[];
  readonly terminalEffects: readonly CheckedTerminalClosureFact[];
  readonly divergence: readonly CheckedDivergenceFact[];
  readonly certificateId: CheckedFunctionSummaryCertificateId;
}
```

Semantic-inline policy is exported separately from callable source summaries:

```ts
export interface CheckedSemanticInlinePolicy {
  readonly functionInstanceId: MonoInstanceId;
  readonly kind: "mandatory" | "eligible" | "forbidden";
  readonly reason:
    | "proofWrapper"
    | "validationHelper"
    | "monomorphizedShim"
    | "resourceWrapper"
    | "singleCallThunk"
    | "platformWrapper"
    | "runtimeWrapper"
    | "ordinaryPerformanceInline"
    | "observableBoundary";
  readonly certificateId: CheckedFunctionSummaryCertificateId;
}

export type CheckedSemanticInlinePolicyTable = ReadonlyMap<
  MonoInstanceId,
  CheckedSemanticInlinePolicy
>;
```

Monomorphization and MIR lowering may propose policies for compiler-generated
shims, wrappers, and thunks they create. Proof/resource checking authenticates
the policy against the accepted function summary, erasure facts, ABI/layout
facts, capability flow, private-state behavior, terminal behavior, and
platform/runtime effect summaries. Source syntax or stdlib identity alone
cannot mark a function mandatory.

Authenticating this table is not an optimization pass. The checker does not
inline or remove the function; it records whether the already-constructed MIR
boundary has the facts required for a later OptIR mandatory-inline obligation.

For a `sourceFunction` call, the checker:

1. Resolves the callee function instance in the closed `ProofMirProgram`.
2. Validates the call ABI reference against layout function ABI facts.
3. Checks the callee summary's `requiredFacts` and `ProofMirCall.requirements`
   after substituting receiver, arguments, type arguments, and result binders.
4. Applies receiver and argument observe/consume effects in the caller state.
5. Imports only the accepted callee summary facts whose dependencies are
   satisfied by the call operands and result.
6. Introduces live type-intrinsic facts for any returned sealed value,
   capability, packet, or branded resource.
7. Applies callee divergence and terminal effects when the summary proves the
   call does not return normally or reaches terminal closure.

Function summaries are callable authority, not packet facts and not facts true
at a program point. The checker stores accepted summaries in
`checked.summaries` and computes them by stable topological function order after
validating that the reachable source-call graph is acyclic. A summary becomes
usable only at a call site after receiver/argument/result substitution and
precondition discharge. Only the instantiated call result, produced capability,
terminal, divergence, and invalidation facts are emitted into the checked fact
packet, and those packet entries cite a
`CheckedSummaryInstantiationCertificateId`. Path-specific return facts remain
path-scoped packet entries and are not imported by ordinary callers unless the
call site also imports the matching path certificate.

Summary guarantees are under-approximated and summary effects are
over-approximated:

- `returnedFacts` may contain only exportable facts true on every normal return
  path; omitting a true fact is safe, adding an unproven fact is unsound
- `mutatedInputs` names places that may be mutated on any normal return path;
  omitting a possible mutation is unsound
- `invalidatedFacts` names fact kinds, subjects, dependencies, and scopes that
  may be invalidated by any callee path; an unmodeled effect touching a subject
  invalidates facts about that subject by default
- `divergence` records both `mayDiverge` and `mustDiverge` behavior; a
  `mayDiverge` callee cannot be treated as a normal-return-only call, while a
  `mustDiverge` callee makes successor source code unreachable
- terminal and private-state effects are over-approximated by subject and
  generation so callers cannot retain stale terminal, packet/source,
  capability, or private-state facts

Only these facts are exportable from a source function summary:

- declared return facts that were proven on every normal return path
- type-intrinsic facts on the returned value, produced places, or produced
  capabilities
- capability-flow facts that explicitly transfer a capability through a result
  or produced place
- platform/runtime ensured facts intentionally attached to a result, receiver,
  argument, or produced capability by a catalog contract
- terminal and divergence summary facts
- facts whose dependencies bind only to the receiver, parameters, result, or
  produced capabilities

Facts about internal locals, block-local path refinements, temporary layout
terms, internal packet/source links, or implementation-only private-state
generations are not exportable summary facts.

Summary effects are explicit:

```ts
export type CheckedSummaryPlaceEffect =
  | {
      readonly kind: "observes";
      readonly place: ProofCheckPlaceBinder;
      readonly borrowMode?: "shared" | "exclusive";
    }
  | { readonly kind: "consumes"; readonly place: ProofCheckPlaceBinder }
  | {
      readonly kind: "mutates";
      readonly place: ProofCheckPlaceBinder;
      readonly invalidates: readonly CheckedFactInvalidation[];
    }
  | {
      readonly kind: "produces";
      readonly place: ProofCheckPlaceBinder;
      readonly resourceKind: ConcreteResourceKind;
    }
  | {
      readonly kind: "returns";
      readonly value: ProofCheckValueBinder;
      readonly resourceKind: ConcreteResourceKind;
    };
```

Summaries cannot export live loans, open obligations, live session members,
pending validations, pending attempts, live packet/source obligations, or
unclosed private-state transitions. Those must be closed, transferred through a
returned/produced place with an explicit capability-flow fact, or rejected.

Terminal source functions use terminal summaries, not ordinary normal-return
summaries. A terminal summary records:

- consumed non-`self` linear arguments and the obligation/session/member each
  argument closes
- whether `self` is observed, reused, or consumed
- platform terminal effects reached by every returning path
- no exported return facts and no live resources after the terminal call
- the terminal graph edge that proves the function reaches a certified platform
  terminal primitive directly or through another accepted terminal function

At a terminal call site, source-call transfer applies the terminal summary as a
resource-closing transfer. For `return_rx(packet)`, the call consumes `packet`,
checks its stream membership brand, closes the matching `RxBatch` member, and
then records terminal/platform closure. For `send(buffer, len)`, the call
consumes `buffer`, checks `len <= buffer.initialized_prefix`, and records the
TX platform publish effect.

Type-intrinsic facts are the cross-call channel for sealed values and
capabilities whose safety facts are carried by the value while it is live. They
come from the selected `ProofCheckTypeFactCatalog` schema defined in Authority
Catalog Schemas, not from source names or untrusted MIR facts.

The checker may activate a type-intrinsic fact only when the subject value or
place is live, owned or validly observed, has the required brand/capability, and
has not crossed an invalidating move, consume, private-state transition,
validation split, attempt split, or platform/runtime effect. Moving a sealed
value transfers its live type-intrinsic facts to the destination; consuming it
removes them unless the consuming operation's accepted contract produces a new
branded result. Borrowing it exposes only facts allowed by the borrow mode.
The `invalidatedBy` union is exhaustive for the selected catalog schema. A new
platform or runtime effect kind invalidates all type-intrinsic facts about any
touched subject unless the selected catalog explicitly proves preservation for
that effect and subject.

## Resource-Kind Lifting

Proof checking consumes the concrete resource kind produced by semantic surface
checking and monomorphization, then revalidates it at every wrapper boundary.
The current concrete kind lattice is:

```ts
export type ProofCheckConcreteResourceKind =
  | "Copy"
  | "Affine"
  | "Linear"
  | "UniqueEdgeRoot"
  | "EdgePath"
  | "Stream"
  | "ValidatedBuffer"
  | "PrivateState"
  | "SealedPlatformToken"
  | "Never";
```

`Never` is ignored in joins. `Linear` and proof-relevant kinds lift to
`Linear`; `Affine` lifts to `Affine` unless a contained field is `Linear` or
proof-relevant. The checker verifies the selected `MonoCheckedType` resource
kind by canonical mono type key, not object identity. The key includes the type
constructor ID, owner, concrete type arguments, brand arguments, and resource
kind derivation rule.

Wrapper lifting rules are mandatory:

- `Option[T]`, `Result[T, E]`, tuples, `List[T]`, `Map[K, T]`, and any wrapper
  whose storage may contain `T` lift the strongest resource kind of their
  contained values
- dataclasses and ordinary value aggregates reject affine, linear, edge-path,
  stream, validated-buffer, private-state, and sealed-token fields unless the
  constructor is a checked owner with explicit storage/close semantics
- matching an affine or linear wrapper consumes the wrapper and transfers the
  contained obligation into the active arm
- dropping `None`, `Err` without an affine payload, or an empty checked owner is
  allowed only when no hidden affine/linear payload is present
- dropping `Some(buffer)`, `Ok(packet)`, `Err(item)`, `List[T]`, or `Map[K, T]`
  with live affine/linear content is rejected unless the active branch closes,
  returns, transfers, or terminally discharges that content

This is why `Option[WritableBuffer]`, `Option[RxCompletion]`,
`Result[TransferOk, T]`, `Option[T]` from `MoveRing.pop`, `List[T]`, and
`Map[K, T]` are never treated as copyable just because the outer constructor is
an enum or collection. The place-state model tracks projections through wrapper
cases, tuple fields, list elements, and map values by structured place
projection, not display names.

## Unique Edge Roots And Capabilities

`UniqueEdgeRoot` is a singleton authority kind. The checker validates that each
selected image contains at most one live root for a concrete unique edge class
and brand:

- unique roots may be minted only from selected image/device binding authority,
  firmware bringup authority, or a catalog contract whose produced capability is
  explicitly a unique root
- every unique root has one image-scope root record, one concrete type key, one
  brand, and one origin
- duplicate unique-root records for the same concrete device authority reject
  the image before function checking
- splitting a unique root consumes the root and produces declared affine
  `EdgePath` capabilities; the consumed root cannot be used again
- ordinary `edge class` path values are affine path capabilities, not unique
  roots, and may have multiple live values only when the catalog contract
  permits that shape
- no source constructor, stdlib wrapper, type-intrinsic fact, or Proof MIR fact
  may mint a unique root without matching image or platform authority

The singleton check is whole-image authority validation, not a local ownership
rule. The ownership reducer enforces use-after-split locally, while the input
contract rejects multiple initial roots for the same selected unique device.

## Platform And Runtime Contracts

Platform primitive calls are checked from the target-owned contract catalog, not
from source text. For each `certifiedPlatform` call, the checker:

1. Resolves the `ProofMirPlatformEdge` by edge ID.
2. Resolves the catalog contract by target ID, primitive ID, and contract ID.
3. Validates instantiated call operands, receiver, parameters, return type,
   resource kinds, and ABI/layout reference against Proof MIR and layout facts.
4. Expands catalog preconditions into requirement facts and capability
   requirements.
5. Checks ownership and no conflicting loans for observed operands.
6. Checks ownership and consumes affine operands for consumed operands.
7. Checks all preconditions by deterministic entailment.
8. Applies catalog effects, including memory effects, private-state
   advancement, does-not-return behavior, produced facts, produced
   capabilities, consumed capabilities, and result ownership.
9. Emits platform effect and capability-flow certificates into the fact packet.

Compiler-runtime calls use the same transfer shape, but their authority is the
selected `ProofCheckRuntimeCatalog` input. The embedded
`ProofMirProgram.runtimeCatalog` is treated as a cached copy and must match the
selected runtime catalog fingerprint exactly before any runtime call is checked.
Runtime catalog entries may produce trusted axioms only for their own operation
schemas. Runtime helpers cannot discharge source obligations or forge platform
capabilities unless their selected runtime catalog contract explicitly says so.

Platform/runtime effect invalidation is default-deny. Every effect kind declares
the subjects it may read, mutate, consume, produce, preserve, or terminate. If a
new effect kind or unmodeled target effect touches a place, capability,
packet/source link, private-state place, layout subject, or terminal subject,
the checker drops all facts depending on that subject unless the selected
catalog contains an explicit preservation fact for that effect and dependency.

## Ownership, Places, And Loans

Places are structured roots plus projections. The checker computes place
relations without converting paths to strings:

- same place
- ancestor
- descendant
- overlapping sibling
- disjoint field
- unrelated root

Move, use, consume, and loan rules are field-sensitive:

- using a place requires it to be initialized/owned and not moved or consumed
- observing a place conflicts with active exclusive loans of the same place,
  ancestors, or descendants
- mutating or consuming a place conflicts with any active shared or exclusive
  loan of the same place, ancestors, or descendants
- a whole-object use conflicts with any live loan or moved field below it
- a field use is allowed when only disjoint fields are loaned or moved
- moving a field marks the whole aggregate unavailable as an intact object until
  reinitialized
- returning with any live loan is rejected

The checked fact packet records noalias and field-disjointness facts only for
relations proven from structured place identities and accepted loan state.
String equality, source names, and field display names are not authority.

## Erasure Safety

The checker certifies erasure; it does not perform erasure. An erasure fact may
be emitted only when all of these conditions hold:

- the value, place, token, fact object, obligation handle, session member,
  validation result, attempt result, private-state generation marker, or brand
  has proof-only representation or resource-only representation in Proof MIR
- no accepted runtime, platform, source-call ABI, layout fact, stack slot, image
  entry ABI, or validated-buffer storage fact requires the erased subject to be
  materialized at runtime
- every runtime effect that depends on the subject has already been translated
  into a certified fact, capability-flow edge, terminal fact, or checked
  resource transition
- every live resource represented by the subject is closed, transferred, or
  consumed at all exits in its validity scope
- removing the subject cannot change branch conditions, switch scrutinees,
  panic reasons, call targets, argument order, memory addresses, or observable
  target ABI behavior
- the erasure certificate names all facts and transitions that replace the
  subject's proof role

Optimization and lowering may erase only subjects with a matching
`CheckedErasureFact`. If a proof-only value is accidentally used by a runtime
operation, ABI boundary, memory layout, or emitted branch condition, the checker
rejects the program instead of certifying partial erasure.

## Take, Sessions, Validation, And Attempts

`take` creates a resource obligation and may create a session member token. The
checker records the exact obligation, session, brand, optional place, and origin.
Discharge must target the same obligation and, when present, the same
session/member brand. Closing the wrong member, discharging the right obligation
through the wrong session, or exiting with the member live is rejected.

The three take modes map to distinct state components:

- `take stream` opens a one-shot stream session, a stream loan of the producing
  edge path, and an outstanding-member set. Iteration move-yields affine member
  places branded to that stream session. Each yielded member must be closed
  exactly once by a terminal function on that stream. Uniterated members remain
  edge-owned and never become live core obligations.
- `take buffer` opens a linear buffer obligation for the taken buffer place.
  The obligation must be discharged by a terminal function, transferred into a
  successful validation packet, returned to the caller, or closed by an
  explicitly checked edge transfer before the take scope exits.
- `take validated` opens a validated-buffer session for an already validated
  packet or packet-like value. The validated value cannot be stored, copied, or
  returned unless the selected contract transfers its session. It must be
  consumed, terminally discharged, or closed before the take scope exits.

Stream iteration has a core state shape before any companion stream-loop
judgment runs:

1. `take self.rx.receive() as batch` atomically calls the stream-producing
   operation, opens the `RxBatch` stream session, and loans the `NetworkRx` path
   to the session.
2. `for buffer in batch` move-yields one `ReadableBuffer` member, adds that
   member to the outstanding set, and brands the yielded buffer with the batch
   membership brand.
3. `take buffer` opens the linear buffer obligation for that yielded member.
4. `Packet.validate(source=buffer, ...)` consumes the buffer into `packet` on
   `Ok` and leaves it live on `Err`.
5. On `Ok`, the packet inherits the source buffer's stream membership brand and
   records a packet/source relationship from the validation certificate.
6. `batch.return_rx(packet)` consumes the packet, checks the packet membership
   brand matches the current `batch`, closes the yielded member, and removes it
   from the outstanding set.
7. On `Err`, `batch.drop_rx(buffer, rejected)` consumes the original buffer,
   checks the buffer membership brand, closes the yielded member, and removes it
   from the outstanding set.
8. The stream session may close only when no yielded member is live and all
   uniterated members remain owned by the edge path.

Validation is a single-use split:

- `validate` creates one pending validation result tied to a source place and
  validated-buffer instance
- `matchValidation` consumes the pending result
- the `Ok` edge consumes the source into a packet and introduces packet/payload
  places
- the `Ok` packet inherits the source buffer's take-session membership brand,
  packet/source relationship, and validated layout bounds
- the `Err` edge keeps the source live and introduces no packet
- each arm must either close, consume, or transfer its arm-local resources until
  it reaches the same declared match-output resource shape
- the split join accepts only when the repaired arm output states produce a
  canonical meet or companion-certified meet
- availability facts after the match are the intersection of facts true in both
  repaired output states
- pending validation results, live validation source buffers, and live packet
  tokens must be closed before function exit

Attempt is the fallible affine-consumption sibling:

- `attempt` records the declared input places and pending result
- the success edge may consume the declared inputs
- the error edge starts from the original input state
- after the match, a place is usable only when both paths leave it usable
- success and error arms must repair to the same declared match-output resource
  shape before joining
- the split join accepts only when the repaired output states produce a
  canonical meet or companion-certified meet

The fact packet records packet/source relationships and validated-buffer bounds
only after these split rules are accepted.

Validation and attempt joins are therefore not "raw Ok state equals raw Err
state" checks. They are split joins: each arm starts from its arm-specific state,
performs explicit source operations, and must arrive at one common output state.
They are special cases of the general join rule: arm-local repair produces the
candidate meet, resource state must agree or meet, and facts/refinements are
intersected or weakened. The checker reports the first divergent resource, fact,
packet/source, private-state generation, or capability that prevents that common
output state.

## Private State Threading

Predicate facts may depend on private-state generations. The checker records
the current generation for each private-state place. A predicate fact tied to
generation `G` is active only while that place's current generation is `G`.

`advancePrivateState` transitions create a new generation, thread it through the
state, and invalidate facts tied to the previous generation unless the
companion supplies a specific preservation rule. Catalog preconditions cannot
be satisfied by stale predicate facts. Diagnostics identify the stale fact
origin and the private-state transition that advanced the generation.

Private-state generation facts in the checked packet are scoped to the accepted
program point where the generation is current. They are not function-wide facts
unless no transition can invalidate them on any reachable path.

## Terminal Closure

Terminal closure has two layers:

- local exit closure: terminal returns require no live proof/resource state and
  require terminal reachability
- whole-image terminal graph closure: every terminal body must reach a
  certified platform terminal effect on all returning paths

The terminal graph checker runs over the accepted call graph:

- a certified platform call with the catalog terminal effect reaches platform
- a terminal function reaches platform when every returning branch reaches a
  platform terminal effect directly or through another accepted terminal
  function
- fallthrough, missing terminal targets, dynamic terminal dispatch, self-cycles,
  and mutual terminal cycles without a platform-reaching base are rejected

Terminal facts in the packet identify the terminal call, the platform-reaching
edge, the closure path, and the exit state that had no live loans, obligations,
members, validations, sources, or packets.

The core terminal graph checker builds the closed terminal graph, normalizes
nodes and edges, rejects missing targets, dynamic terminal dispatch, and
non-platform-reaching cycles, and constructs the candidate closure path. The
companion validates the target-specific terminal-closure judgment over that
closed graph. It may not add terminal edges, invent platform effects, or hide a
cycle that the core graph does not contain.

Panic and abort exits participate in closure. The production UEFI target
supports panic as `abortNoUnwind`: it may terminate the image, but it cannot
resume and cannot run implicit cleanup for linear resources. A panic path may
cross live proof/resource state only if the selected exit closure policy proves
that the state is unobservable after abort. Resumable or unwinding panic is
rejected unless a target profile supplies explicit Proof MIR cleanup operations
and a companion judgment for those operations. There is no implicit destructor
or unwinding cleanup model in this checker.

## Yield And Scheduler Borrow

`yield self.wake` is a scheduler borrow. The core checker verifies before the
companion is invoked:

- no live linear obligation, validation source, packet, stream member, session,
  pending attempt, or unclosed private-state transition crosses the yield edge
- the wake capability is live, borrowed for the yield, and still owned by the
  same receiver after resume
- yield does not move, consume, split, or duplicate the wake capability
- facts depending on unstable scheduler/device state are invalidated by the
  yield/resume edge unless the selected catalog proves preservation

The companion then validates target-specific frame layout, suspend/resume
state, and any scheduler ordering requirements.

## Validated Buffers And Layout Facts

Validated-buffer reads are checked against the ordered layout fact program:

- fixed fields require `layout.fits(fixedEnd)`
- dynamic field payload bounds require the fixed fields that determine the end
  term to have been read or otherwise proven
- payload reads require both `payloadEnd(end)` and `layout.fits(end)`
- field reads require every `LayoutReadRequirement` attached to the field,
  including `fieldAvailable(field)`, `rangeConstraint(left relation right)`, and
  `noUnsignedOverflow(expression)` obligations emitted by layout translation
- derived field reads require a checked derive-table entry whose source field
  read requirements are satisfied and whose case mapping is deterministic and
  exhaustive for the declared `otherwise` behavior
- packet reads require a live packet/source relationship from a successful
  validation
- source reads require the source buffer to still be live and not consumed into
  a packet

The checker uses `ProofMirLayoutTermReference` and `LayoutFactProgram` keys as
authority. It never compares rendered layout expressions. Certified packet
bounds record the source place, packet place when present, field ID, offset
term, end term, read requirements, and entailment certificates.

Derived fields produce facts that connect the derived packet field to the
layout field that justified it. For `Packet.kind`, a successful read of
`kind_byte` plus the checked derive table may produce facts such as
`packet.kind == PacketKind.ping` on the branch where `kind_byte == 0`.
Those facts carry dependencies on the source field read, derive table entry,
packet/source relationship, and active packet session. They are invalidated when
the packet is consumed, the packet/source link is split, or the source layout
facts are invalidated.

## Extension Safety

Enabled-extension safety is a separate judgment from target feature syntax. A
target feature may allow Proof MIR to contain an extension record, but the proof
checker still requires an enabled companion rule for that record.

For each extension statement or terminator, the checker:

- verifies the gate is enabled in the selected semantics companion
- validates the extension's operands, places, brands, obligations, and effects
  using core ownership and fact rules before invoking extension semantics
- invokes the companion transition judgment
- applies the companion's returned state patch to the pre-extension state and
  replay-checks the result against the closed extension schema
- records extension-derived facts only in extension-specific packet entries

Core code must not special-case extension behavior outside
`domains/extensions.ts`. If a companion rule returns an invalid state, the
checker emits a diagnostic against the extension judgment and rejects the
program.

Cross-core memory ordering is part of the cross-core ownership companion
judgment. The core checker verifies brands, capabilities, places, and catalog
authority before dispatch. The companion certificate must then prove transfer
eligibility, ownership handoff, producer/consumer visibility, and any required
runtime fence or MoveRing ordering effect. Without that certificate, no
cross-core packet fact or capability-flow fact is emitted.

A value is `core-movable` only when the selected type/capability catalog marks
its concrete type, brand, and capability kind as transferable and the companion
accepts the cross-core eligibility request. Eligibility fails if the value or
any dependency is path-branded, packet/source-bound, private-state-bound,
borrowed, partially moved, tied to an open obligation/session/validation/attempt,
or dependent on a non-transferable platform capability. The core checker
verifies the catalog eligibility preconditions; the companion proves the
cross-core ownership and ordering judgment for the selected transfer primitive.

## Diagnostics

Proof diagnostics are deterministic and path-oriented:

```ts
export interface ProofCheckDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: ProofCheckDiagnosticCode;
  readonly messageTemplateId: ProofCheckDiagnosticTemplateId;
  readonly messageArguments: readonly ProofCheckDiagnosticArgument[];
  readonly message: string;
  readonly counterexample?: ProofCounterexamplePath;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly order: ProofCheckDiagnosticOrder;
}
```

`message` is rendered from `messageTemplateId` and `messageArguments`. It is
excluded from diagnostic identity, sort order, suppression keys, and golden
determinism checks; those use `code`, template ID, structured arguments,
`ownerKey`, `rootCauseKey`, `stableDetail`, and `order`.

A counterexample path contains stable frames:

- function instance and source function ID
- block ID
- statement, terminator, edge, join, loop header, or exit ID
- origin ID and source origin when available
- relevant state snapshot before and after the failed transition
- missing, stale, conflicting, divergent, or leaked resource/fact IDs

State snapshots are canonical summaries, not full mutable maps:

```ts
export interface ProofCheckStateSnapshot {
  readonly stateKey: string;
  readonly livePlaces: readonly string[];
  readonly movedOrConsumedPlaces: readonly string[];
  readonly loans: readonly string[];
  readonly obligations: readonly string[];
  readonly sessions: readonly string[];
  readonly validations: readonly string[];
  readonly attempts: readonly string[];
  readonly facts: readonly string[];
  readonly privateStateGenerations: readonly string[];
  readonly capabilities: readonly string[];
}
```

Diagnostic families include:

- invalid proof-check input contract
- missing platform contract
- unsatisfied requirement
- untrusted or stale fact
- missing layout entailment
- use after move or consume
- conflicting loan
- leaked loan, obligation, session member, validation, source, or packet
- wrong-session or wrong-brand discharge
- divergent branch, validation, attempt, or loop state
- non-convergent loop
- unsupported or unsafe extension
- missing terminal closure
- platform/runtime precondition failure
- platform/runtime capability-flow mismatch
- source-call summary mismatch
- forged trusted axiom
- runtime catalog authentication failure
- invalid proof erasure
- invalid panic or divergence closure
- invalid checked fact packet

Warnings and notes are non-authoritative. They may report ignored candidate
facts, discarded path facts after a checked rewrite, redundant requirements
already implied by stronger facts, or debug-only suppression relationships. No
warning or note may be required for soundness, and no downstream phase may rely
on one as optimization authority.

Diagnostics sort by source origin, function instance, path frame, diagnostic
code, owner key, root cause key, and stable detail. The same invalid program
must produce the same complete diagnostic set in the same order across runs. To
avoid cascades, a diagnostic may suppress dependent diagnostics, but suppression
is itself deterministic and keyed by the earlier root-cause diagnostic.

Suppression rules are closed:

- missing input authority suppresses diagnostics that require that authority
- missing predecessor state suppresses downstream transition diagnostics from
  blocks reachable only through that predecessor
- failed join suppresses diagnostics inside successor blocks that would depend
  on a joined state
- failed function summary suppresses source-call import diagnostics in callers,
  but callers still report unsatisfied requirements that do not depend on that
  summary
- each suppressed diagnostic records the suppressing diagnostic key in debug
  output, but suppressed diagnostics are not part of the public set

## Determinism

All checker iteration is deterministic:

- functions sort by `MonoInstanceId`
- blocks, edges, statements, values, places, facts, and calls sort by their
  Proof MIR IDs
- maps and sets serialize through canonical state keys
- entailment chooses the lexicographically smallest stable certificate when
  multiple proofs exist
- diagnostics sort through explicit order keys
- checked fact packet entries sort by fact kind, subject key, validity scope,
  and origin

The checker must not depend on JavaScript object insertion order unless the
object was produced by a deterministic table and copied in sorted order.

## Complexity And Memory Bounds

The production checker stores canonical state digests, predecessor witnesses,
and compact state snapshots for every accepted `(function, block, variant,
stateKey)` pair. Full mutable maps are retained only for active worklist states
and for diagnostics that survive suppression. Debug builds may retain expanded
snapshots; production diagnostics reconstruct expanded paths from compact
snapshots and predecessor witnesses.

Each selected target profile declares deterministic limits:

- maximum reachable functions
- maximum blocks and edges per function
- maximum accepted state variants per block
- maximum active facts, loans, obligations, validations, attempts, and
  capabilities per state
- maximum counterexample path frames rendered per diagnostic
- maximum staged packet entries per function before packet validation

Hitting a limit produces a deterministic proof diagnostic with the limit key,
function/block key, and state key. The checker does not silently widen, drop
diagnostics nondeterministically, or accept an image after exceeding a proof
resource limit.

## Checker Implementation

`proof-checker.ts` is the production public facade and delegates directly to the
reference checker implementation. It validates trusted inputs, runs the
canonical checker kernel, normalizes diagnostics, validates the packet, and
returns the public `CheckProofAndResourcesResult`.

The reference checker is not a separate throwaway implementation. It is the
first production implementation, built around explicit state transitions, full
state snapshots for diagnostics, the single state reducer, and small pure
helpers. A future optimized engine may be introduced only after the reference
checker is complete and only with an explicit adapter boundary, generated
differential fixtures, packet-equivalence checks, diagnostic-order checks, and
proof that the optimized engine preserves the same public API and accepted fact
packet.

## Testing Strategy

Unit tests should cover each checker rule with hand-built Proof MIR fixtures and
dependency-injected fake catalogs. Integration tests should drive real source
through HIR, monomorphization, layout, Proof MIR, and proof checking whenever
the frontend can express the invalid case.

Required negative integration cases:

- every proof/resource-related case in `docs/language/invalid.md` that reaches
  Proof MIR must become a must-reject fixture with a stable proof diagnostic
- return with a live loan
- return with an open obligation
- return with a live session member
- ignored validation result
- validation `Ok` arm leaks packet while `Err` arm keeps source
- attempt success consumes input while error leaves it live
- stale private predicate fact after private-state advancement
- source call whose callee requirement is not entailed
- source call that imports a returned fact not present in the accepted callee
  summary
- treating `Option[WritableBuffer]`, `Result[TransferOk, T]`, `List[T]`, or
  `Map[K, T]` with affine/linear contents as copyable or droppable
- duplicate `unique edge class` root authority in one image
- `take stream` loop that leaves a yielded member unclosed
- `take stream` terminal call using a packet or buffer branded to a different
  stream session
- `take buffer` scope crossed by `?`, `break`, `return`, or `yield` while the
  buffer obligation is live
- `yield self.wake` while any linear obligation or stream member is live
- `send(buffer, len=1)` after a sparse write that did not advance
  `initialized_prefix`
- derived packet field read without the source layout field read or derive-table
  certificate
- consuming platform call that fails to preserve required input/output field
  relationships such as length, capacity, descriptor, or brand
- platform primitive call without an entailed catalog precondition
- platform primitive call with mismatched capability consumption
- runtime catalog fingerprint mismatch between Proof MIR and selected target
- forged `trustedAxiom` fact not present in a selected trusted authority
- validated-buffer dynamic payload read without `payloadEnd`
- validated-buffer read without `layout.fits`
- whole-object use while a field loan is live
- proof-only value used by runtime ABI or emitted control flow
- panic path that violates its closure policy
- terminal return without platform reachability
- terminal self-cycle and mutual cycle without platform base
- MoveRing transfer of a path-branded or non-core-movable `WritableBuffer`
- extension record without enabled companion judgment
- cross-core transfer without the companion's ownership and memory-ordering
  certificate
- loop header whose state does not converge deterministically

Required success integration cases:

- ordinary source call with satisfied `requires`
- source call importing a certified callee summary fact
- `Option[WritableBuffer]` match where the `Some` arm takes and sends the buffer
  and the `None` arm has no live resource
- unique edge root split that consumes the root and produces affine RX/TX/Wake
  paths exactly once
- live sealed value activating type-intrinsic bounds or capability facts
- `SyncedRxBuffer` to readable-buffer conversion preserving descriptor,
  written-length, capacity, and source provenance facts
- `Packet.validate` success path where packet inherits the source stream member
  brand and `return_rx(packet)` closes that member
- `Packet.validate` error path where `drop_rx(buffer, rejected)` closes the
  original buffer member
- derived `Packet.kind` refinement from `kind_byte` through the checked derive
  table
- contiguous `write_u8(offset=0)` advances `initialized_prefix` so
  `send(len=1)` is accepted
- consuming platform call preserving relational input/output field facts
- platform primitive call with consumed and produced capabilities
- MoveRing transfer of an explicitly core-movable branded value with companion
  ownership and memory-ordering certificate
- field-disjoint loans that produce noalias facts
- disjoint field use while another field is loaned
- validation success path producing packet/source and bounds facts
- attempt arms that converge after resource repair
- private-state generation fact invalidation and re-proving
- terminal function that delegates to a certified platform terminal primitive
- checked packet containing ownership, erasure, layout/ABI, terminal, and origin
  facts

Property tests should generate small Proof MIR graphs with bounded blocks,
facts, places, loans, obligations, validations, attempts, and exits. The
generated tests should compare repeated checker runs for acceptance, diagnostic
determinism, state-patch replay determinism, and packet validation. If a future
optimized engine is added, the same generators become differential tests against
the reference checker. `fast-check` remains a test-only dependency.

## Implementation Notes

The implementation should proceed through one production spine, then attach
domains behind that spine:

1. Define the public API, diagnostics, checked MIR wrapper types, minimal fact
   packet envelope, certificate ID union, and input validator.
2. Implement the canonical checker kernel: deterministic graph worklist,
   `ProofCheckTransition`, `ProofCheckState`, `ProofCheckStatePatch`,
   `reduceProofCheckState`, state keys, state snapshots, and counterexample
   paths.
3. Add kernel tests before domain behavior: input rejection, state-key
   determinism, patch reducer replay, transition ordering, diagnostic ordering,
   and packet-envelope validation.
4. Implement exact/core joins, join slots, staged packet entries, successor
   requeue, failed-join suppression, early-exit closure, and reducer replay for
   core meet patches.
5. Implement authority fingerprints, injective canonical serialization, runtime
   catalog authentication, platform contract lookup, type-fact catalog lookup,
   and trusted-axiom membership checks.
6. Implement normalized fact/requirement terms, binders, substitution, term
   keys, fact normalization, the fact environment, and core entailment.
7. Implement resource-kind lifting, unique edge root validation, canonical
   `MonoCheckedType` equality, and wrapper projection place tracking.
8. Implement bounded layout entailment, validation guard binding,
   `layoutFits`/`payloadEnd`/`fieldAvailable`/`rangeConstraint`/
   `noUnsignedOverflow`, and derive-table facts.
9. Implement the closed `ProofSemanticsCompanion.judge` adapter and envelope
   validation for every typed judgment request/result, without adding new state
   mutation paths.
10. Implement source-call summaries as callable authority over the reachable
    acyclic source-call graph, then emit only instantiated call-result packet
    facts at call sites.
11. Add ownership, place relations, move/use/consume, loan conflicts,
    noalias/field-disjointness, and erasure certification as patch-producing
    domains.
12. Add obligation, session, take-stream/take-buffer/take-validated, validation,
    attempt, and private-state transfers as patch-producing domains.
13. Add platform/runtime contract transfer, guarded postconditions, capability
    flow, effect invalidation, divergence, panic, and does-not-return transfer.
14. Add non-exact loop convergence, stream-loop convergence, typed companion
    patch replay, and exit closure.
15. Add terminal function summaries, terminal graph closure, yield/resume, and
    enabled extensions through typed companion requests.
16. Export checked optimization evidence: certificate bundle, packet-validation
    attestation, checked path certificate table, and checked semantic-inline
    policy table.
17. Fill out checked fact packet categories, invalidation schemas, preservation
    policies, origin mappings, and packet validation.
18. Add end-to-end integration fixtures as each domain lands; every new domain
    must include at least one success case, one must-reject case, and one
    diagnostic determinism check before the next domain is wired.

No implementation step should add runtime dependencies. Tests should use fakes
through dependency injection rather than mocks. Filesystem access stays at
compiler edges outside this phase.
