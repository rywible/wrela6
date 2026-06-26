# Proof MIR Builder Design

## Purpose

The Proof MIR builder is the compiler phase after representation/layout facts
and before proof and resource checking. It consumes the closed monomorphized HIR
for one selected image, consumes the concrete layout fact program for that same
image, and lowers source-shaped function bodies into explicit CFG blocks with
scalar SSA values where useful.

Proof MIR is the last proof-rich IR and the first CFG-shaped IR. HIR preserves
source intent. Monomorphization makes the image closed and concrete. Layout
computes target representation facts. Proof MIR then makes control flow,
values, exits, places, proof operations, obligations, validation splits,
attempt splits, terminal calls, and layout fact uses explicit enough for the
checker to run path-sensitive dataflow.

The builder does not prove the program. It constructs the representation that
the proof checker can prove. It must therefore preserve every proof-relevant
identity from mono and layout, attach source/HIR origins to all lowered
operations, make all exits explicit, and avoid destructive lowering that would
hide resource behavior from the checker.

Proof MIR should also be shaped so proof acceptance can produce a checked fact
packet for later target lowering. The builder is not an optimizer, but it must
keep stable value, place, block, call, layout, and origin identities so the
checker can later certify ownership/noalias facts, erased proof values,
validated-buffer bounds, platform primitive effects, terminal closure, concrete
layout/ABI facts, and source mappings.

In this document, "stable ID" means deterministic for the same
`MonomorphizedHirProgram` and `LayoutFactProgram`. It does not mean persistent
across source edits or incremental rebuilds.

## Contract Stability And Semantics Gates

This is a production contract. Some records are final builder obligations
because their checker judgments are already named by the current proof models:
scalar SSA, blocks/edges, calls, validation, attempts, take/session
obligations, private-state generations, terminal closure, layout-term bindings,
and validated-buffer reads.

The least-settled language features stay in this document as proof-visible
preservation contracts, but they are semantics-gated:

| Feature area                         | Builder contract status                                                                                 | Required before production lowering succeeds                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Coroutine yield/resume               | Preserve suspension/resume edges, payload operand, and frame boundary evidence                          | proof-semantics rules for yield safety, frame convergence, and fact invalidation |
| Cross-core ownership and move-rings  | Preserve operation kind, places, brands, obligations, runtime contracts, and edge effects               | mono concurrency metadata plus proof-semantics rules for transfer ownership      |
| Stream loops                         | Preserve stream session/member state as loop-carried resource evidence                                  | proof-semantics loop convergence over stream members                             |
| Runtime helper catalog breadth       | Catalog entries are closed compiler authority with schemas, ABI facts, effects, and target availability | target/runtime catalog entries for each helper actually emitted                  |
| Advanced loop convergence/invariants | Loop header names explicit boundary resources; checker owns liveness, fixed point, and invariants       | proof-semantics companion must define deterministic convergence diagnostics      |

If a reachable mono construct needs a gated feature whose proof-semantics rules
or mono metadata are not present, the builder emits a construction diagnostic
and does not return Proof MIR for that image. It must not lower the construct
as an ordinary call, erase it, or smuggle missing evidence into target lowering.

Gated records live behind explicit extension contracts. They are specified here
so upstream phases preserve the right evidence, but they are not part of the
default core lowerer, core structural validator, or core snapshot fixture set
until the corresponding proof-semantics gate and mono metadata are available.
The production builder wires an extension only through a closed registry chosen
from `BuildProofMirInput.target.features`; absent registry support is a
construction diagnostic, not a fallback lowering.

## Required Pipeline Extensions

Proof MIR is the first phase that needs several pieces of evidence that earlier
pipeline stages currently compute only partially. These are upstream contract
requirements for implementing this design:

| Owning phase                 | Required extension                                                                                                | Proof MIR dependency                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Typed HIR                    | Preserve external entry roots with reason, owner/function type arguments, and HIR origin                          | `ProofMirImage.externalRoots` and root diagnostics                          |
| Whole-image monomorphization | Add `MonomorphizedHirProgram.externalRoots` with instantiated function instance IDs and root reasons              | executable image boundary and non-entry callback roots                      |
| Whole-image monomorphization | Preserve concrete resolved call targets on every mono call expression                                             | call lowering without reconstructing monomorphic identity                   |
| Whole-image monomorphization | Preserve instantiated owner/function type arguments, or an equivalent monomorphic key, on platform contract edges | certified platform call resolution                                          |
| Whole-image monomorphization | Preserve concurrency/cross-core proof metadata before exposing reachable cross-core constructs to Proof MIR       | `ProofMirConcurrencyOperation` lowering                                     |
| Representation/layout facts  | Keep deterministic `readRequires`, derived-field case order, and layout-term arrays as layout-owned invariants    | canonical layout-term paths and validated-buffer read requirements          |
| Target/runtime selection     | Provide the selected target feature set and closed runtime catalog as explicit input                              | compiler-runtime call contracts and trusted runtime axioms                  |
| Proof-semantics companion    | Define loop convergence, yield safety, fact entailment, terminal closure, and cross-core ownership judgments      | checker acceptance rules for semantics-gated Proof MIR records              |
| Checked MIR handoff          | Define the certified fact packet schema consumed by optimization and AArch64 lowering                             | preservation of value/place/call/layout identities through proof acceptance |

The builder repeats fail-closed checks for these contracts at its boundary. It
does not compensate for missing upstream data by inspecting source syntax,
guessing from reachability, or using host/runtime state.

## Goals

- Consume one `MonomorphizedHirProgram` for the selected image.
- Consume the matching `LayoutFactProgram` computed for that same image and
  target.
- Lower each reachable source-bodied function instance to explicit Proof MIR
  blocks.
- Represent scalar runtime values and proof facts in SSA form where that
  simplifies dominance, def-use, and diagnostics.
- Keep memory, places, resources, obligations, loans, validation state, attempt
  state, private state, and session membership as explicit flow operations and
  facts rather than requiring full memory/resource SSA as the semantic model.
- Preserve source origins, HIR origins, mono instance identity, type IDs,
  resource kind IDs, obligation IDs, call-site requirement IDs, validation IDs,
  attempt IDs, borrow/session/brand IDs, private-state transition IDs, fact
  origin IDs, platform contract edge IDs, and layout fact keys.
- Normalize structured control flow into blocks, terminators, branch edges,
  joins, loop headers, loop exits, and explicit function/scope exits.
- Make ordinary returns, terminal returns, yields, breaks, continues, panic
  exits, validation splits, attempt splits, and early-error edges explicit.
- Preserve field-sensitive places as structured paths, not strings.
- Attach layout facts to validated-buffer reads, source-length uses,
  payload-end computations, ABI-sensitive calls, image-device accesses, and
  target pointer facts without recomputing layout.
- Resolve monomorphized call targets to concrete function instances or certified
  platform contract edges.
- Represent coroutine yields as suspension edges with explicit resume targets.
- Represent cross-core transfer operations, worker pinning, and move-ring
  ownership transfer as proof-visible operations rather than ordinary calls.
- Produce deterministic Proof MIR tables and deterministic diagnostics.
- Keep filesystem access, package loading, parsing, semantic checking, HIR
  lowering, monomorphization, layout computation, proof checking, optimization,
  target lowering, AArch64 code generation, linking, and PE/COFF emission
  outside this phase.

## Non-Goals

- This phase does not parse source, resolve names, typecheck source
  declarations, certify platform declarations, choose an image root, discover
  reachability, instantiate generics, or compute layout.
- This phase does not prove moves, consumes, borrows, obligations, branch
  convergence, validation convergence, attempt convergence, stale-fact
  rejection, `requires` discharge, platform primitive preconditions, terminal
  closure, or validated-buffer requirements. The proof checker owns those
  checks.
- This phase does not emit checked MIR. Checked MIR is the proof checker's
  success output.
- This phase does not erase proof-only operations. Erasure happens only after
  proof acceptance.
- This phase does not perform broad performance optimizations, inlining,
  dead-code elimination, load/store motion, wrapper elimination, aggregate
  flattening, unboxing, or target instruction selection.
- This phase does not require full memory SSA, full effect SSA, resource SSA,
  or aggregate SSA as its semantic representation. Those may exist as derived
  optimization analyses after proof acceptance.
- This phase does not lower platform primitives to target instructions,
  firmware ABI calls, generated entry thunks, or AArch64 machine IR.
- This phase does not invent or reinterpret representation facts. It references
  `LayoutFactProgram` records by stable keys.
- This phase does not give stdlib or package source special authority.
- This phase does not implement incremental or cached MIR construction.

## Repository Shape

```text
src/
  proof-mir/
    index.ts
    ids.ts
    diagnostics.ts
    model/
      program.ts
      graph.ts
      operands.ts
      effects.ts
      facts.ts
      calls.ts
      layout-bindings.ts
      origins.ts
    draft/
      draft-program.ts
      draft-keys.ts
      draft-builder-context.ts
      draft-graph-builder.ts
    lower/
      function-lowerer.ts
      expression-lowerer.ts
      statement-lowerer.ts
      control-flow-lowerer.ts
      validation-lowerer.ts
      attempt-lowerer.ts
      take-lowerer.ts
      terminal-lowerer.ts
    domains/
      graph-ssa.ts
      effects-resources.ts
      fact-recording.ts
      call-targets.ts
      layout-binding-index.ts
      origin-map.ts
    canonicalization/
      canonical-keys.ts
      canonical-order.ts
      id-assignment.ts
      program-freeze.ts
    validation/
      graph-validator.ts
      operand-validator.ts
      effect-validator.ts
      fact-validator.ts
      call-validator.ts
      layout-validator.ts
    extensions/
      yield-contract.ts
      stream-loop-contract.ts
      cross-core-contract.ts
    proof-mir-builder.ts

  runtime/
    runtime-catalog.ts
    runtime-catalog-types.ts

  target/
    target-runtime-selection.ts

tests/
  support/
    proof-mir/
      proof-mir-fakes.ts
      proof-mir-fixtures.ts

  unit/
    proof-mir/
      ids.test.ts
      diagnostics.test.ts
      graph-ssa.test.ts
      effects-resources.test.ts
      fact-recording.test.ts
      call-targets.test.ts
      layout-binding-index.test.ts
      origin-map.test.ts
      draft-keys.test.ts
      canonicalization.test.ts
      id-assignment.test.ts
      graph-validator.test.ts
      operand-validator.test.ts
      effect-validator.test.ts
      fact-validator.test.ts
      call-validator.test.ts
      layout-validator.test.ts
      function-lowerer.test.ts
      control-flow-lowerer.test.ts
      validation-lowerer.test.ts
      attempt-lowerer.test.ts
      take-lowerer.test.ts
      proof-mir-fixtures.test.ts

  integration/
    proof-mir/
      proof-mir-builder.test.ts
      cfg-shape.test.ts
      explicit-exits.test.ts
      validation-and-attempt-splits.test.ts
      resource-operation-lowering.test.ts
      layout-fact-references.test.ts
      platform-call-lowering.test.ts
      determinism.test.ts
      public-api.test.ts
```

`src/proof-mir` may depend on `src/mono`, `src/layout`, semantic ID and checked
type models, semantic resource-kind helpers, HIR origin/proof ID types already
preserved by mono, the target/runtime catalog interface type, and shared
diagnostics/source span types.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing, AST
views, name resolution, semantic surface checking internals, HIR lowering
internals, monomorphization internals, layout computation internals, proof
checkers, runtime catalog construction, target backends, AArch64 machine IR,
linkers, or PE/COFF emission.

Runtime catalog authority stays in `src/runtime` and target selection code in
`src/target`. Proof MIR consumes a closed `ProofMirRuntimeCatalog` supplied by
the caller; it does not own or populate catalog definitions.

This repository shape refines the short roadmap sketch in
`docs/design/compiler-pipeline-design.md`. The roadmap remains the end-to-end
phase map; this document defines the Proof MIR builder contract.

## Public API

Proof MIR construction is exported from `src/proof-mir/index.ts`. Once the
top-level compiler barrel exists, it should re-export this API next to
monomorphization and layout:

```ts
import { monomorphizeWholeImage } from "./src/mono";
import { computeRepresentationLayoutFacts } from "./src/layout";
import { buildProofMir } from "./src/proof-mir";

const monoResult = monomorphizeWholeImage({
  program: hirResult.program,
});

if (monoResult.kind === "ok") {
  const layoutResult = computeRepresentationLayoutFacts({
    program: monoResult.program,
    target: selectedTarget.layoutSurface,
  });

  if (layoutResult.kind === "ok") {
    const runtimeTargetContext = {
      targetId: selectedTarget.layoutSurface.targetId,
      features: selectedTarget.features,
      runtimeCatalog: selectedRuntimeCatalog,
    };

    const proofMirResult = buildProofMir({
      program: monoResult.program,
      layout: layoutResult.facts,
      target: runtimeTargetContext,
    });
  }
}
```

The phase returns success only when every reachable source-bodied function has a
structurally valid Proof MIR body and every referenced layout, call, proof, and
origin record can be resolved:

```ts
export interface BuildProofMirInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirBuildTargetContext;
}

export interface ProofMirBuildTargetContext {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
}

export type BuildProofMirResult =
  | {
      readonly kind: "ok";
      readonly mir: ProofMirProgram;
      readonly diagnostics: readonly ProofMirDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofMirDiagnostic[];
    };

export function buildProofMir(input: BuildProofMirInput): BuildProofMirResult;
```

`buildProofMir` does not combine diagnostics from earlier phases. The caller
owns diagnostic aggregation and source-order presentation. `kind: "ok"` may
include warnings or notes only. Any error diagnostic makes the result
`kind: "error"`.

The builder accumulates diagnostics across the whole reachable image. It should
attempt to lower every reachable `sourceBody` function whose required input
tables are present, even after earlier functions produce construction
diagnostics. This gives users a stable batch of Proof MIR construction errors
instead of one fail-fast error per run. The public `kind: "error"` result does
not expose a partially usable `ProofMirProgram`; diagnostics and trace records
for failed drafts are kept separately from frozen Proof MIR and must not be
passed to the proof checker.

Within a function, a construction error abandons that function's draft graph.
The builder keeps diagnostics, origin traces, and any source/HIR context needed
to report the error, then continues with later reachable functions for batch
diagnostics. It must not preserve a structurally invalid diagnostic graph, add
unreachable blocks only to keep lowering alive, synthesize a value, synthesize a
place, invent a fact, invent an edge effect, or invent a call target after the
failed node. Any function that contains a construction error is excluded from
successful output, and the whole public result is `kind: "error"`.

## Input Contract

The primary semantic input is a `MonomorphizedHirProgram`. It is already closed
over the selected image and contains concrete function instances, concrete type
instances, concrete validated-buffer instances, concrete resource kinds,
instantiated proof metadata, reachable image devices, reachable platform
primitive IDs, and origin tables.

Proof MIR requires mono to expose instantiated external roots:

```ts
export interface MonoExternalRoot {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly origin: HirOriginId;
}

export interface MonomorphizedHirProgram {
  readonly externalRoots: readonly MonoExternalRoot[];
  // existing mono tables omitted
}
```

