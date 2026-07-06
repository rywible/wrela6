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
- `checkTypeReference` currently has no `targetSurface` input. Target type arity cannot be implemented inside `type-reference-checker.ts` until `SemanticTargetSurface` is threaded through `dataclass-resource-checker.ts`, `signature-checker.ts`, `generic-checker.ts`, recursive type-argument checks, and test fakes.
- HIR member lowering currently only knows source fields and special image device members. Sealed region pseudo-fields need catalog-backed member lowering from target type metadata.
- Name resolution is the wrong layer for sealed region field completion. `member-chain-resolver.ts` returns early for local bases such as `self`, and target types do not have source `ItemId` owners. Sealed member completion belongs in typed HIR lowering, where receiver types and certified edge fields are known.
- Target-sealed values need explicit provisioning. If source cannot construct sealed capability values, the target/package pipeline must seed entry edge objects, firmware service handles, MMIO regions, validation streams, and source API bridge handles from target-owned capability records.
- Full-image semantic platform reference checking currently scans source text with a `platform fn` regex. It must be replaced with compiler-produced sealed operation inventory.
- Production stdlib and many tests still contain `platform fn`. The hard cutoff must migrate `stdlib/wrela-std`, UEFI fixture copies, semantic tests, HIR tests, mono/layout/proof-check tests, target integration tests, and full-image reference checker tests before the final audit can pass.
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
src/semantic/surface/sealed-capability-provisioning.ts
src/semantic/surface/diagnostics.ts
src/semantic/surface/index.ts
src/semantic/names/platform-binding.ts
src/semantic/names/platform-primitives.ts
src/hir/hir.ts
src/hir/expression-lowerer.ts
src/hir/statement-lowerer.ts
src/hir/call-callee-resolver.ts
src/hir/call-lowerer.ts
src/hir/sealed-member-lookup.ts
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
stdlib/wrela-std/target/uefi/console.wr
stdlib/wrela-std/target/uefi/watchdog.wr
stdlib/wrela-std/target/uefi/memory.wr
stdlib/wrela-std/target/uefi/firmware.wr
tests/support/semantic/semantic-surface-fakes.ts
tests/support/hir/typed-hir-fakes.ts
tests/support/mono/monomorphization-fixtures.ts
tests/support/layout/layout-fixtures.ts
tests/unit/semantic/surface/sealed-capability-catalog.test.ts
tests/unit/semantic/surface/sealed-capability-certifier.test.ts
tests/unit/semantic/surface/sealed-capability-provisioning.test.ts
tests/unit/semantic/surface/type-reference-checker.test.ts
tests/unit/hir/sealed-member-lookup.test.ts
tests/unit/hir/sealed-region-read-lowering.test.ts
tests/unit/hir/sealed-region-write-lowering.test.ts
tests/unit/hir/sealed-callable-lowering.test.ts
tests/unit/mono/sealed-platform-edges.test.ts
tests/unit/proof-mir/sealed-platform-operations.test.ts
tests/unit/proof-check/sealed-platform-effects.test.ts
tests/unit/opt-ir/sealed-platform-effects.test.ts
tests/unit/target/aarch64/sealed-platform-materialization.test.ts
tests/unit/target/uefi-aarch64/sealed-platform-catalog.test.ts
tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts
tests/unit/semantic/names/platform-binding.test.ts
tests/integration/semantic/name-resolution.test.ts
tests/integration/validation/full-image/reference-checkers-source-platform.test.ts
tests/integration/target/uefi-aarch64/status-abi-bridge.test.ts
tests/integration/target/uefi-aarch64/static-char16-constant-pool.test.ts
tests/integration/target/uefi-aarch64/package-pipeline-optir-static-char16.test.ts
tests/fixtures/diagnostics/platform-capabilities/
tests/fixtures/full-image-validation/
```

---

## Parallelization Map

Wave 1 establishes the new semantic surface, target type checking, field certification, capability provisioning, and legacy cutoff. These tasks can be split across subagents, but merge Task 0 first because other tasks import its IDs and catalog invariants.

```text
Wave 1:
  Task 0 -> Task 1 -> Task 2 -> Task 3 -> Task 3A
  Task 4 can run alongside Tasks 1 and 2, then rebase after Task 3

Wave 2:
  Task 5 and Task 6 depend on Tasks 3 and 3A and can run in parallel
  Task 7 and Task 8 depend on Tasks 5 and 6 and can run in parallel
  Task 9 depends on Tasks 3A, 5, and 6 and can run in parallel with Tasks 7 and 8

Wave 3:
  Task 10 depends on Tasks 7, 8, and 9
  Task 11 depends on Tasks 3A and 10
  Task 12 depends on Tasks 10 and 11
  Task 13 depends on Task 12
  Task 14 depends on Task 12

