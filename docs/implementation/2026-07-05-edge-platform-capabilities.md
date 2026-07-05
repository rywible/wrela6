# Edge Platform Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-authored `platform fn` bindings with sealed platform capability values. Source Wrela can use ordinary edge fields, ordinary field access, and ordinary calls, while the compiler preserves provenance, proof obligations, layout facts, optimizer effects, and target lowering for platform-owned operations.

**Architecture:** The selected target publishes a typed sealed-capability surface: sealed region types, sealed callable types, region field operations, callable service operations, predicate requirements, and effect summaries. The semantic checker certifies which edge fields hold sealed capabilities. HIR records each sealed region access and sealed callable call as a platform contract edge. Mono, Proof MIR, proof checking, Opt IR, layout, validation, and target lowering consume those edges as first-class platform operations. Legacy `platform fn` source declarations are rejected.

**Tech Stack:** TypeScript, Bun, existing parser/semantic/HIR/mono/proof-mir/proof-check/opt-ir/target pipeline, existing fake-based test support under `tests/support`, existing fixture-based validation.

---

## Research Notes

- Current platform source support is centered on freestanding `platform fn`:
  - `src/semantic/names/platform-binding.ts`
  - `src/semantic/names/platform-primitives.ts`
  - `src/semantic/surface/platform-certifier.ts`
  - `src/hir/call-lowerer.ts`
  - `src/mono/reachability/work-items.ts`
  - `src/proof-mir/domains/call-targets.ts`
  - `src/proof-check/domains/platform-contract-transfer.ts`
  - `src/opt-ir/lower/call-lowering.ts`
- Target information already flows through `SemanticTargetSurface` in `src/semantic/surface/platform-surface.ts`. This is the correct home for sealed region and sealed callable catalogs.
- Current target type references support only named types with type arguments. Do not introduce function-type syntax for this implementation. Use named callable target types such as `UefiOutputStringFn[Console]`; the callable signature lives in the target catalog.
- `targetTypeKinds` currently carry only `{ targetTypeId, kind }`, and `type-reference-checker.ts` treats target types as zero-arity. Sealed capability types need explicit arity and construction metadata.
- HIR member lowering currently only knows source fields and special image device members. Sealed region pseudo-fields need catalog-backed member lowering from target type metadata.
- Full-image semantic platform reference checking currently scans source text with a `platform fn` regex. It must be replaced with compiler-produced sealed operation inventory.
- `platform`, `machine`, and `asm` source constructs are not part of the new design. `platform fn` must become a legacy diagnostic, and no source assembly or machine IR syntax should be added.

---

## File Structure

Files touched by this plan:

```text
src/semantic/ids.ts
src/semantic/surface/platform-surface.ts
src/semantic/surface/checked-program.ts
src/semantic/surface/semantic-surface-checker.ts
src/semantic/surface/type-reference-checker.ts
src/semantic/surface/resource-kind-checker.ts
src/semantic/surface/sealed-capability-certifier.ts
src/semantic/surface/diagnostics.ts
src/semantic/surface/index.ts
src/semantic/names/platform-binding.ts
src/semantic/names/platform-primitives.ts
src/semantic/names/reference.ts
src/semantic/names/expression-resolver/member-chain-resolver.ts
src/semantic/names/name-resolver.ts
src/hir/hir.ts
src/hir/expression-lowerer.ts
src/hir/statement-lowerer.ts
src/hir/call-callee-resolver.ts
src/hir/call-lowerer.ts
src/hir/proof-metadata.ts
src/hir/diagnostics.ts
src/mono/mono-hir.ts
src/mono/platform-contract-edge.ts
src/mono/reachability/work-items.ts
src/proof-mir/model/program.ts
src/proof-mir/model/calls.ts
src/proof-mir/lower/call-lowerer.ts
src/proof-mir/domains/call-targets.ts
src/proof-check/domains/platform-contract-transfer.ts
src/proof-check/domains/platform-contract-effects.ts
src/opt-ir/operation-effects.ts
src/opt-ir/lower/call-lowering.ts
src/opt-ir/lower/region-builder.ts
src/layout/platform-abi.ts
src/target/aarch64/facts/aarch64-fact-adapter.ts
src/target/aarch64/lower/operation-materialization.ts
src/target/aarch64/lower/operation-support.ts
src/target/uefi-aarch64/binary-spine.ts
src/target/uefi-aarch64/firmware-lowering.ts
src/target/uefi-aarch64/platform-catalog.ts
src/target/uefi-aarch64/package-pipeline-semantic-target.ts
src/target/uefi-aarch64/target-surfaces.ts
src/validation/full-image/reference-checkers/semantic-platform-reference.ts
src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts
src/validation/full-image/reference-checkers/uefi-tcb-golden-fixtures.ts
src/validation/full-image/reference-checkers/proof-fact-reference.ts
src/validation/full-image/reference-checkers/opt-ir-reference.ts
src/validation/full-image/determinism.ts
tests/support/semantic/semantic-surface-fakes.ts
tests/support/hir/typed-hir-fakes.ts
tests/unit/semantic/surface/sealed-capability-catalog.test.ts
tests/unit/semantic/surface/sealed-capability-certifier.test.ts
tests/unit/semantic/surface/type-reference-checker.test.ts
tests/unit/semantic/names/sealed-member-resolution.test.ts
tests/unit/hir/sealed-region-read-lowering.test.ts
tests/unit/hir/sealed-region-write-lowering.test.ts
tests/unit/hir/sealed-callable-lowering.test.ts
tests/unit/mono/sealed-platform-edges.test.ts
tests/unit/proof-mir/sealed-platform-operations.test.ts
tests/unit/proof-check/sealed-platform-effects.test.ts
tests/unit/opt-ir/sealed-platform-effects.test.ts
tests/unit/target/uefi-aarch64/sealed-platform-catalog.test.ts
tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts
tests/integration/semantic/name-resolution.test.ts
tests/fixtures/diagnostics/platform-capabilities/
tests/fixtures/full-image-validation/
```

