# Representation Layout Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the representation and layout facts phase described in `docs/design/representation-layout-facts-design.md`, including the parser/HIR/mono prerequisites, deterministic layout fact tables, validated-buffer layout facts, ABI facts, diagnostics, and public API.

**Architecture:** The existing frontend, semantic, HIR, and mono pipeline becomes the sole source of source-order enum metadata, checked wire encodings, mono layout expressions, and mono-owned layout type keys. The new `src/layout` phase consumes only `MonomorphizedHirProgram` plus an injected `LayoutTargetSurface`, builds deterministic fact tables, and rejects unsupported or incomplete representations before Proof MIR. Filesystem access, package loading, Proof MIR, proof checking, code generation, linking, and binary emission remain outside layout.

**Tech Stack:** TypeScript, Bun test runner, existing frontend/HIR/mono table helpers, injected fakes through dependency injection, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- The source design is currently untracked in the working tree: `docs/design/representation-layout-facts-design.md`.
- Existing repo convention stores implementation plans in `docs/implementation/`, so this plan follows that convention instead of creating a new plan directory.
- Current `HirTypeRecord` already exists in `src/hir/hir.ts` and has `fieldIds`, `declaredTypeParameters`, `resourceKind`, and `sourceOrigin`, but it does not retain enum case metadata.
- Current `MonoTypeInstance` in `src/mono/mono-hir.ts` mirrors source fields but does not retain enum cases.
- Current validated-buffer parser accepts `field: Type @ offset len count`, and AST views expose offset and length expressions, but there is no contextual `le` or `be` wire endian marker.
- Current semantic field table stores only checked field type and resource kind. It does not store checked wire scalar encoding for layout fields.
- Current `HirValidatedBuffer` stores only field IDs and requirements. It does not retain layout offsets, layout lengths, derived source expressions, derived cases, or wire encoding.
- Current `MonoValidatedBuffer` stores substituted `MonoFieldRecord` arrays and requirements only. It does not retain instantiated layout expressions or derived cases.
- Current mono finalization in `src/mono/reachability-finalization.ts` is the right ownership point for `layoutTypeResolutions`, because it already has final type instances, function instances, image devices, and reachable platform edges.
- `checkedTypeFingerprint` already exists in `src/semantic/surface/type-model.ts`; mono layout type resolutions must use that function rather than creating a second fingerprint algorithm.
- `src/index.ts` already exports `mono`; `layout` must be added there only after the layout public barrel exists.
- `src/layout` does not exist yet. The module must stay pure and dependency-free at runtime.
- Required handoff command from `agents.md`:

```bash
bun run agent:check
```

## Executor Protocol

Every task below is atomic for one worker. Before starting a task, copy this checklist into the task notes.

- [ ] Read the task description, dependencies, file list, acceptance criteria, code examples, and verification commands.
- [ ] Verify every dependency task has landed.
- [ ] Verify no same-wave task owns the production files listed in this task.
- [ ] Write the failing test from the task's code example in the task-owned test file.
- [ ] Add or update one test for each acceptance criterion in the task, not only the first example test.
- [ ] Run the narrow verification command and confirm the new test fails for the expected missing symbol, missing behavior, or diagnostic mismatch.
- [ ] Implement only the files listed by the task.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run any adjacent narrow tests listed by the task.
- [ ] Commit only this task's files. Commit subjects created by automation must end with `-Codex Automated`; any required `Co-Authored-By` footer can be added below the subject and body.

## Required Steps For Every Task Packet

Each selected task must be executed with these checkbox steps. The worker copies this block under the task they are implementing and uses that task's number and command from its `Verification` section.

- [ ] **Step 1: Write failing tests for the selected task**

  Add the code example test plus one additional test for each acceptance criterion that is not covered by the example. Put the tests only in the test files listed by the selected task.

- [ ] **Step 2: Run the task verification command and confirm failure**

  Run the exact command listed in the selected task's `Verification` section.

  Expected before implementation: `FAIL` because the export, diagnostic code, fact field, or behavior named in the selected task's code examples and acceptance criteria is missing or incorrect.

- [ ] **Step 3: Implement the selected task**

  Edit only the production files listed by the selected task. Use the public type names, helper names, diagnostic codes, and builder result contract defined in the shared sections above.

- [ ] **Step 4: Run the task verification command and confirm pass**

  Run the exact command listed in the selected task's `Verification` section.

  Expected after implementation: `PASS` for every test in that command.

- [ ] **Step 5: Commit the selected task**

  Stage only the files listed by the selected task and commit with a task-scoped message. Automation-created commit subjects must end with `-Codex Automated`; any required `Co-Authored-By` footer can be added below the subject and body.

## Target File Structure

```text
src/
  shared/
    wire-layout.ts

  frontend/
    parser/
      type-parser.ts
      validated-buffer-parser.ts
    ast/
      type-views.ts
      field-views.ts
    syntax/
      syntax-kind.ts

  semantic/
    item-index/
      item-records.ts
      source-member-collector.ts
    surface/
      checked-program.ts
      diagnostics.ts
      semantic-surface-checker.ts

  hir/
    hir.ts
    layout-expression-lowerer.ts
    typed-hir-builder.ts
    validated-buffer-lowerer.ts

  mono/
    mono-hir.ts
    type-instantiator.ts
    reachability-finalization.ts

  layout/
    index.ts
    ids.ts
    diagnostics.ts
    builder-context.ts
    deterministic-sort.ts
    target-layout.ts
    layout-program.ts
    type-key.ts
    type-layout.ts
    primitive-layout.ts
    layout-type-resolver.ts
    aggregate-layout.ts
    enum-layout.ts
    image-device-layout.ts
    validated-buffer-layout.ts
    validated-buffer-value-storage.ts
    validated-buffer-terms.ts
    validated-buffer-wire.ts
    validated-buffer-fields.ts
    validated-buffer-derived.ts
    abi-layout.ts
    source-function-abi.ts
    platform-abi.ts
    image-entry-abi.ts
    layout-fact-builder.ts

tests/
  support/
    layout/
      layout-fakes.ts
      layout-fixtures.ts

  unit/
    layout/
      target-layout.test.ts
      type-key.test.ts
      type-layout.test.ts
      aggregate-layout.test.ts
      enum-layout.test.ts
      image-device-layout.test.ts
      validated-buffer-value-storage.test.ts
      validated-buffer-terms.test.ts
      validated-buffer-wire.test.ts
      validated-buffer-fields.test.ts
      validated-buffer-derived.test.ts
      source-function-abi.test.ts
      platform-abi.test.ts
      image-entry-abi.test.ts
      diagnostics.test.ts
      layout-fixtures.test.ts

  integration/
    layout/
      representation-layout-facts.test.ts
      validated-buffer-layout-facts.test.ts
      abi-shapes.test.ts
      layout-determinism.test.ts
      public-api.test.ts
```

## Public API File Assignment

Task 6 owns this file map. Later tasks may complete implementation exports, but they must not move public type names between files.

```text
src/layout/ids.ts
  LayoutCanonicalKeyString
  TargetCallConventionId
  TargetWireReadHelperId

src/layout/target-layout.ts
  AbiScalarKind
  LayoutPrimitiveKind
  LayoutPrimitiveTypeRef
  LayoutPrimitiveTypeSpec
  LayoutPrimitiveTypeCatalog
  LayoutTargetSurface
  TargetDataModelFacts
  TargetValidatedBufferHandleLayout
  LayoutDeviceSurfaceSpec
  LayoutDeviceSurfaceCatalog
  LayoutImageProfileSpec
  LayoutImageProfileArgumentSpec
  LayoutImageProfileResultSpec
  LayoutImageProfileCatalog
  LayoutWireReadHelperSpec
  LayoutWireReadHelperCatalog
  TargetEnumLayoutPolicy
  TargetAbiSurface
  AbiClassificationUse
  ClassifyAbiValueInput
  ClassifyAbiValueResult

src/layout/layout-program.ts
  ComputeRepresentationLayoutFactsInput
  ComputeRepresentationLayoutFactsResult
  LayoutFactProgram
  TargetLayoutFacts
  LayoutTypeKey
  LayoutFieldKey
  LayoutImageDeviceKey
  LayoutDeterministicTable
  LayoutTypeFactTable
  LayoutFieldFactTable
  LayoutEnumFactTable
  LayoutValidatedBufferFactTable
  LayoutImageDeviceFactTable
  LayoutFunctionAbiFactTable
  LayoutPlatformAbiFactTable
  LayoutTypeFact
  LayoutTypeRepresentation
  LayoutAggregateStorageFact
  LayoutPaddingRange
  LayoutHiddenStorageField
  LayoutFieldFact
  LayoutEnumFact
  LayoutEnumCaseFact
  LayoutValidatedBufferFact
  LayoutValidatedBufferValueStorageFact
  LayoutValidatedBufferFieldFact
  LayoutWireTypeFact
  LayoutWireAggregateFieldFact
  LayoutWireReservedRange
  LayoutWireReadPolicy
  LayoutTerm
  LayoutTermUnit
  LayoutIntegerRange
  LayoutReadRequirement
  LayoutValidatedBufferDerivedFact
  LayoutDerivedCaseFact
  LayoutDerivedCaseCondition
  LayoutImageDeviceFact
  LayoutFunctionAbiFact
  LayoutAbiParameterFact
  LayoutAbiReturnFact
  LayoutAbiHiddenParameterFact
  LayoutAbiStackRequirement
  LayoutAbiPointerProvenance
  LayoutAbiPointerShape
  LayoutAbiLane
  LayoutAbiValueShape
  LayoutPlatformAbiFact
  LayoutImageEntryAbiFact
  LayoutImageEntryThunkConversion

src/layout/diagnostics.ts
  LayoutDiagnostic
  LayoutDiagnosticCode
  layoutDiagnostic
  sortLayoutDiagnostics
  layoutDiagnosticCode

src/layout/builder-context.ts
  LayoutOwnerKey
  LayoutBuilderIssue
  LayoutBuilderResult
  LayoutBuilderDependency
  LayoutBuilderContext
  createLayoutBuilderContext
```