Wave 4:
  Task 15 depends on Tasks 11 and 14
  Task 16 depends on Tasks 0, 1, 2, 3A, 11, and 15
  Task 17 depends on Tasks 4 and 16
  Task 18 depends on Tasks 16 and 17
  Task 19 depends on Tasks 10, 12, 14, 16, and 18
  Task 20 depends on Tasks 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, and 19
  Task 21 depends on all prior tasks
```

---

## Task 0: Define Stable IDs And Catalog Validation

- [ ] **Description**

Define every new branded ID and the shared catalog validation rules before any subsystem imports sealed capability concepts. This task creates the stable identity vocabulary used by target catalog entries, semantic certification, HIR platform edges, Proof MIR operations, Opt IR effects, layout ABI facts, and validation evidence.

Modify:

- `src/semantic/ids.ts`
- `src/semantic/surface/platform-surface.ts`
- `tests/unit/semantic/surface/sealed-capability-catalog.test.ts`

- [ ] **Acceptance Criteria**

- `SealedRegionId`, `SealedCallableId`, `PlatformServiceId`, `PlatformPredicateId`, `PlatformEffectId`, and `CompilerOwnedTargetOperationId` are branded ID types or stable string ID types following existing ID conventions in `src/semantic/ids.ts`.
- Catalog validation sorts entries deterministically by stable ID before duplicate checks.
- Duplicate sealed region IDs, sealed callable IDs, target type IDs, service IDs, and region field keys produce deterministic `RangeError` messages in test helpers or target catalog construction.
- `SemanticTargetSurface` retains the existing `readonly targetId: TargetId` field.

- [ ] **Code Examples**

ID shape:

```ts
export type SealedRegionId = Brand<string, "SealedRegionId">;
export type SealedCallableId = Brand<string, "SealedCallableId">;
export type PlatformServiceId = Brand<string, "PlatformServiceId">;
export type PlatformPredicateId = Brand<string, "PlatformPredicateId">;
export type PlatformEffectId = Brand<string, "PlatformEffectId">;
export type CompilerOwnedTargetOperationId = Brand<string, "CompilerOwnedTargetOperationId">;
```

Catalog invariant test:

```ts
test("sealed capability catalog rejects duplicate region field keys deterministically", () => {
  expect(() =>
    semanticTargetSurfaceFake({
      sealedRegions: [
        sealedRegionSpecFake({
          regionId: sealedRegionId("uefi.mmio.uart"),
          fields: [
            sealedRegionFieldSpecFake({ fieldKey: "data", name: "data" }),
            sealedRegionFieldSpecFake({ fieldKey: "data", name: "data_alias" }),
          ],
        }),
      ],
    }),
  ).toThrow("Duplicate sealed region field key uefi.mmio.uart:data");
});
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/sealed-capability-catalog.test.ts
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

- `SemanticTargetSurface` keeps `readonly targetId: TargetId` and adds `sealedRegions` and `sealedCallables`.
- Region and callable specs are immutable readonly data with deterministic IDs.
- Catalog constructors or fake helpers reject duplicate target type IDs, duplicate field names within a region, and duplicate callable target type IDs.
- `PlatformEffectSpec`, `PlatformPredicateRequirementSpec`, and sealed capability value-type references are defined in this task and used consistently by downstream tasks.
- Existing target surfaces can be constructed with empty sealed capability lists.
- No source language behavior changes in this task.

- [ ] **Code Examples**

Catalog shape to implement:

```ts
export type SealedCapabilityKind = "region" | "callable";

export type RegionFieldAccess = "read" | "write" | "readWrite";

export type RegionAccessOrdering = "plain" | "deviceOrdered" | "acquireCommit" | "releaseCommit";

export type OwnerReceiverMode = "observe" | "consume" | "terminal";

export type PlatformEffectSpec =
  | {
      readonly kind: "firmwareCall";
      readonly service: PlatformServiceId;
    }
  | {
      readonly kind: "readsMemory";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
    }
  | {
      readonly kind: "writesMemory";
      readonly regionId: SealedRegionId;
      readonly fieldKey: string;
    }
  | {
      readonly kind: "advancesPrivateState";
      readonly regionId: SealedRegionId;
    };

export type PlatformPredicateRequirementSpec =
  | {
      readonly kind: "predicate";
      readonly predicateId: PlatformPredicateId;
      readonly predicateName: string;
    }
  | {
      readonly kind: "state";
      readonly stateKind: "available" | "advanced" | "closed";
    };

export type SealedCapabilityValueType =
  | {
      readonly kind: "source";
      readonly typeId: TypeId;
    }
  | {
      readonly kind: "target";
      readonly targetTypeId: TargetTypeId;
    };

export interface SealedRegionFieldSpec {
  readonly fieldKey: string;
  readonly name: string;
  readonly valueType: SealedCapabilityValueType;
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
  readonly targetId: TargetId;
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
- `src/semantic/surface/dataclass-resource-checker.ts`
- `src/semantic/surface/signature-checker.ts`
- `src/semantic/surface/generic-checker.ts`
- `src/semantic/surface/resource-kind-checker.ts`
- `src/semantic/names/name-resolver.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`
- `tests/unit/semantic/surface/type-reference-checker.test.ts`

- [ ] **Acceptance Criteria**

- Target type metadata includes generic arity, resource kind, and source constructibility.
- `CheckTypeReferenceInput` includes `targetSurface: SemanticTargetSurface`.
- Every call to `checkTypeReference` in `dataclass-resource-checker.ts`, `signature-checker.ts`, `generic-checker.ts`, and recursive type-argument checking passes `targetSurface`.
- `MmioRegion[UartMmio]` type-checks when the catalog declares arity `1`.
- `MmioRegion`, `MmioRegion[A, B]`, and `UnknownRegion[Owner]` produce deterministic diagnostics.
- Source code cannot construct sealed region or sealed callable values with literals, constructors, or default values.
- Existing zero-arity target types continue to type-check.

- [ ] **Code Examples**

Target type metadata shape:

```ts
export interface CheckTypeReferenceInput {
  readonly moduleId: ModuleId;
  readonly view: TypeReferenceView | undefined;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly allowInterfaces?: boolean;
}

export type TargetTypeConstructibility = "sourceConstructible" | "targetSealed";

export interface TargetTypeKindSpec {
  readonly targetTypeId: TargetTypeId;
  readonly kind: CheckedResourceKind;
  readonly genericArity: number;
  readonly constructibility: TargetTypeConstructibility;
}
```

Call-site pattern:

```ts
const typeResult = checkTypeReference({
  moduleId: input.moduleId,
  view: parameter.type,
  index: input.index,
  referenceLookup: input.referenceLookup,
  coreTypes: input.coreTypes,
  targetSurface: input.targetSurface,
});
```

Recursive type argument pattern:

```ts
const argResult = checkTypeReference({
  ...input,
  view: argView,
  targetSurface: input.targetSurface,
});
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
- Certification inspects each checked field type: source types are ignored, target type constructors are looked up in `targetSurface.sealedRegions` and `targetSurface.sealedCallables`, and applied target constructors use their constructor target type ID.
- A sealed capability field outside an `edge class` is rejected.
- A sealed capability field with a mismatched owner argument is rejected.
- An owner-bound callable field must use the containing edge class as its owner argument.
- A sealed region or callable type with no owner type argument emits `SURFACE_SEALED_CAPABILITY_OWNER_ARGUMENT_MISSING`.
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

Certification matching rules:

```ts
function classifySealedCapabilityField(input: {
  readonly field: CheckedFieldRecord;
  readonly containingType: CheckedType;
  readonly targetSurface: SemanticTargetSurface;
}): CertifiedSealedRegionField | CertifiedSealedCallableField | undefined {
  const targetTypeId = targetConstructorId(input.field.type);
  if (targetTypeId === undefined) return undefined;

  const region = input.targetSurface.sealedRegions.find(
    (candidate) => candidate.targetTypeId === targetTypeId,
  );
  if (region !== undefined) {
    return certifyRegionField(input.field, input.containingType, region);
  }

  const callable = input.targetSurface.sealedCallables.find(
    (candidate) => candidate.targetTypeId === targetTypeId,
  );
  if (callable !== undefined) {
    return certifyCallableField(input.field, input.containingType, callable);
  }

  return undefined;
}
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/sealed-capability-certifier.test.ts
```

---

## Task 3A: Define Target-Sealed Capability Provisioning

- [ ] **Description**

Define how valid sealed capability values enter edge objects when source code is not allowed to construct them. The target/package pipeline must provide target-owned seed records for entry objects, firmware services, MMIO regions, validation streams, source API bridge handles, and other platform capabilities.

Modify:

- Create `src/semantic/surface/sealed-capability-provisioning.ts`
- `src/semantic/surface/checked-program.ts`
- `src/semantic/surface/semantic-surface-checker.ts`
- `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`
- `tests/unit/semantic/surface/sealed-capability-provisioning.test.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`

- [ ] **Acceptance Criteria**