---

## Parallelization Map

Wave 1 establishes the new semantic surface and legacy cutoff. These tasks can be split across subagents, but merge Task 1 first because other tasks import its types.

```text
Wave 1:
  Task 1 -> Task 2 -> Task 3
  Task 4 can run alongside Task 1, then rebase after Task 3

Wave 2:
  Task 5 -> Task 6
  Task 7 and Task 8 depend on Task 6 and can run in parallel
  Task 9 depends on Task 6 and can run in parallel with Tasks 7 and 8

Wave 3:
  Task 10 depends on Tasks 7, 8, and 9
  Task 11 depends on Task 10
  Task 12 depends on Task 11
  Task 13 depends on Task 11
  Task 14 depends on Task 13

Wave 4:
  Task 15 depends on Tasks 1, 3, 7, 8, and 9
  Task 16 depends on Tasks 4 and 15
  Task 17 depends on Tasks 10 through 16
  Task 18 depends on all prior tasks
```

---

## Task 1: Add Sealed Capability Catalog Types

- [ ] **Description**

Add explicit target-surface types for sealed regions, sealed callables, sealed region fields, effect summaries, ordering classes, owner binding, and service identity. This task only defines the catalog model and fake helpers. It must not change parser behavior, HIR lowering, or target catalogs.

Modify:

- `src/semantic/ids.ts`
- `src/semantic/surface/platform-surface.ts`
- `src/semantic/surface/index.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`
- Create `tests/unit/semantic/surface/sealed-capability-catalog.test.ts`

- [ ] **Acceptance Criteria**

- `SemanticTargetSurface` has `sealedRegions` and `sealedCallables`.
- Region and callable specs are immutable readonly data with deterministic IDs.
- Catalog constructors or fake helpers reject duplicate target type IDs, duplicate field names within a region, and duplicate callable target type IDs.
- Existing target surfaces can be constructed with empty sealed capability lists.
- No source language behavior changes in this task.

- [ ] **Code Examples**

Catalog shape to implement:

```ts
export type SealedCapabilityKind = "region" | "callable";

export type RegionFieldAccess = "read" | "write" | "readWrite";

export type RegionAccessOrdering = "plain" | "deviceOrdered" | "acquireCommit" | "releaseCommit";

export type OwnerReceiverMode = "observe" | "consume" | "terminal";

export interface SealedRegionFieldSpec {
  readonly fieldKey: string;
  readonly name: string;
  readonly valueType: TargetFunctionSignatureType;
  readonly access: RegionFieldAccess;
  readonly ordering: RegionAccessOrdering;
  readonly offsetKey: string;
  readonly requiredPredicates: readonly PlatformPredicateRequirementSpec[];
  readonly effects: readonly PlatformEffectSpec[];
}

export interface SealedRegionSpec {
  readonly regionId: SealedRegionId;
  readonly targetTypeId: TargetTypeId;
  readonly ownerArgumentIndex: number;
  readonly fields: readonly SealedRegionFieldSpec[];
}

export interface SealedCallableSpec {
  readonly callableId: SealedCallableId;
  readonly targetTypeId: TargetTypeId;
  readonly ownerArgumentIndex: number;
  readonly receiverMode: OwnerReceiverMode;
  readonly signature: TargetFunctionSignature;
  readonly serviceIdentity: PlatformServiceId;
  readonly requiredPredicates: readonly PlatformPredicateRequirementSpec[];
  readonly effects: readonly PlatformEffectSpec[];
}

export interface SemanticTargetSurface {
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
  readonly targetTypeKinds: readonly TargetTypeKindSpec[];
  readonly sealedRegions: readonly SealedRegionSpec[];
  readonly sealedCallables: readonly SealedCallableSpec[];
}
```

Expected fake helper shape:

```ts
export function sealedRegionSpecFake(overrides: Partial<SealedRegionSpec> = {}): SealedRegionSpec;

export function sealedCallableSpecFake(
  overrides: Partial<SealedCallableSpec> = {},
): SealedCallableSpec;
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/sealed-capability-catalog.test.ts
```

---

## Task 2: Teach Target Type Checking About Sealed Capability Types

- [ ] **Description**

Extend target type metadata so sealed capability target types can be generic over their owner edge class. The source syntax remains named target type application, for example `MmioRegion[UartMmio]` and `UefiOutputStringFn[Console]`.

Modify:

- `src/semantic/surface/platform-surface.ts`
- `src/semantic/surface/type-reference-checker.ts`
- `src/semantic/surface/resource-kind-checker.ts`
- `src/semantic/names/name-resolver.ts`
- `tests/unit/semantic/surface/type-reference-checker.test.ts`

- [ ] **Acceptance Criteria**

- Target type metadata includes generic arity, resource kind, and source constructibility.
- `MmioRegion[UartMmio]` type-checks when the catalog declares arity `1`.
- `MmioRegion`, `MmioRegion[A, B]`, and `UnknownRegion[Owner]` produce deterministic diagnostics.
- Source code cannot construct sealed region or sealed callable values with literals, constructors, or default values.
- Existing zero-arity target types continue to type-check.