The representation input is a `LayoutFactProgram` for the same program and
target. The `target` input is the selected runtime/target context used to
resolve closed compiler-runtime authority. The builder must verify that:

- `input.target.targetId` equals `layout.target.targetId`.
- `input.target.runtimeCatalog.targetId` equals `input.target.targetId`, and
  `input.target.runtimeCatalog.features` equals `input.target.features` in
  deterministic order.
- `layout.imageEntry.imageInstanceId` equals `program.image.instanceId`.
- `program.image.entryFunctionInstanceId` is present for an executable image
  build, and `layout.imageEntry.entryFunctionInstanceId` equals it. If the
  compiler later supports a library/no-entry Proof MIR mode, both mono and
  layout must represent that mode explicitly; the executable-image builder
  rejects a missing entry instead of treating it as a partial program.
- The set of external entry roots known to mono is preserved in
  `program.externalRoots` and is copied into `ProofMirImage.externalRoots`. The
  image entry root must match `program.image.entryFunctionInstanceId`;
  non-image-entry roots such as device handlers, hardware callbacks, and
  target-required callbacks are roots for reachability and diagnostics, not
  replacements for the image entry ABI fact. If mono does not preserve the
  instantiated external roots, the builder rejects the input; it must not infer
  root reasons from the instantiation graph alone.
- `layout.target.targetId` matches every reachable platform ABI fact and every
  target-specific image/profile fact.
- The set of source layout type keys equals the set of representable
  `program.types.entries().map(type => type.instanceId)` values. Core and
  target primitive layout keys are allowed in addition to source keys.
- Each `MonoTypeInstance.fields` entry has exactly one `LayoutFieldFact` keyed
  by the owner source layout type key plus `fieldId`.
- The set of `program.validatedBuffers` instance IDs equals the set of
  `layout.validatedBuffers` keys.
- Every validated-buffer layout and derived field referenced by mono has a
  matching field record inside its `LayoutValidatedBufferFact`.
- The set of `program.functions` instance IDs equals the set of
  `layout.functions` keys. This is an ABI-fact availability check, not a body
  lowering filter. `sourceBody` functions receive Proof MIR bodies,
  `certifiedPlatform` functions receive ABI-backed platform targets, and any
  reachable `bodylessRecovery` function is rejected before lowering even if an
  ABI fact exists for its signature.
- Monomorphization is expected to reject closed reachable images that still
  contain recovery/error bodies. The Proof MIR builder repeats that check as a
  fail-closed assertion at the phase boundary; it is not a second recovery
  mechanism and must not reinterpret `bodylessRecovery` as a valid callable
  target.
- The set of `program.proofMetadata.platformContractEdges` keys equals the set
  of `layout.platformEdges` keys.
- Every `MonoPlatformContractEdge` named by a certified platform call retains
  the instantiated owner and function type arguments, or a monomorphic edge key
  that is exactly equivalent to those arguments. The builder verifies the
  concrete `targetPlatformEdgeId` against this edge and does not re-run type
  substitution.
- The set of image device `(imageInstanceId, fieldId)` keys from
  `program.image.devices` equals the set of `layout.imageDevices` keys.
- Every layout fact that refers to a source mono instance, source field, image
  device, function instance, validated-buffer instance, or platform edge points
  back to a key present in `program`.

These table-key checks are the normative stale-input defense. If the layout
phase later adds an explicit provenance or closed-image fingerprint, the Proof
MIR builder must check that provenance first and still keep the table-key checks
as a structural guard. The builder must reject stale, partial, extra, or
mismatched layout inputs; it must not silently build Proof MIR when the layout
facts belong to a different closed image.

## Output Contract

`ProofMirProgram` is the checker-facing whole-image MIR:

```ts
export interface ProofMirProgram {
  readonly image: ProofMirImage;
  readonly functions: ProofMirFunctionTable;
  readonly layout: LayoutFactProgram;
  readonly proofMetadata: MonoProofMetadata;
  readonly origins: ProofMirOriginTable;
  readonly facts: ProofMirFactTable;
  readonly layoutTerms: ProofMirLayoutTermTable;
  readonly privateStateGenerations: ProofMirPrivateStateGenerationTable;
  readonly callGraph: ProofMirCallGraph;
  readonly platformEdges: ProofMirPlatformEdgeTable;
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
  readonly runtimeCalls: ProofMirRuntimeCallTable;
}

export interface ProofMirImage {
  readonly imageInstanceId: MonoInstanceId;
  readonly entryFunctionInstanceId: MonoInstanceId;
  readonly externalRoots: readonly ProofMirExternalRoot[];
  readonly layout: ProofMirLayoutReference & { readonly kind: "imageEntryAbi" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirExternalRoot {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly origin: ProofMirOriginId;
}

export interface ProofMirCallGraphEdge {
  readonly callId: ProofMirOwnedCallId;
  readonly target: ProofMirCallTarget;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPlatformEdge {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: PlatformPrimitiveId;
  readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  entries(): readonly Value[];
  keyOf(value: Value): ProofMirCanonicalKey;
  lookupKeyOf(key: Key): ProofMirCanonicalKey;
}

export type ProofMirCanonicalKey = string & { readonly __brand: "ProofMirCanonicalKey" };

export type ProofMirFunctionTable = ProofMirDeterministicTable<MonoInstanceId, ProofMirFunction>;
export type ProofMirFactTable = ProofMirDeterministicTable<ProofMirFactId, ProofMirFact>;
export type ProofMirLayoutTermTable = ProofMirDeterministicTable<
  ProofMirLayoutTermId,
  ProofMirLayoutTermRecord
>;
export type ProofMirPrivateStateGenerationTable = ProofMirDeterministicTable<
  ProofMirPrivateStateGenerationId,
  ProofMirPrivateStateGeneration
>;
export type ProofMirCallGraph = ProofMirDeterministicTable<
  ProofMirOwnedCallId,
  ProofMirCallGraphEdge
>;
export type ProofMirPlatformEdgeTable = ProofMirDeterministicTable<
  MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  ProofMirPlatformEdge
>;
export type ProofMirRuntimeCallTable = ProofMirDeterministicTable<
  ProofMirRuntimeCallId,
  ProofMirRuntimeCallContract
>;
export type ProofMirBlockTable = ProofMirDeterministicTable<ProofMirBlockId, ProofMirBlock>;
export type ProofMirControlEdgeTable = ProofMirDeterministicTable<
  ProofMirControlEdgeId,
  ProofMirControlEdge
>;
export type ProofMirValueTable = ProofMirDeterministicTable<ProofMirValueId, ProofMirValue>;
export type ProofMirLocalTable = ProofMirDeterministicTable<ProofMirLocalId, ProofMirLocal>;
export type ProofMirPlaceTable = ProofMirDeterministicTable<ProofMirPlaceId, ProofMirPlace>;
export type ProofMirScopeTable = ProofMirDeterministicTable<ProofMirScopeId, ProofMirScope>;
```

`ProofMirImage` is intentionally executable-image shaped. A no-entry/library
Proof MIR mode is outside this contract and must define a different image
boundary instead of using `entryFunctionInstanceId?: undefined`.

Every deterministic table must expose canonical key hooks. Tables whose keys
are structural objects, such as owned IDs, layout references, call graph keys,
and platform edge keys, use `lookupKeyOf` for query keys and `keyOf` for stored
records. Implementations must not use object identity, insertion order, or JSON
stringification as semantic equality. If two records produce the same canonical
key with different payloads, construction fails with a deterministic duplicate
diagnostic.

Each reachable source-bodied function instance receives one `ProofMirFunction`.
Certified platform functions do not receive source bodies; they appear as
platform call targets backed by `MonoPlatformContractEdge` and
`LayoutPlatformAbiFact` records.

```ts
export interface ProofMirFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly signature: MonoFunctionSignature;
  readonly entryBlockId: ProofMirBlockId;
  readonly blocks: ProofMirBlockTable;
  readonly edges: ProofMirControlEdgeTable;
  readonly values: ProofMirValueTable;
  readonly locals: ProofMirLocalTable;
  readonly places: ProofMirPlaceTable;
  readonly scopes: ProofMirScopeTable;
  readonly exits: readonly ProofMirExitEdge[];
  readonly origin: ProofMirOriginId;
}
```

The checker should be able to consume one `ProofMirFunction` without
reconstructing source-shaped control flow. It may still use whole-program
tables for call targets, platform edges, layout facts, proof metadata, terminal
call edges, and diagnostics.

Program-level tables use owned IDs whenever they refer to function-local
values, places, calls, or edges. Function-local tables may use bare dense IDs
because their owner is the enclosing `ProofMirFunction`. This keeps global
authority tables, such as facts, layout terms, runtime calls, private-state
generations, platform edges, and call graph edges, from accidentally comparing
IDs allocated by different functions.

`layoutTerms` is an intern table for every `LayoutTerm` referenced by Proof
MIR. The builder interns terms by canonical path into `LayoutFactProgram`, not
by a display name or by structural stringification. Recursive terms use the
same root plus a `childPath`, so the left child of a field-end expression and a
different field's left child cannot collide even if their arithmetic text is
identical.

Cross-table lookup rules are part of the output contract:

- `ProofMirProgram.functions.get(instanceId)` exists exactly for source-bodied
  mono functions that were lowered.
- `ProofMirProgram.layout.functions.get(instanceId)` exists for every mono
  function instance, including certified platform and `bodylessRecovery`
  signatures checked before rejection.
- Source call targets use `MonoInstanceId` to join `ProofMirFunction`,
  `LayoutFunctionAbiFact`, and mono signature records.
- Certified platform targets use `HirPlatformContractEdgeId` to join
  `MonoProofMetadata.platformContractEdges`,
  `ProofMirProgram.platformEdges`, and `LayoutPlatformAbiFact`.
- Facts, private-state generations, runtime calls, and call graph records use
  owned IDs whenever they reference function-local values, places, calls, or
  edges.
- `ProofMirImage.entryFunctionInstanceId` names the executable entry function
  instance selected by mono. If image/profile lowering needs an adapter, that
  adapter must already be represented as a monomorphized source-bodied function
  with an image origin before this phase. Proof MIR consumes the entry shape; it
  does not generate entry thunks. `ProofMirImage.externalRoots` preserves every
  instantiated external root from mono, including the entry and any callback
  roots, so terminal/root diagnostics can distinguish why a function was
  reachable.

## IDs And Deterministic Tables

Proof MIR IDs are deterministic dense values within their owner:

```ts
export type ProofMirBlockId = number & { readonly __brand: "ProofMirBlockId" };
export type ProofMirValueId = number & { readonly __brand: "ProofMirValueId" };
export type ProofMirStatementId = number & { readonly __brand: "ProofMirStatementId" };
export type ProofMirTerminatorId = number & { readonly __brand: "ProofMirTerminatorId" };
export type ProofMirCallId = number & { readonly __brand: "ProofMirCallId" };
export type ProofMirPlaceId = number & { readonly __brand: "ProofMirPlaceId" };
export type ProofMirLocalId = number & { readonly __brand: "ProofMirLocalId" };
export type ProofMirOriginId = number & { readonly __brand: "ProofMirOriginId" };
```

IDs are not compared across owners unless the key includes the function
instance:

```ts
export interface ProofMirOwnedValueId {
  readonly functionInstanceId: MonoInstanceId;
  readonly valueId: ProofMirValueId;
}

export interface ProofMirOwnedPlaceId {
  readonly functionInstanceId: MonoInstanceId;
  readonly placeId: ProofMirPlaceId;
}

export interface ProofMirOwnedCallId {
  readonly functionInstanceId: MonoInstanceId;
  readonly callId: ProofMirCallId;
}

export interface ProofMirOwnedLayoutTermBindingId {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindingId: ProofMirLayoutTermBindingId;
}

export interface ProofMirOwnedControlEdgeId {
  readonly functionInstanceId: MonoInstanceId;
  readonly edgeId: ProofMirControlEdgeId;
}
```

Supporting IDs and small references should stay explicit:

```ts
export type ProofMirExitEdgeId = number & { readonly __brand: "ProofMirExitEdgeId" };
export type ProofMirControlEdgeId = number & { readonly __brand: "ProofMirControlEdgeId" };
export type ProofMirFactId = number & { readonly __brand: "ProofMirFactId" };
export type ProofMirScopeId = number & { readonly __brand: "ProofMirScopeId" };
export type ProofMirLoanId = number & { readonly __brand: "ProofMirLoanId" };
export type ProofMirLayoutTermId = number & { readonly __brand: "ProofMirLayoutTermId" };
export type ProofMirLayoutTermBindingId = number & {
  readonly __brand: "ProofMirLayoutTermBindingId";
};
export type ProofMirPrivateStateGenerationId = number & {
  readonly __brand: "ProofMirPrivateStateGenerationId";
};
export type ProofMirRuntimeOperationId = number & {
  readonly __brand: "ProofMirRuntimeOperationId";
};
export type ProofMirRuntimeCallId = number & {
  readonly __brand: "ProofMirRuntimeCallId";
};

export interface ProofMirBlockTarget {
  readonly edgeId: ProofMirControlEdgeId;
  readonly blockId: ProofMirBlockId;
}

export interface ProofMirSwitchCase {
  readonly label: string;
  readonly target: ProofMirBlockTarget;
  readonly origin: ProofMirOriginId;
}

export type ProofMirLayoutReference =
  | { readonly kind: "type"; readonly key: LayoutTypeKey }
  | { readonly kind: "field"; readonly key: LayoutFieldKey }
  | { readonly kind: "validatedBuffer"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferField";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | { readonly kind: "imageDevice"; readonly key: LayoutImageDeviceKey }
  | {
      readonly kind: "platformAbi";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "functionAbi"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "imageEntryAbi"; readonly imageInstanceId: MonoInstanceId };

export interface ProofMirLayoutTermReference {
  readonly termId: ProofMirLayoutTermId;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
}

export interface ProofMirLayoutTermRecord {
  readonly termId: ProofMirLayoutTermId;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirLayoutTermPath {
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
}

export type ProofMirLayoutTermRoot =
  | { readonly kind: "validatedBufferSourceLength"; readonly instanceId: MonoInstanceId }
  | {
      readonly kind: "validatedBufferFieldTerm";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly slot: "offset" | "byteLength" | "elementCount" | "end" | "derivedValue";
    }
  | {
      readonly kind: "validatedBufferReadRequirement";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly requirementIndex: number;
      readonly slot: "end" | "left" | "right" | "expression";
    }
  | {
      readonly kind: "validatedBufferDerivedSource";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
    }
  | {
      readonly kind: "validatedBufferDerivedCase";
      readonly instanceId: MonoInstanceId;
      readonly fieldId: FieldId;
      readonly caseIndex: number;
      readonly slot: "conditionValue" | "result";
    };

export type ProofMirLayoutTermChild = "left" | "right";

export type ProofMirProofOnlyReason =
  | "obligation"
  | "sessionMember"
  | "brand"
  | "validationResult"
  | "validatedPacket"
  | "privateState"
  | "factToken"
  | "zeroSizedCapability";
```

Every statement, terminator, call, and control-flow edge must carry its ID in
the record that uses it:

```ts
export interface ProofMirStatement {
  readonly statementId: ProofMirStatementId;
  readonly kind: ProofMirStatementKind;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirTerminator {
  readonly terminatorId: ProofMirTerminatorId;
  readonly kind: ProofMirTerminatorKind;
  readonly outgoingEdges: readonly ProofMirControlEdgeId[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirControlEdge {
  readonly edgeId: ProofMirControlEdgeId;
  readonly fromBlockId: ProofMirBlockId;
  readonly toBlockId?: ProofMirBlockId;
  readonly kind:
    | "normal"
    | "branchTrue"
    | "branchFalse"
    | "switchCase"
    | "validationOk"
    | "validationErr"
    | "attemptSuccess"
    | "attemptError"
    | "scopeBreak"
    | "scopeContinue"
    | "yieldSuspend"
    | "yieldResume"
    | "returnExit"
    | "panicExit";
  readonly arguments: readonly ProofMirValueId[];
  readonly facts: readonly ProofMirFactId[];
  readonly effects: readonly ProofMirEdgeEffect[];
  readonly crossedScopes: readonly ProofMirScopeId[];
  readonly exit?: ProofMirExitEdgeId;
  readonly origin: ProofMirOriginId;
}

export type ProofMirEdgeEffect =
  | { readonly kind: "consumePlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "introducePlace"; readonly placeId: ProofMirPlaceId }
  | { readonly kind: "startLoan"; readonly loanId: ProofMirLoanId }
  | { readonly kind: "endLoan"; readonly loanId: ProofMirLoanId }
  | { readonly kind: "openObligation"; readonly obligation: ProofMirObligationReference }
  | { readonly kind: "dischargeObligation"; readonly obligation: ProofMirObligationReference }
  | { readonly kind: "openSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "closeSessionMember"; readonly member: ProofMirSessionMemberReference }
  | {
      readonly kind: "advancePrivateState";
      readonly from: ProofMirPrivateStateGenerationReference;
      readonly to: ProofMirPrivateStateGenerationReference;
    };
```

Tables expose deterministic `entries()` arrays. Builders must not rely on
JavaScript object enumeration order for semantic ordering. Input compatibility
checks process every `MonomorphizedHirProgram.functions.entries()` item.
Function body lowering processes only entries whose `bodyStatus` is
`sourceBody`, in that same deterministic order.

Lowerers do not allocate final dense IDs as they walk the body. They emit
canonical-keyed draft records into ownership-specific draft tables:

- graph records: scopes, blocks, parameters, statements, terminators, control
  edges, and exit edges
- SSA records: scalar values, definitions, uses, and block-parameter bindings
- place/effect records: place roots, place projections, loans, edge effects,
  obligations, sessions, and private-state generations
- fact records: normalized fact operands, evidence, requirements, candidates,
  and trusted axioms
- call records: source-function calls, certified platform calls,
  compiler-runtime calls, call graph edges, and ABI/layout references
- layout records: layout-term paths, term/value bindings, and validated-buffer
  read references
- origin records: reused source origins and synthetic origins

Every draft record has a `ProofMirCanonicalKey` derived only from mono IDs,
layout keys, source/HIR origins, structural role, and canonical keys of records
it references. A key must not contain a final Proof MIR dense ID, JavaScript
object identity, insertion index, host path, or source text spelling that was
not preserved by mono/layout as authority. Duplicate draft records with the
same canonical key must be byte-for-byte equivalent after normalization or
produce a construction diagnostic.

After all reachable functions have either produced complete drafts or failed,
a single canonicalization pass freezes the program:

1. validate that every draft reference resolves by canonical key
2. sort each table by table-owned canonical key
3. assign dense `ProofMir*Id` values in that sorted order
4. rewrite draft references from canonical keys to dense IDs
5. run local structural validation on the frozen graph

This pass, not helper call order, defines snapshot stability. A refactor that
splits or merges lowering helpers must not change IDs unless it changes
canonical graph content.

## Origins

Proof MIR origin records are side tables, not runtime data:

```ts
export interface ProofMirOrigin {
  readonly originId: ProofMirOriginId;
  readonly owner: ProofMirOriginOwner;
  readonly sourceOrigin?: HirOriginId;
  readonly diagnosticOrigin?: string;
  readonly monoExpressionId?: MonoExpressionId;
  readonly monoStatementId?: MonoStatementId;
  readonly monoLocalId?: MonoLocalId;
  readonly monoProofId?:
    | MonoInstantiatedProofId<ObligationId>
    | MonoInstantiatedProofId<SessionId>
    | MonoInstantiatedProofId<BrandId>
    | MonoInstantiatedProofId<ValidationId>
    | MonoInstantiatedProofId<AttemptId>
    | MonoInstantiatedProofId<PrivateStateTransitionId>
    | MonoInstantiatedProofId<FactOriginId>
    | MonoInstantiatedProofId<CallSiteRequirementId>
    | MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly layoutKey?: ProofMirLayoutReference;
  readonly note?: string;
}

export type ProofMirOriginOwner =
  | { readonly kind: "function"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "image"; readonly imageInstanceId: MonoInstanceId }
  | {
      readonly kind: "platform";
      readonly edgeId?: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId?: PlatformPrimitiveId;
    }
  | { readonly kind: "runtimeCatalog"; readonly runtimeId?: ProofMirRuntimeOperationId }
  | { readonly kind: "program" };
```

Every block, statement, terminator, value, place, call, resource operation, fact
operation, and exit edge must carry an origin. Synthetic operations inherit the
nearest proof-relevant source origin and add a stable note such as
`if.join`, `while.condition`, `validation.ok`, `attempt.error`, or
`take.exit`.

Diagnostics should be produced from origins. The builder must not reverse-map a
MIR node to source by walking syntax or HIR internals.

`sourceOrigin` is the canonical bridge back into `program.origins` when the
origin came from HIR. `diagnosticOrigin` is display-only text carried for
layout facts, platform catalogs, generated runtime entries, or legacy mono
records that do not have a `HirOriginId`. The checker and diagnostics must not
parse `diagnosticOrigin` as authority.

## CFG Model

Proof MIR uses explicit blocks and terminators. No block falls through.

```ts
export interface ProofMirBlock {
  readonly blockId: ProofMirBlockId;
  readonly scopeId: ProofMirScopeId;
  readonly parameters: readonly ProofMirBlockParameter[];
  readonly statements: readonly ProofMirStatement[];
  readonly terminator: ProofMirTerminator;
  readonly incomingEdges: readonly ProofMirControlEdgeId[];
  readonly stateMerge?: ProofMirBlockStateMerge;
  readonly origin: ProofMirOriginId;
}

export type ProofMirBlockStateMerge = {
  readonly kind: "loopHeader";
  readonly loopScopeId: ProofMirScopeId;
  readonly boundaryResources: ProofMirResourceBoundarySet;
  readonly origin: ProofMirOriginId;
};

export interface ProofMirResourceBoundarySet {
  readonly places: readonly ProofMirPlaceId[];
  readonly loans: readonly ProofMirLoanId[];
  readonly obligations: readonly ProofMirObligationReference[];
  readonly sessionMembers: readonly ProofMirSessionMemberReference[];
  readonly privateStateGenerations: readonly ProofMirPrivateStateGenerationReference[];
}
```

Block parameters represent scalar SSA joins. A branch that defines different
scalar values along different paths passes arguments on the corresponding
`ProofMirControlEdge.arguments` array. `ProofMirBlockTarget` names the edge and
target block only; edge arguments are the single canonical source of join
arguments. Proof MIR uses block parameters instead of explicit phi instructions
because they make CFG edges and join values local to control edges.

```ts
export interface ProofMirBlockParameter {
  readonly valueId: ProofMirValueId;
  readonly type: MonoCheckedType;
  readonly parameterKind: ProofMirBlockParameterKind;
  readonly origin: ProofMirOriginId;
}

export type ProofMirBlockParameterKind =
  | { readonly kind: "copyScalar"; readonly resourceKind: ConcreteResourceKind }
  | { readonly kind: "proofFact"; readonly factId?: ProofMirFactId };
```

Block parameters are for scalar runtime values and proof facts. They must not
carry affine, linear, unique, session-bound, loan-bound, private-state, or
capability-bearing values. Resource state is not joined through block
parameters. The checker computes resource-state convergence from explicit
resource operations on predecessor paths and edge effects. Joins require the
checker's canonical proof/resource state equivalence, which may be exact
equality when no richer equivalence is defined.

For `copyScalar` parameters, `resourceKind` is descriptive type information
and must classify as copy or never. It is not permission to carry resource
state through a block parameter.

## Values And SSA Policy

Proof MIR values describe scalar runtime values, zero-sized proof values when
needed for identity, and fact tokens used by the checker.

```ts
export interface ProofMirValue {
  readonly valueId: ProofMirValueId;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly representation: ProofMirValueRepresentation;
  readonly origin: ProofMirOriginId;
}

export type ProofMirValueRepresentation =
  | { readonly kind: "runtime"; readonly layoutType?: LayoutTypeKey }
  | { readonly kind: "proofOnly"; readonly reason: ProofMirProofOnlyReason }
  | { readonly kind: "fact"; readonly factId: ProofMirFactId }
  | { readonly kind: "never" };
```

`resourceKind` must agree with the value representation:

| Representation | Allowed resource kind                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| `runtime`      | any concrete kind allowed by the value's `MonoCheckedType`                             |
| `proofOnly`    | proof-only, zero-sized capability, obligation, session, brand, or private-state marker |
| `fact`         | proof-only fact token kind                                                             |
| `never`        | `Never`                                                                                |

The structural validator rejects nonsensical combinations, such as a `fact`
value carrying an affine runtime resource kind or a `never` value with a copy
integer kind.

Scalar values have a single definition. Block parameters count as definitions.
The builder rejects any lowering that would define a scalar value twice.

Memory, places, resources, loans, obligations, private-state generations,
validation packets, session members, and platform capabilities are not required
to be in full SSA. They are represented as explicit operations over
structured places and proof IDs. The proof checker turns those flows into
accepted/rejected state transitions and, on success, certified fact tables.

This gives the optimizer scalar SSA, dominance, def-use, and block arguments
without forcing every proof resource into a single huge SSA model.

## SSA Construction Algorithm

The builder uses sealed-block SSA for scalar locals and fact tokens:

1. Pre-scan the mono body to classify locals, discover address-taken and
   borrow-taking sites, record assignments, and identify loop-carried mutable
   scalar locals.
2. Create the entry block sealed. Copy scalar parameters that are read as
   scalar values get entry block parameters in signature order. Parameters that
   are non-copy, address-taken, borrowed, consumed, projected, debug-storage
   backed, or otherwise place-relevant get entry place roots instead of scalar
   block parameters. A parameter may have both a place root and a loaded SSA
   value only when the value is produced by an explicit `load` statement.
3. For each block, maintain a `currentDefinition` map from scalar local ID or
   fact key to the current `ProofMirValueId`.
4. Writing an SSA local allocates a fresh value ID and replaces the current
   definition in the current block. The previous value is never redefined.
5. Reading an SSA local first checks the current block. If no local definition
   exists, the builder recursively reads the value from predecessors.
6. If a block is unsealed because not all predecessors are known, the read
   creates an incomplete block parameter and records the local/fact key as
   pending. When the block is sealed, every predecessor edge receives one
   argument for that parameter.
7. If a sealed block has one predecessor, the read reuses that predecessor's
   value without creating a parameter. If it has multiple predecessors and all
   incoming values are the same value ID from the same owner, the read reuses
   that value. Otherwise the builder creates a block parameter and records the
   incoming values on the predecessor edges.
8. Loop headers are created before lowering the loop body. The pre-scan marks
   loop-carried scalar locals; the header receives deterministic parameters for
   those locals before the body back-edge is lowered. These predeclared
   loop-header parameters are registered in the block's `currentDefinition`
   map before any read from the unsealed header. The on-demand incomplete
   parameter algorithm must not create a second parameter for those same
   locals. The entry-to-header edge carries the pre-loop values, and each
   back-edge carries the loop-body values.
9. When a branch, switch, validation match, attempt match, loop back-edge, or
   scope exit targets a block with parameters, the builder writes arguments to
   `ProofMirControlEdge.arguments`. `ProofMirBlockTarget` must not duplicate
   them.
10. After sealing all blocks, there must be no incomplete parameters, no
    missing edge arguments, and no duplicate scalar definitions. Failure is a
    construction diagnostic, not a silent repair.

The algorithm is allowed to omit a block parameter only when the same owned
value reaches every predecessor. It must not omit a parameter because two
different values are textually equivalent; equivalence belongs to the checker or
later optimization passes.

Block parameter ordering is canonical. Function entry parameters follow
signature order. Predeclared loop-header parameters follow ascending
`MonoLocalId`, then fact-key order when fact parameters are needed. On-demand
parameters are appended in first-read order within deterministic lowering
order. A predeclared loop parameter always wins over an on-demand parameter for
the same local/fact key.

## Locals, Values, And Place-Backed Storage

The builder classifies each mono local before lowering its body:

```ts
export type ProofMirLocalStorage =
  | { readonly kind: "scalarSsa"; readonly currentValue?: ProofMirValueId }
  | { readonly kind: "placeBacked"; readonly placeId: ProofMirPlaceId };

export interface ProofMirLocal {
  readonly localId: ProofMirLocalId;
  readonly monoLocalId: MonoLocalId;
  readonly storage: ProofMirLocalStorage;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly origin: ProofMirOriginId;
}
```

Classification is a pre-lowering analysis over the mono body index:

1. Walk every expression, statement, place, validation, attempt, take, call, and
   loop body in deterministic body-index order.
2. For each local, collect its declared resource kind, assignment sites,
   mutation sites, read sites, branch-assigned sites, loop-assigned sites,
   loop-read-after-write sites, place projections, borrow sites, call
   consume/observe modes, validation/attempt input uses, and debug-visible
   storage requirements.
3. Mark a local address-taken when it is borrowed, projected through a field or
   dereference, used as a place operand, captured by a proof/resource operation,
   passed to a consume parameter by place, or required as a stable debug
   storage location.
4. Mark a scalar local loop-carried when a loop body can assign it and a later
   use can observe the assigned value on either the loop back-edge or a loop
   exit. Structured loops compute this by a fixed-point over the loop body and
   exits, not by source text order alone.
5. Mark a local branch-joined when multiple predecessors can reach a join with
   different current scalar definitions.
6. Apply the storage rules below. If two rules conflict, choose the more
   explicit storage form in this order: `placeBacked`, then `scalarSsa`.

The classification rules are deterministic:

- Copy scalar locals that are never assigned after initialization and never
  borrowed are `scalarSsa`.
- Mutable copy scalar locals are `scalarSsa` when all updates can be represented
  by new SSA values and block parameters.
- Copy scalar locals that require an address, field projection, borrow,
  place-mode call argument, or debug-visible stable storage are `placeBacked`.
  The builder may still emit `load` statements to create temporary SSA values
  from those places for scalar computation, but the local's authority remains
  the place.
- Non-copy, affine, linear, unique, session-bound, private-state, capability,
  validated-buffer, aggregate-with-resource, and address-taken locals are
  `placeBacked`.
- Object expressions that produce proof-relevant, aggregate, borrowed, or
  field-updated values allocate a place. Pure copy scalar object fragments may
  remain SSA values until they are stored.