- `CheckedProgram` exposes a deterministic table of target-sealed capability provisions keyed by source field ID.
- Every certified sealed region or sealed callable field required by an image entry edge has either a target provision record or a diagnostic.
- Source constructors, aggregate literals, default field values, and ordinary assignments cannot manufacture `targetSealed` values.
- Provision records distinguish zero-sized proof-only handles, runtime pointers, firmware service table pointers, base addresses, and validation fixture handles.
- UEFI package semantic target construction can provide `Console.output_string`, watchdog, exit boot services, memory map, validation packet source, validation packet stream, and source API bridge capabilities.

- [ ] **Code Examples**

Provisioning model:

```ts
export type SealedCapabilityProvisionRepresentation =
  | { readonly kind: "proofOnly" }
  | {
      readonly kind: "firmwareServicePointer";
      readonly table: "system" | "bootServices";
      readonly offsetKey: string;
    }
  | { readonly kind: "mmioBaseAddress"; readonly addressSymbol: string }
  | { readonly kind: "validationFixtureHandle"; readonly fixtureKey: string }
  | { readonly kind: "sourceApiBridgeHandle"; readonly bridgeKey: string };

export interface SealedCapabilityProvision {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly capability:
    | { readonly kind: "region"; readonly regionId: SealedRegionId }
    | { readonly kind: "callable"; readonly callableId: SealedCallableId };
  readonly representation: SealedCapabilityProvisionRepresentation;
}
```

Provisioning test shape:

```ts
test("entry edge sealed callable fields require target provisions", () => {
  const result = checkSemanticSurface(fixtureWithConsoleOutputStringField());

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "SURFACE_SEALED_CAPABILITY_PROVISION_MISSING",
  );
  expect(result.program.sealedCapabilityProvisions.entries()).toContainEqual(
    expect.objectContaining({
      capability: { kind: "callable", callableId: uefiOutputStringCallableId },
      representation: {
        kind: "firmwareServicePointer",
        table: "system",
        offsetKey: "conOut.outputString",
      },
    }),
  );
});
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/surface/sealed-capability-provisioning.test.ts
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
- `tests/unit/semantic/names/platform-binding.test.ts`
- `tests/integration/semantic/name-resolution.test.ts`
- `tests/unit/semantic/surface/platform-certifier.test.ts`
- `tests/unit/frontend/ast/function-views.test.ts`
- `tests/unit/frontend/parser/function-signature-parser.test.ts`
- Add fixtures under `tests/fixtures/diagnostics/platform-capabilities/`

- [ ] **Acceptance Criteria**

- Freestanding `platform fn` declarations produce `NAME_LEGACY_PLATFORM_FN`.
- Method-shaped `platform fn` declarations produce `NAME_LEGACY_PLATFORM_FN`, not the old method-only diagnostic.
- No `CertifiedPlatformBinding` entries are created from source declarations.
- The old primitive name catalog is not used for source name binding.
- Parser and AST tests may continue to prove `platform` is tokenized and parsed enough for diagnostics, but no semantic test may assert successful platform binding.
- `tests/unit/semantic/names/platform-binding.test.ts` is rewritten from "binds target primitive" expectations to "reports legacy platform function" expectations.
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

## Task 5: Add Typed Sealed Member Lookup In HIR

- [ ] **Description**

Keep name resolution syntax-only for local member chains and implement sealed member completion in typed HIR lowering. When HIR lowers `receiver.memberName`, it already knows the receiver expression type and place. Use that typed receiver to detect certified sealed region fields and resolve catalog pseudo-fields such as `data`.

Modify:

- Create `src/hir/sealed-member-lookup.ts`
- `src/hir/expression-lowerer.ts`
- `src/hir/statement-lowerer.ts`
- `src/hir/diagnostics.ts`
- Create `tests/unit/hir/sealed-member-lookup.test.ts`

- [ ] **Acceptance Criteria**

- `member-chain-resolver.ts` continues to return early for local bases such as `self`; this task does not add target catalog logic to name resolution.
- `self.region.data` is recognized during HIR lowering when `region` is a certified sealed region field and `data` exists in the region spec.
- `self.region.unknown_data` emits `HIR_SEALED_REGION_FIELD_UNKNOWN`.
- `self.unknown_field` still emits the existing `HIR_MEMBER_REFERENCE_MISSING` diagnostic.
- The HIR helper returns the receiver expression, authorizing place, region spec, field spec, and access mode needed by read and write lowering.

- [ ] **Code Examples**

Lookup result shape:

```ts
export type HirSealedMemberAccessMode = "read" | "write";