- [ ] **Code Examples**

Target type metadata shape:

```ts
export type TargetTypeConstructibility = "sourceConstructible" | "targetSealed";

export interface TargetTypeKindSpec {
  readonly targetTypeId: TargetTypeId;
  readonly kind: CheckedResourceKind;
  readonly genericArity: number;
  readonly constructibility: TargetTypeConstructibility;
}
```

Wrela examples to cover:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]
```

```wr
edge class BadRegion:
    region: MmioRegion
```

Expected diagnostic shape:

```ts
{
  code: "SURFACE_TARGET_TYPE_ARITY_MISMATCH",
  details: {
    typeName: "MmioRegion",
    expected: 1,
    actual: 0,
  },
}
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/type-reference-checker.test.ts
```

---

## Task 3: Certify Sealed Capability Fields On Edge Classes

- [ ] **Description**

Add semantic certification for fields whose declared types are sealed region or sealed callable target types. Certification proves that the field belongs to an `edge class`, that the owner type argument matches the containing edge class, and that the field can be used as a provenance-bearing capability.

Modify:

- Create `src/semantic/surface/sealed-capability-certifier.ts`
- `src/semantic/surface/checked-program.ts`
- `src/semantic/surface/semantic-surface-checker.ts`
- `src/semantic/surface/diagnostics.ts`
- `src/semantic/surface/index.ts`
- `tests/unit/semantic/surface/sealed-capability-certifier.test.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`

- [ ] **Acceptance Criteria**

- `CheckedProgram` contains certified sealed region field records and certified sealed callable field records.
- A sealed capability field outside an `edge class` is rejected.
- A sealed capability field with a mismatched owner argument is rejected.
- An owner-bound callable field must use the containing edge class as its owner argument.
- Certification output is deterministic and keyed by source field ID.

- [ ] **Code Examples**

Checked records to add:

```ts
export interface CertifiedSealedRegionField {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly regionId: SealedRegionId;
  readonly targetTypeId: TargetTypeId;
  readonly ownerArgumentType: CheckedType;
}

export interface CertifiedSealedCallableField {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly callableId: SealedCallableId;
  readonly targetTypeId: TargetTypeId;
  readonly ownerArgumentType: CheckedType;
  readonly receiverMode: OwnerReceiverMode;
}
```

Wrela examples:

```wr
edge class Console:
    output_string: UefiOutputStringFn[Console]
```

```wr
data class BadConsole:
    output_string: UefiOutputStringFn[BadConsole]
```

```wr
edge class WrongOwner:
    output_string: UefiOutputStringFn[OtherConsole]
```

Expected diagnostics:

```ts
["SURFACE_SEALED_CAPABILITY_FIELD_REQUIRES_EDGE_CLASS", "SURFACE_SEALED_CAPABILITY_OWNER_MISMATCH"];
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/sealed-capability-certifier.test.ts
```

---

## Task 4: Reject Legacy Source `platform fn`

- [ ] **Description**

Hard-cut source-authored `platform fn`. The lexer may continue to recognize `platform` as a keyword so diagnostics can be precise, but the semantic pipeline must reject every source `platform fn` declaration and must not create certified platform bindings from source functions.

Modify:

- `src/semantic/names/platform-binding.ts`
- `src/semantic/names/platform-primitives.ts`
- `src/semantic/names/diagnostics.ts`
- `src/semantic/surface/platform-certifier.ts`
- `src/semantic/surface/diagnostics.ts`
- `tests/integration/semantic/name-resolution.test.ts`
- `tests/unit/semantic/surface/platform-certifier.test.ts`
- Add fixtures under `tests/fixtures/diagnostics/platform-capabilities/`

- [ ] **Acceptance Criteria**

- Freestanding `platform fn` declarations produce `NAME_LEGACY_PLATFORM_FN`.
- Method-shaped `platform fn` declarations produce `NAME_LEGACY_PLATFORM_FN`, not the old method-only diagnostic.
- No `CertifiedPlatformBinding` entries are created from source declarations.
- The old primitive name catalog is not used for source name binding.
- Existing invalid fixture generation produces stable diagnostics for legacy platform functions.

- [ ] **Code Examples**

Legacy source that must fail:

```wr
platform fn output_string(message: UefiUtf16Static) -> UefiStatus
```

Expected name binding behavior:

```ts
expect(result.platformBindings.entries()).toEqual([]);
expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
  "NAME_LEGACY_PLATFORM_FN",
);
```

Expected diagnostic:

```ts
{
  code: "NAME_LEGACY_PLATFORM_FN",
  message:
    "source platform functions have been removed; use target-sealed edge capabilities instead",
}
```

- [ ] **Commands**

```bash
bun test tests/integration/semantic/name-resolution.test.ts
bun test tests/unit/semantic/surface/platform-certifier.test.ts
```

---

## Task 5: Resolve Sealed Region Members In Name Resolution

- [ ] **Description**

Allow member chains such as `self.region.data` to survive name resolution when `region` is a sealed region field and `data` is a catalog field. Name resolution should still report ordinary unknown source members. This task records enough information for HIR to perform the typed catalog lookup.

Modify:

- `src/semantic/names/reference.ts`
- `src/semantic/names/expression-resolver/member-chain-resolver.ts`
- `src/semantic/names/name-resolver.ts`
- `tests/unit/semantic/names/sealed-member-resolution.test.ts`

- [ ] **Acceptance Criteria**

- `self.region.data` has no name-resolution diagnostic when `region` is a certified sealed region field and `data` exists in the region spec.
- `self.region.unknown_data` produces a deterministic diagnostic.
- `self.unknown_field` still produces the existing unresolved-member diagnostic.
- The resolver does not invent source fields for sealed region pseudo-fields.

- [ ] **Code Examples**

Reference shape:

```ts
export type ResolvedMemberReference =
  | SourceFieldReference
  | ImageDeviceFieldReference
  | TargetSealedRegionFieldReference;