- Assignments to SSA locals create a new current SSA value. Assignments to
  place-backed locals emit `store` operations when the source is copy/proof-only
  or explicit move/consume operations when the assignment transfers a
  proof-relevant resource.
- Branch joins create block parameters only for copy scalar SSA values.
  Place-backed and proof/resource locals are joined by checker state over
  explicit operations and edge effects.
- Loop-carried mutable scalar values are represented as loop-header block
  parameters. Loop-carried resource state is named by the loop header's
  `ProofMirResourceBoundarySet`, represented by explicit operations plus
  checker convergence, never by resource block parameters.

If these rules cannot classify a local without hiding proof-relevant behavior,
the builder emits a construction diagnostic instead of choosing an implicit
lowering.

The pre-scan and lowerer must share the same mono body visitor and desugaring
coverage. If lowering discovers a borrow, place projection, consume-by-place
argument, debug-storage requirement, or proof/resource capture that the
pre-scan did not classify, lowering fails with a construction diagnostic. The
builder must not rewrite an already-classified `scalarSsa` local into
`placeBacked` midway through lowering because that would make ID allocation and
SSA shape depend on late discovery.

The builder is not a mem2reg pass. Address-taken copy scalars stay
place-backed in Proof MIR, even when a later optimizer could promote them. A
post-check optimization pass may derive full scalar promotion, memory SSA, or
load/store forwarding from checked MIR and certified alias facts.

## Loop Header State Merge

A loop header is a proof-state merge point. Scalar loop-carried values are
named by block parameters; resource and proof-state items are named by the
header's `ProofMirResourceBoundarySet`.

The boundary set contains explicit places, loans, obligations, session members,
and private-state generations that source/mono structure says may be observed
at the loop header, the loop back-edge, or a loop exit. It is not a liveness
solution, not a closure proof, and not a hidden transfer. It is the finite
named domain over which the checker or a shared checker-owned analysis derives
path liveness, convergence, widening, and invariant diagnostics.

Boundary-set construction is syntactic and metadata-driven:

1. Include resources opened before the loop and named by the loop condition,
   loop body, explicit back-edge effects, explicit exit effects, or source/mono
   loop metadata.
2. Include resources opened inside the loop only when an explicit operation,
   edge effect, or mono proof record can carry them to the header, a back-edge,
   or an exit.
3. Do not remove an item because a close appears on some paths. The checker
   computes path-sensitive availability and reports illegal crossing or missing
   closure.
4. Sort each set by canonical key before dense ID assignment. After
   canonicalization, frozen programs expose the corresponding dense-ID order.

A loop header with resource-relevant operations crossing the header must carry
`stateMerge.kind === "loopHeader"` and a complete boundary set for the
structural records that name those resources. Completeness here means reference
completeness, not proof liveness: every resource mentioned by a loop-owned
operation or edge resolves through the header domain the checker will analyze.

## Scope Tree, Loans, And Lifetime Boundaries

The builder allocates a lexical/control scope tree before or during structured
CFG lowering. Scope IDs are deterministic preorder IDs within a function:

```ts
export interface ProofMirScope {
  readonly scopeId: ProofMirScopeId;
  readonly parentScopeId?: ProofMirScopeId;
  readonly kind:
    | "function"
    | "block"
    | "loop"
    | "matchArm"
    | "validationArm"
    | "attemptArm"
    | "take"
    | "suspendResume";
  readonly ownedLocals: readonly MonoLocalId[];
  readonly openedObligations: readonly ProofMirObligationReference[];
  readonly openedSessionMembers: readonly ProofMirSessionMemberReference[];
  readonly origin: ProofMirOriginId;
}
```

- the function body owns the root scope
- each block expression, loop body, match arm, validation arm, attempt arm, and
  take body gets a child scope when it can own locals, loans, obligations, or
  session members
- every block records the `scopeId` it executes in. Synthetic join, continue,
  exit, suspend, and resume blocks point back to the nearest source scope they
  serve.
- each scope records its parent, source origin, owned local IDs, and proof
  resources opened directly inside it

Every control edge records `crossedScopes` as the ordered list of scopes left
by that edge. The algorithm is:

1. Build the source stack from the terminator block's `scopeId` through parent
   scopes up to the function root.
2. Build the target stack from the target block's `scopeId`, or from the exit
   boundary target scope for exit edges, up to the function root.
3. Remove the common suffix ending at the nearest shared ancestor.
4. `crossedScopes` is the remaining source stack in innermost-to-outermost
   order.

The list is computed from block scope IDs, not guessed from the terminator
kind. Draft edges may reference source and target scopes by canonical key. The
canonicalization pass resolves those keys, computes `crossedScopes`, and freezes
the dense scope IDs. `break`, `continue`, loop back-edge, join, validation,
attempt, suspend, and resume edges therefore do not require target block
allocation to happen before the source lowerer emits the draft edge.

Loan IDs are allocated at `borrowPlace` statements. A loan records its place,
mode, owning scope, start origin, and optional explicit release origin. If a
loan has no explicit `releaseLoan` before an edge crosses the loan's owning
scope, the builder does not synthesize a release. It records an exit closure
requirement so the checker can prove the path is legal or report the live loan.

Obligations and session members use the same scope boundary discipline. The
builder may emit explicit close/discharge statements only at HIR/mono metadata
sites that authorize the close. It must not silently close a resource simply
because a lexical scope ends.

## Places

Places are structured paths through resource-bearing storage:

```ts
export interface ProofMirPlace {
  readonly placeId: ProofMirPlaceId;
  readonly monoPlace?: MonoResourcePlace;
  readonly root: ProofMirPlaceRoot;
  readonly projection: readonly ProofMirPlaceProjection[];
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly layout?: ProofMirPlaceLayout;
  readonly origin: ProofMirOriginId;
}
```

```ts
export type ProofMirPlaceRoot =
  | MonoPlaceRoot
  | { readonly kind: "blockParameter"; readonly valueId: ProofMirValueId }
  | { readonly kind: "runtimeTemporary"; readonly valueId: ProofMirValueId };

export type ProofMirPlaceProjection =
  | MonoPlaceProjection
  | {
      readonly kind: "validatedPacketPayload";
      readonly validationId: MonoInstantiatedProofId<ValidationId>;
    }
  | { readonly kind: "imageDevice"; readonly fieldId: FieldId };

export interface ProofMirPlaceLayout {
  readonly type?: ProofMirLayoutReference & { readonly kind: "type" };
  readonly field?: ProofMirLayoutReference & { readonly kind: "field" };
  readonly imageDevice?: ProofMirLayoutReference;
}
```

The builder must preserve field-sensitive paths:

```text
self
self.rx
self.tx
packet.payload
image.boot_services
validation.ok.payload
```

It must not stringify places as canonical authority. It may compute canonical
keys for deterministic tables, but the checker consumes the structured path.

Place projections support fields, dereference, validation payload, enum
variant, image device roots, and deeper nested paths. Checker implementations
may choose conservative rules for rare path forms, but the IR must preserve the
full structured path.

## Statements

Proof MIR statements are non-terminating operations. They may define values,
emit proof/resource operations, attach facts, or call non-terminal functions.

```ts
export type ProofMirConsumeReason =
  | "move"
  | "callArgument"
  | "return"
  | "validationOk"
  | "attemptSuccess"
  | "terminalDischarge";

export interface ProofMirLoanReference {
  readonly loanId: ProofMirLoanId;
  readonly mode: "shared" | "exclusive";
  readonly placeId: ProofMirPlaceId;
  readonly scopeId: ProofMirScopeId;
  readonly startOrigin: ProofMirOriginId;
  readonly endOrigin?: ProofMirOriginId;
}

export interface ProofMirSessionMemberReference {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly obligationId?: MonoInstantiatedProofId<ObligationId>;
  readonly placeId?: ProofMirPlaceId;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirObligationReference {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateTransitionReference {
  readonly transitionId: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirPrivateStateGenerationReference {
  readonly generationId: ProofMirPrivateStateGenerationId;
  readonly place: ProofMirOwnedPlaceId;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirValidationStart {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly sourcePlace: ProofMirPlaceId;
  readonly pendingResultPlace: ProofMirPlaceId;
  readonly okPacketPlace: ProofMirPlaceId;
  readonly okPayloadPlace?: ProofMirPlaceId;
  readonly errPayloadPlace?: ProofMirPlaceId;
  readonly okPayloadType: MonoCheckedType;
  readonly errPayloadType: MonoCheckedType;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly layout: ProofMirLayoutReference & { readonly kind: "validatedBuffer" };
  readonly origin: ProofMirOriginId;
}

export interface ProofMirLayoutTermBinding {
  readonly bindingId: ProofMirLayoutTermBindingId;
  readonly term: ProofMirLayoutTermReference;
  readonly value: ProofMirValueId;
  readonly sourcePlace?: ProofMirPlaceId;
  readonly origin: ProofMirOriginId;
}

export type ProofMirValueOperand = { readonly kind: "value"; readonly value: ProofMirValueId };

export type ProofMirPlaceOperand = { readonly kind: "place"; readonly place: ProofMirPlaceId };

export type ProofMirValueAndPlaceOperand = {
  readonly kind: "valueAndPlace";
  readonly value: ProofMirValueId;
  readonly place: ProofMirPlaceId;
};

export type ProofMirObservedOperand =
  | ProofMirValueOperand
  | ProofMirPlaceOperand
  | ProofMirValueAndPlaceOperand;

export type ProofMirConsumedOperand = ProofMirPlaceOperand | ProofMirValueAndPlaceOperand;

export type ProofMirProducedOperand =
  | ProofMirValueOperand
  | ProofMirPlaceOperand
  | ProofMirValueAndPlaceOperand;

export type ProofMirReturnOperand =
  | { readonly mode: "observe"; readonly operand: ProofMirObservedOperand }
  | { readonly mode: "consume"; readonly operand: ProofMirConsumedOperand };

export interface ProofMirAttemptOperand {
  readonly expressionId: MonoExpressionId;
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptAlternative {
  readonly expressionId: MonoExpressionId;
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptStart {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly fallible: ProofMirAttemptOperand;
  readonly alternative?: ProofMirAttemptAlternative;
  readonly pendingResultPlace: ProofMirPlaceId;
  readonly inputPlaces: readonly ProofMirPlaceId[];
  readonly origin: ProofMirOriginId;
}

export type ProofMirCallReceiver =
  | {
      readonly mode: "observe";
      readonly operand: ProofMirObservedOperand;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly mode: "consume";
      readonly operand: ProofMirConsumedOperand;
      readonly origin: ProofMirOriginId;
    };

export type ProofMirCallArgument =
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "observe";
      readonly operand: ProofMirObservedOperand;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly parameterId?: ParameterId;
      readonly mode: "consume";
      readonly operand: ProofMirConsumedOperand;
      readonly origin: ProofMirOriginId;
    };

export interface ProofMirCall {
  readonly callId: ProofMirCallId;
  readonly target: ProofMirCallTarget;
  readonly receiver?: ProofMirCallReceiver;
  readonly arguments: readonly ProofMirCallArgument[];
  readonly requirements: readonly MonoInstantiatedProofId<CallSiteRequirementId>[];
  readonly result?: ProofMirProducedOperand;
  readonly origin: ProofMirOriginId;
}

export type ProofMirUnaryOperator = "logicalNot" | "numericNegate" | "bitwiseNot";

export type ProofMirBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "remainder"
  | "bitwiseAnd"
  | "bitwiseOr"
  | "bitwiseXor"
  | "shiftLeft"
  | "shiftRight";

export type ProofMirComparisonOperator = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type ProofMirStatementKind =
  | { readonly kind: "load"; readonly place: ProofMirPlaceId; readonly result: ProofMirValueId }
  | { readonly kind: "store"; readonly place: ProofMirPlaceId; readonly value: ProofMirValueId }
  | {
      readonly kind: "movePlace";
      readonly place: ProofMirPlaceId;
      readonly result?: ProofMirValueId;
    }
  | {
      readonly kind: "consumePlace";
      readonly place: ProofMirPlaceId;
      readonly reason: ProofMirConsumeReason;
    }
  | {
      readonly kind: "borrowPlace";
      readonly place: ProofMirPlaceId;
      readonly loan: ProofMirLoanReference;
    }
  | { readonly kind: "releaseLoan"; readonly loan: ProofMirLoanReference }
  | {
      readonly kind: "literal";
      readonly value: ProofMirValueId;
      readonly literal: MonoLiteralValue;
    }
  | {
      readonly kind: "unary";
      readonly operator: ProofMirUnaryOperator;
      readonly operand: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | {
      readonly kind: "binary";
      readonly operator: ProofMirBinaryOperator;
      readonly left: ProofMirValueId;
      readonly right: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | {
      readonly kind: "comparison";
      readonly operator: ProofMirComparisonOperator;
      readonly left: ProofMirValueId;
      readonly right: ProofMirValueId;
      readonly result: ProofMirValueId;
    }
  | { readonly kind: "call"; readonly call: ProofMirCall }
  | { readonly kind: "validate"; readonly validation: ProofMirValidationStart }
  | { readonly kind: "attempt"; readonly attempt: ProofMirAttemptStart }
  | { readonly kind: "openSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "closeSessionMember"; readonly member: ProofMirSessionMemberReference }
  | { readonly kind: "openObligation"; readonly obligation: ProofMirObligationReference }
  | {
      readonly kind: "dischargeObligation";
      readonly obligation: ProofMirObligationReference;
      readonly evidence?: ProofMirFactId;
    }
  | {
      readonly kind: "advancePrivateState";
      readonly transition: ProofMirPrivateStateTransitionReference;
    }
  | { readonly kind: "bindLayoutTerm"; readonly binding: ProofMirLayoutTermBinding }
  | { readonly kind: "recordFactEvidence"; readonly factId: ProofMirFactId }
  | { readonly kind: "requireFact"; readonly factId: ProofMirFactId }
  | { readonly kind: "readValidatedBufferField"; readonly read: ProofMirValidatedBufferRead }
  | { readonly kind: "extension"; readonly extension: ProofMirStatementExtension };

export type ProofMirStatementExtension = {
  readonly gate: "crossCoreOwnership";
  readonly kind: "concurrency";
  readonly operation: ProofMirConcurrencyOperation;
};
```

The exact union can be split across files during implementation. The contract
is that proof-relevant operations remain distinct until the checker accepts
them. For example, validation does not become an ordinary `Result`, attempt
does not become an ordinary branch over a copied value, and platform primitive
calls do not become arbitrary calls without their catalog-owned contract edge.

Statement state effects are structural, not proof judgments:

- `load` reads from a place into a fresh SSA value. It is valid only for copy or
  proof-only readable places; moving from a place uses `movePlace`.
- `store` is the only value-to-place write. It writes a copy/proof-only value
  or initializes a newly allocated place. It must not overwrite a live
  proof-relevant resource unless an earlier explicit operation on the same path
  made that resource unavailable or discharged it. It does not prove alias
  safety or permission to write; the checker proves those from loans/resources.
- `movePlace` records a move out of a place. The checker derives path
  availability from that operation and later introductions.
- `consumePlace` records deliberate consumption for moves, calls, returns,
  validation ok paths, attempt success paths, or terminal discharge.