export interface HirSealedRegionMemberLookupResult {
  readonly kind: "sealedRegionMember";
  readonly receiver: HirExpression;
  readonly authorizingPlace: HirResourcePlace;
  readonly regionId: SealedRegionId;
  readonly fieldKey: string;
  readonly memberName: string;
  readonly valueType: CheckedType;
  readonly access: RegionFieldAccess;
  readonly ordering: RegionAccessOrdering;
}

export function lookupSealedRegionMember(input: {
  readonly context: HirLoweringContext;
  readonly receiver: HirExpression;
  readonly memberName: string;
  readonly accessMode: HirSealedMemberAccessMode;
  readonly origin: HirSourceOriginId;
}): HirSealedRegionMemberLookupResult | undefined;
```

Name-resolution boundary test:

```ts
test("name resolution leaves local member chains for HIR typed lookup", () => {
  const result = resolveNamesForTest(`
edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn read(self) -> u8:
        self.region.data
`);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "NAME_UNRESOLVED_MEMBER",
  );
});
```

HIR lookup test:

```ts
test("HIR sealed member lookup resolves catalog field from receiver type", () => {
  const result = lowerTypedHirForTest(fixtureWithMmioRegionRead());

  expect(result.diagnostics).toEqual([]);
  expect(result.program.expressions.entries()).toContainEqual(
    expect.objectContaining({
      kind: expect.objectContaining({
        kind: "sealedRegionRead",
        regionId: mmioRegionId,
        fieldKey: "data",
      }),
    }),
  );
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
bun test tests/unit/hir/sealed-member-lookup.test.ts
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
- Each sealed callable has a layout ABI fact with callable pointer representation, table source, table offset, service offset, call ABI, and service identity.
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
      readonly table: "system" | "bootServices";
      readonly tableOffsetKey: string;
      readonly serviceOffsetKey: string;
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
  table: "system",
  tableOffsetKey: "conOut",
  serviceOffsetKey: "outputString",
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
- `tests/unit/proof-check/platform-effects.test.ts`
- Add `tests/unit/proof-check/sealed-platform-effects.test.ts`

- [ ] **Acceptance Criteria**

- A sealed region read requires the catalog predicates for that field.
- A sealed region write requires write permission and advances private region state.
- Facts depending on old region state are removed by a deterministic invalidation helper that scans active fact terms for the mutated region ID and field key.
- A sealed callable with `consume` mode consumes the owner capability.
- A sealed callable with `terminal` mode prevents use of the owner after the call.
- Proof diagnostics identify the failing sealed operation by region/callable ID and source span.

- [ ] **Code Examples**

Effect transfer sketch:

```ts
export function invalidateRegionFieldFacts(input: {
  readonly state: ProofCheckState;
  readonly regionId: SealedRegionId;
  readonly fieldKey: string;
  readonly origin: ProofMirOriginId;
}): ProofCheckStatePatchEntry {
  return {
    kind: "dropFacts",
    reason: "sealedRegionWrite",
    facts: activeFactsReferencingRegionField(input.state, input.regionId, input.fieldKey),
    origin: input.origin,
  };
}

switch (operation.kind.kind) {
  case "sealedRegionRead":
    requirePredicates(operation.kind.regionId, operation.kind.fieldKey);
    observeRegion(operation.kind.authorizingPlace);
    break;
  case "sealedRegionWrite":
    requirePredicates(operation.kind.regionId, operation.kind.fieldKey);
    mutateRegion(operation.kind.authorizingPlace);
    applyPatch(
      invalidateRegionFieldFacts({
        state,
        regionId: operation.kind.regionId,
        fieldKey: operation.kind.fieldKey,
        origin: operation.origin,
      }),
    );
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

## Task 15: Materialize Sealed Platform Operations In AArch64 Lowering

- [ ] **Description**

Teach the shared AArch64 Opt IR materializer to consume sealed platform Opt IR operations. This task handles machine operation materialization and fact queries only; UEFI-specific service pointer cataloging stays in Task 16.

Modify:

- `src/target/aarch64/lower/operation-support.ts`
- `src/target/aarch64/lower/operation-materialization.ts`
- `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Create `tests/unit/target/aarch64/sealed-platform-materialization.test.ts`

- [ ] **Acceptance Criteria**

- Sealed region reads materialize as target load operations using layout ABI facts from Task 11.
- Sealed region writes materialize as target store operations using layout ABI facts from Task 11.
- Sealed callable calls materialize as indirect call skeletons whose concrete pointer source comes from target-specific ABI facts.
- No source `asm`, `machine`, or source-authored target instruction syntax is introduced.
- Unit tests assert machine IR operation kinds and fact usage, not textual assembly.

- [ ] **Code Examples**

Materialization branch:

```ts
case "sealedRegionRead":
  return materializeSealedRegionLoad({
    operation,
    abiFact: query.sealedRegionField(operation.regionId, operation.fieldKey),
    state,
  });
case "sealedRegionWrite":
  return materializeSealedRegionStore({
    operation,
    abiFact: query.sealedRegionField(operation.regionId, operation.fieldKey),
    state,
  });
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
bun test tests/unit/target/aarch64/sealed-platform-materialization.test.ts
```

---

## Task 16: Migrate UEFI Target Catalog And Firmware ABI To Sealed Capabilities

- [ ] **Description**

Replace the UEFI target's source primitive surface with sealed region and sealed callable catalog entries. Current firmware services, validation/source API bridge operations, and firmware service pointer loads should be represented as target-sealed values owned by edge classes.

Modify:

- `src/target/uefi-aarch64/platform-catalog.ts`
- `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`
- `src/target/uefi-aarch64/target-surfaces.ts`
- `src/target/uefi-aarch64/firmware-lowering.ts`
- `src/target/uefi-aarch64/binary-spine.ts`
- `tests/support/semantic/semantic-surface-fakes.ts`
- Create `tests/unit/target/uefi-aarch64/sealed-platform-catalog.test.ts`
- Create `tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts`
- Update `tests/unit/target/uefi-aarch64/platform-catalog.test.ts`

- [ ] **Acceptance Criteria**

- UEFI output string, watchdog timer, exit boot services, memory map, validation stream, and source API bridge capabilities are cataloged as sealed callables or sealed regions.
- `uefiAArch64PlatformPrimitiveNameCatalog()` returns no source-bindable primitive names.
- Package-specific bridge wiring mutates sealed callable signatures where it previously mutated platform primitive signatures.
- Firmware service pointer ABI facts specify table source, table offset, service offset, call ABI, clobbers, and result conversion.
- `firmware-lowering.ts` lowers sealed callable service pointers by loading from the system table or boot services table offset and emitting an indirect `blr` machine operation.
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

Firmware pointer ABI fact:

```ts
const uefiOutputStringAbiFact: LayoutSealedPlatformAbiFact = {
  kind: "sealedCallable",
  callableId: uefiOutputStringCallableId,
  pointerRepresentation: "firmwareServicePointer",
  table: "system",
  tableOffsetKey: "conOut",
  serviceOffsetKey: "outputString",
  abi: uefiAArch64FirmwareServiceAbiId,
  serviceIdentity: uefiOutputStringServiceId,
};
```

Lowering assertion:

```ts
expect(lowered.machineProgram.instructions).toContainEqual(
  expect.objectContaining({
    opcode: "blr",
    provenance: expect.objectContaining({
      serviceIdentity: uefiOutputStringServiceId,
    }),
  }),
);
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
bun test tests/unit/target/uefi-aarch64/sealed-platform-catalog.test.ts
bun test tests/unit/target/uefi-aarch64/sealed-platform-lowering.test.ts
```

---

## Task 17: Migrate Production Stdlib And UEFI Fixture Copies

- [ ] **Description**

Migrate production stdlib and UEFI smoke fixture copies away from `platform fn`. This task changes source packages only; validation reference checkers are handled in Task 19.

Modify:

- `stdlib/wrela-std/target/uefi/console.wr`
- `stdlib/wrela-std/target/uefi/watchdog.wr`
- `stdlib/wrela-std/target/uefi/memory.wr`
- `stdlib/wrela-std/target/uefi/firmware.wr`
- `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/src/wrela-std/target/uefi/console.wr`
- `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/src/wrela-std/target/uefi/watchdog.wr`
- `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/src/wrela-std/target/uefi/memory.wr`
- `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/src/wrela-std/target/uefi/firmware.wr`
- `tests/fixtures/uefi-aarch64/smoke-direct-platform/src/image.wr`
- `tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts`

- [ ] **Acceptance Criteria**

- `rg -n "platform\s+fn|platform fn" stdlib tests/fixtures/uefi-aarch64` returns no passing source declarations.
- Console, watchdog, memory, and firmware stdlib APIs expose sealed edge fields and ordinary methods.
- Existing public stdlib module paths remain unchanged.
- `stdlib-source-root.test.ts` expects sealed capability source instead of `platform fn output_string`.

- [ ] **Code Examples**

Production stdlib shape:

```wr
edge class Console:
    output_string: UefiOutputStringFn[Console]

    fn write(self, message: Utf16Static) -> Console:
        self.output_string(message)
        self
```

Firmware source API shape:

```wr
edge class UefiFirmware:
    exit_boot_services: UefiExitBootServicesFn[UefiFirmware]

    fn exit(self) -> Never:
        self.exit_boot_services()
```

- [ ] **Commands**

```bash
bun test tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts
rg -n "platform\s+fn|platform fn" stdlib tests/fixtures/uefi-aarch64
```

---

## Task 18: Migrate Full-Image Fixture Source Families

- [ ] **Description**

Migrate full-image fixtures away from `platform fn`, split by fixture family so subagents can work independently after Task 17 lands.

Modify:

- `tests/fixtures/full-image-validation/smoke-console/direct-platform/`
- `tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/`
- `tests/fixtures/full-image-validation/two-branch-control-flow/direct-platform/`
- `tests/fixtures/full-image-validation/two-branch-control-flow/ejected-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter/direct-platform/`
- `tests/fixtures/full-image-validation/packet-counter/ejected-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/toolchain-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/direct-platform/`
- `tests/fixtures/full-image-validation/packet-counter-real-stream/ejected-stdlib/`
- `tests/fixtures/full-image-validation/packet-counter-bad-payload/toolchain-stdlib/`
- Scorecard baselines under each migrated fixture directory

- [ ] **Acceptance Criteria**

- No passing full-image fixture declares `platform fn`.
- Packet-counter toolchain stdlib fixture uses sealed validation source or sealed validation stream capabilities.
- Direct-platform fixtures declare edge classes with sealed callable fields instead of freestanding platform functions.
- Ejected-stdlib fixtures match the migrated production stdlib shape from Task 17.
- Full-image validation passes for each migrated family.

- [ ] **Code Examples**

Validation fixture source shape:

```wr
edge class ValidationFixtureSource:
    packet_source: ValidationPacketSourceFn[ValidationFixtureSource]

    fn source(self) -> Ptr:
        self.packet_source()
```

Validation stream shape:

```wr
edge class ValidationFixtureStream:
    packet_stream: ValidationPacketStreamFn[ValidationFixtureStream]

    fn open(self) -> ValidationFixturePacketStream:
        self.packet_stream()
```

- [ ] **Commands**

```bash
bun test tests/integration/full-image-validation.test.ts
rg -n "platform\s+fn|platform fn" tests/fixtures/full-image-validation
```

---

## Task 19: Migrate Full-Image Platform Evidence And Reference Checkers

- [ ] **Description**

Replace reference checkers that scan for source platform functions or report reachable platform primitives with sealed operation evidence produced by the compiler trace.

Modify:

- `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-fixtures.ts`
- `src/validation/full-image/reference-checkers/proof-fact-reference.ts`
- `src/validation/full-image/reference-checkers/opt-ir-reference.ts`
- `src/validation/full-image/determinism.ts`
- `tests/integration/validation/full-image/reference-checkers-source-platform.test.ts`

- [ ] **Acceptance Criteria**

- `semantic-platform-reference.ts` no longer contains `PLATFORM_FUNCTION_PATTERN`.
- The semantic platform reference checker reads compiler-produced sealed operation inventory.
- The checker reports sealed callable calls by service identity and sealed region accesses by region ID and field key.
- Determinism equivalence compares sealed operation inventory instead of platform primitive declarations.
- Reference checker tests cover sealed callable, sealed region read, sealed region write, and legacy source `platform fn` rejection.

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

- [ ] **Commands**

```bash
bun test tests/integration/validation/full-image/reference-checkers-source-platform.test.ts
bun test tests/integration/full-image-validation.test.ts
```

---

## Task 20: Migrate Non-Full-Image Tests Off Source Platform Functions

- [ ] **Description**

Migrate the unit and integration tests that currently rely on successful source `platform fn` binding. Tests that are only proving parser recovery may keep source `platform fn` as invalid syntax examples; semantic/HIR/mono/layout/proof/target tests must use sealed capabilities or compiler-owned target operation fakes.

Modify:

- `tests/unit/semantic/names/platform-binding.test.ts`
- `tests/unit/semantic/surface/platform-certifier.test.ts`
- `tests/integration/semantic/name-resolution.test.ts`
- `tests/integration/semantic/semantic-surface.test.ts`
- `tests/integration/semantic/semantic-surface.take.test.ts`
- `tests/integration/semantic/semantic-surface.private-platform.test.ts`
- `tests/integration/semantic/semantic-surface.proof-preservation.test.ts`
- `tests/integration/semantic/semantic-surface.validation-attempt.test.ts`
- `tests/integration/semantic/semantic-surface-determinism.test.ts`
- `tests/integration/hir/proof-surface-completeness.test.ts`
- `tests/integration/hir/typed-hir-proof-integration.test.ts`
- `tests/integration/hir/lower-typed-hir-orchestration.test.ts`
- `tests/unit/mono/platform-primitives.test.ts`
- `tests/support/mono/monomorphization-fixtures.ts`
- `tests/support/layout/layout-fixtures.ts`
- `tests/integration/proof-check/platform-contracts.test.ts`
- `tests/integration/proof-check/terminal-closure.test.ts`
- `tests/integration/target/uefi-aarch64/status-abi-bridge.test.ts`
- `tests/integration/target/uefi-aarch64/static-char16-constant-pool.test.ts`
- `tests/integration/target/uefi-aarch64/package-pipeline-optir-static-char16.test.ts`

- [ ] **Acceptance Criteria**

- Semantic tests assert source `platform fn` rejection or sealed capability success, never successful source platform binding.
- HIR tests use sealed callable calls, sealed region accesses, or compiler-owned target operation fakes.
- Mono/layout/proof-check fixtures no longer declare `platform fn exit() -> Never`; they use a sealed terminal callable or compiler-owned target operation fixture.
- Target integration tests use sealed `Console.output_string` instead of freestanding `output_string`.
- Parser tests that include `platform fn` document that the syntax is parsed only to produce legacy diagnostics.

- [ ] **Code Examples**

HIR fixture replacement:

```wr
edge class ExitAuthority:
    exit: TestExitFn[ExitAuthority]

fn caller(auth: ExitAuthority) -> Never:
    auth.exit()
```

Semantic rejection assertion:

```ts
expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
  "NAME_LEGACY_PLATFORM_FN",
);
expect(result.platformBindings.entries()).toEqual([]);
```

- [ ] **Commands**

```bash
bun test tests/unit/semantic/names/platform-binding.test.ts
bun test tests/unit/semantic/surface/platform-certifier.test.ts
bun test tests/integration/semantic
bun test tests/integration/hir
bun test tests/unit/mono/platform-primitives.test.ts
bun test tests/integration/proof-check/platform-contracts.test.ts
bun test tests/integration/target/uefi-aarch64
```

---

## Task 21: Remove Legacy Reachability And Finish Compatibility Audit

- [ ] **Description**

Remove or isolate legacy `platform fn` reachability and reporting paths after sealed capability execution is complete. The final codebase should make the new architecture obvious: source platform functions are invalid, sealed platform operations are the supported path, and compiler-owned target operations remain target-owned.

Modify:

- `src/semantic/surface/platform-certifier.ts`
- `src/semantic/names/platform-binding.ts`
- `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`
- `src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts`
- `src/target/uefi-aarch64/runtime-helper-objects.ts`
- `src/target/uefi-aarch64/package-pipeline-adapters.ts`
- Existing tests that assert certified source platform binding success:
  - `tests/unit/semantic/surface/platform-certifier.test.ts`
  - `tests/integration/semantic/name-resolution.test.ts`

- [ ] **Acceptance Criteria**

- No production code path creates `CertifiedPlatformBinding` from a source `platform fn`.
- Legacy platform-binding types remain only if they are required for invalid diagnostics or target-internal compatibility; their comments state that source platform functions are rejected.
- Repository search shows no passing fixture using `platform fn`.
- Repository search shows no production stdlib source using `platform fn`.
- Repository search shows no parser or semantic acceptance path for source `asm` or `machine`.
- `bun run agent:check` passes.

- [ ] **Code Examples**

Audit commands and expected interpretation:

```bash
rg -n "CertifiedPlatformBinding|platformBindings|platform fn|platform\s+fn" src tests docs
rg -n "platform\s+fn|platform fn" stdlib tests/fixtures
rg -n "\basm\b|\bmachine\b" src tests docs
```

Acceptable remaining hits:

```text
docs/design/edge-platform-assembly-design.md
docs/language/invalid.md
tests/fixtures/diagnostics/platform-capabilities/legacy-platform-fn.wr
src/semantic/names/diagnostics.ts
src/semantic/surface/diagnostics.ts
```

Unacceptable remaining hits:

```text
tests/fixtures/full-image-validation/**/stdlib.wr: platform fn output_string
stdlib/wrela-std/target/uefi/console.wr: platform fn output_string
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
- [ ] `rg -n "platform\s+fn|platform fn" stdlib tests/fixtures/full-image-validation tests/fixtures/uefi-aarch64 src`
- [ ] `rg -n "platform\s+fn|platform fn" tests/unit tests/integration tests/support`
- [ ] `rg -n "\basm\b|\bmachine\b" src/frontend src/semantic src/hir`
- [ ] Confirm remaining `platform fn` hits are invalid fixtures, parser recovery tests, diagnostics, or historical design text.
- [ ] Confirm no implementation accepts source-authored assembly, source-authored machine IR, or source-authored platform functions.