export interface TargetSealedRegionFieldReference {
  readonly kind: "targetSealedRegionField";
  readonly receiverFieldId: FieldId;
  readonly regionId: SealedRegionId;
  readonly fieldKey: string;
  readonly memberName: string;
}
```

Wrela examples:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn read(self) -> u8:
        self.region.data
```

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn read(self) -> u8:
        self.region.unknown_data
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/names/sealed-member-resolution.test.ts
```

---

## Task 6: Generalize HIR Platform Contract Edges

- [ ] **Description**

Replace function-only platform contract edge metadata with an operation-source model that can represent sealed region reads, sealed region writes, sealed callable calls, and existing compiler-owned target operations. Preserve the public fake helpers used by existing tests by mapping their legacy function-shaped input into `compilerOwnedTargetOperation` test records.

Modify:

- `src/hir/hir.ts`
- `src/hir/proof-metadata.ts`
- `src/hir/call-lowerer.ts`
- `tests/support/hir/typed-hir-fakes.ts`
- Add `tests/unit/hir/platform-contract-edge-model.test.ts`

- [ ] **Acceptance Criteria**

- `HirPlatformContractEdge` has a discriminated `sourceKind`.
- Existing source calls that do not use sealed capabilities continue to lower.
- Compiler-owned runtime and intrinsic calls can still be represented.
- Tests can construct fake sealed region and sealed callable HIR edges.

- [ ] **Code Examples**

HIR edge shape:

```ts
export type HirPlatformContractSourceKind =
  | {
      readonly kind: "sealedRegionRead";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly authorizingPlace: HirResourcePlace;
      readonly ordering: RegionAccessOrdering;
    }
  | {
      readonly kind: "sealedRegionWrite";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly authorizingPlace: HirResourcePlace;
      readonly ordering: RegionAccessOrdering;
    }
  | {
      readonly kind: "sealedCallableCall";
      readonly callableId: SealedCallableId;
      readonly serviceIdentity: PlatformServiceId;
      readonly authorizingPlace: HirResourcePlace;
      readonly receiverMode: OwnerReceiverMode;
    }
  | {
      readonly kind: "compilerOwnedTargetOperation";
      readonly operationId: CompilerOwnedTargetOperationId;
    };

export interface HirPlatformContractEdge {
  readonly edgeId: HirPlatformContractEdgeId;
  readonly targetId: TargetId;
  readonly sourceKind: HirPlatformContractSourceKind;
  readonly contractId: PlatformContractId;
  readonly requirements: readonly HirPlatformRequirementId[];
  readonly ensuredFacts: readonly HirEnsuredFact[];
}
```

- [ ] **Commands**

```bash
bun test tests/unit/hir/platform-contract-edge-model.test.ts
```

---

## Task 7: Lower Sealed Region Reads To HIR

- [ ] **Description**

Lower catalog-backed sealed region field reads such as `self.region.data` into typed HIR expressions and HIR platform contract edges. Reads are ordinary expressions in source but effectful operations in proof and optimization layers.

Modify:

- `src/hir/expression-lowerer.ts`
- `src/hir/hir.ts`
- `src/hir/diagnostics.ts`
- `tests/unit/hir/sealed-region-read-lowering.test.ts`

- [ ] **Acceptance Criteria**

- A readable sealed region field lowers to a HIR expression with the catalog field value type.
- Lowering records a `sealedRegionRead` platform edge with the authorizing edge place.
- Reading a write-only region field emits `HIR_SEALED_REGION_FIELD_NOT_READABLE`.
- Reading through a copied or detached region value is rejected if the catalog marks the region owner-bound.
- The HIR expression has stable IDs for downstream proof metadata.

- [ ] **Code Examples**

HIR expression shape:

```ts
export interface HirSealedRegionReadExpression {
  readonly kind: "sealedRegionRead";
  readonly receiver: HirExpressionId;
  readonly regionId: SealedRegionId;
  readonly fieldKey: string;
  readonly platformEdgeId: HirPlatformContractEdgeId;
}
```

Wrela source:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn read_data(self) -> u8:
        self.region.data
```

Expected assertion:

```ts
expect(readExpression.kind.kind).toBe("sealedRegionRead");
expect(platformEdge.sourceKind).toEqual({
  kind: "sealedRegionRead",
  regionId: mmioRegionId,
  fieldKey: "data",
  authorizingPlace: selfPlace,
  ordering: "deviceOrdered",
});
```

- [ ] **Commands**

```bash
bun test tests/unit/hir/sealed-region-read-lowering.test.ts
```

---

## Task 8: Lower Sealed Region Writes To HIR

- [ ] **Description**

Lower assignments to catalog-backed sealed region fields such as `self.region.data = byte` into HIR statements and HIR platform contract edges. Writes must be visible to proof and optimization as mutating operations against a specific sealed region capability.

Modify:

- `src/hir/statement-lowerer.ts`
- `src/hir/expression-lowerer.ts`
- `src/hir/hir.ts`
- `src/hir/diagnostics.ts`
- `tests/unit/hir/sealed-region-write-lowering.test.ts`