- `borrowPlace` starts a loan with stable loan ID and mode; `releaseLoan` ends
  that loan at an explicit program point.
- A `call` evaluates receiver and arguments into operation-specific operand
  roles. Observe operands may be value-only or place-backed. Consume operands
  are place-backed at the type boundary, so a consuming call cannot be formed
  from a value-only operand.

Operation-specific operand roles prevent a generic `value | place |
valueAndPlace` cross-product from leaking through the whole builder. Producers
may create values, places, or value/place pairs. Observers may read any
available produced operand. Consumers must carry a place-backed operand at the
type boundary, so consuming APIs cannot accept a value-only operand and rely on
later validation to rediscover the error.

These effects give the checker a graph to analyze. The builder records the
operation, operand roles, and explicit structural transitions, but it does not
prove that a load, store, move, borrow, consume, or call is legal.

Edge effects are emitted only for source constructs whose transition is owned
by the edge itself: validation ok/err splits, attempt success/error splits,
scope transfers, terminal returns, panic exits, yield/resume, iterator protocol
edges, and trusted platform/runtime operations whose contract creates an
edge-local transition. A plain `movePlace` or `store` inside one branch remains
a statement in that branch; the builder must not duplicate it as a successor
edge effect by running resource dataflow. The builder may reject purely local
structural contradictions, such as two definitions for the same draft value key
or a consume operand without a place-backed role. It must not run
path-sensitive resource availability, closure, or convergence analysis to make
the graph appear checked.

Normative effect placement:

| Source transition                 | Statement effects                                                              | Edge effects                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Plain local assignment            | `store`, or explicit `movePlace`/`consumePlace` for resource transfer          | none unless the assignment is inside a larger edge-owned transition                               |
| Call argument consume             | call argument mode plus `consumePlace` when the source place is consumed       | none for ordinary calls                                                                           |
| Return with resource payload      | return operand plus any explicit `consumePlace` needed by source/mono metadata | `returnExit` edge records function boundary and closure policy                                    |
| Validation ok                     | `validate` statement creates pending/result places                             | consume pending result, consume source, introduce ok packet/payload                               |
| Validation err                    | `validate` statement creates pending/result places                             | consume pending result, introduce err payload when materialized, preserve source                  |
| Attempt success                   | `attempt` statement creates pending result and records input places            | consume pending result plus any source-declared success consumes/introductions/transfers          |
| Attempt error                     | `attempt` statement creates pending result and records input places            | consume pending result plus any explicit source-declared error carries/returns/discharges         |
| `take` body exit                  | explicit open/close/discharge statements where mono metadata authorizes them   | crossed scopes and allowed transfers for the exit path                                            |
| Loop back-edge                    | body statements record ordinary operations                                     | edge arguments for scalar loop-carried values; resource state is named by the loop boundary set   |
| Iterator item/finished/error edge | protocol call or runtime call is a statement                                   | introduce item/obligation, close/finish requirement, or attempt-style error effects               |
| Yield suspend/resume              | `yield` terminator owns the suspension                                         | suspend edge leaves the slice; resume edge carries resume-local facts and frame-state convergence |
| Panic                             | `panic` terminator owns the abort                                              | `panicExit` edge records abort boundary and panic closure requirements                            |
| Platform/runtime contract effect  | call statement owns the call and instantiated contract                         | only edge-local effects declared by the contract; no ad hoc effects inferred from function names  |

## Terminators And Exit Edges

Every block has one terminator:

```ts
export type ProofMirUnreachableReason = "afterNever" | "emptyMatch" | "unreachableSource";

export interface ProofMirValidationMatch {
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly okTarget: ProofMirBlockTarget;
  readonly errTarget: ProofMirBlockTarget;
  readonly okBindings: readonly ProofMirValidationArmBinding[];
  readonly errBindings: readonly ProofMirValidationArmBinding[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirValidationArmBinding {
  readonly monoLocalId?: MonoLocalId;
  readonly bindingKind: "packet" | "payload" | "error";
  readonly operand: ProofMirProducedOperand;
  readonly type: MonoCheckedType;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirAttemptMatch {
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
  readonly successTarget: ProofMirBlockTarget;
  readonly errorTarget: ProofMirBlockTarget;
  readonly inputPlaces: readonly ProofMirPlaceId[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirYieldSuspension {
  readonly payload?: ProofMirReturnOperand;
  readonly suspendEdge: ProofMirControlEdgeId;
  readonly resumeTarget: ProofMirBlockTarget;
  readonly frameBoundary: ProofMirYieldFrameBoundary;
  readonly origin: ProofMirOriginId;
}

export interface ProofMirYieldFrameBoundary extends ProofMirResourceBoundarySet {
  readonly values: readonly ProofMirValueId[];
}

export type ProofMirCoreTerminatorKind =
  | { readonly kind: "goto"; readonly target: ProofMirBlockTarget }
  | {
      readonly kind: "branch";
      readonly condition: ProofMirValueId;
      readonly whenTrue: ProofMirBlockTarget;
      readonly whenFalse: ProofMirBlockTarget;
    }
  | {
      readonly kind: "switch";
      readonly scrutinee: ProofMirValueId;
      readonly cases: readonly ProofMirSwitchCase[];
      readonly fallback?: ProofMirBlockTarget;
    }
  | { readonly kind: "matchValidation"; readonly match: ProofMirValidationMatch }
  | { readonly kind: "matchAttempt"; readonly match: ProofMirAttemptMatch }
  | {
      readonly kind: "return";
      readonly value?: ProofMirReturnOperand;
      readonly edgeId: ProofMirControlEdgeId;
      readonly exit: ProofMirExitEdgeId;
    }
  | {
      readonly kind: "panic";
      readonly reason?: ProofMirValueId;
      readonly edgeId: ProofMirControlEdgeId;
      readonly exit: ProofMirExitEdgeId;
    }
  | { readonly kind: "unreachable"; readonly reason: ProofMirUnreachableReason };

export type ProofMirTerminatorKind =
  | ProofMirCoreTerminatorKind
  | {
      readonly gate: "coroutineYield";
      readonly kind: "yield";
      readonly suspension: ProofMirYieldSuspension;
    };
```

`break` and `continue` usually lower to `goto` terminators targeting explicit
loop exit or loop continue blocks. Their `ProofMirBlockTarget.edgeId` points to
a `ProofMirControlEdge` whose kind and `crossedScopes` record the scope exit.
Branch facts and validation/attempt edge effects live on these edge records,
not on destination blocks, so a join can receive different facts from different
predecessors without ambiguity. A terminal source return lowers to a `return`
terminator whose exit edge is marked `terminalReturn`. A coroutine yield lowers
to a `yield` terminator with one `yieldSuspend` edge that leaves the current
execution slice and one `yieldResume` edge, through `resumeTarget.edgeId`, that
re-enters the CFG when the scheduler resumes the function.

A `switch` omits `fallback` only when mono records the match as exhaustive for
the scrutinee type. If mono does not carry exhaustiveness evidence, the builder
must emit a fallback edge to an explicit diagnostic/unreachable block or reject
the construct as unlowerable. The builder must not infer enum exhaustiveness
from source syntax or from the current set of cases.

```ts
export interface ProofMirExitEdge {
  readonly exitId: ProofMirExitEdgeId;
  readonly fromBlockId: ProofMirBlockId;
  readonly kind:
    | "ordinaryReturn"
    | "terminalReturn"
    | "panic"
    | "scopeBreak"
    | "scopeContinue"
    | "attemptError"
    | "validationReject";
  readonly boundary: ProofMirExitBoundary;
  readonly crossedScopes: readonly ProofMirScopeId[];
  readonly closure: ProofMirExitClosurePolicy;
  readonly origin: ProofMirOriginId;
}

export type ProofMirExitBoundary =
  | { readonly kind: "function"; readonly unwind: "none" | "abortNoUnwind" }
  | { readonly kind: "scope"; readonly targetScopeId: ProofMirScopeId };

export type ProofMirExitClosurePolicy =
  | {
      readonly kind: "functionExit";
      readonly requireNoLiveLoans: true;
      readonly requireNoOpenObligations: true;
      readonly requireNoLiveSessionMembers: true;
      readonly requireNoPendingValidationResults: true;
      readonly terminalReachability: "required" | "notRequired";
    }
  | {
      readonly kind: "scopeExit";
      readonly checkedScopes: readonly ProofMirScopeId[];
      readonly evaluateAfterEdgeEffects: true;
      readonly allowedTransfers: readonly ProofMirEdgeEffect[];
    };
```

The builder does not decide whether an exit is legal. It records the edge and
the scopes crossed so the proof checker can enforce closure.

The closure policy is builder-produced data, so its shape is deterministic:

| Exit kind          | Boundary                  | Closure policy                                                                         |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------- |
| `ordinaryReturn`   | function, `none`          | `functionExit`, terminal reachability not required                                     |
| `terminalReturn`   | function, `none`          | `functionExit`, terminal reachability required                                         |
| `panic`            | function, `abortNoUnwind` | `functionExit`, terminal reachability not required                                     |
| `scopeBreak`       | scope target              | `scopeExit` over crossed scopes after edge effects                                     |
| `scopeContinue`    | scope target              | `scopeExit` over crossed scopes after edge effects, targeting the loop continue/header |
| `attemptError`     | scope target              | `scopeExit` over crossed scopes after attempt error-state effects                      |
| `validationReject` | scope target              | `scopeExit` over crossed scopes after validation reject-state effects                  |

For scope exits, the policy is relative to `checkedScopes` and is evaluated
after the edge effects are applied. It does not require closure of resources
that are still in an enclosing scope and explicitly carried to the target edge.
`allowedTransfers` names the edge effects that may move resources out of a
crossed scope before the closure check runs. Panic has no unwinding or
destructor semantics in Proof MIR; it is an aborting function exit. As a
language rule, aborting is not permission to leak proof obligations, live
loans, session members, or pending validation state. A panic path must satisfy
the same `functionExit` no-live-resource requirements as any other function
exit, except terminal reachability is not required. If Wrela later adds a
proof-authorized panic discharge for a specific obligation kind, that discharge
must be explicit metadata consumed before the `panicExit` edge. If Wrela later
grows real unwinding, it must be a new exit boundary policy rather than an
overloaded `panic` edge.

Coroutine yield is not a function exit. Its `frameBoundary` is the explicit
resume-frame evidence visible to the checker and later lowering. The builder
records values and resource-bearing records named by the suspend payload,
resume target, explicit suspend/resume edge effects, and mono coroutine
metadata. It does not compute path-sensitive coroutine-frame liveness.

Yield frame-boundary construction is syntactic and metadata-driven:

1. Include scalar SSA values explicitly captured by mono coroutine metadata or
   named by the yield payload/resume edge contract.
2. Include places and proof-state items explicitly captured, transferred, or
   reintroduced by suspend/resume edge records.
3. Include facts only as edge-local facts or as explicit fact dependencies.
   Ambient facts are not captured as frame state merely because they were true
   before suspension.
4. Sort by canonical key before dense ID assignment. After canonicalization,
   frozen programs expose the corresponding dense-ID order.

Yield/resume lowering follows these rules:

- every `frameBoundary.value` must resolve to a scalar SSA value visible at the
  suspension point
- every `frameBoundary.place` names storage the coroutine-frame contract says
  may be captured or reintroduced
- loans, obligations, and session members crossing the yield remain explicit
  records; they are not implicitly released or discharged
- facts that depend on private-state generations, mutable places, or platform
  state are available after resume only through checker proof or resume-edge
  facts
- resume-edge facts are edge-local facts on the `yieldResume` edge, not facts
  stored on the resume block
- the checker/shared analysis derives yield safety, frame convergence, and any
  liveness needed for diagnostics from the graph and frame-boundary evidence

The builder records the frame contract and resume edge; coroutine-frame layout
and storage placement are later target-lowering choices after proof acceptance.

## Calls

Call lowering must resolve each call to one of three target forms:

```ts
export type ProofMirCallTarget =
  | {
      readonly kind: "sourceFunction";
      readonly functionInstanceId: MonoInstanceId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "functionAbi" };
    }
  | {
      readonly kind: "certifiedPlatform";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
      readonly abi: ProofMirLayoutReference & { readonly kind: "platformAbi" };
    }
  | {
      readonly kind: "compilerRuntime";
      readonly runtimeId: ProofMirRuntimeOperationId;
      readonly runtimeCallId: ProofMirRuntimeCallId;
    };

export interface ProofMirRuntimeOperation {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly targetAvailability: ProofMirRuntimeTargetAvailability;
  readonly requiredFactSchemas: readonly ProofMirRuntimeFactSchema[];
  readonly consumedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly producedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly effectSchemas: readonly ProofMirRuntimeEffectSchema[];
  readonly abi: ProofMirRuntimeAbiReference;
  readonly loweringOwner: ProofMirRuntimeLoweringOwner;
}

export type ProofMirRuntimeTargetAvailability =
  | { readonly kind: "allTargets" }
  | { readonly kind: "target"; readonly targetId: TargetId }
  | { readonly kind: "targetFeature"; readonly targetId: TargetId; readonly feature: string };

export type ProofMirRuntimeLoweringOwner =
  | "panicAbort"
  | "validatedBufferHelper"
  | "coroutineFrame"
  | "moveRingCoreTransfer"
  | "targetMemoryHelper";

export interface ProofMirRuntimeCallContract {
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFacts: readonly ProofMirFactId[];
  readonly consumedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly producedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly effects: readonly ProofMirRuntimeEffect[];
  readonly origin: ProofMirOriginId;
}

export type ProofMirRuntimeAbiReference =
  | ProofMirLayoutReference
  | { readonly kind: "runtimeAbi"; readonly runtimeId: ProofMirRuntimeOperationId };

export interface ProofMirRuntimeCatalog {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  get(runtimeId: ProofMirRuntimeOperationId): ProofMirRuntimeOperation | undefined;
  entries(): readonly ProofMirRuntimeOperation[];
}

export type ProofMirRuntimePlaceSchema =
  | { readonly kind: "receiver" }
  | { readonly kind: "argument"; readonly parameterId?: ParameterId; readonly index: number }
  | { readonly kind: "result" }
  | { readonly kind: "synthetic"; readonly name: string };

export interface ProofMirRuntimeFactSchema {
  readonly name: string;
  readonly role: Extract<ProofMirFactRole, "requirement" | "trustedAxiom">;
  readonly operands: readonly ProofMirRuntimePlaceSchema[];
}

export type ProofMirRuntimeEffectSchema =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "writesMemory"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofMirRuntimePlaceSchema }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export type ProofMirRuntimeEffect =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "writesMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };
```

Mono owns call resolution. Every reachable mono call expression consumed by
Proof MIR must carry exactly one concrete target:

```ts
export type MonoResolvedCallTarget =
  | { readonly kind: "sourceFunction"; readonly targetFunctionInstanceId: MonoInstanceId }
  | {
      readonly kind: "certifiedPlatform";
      readonly targetPlatformEdgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
    };
```

The builder builds lookup indexes only to verify that the concrete mono target
exists, has the expected body status, has matching ABI/layout facts, and has
the required platform contract metadata. It must not reconstruct call identity
from `FunctionId`, owner type arguments, overload names, source syntax, or
catalog primitive names.