## Diagnostic Code Catalog

Task 6 owns the canonical `LayoutDiagnosticCode` union. Tasks that need a new code must add it to Task 6 before using it.

```ts
export const LAYOUT_DIAGNOSTIC_CODES = [
  "LAYOUT_INVALID_TARGET_DATA_MODEL",
  "LAYOUT_INVALID_TARGET_PRIMITIVE",
  "LAYOUT_INVALID_ENUM_POLICY",
  "LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE",
  "LAYOUT_PLATFORM_TARGET_MISMATCH",
  "LAYOUT_REACHABLE_ERROR_TYPE",
  "LAYOUT_REACHABLE_RECOVERED_NODE",
  "LAYOUT_MISSING_PRIMITIVE_TYPE",
  "LAYOUT_MISSING_TYPE_RESOLUTION",
  "LAYOUT_DUPLICATE_TYPE_RESOLUTION",
  "LAYOUT_INVALID_PUBLISHED_TYPE_KEY",
  "LAYOUT_MONO_INVARIANT_VIOLATION",
  "LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION",
  "LAYOUT_UNSUPPORTED_INTERFACE_VALUE",
  "LAYOUT_UNSUPPORTED_ENUM_PAYLOAD",
  "LAYOUT_EMPTY_ENUM_REJECTED",
  "LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START",
  "LAYOUT_ENUM_DISCRIMINANT_OVERFLOW",
  "LAYOUT_RECURSIVE_TYPE_LAYOUT",
  "LAYOUT_FORBIDDEN_NEVER_STORAGE",
  "LAYOUT_AGGREGATE_LAYOUT_OVERFLOW",
  "LAYOUT_FIELD_ALIGNMENT_OVERFLOW",
  "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
  "LAYOUT_MISSING_WIRE_ENCODING",
  "LAYOUT_INVALID_WIRE_ENCODING",
  "LAYOUT_ZERO_SIZED_WIRE_ELEMENT",
  "LAYOUT_WIRE_HELPER_MISSING",
  "LAYOUT_WIRE_HELPER_MISMATCH",
  "LAYOUT_INVALID_LAYOUT_TERM",
  "LAYOUT_TERM_RANGE_MISSING",
  "LAYOUT_TERM_ARITHMETIC_OVERFLOW",
  "LAYOUT_FIELD_FORWARD_DEPENDENCY",
  "LAYOUT_FIELD_OVERLAP",
  "LAYOUT_FIELD_AMBIGUOUS_ORDER",
  "LAYOUT_DERIVED_OTHERWISE_NOT_LAST",
  "LAYOUT_DERIVED_DUPLICATE_CASE",
  "LAYOUT_DERIVED_CASE_OUT_OF_RANGE",
  "LAYOUT_DERIVED_CASE_NOT_TOTAL",
  "LAYOUT_MISSING_DEVICE_SURFACE",
  "LAYOUT_MISSING_IMAGE_PROFILE",
  "LAYOUT_MISSING_IMAGE_ENTRY",
  "LAYOUT_ABI_CLASSIFICATION_FAILED",
  "LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT",
  "LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH",
  "LAYOUT_FACT_TABLE_INCONSISTENCY",
] as const;
```

## Shared Builder Contract

Tasks 9 through 23 must use this contract. Focused builders do not directly suppress diagnostics; they return owner keys and dependency keys. Task 22 records the dependency graph, and Task 23 implements duplicate and cascade suppression in the orchestrator.

```ts
export type LayoutOwnerKey = string & { readonly __brand: "LayoutOwnerKey" };

export interface LayoutBuilderDependency {
  readonly ownerKey: LayoutOwnerKey;
  readonly reason:
    | "target"
    | "type"
    | "field"
    | "enum"
    | "validatedBuffer"
    | "wire"
    | "abi"
    | "imageDevice";
}

export interface LayoutBuilderIssue {
  readonly ownerKey: LayoutOwnerKey;
  readonly dependencies: readonly LayoutBuilderDependency[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export type LayoutBuilderResult<Value> =
  | {
      readonly kind: "ok";
      readonly ownerKey: LayoutOwnerKey;
      readonly dependencies: readonly LayoutBuilderDependency[];
      readonly value: Value;
      readonly diagnostics: readonly LayoutDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly ownerKey: LayoutOwnerKey;
      readonly dependencies: readonly LayoutBuilderDependency[];
      readonly diagnostics: readonly LayoutDiagnostic[];
    };
```

## Common Test Imports And Fixture Helper Inventory

Task 8 owns the initial layout fixture files and must export the layout helper names before downstream layout tasks use them. Task 5 owns the mono-specific `genericPacketProgramForMonoTest` helper in `tests/support/mono/monomorphization-fixtures.ts`. If a later task introduces a new helper name, it must add that helper to this inventory in the same commit.

```ts
// Shared target and catalog helpers
layoutTargetSurfaceFake;
layoutDataModelFake;
validatedBufferHandleLayoutFake;
layoutPrimitiveCatalogFake;
corePrimitiveSpecsFake;
targetPrimitiveSpecsFake;
layoutDeviceSurfaceCatalogFake;
layoutImageProfileCatalogFake;
layoutWireReadHelperCatalogFake;
enumLayoutPolicyFake;
targetAbiSurfaceFake;
targetCallConventionId;
pointerShape64;

// Shared mono/program fixtures
typedHirProgramForLayoutIntegration;
closedMonoProgramWithPacketType;
genericPacketProgramForMonoTest;
aggregateProgramLayoutFixture;
validatedBufferProgramFixture;
platformEdgeProgramFixture;
deterministicLayoutProgramFixture;

// Focused layout unit fixtures
normalizeTargetFactsForTest;
aggregateLayoutFixture;
enumLayoutFixture;
imageDeviceLayoutFixture;
validatedBufferLayoutFixture;
termTranslationFixture;
wireTypeFixture;
derivedFieldFixture;
functionAbiFixture;
imageEntryAbiFixture;

// Term and oracle helpers
monoIntegerLiteral;
monoSourceLength;
monoSubtract;
constantLayoutTerm;
sourceLengthLayoutTermForTest;
sourceLayoutTypeKey;
stableLayoutProjection;
primitiveFieldListArbitrary;
fieldOffsetProjection;
aggregateOffsetOracle;
```

## Parallel Execution Model

Tasks in the same wave can be worked by separate subagents after their dependencies are complete. Each wave is an antichain: no task depends on another task in the same wave, and same-wave tasks do not intentionally edit the same production file or the same test file. Barrel files (`type-layout.ts`, `validated-buffer-layout.ts`, and `abi-layout.ts`) are owned by one task each; later tasks import direct implementation modules until the owning barrel task re-exports them.

```text
Wave 0:
  Task 1: Shared wire encoding model and contextual parser/AST marker
  Task 2: HIR enum case records
  Task 6: Layout public fact model and diagnostics substrate

Wave 1:
  Task 3 after Task 1: Semantic wire encoding normalization
  Task 7 after Task 6: Layout deterministic keys and tables
  Task 8 after Task 6: Layout target fakes and fixtures

Wave 2:
  Task 4 after Tasks 1 and 3: HIR validated-buffer layout expression schema and lowering
  Task 9 after Tasks 6, 7, and 8: Target surface validation and primitive type facts

Wave 3:
  Task 5 after Tasks 2 and 4: Mono enum, validated-buffer layout surface, and layout type resolutions

Wave 4:
  Task 10 after Tasks 5, 7, and 9: Mono-published layout type resolver

Wave 5:
  Task 11 after Tasks 5, 9, and 10: Source aggregate layout and field facts
  Task 12 after Tasks 5, 9, and 10: Fieldless enum facts
  Task 13 after Tasks 5, 9, and 10: Image device facts
  Task 15 after Tasks 5 and 10: Layout term translation, ranges, and affine ordering
  Task 16 after Tasks 9 and 10: Wire type facts, read policies, and helper validation

Wave 6:
  Task 14 after Tasks 5, 10, and 11: Validated-buffer hidden value storage
  Task 19 after Tasks 11, 12, and 13: Source function ABI facts

Wave 7:
  Task 17 after Tasks 14, 15, and 16: Validated-buffer layout field facts and read requirements
  Task 20 after Task 19: Platform edge ABI facts

Wave 8:
  Task 18 after Tasks 15 and 17: Validated-buffer derived field facts
  Task 21 after Task 19: Image entry ABI facts

Wave 9:
  Task 22 after Tasks 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, and 21: Layout fact builder orchestration

Wave 10:
  Task 23 after Task 22: Consistency checks and diagnostic cascade suppression

Wave 11:
  Task 24 after Tasks 22 and 23: Public API and integration coverage

Wave 12:
  Task 25 after Task 24: Determinism, property tests, and final verification
```

## Single-Writer Coordination