- [ ] **Acceptance Criteria**

- A writable sealed region field assignment lowers to a `sealedRegionWrite` HIR statement or effectful expression.
- Lowering records a `sealedRegionWrite` platform edge with the authorizing edge place.
- Assigning a value whose type does not match the region field type emits the existing assignment type diagnostic.
- Writing a read-only region field emits `HIR_SEALED_REGION_FIELD_NOT_WRITABLE`.
- Writes invalidate region-private facts in the HIR proof metadata.

- [ ] **Code Examples**

HIR statement shape:

```ts
export interface HirSealedRegionWriteStatement {
  readonly kind: "sealedRegionWrite";
  readonly receiver: HirExpressionId;
  readonly value: HirExpressionId;
  readonly regionId: SealedRegionId;
  readonly fieldKey: string;
  readonly platformEdgeId: HirPlatformContractEdgeId;
}
```

Wrela source:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn write_data(self, byte: u8) -> UartMmio:
        self.region.data = byte
        self
```

Expected assertion:

```ts
expect(writeStatement.kind).toBe("sealedRegionWrite");
expect(platformEdge.sourceKind.kind).toBe("sealedRegionWrite");
expect(platformEdge.sourceKind.fieldKey).toBe("data");
```

- [ ] **Commands**

```bash
bun test tests/unit/hir/sealed-region-write-lowering.test.ts
```

---

## Task 9: Lower Sealed Callable Calls To HIR

- [ ] **Description**

Lower calls through certified sealed callable fields such as `self.output_string(message)`. These calls are ordinary source calls syntactically, but semantically they call target-sealed services with catalog signatures, receiver ownership rules, proof requirements, and effect summaries.

Modify:

- `src/hir/call-callee-resolver.ts`
- `src/hir/call-lowerer.ts`
- `src/hir/expression-lowerer.ts`
- `src/hir/diagnostics.ts`
- `tests/unit/hir/sealed-callable-lowering.test.ts`

- [ ] **Acceptance Criteria**

- A sealed callable field can be invoked with ordinary call syntax.
- Arguments are checked against the catalog signature.
- `observe`, `consume`, and `terminal` receiver modes are enforced.
- Calls through detached owner-bound callable values are rejected.
- Lowering records a `sealedCallableCall` HIR platform edge with service identity and authorizing place.

- [ ] **Code Examples**

Wrela source:

```wr
edge class Console:
    output_string: UefiOutputStringFn[Console]

    fn write(self, message: UefiUtf16Static) -> Console:
        self.output_string(message)
        self
```

Expected HIR edge assertion:

```ts
expect(platformEdge.sourceKind).toEqual({
  kind: "sealedCallableCall",
  callableId: outputStringCallableId,
  serviceIdentity: uefiOutputStringServiceId,
  authorizingPlace: selfPlace,
  receiverMode: "observe",
});
```

Receiver-mode examples:

```wr
edge class BootServices:
    exit_boot_services: UefiExitBootServicesFn[BootServices]

    fn exit(self, image: ImageHandle, map_key: MemoryMapKey) -> Never:
        self.exit_boot_services(image, map_key)
```

```ts
expect(platformEdge.sourceKind.receiverMode).toBe("terminal");
```

- [ ] **Commands**

```bash
bun test tests/unit/hir/sealed-callable-lowering.test.ts
```

---

## Task 10: Carry Sealed Platform Edges Through Monomorphization

- [ ] **Description**

Update monomorphization so sealed region reads, sealed region writes, and sealed callable calls are preserved as monomorphic platform edges. The key must be based on the caller instance, operation identity, and source kind, not on a source platform function.

Modify:

- `src/mono/mono-hir.ts`
- `src/mono/platform-contract-edge.ts`
- `src/mono/reachability/work-items.ts`
- `tests/unit/mono/sealed-platform-edges.test.ts`

- [ ] **Acceptance Criteria**

- Monomorphic HIR includes sealed platform operation edges for reachable source functions.
- Sealed region operations do not enqueue fake platform function bodies.
- Edge keys are deterministic across repeated builds.
- Existing compiler-owned runtime call reachability continues to work.
- Tests cover one generic edge class instantiated with two concrete owner types and produce distinct monomorphic platform edges.

- [ ] **Code Examples**

Monomorphic edge shape:

```ts
export interface MonoPlatformContractEdge {
  readonly edgeId: MonoPlatformContractEdgeId;
  readonly sourceHirEdgeId: HirPlatformContractEdgeId;
  readonly callerInstanceId: MonoFunctionInstanceId;
  readonly targetId: TargetId;
  readonly sourceKind: MonoPlatformContractSourceKind;
  readonly contractId: PlatformContractId;
}
```

Key example:

```ts
const key = monoPlatformContractEdgeKey({
  callerInstanceId,
  sourceHirEdgeId,
  sourceKind,
  ownerSubstitution,
});
```

- [ ] **Commands**

```bash
bun test tests/unit/mono/sealed-platform-edges.test.ts
```

---

## Task 11: Add Layout ABI Facts For Sealed Operations

- [ ] **Description**

Extend layout and platform ABI metadata so sealed region field accesses and sealed callable calls have target-owned lowering facts. Layout must know region base representation, field offsets, ordering requirements, callable pointer representation, and ABI call details.

Modify:

- `src/layout/platform-abi.ts`
- `src/layout/layout-program.ts`
- `src/target/uefi-aarch64/platform-catalog.ts`
- Add `tests/unit/layout/sealed-platform-abi.test.ts`

- [ ] **Acceptance Criteria**

- Each sealed region field has a layout ABI fact with offset key, value size/alignment, and ordering.
- Each sealed callable has a layout ABI fact with callable pointer representation and call ABI.
- Missing layout facts produce deterministic target diagnostics.
- Existing platform ABI facts for runtime helpers continue to load.

- [ ] **Code Examples**

Layout fact shape:

```ts
export type LayoutSealedPlatformAbiFact =
  | {
      readonly kind: "sealedRegionField";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly baseRepresentation: "address";
      readonly offsetKey: string;
      readonly valueLayoutId: LayoutTypeId;
      readonly ordering: RegionAccessOrdering;
    }
  | {
      readonly kind: "sealedCallable";
      readonly callableId: SealedCallableId;
      readonly pointerRepresentation: "firmwareServicePointer";
      readonly abi: TargetCallAbiId;
      readonly serviceIdentity: PlatformServiceId;
    };