For each source `MonoCallExpression`, the builder applies this matrix:

| Mono call state                                          | Proof MIR result                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `recovered === true`                                     | construction diagnostic; no successful Proof MIR                             |
| missing concrete resolved target                         | construction diagnostic; closed mono should already reject this              |
| `targetFunctionInstanceId` names one `sourceBody` target | `sourceFunction` target plus matching `LayoutFunctionAbiFact`                |
| `targetPlatformEdgeId` names one certified edge          | `certifiedPlatform` target plus matching platform contract edge and ABI fact |
| target names `bodylessRecovery`                          | construction diagnostic; recovery bodies cannot survive to checked Proof MIR |
| target ID cannot be found                                | unresolved-call diagnostic                                                   |
| target ID resolves to the wrong target kind              | target-kind mismatch diagnostic                                              |

Constructor and member calls do not use a separate name-resolution path in
Proof MIR. Mono has already resolved them to a concrete
`MonoResolvedCallTarget`. Platform calls additionally require the named
`MonoPlatformContractEdge` to carry the call expression ID, instantiated owner,
instantiated type arguments, canonical monomorphic edge key, and platform ABI
metadata. A platform function instance without the matching contract edge is
rejected rather than treated as an ordinary source function.

Compiler-runtime calls are not source-call resolution results. They are
introduced only by compiler lowering rules, such as validated-buffer helpers,
panic/abort lowering, coroutine-frame operations, or cross-core transfer
helpers. Each introduced runtime call carries a `compilerRuntime` target plus
an instantiated runtime call contract.

Each call records:

- callee target
- receiver, if present
- evaluated argument operands in checked parameter order
- argument modes, including observe or consume
- result operand, if any
- source call expression ID
- call-site requirement IDs
- platform contract edge ID, when certified
- ABI/layout references
- origin ID

Terminal calls remain explicit. The builder records terminal call edges, but
terminal reachability and terminal closure are proof-checker responsibilities.

Compiler-runtime targets are not an authority bypass. They come from a closed
compiler-owned runtime catalog with deterministic numeric IDs, proof-contract
schemas, effect schemas, and ABI/layout facts. The catalog is source of truth
data checked into `src/runtime` and selected through `src/target`; it is not populated from
source packages, stdlib modules, environment state, or ad hoc builder logic.
The Proof MIR builder receives the selected deterministic table through
`BuildProofMirInput.target.runtimeCatalog`; the production pipeline obtains
that table from runtime/target selection using the target ID and feature set
before calling the builder.

The catalog contains global operation definitions only. It must not contain
function-local `ProofMirPlaceId`, `ProofMirValueId`, `ProofMirFactId`, or
`ProofMirOriginId` values. During lowering, the builder instantiates a
`ProofMirRuntimeCallContract` for each runtime call by mapping catalog schemas
to owned call-local places, facts, and effects. Runtime catalog entries are
checked by the same requirement and resource machinery as platform primitives.
Source code cannot name a runtime operation directly; source can only reach
runtime support through lowering rules that preserve the required proof
obligations.

Every runtime catalog entry must declare:

- deterministic `ProofMirRuntimeOperationId`
- stable name used only for diagnostics and snapshots
- target availability predicate
- ABI reference or target-owned runtime ABI record
- required fact schemas
- consumed and produced capability schemas
- effect schemas
- lowering owner, such as panic/abort lowering, validated-buffer helper
  lowering, coroutine-frame lowering, move-ring/core transfer lowering, or
  target memory helper lowering

The catalog is closed: adding a runtime operation is a compiler-source change
reviewed like adding a platform primitive. An operation that produces a
capability must name the schema for that capability and the trusted authority
that justifies it. The builder rejects any runtime operation whose catalog
entry is missing ABI, effect, or proof-contract data.

Target availability is checked before runtime-call instantiation. A runtime
operation whose `targetAvailability` does not match `layout.target.targetId`
and `input.target.features` is treated as unresolved runtime authority, not as
a fallback source call. The runtime catalog used for the check is
`input.target.runtimeCatalog`, and its target ID must match both
`input.target.targetId` and `layout.target.targetId`. Trusted runtime facts use
`trustedAxiom` role and a runtime-call dependency; trusted platform facts use
`trustedAxiom` role and a platform-edge dependency. The shared role means
"trusted by compiler catalog"; the dependency says which catalog owns the
authority.

## Facts

Facts are explicit references with origins and roles. The builder must not turn
an unproved predicate into an assumption. It can record evidence, attach a
requirement, import a trusted catalog axiom, or create a candidate fact whose
entailment is checked later:

```ts
export type ProofMirFactRole = "evidence" | "requirement" | "trustedAxiom" | "candidate";
```

Fact roles have fixed authority:

| Role           | Builder may create when                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `evidence`     | a source construct, match arm, validation result, or checker-recognized structural split emits proof evidence |
| `candidate`    | a source assertion or syntactic comparison may become evidence only if the checker proves it                  |
| `requirement`  | a call, validation/read operation, terminal exit, platform/runtime operation, or obligation demands it        |
| `trustedAxiom` | a certified platform catalog or closed compiler-runtime catalog imports it                                    |

`trustedAxiom` facts must include a platform or runtime dependency. Source
modules, stdlib code, and ordinary HIR predicates cannot create trusted axioms.
`candidate` facts never discharge requirements until the checker promotes them
or proves entailment from other evidence.

Fact source determines the initial role:

| Source of fact record                           | Initial role   | Authority rule                                                                |
| ----------------------------------------------- | -------------- | ----------------------------------------------------------------------------- |
| Source `ensure`                                 | `requirement`  | demands proof at that point; does not add evidence by itself                  |
| Source predicate call returning proof evidence  | `candidate`    | promoted only when checker validates the predicate call and arguments         |
| Branch comparison from an already-computed bool | `candidate`    | can refine a path only after checker relates the bool to the comparison value |
| Structural match arm refinement                 | `evidence`     | evidence only for the discriminant/case relation encoded by the terminator    |
| Validation ok payload/layout relation           | `evidence`     | evidence from the validation split shape and its layout fact dependencies     |
| Validated-buffer read precondition              | `requirement`  | read requires proof before executable read is accepted                        |
| Call-site `requires` clause                     | `requirement`  | call requires proof from path facts                                           |
| Platform ensured fact                           | `trustedAxiom` | must depend on the certified platform edge                                    |
| Runtime ensured fact                            | `trustedAxiom` | must depend on the instantiated runtime call contract                         |
| Checker-derived promotion                       | not builder IR | appears only in checked MIR/certified fact packet, not raw Proof MIR          |

The builder creates canonical fact records for:

- source `ensure` statements
- predicate-call results
- match refinements
- comparison branch facts
- private-state generation facts
- platform ensured facts
- validated-buffer layout facts
- `layout.fits(end)` requirements and evidence sites
- payload-end computations
- terminal-call facts

```ts
export interface ProofMirFact {
  readonly factId: ProofMirFactId;
  readonly role: ProofMirFactRole;
  readonly kind: ProofMirFactKind;
  readonly origin: ProofMirOriginId;
  readonly dependsOn: readonly ProofMirFactDependency[];
}

export type ProofMirFactKind =
  | {
      readonly kind: "comparison";
      readonly left: ProofMirFactOperand;
      readonly operator: ProofMirComparisonOperator;
      readonly right: ProofMirFactOperand;
    }
  | {
      readonly kind: "predicate";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly arguments: readonly ProofMirFactOperand[];
    }
  | {
      readonly kind: "matchRefinement";
      readonly originId: MonoInstantiatedProofId<FactOriginId>;
      readonly scrutinee: ProofMirFactOperand;
      readonly caseLabel: string;
    }
  | {
      readonly kind: "layoutFits";
      readonly source: ProofMirOwnedPlaceId;
      readonly end: ProofMirLayoutTermReference;
      readonly binding?: ProofMirOwnedLayoutTermBindingId;
    }
  | {
      readonly kind: "payloadEnd";
      readonly source: ProofMirOwnedPlaceId;
      readonly end: ProofMirLayoutTermReference;
      readonly binding?: ProofMirOwnedLayoutTermBindingId;
    }
  | {
      readonly kind: "platformEnsured";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | {
      readonly kind: "runtimeEnsured";
      readonly runtimeCallId: ProofMirRuntimeCallId;
    }
  | {
      readonly kind: "terminalCall";
      readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
    };

export type ProofMirFactOperand =
  | { readonly kind: "value"; readonly valueId: ProofMirOwnedValueId }
  | { readonly kind: "place"; readonly placeId: ProofMirOwnedPlaceId }
  | { readonly kind: "constant"; readonly literal: MonoLiteralValue }
  | { readonly kind: "layoutTerm"; readonly term: ProofMirLayoutTermReference }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "enumCase"; readonly label: string };

export type ProofMirFactDependency =
  | { readonly kind: "value"; readonly valueId: ProofMirOwnedValueId }
  | { readonly kind: "place"; readonly placeId: ProofMirOwnedPlaceId }
  | { readonly kind: "layout"; readonly layout: ProofMirLayoutReference }
  | {
      readonly kind: "privateState";
      readonly generation: ProofMirPrivateStateGenerationReference;
    }
  | {
      readonly kind: "platformEdge";
      readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
    }
  | { readonly kind: "runtimeCall"; readonly runtimeCallId: ProofMirRuntimeCallId }
  | { readonly kind: "fact"; readonly factId: ProofMirFactId };
```

`ProofMirProgram.facts` is the only owner of fact records. Edge facts,
statement evidence, requirements, runtime contracts, and validated-buffer read
requirements store `ProofMirFactId` references. They must not embed
denormalized `ProofMirFact` objects. The structural validator rejects any fact
ID that does not resolve in the program table and any fact record whose
`factId` disagrees with its table key.

The builder seeds branch facts from the operation that defines the branch
condition:

- If the condition is the result of a `comparison` statement in the same
  function, the true edge receives the direct comparison fact
  `left operator right`, and the false edge receives the complemented
  comparison fact. The fact depends on the condition value and the comparison
  operands.
- If the condition is an arbitrary boolean value with no local comparison
  definition, the true edge receives `condition == true`, and the false edge
  receives `condition == false`.
- If the condition is a proof predicate token, the edge fact references the
  predicate fact ID rather than reconstructing predicate syntax.

Comparison complements are closed and deterministic:

| Operator | False-edge complement |
| -------- | --------------------- |
| `eq`     | `ne`                  |
| `ne`     | `eq`                  |
| `lt`     | `ge`                  |
| `le`     | `gt`                  |
| `gt`     | `le`                  |
| `ge`     | `lt`                  |

Those facts live on the corresponding `ProofMirControlEdge` as candidate or
evidence facts depending on the source construct that produced them.
Destination blocks do not own incoming facts globally because different
predecessors can carry different facts.

Fact operands are normalized before they enter Proof MIR. Operators are drawn
from `ProofMirComparisonOperator`; source operator spelling is kept only in the
origin table. Predicate and match facts carry explicit operands instead of
requiring the checker to reconstruct them from source syntax.

The builder does not prove entailment. The proof checker decides whether the
facts available at a call, validated-buffer read, terminal return, or platform
operation imply the required facts.

Fact availability is path-sensitive:

- `ProofMirControlEdge.facts` are applied when traversing that edge.
- `recordFactEvidence` statements add evidence at that program point in the
  current block.
- `requireFact` statements create obligations to discharge at that program
  point; they do not add evidence.
- At a join, the checker computes fact convergence from predecessor states and
  edge facts. The builder must not copy predecessor facts onto the destination
  block.
- `proofFact` block parameters are value-level fact tokens, not ambient
  path-state facts. The builder creates one only when mono contains a
  proof-only expression result that is used as a value after a join, such as a
  proof token passed to a later call. Every predecessor must supply an argument
  for that token. The builder does not create proof-fact parameters merely
  because edge facts differ; ambient fact convergence belongs to the checker.

Facts tied to private-state values must carry the exact generation reference.
When a private-state transition advances state, the builder emits an explicit
`advancePrivateState` operation so the checker can invalidate stale facts.

## Private State Generations

Predicate facts are scoped to private-state generations, not merely to
transition IDs. A transition ID names the source/mono operation that advances
state; a generation ID names the proof state before or after that transition.

The builder creates a private-state generation record for each private-state
place at function entry and for each operation that advances that place:

```ts
export interface ProofMirPrivateStateGeneration {
  readonly generationId: ProofMirPrivateStateGenerationId;
  readonly place: ProofMirOwnedPlaceId;
  readonly previous?: ProofMirPrivateStateGenerationId;
  readonly producedBy?: MonoInstantiatedProofId<PrivateStateTransitionId>;
  readonly origin: ProofMirOriginId;
}
```

Predicate facts that depend on private state reference the generation they were
proved against. Calls that mutate private state produce an
`advancePrivateState` statement plus an edge effect from the old generation to
the new generation. The builder knows that a call mutates private state from
one of two sources:

- instantiated `MonoPrivateStateTransition` records emitted by HIR and
  monomorphization for ordinary source/private operations
- catalog-owned platform contracts or runtime call contracts for certified
  platform and compiler-runtime operations

If a private-state-mutating call has no transition metadata or trusted catalog
effect, the builder rejects the program. It must not infer state advancement
from function names or source module identity.

## Layout Term And Runtime Value Bindings

Layout terms come from `LayoutFactProgram`; runtime values come from Proof MIR
SSA. The builder must explicitly connect them whenever a proof obligation
depends on both. For example, a runtime load of `source.len` must bind the
resulting `ProofMirValueId` to the `LayoutTerm` variable that represents
`source.len` in layout facts.

`ProofMirLayoutTermReference` always points to a `ProofMirLayoutTermRecord`.
That record's `path` is a canonical path into `LayoutFactProgram`, including a
root such as a validated-buffer field end term or read requirement and a
recursive `childPath` for arithmetic subterms. The builder must not identify
terms only by names such as `"end"` or `"sourceLength"` because `LayoutTerm` is
recursive and can contain nested arithmetic, field values, derived values, and
requirement operands with the same display role.

Canonicalization is mechanical:

1. Choose the root from the layout fact table and slot that owns the term:
   validated-buffer source length, field offset, field byte length, field
   element count, field end, field derived value, derived-field source term,
   derived case condition/result term, or read requirement operand.
2. For read requirements, `requirementIndex` is the zero-based index in the
   layout field's deterministic `readRequires` array. The slot names which
   term-bearing field inside that requirement is being referenced:
   `layoutFits.end`, `payloadEnd.end`, `rangeConstraint.left`,
   `rangeConstraint.right`, or `noUnsignedOverflow.expression`.
3. For the current `LayoutTerm` grammar, recursive child paths support
   constants, source lengths, field values, derived values, and binary
   arithmetic. Append `"left"` or `"right"` for each descent through
   `LayoutTerm.kind === "add" | "subtract" | "multiply"`. If layout later adds
   unary, n-ary, alignment, mask, or target-intrinsic term nodes, this path
   union must grow in the same change as the layout grammar; the builder must
   not stringify unsupported term shapes.