- `src/frontend/syntax/syntax-kind.ts`, `src/frontend/parser/type-parser.ts`, and `src/frontend/parser/validated-buffer-parser.ts` are owned by Task 1.
- `src/hir/hir.ts` enum-case additions are owned by Task 2. Validated-buffer layout additions are owned by Task 4. Task 5 only mirrors those public shapes in mono.
- `src/semantic/surface/checked-program.ts` layout-field checked surface additions are owned by Task 3.
- `src/mono/mono-hir.ts` layout prerequisite schema additions are owned by Task 5.
- `src/layout/layout-program.ts`, `src/layout/target-layout.ts`, and `src/layout/index.ts` are created by Task 6 with final public type names. Later tasks may add imports but should not rename public records.
- `src/layout/type-key.ts` and `src/layout/deterministic-sort.ts` are owned by Task 7.
- `src/layout/builder-context.ts` is created by Task 6. Tasks 9-23 must use its `LayoutBuilderIssue`, owner-key, dependency-key, and result contracts instead of inventing task-local result shapes.
- `tests/support/layout/layout-fakes.ts` and `tests/support/layout/layout-fixtures.ts` are created by Task 8. Later tasks append helper builders only when needed by their own tests.
- `src/layout/primitive-layout.ts` and the `src/layout/type-layout.ts` barrel are owned by Task 9.
- `src/layout/layout-type-resolver.ts` is owned by Task 10.
- `src/layout/aggregate-layout.ts` and `tests/unit/layout/aggregate-layout.test.ts` are owned by Task 11.
- `src/layout/enum-layout.ts` and `tests/unit/layout/enum-layout.test.ts` are owned by Task 12.
- `src/layout/image-device-layout.ts` and `tests/unit/layout/image-device-layout.test.ts` are owned by Task 13.
- `src/layout/validated-buffer-value-storage.ts` and `tests/unit/layout/validated-buffer-value-storage.test.ts` are owned by Task 14.
- `src/layout/validated-buffer-terms.ts` and `tests/unit/layout/validated-buffer-terms.test.ts` are owned by Task 15.
- `src/layout/validated-buffer-wire.ts` and `tests/unit/layout/validated-buffer-wire.test.ts` are owned by Task 16.
- `src/layout/validated-buffer-fields.ts`, `src/layout/validated-buffer-layout.ts`, `tests/unit/layout/validated-buffer-fields.test.ts`, and `tests/integration/layout/validated-buffer-layout-facts.test.ts` are owned by Task 17.
- `src/layout/validated-buffer-derived.ts` and `tests/unit/layout/validated-buffer-derived.test.ts` are owned by Task 18.
- `src/layout/source-function-abi.ts` and `tests/unit/layout/source-function-abi.test.ts` are owned by Task 19.
- `src/layout/platform-abi.ts` and `tests/unit/layout/platform-abi.test.ts` are owned by Task 20.
- `src/layout/image-entry-abi.ts`, `src/layout/abi-layout.ts`, and `tests/unit/layout/image-entry-abi.test.ts` are owned by Task 21.
- `src/layout/layout-fact-builder.ts` is created by Task 22. Earlier tasks expose focused builder functions from their own files.
- Shared integration tests are append-only after their creating task. A task that appends to a shared integration test must include only its appended region in its commit.

## Task 1: Shared Wire Encoding Model And Contextual Parser/AST Marker

**Description:** Add a dependency-neutral wire encoding model and parse contextual `le`/`be` markers only in validated-buffer layout field type position. The lexer must continue tokenizing `le` and `be` as identifiers; they are not global keywords.

**Dependencies:** None.

**Files:**

- Create: `src/shared/wire-layout.ts`
- Modify: `src/shared/index.ts`
- Modify: `src/frontend/syntax/syntax-kind.ts`
- Modify: `src/frontend/parser/type-parser.ts`
- Modify: `src/frontend/parser/validated-buffer-parser.ts`
- Modify: `src/frontend/ast/type-views.ts`
- Modify: `src/frontend/ast/field-views.ts`
- Test: `tests/unit/frontend/parser/validated-buffer-parser.test.ts`
- Test: `tests/unit/frontend/ast/validated-buffer-views.test.ts`

**Acceptance Criteria:**

- `WireEndian`, `WireIntegerEncoding`, and `WireScalarEncoding` are exported from `src/shared/wire-layout.ts` and `src/shared/index.ts`.
- `le` and `be` are parsed as contextual marker tokens only when they appear before a layout field type.
- Layout fields without markers still parse exactly as before.
- AST `LayoutFieldView.wireEndian()` returns `"little"`, `"big"`, or `undefined`.
- Non-layout `le` and `be` names remain ordinary identifiers.

**Code Examples:**

```ts
// src/shared/wire-layout.ts
export type WireEndian = "big" | "little";

export type WireIntegerEncoding =
  | {
      readonly kind: "integer";
      readonly endian: WireEndian;
      readonly signedness: "signed" | "unsigned";
      readonly bitWidth: number;
    }
  | { readonly kind: "byte" };

export type WireScalarEncoding = WireIntegerEncoding | { readonly kind: "opaqueBytes" };
```

```ts
// tests/unit/frontend/parser/validated-buffer-parser.test.ts
test("parseLayoutField preserves contextual little-endian marker before type", () => {
  const tokens = [
    makeToken(TokenKind.Identifier, "size", 0, 4),
    makeToken(TokenKind.Colon, ":", 4, 5, " "),
    makeToken(TokenKind.Identifier, "le", 6, 8, " "),
    makeToken(TokenKind.Identifier, "u16", 9, 12, " "),
    makeToken(TokenKind.At, "@", 13, 14, " "),
    makeToken(TokenKind.IntegerLiteral, "0", 15, 16),
    makeToken(TokenKind.Eof, "", 16, 16),
  ];
  const context = makeContext(tokens);
  const node = parseLayoutField(context);

  expect(node?.kind).toBe(SyntaxKind.LayoutField);
  expect(node?.reconstruct()).toBe("size: le u16 @ 0");
  expect(context.draftDiagnostics()).toHaveLength(0);
});
```

```ts
// tests/unit/frontend/ast/validated-buffer-views.test.ts
test("LayoutFieldView exposes contextual wire endian marker", () => {
  const root = parseRoot("validated buffer Packet:\n    layout:\n        size: be u16 @ 0\n");
  const declaration = declarationViews(root)[0] as ValidatedBufferDeclarationView;
  const field = declaration.layoutFields()[0]!;

  expect(field.nameText()).toBe("size");
  expect(field.type()?.qualifiedNameText()).toBe("u16");
  expect(field.wireEndian()).toBe("big");
});
```

**Verification:**

```bash
bun test ./tests/unit/frontend/parser/validated-buffer-parser.test.ts ./tests/unit/frontend/ast/validated-buffer-views.test.ts
```

## Task 2: HIR Enum Case Records

**Description:** Preserve enum cases in source order through typed HIR. Layout must not recover enum case order from AST or item-index views later.

**Dependencies:** None.

**Files:**

- Modify: `src/hir/hir.ts`
- Modify: `src/hir/typed-hir-builder.ts`
- Test: `tests/unit/hir/typed-hir-fixtures.test.ts`
- Test: `tests/integration/hir/declaration-lowering.test.ts`

**Acceptance Criteria:**

- `HirEnumCaseRecord` exists with `enumTypeId`, `caseItemId`, `name`, `ordinal`, and `sourceOrigin`.
- `HirTypeRecord` has `enumCases: readonly HirEnumCaseRecord[]`.
- Enum type records contain cases sorted by source ordinal.
- Non-enum type records contain `enumCases: []`.
- Existing HIR fixture helpers populate `enumCases` in manually constructed records.

**Code Examples:**

```ts
// src/hir/hir.ts
export interface HirEnumCaseRecord {
  readonly enumTypeId: TypeId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly sourceOrigin: HirOriginId;
}

export interface HirTypeRecord {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly sourceKind: SourceItemKind;
  readonly declaredTypeParameters: readonly TypeParameterKey[];
  readonly fieldIds: readonly FieldId[];
  readonly enumCases: readonly HirEnumCaseRecord[];
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}
```

```ts
// tests/integration/hir/declaration-lowering.test.ts
test("typed HIR preserves enum cases in source order", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "enum PacketKind:\n    case Arp\n    case Ipv4\n    case Ipv6\n"],
  ]);
  const enumRecord = result.program.types.entries().find((record) => record.sourceKind === "enum");

  expect(enumRecord?.enumCases.map((caseRecord) => caseRecord.name)).toEqual([
    "Arp",
    "Ipv4",
    "Ipv6",
  ]);
  expect(enumRecord?.enumCases.map((caseRecord) => caseRecord.ordinal)).toEqual([0, 1, 2]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/typed-hir-fixtures.test.ts ./tests/integration/hir/declaration-lowering.test.ts
```

## Task 3: Semantic Wire Encoding Normalization