```

UEFI catalog example:

```ts
{
  kind: "sealedCallable",
  callableId: uefiOutputStringCallableId,
  pointerRepresentation: "firmwareServicePointer",
  abi: uefiAArch64FirmwareServiceAbiId,
  serviceIdentity: uefiOutputStringServiceId,
}
```

- [ ] **Commands**

```bash
bun test tests/unit/layout/sealed-platform-abi.test.ts
```

---

## Task 12: Lower Sealed Operations Into Proof MIR

- [ ] **Description**

Make Proof MIR represent sealed region reads, sealed region writes, and sealed callable calls directly. Proof MIR should not pretend sealed operations are source functions. Callable calls may use call-target machinery, while region operations need explicit operation records because they are field accesses and assignments in source.

Modify:

- `src/proof-mir/model/program.ts`
- `src/proof-mir/model/calls.ts`
- `src/proof-mir/lower/call-lowerer.ts`
- `src/proof-mir/domains/call-targets.ts`
- Add `tests/unit/proof-mir/sealed-platform-operations.test.ts`

- [ ] **Acceptance Criteria**

- Proof MIR contains a platform operation record for each sealed region read and write.
- Proof MIR call targets include sealed callable calls with service identity and receiver mode.
- Platform operations retain the authorizing place from HIR.
- Lowering fails with a deterministic diagnostic if a HIR sealed edge has no monomorphic edge.

- [ ] **Code Examples**

Proof MIR model:

```ts
export type ProofMirPlatformOperationKind =
  | {
      readonly kind: "sealedRegionRead";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly authorizingPlace: ProofMirPlaceId;
    }
  | {
      readonly kind: "sealedRegionWrite";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly authorizingPlace: ProofMirPlaceId;
      readonly value: ProofMirValueId;
    };

export interface ProofMirPlatformOperation {
  readonly operationId: ProofMirPlatformOperationId;
  readonly monoPlatformEdgeId: MonoPlatformContractEdgeId;
  readonly kind: ProofMirPlatformOperationKind;
}
```

Callable target:

```ts
export type ProofMirCallTarget =
  | SourceFunctionProofMirCallTarget
  | SealedCallableProofMirCallTarget
  | CompilerRuntimeProofMirCallTarget;

export interface SealedCallableProofMirCallTarget {
  readonly kind: "sealedCallable";
  readonly monoPlatformEdgeId: MonoPlatformContractEdgeId;
  readonly callableId: SealedCallableId;
  readonly serviceIdentity: PlatformServiceId;
}
```

- [ ] **Commands**

```bash
bun test tests/unit/proof-mir/sealed-platform-operations.test.ts
```

---

## Task 13: Enforce Sealed Operation Effects In Proof Check

- [ ] **Description**

Teach the proof checker to evaluate sealed operation contracts from the target catalog. Reads observe a sealed region, writes mutate it and invalidate dependent facts, and callable calls apply catalog effect summaries and receiver-mode ownership transitions.

Modify:

- `src/proof-check/domains/platform-contract-transfer.ts`
- `src/proof-check/domains/platform-contract-effects.ts`
- Add `tests/unit/proof-check/sealed-platform-effects.test.ts`

- [ ] **Acceptance Criteria**

- A sealed region read requires the catalog predicates for that field.
- A sealed region write requires write permission and advances private region state.
- Facts depending on old region state are unavailable after a write.
- A sealed callable with `consume` mode consumes the owner capability.
- A sealed callable with `terminal` mode prevents use of the owner after the call.
- Proof diagnostics identify the failing sealed operation by region/callable ID and source span.

- [ ] **Code Examples**

Effect transfer sketch:

```ts
switch (operation.kind.kind) {
  case "sealedRegionRead":
    requirePredicates(operation.kind.regionId, operation.kind.fieldKey);
    observeRegion(operation.kind.authorizingPlace);
    break;
  case "sealedRegionWrite":
    requirePredicates(operation.kind.regionId, operation.kind.fieldKey);
    mutateRegion(operation.kind.authorizingPlace);
    advancePrivateState(operation.kind.authorizingPlace);
    break;
}
```

Test source:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn write_then_use_old_fact(self, byte: u8) -> UartMmio:
        requires self.region.writeable
        self.region.data = byte
        prove self.region.old_value_still_valid
        self
```

Expected diagnostic:

```ts
expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
  "PROOF_REGION_FACT_INVALIDATED_BY_SEALED_WRITE",
);
```

- [ ] **Commands**

```bash
bun test tests/unit/proof-check/sealed-platform-effects.test.ts
```