4. The builder resolves the full path against `LayoutFactProgram` immediately.
   A path that does not resolve or resolves to a term with a different unit is
   a construction diagnostic. Deterministic array order for layout fields,
   derived cases, and `readRequires` is a layout-phase invariant; Proof MIR
   verifies table compatibility and uses that order, but it cannot repair or
   prove how the layout arrays were constructed.
5. `ProofMirLayoutTermId` allocation follows first resolved use in the
   whole-program deterministic function iteration described in the ID section;
   repeated references to the same canonical path reuse the same ID.

The binding record is `ProofMirLayoutTermBinding`; `bindLayoutTerm` statements
introduce those records into the graph.

The builder emits `bindLayoutTerm` statements for:

- validated-buffer source length values
- fixed field offset and end terms that become runtime comparisons
- dynamic payload length and end terms
- derived field results
- target-sized arithmetic terms used by layout requirements

The checker uses these bindings to relate scalar facts such as `v0 >= 2` to
layout requirements such as `layout.fits(source.len)` or
`layout.fits(payloadEnd)`. Without a binding, a runtime comparison cannot
discharge a layout-term requirement even if the values are textually similar.

## Validated Buffers And Layout Facts

Validated-buffer reads are one of the main reasons Proof MIR is after layout.
The builder must lower field access over validated-buffer packet/source places
to operations that reference concrete layout facts:

```ts
export interface ProofMirValidatedBufferRead {
  readonly sourcePlace: ProofMirPlaceId;
  readonly packetPlace?: ProofMirPlaceId;
  readonly validatedBufferInstanceId: MonoInstanceId;
  readonly fieldId: FieldId;
  readonly layoutField: ProofMirLayoutReference & { readonly kind: "validatedBufferField" };
  readonly offsetTerm: ProofMirLayoutTermReference;
  readonly endTerm: ProofMirLayoutTermReference;
  readonly termBindings: readonly ProofMirLayoutTermBindingId[];
  readonly readRequires: readonly ProofMirFactId[];
  readonly result: ProofMirValueId;
  readonly origin: ProofMirOriginId;
}
```

The builder attaches requirement fact IDs derived from the layout field's
`readRequires` array to the operation. It does not prove that the source length
satisfies those requirements. It also does not recompute offsets, byte lengths,
wire endianness, or read policies. The checker resolves `layoutField`,
`offsetTerm`, and `endTerm` through the single `LayoutFactProgram` attached to
`ProofMirProgram`.

Dynamic payload facts are represented as layout term references. The proof
checker may use structural and interval reasoning over these terms without
requiring a general solver.

## Validation

Validation is not an ordinary `Option` or `Result` before proof checking.

The builder lowers validation creation to a `validate` statement that records:

- validation ID
- source place
- pending result place
- source buffer identity
- validated-buffer type instance
- a `ProofMirLayoutReference` for the `LayoutValidatedBufferFact`
- output packet place
- ok and err payload places when the payload is materialized
- ok and err payload types
- origin

A validation match lowers to a `matchValidation` terminator with distinct ok
and err targets:

```text
before match:
  pending validation result is live

ok edge:
  pending result consumed
  source consumed into packet
  packet token/live payload introduced

err edge:
  pending result consumed
  source remains live
  error payload operand introduced when the validation form binds one
  no packet token introduced
```

The builder records the split. The checker verifies single-use, arm input
states, and join convergence. The ok edge must carry edge effects that consume
the source place, consume the pending result place, and introduce the packet
place. The err edge must carry edge effects that consume only the pending
result place, introduce an error payload place only when one exists, and leave
the source place live. `ProofMirValidationMatch.okBindings` and
`errBindings` map mono arm bindings to the operands visible in each arm. These
effects and bindings are data in Proof MIR, not prose-only semantics.

## Attempt

Attempt is the fallible sibling of validation for affine consumption. The
builder lowers attempt expressions into explicit success and error paths.

An `attempt` statement records:

- attempt ID
- fallible expression ID plus its lowered result operand, if any
- declared input places
- pending result place allocated by the canonical ID event log at the attempt
  statement's place-root allocation point
- success operand, if any
- alternative expression ID plus its lowered result operand, if any
- origin

`MonoAttempt.fallibleExpression` is an arbitrary `MonoExpression`, not only a
bare call. The builder lowers that expression with the ordinary expression
lowerer first, preserving any nested calls, validation creations, inner
attempts, block temporaries, or method chains as their own Proof MIR
statements and edges. `ProofMirAttemptStart.fallible` then records the final
lowered result operand. For a branchy fallible expression, such as
`if c { f() } else { g() }`, the operand is the join value or place produced by
the ordinary expression-lowering join. The attempt record does not enumerate
producer calls or run reaching-definition dataflow; nested calls remain
ordinary call statements with call graph records, and the checker follows CFG
and def-use if it needs that relationship. If the fallible expression produces
no value or place that can be tied to the attempt result, the builder emits a
construction diagnostic.

The success edge may consume inputs. The error edge starts from the original
input state unless the source explicitly carries, returns, or discharges the
resource. The `matchAttempt` terminator references the attempt ID and its edge
targets; the success and error `ProofMirControlEdge` records carry the precise
consume, introduce, return, or discharge effects. The checker verifies
single-use of the pending attempt result and convergence of the two outgoing
states.

## Iterator And Stream Loop Lowering

Ordinary `for` lowering is a protocol expansion, not an opaque loop:

1. Evaluate the iterable expression and bind its iterator place or iterator
   value.
2. Open any iterator obligation or call-site requirement recorded by mono.
3. Create a loop header block. Loop-carried scalar locals become header block
   parameters through the SSA algorithm; iterator/resource state remains in
   places and edge effects named by the header's
   `ProofMirResourceBoundarySet`.
4. Lower the protocol `next` operation as either a source call, certified
   platform call, or compiler-runtime call with a normal `ProofMirCallId`.
5. Split the `next` result with explicit edges: item-present enters the body,
   iteration-finished enters the loop exit, and protocol-error follows the
   attempt/error lowering rules if the protocol is fallible.
6. The item-present edge introduces the item place/value and any per-item
   obligation. The body back-edge consumes or carries those resources according
   to explicit body operations.
7. The finished edge records finish/close requirements. The checker proves that
   the iterator obligation is closed or intentionally transferred on every loop
   exit.

Stream `for` lowering follows the same CFG shape but uses session/member
metadata instead of ordinary iterator state. The builder opens the stream
session member before the header, records a branded member for each yielded
item, carries member state on body/back/exit edges, and emits close-member or
discharge operations only where mono proof metadata authorizes them. `break`,
`continue`, validation reject, attempt error, panic, and return edges crossing
the stream body all carry crossed-scope metadata and closure policies.

Loop proof checking is checker-owned. The builder supplies loop headers,
back-edges, edge arguments, and resource-state operations. The checker computes
convergence at loop headers over its finite proof/resource state. It may use
exact fixed-point convergence, declared invariants, or bounded widening only if
those rules are specified by the proof-semantics companion and produce
deterministic diagnostics. The builder must not invent loop invariants or mark
a loop converged.

## Take, Sessions, Brands, And Obligations

`take` lowering must keep session membership separate from raw obligations.

The builder lowers each mono take statement into explicit operations:

- evaluate the operand
- open the closure obligation
- open a session member that names the session ID and member brand ID when the
  take kind has one
- bind the take alias local, if present
- lower the take body
- emit explicit scope-exit edges from every body exit
- emit close-session-member and discharge-obligation operations only for
  explicit HIR/mono proof metadata sites

For stream and validated-buffer take forms, the IR must carry both obligation
identity and member/session identity. Checker diagnostics must be able to name
the token, the expected session, and the misrouted close site.

## Cross-Core Ownership And Transfer

Cross-core operations are proof-relevant. The builder must not lower worker
spawn, `Core.pin`, move-ring transfer, or cross-core ownership movement to
ordinary calls before proof checking. They become explicit operations backed by
mono proof metadata and trusted runtime/platform contracts:

This section is gated on an upstream mono extension. Mono proof metadata must
preserve cross-core operation IDs, transfer brands, source/target places, and
required runtime/platform contracts before the builder can lower these
constructs. Until that table exists, the builder must reject reachable
cross-core constructs with a construction diagnostic instead of approximating
them as ordinary calls.

```ts
export type ProofMirConcurrencyOperation =
  | {
      readonly kind: "pinCore";
      readonly sourcePlace: ProofMirPlaceId;
      readonly workerPlace: ProofMirPlaceId;
      readonly targetCorePlace: ProofMirPlaceId;
      readonly transferObligation: ProofMirObligationReference;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "spawnWorker";
      readonly workerPlace: ProofMirPlaceId;
      readonly entryCall: ProofMirCallId;
      readonly producedSession?: ProofMirSessionMemberReference;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "moveRingEnqueue";
      readonly ringPlace: ProofMirPlaceId;
      readonly valuePlace: ProofMirPlaceId;
      readonly transferBrand: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "moveRingDequeue";
      readonly ringPlace: ProofMirPlaceId;
      readonly resultPlace: ProofMirPlaceId;
      readonly transferBrand: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    }
  | {
      readonly kind: "transferOwnership";
      readonly fromPlace: ProofMirPlaceId;
      readonly toPlace: ProofMirPlaceId;
      readonly transferBrand?: MonoInstantiatedProofId<BrandId>;
      readonly origin: ProofMirOriginId;
    };
```

These operations carry the one-owner rule across cores. The checker owns the
proof that a transferred value is no longer usable by the source core, that a
move-ring slot has one producer and one consumer ownership path, and that
core-movability obligations are satisfied before transfer. The builder's job is
to preserve the places, brands, obligations, runtime call contracts, and edge
effects that make those checks possible.

Cross-core transfer and coroutine yield are proof-semantics consumers. This
document fixes what the builder must preserve in the graph. The proof-semantics
companion owns the acceptance rules for yield safety, frame convergence,
core-movable values, transfer brands, and move-ring producer/consumer
ownership. If those judgments require different preserved evidence, this
builder contract must be updated before implementation rather than smuggling
the missing evidence through target lowering.

## Control-Flow Lowering

Structured mono statements lower as follows:

| Mono construct  | Proof MIR shape                                                                        |
| --------------- | -------------------------------------------------------------------------------------- |
| block           | sequential statements in current block, with nested scope IDs                          |
| let             | value lowering plus local/place binding                                                |
| assignment      | target place lowering plus `store` or explicit move/consume                            |
| expression      | expression lowering, result may be unused                                              |
| if              | condition value, branch terminator, then/else blocks, join block                       |
| while           | header block, condition branch, body block, continue edge, exit                        |
| loop            | body block, continue edge back to body/header, explicit exits                          |
| for ordinary    | checked iterator protocol with explicit next/finish obligations                        |
| for stream      | gated stream-loop extension: explicit stream session/member operations plus loop shape |
| match           | switch/match terminator plus arm blocks and join                                       |
| validationMatch | `matchValidation` terminator plus ok/err arm states                                    |
| take            | open obligation/session, body, scope exits                                             |
| return          | explicit return terminator plus return-exit edge                                       |
| yield           | gated coroutine extension: suspension terminator plus suspend/resume control edges     |
| break/continue  | explicit edge to enclosing loop exit/continue block                                    |
| error           | builder diagnostic; no successful Proof MIR                                            |

Ill-typed, unrecovered, or semantically rejected source constructs should be
diagnosed by earlier phases whenever possible. If a reachable mono node is
still `error`, the builder emits a fail-closed diagnostic rather than silently
dropping it.

## Worked Lowering Example

Consider a source-shaped body whose mono form is equivalent to:

```text
fn read_tag(source: PacketSource) -> u8:
  let len = source.len
  if len >= 2:
    let validation = Packet.validate(source)
    match validation:
      ok packet:
        return packet.tag
      err:
        return 0
  else:
    return 0
```

Proof MIR keeps the validation, branch facts, and layout terms explicit:

```text
function read_tag
  block b0(entry):
    v_len = load source.len
    t_source_len = bindLayoutTerm(
      value: v_len,
      path: validatedBufferSourceLength(PacketSource)
    )
    v_has_two = comparison ge v_len, 2
    branch v_has_two
      edge e_true -> b_validate
        facts:
          candidate comparison(value v_len ge constant 2)
      edge e_false -> b_return_zero
        facts:
          candidate comparison(value v_len lt constant 2)

  block b_validate:
    validate Packet
      sourcePlace: p_source
      pendingResultPlace: p_validation_pending
      okPacketPlace: p_packet
      okPayloadType: Packet
      errPayloadType: ValidationError
    matchValidation validation
      edge e_ok -> b_read_tag
        effects:
          consumePlace p_validation_pending
          consumePlace p_source
          introducePlace p_packet
      edge e_err -> b_return_zero
        effects:
          consumePlace p_validation_pending

  block b_read_tag:
    v_tag = readValidatedBufferField
      packetPlace: p_packet
      fieldId: tag
      layoutField: validatedBufferField(Packet, tag)
      offsetTerm: layoutTerm(field tag offset)
      endTerm: layoutTerm(field tag end)
      readRequires:
        requirement layoutFits(source: p_packet, end: field tag end)
    return v_tag
      edge e_return_tag:
        exit ordinaryReturn
        closure: functionExit, terminal reachability not required

  block b_return_zero:
    v_zero = literal 0
    return v_zero
      edge e_return_zero:
        exit ordinaryReturn
        closure: functionExit, terminal reachability not required
```

The example illustrates four canonical rules:

- branch facts live on `e_true` and `e_false`, not on `b_validate` or
  `b_return_zero`
- validation ok/err state changes are edge effects, not prose attached to the
  terminator
- the runtime scalar `v_len` is connected to the layout term through
  `bindLayoutTerm`; without that binding, `len >= 2` cannot discharge a layout
  requirement
- return closure policy is recorded by the builder, while legality is
  checked later by the proof checker

A scalar join uses edge arguments, not duplicated block-target arguments:

```text
if cond:
  x = 1
else:
  x = 2
return x

edge e_then -> b_join
  arguments: [v_one]
edge e_else -> b_join
  arguments: [v_two]

block b_join(v_x: copyScalar u8):
  return v_x
```

`b_join` owns the block parameter. `e_then` and `e_else` own the incoming
values for that parameter. The terminator targets name `e_then`/`e_else` and
`b_join`; they do not carry a second argument list.

## Structural Validation

Before returning `kind: "ok"`, the builder runs a local structural validator:

- every function has an entry block
- every block has exactly one terminator
- every block has a scope ID that resolves in the function scope table
- no block has implicit fallthrough
- every branch target exists
- every switch without a fallback has mono exhaustiveness evidence
- every terminator lists every outgoing control edge it uses
- every `ProofMirBlockTarget.edgeId` resolves to an edge whose `toBlockId`
  matches the target block
- every deterministic table reports stable canonical keys and rejects duplicate
  canonical keys with different payloads
- every non-return and non-panic core CFG transfer has a control edge with
  facts, edge effects, and crossed-scope metadata
- every return and panic terminator has both a control edge and an exit edge
- every gated extension record is either handled by an enabled extension
  validator or rejected as unsupported
- every incoming edge argument count and type matches its target block
  parameters
- every edge fact ID resolves in `ProofMirProgram.facts`
- every scalar value has exactly one definition
- every used value is defined and dominates the use, except block parameters
  supplied by predecessor edges