**Description:** Normalize layout field endian markers into checked wire scalar encodings on the semantic checked field table, and emit deterministic semantic diagnostics for invalid or missing wire encoding.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/semantic/surface/checked-program.ts`
- Modify: `src/semantic/surface/diagnostics.ts`
- Modify: `src/semantic/surface/semantic-surface-checker.ts`
- Test: `tests/unit/semantic/surface/semantic-surface-checker.test.ts`
- Test: `tests/integration/semantic/semantic-surface.test.ts`

**Acceptance Criteria:**

- `CheckedFieldRecord` has `fieldRole` and optional `wireEncoding`.
- Layout fields of `u8` can omit endian and receive `{ kind: "byte" }`.
- Layout fields of `u16`, `u32`, `u64`, and `usize` require `le` or `be`.
- Endian markers on `bool`, `Never`, source types, and target types produce `SURFACE_INVALID_WIRE_ENCODING`.
- The diagnostic order is deterministic and tied to the layout field source span.

**Code Examples:**

```ts
// src/semantic/surface/checked-program.ts
export interface CheckedFieldRecord {
  readonly fieldId: FieldId;
  readonly itemId: ItemId;
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceSpan: SourceSpan;
  readonly fieldRole: import("../item-index").FieldRole;
  readonly wireEncoding?: WireScalarEncoding;
}
```

```ts
// tests/unit/semantic/surface/semantic-surface-checker.test.ts
test("semantic surface requires endian marker for multi-byte layout field", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", ["validated buffer Packet:", "    layout:", "        size: u16 @ 0"].join("\n")],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface stores checked big-endian layout field encoding", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        size: be u16 @ 0\n"],
  ]);
  const sizeField = result.program.fields.entries().find((field) => field.name === "size");

  expect(sizeField?.wireEncoding).toEqual({
    kind: "integer",
    endian: "big",
    signedness: "unsigned",
    bitWidth: 16,
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/semantic-surface-checker.test.ts ./tests/integration/semantic/semantic-surface.test.ts
```

## Task 4: HIR Validated-Buffer Layout Expression Schema And Lowering

**Description:** Preserve validated-buffer layout offsets, optional lengths, derived source expressions, derived cases, and checked wire encodings in typed HIR.

**Dependencies:** Tasks 1 and 3.

**Files:**

- Create: `src/hir/layout-expression-lowerer.ts`
- Modify: `src/hir/hir.ts`
- Modify: `src/hir/validated-buffer-lowerer.ts`
- Modify: `src/hir/typed-hir-builder.ts`
- Test: `tests/unit/hir/validated-buffer-lowerer.test.ts`
- Test: `tests/integration/hir/typed-hir-proof-integration.test.ts`

**Acceptance Criteria:**

- HIR defines a small layout expression model for integer literals, `source.len`, field values, and arithmetic.
- `HirValidatedBuffer.layoutFields` becomes `readonly HirValidatedBufferLayoutField[]`.
- `HirValidatedBuffer.derivedFields` becomes `readonly HirValidatedBufferDerivedField[]`.
- Layout fields carry checked `wireEncoding` from the semantic field table.
- HIR field-value layout expressions preserve field kind (`parameter`, `layout`, or `derived`) and source origin so mono can add concrete type, width, range, and encoding information after substitution.
- Derived cases preserve source order, `otherwise`, result expression, and source origin.
- Unsupported expressions produce `HIR_UNSUPPORTED_LAYOUT_EXPRESSION`.

**Code Examples:**

```ts
// src/hir/hir.ts
export type HirLayoutExpression =
  | {
      readonly kind: "integerLiteral";
      readonly value: bigint;
      readonly sourceOrigin: HirOriginId;
    }
  | { readonly kind: "sourceLength"; readonly sourceOrigin: HirOriginId }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "parameter" | "layout" | "derived";
      readonly sourceOrigin: HirOriginId;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: HirLayoutExpression;
      readonly right: HirLayoutExpression;
      readonly sourceOrigin: HirOriginId;
    };
```

```ts
// tests/unit/hir/validated-buffer-lowerer.test.ts
test("HIR preserves validated-buffer layout offset length and wire encoding", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        payload: u8 @ 3 len expected_len",
      ].join("\n"),
    ],
  ]);
  const buffer = result.program.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields[0]!;

  expect(payload.field.name).toBe("payload");
  expect(payload.offset.kind).toBe("integerLiteral");
  expect(payload.length?.kind).toBe("fieldValue");
  expect(payload.wireEncoding).toEqual({ kind: "byte" });
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/validated-buffer-lowerer.test.ts ./tests/integration/hir/typed-hir-proof-integration.test.ts
```

## Task 5: Mono Enum, Validated-Buffer Layout Surface, And Layout Type Resolutions

**Description:** Preserve enum cases and instantiated validated-buffer layout expression surfaces through mono, and publish mono-owned layout type resolution keys for layout.

**Dependencies:** Tasks 2 and 4.

**Files:**

- Modify: `src/mono/mono-hir.ts`
- Modify: `src/mono/type-instantiator.ts`
- Modify: `src/mono/reachability-finalization.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/type-instantiator.test.ts`
- Test: `tests/integration/mono/whole-image-monomorphization.test.ts`

**Acceptance Criteria:**

- `MonoEnumCaseRecord` exists and `MonoTypeInstance.enumCases` is populated for enum source types.
- `MonoLayoutIntegerWidth`, `MonoLayoutIntegerRange`, `MonoLayoutExpression`, `MonoDerivedFieldCase`, `MonoValidatedBufferLayoutField`, and `MonoValidatedBufferDerivedField` match the design names and fields exactly.
- Mono derives `MonoLayoutExpression.width` from target-size expressions, substituted checked field types, or arithmetic width rules during type instantiation.
- Mono derives finite `MonoLayoutIntegerRange` for parameter fields from checked integer, boolean, or enum type information, for layout fields from `WireIntegerEncoding`, for `sourceLength` from target size, and for arithmetic expressions from conservative bounded arithmetic.
- `MonoValidatedBuffer.layoutFields` carries offset, optional length, wire encoding, and substituted field records.
- `MonoValidatedBuffer.derivedFields` carries source expression and substituted derived case expressions.
- `MonoPublishedLayoutTypeKey`, `MonoLayoutTypeResolution`, and `MonoLayoutTypeResolutionTable` exist in mono, not layout.
- `MonomorphizedHirProgram.layoutTypeResolutions` maps every concrete reachable `MonoCheckedType` fingerprint to a mono-published layout key.
- Mono uses `checkedTypeFingerprint` from `src/semantic/surface/type-model.ts` to populate `MonoLayoutTypeResolution.checkedTypeFingerprint`.
- Duplicate fingerprints are rejected with a mono invariant diagnostic.
- `tests/support/mono/monomorphization-fixtures.ts` exports `genericPacketProgramForMonoTest()` for the integration example in this task.

**Code Examples:**

```ts
// src/mono/mono-hir.ts
export type MonoPublishedLayoutTypeKey =
  | { readonly kind: "source"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export interface MonoLayoutTypeResolution {
  readonly checkedTypeFingerprint: string;
  readonly type: MonoCheckedType;
  readonly key: MonoPublishedLayoutTypeKey;
  readonly sourceOrigin: string;
}

export interface MonoLayoutTypeResolutionTable {
  getByFingerprint(fingerprint: string): MonoLayoutTypeResolution | undefined;
  entries(): readonly MonoLayoutTypeResolution[];
}
```

```ts
// src/mono/mono-hir.ts
export type MonoLayoutIntegerWidth =
  | { readonly kind: "targetSize" }
  | { readonly kind: "type"; readonly type: MonoCheckedType };

export interface MonoLayoutIntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly provenance:
    | "checkedType"
    | "wireEncoding"
    | "sourceLength"
    | "derivedCases"
    | "arithmetic";
}

export type MonoLayoutExpression =
  | {
      readonly kind: "integerLiteral";
      readonly value: bigint;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "sourceLength";
      readonly width: { readonly kind: "targetSize" };
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "parameter";
      readonly type: MonoCheckedType;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "layout";
      readonly type: MonoCheckedType;
      readonly encoding: WireIntegerEncoding;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "derived";
      readonly type: MonoCheckedType;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: MonoLayoutExpression;
      readonly right: MonoLayoutExpression;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    };
```

```ts
// tests/integration/mono/whole-image-monomorphization.test.ts
test("mono publishes layout type resolutions for reachable source and core types", () => {
  const program = genericPacketProgramForMonoTest();
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const entries = result.program.layoutTypeResolutions.entries();
  expect(entries.some((entry) => entry.key.kind === "source")).toBe(true);
  expect(entries.some((entry) => entry.key.kind === "core")).toBe(true);
  for (const entry of entries) {
    expect(
      result.program.layoutTypeResolutions.getByFingerprint(entry.checkedTypeFingerprint),
    ).toEqual(entry);
  }
});
```

**Verification:**

```bash
bun test ./tests/unit/mono/type-instantiator.test.ts ./tests/integration/mono/whole-image-monomorphization.test.ts
```

## Task 6: Layout Public Fact Model And Diagnostics Substrate

**Description:** Create the `src/layout` public model with the target surface contract, fact program interfaces, ABI interfaces, and deterministic diagnostic shape.

**Dependencies:** None.

**Files:**

- Create: `src/layout/index.ts`
- Create: `src/layout/ids.ts`
- Create: `src/layout/target-layout.ts`
- Create: `src/layout/layout-program.ts`
- Create: `src/layout/diagnostics.ts`
- Create: `src/layout/builder-context.ts`
- Test: `tests/unit/layout/diagnostics.test.ts`

**Acceptance Criteria:**

- Every public type listed in the "Public API File Assignment" section exists in the assigned file with the same public name.
- `LayoutDiagnosticCode` is the exact union listed in the "Diagnostic Code Catalog" section.
- `LayoutDiagnostic` supports `"error"`, `"warning"`, and `"note"` severities.
- Diagnostic sorting is stable by source origin, code, owner key, root cause key, and stable detail.
- `LayoutBuilderResult`, `LayoutBuilderIssue`, and `LayoutBuilderDependency` are exported from `src/layout/builder-context.ts` and match the "Shared Builder Contract" section.
- `src/layout/index.ts` exports public types but does not expose internal builder helpers yet.

**Code Examples:**

```ts
// src/layout/index.ts
export * from "./diagnostics";
export * from "./builder-context";
export * from "./ids";
export * from "./layout-program";
export * from "./target-layout";
```

```ts
// src/layout/diagnostics.ts
export type LayoutDiagnosticCode = (typeof LAYOUT_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "LayoutDiagnosticCode";
};