---

## Task 14: Represent Sealed Effects In Opt IR

- [ ] **Description**

Lower sealed platform operations into Opt IR operations whose effects are visible to optimization. Region reads and writes must carry alias/effect tokens so they cannot be reordered across conflicting operations or deleted as pure code. Sealed callable calls use catalog effect summaries.

Modify:

- `src/opt-ir/operation-effects.ts`
- `src/opt-ir/lower/call-lowering.ts`
- `src/opt-ir/lower/region-builder.ts`
- Add `tests/unit/opt-ir/sealed-platform-effects.test.ts`

- [ ] **Acceptance Criteria**

- Opt IR has effectful operations for sealed region reads and writes.
- A sealed region write is not removed by dead-code elimination when its value result is unused.
- A sealed region read is not moved across a write to the same sealed region field.
- Independent sealed regions can still be reordered when the existing optimizer allows it.
- Sealed callable calls expose catalog call effects to the optimizer.

- [ ] **Code Examples**

Opt IR operation shape:

```ts
export type OptIrPlatformOperation =
  | {
      readonly kind: "sealedRegionRead";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly effectToken: OptIrEffectTokenId;
      readonly result: OptIrValueId;
    }
  | {
      readonly kind: "sealedRegionWrite";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly effectToken: OptIrEffectTokenId;
      readonly value: OptIrValueId;
    }
  | {
      readonly kind: "sealedCallableCall";
      readonly callableId: SealedCallableId;
      readonly effectToken: OptIrEffectTokenId;
      readonly arguments: readonly OptIrValueId[];
    };
```

Effect rule:

```ts
case "sealedRegionWrite":
  return {
    reads: orderedRegionTokens(operation.regionId),
    writes: orderedRegionTokens(operation.regionId),
    calls: [],
  };
```

- [ ] **Commands**

```bash
bun test tests/unit/opt-ir/sealed-platform-effects.test.ts
```

---

## Task 15: Lower Sealed Operations In The UEFI AArch64 Target

- [ ] **Description**

Teach the UEFI AArch64 target to lower sealed region reads, sealed region writes, and sealed callable calls from Opt IR using target-owned lowering templates. This preserves the design constraint: source Wrela does not contain assembly or machine IR.

Modify:

- `src/target/uefi-aarch64/platform-catalog.ts`
- `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`
- `src/target/uefi-aarch64/target-surfaces.ts`
- `src/target/uefi-aarch64/firmware-lowering.ts`
- `src/target/uefi-aarch64/binary-spine.ts`
- `src/target/aarch64/lower/operation-materialization.ts`
- `src/target/aarch64/lower/operation-support.ts`
- `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Add `tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts`

- [ ] **Acceptance Criteria**

- Sealed region reads lower to target-owned load operations using catalog ABI facts.
- Sealed region writes lower to target-owned store operations using catalog ABI facts.
- Sealed callable calls lower to the existing firmware service call ABI through authenticated sealed callable representation.
- No source `asm`, `machine`, or source-authored target instruction syntax is introduced.
- Unit tests assert lowering evidence at the machine IR or target operation level, not textual assembly.

- [ ] **Code Examples**

Lowering rule shape:

```ts
export type UefiAArch64SealedPlatformLoweringRule =
  | {
      readonly kind: "sealedRegionRead";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly loadWidth: TargetLoadStoreWidth;
      readonly ordering: RegionAccessOrdering;
    }
  | {
      readonly kind: "sealedRegionWrite";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
      readonly storeWidth: TargetLoadStoreWidth;
      readonly ordering: RegionAccessOrdering;
    }
  | {
      readonly kind: "sealedCallableCall";
      readonly callableId: SealedCallableId;
      readonly abi: TargetCallAbiId;
      readonly serviceIdentity: PlatformServiceId;
    };
```

Expected test assertion:

```ts
expect(lowered.operations).toContainEqual(
  expect.objectContaining({
    kind: "targetLoad",
    ordering: "deviceOrdered",
    sourceRegionId: mmioRegionId,
  }),
);
```

- [ ] **Commands**

```bash
bun test tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts
```

---

## Task 16: Migrate UEFI Target Catalog To Sealed Capabilities

- [ ] **Description**

Replace the UEFI target's source primitive surface with sealed region and sealed callable catalog entries. Current firmware services and validation/source API bridge operations should be represented as target-sealed values owned by edge classes.

Modify:

- `src/target/uefi-aarch64/platform-catalog.ts`
- `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`
- Create `tests/unit/target/uefi-aarch64/sealed-platform-catalog.test.ts`
- Update `tests/unit/target/uefi-aarch64/platform-catalog.test.ts`

- [ ] **Acceptance Criteria**

- UEFI output string, watchdog timer, exit boot services, memory map, validation stream, and source API bridge capabilities are cataloged as sealed callables or sealed regions.
- `uefiAArch64PlatformPrimitiveNameCatalog()` returns no source-bindable primitive names.
- Package-specific bridge wiring mutates sealed callable signatures where it previously mutated platform primitive signatures.
- Existing target IDs and service identities remain stable where fixtures depend on them.

- [ ] **Code Examples**

Callable catalog entries:

```ts
const uefiOutputStringCallable: SealedCallableSpec = {
  callableId: uefiOutputStringCallableId,
  targetTypeId: uefiOutputStringFnTypeId,
  ownerArgumentIndex: 0,
  receiverMode: "observe",
  signature: {
    parameters: [{ name: "message", type: targetType("UefiUtf16Static") }],
    returnType: targetType("UefiStatus"),
  },
  serviceIdentity: uefiOutputStringServiceId,
  requiredPredicates: [],
  effects: [{ kind: "firmwareCall", service: uefiOutputStringServiceId }],
};
```

Source shape after migration:

```wr
edge class Console:
    output_string: UefiOutputStringFn[Console]

    fn write(self, message: UefiUtf16Static) -> Console:
        self.output_string(message)
        self