- every block parameter has a copy scalar or proof-fact representation and does
  not carry resource state
- every statement operator is a closed Proof MIR operator, not a source spelling
- every return operand shape matches the declared return type and
  consume/observe effects
- every place reference exists
- every local binding maps to one place or value role consistently
- every local, value, place, block parameter, and operand that describes the
  same mono local or storage location agrees on `MonoCheckedType` and
  `ConcreteResourceKind`
- every loop header that carries resource state has
  `stateMerge.kind === "loopHeader"` and a complete
  `ProofMirResourceBoundarySet` for the resources explicitly named by loop
  operations and edges
- every scope ID resolves, every scope parent is acyclic, and every crossed
  scope list matches the source and target scope stacks
- every loan reference has a stable loan ID, mode, scope, start origin, and
  matching release or exit closure policy
- every call target resolves
- every call graph edge uses an owned call ID and points to the same target as
  the call statement
- every call has a stable call ID and every receiver/argument uses an
  operation-specific operand role compatible with consume or observe mode
- every consume receiver or argument uses `ProofMirConsumedOperand`, never a
  value-only operand
- every platform call has a platform contract edge and ABI fact
- every compiler-runtime call has a closed catalog operation and an
  instantiated runtime call contract with owned places and trusted effects
- no runtime catalog operation contains function-local IDs
- every validated-buffer read has a layout field reference, layout term
  references, and term/value bindings for runtime-dependent terms
- every validated-buffer read uses fact IDs derived from the layout field's
  `readRequires` array
- every layout term reference resolves to a canonical path inside
  `LayoutFactProgram`
- every validation start records ok and err payload types and any materialized
  payload places
- every validation match records ok/err arm bindings whose operands are visible
  only along the corresponding edge
- every attempt start records an arbitrary lowered mono expression operand and a
  deterministic pending result place
- every exit edge has scope and origin metadata
- every exit edge has a boundary and closure policy matching the exit
  policy table
- every fact has normalized operands and a valid role
- every fact ID appears in only one canonical table record
- every trusted axiom fact has a platform-edge or runtime-call dependency
- every proof operation references existing proof metadata
- every private-state fact dependency references a generation, not only a
  transition
- every origin ID resolves

The structural validator does not prove resource correctness. It proves that
the checker has a well-formed graph to analyze.

Enabled extension validators add their own structural checks. The coroutine
yield extension checks `yieldSuspend`/`yieldResume` edge pairing, resume target
identity, frame-boundary reference completeness, and return-style payload
operands. The stream-loop extension checks stream session/member records and
loop boundary references. The cross-core extension checks transfer operation
IDs, places, brands, obligations, and runtime/platform contract links. These
validators do not prove liveness, ownership transfer legality, or convergence;
they only ensure the checker has complete records to analyze.

## Diagnostics

Proof MIR diagnostics should be deterministic and source-oriented. Diagnostic
codes should include at least:

```text
PROOF_MIR_REACHABLE_MONO_ERROR
PROOF_MIR_MISSING_FUNCTION_BODY
PROOF_MIR_CERTIFIED_PLATFORM_HAS_BODY
PROOF_MIR_MISSING_CONCRETE_CALL_TARGET
PROOF_MIR_UNRESOLVED_CALL_TARGET
PROOF_MIR_CALL_TARGET_KIND_MISMATCH
PROOF_MIR_MISSING_LAYOUT_TYPE_FACT
PROOF_MIR_MISSING_LAYOUT_FIELD_FACT
PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT
PROOF_MIR_MISSING_PLATFORM_ABI_FACT
PROOF_MIR_MISSING_FUNCTION_ABI_FACT
PROOF_MIR_MISSING_PROOF_METADATA
PROOF_MIR_UNLOWERABLE_MONO_STATEMENT
PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION
PROOF_MIR_INVALID_CFG
PROOF_MIR_INVALID_SSA
PROOF_MIR_ORIGIN_MISSING
PROOF_MIR_INPUT_LAYOUT_MISMATCH
PROOF_MIR_LAYOUT_KEY_SET_MISMATCH
PROOF_MIR_MISSING_CONTROL_EDGE
PROOF_MIR_INVALID_EDGE_METADATA
PROOF_MIR_INVALID_YIELD_RESUME
PROOF_MIR_MISSING_CALL_ID
PROOF_MIR_MISSING_STATEMENT_ID
PROOF_MIR_MISSING_TERMINATOR_ID
PROOF_MIR_MISSING_LAYOUT_TERM_BINDING
PROOF_MIR_INVALID_FACT_ROLE
PROOF_MIR_MISSING_SESSION_MEMBER
PROOF_MIR_MISSING_ATTEMPT_START
PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS
PROOF_MIR_INVALID_VALIDATION_BINDING
PROOF_MIR_INVALID_LOAN_IDENTITY
PROOF_MIR_MISSING_RUNTIME_CALL_CONTRACT
PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY
PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT
PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE
PROOF_MIR_MISSING_SEMANTICS_GATE
PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD
PROOF_MIR_MISSING_PRIVATE_STATE_GENERATION
PROOF_MIR_MISSING_CONCURRENCY_METADATA
PROOF_MIR_MISSING_IMAGE_ENTRY
PROOF_MIR_MISSING_EXTERNAL_ROOTS
PROOF_MIR_INVALID_JOIN_ARGUMENTS
PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS
PROOF_MIR_INVALID_LAYOUT_TERM_PATH
PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY
PROOF_MIR_INVALID_SCOPE_TREE
PROOF_MIR_INVALID_TABLE_CANONICAL_KEY
PROOF_MIR_INVALID_CONCRETE_CALL_TARGET
PROOF_MIR_INVALID_CALL_OPERAND
PROOF_MIR_INVALID_ATTEMPT_OPERAND
PROOF_MIR_INVALID_ITERATOR_PROTOCOL
PROOF_MIR_INVALID_LOOP_BOUNDARY_SET
PROOF_MIR_INVALID_YIELD_FRAME_BOUNDARY
PROOF_MIR_INVALID_FACT_OPERAND
PROOF_MIR_INVALID_FACT_AUTHORITY
PROOF_MIR_INVALID_FACT_TABLE_REFERENCE
PROOF_MIR_INVALID_STATEMENT_OPERATOR
PROOF_MIR_INVALID_VALUE_RESOURCE_KIND
PROOF_MIR_TYPE_RESOURCE_KIND_MISMATCH
PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT
PROOF_MIR_INVALID_EXTERNAL_ROOT
```

Diagnostics should include:

- code
- message
- source origin when available
- mono function instance ID
- mono expression or statement ID when available
- related proof ID, layout key, or call target when useful

Builder diagnostics should explain construction failures, not proof failures.
For example, "validated-buffer field read has no layout fact" belongs here.
"validated-buffer field read lacks proven `layout.fits(end)`" belongs to the
proof checker.

## Determinism

The builder must produce byte-for-byte stable snapshots for identical mono and
layout inputs:

- process deterministic tables by their `entries()` order
- allocate dense IDs in a stable order
- use explicit stable purpose names for synthetic blocks and origins
- sort diagnostics by source origin, function instance, node kind, and code
- avoid object identity and insertion order as semantic keys
- do not read time, environment variables, filesystem state, or host target
  information

Determinism tests should compare normalized Proof MIR snapshots after shuffling
input table construction order in fixtures.

## Relationship To The Proof Checker

The Proof MIR builder output is unchecked. The proof checker consumes
`ProofMirProgram` and either emits diagnostics or returns checked MIR with a
certified fact packet.

The builder must preserve enough identity for that fact packet:

- value IDs for scalar facts and def-use chains
- block IDs and edge IDs for dominance and path facts
- place IDs for ownership, noalias, and field-disjointness facts
- call IDs for platform effect and wrapper-elimination facts
- layout references for bounds-check elimination and zero-copy packet views
- origin IDs for diagnostics and debug metadata
- proof metadata IDs for erased proof/resource values
- owned IDs for any fact, runtime-call, private-state generation, or call-graph
  record that references function-local values, places, calls, or edges

The builder should not pre-erase proof-only values. It may mark them
`proofOnly`, but erasure is only safe after the checker accepts the program.

## Checker Input Contract

The checker input is the structurally validated `ProofMirProgram` plus the
attached `LayoutFactProgram`, mono proof metadata, runtime catalog, and origin
table. The checker must not recover source shape, re-run name resolution,
re-run monomorphization, or reinterpret layout expressions from text.

The checker may assume these builder guarantees:

- every control transfer is represented by a terminator and a
  `ProofMirControlEdge`
- every fact reference resolves to one canonical `ProofMirFact`
- every scalar SSA value has one definition and dominance can be computed from
  blocks and edges
- every resource-relevant operation names a structured place, loan, obligation,
  session member, private-state generation, or runtime/platform contract
- every loop header names the non-SSA proof/resource boundary domain the
  checker analyzes for convergence
- every return, panic, terminal return, scope exit, validation split, attempt
  split, and enabled extension transfer has explicit edge metadata
- every layout-dependent runtime value is connected to a canonical layout term
  path through `bindLayoutTerm`
- every trusted axiom depends on a platform edge or runtime call contract

The checker must prove or reject:

- resource availability, move/use legality, borrow legality, and noalias
- obligation/session closure over all exits
- fact entailment and path-sensitive fact convergence
- validated-buffer read requirements from layout facts and runtime bindings
- platform/runtime preconditions and postconditions
- loop convergence and enabled extension convergence according to the
  proof-semantics companion
- terminal reachability and terminal closure

On success, checked MIR preserves the executable graph plus a certified fact
packet. The packet, not raw Proof MIR, is authority for later optimizations
such as move elision, wrapper elimination, bounds-check removal, zero-copy
validated-buffer reads, direct platform lowering, and proof erasure.

## Relationship To Checked MIR And Target Lowering

Checked MIR is the proof checker's success output. It should preserve scalar SSA
where useful, while memory/resource SSA remains an optional derived analysis.
The AArch64 target lowering consumes checked MIR plus certified facts and may
lower directly to AArch64 machine IR.

The Proof MIR builder should therefore avoid target-specific lowering choices:

- do not choose registers
- do not assign stack slots
- do not lower ABI parameter passing into physical locations
- do not fold platform calls into instruction sequences
- do not flatten aggregates for codegen
- do not remove proof-only operations

It may attach the concrete ABI and layout facts that make those later choices
safe.

## Testing Strategy

Unit tests should cover:

- dense ID constructors and deterministic table ordering
- deterministic table canonical key hooks and duplicate-key diagnostics
- canonical-keyed draft records and final dense-ID assignment
- origin allocation for source and synthetic nodes
- input compatibility checks for every mono/layout table-key set
- call-target verification indexes for concrete mono targets
- call-target matrix for source, certified platform, recovered,
  `bodylessRecovery`, missing-target, and target-kind mismatch calls
- layout fact index lookup and mismatch diagnostics
- layout term canonical path interning for recursive `LayoutTerm` roots and
  child paths
- layout term/value bindings for `source.len`, fixed ends, and dynamic payload
  ends
- sealed-block scalar SSA construction, incomplete parameters, loop header
  parameters, and edge-owned join arguments
- predeclared loop-header parameters winning over on-demand incomplete
  parameters
- local classification into scalar SSA and place-backed storage
- local pre-scan for address-taken, borrow, branch-joined, and loop-carried
  locals
- construction diagnostics when lowering discovers a place/borrow use missed by
  the pre-scan
- rejection of address-taken copy scalars as SSA locals instead of
  place-backed locals
- loop-header resource boundary-set construction and structural validation
- cross-record type/resource-kind consistency for locals, values, places,
  operands, and block parameters
- scope tree allocation, crossed-scope computation, and loan lifetime boundary
  recording
- if/else, loops, breaks, continues, and explicit exits
- return, panic, terminal return, and scope-exit closure policy metadata
- resource-capable return operands
- edge-local branch facts and scope-exit metadata
- field-sensitive place lowering
- statement state effects for load, store, move, consume, borrow, release, and
  call operands, including rejection of ambiguous write lowering
- move, consume, borrow, loan identity, and release operation lowering
- `take` session and obligation lowering
- session-member open and close operations
- validation creation and ok/err match splits
- validation ok/err payload type recording
- validation ok/err arm binding recording
- validation edge effects for source consumption and packet introduction
- attempt success/error splits
- attempt-start records for arbitrary mono expressions, deterministic pending
  result place allocation, pending-result use, and absence of producer-call
  dataflow fields
- ordinary iterator protocol lowering
- predicate and `ensure` fact origins
- normalized fact operands and comparison operators
- closed statement operator enums
- fact availability from edge facts, statement evidence, requirements, and
  proof-fact block parameters
- canonical fact table references from edges, statements, reads, and runtime
  contracts
- fact roles for evidence, requirements, trusted axioms, and candidates
- platform call contract-edge lowering
- compiler-runtime catalog operation and runtime call-contract lowering,
  including rejection of catalog entries with function-local IDs
- runtime target availability and trusted-axiom dependency checks
- private-state generation threading and invalidation
- validated-buffer read lowering with layout read requirements
- structural validator failures
- deterministic diagnostics

Extension-contract unit tests should cover:

- semantics-gated rejection of yield/cross-core/stream constructs when the
  proof-semantics companion, extension registry, or mono metadata is missing
- coroutine yield suspension/resume edge structure and frame-boundary reference
  completeness when the coroutine extension is enabled
- resource-capable yield payload operands in the coroutine extension
- stream loop protocol lowering when the stream-loop extension is enabled
- cross-core pin, worker spawn, move-ring, and transfer-operation lowering when
  mono concurrency metadata and trusted contracts exist

Integration tests should cover:

- lowering a small closed mono program into Proof MIR through the public API
- a function with nested branches and scalar block parameters
- a function with all explicit exit forms supported by current HIR
- validation and attempt convergence shapes before checking
- a validated-buffer read referencing layout facts
- a validated-buffer proof shape that binds a runtime `source.len` value to a
  layout term
- a certified platform call carrying catalog and ABI facts
- a compiler-runtime call proving closed catalog definition plus per-call owned
  effects
- deterministic snapshots from equivalent mono/layout inputs

Extension integration tests should cover coroutine yield/resume, stream loops,
and cross-core transfer or move-ring flows only when the corresponding
semantics gate and mono metadata are enabled.

Future checker tests should use Proof MIR fixtures rather than constructing
checker-only graphs by hand whenever the source construct is expressible. Hand
written Proof MIR fixtures are still useful for impossible or minimized
checker edge cases.

## Derived Analyses And Evolution

The production builder contract is the proof-visible graph described above.
Additional analyses may be layered on top of it without changing builder
semantics:

- memory SSA or region/effect SSA for optimization
- richer arithmetic indexes for layout and range reasoning
- terminal graph certificates produced by the checker or a dedicated
  certificate pass
- shared post-checked lowering for multiple target backends
- incremental MIR caching keyed by mono instance and layout fact fingerprints

These analyses must be derived from Proof MIR and its attached layout/proof
metadata. They must not become hidden authority that changes the meaning of the
checker-facing graph. The builder succeeds only when it creates deterministic,
origin-rich, structurally valid Proof MIR that the proof checker can analyze
without recovering source shape.