export interface LayoutDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: LayoutDiagnosticCode;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}
```

```ts
// tests/unit/layout/diagnostics.test.ts
test("layout diagnostics sort deterministically", () => {
  const diagnostics: LayoutDiagnostic[] = [
    layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_B",
      message: "b",
      ownerKey: "type:2",
      rootCauseKey: "root",
      stableDetail: "b",
    }),
    layoutDiagnostic({
      severity: "error",
      code: "LAYOUT_A",
      message: "a",
      ownerKey: "type:1",
      rootCauseKey: "root",
      stableDetail: "a",
    }),
  ];

  expect(sortLayoutDiagnostics(diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
    "LAYOUT_A",
    "LAYOUT_B",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/diagnostics.test.ts
```

## Task 7: Layout Deterministic Keys And Tables

**Description:** Implement canonical key serialization and deterministic table helpers. Public table lookup must use structural serialization, never object identity.

**Dependencies:** Task 6.

**Files:**

- Create: `src/layout/deterministic-sort.ts`
- Create: `src/layout/type-key.ts`
- Modify: `src/layout/layout-program.ts`
- Test: `tests/unit/layout/type-key.test.ts`

**Acceptance Criteria:**

- `LayoutCanonicalKeyString` is length-delimited and kind-prefixed.
- `layoutTypeKeyString`, `layoutFieldKeyString`, and `layoutImageDeviceKeyString` are exported.
- `layoutDeterministicTable` implements `get`, `has`, `entries`, and `keyString`.
- Equivalent structural key objects with different identities resolve to the same table entry.
- Entries sort by canonical key code-unit order.

**Code Examples:**

```ts
// tests/unit/layout/type-key.test.ts
test("field table lookup is structural and deterministic", () => {
  const owner = { kind: "source" as const, instanceId: monoInstanceId("type:Packet") };
  const firstKey = { owner, fieldId: fieldId(1) };
  const secondKey = { owner: { ...owner }, fieldId: fieldId(1) };
  const table = layoutDeterministicTable({
    entries: [{ owner, fieldId: fieldId(1), fieldName: "size" }],
    keyOf: (entry) => ({ owner: entry.owner, fieldId: entry.fieldId }),
    keyString: layoutFieldKeyString,
  });

  expect(table.get(firstKey)?.fieldName).toBe("size");
  expect(table.get(secondKey)?.fieldName).toBe("size");
  expect(table.entries().map((entry) => entry.fieldName)).toEqual(["size"]);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/type-key.test.ts
```

## Task 8: Layout Target Fakes And Fixtures

**Description:** Add reusable layout target fakes and closed mono fixtures for unit and integration tests. These fakes are pure objects passed through dependency injection.

**Dependencies:** Task 6.

**Files:**

- Create: `tests/support/layout/layout-fakes.ts`
- Create: `tests/support/layout/layout-fixtures.ts`
- Test: `tests/unit/layout/layout-fixtures.test.ts`

**Acceptance Criteria:**

- `layoutTargetSurfaceFake()` returns a valid little-endian 64-bit target surface with core primitive specs for `bool`, `u8`, `u16`, `u32`, `u64`, `usize`, and `Never`.
- The fake ABI classifier behavior is fixed:
  - zero-sized, unit, never, and zero-sized capability layouts classify as `{ kind: "none" }` with the matching reason
  - primitive unsigned integers classify as one direct unsigned integer lane
  - primitive signed integers classify as one direct signed integer lane
  - primitive addresses classify as one direct pointer lane with provenance from the classification use
  - primitive floats classify as one direct float lane
  - aggregate layouts of size `<= 16` classify as direct opaque lanes split into pointer-sized chunks
  - aggregate layouts of size `> 16` classify as indirect with borrowed ownership for observe uses and caller-allocated ownership for consume and return uses
  - enum layouts classify through their `LayoutEnumFact.tagType`
  - `forceClassifierError?: string` override returns `ClassifyAbiValueResult.kind === "error"` with `LAYOUT_ABI_CLASSIFICATION_FAILED`
- Fixture helpers can construct closed mono programs with a class, enum, validated buffer, image device, platform edge, and image entry.
- Fixture tests assert the helpers contain no filesystem access and no mocks.
- All layout helper names listed in "Common Test Imports And Fixture Helper Inventory" are exported before downstream layout tasks start; `genericPacketProgramForMonoTest` remains owned by Task 5 in the mono fixture file.

**Code Examples:**

```ts
// tests/unit/layout/layout-fixtures.test.ts
test("layout target fake exposes deterministic core primitive entries", () => {
  const target = layoutTargetSurfaceFake();

  expect(target.dataModel.pointerWidthBits).toBe(64);
  expect(target.coreTypes.entries().map((entry) => String(entry.id))).toEqual([
    "Never",
    "bool",
    "u16",
    "u32",
    "u64",
    "u8",
    "usize",
  ]);
});
```

```ts
// tests/support/layout/layout-fakes.ts
export function layoutTargetSurfaceFake(
  overrides: Partial<LayoutTargetSurface> = {},
): LayoutTargetSurface {
  const targetIdValue = targetId("test-target");
  const dataModel = layoutDataModelFake();
  return {
    targetId: targetIdValue,
    dataModel,
    validatedBufferHandle: validatedBufferHandleLayoutFake(),
    coreTypes: layoutPrimitiveCatalogFake(corePrimitiveSpecsFake()),
    targetTypes: layoutPrimitiveCatalogFake(targetPrimitiveSpecsFake()),
    deviceSurfaces: layoutDeviceSurfaceCatalogFake([]),
    imageProfiles: layoutImageProfileCatalogFake([]),
    wireReadHelpers: layoutWireReadHelperCatalogFake([]),
    enumPolicy: enumLayoutPolicyFake(),
    abi: targetAbiSurfaceFake(),
    ...overrides,
  };
}
```

**Verification:**

```bash
bun test ./tests/unit/layout/layout-fixtures.test.ts
```

## Task 9: Target Surface Validation And Primitive Type Facts

**Description:** Validate and normalize target data model, primitive catalogs, enum policy, validated-buffer handle specs, and seed primitive layout facts.

**Dependencies:** Tasks 6, 7, and 8.

**Files:**

- Modify: `src/layout/target-layout.ts`
- Create: `src/layout/primitive-layout.ts`
- Create: `src/layout/type-layout.ts`
- Test: `tests/unit/layout/target-layout.test.ts`
- Test: `tests/unit/layout/type-layout.test.ts`

**Acceptance Criteria:**

- Invalid target data model values produce target-definition diagnostics.
- Primitive sizes are non-negative, alignments are positive powers of two, and pointer-like address specs match pointer facts.
- `Never` is represented as `{ kind: "never" }`; unit-like zero-sized primitives have alignment `1` and stride `0`.
- Primitive type facts are deterministic for core and target catalogs.
- The target `sizeType` resolves to a primitive layout type key.
- Diagnostics use `LAYOUT_INVALID_TARGET_DATA_MODEL`, `LAYOUT_INVALID_TARGET_PRIMITIVE`, `LAYOUT_INVALID_ENUM_POLICY`, `LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE`, or `LAYOUT_MISSING_PRIMITIVE_TYPE` with owner key `target:${targetId}` and root cause key `target-definition`.

**Code Examples:**

```ts
// tests/unit/layout/target-layout.test.ts
test("target validation rejects non-power-of-two primitive alignment", () => {
  const target = layoutTargetSurfaceFake({
    coreTypes: layoutPrimitiveCatalogFake([
      {
        id: coreTypeId("u16"),
        sizeBytes: 2n,
        alignmentBytes: 3n,
        representation: "unsignedInteger",
        bitWidth: 16,
        abiScalarKind: "integer",
      },
    ]),
  });

  const result = validateLayoutTargetSurface(target);

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LAYOUT_INVALID_TARGET_PRIMITIVE",
  );
});
```

```ts
// tests/unit/layout/type-layout.test.ts
test("primitive fact seeding computes stride from size and alignment", () => {
  const target = layoutTargetSurfaceFake();
  const result = seedPrimitiveTypeFacts(target);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const u16 = result.types.get({ kind: "core", coreTypeId: coreTypeId("u16") });
  expect(u16?.sizeBytes).toBe(2n);
  expect(u16?.alignmentBytes).toBe(2n);
  expect(u16?.strideBytes).toBe(2n);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/target-layout.test.ts ./tests/unit/layout/type-layout.test.ts
```

## Task 10: Mono-Published Layout Type Resolver

**Description:** Build the layout-local resolver from mono-published layout type resolutions. Layout validates mono's published keys and never rederives mono canonical type instance keys.

**Dependencies:** Tasks 5, 7, and 9.

**Files:**

- Modify: `src/layout/type-key.ts`
- Create: `src/layout/layout-type-resolver.ts`
- Test: `tests/unit/layout/type-key.test.ts`

**Acceptance Criteria:**

- `buildLayoutTypeResolver(program, targetFacts)` maps checked type fingerprints to `LayoutTypeKey`.
- Missing fingerprints produce `LAYOUT_MISSING_TYPE_RESOLUTION`.
- Duplicate mono-published fingerprints produce `LAYOUT_DUPLICATE_TYPE_RESOLUTION`.
- Published source keys must point at a reachable mono source type instance.
- Published core and target keys must point at target primitive facts.

**Code Examples:**

```ts
// tests/unit/layout/type-key.test.ts
test("layout resolver uses mono-published source type key", () => {
  const program = closedMonoProgramWithPacketType();
  const target = layoutTargetSurfaceFake();
  const targetFacts = normalizeTargetFactsForTest(target);
  const resolver = buildLayoutTypeResolver({ program, targetFacts });
  const packetType = program.layoutTypeResolutions
    .entries()
    .find((entry) => entry.key.kind === "source")!;

  expect(resolver.get(packetType.type)).toEqual({
    kind: "source",
    instanceId: packetType.key.instanceId,
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/type-key.test.ts
```

## Task 11: Source Aggregate Layout And Field Facts

**Description:** Compute source aggregate layout facts, source field offsets, direct padding ranges, transitive padding ranges, and zero-sized capability token representation.

**Dependencies:** Tasks 5, 9, and 10.

**Files:**

- Create: `src/layout/aggregate-layout.ts`
- Test: `tests/unit/layout/aggregate-layout.test.ts`

**Acceptance Criteria:**

- `dataclass`, `class`, `edgeClass`, `stream`, and validated-buffer parameter fields use source order.
- Source fields are never reordered by size or alignment.
- Aggregate size is rounded up to aggregate alignment; stride equals rounded size.
- Direct and nested padding ranges are recorded deterministically.
- Stored `Never`, unsupported interface/image/function/enumCase runtime values, unsized fields, and recursive by-value cycles are errors.
- Empty proof-carrying capability source types produce zero-sized capability facts.
- Diagnostics use `LAYOUT_RECURSIVE_TYPE_LAYOUT`, `LAYOUT_FORBIDDEN_NEVER_STORAGE`, `LAYOUT_UNSUPPORTED_SOURCE_REPRESENTATION`, `LAYOUT_AGGREGATE_LAYOUT_OVERFLOW`, `LAYOUT_FIELD_ALIGNMENT_OVERFLOW`, or `LAYOUT_MISSING_FIELD_TYPE_LAYOUT` with owner key `type:${instanceId}` and root cause key `type:${instanceId}`.

**Code Examples:**

```ts
// tests/unit/layout/aggregate-layout.test.ts
test("aggregate layout preserves source field order and padding", () => {
  const input = aggregateLayoutFixture({
    fields: [
      { name: "tag", type: coreCheckedType(coreTypeId("u8")) },
      { name: "size", type: coreCheckedType(coreTypeId("u32")) },
    ],
  });
  const result = computeSourceAggregateLayout(input);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.fieldFacts.map((field) => [field.fieldName, field.offsetBytes])).toEqual([
    ["tag", 0n],
    ["size", 4n],
  ]);
  expect(result.typeFact.aggregateStorage?.paddingRanges).toEqual([
    { offsetBytes: 1n, sizeBytes: 3n, kind: "interField" },
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/aggregate-layout.test.ts
```

## Task 12: Fieldless Enum Facts

**Description:** Compute fieldless enum tag layout facts, deterministic discriminants, and tag type selection through the target enum policy.

**Dependencies:** Tasks 5, 9, and 10.

**Files:**

- Create: `src/layout/enum-layout.ts`
- Test: `tests/unit/layout/enum-layout.test.ts`

**Acceptance Criteria:**

- Fieldless enum cases are sorted by source ordinal.
- Discriminants are `discriminantStart + ordinal`.
- The first unsigned candidate tag type whose bit width fits all discriminants is selected.
- Empty enums, negative discriminant starts, non-unsigned candidate tag types, overflow, and payload-bearing cases are errors.
- Enum type facts have representation `{ kind: "enum" }`, and the enum fact table owns the tag type.
- Diagnostics use `LAYOUT_EMPTY_ENUM_REJECTED`, `LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START`, `LAYOUT_ENUM_DISCRIMINANT_OVERFLOW`, or `LAYOUT_UNSUPPORTED_ENUM_PAYLOAD` with owner key `enum:${instanceId}` and root cause key `enum:${instanceId}`.

**Code Examples:**

```ts
// tests/unit/layout/enum-layout.test.ts
test("enum layout selects smallest unsigned tag type that fits cases", () => {
  const result = computeEnumLayout(
    enumLayoutFixture({
      cases: ["Arp", "Ipv4", "Ipv6"],
      candidateTagTypes: [coreTypeId("u8"), coreTypeId("u16")],
      discriminantStart: 0n,
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.enumFact.tagType).toEqual({ kind: "core", coreTypeId: coreTypeId("u8") });
  expect(result.enumFact.cases.map((caseFact) => caseFact.discriminant)).toEqual([0n, 1n, 2n]);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/enum-layout.test.ts
```

## Task 13: Image Device Facts

**Description:** Compute image device layout facts from mono image devices and the target layout device surface catalog.

**Dependencies:** Tasks 5, 9, and 10.

**Files:**

- Create: `src/layout/image-device-layout.ts`
- Test: `tests/unit/layout/image-device-layout.test.ts`

**Acceptance Criteria:**

- Every mono image device receives a `LayoutImageDeviceFact`.
- Missing target device surface specs produce `LAYOUT_MISSING_DEVICE_SURFACE`.
- Zero-sized device capabilities preserve proof brand IDs and emit no runtime bytes.
- Target-handle device capabilities reference a target primitive type fact and include its layout.
- Image device facts sort by image instance ID and field ID.
- Diagnostics use `LAYOUT_MISSING_DEVICE_SURFACE` with owner key `image-device:${imageInstanceId}:${fieldId}`, root cause key `device-surface:${deviceSurfaceId}`, and stable detail `${targetId}:${deviceSurfaceId}`.

**Code Examples:**

```ts
// tests/unit/layout/image-device-layout.test.ts
test("image device fact records zero-sized capability representation", () => {
  const result = computeImageDeviceFacts(
    imageDeviceLayoutFixture({
      representation: { kind: "zeroSizedCapability" },
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.devices.entries()[0]?.representation).toEqual({ kind: "zeroSizedCapability" });
  expect(result.devices.entries()[0]?.brandIds).toHaveLength(1);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/image-device-layout.test.ts
```

## Task 14: Validated-Buffer Hidden Value Storage

**Description:** Add validated-buffer wrapper storage facts: hidden source pointer, hidden source length, and parameter field start offset. Ensure these hidden fields are consistent with the owning aggregate type fact.

**Dependencies:** Tasks 5, 10, and 11.

**Files:**

- Create: `src/layout/validated-buffer-value-storage.ts`
- Test: `tests/unit/layout/validated-buffer-value-storage.test.ts`

**Acceptance Criteria:**

- Validated-buffer aggregate storage begins with target-defined hidden source pointer and source length fields.
- Parameter fields follow hidden fields in declaration order.
- Layout and derived fields never receive wrapper source field offsets.
- `LayoutValidatedBufferFact.valueStorage` references the same hidden storage field objects as `LayoutTypeFact.aggregateStorage.hiddenFields`.
- Missing pointer or length primitive specs produce deterministic diagnostics.
- Diagnostics use `LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH` or `LAYOUT_MISSING_PRIMITIVE_TYPE` with owner key `validated-buffer:${instanceId}:value-storage` and root cause key `validated-buffer:${instanceId}`.

**Code Examples:**

```ts
// tests/unit/layout/validated-buffer-value-storage.test.ts
test("validated-buffer value storage repeats hidden aggregate storage fields", () => {
  const result = computeValidatedBufferValueStorage(validatedBufferLayoutFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const hiddenFields = result.ownerTypeFact.aggregateStorage?.hiddenFields ?? [];
  expect(result.valueStorage.sourcePointer).toBe(hiddenFields[0]);
  expect(result.valueStorage.sourceLength).toBe(hiddenFields[1]);
  expect(result.valueStorage.parameterFieldsStartOffsetBytes).toBeGreaterThanOrEqual(0n);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/validated-buffer-value-storage.test.ts
```

## Task 15: Layout Term Translation, Ranges, And Affine Ordering

**Description:** Translate mono layout expressions into typed `LayoutTerm` values with finite ranges, arithmetic overflow requirements, and affine ordering support. Implement the affine normalizer described in `docs/design/representation-layout-facts-design.md` under "Validated-Buffer Facts", especially the `constant + sum(symbol * nonNegativeConstant)` ordering rule.

**Dependencies:** Tasks 5 and 10.

**Files:**

- Create: `src/layout/validated-buffer-terms.ts`
- Test: `tests/unit/layout/validated-buffer-terms.test.ts`

**Acceptance Criteria:**

- Integer literals, `source.len`, parameter field values, layout field values, derived field values, and structural arithmetic translate to `LayoutTerm`.
- Every term has a finite `LayoutIntegerRange`.
- `source.len` uses the target size type and range `[0, maximumObjectSizeBytes]`.
- Multiplication is accepted when one side is a non-negative constant.
- Subtraction emits a range constraint when non-negativity depends on runtime values.
- Arithmetic that can wrap emits `noUnsignedOverflow` requirements.
- Terms outside the accepted language are rejected before fact construction.
- `translateLayoutTerm`, `normalizeAffineLayoutTerm`, and `compareLayoutTermOrder` are exported from `src/layout/validated-buffer-terms.ts`.
- Diagnostics use `LAYOUT_INVALID_LAYOUT_TERM`, `LAYOUT_TERM_RANGE_MISSING`, or `LAYOUT_TERM_ARITHMETIC_OVERFLOW` with owner key `validated-buffer:${instanceId}:term:${fieldId}` and stable detail `${sourceOrigin}:${term.kind}`.

**Code Examples:**

```ts
// tests/unit/layout/validated-buffer-terms.test.ts
test("source length minus constant emits range constraint", () => {
  const result = translateLayoutTerm(
    termTranslationFixture({
      expression: monoSubtract(monoSourceLength(), monoIntegerLiteral(14n)),
      unit: "byteLength",
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.term.kind).toBe("subtract");
  expect(result.requirements).toContainEqual({
    kind: "rangeConstraint",
    left: constantLayoutTerm(14n, "byteLength"),
    relation: "<=",
    right: sourceLengthLayoutTermForTest(),
    width: { kind: "core", coreTypeId: coreTypeId("usize") },
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/validated-buffer-terms.test.ts
```

## Task 16: Wire Type Facts, Read Policies, And Helper Validation

**Description:** Compute wire type facts for scalar and target-provided aggregate layout fields, choose unaligned-safe read policies, and validate target-provided helper contracts.

**Dependencies:** Tasks 9 and 10.

**Files:**

- Create: `src/layout/validated-buffer-wire.ts`
- Test: `tests/unit/layout/validated-buffer-wire.test.ts`

**Acceptance Criteria:**

- Scalar wire fields require wire-compatible primitive type facts.
- Multi-byte scalar wire fields require explicit `WireIntegerEncoding`.
- Wire byte width must match the selected primitive type's bit width and size.
- Zero-sized wire elements are rejected when element count can be non-zero.
- Target-provided read helpers must exist, match encoding, and match result type.
- Unaligned reads are represented as bytewise, target-safe unaligned, or target-provided policies; layout never implies host alignment.
- Diagnostics use `LAYOUT_MISSING_WIRE_ENCODING`, `LAYOUT_INVALID_WIRE_ENCODING`, `LAYOUT_ZERO_SIZED_WIRE_ELEMENT`, `LAYOUT_WIRE_HELPER_MISSING`, or `LAYOUT_WIRE_HELPER_MISMATCH` with owner key `wire:${fieldId}` and root cause key `wire:${fieldId}`.

**Code Examples:**

```ts
// tests/unit/layout/validated-buffer-wire.test.ts
test("multi-byte scalar wire field without encoding is rejected", () => {
  const result = computeWireTypeFact(
    wireTypeFixture({
      type: coreCheckedType(coreTypeId("u16")),
      wireEncoding: undefined,
    }),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LAYOUT_MISSING_WIRE_ENCODING",
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/validated-buffer-wire.test.ts
```

## Task 17: Validated-Buffer Layout Field Facts And Read Requirements

**Description:** Build `LayoutValidatedBufferFieldFact` entries for fixed and dynamic external source-buffer fields, including byte lengths, ends, read requirements, dependency validation, and interval ordering. Implement the fixed/dynamic interval and `readRequires` contract from `docs/design/representation-layout-facts-design.md` under "Validated-Buffer Facts".

**Dependencies:** Tasks 14, 15, and 16.

**Files:**

- Create: `src/layout/validated-buffer-fields.ts`
- Create: `src/layout/validated-buffer-layout.ts`
- Test: `tests/unit/layout/validated-buffer-fields.test.ts`
- Test: `tests/integration/layout/validated-buffer-layout-facts.test.ts`

**Acceptance Criteria:**

- Fields are processed in declaration order.
- A field can depend only on parameters and earlier layout or derived fields.
- Missing `len` means `elementCount` is constant `1`.
- `byteLength` is `elementCount * wireStrideBytes`; `end` is `offset + byteLength`.
- Fixed fields contribute to `fixedEndBytes`.
- Dynamic fields emit `payloadEnd(end)`, `layoutFits(end)`, range constraints, overflow requirements, and field availability requirements as needed.
- Constant intervals must not overlap.
- Dynamic intervals must have structural ordering proof or explicit proof requirements; ambiguous intervals are rejected.
- `computeValidatedBufferFieldFacts`, `validateLayoutFieldDependencies`, `validateLayoutFieldIntervals`, and `buildLayoutReadRequirements` are exported from `src/layout/validated-buffer-fields.ts`.
- Diagnostics use `LAYOUT_FIELD_FORWARD_DEPENDENCY`, `LAYOUT_FIELD_OVERLAP`, or `LAYOUT_FIELD_AMBIGUOUS_ORDER` with owner key `validated-buffer:${instanceId}:field:${fieldId}` and root cause key `validated-buffer:${instanceId}`.

**Code Examples:**

```ts
// tests/integration/layout/validated-buffer-layout-facts.test.ts
test("dynamic payload emits payloadEnd and layoutFits read requirements", () => {
  const result = computeRepresentationLayoutFacts(
    validatedBufferProgramFixture({
      layoutSource: ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const buffer = result.facts.validatedBuffers.entries()[0]!;
  const payload = buffer.layoutFields.find((field) => field.name === "payload")!;
  expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("payloadEnd");
  expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("layoutFits");
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/validated-buffer-fields.test.ts ./tests/integration/layout/validated-buffer-layout-facts.test.ts
```

## Task 18: Validated-Buffer Derived Field Facts

**Description:** Build derived field facts as ordered total decision tables over already-available source terms.

**Dependencies:** Tasks 15 and 17.

**Files:**

- Create: `src/layout/validated-buffer-derived.ts`
- Test: `tests/unit/layout/validated-buffer-derived.test.ts`

**Acceptance Criteria:**

- Derived source expression translates to a `LayoutTerm`.
- Case expressions are equality values against the source term.
- At most one `otherwise` case is allowed, and it must be last.
- Duplicate equality values are rejected.
- Equality values outside the source term range are rejected.
- Without `otherwise`, finite interval coverage must be complete.
- Result terms produce a finite union range.
- Diagnostics use `LAYOUT_DERIVED_OTHERWISE_NOT_LAST`, `LAYOUT_DERIVED_DUPLICATE_CASE`, `LAYOUT_DERIVED_CASE_OUT_OF_RANGE`, or `LAYOUT_DERIVED_CASE_NOT_TOTAL` with owner key `validated-buffer:${instanceId}:derived:${fieldId}` and root cause key `validated-buffer:${instanceId}`.

**Code Examples:**

```ts
// tests/unit/layout/validated-buffer-derived.test.ts
test("derived cases require otherwise to be last", () => {
  const result = computeDerivedFieldFacts(
    derivedFieldFixture({
      cases: [
        { condition: { kind: "otherwise" }, result: monoIntegerLiteral(0n) },
        { condition: monoIntegerLiteral(1n), result: monoIntegerLiteral(1n) },
      ],
    }),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LAYOUT_DERIVED_OTHERWISE_NOT_LAST",
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/validated-buffer-derived.test.ts
```

## Task 19: Source Function ABI Facts

**Description:** Integrate the target ABI classifier for monomorphized source function receivers, parameters, return values, zero-sized proof-carrying values, and hidden parameters.

**Dependencies:** Tasks 11, 12, and 13.

**Files:**

- Create: `src/layout/source-function-abi.ts`
- Test: `tests/unit/layout/source-function-abi.test.ts`
- Test: `tests/integration/layout/abi-shapes.test.ts`

**Acceptance Criteria:**

- Every reachable source function receives a `LayoutFunctionAbiFact`.
- Receiver, parameter, and return classification use computed `LayoutTypeFact` and enum facts.
- Observe indirect parameters use borrowed ownership; consume indirect parameters use caller-allocated ownership.
- Zero-sized capability tokens classify as `none` with `proofCarrying: true`.
- Hidden parameters referenced by indirect shapes appear exactly once in `hiddenParameters`.
- Hidden parameter `physicalIndex` matches physical ABI argument order.
- ABI classifier errors produce layout diagnostics and no partial ABI fact.
- `computeSourceFunctionAbiFacts`, `classifySourceAbiParameter`, `classifySourceAbiReturn`, and `validateHiddenAbiParameters` are exported from `src/layout/source-function-abi.ts`.
- Diagnostics use `LAYOUT_ABI_CLASSIFICATION_FAILED` or `LAYOUT_ABI_HIDDEN_PARAMETER_INCONSISTENT` with owner key `function:${functionInstanceId}` and root cause key `abi:${functionInstanceId}`.

**Code Examples:**

```ts
// tests/unit/layout/source-function-abi.test.ts
test("consume indirect parameter uses caller-allocated ABI ownership", () => {
  const result = computeFunctionAbiFact(
    functionAbiFixture({
      parameterMode: "consume",
      classifierShape: {
        kind: "indirect",
        pointer: pointerShape64(),
        pointee: sourceLayoutTypeKey("Packet"),
        ownership: "callerAllocated",
      },
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const shape = result.fact.parameters[0]!.shape;
  expect(shape.kind).toBe("indirect");
  if (shape.kind === "indirect") expect(shape.ownership).toBe("callerAllocated");
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/source-function-abi.test.ts ./tests/integration/layout/abi-shapes.test.ts
```

## Task 20: Platform Edge ABI Facts

**Description:** Compute platform edge ABI facts for reachable certified platform calls under the target platform call convention.

**Dependencies:** Task 19.

**Files:**

- Create: `src/layout/platform-abi.ts`
- Test: `tests/unit/layout/platform-abi.test.ts`
- Test: `tests/integration/layout/abi-shapes.test.ts`

**Acceptance Criteria:**

- Every reachable mono platform contract edge receives a `LayoutPlatformAbiFact`.
- Layout rejects platform edges whose `targetId` does not match `LayoutTargetSurface.targetId`.
- Platform arguments and return values classify under `TargetAbiSurface.platformCallConvention`.
- Platform ABI facts preserve primitive ID, contract ID, target ID, edge ID, and source origin.
- Platform edge ABI diagnostics are suppressed when source function ABI already failed from the same root type.
- `computePlatformAbiFacts` and `checkPlatformEdgeTargetIds` are exported from `src/layout/platform-abi.ts`.
- Target mismatch diagnostics use owner key `platform-edge:${edgeId.instanceId}:${edgeId.hirId}`, root cause key `target:${targetId}`, and stable detail `${edge.targetId}->${target.targetId}`.

**Code Examples:**

```ts
// tests/integration/layout/abi-shapes.test.ts
test("platform edge target mismatch is rejected before ABI classification", () => {
  const result = computeRepresentationLayoutFacts(
    platformEdgeProgramFixture({
      edgeTargetId: targetId("wrong-target"),
      layoutTarget: layoutTargetSurfaceFake({ targetId: targetId("selected-target") }),
    }),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LAYOUT_PLATFORM_TARGET_MISMATCH",
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/platform-abi.test.ts ./tests/integration/layout/abi-shapes.test.ts
```

## Task 21: Image Entry ABI Facts

**Description:** Compute the target physical image entry ABI fact and source entry thunk conversion facts from the selected target image profile.

**Dependencies:** Task 19.

**Files:**

- Create: `src/layout/image-entry-abi.ts`
- Create: `src/layout/abi-layout.ts`
- Test: `tests/unit/layout/image-entry-abi.test.ts`
- Test: `tests/integration/layout/abi-shapes.test.ts`

**Acceptance Criteria:**

- Layout rejects mono images with no entry function.
- Layout rejects missing target image profile specs.
- Physical entry arguments classify under the profile call convention.
- Source entry arguments classify under the target source call convention.
- `thunkConversions` maps every source entry argument exactly once, except compiler-materialized zero-sized proof capabilities.
- Image entry result classification uses the profile result spec and source function return fact.
- `computeImageEntryAbiFact`, `classifyPhysicalImageEntry`, `classifySourceImageEntry`, and `buildImageEntryThunkConversions` are exported from `src/layout/image-entry-abi.ts`.
- Missing profile diagnostics use `LAYOUT_MISSING_IMAGE_PROFILE` with owner key `image:${imageInstanceId}`, root cause key `profile:${profileId}`, and stable detail `${targetId}:${profileId}`.

**Code Examples:**

```ts
// tests/unit/layout/image-entry-abi.test.ts
test("image entry fact records firmware argument thunk conversion", () => {
  const result = computeImageEntryAbiFact(imageEntryAbiFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.fact.physicalCallConvention).toBe(targetCallConventionId("uefi-aarch64"));
  expect(result.fact.thunkConversions).toContainEqual({
    source: "firmwareArgument",
    targetParameterIndex: 0,
    sourceEntryParameterId: parameterId(0),
    shape: result.fact.sourceEntryArguments[0],
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/image-entry-abi.test.ts ./tests/integration/layout/abi-shapes.test.ts
```

## Task 22: Layout Fact Builder Orchestration

**Description:** Implement `computeRepresentationLayoutFacts` as the fixed pipeline from target validation through consistency-ready fact program construction.

**Dependencies:** Tasks 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, and 21.

**Files:**

- Create: `src/layout/layout-fact-builder.ts`
- Modify: `src/layout/index.ts`
- Test: `tests/integration/layout/representation-layout-facts.test.ts`

**Acceptance Criteria:**

- `computeRepresentationLayoutFacts(input)` has the public signature from the design.
- The builder runs in this order: validate target, target mismatch check, type resolver, primitive facts, source type facts, field facts, enum facts, image devices, validated buffers, function ABI, platform ABI, image entry ABI.
- `kind: "ok"` is returned only when there are no error diagnostics.
- `kind: "ok"` may contain warning or note diagnostics.
- Error diagnostics are sorted deterministically.
- The phase does not import filesystem, Bun, parser, AST views, Proof MIR, codegen, linker, or PE/COFF modules.

**Code Examples:**

```ts
// src/layout/layout-fact-builder.ts
export function computeRepresentationLayoutFacts(
  input: ComputeRepresentationLayoutFactsInput,
): ComputeRepresentationLayoutFactsResult {
  const context = createLayoutFactBuilderContext(input);
  context.runTargetValidation();
  context.runTypeResolution();
  context.runSourceRepresentations();
  context.runValidatedBuffers();
  context.runAbiFacts();
  context.runConsistencyChecks();
  return context.finish();
}
```

```ts
// tests/integration/layout/representation-layout-facts.test.ts
test("closed aggregate program produces complete layout fact program", () => {
  const result = computeRepresentationLayoutFacts(aggregateProgramLayoutFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.facts.types.entries().length).toBeGreaterThan(0);
  expect(result.facts.fields.entries().map((field) => field.fieldName)).toContain("size");
  expect(result.facts.functions.entries().length).toBeGreaterThan(0);
});
```

**Verification:**

```bash
bun test ./tests/integration/layout/representation-layout-facts.test.ts
```

## Task 23: Consistency Checks And Diagnostic Cascade Suppression

**Description:** Add consistency checks and dependency-based diagnostic suppression so one root representation error does not create repeated downstream errors.

**Dependencies:** Task 22.

**Files:**

- Modify: `src/layout/layout-fact-builder.ts`
- Modify: `src/layout/diagnostics.ts`
- Test: `tests/unit/layout/diagnostics.test.ts`
- Test: `tests/integration/layout/representation-layout-facts.test.ts`

**Acceptance Criteria:**

- Builders record owner keys and dependency owner keys.
- Task 23 does not edit focused builder modules from Tasks 9-21; it consumes their `LayoutBuilderResult` metadata through `LayoutBuilderContext`.
- Duplicate errors with the same `code`, `ownerKey`, and `rootCauseKey` are suppressed by stable detail ordering.
- Downstream builders skip generic missing-layout errors when an upstream dependency already failed.
- Consistency checks reject mismatched validated-buffer hidden storage, dangling enum facts, dangling field facts, unreferenced hidden ABI parameters, and hidden parameters referenced by multiple shapes unless intentionally shared by target data.
- Downstream builders may emit notes only when they add narrower context to an existing root diagnostic.

**Code Examples:**

```ts
// tests/unit/layout/diagnostics.test.ts
test("dependency suppression keeps one root missing primitive error", () => {
  const result = computeRepresentationLayoutFacts(
    aggregateProgramLayoutFixture({
      target: layoutTargetSurfaceWithoutCoreType(coreTypeId("u32")),
    }),
  );

  expect(result.kind).toBe("error");
  const missingPrimitive = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "LAYOUT_MISSING_PRIMITIVE_TYPE",
  );
  const missingLayout = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "LAYOUT_MISSING_FIELD_TYPE_LAYOUT",
  );
  expect(missingPrimitive).toHaveLength(1);
  expect(missingLayout).toHaveLength(0);
});
```

**Verification:**

```bash
bun test ./tests/unit/layout/diagnostics.test.ts ./tests/integration/layout/representation-layout-facts.test.ts
```

## Task 24: Public API And Integration Coverage

**Description:** Wire `src/layout` into public barrels and add integration tests covering public API, representative fact tables, validated buffers, ABI shapes, and unsupported representation rejection.

**Dependencies:** Tasks 22 and 23.

**Files:**

- Modify: `src/index.ts`
- Modify: `src/layout/index.ts`
- Create: `tests/integration/layout/public-api.test.ts`
- Modify: `tests/integration/layout/representation-layout-facts.test.ts`
- Modify: `tests/integration/layout/validated-buffer-layout-facts.test.ts`
- Modify: `tests/integration/layout/abi-shapes.test.ts`

**Acceptance Criteria:**

- `import { computeRepresentationLayoutFacts } from "../../../src/layout"` works.
- `import { layout } from "../../../src"` works.
- Public API tests compile all exported layout type names needed by downstream Proof MIR and codegen.
- Integration coverage includes a monomorphized generic aggregate with distinct concrete field facts.
- Integration coverage includes unsupported runtime interface values rejected before Proof MIR.
- Integration coverage includes aggregate trailing padding facts.

**Code Examples:**

```ts
// tests/integration/layout/public-api.test.ts
test("layout public API computes facts from closed mono program", () => {
  const monoResult = monomorphizeWholeImage({
    program: typedHirProgramForLayoutIntegration(),
  });
  expect(monoResult.kind).toBe("ok");
  if (monoResult.kind !== "ok") return;

  const layoutResult = computeRepresentationLayoutFacts({
    program: monoResult.program,
    target: layoutTargetSurfaceFake(),
  });

  expect(layoutResult.kind).toBe("ok");
});
```

```ts
// src/index.ts
export * as layout from "./layout";
```

**Verification:**

```bash
bun test ./tests/integration/layout/public-api.test.ts ./tests/integration/layout/representation-layout-facts.test.ts ./tests/integration/layout/validated-buffer-layout-facts.test.ts ./tests/integration/layout/abi-shapes.test.ts
```

## Task 25: Determinism, Property Tests, And Final Verification

**Description:** Harden deterministic output with repeated-run tests and independent property-test oracles for aggregate offsets, enum discriminants, and validated-buffer derived case coverage.

**Dependencies:** Task 24.

**Files:**

- Create: `tests/integration/layout/layout-determinism.test.ts`
- Modify: `tests/unit/layout/aggregate-layout.test.ts`
- Modify: `tests/unit/layout/enum-layout.test.ts`
- Modify: `tests/unit/layout/validated-buffer-derived.test.ts`

**Acceptance Criteria:**

- Running layout twice on the same mono program and target produces byte-for-byte identical JSON-safe projections of facts and diagnostics.
- Aggregate property tests compare production offsets against an independent offset oracle.
- Enum property tests compare discriminant assignment and tag selection against an independent finite-range oracle.
- Derived-case property tests compare coverage and duplicate rejection against an independent interval-set oracle.
- `fast-check` is imported only from tests.
- `bun run agent:check` passes before handoff.

**Code Examples:**

```ts
// tests/integration/layout/layout-determinism.test.ts
test("layout fact program is deterministic across repeated runs", () => {
  const input = deterministicLayoutProgramFixture();
  const first = computeRepresentationLayoutFacts(input);
  const second = computeRepresentationLayoutFacts(input);

  expect(stableLayoutProjection(first)).toEqual(stableLayoutProjection(second));
});
```

```ts
// tests/unit/layout/aggregate-layout.test.ts
test("aggregate offsets match independent oracle for generated primitive fields", () => {
  fc.assert(
    fc.property(primitiveFieldListArbitrary(), (fields) => {
      const result = computeSourceAggregateLayout(aggregateLayoutFixture({ fields }));
      fc.pre(result.kind === "ok");
      if (result.kind !== "ok") return true;
      return expect(result.fieldFacts.map(fieldOffsetProjection)).toEqual(
        aggregateOffsetOracle(fields),
      );
    }),
  );
});
```

**Verification:**

```bash
bun test ./tests/integration/layout/layout-determinism.test.ts ./tests/unit/layout/aggregate-layout.test.ts ./tests/unit/layout/enum-layout.test.ts ./tests/unit/layout/validated-buffer-derived.test.ts
bun run agent:check
```

## Final Handoff Checklist

- [ ] Every task above has landed or is intentionally still unchecked in the implementation branch.
- [ ] No runtime source imports `fast-check`.
- [ ] `src/layout` has no filesystem, Bun, parser, AST, Proof MIR, codegen, linker, or PE/COFF imports.
- [ ] Public layout fact tables use structural canonical key lookup, not object identity.
- [ ] Diagnostics are sorted and cascade suppression has integration coverage.
- [ ] `bun run agent:check` passes.