```

- [ ] **Commands**

```bash
bun test tests/unit/target/uefi-aarch64
```

---

## Task 17: Migrate Fixtures And Full-Image Validation Evidence

- [ ] **Description**

Update source fixtures and validation reference checkers so full-image validation proves sealed platform operation provenance instead of scanning `platform fn` declarations. This includes the packet-counter toolchain stdlib fixture that motivated the design work.

Modify:

- `tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter/direct-platform/`
- `tests/fixtures/full-image-validation/packet-counter/ejected-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/toolchain-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/direct-platform/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/ejected-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-bad-payload/toolchain-stdlib/`
- `tests/fixtures/full-image-validation/smoke-console/direct-platform/`
- `tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/`
- `tests/fixtures/full-image-validation/two-branch-control-flow/direct-platform/`
- `tests/fixtures/full-image-validation/two-branch-control-flow/ejected-stdlib/`
- `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-fixtures.ts`
- `src/validation/full-image/reference-checkers/proof-fact-reference.ts`
- `src/validation/full-image/reference-checkers/opt-ir-reference.ts`
- `src/validation/full-image/determinism.ts`
- Scorecard baselines under each migrated fixture directory

- [ ] **Acceptance Criteria**

- No passing full-image fixture declares `platform fn`.
- The semantic platform reference checker reads compiler-produced sealed operation inventory.
- The checker reports sealed callable calls by service identity and sealed region accesses by region ID and field key.
- Packet-counter toolchain stdlib fixture uses sealed edge fields and ordinary calls/accesses.
- Full-image validation tests pass for packet-counter and existing UEFI fixtures.

- [ ] **Code Examples**

Inventory shape:

```ts
export interface SemanticPlatformOperationInventory {
  readonly sealedCallableCalls: readonly {
    readonly callableId: SealedCallableId;
    readonly serviceIdentity: PlatformServiceId;
    readonly sourceSpan: SourceSpan;
  }[];
  readonly sealedRegionAccesses: readonly {
    readonly regionId: SealedRegionId;
    readonly fieldKey: string;
    readonly access: "read" | "write";
    readonly sourceSpan: SourceSpan;
  }[];
}
```

Reference checker expectation:

```ts
expect(reference.semanticPlatform.sealedCallableCalls).toContainEqual({
  serviceIdentity: "uefi.output_string",
  ownerTypeName: "Console",
});
```

Migration search command for this task:

```bash
rg -n "platform\s+fn|platform fn" tests/fixtures/full-image-validation src docs/language
```

- [ ] **Commands**

```bash
bun test tests/integration/full-image-validation.test.ts
```

---

## Task 18: Remove Legacy Reachability And Finish Compatibility Audit

- [ ] **Description**

Remove or isolate legacy `platform fn` reachability and reporting paths after sealed capability execution is complete. The final codebase should make the new architecture obvious: source platform functions are invalid, sealed platform operations are the supported path, and compiler-owned target operations remain target-owned.

Modify:

- `src/semantic/surface/platform-certifier.ts`
- `src/semantic/names/platform-binding.ts`
- `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts`
- Existing tests that assert certified source platform binding success:
  - `tests/unit/semantic/surface/platform-certifier.test.ts`
  - `tests/integration/semantic/name-resolution.test.ts`

- [ ] **Acceptance Criteria**

- No production code path creates `CertifiedPlatformBinding` from a source `platform fn`.
- Legacy platform-binding types remain only if they are required for invalid diagnostics or target-internal compatibility; their comments state that source platform functions are rejected.
- Repository search shows no passing fixture using `platform fn`.
- Repository search shows no parser or semantic acceptance path for source `asm` or `machine`.
- `bun run agent:check` passes.

- [ ] **Code Examples**

Audit commands and expected interpretation:

```bash
rg -n "CertifiedPlatformBinding|platformBindings|platform fn|platform\s+fn" src tests docs
rg -n "\basm\b|\bmachine\b" src tests docs
```

Acceptable remaining hits:

```text
docs/design/edge-platform-assembly-design.md
tests/fixtures/diagnostics/platform-capabilities/legacy-platform-fn.wr
src/semantic/names/diagnostics.ts
src/semantic/surface/diagnostics.ts
```

Unacceptable remaining hits:

```text
tests/fixtures/full-image-validation/**/stdlib.wr: platform fn output_string
src/semantic/surface/platform-certifier.ts: returns CertifiedPlatformBinding for a source function
src/frontend/parser/**: accepts asm blocks
```

- [ ] **Commands**

```bash
bun run format
bun run agent:check
```

---

## Final Verification Checklist

- [ ] `bun run format`
- [ ] `bun run agent:check`
- [ ] `rg -n "platform\s+fn|platform fn" tests/fixtures/full-image-validation src`
- [ ] `rg -n "\basm\b|\bmachine\b" src/frontend src/semantic src/hir`
- [ ] Confirm remaining `platform fn` hits are invalid fixtures, diagnostics, or historical design text.
- [ ] Confirm no implementation accepts source-authored assembly, source-authored machine IR, or source-authored platform functions.
