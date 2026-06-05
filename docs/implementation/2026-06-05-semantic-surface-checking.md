# Semantic Surface Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the semantic surface checking subsystem from `docs/design/semantic-surface-checking-design.md`.

**Architecture:** Semantic surface checking lives under `src/semantic/surface`. It consumes `ParsedModuleGraph`, `ItemIndex`, `ResolvedReferences`, name-only `ResolvedPlatformBindings`, a `CoreTypeCatalog`, a pure `SemanticTargetSurface`, and an optional image root selection. It produces checked declaration/signature/type/resource tables, proof-surface seeds, certified platform primitive bindings, an optional checked image seed, and deterministic diagnostics. HIR remains responsible for source-shaped body lowering and final proof IDs; Proof MIR remains responsible for path-sensitive obligations.

**Tech Stack:** TypeScript, Bun test runner, existing frontend AST views, semantic item index, semantic name-resolution APIs, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- Current source state already has `src/semantic/names` and source-only item-index APIs. Implement semantic surface on top of those APIs; do not reintroduce intrinsic modules or intrinsic item records.
- Commands in this environment need Bun on PATH:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/resource-kind.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun run agent:check
```

- `ItemIndex` exposes dense stable arrays and lookup helpers:

```ts
index.modules();
index.items();
index.types();
index.functions();
index.images();
index.fields();
index.typeParameters();
index.parameters();

index.item(itemId);
index.type(typeId);
index.function(functionId);
index.image(imageId);
index.field(fieldId);
index.parameter(parameterId);
index.typeParametersForItem(itemId);
index.typeParametersForFunction(functionId);
index.parametersForFunction(functionId);
```

- Name resolution result shapes are already available:

```ts
references.get(key);
references.entries();
references.deferredMembers();
platformBindings.get(functionId);
platformBindings.entries();
```

- `ResolvedReference` includes `builtinType`, `type`, `typeParameter`, `function`, `image`, `field`, and `parameter` variants. Semantic surface must not string-resolve names that name resolution already resolved.
- Deferred member references are represented as `DeferredMemberReference` and completed through `buildMemberNamespace(index).resolveMember(...)`.
- `TypeParameterRecord` uses `{ owner, index }`. Do not introduce a separate "ordinal" name for type parameters; `ordinal` is already used by `SyntaxReferenceKey`.
- `ResolvedReferences.get` requires a full `SyntaxReferenceKey`, not a span. Semantic surface must build a secondary lookup from `references.entries()` keyed by module, span, and `NameReferenceKind`; callers must diagnose ambiguous same-span/same-kind entries instead of guessing an ordinal.
- Item-index `ParameterRecord` currently carries `isConsumed: boolean`; map this to checked parameter mode `"consume"` or `"observe"` in v1.
- Function modifiers are source-shaped strings from AST views and item records:

```ts
type FunctionModifier = "private" | "platform" | "terminal" | "predicate" | "constructor";
```

- Existing AST accessors needed by the plan:

```ts
TypeReferenceView.qualifiedNameText();
TypeReferenceView.typeArguments();
TypeParameterView.nameText();
TypeParameterView.bound();
FunctionDeclarationView.parameters();
FunctionDeclarationView.typeParameters();
FunctionDeclarationView.returnType();
FunctionDeclarationView.requiresSections();
ParameterView.type();
ParameterView.isConsumed();
ImageDeclarationView.deviceFields();
ImageDeclarationView.memberFunctions();
FieldDeclarationView.type();
RequiresSectionView.requirements();
RequirementView.expression();
```

- `uefi image` is the only image declaration form in v1. It maps to the target image profile whose `declarationKind` is `"uefi"`.
- Platform certification v1 is exact structural mirroring. Do not implement predicate-strength entailment or "stronger source contract" reasoning in semantic surface.
- Deterministic string ordering must use code-unit comparison (`<`/`>`) through `compareCodeUnitStrings`; do not use `localeCompare` in semantic surface runtime or test summary code.
- Body-local expression inference, full call-site checking, terminal reachability, `take` closure, validation/attempt convergence, and proof IDs are not semantic surface work.
- The implementation plan intentionally contains code examples. Workers should implement real source in the listed files during execution, not copy the plan file into runtime source.

## Parallel Execution Model

Use these waves to avoid merge conflicts. Tasks in the same wave can run in parallel when their dependencies are satisfied.

```text
Wave 0:
  Task 1: Surface ID brands
  Task 2: Diagnostics and sorting
  Task 4: Resource-kind model

Wave 1:
  Task 5 after Task 1 and Task 4: Checked type model
  Task 7A after Task 2: Reference lookup index

Wave 2:
  Task 3 after Tasks 1, 4, 5, and 7A: Target surface catalog and shared fakes
  Task 6 after Tasks 1, 2, 4, and 5: Checked result tables

Wave 3:
  Task 7 after Tasks 2, 3, 5, 6, and 7A: Type-reference checker
  Task 11 after Tasks 2 and 6: Requirement and proof-surface seeds

Wave 4:
  Task 8 after Tasks 7 and 7A: Generic and interface checker
  Task 9 after Tasks 4, 5, 6, 7, and 7A: Resource-kind checker
  Task 14 after Tasks 2, 3, 5, and 6: Image root and profile selection

Wave 5:
  Task 10 after Tasks 7, 8, and 9: Signature checker and signature comparison
  Task 15 after Tasks 7, 9, and 14: Image device and unique-root checker

Wave 6:
  Task 12 after Tasks 7A, 10, and 11: Deferred member completion
  Task 13 after Tasks 3, 10, 11, and 14: Platform certifier
  Task 16 after Tasks 10 and 14: Image entry checker

Wave 7:
  Task 17 after Tasks 7, 8, 9, 10, 11, 12, 13, 14, 15, and 16: Orchestrator
  Task 18 after Tasks 3, 6, 10, 13, 14, 15, and 17: Determinism summaries

Wave 8:
  Task 19 after Task 17: Integration scenarios
  Task 20 after Task 17: Public API barrels

Wave 9:
  Task 21 after all prior tasks: Final audit and handoff
```

Single-writer coordination:

- `src/semantic/ids.ts` is owned by Task 1.
- `src/semantic/surface/diagnostics.ts` is owned by Task 2 until Task 17.
- `src/semantic/surface/reference-lookup.ts` is owned by Task 7A.
- `src/semantic/surface/resource-kind.ts` is owned by Task 4.
- `src/semantic/surface/type-model.ts` is owned by Task 5.
- `src/semantic/surface/checked-program.ts` is owned by Task 6 until Task 17.
- `src/semantic/surface/platform-surface.ts` and `tests/support/semantic/semantic-surface-fakes.ts` are owned by Task 3 until Task 18.
- `src/semantic/surface/image-root-selection.ts` and `tests/unit/semantic/surface/image-root-selection.test.ts` are owned by Task 14.
- `src/semantic/surface/image-device-checker.ts` and `tests/unit/semantic/surface/image-device-checker.test.ts` are owned by Task 15.
- `src/semantic/surface/image-entry-checker.ts` and `tests/unit/semantic/surface/image-entry-checker.test.ts` are owned by Task 16.
- `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/index.ts`, `src/semantic/index.ts`, and public API tests are owned by Tasks 17 and 20.
- Before Task 20, tests should import surface modules by direct file path, not from `src/semantic` barrels.

## Target File Structure

```text
src/semantic/
  ids.ts
  index.ts
  surface/
    checked-program.ts
    deterministic-sort.ts
    deferred-member-completer.ts
    diagnostics.ts
    generic-checker.ts
    image-device-checker.ts
    image-entry-checker.ts
    image-root-selection.ts
    index.ts
    interface-checker.ts
    platform-certifier.ts
    platform-surface.ts
    proof-surface.ts
    reference-lookup.ts
    resource-kind.ts
    resource-kind-checker.ts
    semantic-surface-checker.ts
    signature-checker.ts
    type-model.ts
    type-reference-checker.ts

tests/support/semantic/
  semantic-surface-fakes.ts

tests/unit/semantic/surface/
  checked-program.test.ts
  deferred-member-completer.test.ts
  diagnostics.test.ts
  generic-checker.test.ts
  image-device-checker.test.ts
  image-entry-checker.test.ts
  image-root-selection.test.ts
  platform-certifier.test.ts
  platform-surface.test.ts
  proof-surface.test.ts
  reference-lookup.test.ts
  resource-kind-checker.test.ts
  resource-kind.test.ts
  signature-checker.test.ts
  type-model.test.ts
  type-reference-checker.test.ts

tests/integration/semantic/
  semantic-surface.test.ts
  semantic-surface-determinism.test.ts
  public-api.test.ts
```

## Shared Implementation Rules

- Keep runtime source dependency-free.
- Use fakes through dependency injection. Do not use mocks or spies.
- Keep filesystem access outside semantic surface.
- Do not create target backend objects. `SemanticTargetSurface` is a pure catalog.
- Do not inspect function bodies except for direct `requires` sections exposed by `FunctionDeclarationView.requiresSections()`.
- Do not assign final proof IDs. Preserve proof-surface seeds for HIR.
- Do not re-resolve names from source text when `ResolvedReferences` has a reference.
- Preserve malformed-syntax recovery: return error checked values and diagnostics; do not throw on recovered CST.
- Sort every returned table and diagnostic deterministically.
- Do not use source module paths or `std` paths as trust signals.
- Tests use direct module imports until Task 20 wires public barrels.
- Every task must run its narrow tests before committing. Task 21 runs `bun run agent:check`.
- Commit messages in this plan include `-Codex Automated` per repository convention.

## Shared Test Helpers

Tasks may use these local helper shapes in tests. Task 3 creates the shared fakes for reuse and owns this contract until Task 18 adds summary serializers.

```ts
import type { ParsedModuleGraph } from "../../../src/frontend";
import { buildItemIndex } from "../../../src/semantic/item-index";
import { CoreTypeCatalog, resolveNames } from "../../../src/semantic/names";
import { buildSurfaceReferenceLookup } from "../../../src/semantic/surface/reference-lookup";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";
import { platformPrimitiveNameCatalogFake } from "../../support/semantic/name-resolution-fakes";

export interface SemanticSurfaceFixture {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly kindContext: ResourceKindContext;
  readonly diagnostics: readonly Diagnostic[];
}

export function parseAndResolveSurfaceFixture(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
  },
): SemanticSurfaceFixture {
  const graph = parseModuleGraphForTest(files);
  const itemIndexResult = buildItemIndex({ graph });
  const coreTypes = CoreTypeCatalog.default();
  const names = resolveNames({
    graph,
    index: itemIndexResult.index,
    coreTypes,
    platformPrimitiveNames: platformPrimitiveNameCatalogFake(options?.platformNames ?? []),
  });

  return {
    graph,
    index: itemIndexResult.index,
    references: names.references,
    referenceLookup: buildSurfaceReferenceLookup(names.references),
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface: options?.targetSurface ?? semanticTargetSurfaceFake(),
    kindContext: emptyKindContext(coreTypes),
    diagnostics: [...itemIndexResult.diagnostics, ...names.diagnostics],
  };
}

export function checkedSignaturesForFixture(
  fixture: SemanticSurfaceFixture,
): CheckedFunctionSignatureTable {
  return checkAllFunctionSignatures(validSignatureInputFromFixture(fixture)).signatures;
}

export function selectedBootImage(fixture: SemanticSurfaceFixture): CheckedImageRootSelection {
  return selectImageRoot(validImageRootInputFromFixture(fixture)).selection!;
}

export function platformFixtureWithDifferentRequires(): CertifyPlatformBindingsInput {
  const fixture = parseAndResolveSurfaceFixture(
    [
      [
        "main.wr",
        "platform fn firmware_exit(status: u32) -> Never\n    requires:\n        status.ok\n",
      ],
    ],
    { platformNames: ["firmware_exit"] },
  );
  const signatures = checkedSignaturesForFixture(fixture);
  return {
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: proofSurfaceForFixture(fixture),
    targetSurface: semanticTargetSurfaceFake({
      primitives: [
        primitiveSpecFake({ name: "firmware_exit", proofContract: emptyProofContract() }),
      ],
    }),
    availability: targetAvailabilityForFixture(fixture),
  };
}
```

Each task may adapt the helper import paths to existing test support files. Do not duplicate large parsing helpers inside every test file after Task 3 has added `semantic-surface-fakes.ts`.

---

## Task 1: Surface ID Brands

**Description:** Add target/surface ID brands and constructors to `src/semantic/ids.ts`. These IDs are catalog identities, not source item IDs.

**Dependencies:** None.

**Files:**

- Modify: `src/semantic/ids.ts`
- Modify: `tests/unit/semantic/ids.test.ts`

**Acceptance Criteria:**

- `TargetId`, `PlatformContractId`, `ImageProfileId`, `DeviceSurfaceId`, `PlatformPrimitiveFamilyId`, `TargetTypeId`, and `UniqueEdgeRootKey` are exported.
- Constructor functions reject empty strings and leading/trailing whitespace using the same style as `coreTypeId` and `platformPrimitiveId`.
- Existing ID tests still pass.
- New tests cover valid and invalid values for every new string-branded ID.

- [ ] **Step 1: Write failing ID tests**

Code example:

```ts
import {
  deviceSurfaceId,
  imageProfileId,
  platformContractId,
  platformPrimitiveFamilyId,
  targetId,
  targetTypeId,
  uniqueEdgeRootKey,
} from "../../../src/semantic/ids";

test("semantic surface string IDs preserve valid values", () => {
  expect(targetId("aarch64-uefi")).toBe("aarch64-uefi");
  expect(platformContractId("firmware-exit-contract")).toBe("firmware-exit-contract");
  expect(imageProfileId("uefi")).toBe("uefi");
  expect(deviceSurfaceId("net0")).toBe("net0");
  expect(platformPrimitiveFamilyId("firmware")).toBe("firmware");
  expect(targetTypeId("FirmwareHandle")).toBe("FirmwareHandle");
  expect(uniqueEdgeRootKey("pci-root")).toBe("pci-root");
});

test.each([
  ["targetId", targetId],
  ["platformContractId", platformContractId],
  ["imageProfileId", imageProfileId],
  ["deviceSurfaceId", deviceSurfaceId],
  ["platformPrimitiveFamilyId", platformPrimitiveFamilyId],
  ["targetTypeId", targetTypeId],
  ["uniqueEdgeRootKey", uniqueEdgeRootKey],
])("%s rejects empty values", (_name, build) => {
  expect(() => build("")).toThrow(RangeError);
  expect(() => build(" padded ")).toThrow(RangeError);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/ids.test.ts
```

Expected: fail with missing exports.

- [ ] **Step 3: Implement the ID brands**

Code example:

```ts
export type TargetId = string & { readonly __brand: "TargetId" };
export type PlatformContractId = string & { readonly __brand: "PlatformContractId" };
export type ImageProfileId = string & { readonly __brand: "ImageProfileId" };
export type DeviceSurfaceId = string & { readonly __brand: "DeviceSurfaceId" };
export type PlatformPrimitiveFamilyId = string & {
  readonly __brand: "PlatformPrimitiveFamilyId";
};
export type TargetTypeId = string & { readonly __brand: "TargetTypeId" };
export type UniqueEdgeRootKey = string & { readonly __brand: "UniqueEdgeRootKey" };

function nonEmptyTrimmedId(value: string, label: string): string {
  if (value.length === 0) throw new RangeError(`${label} must not be empty.`);
  if (value !== value.trim()) {
    throw new RangeError(`${label} must not have leading or trailing whitespace.`);
  }
  return value;
}

export function targetId(value: string): TargetId {
  return nonEmptyTrimmedId(value, "TargetId") as TargetId;
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/ids.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/ids.ts tests/unit/semantic/ids.test.ts
git commit -m "feat: add semantic surface id brands -Codex Automated"
```

---

## Task 2: Diagnostics And Deterministic Sorting

**Description:** Add semantic-surface diagnostic constructors and sorting. Diagnostics must carry stable order fields and never depend on object insertion order.

**Dependencies:** None.

**Files:**

- Create: `src/semantic/surface/diagnostics.ts`
- Create: `src/semantic/surface/deterministic-sort.ts`
- Create: `tests/unit/semantic/surface/diagnostics.test.ts`

**Acceptance Criteria:**

- Diagnostic codes exist for all families listed in the design.
- Task 2 creates a constructor for every `SemanticSurfaceDiagnosticCode`; later tasks must not add new codes or constructors unless Task 2 is updated first.
- Diagnostics have `code`, `message`, `severity: "error"`, optional `span`, optional `source`, optional `relatedInformation`, and a non-exported or exported stable `order`.
- `sortSemanticSurfaceDiagnostics` sorts by source path, span start, span end, code, message, and stable tie-breakers.
- `compareCodeUnitStrings` is exported from `deterministic-sort.ts` and all semantic-surface string sorting uses it instead of `localeCompare`.
- Constructors produce narrow spans supplied by callers.
- Related information preserves deterministic order.

- [ ] **Step 1: Write failing diagnostic tests**

Code example:

```ts
import { SourceText } from "../../../../src/frontend";
import {
  invalidTypeReference,
  platformPrimitiveSignatureMismatch,
  sortSemanticSurfaceDiagnostics,
} from "../../../../src/semantic/surface/diagnostics";
import { coreTypeId, moduleId } from "../../../../src/semantic/ids";

test("diagnostics preserve narrow caller spans", () => {
  const source = SourceText.from("main.wr", "fn main(x: Missing)\n");
  const span = source.span(11, 18);

  const diagnostic = invalidTypeReference({
    source,
    span,
    order: { moduleId: moduleId(0), span, codeTieBreaker: "type" },
    typeName: "Missing",
  });

  expect(diagnostic.code).toBe("SURFACE_INVALID_TYPE_REFERENCE");
  expect(diagnostic.span).toEqual(span);
  expect(diagnostic.message).toContain("Missing");
});

test("diagnostics sort deterministically", () => {
  const source = SourceText.from("main.wr", "abc");
  const later = source.span(2, 3);
  const earlier = source.span(0, 1);

  const diagnostics = sortSemanticSurfaceDiagnostics([
    platformPrimitiveSignatureMismatch({
      source,
      span: later,
      order: { moduleId: moduleId(0), span: later, codeTieBreaker: "b" },
      functionName: "late",
      reason: "return type differs",
    }),
    invalidTypeReference({
      source,
      span: earlier,
      order: { moduleId: moduleId(0), span: earlier, codeTieBreaker: "a" },
      typeName: "Early",
    }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "SURFACE_INVALID_TYPE_REFERENCE",
    "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
  ]);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/diagnostics.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement diagnostics**

Code example:

```ts
export type SemanticSurfaceDiagnosticCode =
  | "SURFACE_INVALID_TYPE_REFERENCE"
  | "SURFACE_NON_TYPE_REFERENCE"
  | "SURFACE_WRONG_GENERIC_ARGUMENT_COUNT"
  | "SURFACE_DUPLICATE_GENERIC_PARAMETER"
  | "SURFACE_INVALID_GENERIC_BOUND"
  | "SURFACE_INVALID_INTERFACE_CONSTRAINT"
  | "SURFACE_GENERIC_BOUND_CYCLE"
  | "SURFACE_RESOURCE_KIND_MISMATCH"
  | "SURFACE_INVALID_RECEIVER"
  | "SURFACE_INVALID_PARAMETER_MODE"
  | "SURFACE_INVALID_RETURN_TYPE"
  | "SURFACE_ILLEGAL_FUNCTION_MODIFIERS"
  | "SURFACE_ILLEGAL_PLATFORM_SHAPE"
  | "SURFACE_MISSING_PLATFORM_BINDING"
  | "SURFACE_PLATFORM_CATALOG_ENTRY_MISSING"
  | "SURFACE_PLATFORM_SIGNATURE_MISMATCH"
  | "SURFACE_PLATFORM_CONTRACT_NOT_EXACT"
  | "SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE"
  | "SURFACE_MISSING_IMAGE_ROOT"
  | "SURFACE_AMBIGUOUS_IMAGE_ROOT"
  | "SURFACE_INVALID_IMAGE_ROOT_SELECTION"
  | "SURFACE_MALFORMED_DEVICES_SECTION"
  | "SURFACE_INVALID_IMAGE_DEVICE_TYPE"
  | "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT"
  | "SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE"
  | "SURFACE_INVALID_IMAGE_ENTRY_SHAPE"
  | "SURFACE_INVALID_IMAGE_ENTRY_SIGNATURE"
  | "SURFACE_UNRESOLVED_DEFERRED_MEMBER"
  | "SURFACE_AMBIGUOUS_DEFERRED_MEMBER";

export function compareCodeUnitStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export interface SemanticSurfaceDiagnostic {
  readonly code: SemanticSurfaceDiagnosticCode;
  readonly message: string;
  readonly severity: "error";
  readonly source?: SourceText;
  readonly span?: SourceSpan;
  readonly relatedInformation?: readonly DiagnosticRelatedInformation[];
  readonly order: SemanticSurfaceDiagnosticOrder;
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/diagnostics.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/diagnostics.ts src/semantic/surface/deterministic-sort.ts tests/unit/semantic/surface/diagnostics.test.ts
git commit -m "feat: add semantic surface diagnostics -Codex Automated"
```

---

## Task 3: Target Surface Catalog And Test Fakes

**Description:** Add pure target surface catalog types, validation, and reusable test fakes. This is not a backend and must not depend on filesystem, Bun APIs, HIR, MIR, or codegen.

**Dependencies:** Tasks 1, 4, 5, and 7A.

**Files:**

- Create: `src/semantic/surface/platform-surface.ts`
- Create: `tests/unit/semantic/surface/platform-surface.test.ts`
- Create: `tests/support/semantic/semantic-surface-fakes.ts`

**Acceptance Criteria:**

- `SemanticTargetSurface`, `PlatformPrimitiveCatalog`, `PlatformPrimitiveSpec`, `ImageProfileSpec`, `DeviceSurfaceSpec`, `TargetAvailability`, `TargetFunctionSignature`, `TargetParameterSpec`, and `TargetProofContractSurface` are exported.
- Target signatures use `CheckedType` and `CheckedResourceKind` from Tasks 5 and 4.
- Catalog builders sort entries deterministically and reject duplicate IDs/names.
- Fake helpers create a minimal UEFI target, device surfaces, platform primitive specs, image profiles, and the shared `parseAndResolveSurfaceFixture` contract from the Shared Test Helpers section.
- `parseAndResolveSurfaceFixture` returns `coreTypes`, `referenceLookup`, `kindContext`, `targetSurface`, and `platformBindings`; downstream tests must not invent those fields locally.
- Runtime source has no test-only dependencies.

- [ ] **Step 1: Write failing tests**

Code example:

```ts
import { platformPrimitiveId, targetId } from "../../../../src/semantic/ids";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../../src/semantic/surface/platform-surface";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";

test("platform primitive catalog sorts by primitive id", () => {
  const catalog = platformPrimitiveCatalog([
    {
      primitiveId: platformPrimitiveId("b_primitive"),
      contractId: platformContractId("b_contract"),
      availability: allProfilesAvailability(),
      signature: voidTargetSignature(),
      proofContract: emptyProofContract(),
    },
    {
      primitiveId: platformPrimitiveId("a_primitive"),
      contractId: platformContractId("a_contract"),
      availability: allProfilesAvailability(),
      signature: voidTargetSignature(),
      proofContract: emptyProofContract(),
    },
  ]);

  expect(catalog.entries().map((entry) => entry.primitiveId)).toEqual([
    platformPrimitiveId("a_primitive"),
    platformPrimitiveId("b_primitive"),
  ]);
});

test("semantic target surface rejects duplicate image profile names", () => {
  expect(() =>
    semanticTargetSurface({
      targetId: targetId("uefi-aarch64"),
      platformPrimitives: platformPrimitiveCatalog([]),
      imageProfiles: [uefiProfileFake(), uefiProfileFake()],
      deviceSurfaces: [],
    }),
  ).toThrow("Duplicate image profile name 'uefi'.");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/platform-surface.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement catalog types and builders**

Code example:

```ts
import { compareCodeUnitStrings } from "./deterministic-sort";

export interface PlatformPrimitiveCatalog {
  get(primitiveId: PlatformPrimitiveId): PlatformPrimitiveSpec | undefined;
  entries(): readonly PlatformPrimitiveSpec[];
}

export function platformPrimitiveCatalog(
  primitives: readonly PlatformPrimitiveSpec[],
): PlatformPrimitiveCatalog {
  const sorted = [...primitives].sort((left, right) =>
    compareCodeUnitStrings(left.primitiveId, right.primitiveId),
  );
  const byId = new Map<PlatformPrimitiveId, PlatformPrimitiveSpec>();
  for (const primitive of sorted) {
    if (byId.has(primitive.primitiveId)) {
      throw new RangeError(`Duplicate platform primitive id '${primitive.primitiveId}'.`);
    }
    byId.set(primitive.primitiveId, primitive);
  }
  return {
    get: (primitiveId) => byId.get(primitiveId),
    entries: () => sorted,
  };
}
```

- [ ] **Step 4: Implement reusable fakes**

Code example:

```ts
export function semanticTargetSurfaceFake(input?: {
  readonly primitives?: readonly PlatformPrimitiveSpec[];
  readonly devices?: readonly DeviceSurfaceSpec[];
  readonly profiles?: readonly ImageProfileSpec[];
}): SemanticTargetSurface {
  return semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog(input?.primitives ?? []),
    imageProfiles: input?.profiles ?? [uefiImageProfileFake()],
    deviceSurfaces: input?.devices ?? [],
  });
}
```

- [ ] **Step 5: Run the narrow tests**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/platform-surface.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/semantic/surface/platform-surface.ts tests/unit/semantic/surface/platform-surface.test.ts tests/support/semantic/semantic-surface-fakes.ts
git commit -m "feat: add semantic target surface catalog -Codex Automated"
```

---

## Task 4: Resource-Kind Model

**Description:** Add concrete, parametric, derived, and error resource-kind values plus conservative join and derivation helpers.

**Dependencies:** None.

**Files:**

- Create: `src/semantic/surface/resource-kind.ts`
- Create: `tests/unit/semantic/surface/resource-kind.test.ts`

**Acceptance Criteria:**

- `ConcreteResourceKind` excludes `"Error"`.
- `TypeParameterKey` is exported and uses the existing item-index owner shape plus `index`; it does not use the word `ordinal`.
- `ResourceKindDerivationRule` is exported as a closed v1 union: `"join"`, `"appliedConstructor"`, `"fieldAggregation"`, and `"targetDeclared"`.
- `CheckedResourceKind` includes concrete, parametric, derived, and error variants.
- Helpers exist for `concreteKind`, `parametricKind`, `derivedKind`, `errorKind`, `isProofRelevantKind`, `joinConcreteResourceKinds`, and `joinResourceKinds`.
- Joining parametric or derived kinds returns a derived expression instead of incorrectly manufacturing a concrete kind.
- Joining proof-relevant concrete kinds returns `Linear` unless a caller uses an explicit authorized declaration rule.

- [ ] **Step 1: Write failing resource-kind tests**

Code example:

```ts
import {
  concreteKind,
  derivedKind,
  errorKind,
  joinResourceKinds,
  parametricKind,
} from "../../../../src/semantic/surface/resource-kind";
import { itemId } from "../../../../src/semantic/ids";

test("join preserves copy only when both sides are copy", () => {
  expect(joinResourceKinds([concreteKind("Copy"), concreteKind("Copy")])).toEqual(
    concreteKind("Copy"),
  );
});

test("join lifts affine and linear conservatively", () => {
  expect(joinResourceKinds([concreteKind("Copy"), concreteKind("Affine")])).toEqual(
    concreteKind("Affine"),
  );
  expect(joinResourceKinds([concreteKind("Affine"), concreteKind("Linear")])).toEqual(
    concreteKind("Linear"),
  );
});

test("join of parametric kind stays derived", () => {
  const kind = joinResourceKinds([
    concreteKind("Copy"),
    parametricKind({ owner: { kind: "item", itemId: itemId(0) }, index: 0 }),
  ]);

  expect(kind.kind).toBe("derived");
});

test("error kind absorbs joins", () => {
  expect(joinResourceKinds([concreteKind("Copy"), errorKind()])).toEqual(errorKind());
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/resource-kind.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement resource-kind helpers**

Code example:

```ts
export type ConcreteResourceKind =
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

export interface TypeParameterKey {
  readonly owner: TypeParameterOwner;
  readonly index: number;
}

export type ResourceKindDerivationRule =
  | "join"
  | "appliedConstructor"
  | "fieldAggregation"
  | "targetDeclared";

export type CheckedResourceKind =
  | { readonly kind: "concrete"; readonly value: ConcreteResourceKind }
  | { readonly kind: "parametric"; readonly parameter: TypeParameterKey }
  | {
      readonly kind: "derived";
      readonly rule: ResourceKindDerivationRule;
      readonly arguments: readonly CheckedResourceKind[];
    }
  | { readonly kind: "error" };

export function joinResourceKinds(kinds: readonly CheckedResourceKind[]): CheckedResourceKind {
  if (kinds.some((kind) => kind.kind === "error")) return errorKind();
  if (kinds.some((kind) => kind.kind === "parametric" || kind.kind === "derived")) {
    return derivedKind("join", kinds);
  }
  return concreteKind(joinConcreteResourceKinds(kinds.map((kind) => kind.value)));
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/resource-kind.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/resource-kind.ts tests/unit/semantic/surface/resource-kind.test.ts
git commit -m "feat: add checked resource kind model -Codex Automated"
```

---

## Task 5: Checked Type Model

**Description:** Add checked type values, type constructor IDs, equality/fingerprint helpers, and error recovery type support.

**Dependencies:** Tasks 1 and 4.

**Files:**

- Create: `src/semantic/surface/type-model.ts`
- Create: `tests/unit/semantic/surface/type-model.test.ts`

**Acceptance Criteria:**

- `CheckedType` supports core, source, generic parameter, applied, target, and error variants.
- `AppliedCheckedType` stores constructor, arguments, and `CheckedResourceKind`.
- Deterministic fingerprints exist for checked types and resource-kind expressions.
- Equality helpers compare semantic IDs and recursively compare arguments.
- Error types are stable and never throw when fingerprinted.

- [ ] **Step 1: Write failing type-model tests**

Code example:

```ts
import { coreTypeId, itemId, targetTypeId, typeId } from "../../../../src/semantic/ids";
import {
  appliedType,
  checkedTypeFingerprint,
  coreCheckedType,
  sourceCheckedType,
  targetCheckedType,
} from "../../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";

test("checked type fingerprints are deterministic", () => {
  const optionU8 = appliedType({
    constructor: { kind: "source", typeId: typeId(10) },
    arguments: [coreCheckedType(coreTypeId("u8"))],
    resourceKind: concreteKind("Copy"),
  });

  expect(checkedTypeFingerprint(optionU8)).toBe("applied:source:10<core:u8>:kind:concrete:Copy");
});

test("source type stores item and type ids", () => {
  expect(sourceCheckedType({ itemId: itemId(4), typeId: typeId(2) })).toEqual({
    kind: "source",
    itemId: itemId(4),
    typeId: typeId(2),
  });
});

test("target type uses target type id", () => {
  expect(targetCheckedType(targetTypeId("FirmwareHandle")).targetTypeId).toBe("FirmwareHandle");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/type-model.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement checked type helpers**

Code example:

```ts
export type CheckedType =
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "source"; readonly itemId: ItemId; readonly typeId: TypeId }
  | { readonly kind: "genericParameter"; readonly parameter: TypeParameterKey }
  | AppliedCheckedType
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId }
  | { readonly kind: "error" };

export interface AppliedCheckedType {
  readonly kind: "applied";
  readonly constructor: TypeConstructorId;
  readonly arguments: readonly CheckedType[];
  readonly resourceKind: CheckedResourceKind;
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/type-model.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/type-model.ts tests/unit/semantic/surface/type-model.test.ts
git commit -m "feat: add checked type model -Codex Automated"
```

---

## Task 6: Checked Program And Result Tables

**Description:** Add immutable checked-program tables and builders. These are the data containers produced by later checkers and consumed by the orchestrator.

**Dependencies:** Tasks 1, 2, 4, and 5.

**Files:**

- Create: `src/semantic/surface/checked-program.ts`
- Create: `src/semantic/surface/proof-surface.ts`
- Create: `tests/unit/semantic/surface/checked-program.test.ts`
- Create: `tests/unit/semantic/surface/proof-surface.test.ts`

**Acceptance Criteria:**

- `CheckedSemanticProgram` exposes `types`, `functions`, `fields`, `genericParameters`, `completedMembers`, `proofSurface`, and `certifiedPlatformBindings`.
- `CheckedFunctionSignature`, `CheckedFunctionSignatureTable`, `CertifiedPlatformBinding`, `CertifiedPlatformBindingTable`, and `PlatformPrimitiveBindingCertificate` are defined here so later tasks populate existing result contracts.
- `CheckedParameter` stores the parameter's `SyntaxReferenceKey` when name resolution produced one, so Task 12 can derive typed owners for declaration-level deferred members.
- Tables return sorted copies from `entries()` and protect internal arrays from mutation.
- Lookup methods return `undefined` for missing IDs/keys.
- `CheckedProofSurface` tables preserve proof-surface seeds but do not assign proof IDs.
- `CompletedMemberReferenceTable` is keyed by `SyntaxReferenceKey`.

- [ ] **Step 1: Write failing table tests**

Code example:

```ts
import { functionId, itemId, typeId } from "../../../../src/semantic/ids";
import {
  CheckedProgramBuilder,
  completedMemberKeyString,
} from "../../../../src/semantic/surface/checked-program";
import { sourceCheckedType } from "../../../../src/semantic/surface/type-model";

test("checked program tables sort by semantic ids", () => {
  const builder = new CheckedProgramBuilder();
  builder.addType({
    typeId: typeId(2),
    itemId: itemId(2),
    type: sourceCheckedType({ itemId: itemId(2), typeId: typeId(2) }),
  });
  builder.addType({
    typeId: typeId(1),
    itemId: itemId(1),
    type: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
  });

  const program = builder.build();
  expect(program.types.entries().map((entry) => entry.typeId)).toEqual([typeId(1), typeId(2)]);
});

test("checked function lookup returns undefined for missing functions", () => {
  const program = new CheckedProgramBuilder().build();
  expect(program.functions.get(functionId(99))).toBeUndefined();
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/checked-program.test.ts ./tests/unit/semantic/surface/proof-surface.test.ts
```

Expected: fail with missing modules.

- [ ] **Step 3: Implement immutable table builders**

Code example:

```ts
export interface CheckedTypeRecord {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly type: CheckedType;
}

export interface CheckedTypeTable {
  get(typeId: TypeId): CheckedTypeRecord | undefined;
  entries(): readonly CheckedTypeRecord[];
}

export interface CheckedFunctionSignature {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerItemId?: ItemId;
  readonly genericSignature?: CheckedGenericSignature;
  readonly receiver?: CheckedReceiver;
  readonly parameters: readonly CheckedParameter[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
  readonly modifiers: CheckedFunctionModifiers;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedFunctionSignatureTable {
  get(functionId: FunctionId): CheckedFunctionSignature | undefined;
  entries(): readonly CheckedFunctionSignature[];
}

export interface CheckedParameter {
  readonly parameterId: ParameterId;
  readonly name: string;
  readonly type: CheckedType;
  readonly mode: "observe" | "consume";
  readonly resourceKind: CheckedResourceKind;
  readonly referenceKey?: SyntaxReferenceKey;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedReceiver {
  readonly parameterId: ParameterId;
  readonly ownerItemId: ItemId;
  readonly mode: "observe" | "consume";
  readonly referenceKey?: SyntaxReferenceKey;
}

export interface CheckedFunctionModifiers {
  readonly isPlatform: boolean;
  readonly isTerminal: boolean;
  readonly isPredicate: boolean;
  readonly isConstructor: boolean;
  readonly isPrivate: boolean;
}

export interface CertifiedPlatformBinding {
  readonly itemId: ItemId;
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate: PlatformPrimitiveBindingCertificate;
}

export interface PlatformPrimitiveBindingCertificate {
  readonly kind: "exactCatalogMatch";
  readonly signatureFingerprint: string;
  readonly proofContractFingerprint: string;
}

export class CheckedProgramBuilder {
  private readonly types: CheckedTypeRecord[] = [];

  addType(record: CheckedTypeRecord): void {
    this.types.push(record);
  }

  build(): CheckedSemanticProgram {
    return {
      types: checkedTypeTable(this.types),
      functions: checkedFunctionTable(this.functions),
      fields: checkedFieldTable(this.fields),
      genericParameters: checkedGenericParameterTable(this.genericParameters),
      completedMembers: completedMemberReferenceTable(this.completedMembers),
      proofSurface: checkedProofSurface(this.proofSurfaceSeeds),
      certifiedPlatformBindings: certifiedPlatformBindingTable(this.platformBindings),
    };
  }
}
```

- [ ] **Step 4: Run the narrow tests**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/checked-program.test.ts ./tests/unit/semantic/surface/proof-surface.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/checked-program.ts src/semantic/surface/proof-surface.ts tests/unit/semantic/surface/checked-program.test.ts tests/unit/semantic/surface/proof-surface.test.ts
git commit -m "feat: add checked semantic program tables -Codex Automated"
```

---

## Task 7A: Surface Reference Lookup Index

**Description:** Build the declaration-surface lookup that maps AST-view source locations to already-resolved name references without replaying name resolution or guessing `SyntaxReferenceKey.ordinal`.

**Dependencies:** Task 2.

**Files:**

- Create: `src/semantic/surface/reference-lookup.ts`
- Create: `tests/unit/semantic/surface/reference-lookup.test.ts`

**Acceptance Criteria:**

- `buildSurfaceReferenceLookup(references)` consumes `references.entries()` and groups entries by `moduleId`, `span.start`, `span.end`, and `NameReferenceKind`.
- `SurfaceReferenceLookup.findOne(input)` returns `{ kind: "found"; entry }`, `{ kind: "missing" }`, or `{ kind: "ambiguous"; entries }`.
- Ambiguous entries are sorted by full `SyntaxReferenceKey` using module ID, span start, span end, kind with `compareCodeUnitStrings`, and numeric `ordinal`.
- `syntaxReferenceKeyToString(key)` is exported and used by deferred-member completion instead of ad hoc stringification.
- The helper never attempts to resolve names from text and never picks an arbitrary ordinal when multiple entries match.

- [ ] **Step 1: Write failing reference lookup tests**

Code example:

```ts
import { SourceText } from "../../../../src/frontend";
import { moduleId } from "../../../../src/semantic/ids";
import { ResolvedReferencesBuilder } from "../../../../src/semantic/names";
import {
  buildSurfaceReferenceLookup,
  syntaxReferenceKeyToString,
} from "../../../../src/semantic/surface/reference-lookup";

test("findOne locates a reference by module span and kind", () => {
  const source = SourceText.from("main.wr", "fn f(x: u32)\n");
  const span = source.span(8, 11);
  const key = { moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 } as const;
  const builder = new ResolvedReferencesBuilder();
  builder.add(key, { kind: "builtinType", coreTypeId: coreTypeId("u32") });

  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });

  expect(result.kind).toBe("found");
  expect(result.kind === "found" ? result.entry.key : undefined).toEqual(key);
});

test("same module span and kind collision is ambiguous", () => {
  const source = SourceText.from("main.wr", "Recovered");
  const span = source.span(0, 9);
  const builder = new ResolvedReferencesBuilder();
  builder.add({ moduleId: moduleId(0), span, kind: "typeName", ordinal: 1 }, typeReferenceFake(1));
  builder.add({ moduleId: moduleId(0), span, kind: "typeName", ordinal: 0 }, typeReferenceFake(0));

  const lookup = buildSurfaceReferenceLookup(builder.build());
  const result = lookup.findOne({ moduleId: moduleId(0), span, kind: "typeName" });

  expect(result.kind).toBe("ambiguous");
  expect(
    result.kind === "ambiguous" ? result.entries.map((entry) => entry.key.ordinal) : [],
  ).toEqual([0, 1]);
});

test("syntax reference key string includes kind and ordinal", () => {
  const source = SourceText.from("main.wr", "u32");
  const key = {
    moduleId: moduleId(0),
    span: source.span(0, 3),
    kind: "typeName",
    ordinal: 2,
  } as const;

  expect(syntaxReferenceKeyToString(key)).toBe("0:0:3:typeName:2");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/reference-lookup.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement the lookup**

Code example:

```ts
export interface SurfaceReferenceLookup {
  findOne(input: ReferenceLookupInput): ReferenceLookupResult;
}

export function buildSurfaceReferenceLookup(
  references: ResolvedReferences,
): SurfaceReferenceLookup {
  const bySurfaceKey = new Map<string, ResolvedReferenceEntry[]>();
  for (const entry of references.entries()) {
    const key = surfaceReferenceBucketKey(entry.key);
    const entries = bySurfaceKey.get(key) ?? [];
    entries.push(entry);
    bySurfaceKey.set(key, entries);
  }

  for (const [key, entries] of bySurfaceKey) {
    bySurfaceKey.set(key, [...entries].sort(compareResolvedReferenceEntries));
  }

  return {
    findOne(input) {
      const entries = bySurfaceKey.get(surfaceReferenceBucketKey(input)) ?? [];
      if (entries.length === 0) return { kind: "missing" };
      if (entries.length > 1) return { kind: "ambiguous", entries };
      return { kind: "found", entry: entries[0]! };
    },
  };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/reference-lookup.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/reference-lookup.ts tests/unit/semantic/surface/reference-lookup.test.ts
git commit -m "feat: add semantic surface reference lookup -Codex Automated"
```

---

## Task 7: Type-Reference Checker

**Description:** Implement checked type construction from `TypeReferenceView` and `ResolvedReferences`.

**Dependencies:** Tasks 2, 3, 5, 6, and 7A.

**Files:**

- Create: `src/semantic/surface/type-reference-checker.ts`
- Create: `tests/unit/semantic/surface/type-reference-checker.test.ts`

**Acceptance Criteria:**

- Builtin type references become `core` checked types.
- Source type references become `source` checked types.
- Type-parameter references become `genericParameter` checked types.
- Non-type references produce `SURFACE_NON_TYPE_REFERENCE` and `error` checked type.
- Missing or unresolved references produce `SURFACE_INVALID_TYPE_REFERENCE` and `error` checked type.
- Reference lookup uses `SurfaceReferenceLookup.findOne({ moduleId, span, kind: "typeName" })`; it never calls a span-only helper.
- Ambiguous same-span/same-kind references produce `SURFACE_INVALID_TYPE_REFERENCE` with related information for every matching ordinal.
- Type arguments are checked recursively and stored as `AppliedCheckedType`.
- Generic arity mismatch produces `SURFACE_WRONG_GENERIC_ARGUMENT_COUNT`.

- [ ] **Step 1: Write failing type-reference tests**

Code example:

```ts
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkTypeReference } from "../../../../src/semantic/surface/type-reference-checker";

test("builtin type reference checks to core checked type", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: u32)\n"]]);
  const parameter = fixture.index.parameters()[0]!;
  const result = checkTypeReference({
    moduleId: fixture.index.function(parameter.functionId)!.moduleId,
    view: parameter.type!,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type).toEqual({ kind: "core", coreTypeId: fixture.coreTypes.byName("u32")!.id });
  expect(result.diagnostics).toEqual([]);
});

test("function reference in type position reports non-type", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn Other()\nfn f(x: Other)\n"]]);
  const parameter = fixture.index.parametersForFunction(fixture.index.functions()[1]!.id)[0]!;
  const result = checkTypeReference({
    moduleId: fixture.index.functions()[1]!.moduleId,
    view: parameter.type!,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.type.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_NON_TYPE_REFERENCE",
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/type-reference-checker.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement `checkTypeReference`**

Code example:

```ts
export interface CheckTypeReferenceInput {
  readonly moduleId: ModuleId;
  readonly view: TypeReferenceView | undefined;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
}

export interface CheckTypeReferenceResult {
  readonly type: CheckedType;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function checkTypeReference(input: CheckTypeReferenceInput): CheckTypeReferenceResult {
  if (input.view === undefined) {
    return { type: errorCheckedType(), diagnostics: [] };
  }
  const name = input.view.qualifiedName();
  const span = name?.span;
  if (span === undefined) {
    return { type: errorCheckedType(), diagnostics: [] };
  }
  const reference = input.referenceLookup.findOne({
    moduleId: input.moduleId,
    span,
    kind: "typeName",
  });
  return checkedTypeFromLookupResult({ ...input, reference, span });
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/type-reference-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/type-reference-checker.ts tests/unit/semantic/surface/type-reference-checker.test.ts
git commit -m "feat: add semantic surface type reference checker -Codex Automated"
```

---

## Task 8: Generic And Interface Checker

**Description:** Check type parameters, bounds, duplicate generic names, and interface constraints at declaration level.

**Dependencies:** Task 7.

**Files:**

- Create: `src/semantic/surface/generic-checker.ts`
- Create: `src/semantic/surface/interface-checker.ts`
- Create: `tests/unit/semantic/surface/generic-checker.test.ts`
- Create: `tests/unit/semantic/surface/interface-checker.test.ts`

**Acceptance Criteria:**

- Item and function generic signatures are checked from `ItemIndex.typeParametersForItem` and `ItemIndex.typeParametersForFunction`.
- Duplicate type-parameter names under the same owner produce deterministic `SURFACE_DUPLICATE_GENERIC_PARAMETER` diagnostics.
- Bounds are checked through `checkTypeReference`.
- Non-interface bounds produce `SURFACE_INVALID_GENERIC_BOUND`.
- Interface constraints retain checked type and span.
- Bound cycles detectable from source owner/index references produce diagnostics.

- [ ] **Step 1: Write failing generic tests**

Code example:

```ts
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkGenericSignature } from "../../../../src/semantic/surface/generic-checker";

test("duplicate generic parameter names are diagnosed", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "class Box[T, T]:\n"]]);
  const item = fixture.index.items()[0]!;
  const result = checkGenericSignature({
    owner: { kind: "item", itemId: item.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.signature.parameters.map((parameter) => parameter.name)).toEqual(["T", "T"]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_DUPLICATE_GENERIC_PARAMETER",
  );
});

test("generic bound checks through type references", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "interface Reader:\n    fn read()\nclass Box[T: Reader]\n"],
  ]);
  const item = fixture.index.items().find((record) => record.name === "Box")!;
  const result = checkGenericSignature({
    owner: { kind: "item", itemId: item.id },
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
  });

  expect(result.signature.parameters[0]!.bounds).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/generic-checker.test.ts ./tests/unit/semantic/surface/interface-checker.test.ts
```

Expected: fail with missing modules.

- [ ] **Step 3: Implement generic and interface checkers**

Code example:

```ts
export interface CheckGenericSignatureInput {
  readonly owner: TypeParameterOwner;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
}

export function checkGenericSignature(
  input: CheckGenericSignatureInput,
): CheckGenericSignatureResult {
  const records =
    input.owner.kind === "item"
      ? input.index.typeParametersForItem(input.owner.itemId)
      : input.index.typeParametersForFunction(input.owner.functionId);
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const seenNames = new Map<string, TypeParameterRecord>();
  const parameters = records.map((record) => {
    const previous = seenNames.get(record.name);
    if (previous !== undefined) diagnostics.push(duplicateGenericParameter(record, previous));
    seenNames.set(record.name, record);
    return checkedGenericParameterFromRecord(input, record);
  });
  return { signature: { owner: input.owner, parameters, constraints: [] }, diagnostics };
}
```

- [ ] **Step 4: Run the narrow tests**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/generic-checker.test.ts ./tests/unit/semantic/surface/interface-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/generic-checker.ts src/semantic/surface/interface-checker.ts tests/unit/semantic/surface/generic-checker.test.ts tests/unit/semantic/surface/interface-checker.test.ts
git commit -m "feat: add generic and interface surface checks -Codex Automated"
```

---

## Task 9: Resource-Kind Checker

**Description:** Assign checked resource-kind expressions to core, source, applied, target, field, and error types.

**Dependencies:** Tasks 4, 5, 6, and 7.

**Files:**

- Create: `src/semantic/surface/resource-kind-checker.ts`
- Create: `tests/unit/semantic/surface/resource-kind-checker.test.ts`

**Acceptance Criteria:**

- Core scalar types are `Copy`.
- `Never` is `Never`.
- Generic parameters produce parametric kinds unless a bound fixes a concrete kind.
- Field aggregation uses conservative join.
- Proof-relevant declaration forms can keep specific concrete kinds only when authorized by source kind or target surface.
- Applied types use explicit constructor derivation rules.
- Error types and invalid references produce error kind without throwing.

- [ ] **Step 1: Write failing resource-kind checker tests**

Code example:

```ts
import { coreTypeId, itemId, typeId } from "../../../../src/semantic/ids";
import { coreCheckedType, sourceCheckedType } from "../../../../src/semantic/surface/type-model";
import { resourceKindForType } from "../../../../src/semantic/surface/resource-kind-checker";

test("core u32 is copy", () => {
  expect(
    resourceKindForType({ type: coreCheckedType(coreTypeId("u32")), context: emptyKindContext() }),
  ).toEqual(concreteKind("Copy"));
});

test("source aggregate joins field kinds conservatively", () => {
  const context = kindContextWithSourceType({
    typeId: typeId(1),
    itemId: itemId(1),
    fieldKinds: [concreteKind("Copy"), concreteKind("Linear")],
  });

  expect(
    resourceKindForType({
      type: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
      context,
    }),
  ).toEqual(concreteKind("Linear"));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/resource-kind-checker.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement resource-kind checking**

Code example:

```ts
export interface ResourceKindContext {
  readonly coreTypes: CoreTypeCatalog;
  readonly sourceTypeKinds: ReadonlyMap<TypeId, CheckedResourceKind>;
  readonly targetTypeKinds: ReadonlyMap<TargetTypeId, CheckedResourceKind>;
  readonly constructorRules: ReadonlyMap<string, ResourceKindDerivationRule>;
}

export function resourceKindForType(input: {
  readonly type: CheckedType;
  readonly context: ResourceKindContext;
}): CheckedResourceKind {
  switch (input.type.kind) {
    case "core":
      return input.type.coreTypeId === coreTypeId("Never")
        ? concreteKind("Never")
        : concreteKind("Copy");
    case "genericParameter":
      return parametricKind(input.type.parameter);
    case "applied":
      return input.type.resourceKind;
    case "error":
      return errorKind();
  }
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/resource-kind-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/resource-kind-checker.ts tests/unit/semantic/surface/resource-kind-checker.test.ts
git commit -m "feat: add resource kind checker -Codex Automated"
```

---

## Task 10: Signature Checker

**Description:** Check function signatures, parameters, receiver-like `self` parameters, return types, modes, modifiers, declaration legality, and shared target-signature structural comparison.

**Dependencies:** Tasks 7, 8, and 9.

**Files:**

- Create: `src/semantic/surface/signature-checker.ts`
- Create: `tests/unit/semantic/surface/signature-checker.test.ts`

**Acceptance Criteria:**

- Checked signatures are produced for every `FunctionRecord`.
- `checkAllFunctionSignatures` returns the `CheckedFunctionSignatureTable` defined by Task 6 and does not require callers to assemble signature tables by hand.
- Parameter types are checked through `checkTypeReference`.
- Signature checking receives `SurfaceReferenceLookup` and passes it into every type-reference check.
- `ParameterRecord.isConsumed` maps to mode `"consume"`; all other parameters map to `"observe"` in v1.
- Checked parameters preserve their parameter-name `SyntaxReferenceKey` when available; missing keys are allowed only for recovered syntax and do not throw.
- Return type defaults to core `Never` only when parser/source has no return and declaration kind requires no explicit return; otherwise missing returns produce an invalid-return diagnostic.
- Modifier combinations are validated: `platform` and `constructor` cannot combine; `predicate` must return `bool`; `terminal` cannot be `predicate`.
- Freestanding/method ownership is preserved through `ownerItemId` and `receiver`.
- `targetSignatureExactlyMatches(source, target)` and `checkedFunctionSignatureFingerprint(signature)` are exported from this file for platform certification and image entry validation.
- The comparator checks receiver, parameter count, parameter modes, parameter types, return type, return kind, and required modifier/profile flags using checked-type fingerprints and code-unit string ordering.
- Signature diagnostics use narrow parameter, return, and modifier spans.

- [ ] **Step 1: Write failing signature tests**

Code example:

```ts
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkFunctionSignature } from "../../../../src/semantic/surface/signature-checker";

test("consumed parameter becomes consume mode", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "fn take(consume packet: u32) -> u32\n"],
  ]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.signature.parameters[0]!.mode).toBe("consume");
  expect(result.signature.returnKind).toEqual(concreteKind("Copy"));
  expect(result.diagnostics).toEqual([]);
});

test("terminal predicate combination is rejected", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "terminal predicate fn bad() -> bool\n"],
  ]);
  const func = fixture.index.functions()[0]!;
  const result = checkFunctionSignature({
    functionRecord: func,
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_ILLEGAL_FUNCTION_MODIFIERS",
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/signature-checker.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement signature checking**

Code example:

```ts
export function checkFunctionSignature(
  input: CheckFunctionSignatureInput,
): CheckFunctionSignatureResult {
  const item = input.index.item(input.functionRecord.itemId);
  const declaration = item?.declaration as FunctionDeclarationView | undefined;
  const parameters = input.index
    .parametersForFunction(input.functionRecord.id)
    .map((parameter) => checkedParameterFromRecord(input, parameter));
  return {
    signature: checkedSignatureFromParts(input, item, declaration, parameters),
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}

export function checkAllFunctionSignatures(
  input: CheckAllFunctionSignaturesInput,
): CheckAllFunctionSignaturesResult {
  const builder = new CheckedFunctionSignatureTableBuilder();
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  for (const functionRecord of input.index.functions()) {
    const result = checkFunctionSignature({ ...input, functionRecord });
    builder.add(result.signature);
    diagnostics.push(...result.diagnostics);
  }
  return { signatures: builder.build(), diagnostics: sortSemanticSurfaceDiagnostics(diagnostics) };
}

export function targetSignatureExactlyMatches(
  source: CheckedFunctionSignature | undefined,
  target: TargetFunctionSignature,
): boolean {
  if (source === undefined) return false;
  return checkedFunctionSignatureFingerprint(source) === targetFunctionSignatureFingerprint(target);
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/signature-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/signature-checker.ts tests/unit/semantic/surface/signature-checker.test.ts
git commit -m "feat: add function signature checker -Codex Automated"
```

---

## Task 11: Requirement And Proof-Surface Seeds

**Description:** Preserve checked proof-surface seeds for requirements, predicates, terminal declarations, validation/attempt origins, private-state surfaces, image/device origins, and platform contracts without assigning proof IDs.

**Dependencies:** Tasks 2 and 6.

**Files:**

- Modify: `src/semantic/surface/proof-surface.ts`
- Modify: `tests/unit/semantic/surface/proof-surface.test.ts`

**Acceptance Criteria:**

- `CheckedRequirementSurface` stores opaque checked requirement expression, span, and resolved/member completion references.
- Requirement surfaces are collected from `FunctionDeclarationView.requiresSections()`.
- Predicate and `ensure` tables exist in v1 and return deterministic empty tables when the current parser output exposes no predicate/ensure surface. This task does not add parser syntax or parser accessors.
- Terminal surfaces capture terminal modifier and source span.
- Validation/attempt/private-state tables exist and can store source-origin seeds.
- No proof IDs are assigned in this task.

- [ ] **Step 1: Write failing proof-surface tests**

Code example:

```ts
import { functionId } from "../../../../src/semantic/ids";
import {
  checkedProofSurface,
  requirementSurface,
  terminalSurface,
} from "../../../../src/semantic/surface/proof-surface";

test("proof surface preserves requirement spans", () => {
  const span = sourceForTest().span(10, 18);
  const surface = checkedProofSurface({
    requirements: [
      requirementSurface({
        ownerFunctionId: functionId(0),
        expression: { kind: "opaque", text: "x.valid" },
        span,
      }),
    ],
  });

  expect(surface.requirementSurfaces.entries()[0]!.span).toEqual(span);
});

test("terminal surface stores terminal declaration seed", () => {
  const span = sourceForTest().span(0, 8);
  const surface = checkedProofSurface({
    terminalSurfaces: [terminalSurface({ functionId: functionId(0), span })],
  });

  expect(surface.terminalSurfaces.get(functionId(0))!.span).toEqual(span);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/proof-surface.test.ts
```

Expected: fail with missing seed helpers.

- [ ] **Step 3: Implement proof-surface seed tables**

Code example:

```ts
export interface CheckedRequirementSurface {
  readonly ownerFunctionId?: FunctionId;
  readonly expression: CheckedRequirementExpression;
  readonly span: SourceSpan;
}

export type CheckedRequirementExpression =
  | { readonly kind: "opaque"; readonly text: string }
  | {
      readonly kind: "checked";
      readonly references: readonly ResolvedReferenceEntry[];
      readonly completedMembers: readonly CompletedMemberReference[];
      readonly span: SourceSpan;
    };

export interface CheckedTerminalSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/proof-surface.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/proof-surface.ts tests/unit/semantic/surface/proof-surface.test.ts
git commit -m "feat: preserve proof surface seeds -Codex Automated"
```

---

## Task 12: Deferred Member Completion

**Description:** Complete declaration-level deferred member references through the existing name-resolution `MemberNamespace` API and preserve body-local sites for HIR.

**Dependencies:** Tasks 7A, 10, and 11.

**Files:**

- Create: `src/semantic/surface/deferred-member-completer.ts`
- Create: `tests/unit/semantic/surface/deferred-member-completer.test.ts`

**Acceptance Criteria:**

- Declaration-level deferred members resolve to a `CompletedMemberReferenceTable`.
- Unresolved declaration-level members emit `SURFACE_UNRESOLVED_DEFERRED_MEMBER`.
- Ambiguous declaration-level members emit `SURFACE_AMBIGUOUS_DEFERRED_MEMBER`.
- Body-local deferred members remain listed as still-deferred entries for HIR; they are not dropped.
- `deriveTypedOwnersFromSignatures(signatures, references)` maps receiver and parameter reference keys to owner item IDs from checked signature types.
- Typed-owner keys use `syntaxReferenceKeyToString` from Task 7A.
- Completion uses `buildMemberNamespace(index).resolveMember`, not duplicate lookup logic.

- [ ] **Step 1: Write failing deferred-member tests**

Code example:

```ts
import { buildMemberNamespace } from "../../../../src/semantic/names/member-namespace";
import {
  completeDeferredMembers,
  deriveTypedOwnersFromSignatures,
} from "../../../../src/semantic/surface/deferred-member-completer";

test("declaration-level deferred member resolves through member namespace", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "class Packet:\n    len: u32\nfn f(packet: Packet):\n    requires:\n        packet.len\n",
    ],
  ]);
  const signatures = checkedSignaturesForFixture(fixture);

  const result = completeDeferredMembers({
    index: fixture.index,
    references: fixture.references,
    memberNamespace: buildMemberNamespace(fixture.index),
    typedOwners: deriveTypedOwnersFromSignatures({ signatures, references: fixture.references }),
  });

  expect(result.completed.entries()).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});

test("body-local deferred member remains explicit for HIR", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "fn f(packet: Packet):\n    packet.len\nclass Packet:\n    len: u32\n"],
  ]);

  const result = completeDeferredMembers({
    index: fixture.index,
    references: fixture.references,
    memberNamespace: buildMemberNamespace(fixture.index),
    typedOwners: new Map(),
  });

  expect(result.remainingDeferred).toHaveLength(1);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/deferred-member-completer.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement completer**

Code example:

```ts
export interface CompleteDeferredMembersInput {
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly memberNamespace: MemberNamespace;
  readonly typedOwners: ReadonlyMap<string, ItemId>;
}

export function deriveTypedOwnersFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly references: ResolvedReferences;
}): ReadonlyMap<string, ItemId> {
  const owners = new Map<string, ItemId>();
  for (const signature of input.signatures.entries()) {
    for (const parameter of signature.parameters) {
      const ownerItemId = ownerItemIdForCheckedType(parameter.type);
      if (parameter.referenceKey !== undefined && ownerItemId !== undefined) {
        owners.set(syntaxReferenceKeyToString(parameter.referenceKey), ownerItemId);
      }
    }
  }
  return owners;
}

export function completeDeferredMembers(
  input: CompleteDeferredMembersInput,
): CompleteDeferredMembersResult {
  const completed = new CompletedMemberReferenceBuilder();
  const remaining: DeferredMemberReference[] = [];
  const diagnostics: SemanticSurfaceDiagnostic[] = [];

  for (const deferredMember of input.references.deferredMembers()) {
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    const ownerItemId = input.typedOwners.get(syntaxReferenceKeyToString(ownerKey));
    if (ownerItemId === undefined) {
      remaining.push(deferredMember);
      continue;
    }
    const result = input.memberNamespace.resolveMember({
      ownerItemId,
      name: deferredMember.memberName,
      allowedNamespaces: deferredMember.allowedNamespaces,
    });
    handleMemberResult(result, deferredMember, completed, diagnostics);
  }

  return { completed: completed.build(), remainingDeferred: remaining, diagnostics };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/deferred-member-completer.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/deferred-member-completer.ts tests/unit/semantic/surface/deferred-member-completer.test.ts
git commit -m "feat: complete declaration deferred members -Codex Automated"
```

---

## Task 13: Platform Primitive Certifier

**Description:** Certify name-only platform bindings against the full target catalog using exact v1 structural matching.

**Dependencies:** Tasks 3, 10, 11, and 14.

**Files:**

- Create: `src/semantic/surface/platform-certifier.ts`
- Create: `tests/unit/semantic/surface/platform-certifier.test.ts`

**Acceptance Criteria:**

- Missing full catalog entry emits `SURFACE_PLATFORM_CATALOG_ENTRY_MISSING`.
- Missing name-only binding for a source `platform fn` emits `SURFACE_MISSING_PLATFORM_BINDING`.
- Non-freestanding source platform declarations emit `SURFACE_ILLEGAL_PLATFORM_SHAPE`.
- Exact signature and proof-contract matches produce `CertifiedPlatformBinding` with `kind: "exactCatalogMatch"`.
- Parameter, receiver, return, modifier, availability, and proof-contract mismatches emit deterministic diagnostics.
- Availability is checked against `TargetAvailabilityContext` from image root/profile selection; the certifier does not discover image profiles itself.
- The certifier iterates source platform functions from `signatures.entries()` and checks `platformBindings.get(functionId)`, so missing name-only bindings are visible.
- Certification does not inspect call sites or function bodies.

- [ ] **Step 1: Write failing platform certifier tests**

Code example:

```ts
import { certifyPlatformBindings } from "../../../../src/semantic/surface/platform-certifier";
import {
  semanticTargetSurfaceFake,
  primitiveSpecFake,
} from "../../../support/semantic/semantic-surface-fakes";

test("exact platform binding certifies with fingerprints", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [["main.wr", "platform fn firmware_exit(status: u32) -> Never\n"]],
    { platformNames: ["firmware_exit"] },
  );

  const signatures = checkedSignaturesForFixture(fixture);
  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface: semanticTargetSurfaceFake({
      primitives: [
        primitiveSpecFake({ name: "firmware_exit", signature: signatures.entries()[0]! }),
      ],
    }),
    availability: targetAvailabilityForFixture(fixture),
  });

  expect(result.bindings.entries()[0]!.certificate.kind).toBe("exactCatalogMatch");
  expect(result.diagnostics).toEqual([]);
});

test("non-exact proof contract is rejected without entailment", () => {
  const fixture = platformFixtureWithDifferentRequires();
  const result = certifyPlatformBindings(fixture);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/platform-certifier.test.ts
```

Expected: fail with missing module.

- [ ] **Step 3: Implement exact certification**

Code example:

```ts
export function certifyPlatformBindings(
  input: CertifyPlatformBindingsInput,
): CertifyPlatformBindingsResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const builder = new CertifiedPlatformBindingTableBuilder();
  for (const signature of sourcePlatformSignatures(input.signatures)) {
    const binding = input.platformBindings.get(signature.functionId);
    if (binding === undefined) {
      diagnostics.push(missingPlatformBinding(signature));
      continue;
    }
    const primitive = input.targetSurface.platformPrimitives.get(binding.primitiveId);
    if (primitive === undefined) {
      diagnostics.push(platformPrimitiveCatalogEntryMissing(binding));
      continue;
    }
    if (!targetSignatureExactlyMatches(signature, primitive.signature)) {
      diagnostics.push(platformPrimitiveSignatureMismatchFor(binding, primitive));
      continue;
    }
    if (!targetAvailabilityAllows(input.availability, primitive.availability)) {
      diagnostics.push(targetUnavailablePlatformPrimitive(binding, primitive));
      continue;
    }
    builder.add(certifiedBindingFor(input.targetSurface.targetId, binding, primitive));
  }
  return { bindings: builder.build(), diagnostics: sortSemanticSurfaceDiagnostics(diagnostics) };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/platform-certifier.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/platform-certifier.ts tests/unit/semantic/surface/platform-certifier.test.ts
git commit -m "feat: certify platform primitive bindings -Codex Automated"
```

---

## Task 14: Image Root And Profile Selection

**Description:** Select the image root and target image profile without validating devices or entry shape yet.

**Dependencies:** Tasks 2, 3, 5, and 6.

**Files:**

- Create: `src/semantic/surface/image-root-selection.ts`
- Create: `tests/unit/semantic/surface/image-root-selection.test.ts`

**Acceptance Criteria:**

- No image declarations produce `SURFACE_MISSING_IMAGE_ROOT`.
- Exactly one image with no explicit selection is selected.
- Multiple images with no explicit selection produce `SURFACE_AMBIGUOUS_IMAGE_ROOT`.
- `ImageRootSelection.byImageId` and `.byQualifiedName` resolve deterministically.
- `uefi image` maps to the target profile with `declarationKind: "uefi"`.
- Missing target profile produces `SURFACE_INVALID_IMAGE_ENTRY_SHAPE` or a more specific profile diagnostic from the existing diagnostic set.
- `TargetAvailabilityContext` is exported from this module and contains `targetId`, selected `profileId`, and enabled feature flags for platform/image availability checks.

- [ ] **Step 1: Write failing image root tests**

Code example:

```ts
import { selectImageRoot } from "../../../../src/semantic/surface/image-root-selection";
import { semanticTargetSurfaceFake } from "../../../support/semantic/semantic-surface-fakes";

test("single image is selected when no explicit root is provided", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: semanticTargetSurfaceFake(),
    imageRoot: undefined,
  });

  expect(result.selection?.imageId).toBe(fixture.index.images()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});

test("multiple images require explicit selection", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image A:\nuefi image B:\n"]]);
  const result = selectImageRoot({
    index: fixture.index,
    targetSurface: semanticTargetSurfaceFake(),
    imageRoot: undefined,
  });

  expect(result.selection).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_AMBIGUOUS_IMAGE_ROOT",
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-root-selection.test.ts
```

Expected: fail with missing `selectImageRoot`.

- [ ] **Step 3: Implement root/profile selection**

Code example:

```ts
export type ImageRootSelection =
  | { readonly kind: "byImageId"; readonly imageId: ImageId }
  | {
      readonly kind: "byQualifiedName";
      readonly modulePath: ModulePath;
      readonly imageName: string;
      readonly span?: SourceSpan;
    };

export function selectImageRoot(input: SelectImageRootInput): SelectImageRootResult {
  const images = input.index.images();
  const image = resolveImageSelection(input.imageRoot, images, input.index);
  if (image === undefined) return missingOrAmbiguousImageResult(input, images);
  const profile = input.targetSurface.imageProfiles.find(
    (candidate) => candidate.declarationKind === "uefi",
  );
  if (profile === undefined) return missingProfileResult(input, image);
  return {
    selection: { imageId: image.id, itemId: image.itemId, profileId: profile.profileId },
    diagnostics: [],
  };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-root-selection.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/image-root-selection.ts tests/unit/semantic/surface/image-root-selection.test.ts
git commit -m "feat: select semantic image root -Codex Automated"
```

---

## Task 15: Image Devices And Unique Roots

**Description:** Validate selected image device fields, device target availability, resource kinds, and duplicate unique edge root keys.

**Dependencies:** Tasks 7, 9, and 14.

**Files:**

- Create: `src/semantic/surface/image-device-checker.ts`
- Create: `tests/unit/semantic/surface/image-device-checker.test.ts`

**Acceptance Criteria:**

- Device field type references are checked.
- Device field type references use `SurfaceReferenceLookup`, not string lookup.
- Device field resource kinds must be `UniqueEdgeRoot` or a target-declared compatible kind.
- Target-unavailable device surfaces produce `SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE`.
- Duplicate `UniqueEdgeRootKey`s within one selected image produce `SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT` with related information for the earlier binding.
- Different `DeviceSurfaceId`s can conflict when their specs declare the same root key.
- Ordinary image fields are not treated as device root bindings.

- [ ] **Step 1: Write failing device tests**

Code example:

```ts
test("duplicate unique edge root keys are rejected", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "class NetDevice:\nuefi image Boot:\n    devices:\n        net0: NetDevice\n        net1: NetDevice\n",
    ],
  ]);
  const result = checkImageDevices({
    selection: selectedBootImage(fixture),
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake({
      devices: [
        deviceSurfaceFake({
          name: "NetDevice",
          uniqueEdgeRoots: [uniqueEdgeRootKey("net-root")],
        }),
      ],
    }),
    kindContext: fixture.kindContext,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_DUPLICATE_UNIQUE_EDGE_ROOT",
  );
  expect(result.diagnostics[0]!.relatedInformation).toHaveLength(1);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-device-checker.test.ts
```

Expected: fail with missing `checkImageDevices` behavior.

- [ ] **Step 3: Implement device checking**

Code example:

```ts
export function checkImageDevices(input: CheckImageDevicesInput): CheckImageDevicesResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const devices: CheckedImageDevice[] = [];
  const seenRoots = new Map<UniqueEdgeRootKey, CheckedImageDevice>();

  for (const fieldId of input.selection.image.deviceFieldIds) {
    const field = input.index.field(fieldId);
    if (field === undefined) continue;
    const checkedType = checkTypeReferenceForField(input, field);
    const deviceSurface = findDeviceSurfaceForType(input.targetSurface, checkedType.type);
    const checkedDevice = checkedImageDeviceFrom(field, checkedType, deviceSurface);
    reportDuplicateRoots(checkedDevice, seenRoots, diagnostics);
    devices.push(checkedDevice);
  }

  return {
    devices: sortCheckedImageDevices(devices),
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-device-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/image-device-checker.ts tests/unit/semantic/surface/image-device-checker.test.ts
git commit -m "feat: validate image device roots -Codex Automated"
```

---

## Task 16: Image Entry Shape

**Description:** Validate selected image entry discovery and signature shape through `ImageProfileSpec`. Do not inspect entry bodies.

**Dependencies:** Tasks 10 and 14.

**Files:**

- Create: `src/semantic/surface/image-entry-checker.ts`
- Create: `tests/unit/semantic/surface/image-entry-checker.test.ts`

**Acceptance Criteria:**

- Entry function is discovered from `ImageProfileSpec.entryFunctionName` among image-owned member functions in v1.
- Missing entry function produces `SURFACE_INVALID_IMAGE_ENTRY_SHAPE`.
- Entry signature is compared structurally against `ImageProfileSpec.entrySignature` with `targetSignatureExactlyMatches` from Task 10.
- Declared platform family availability is checked from profile data, not by scanning the function body.
- Terminal/non-terminal entry rules are checked from modifiers.

- [ ] **Step 1: Write failing entry tests**

Code example:

```ts
test("image entry is discovered by profile entry function name", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);
  const signatures = checkedSignaturesForFixture(fixture);

  const result = checkImageEntry({
    selection: selectedBootImage(fixture),
    index: fixture.index,
    signatures,
    targetSurface: semanticTargetSurfaceFake({
      profiles: [uefiImageProfileFake({ entryFunctionName: "entry" })],
    }),
  });

  expect(result.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});

test("missing entry function is diagnosed on image declaration", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "uefi image Boot:\n"]]);
  const result = checkImageEntry({
    selection: selectedBootImage(fixture),
    index: fixture.index,
    signatures: emptySignatureTable(),
    targetSurface: semanticTargetSurfaceFake(),
  });

  expect(result.entryFunctionId).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_IMAGE_ENTRY_SHAPE",
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-entry-checker.test.ts
```

Expected: fail with missing `checkImageEntry` behavior.

- [ ] **Step 3: Implement entry checking**

Code example:

```ts
export function checkImageEntry(input: CheckImageEntryInput): CheckImageEntryResult {
  const imageItem = input.index.item(input.selection.image.itemId);
  const entryFunction = input.index.functions().find((candidate) => {
    return (
      candidate.parentItemId === imageItem?.id &&
      candidate.name === input.selection.profile.entryFunctionName
    );
  });

  if (entryFunction === undefined) {
    return { entryFunctionId: undefined, diagnostics: [invalidImageEntryShape(input.selection)] };
  }

  const signature = input.signatures.get(entryFunction.id);
  const diagnostics = targetSignatureExactlyMatches(
    signature,
    input.selection.profile.entrySignature,
  )
    ? []
    : [invalidImageEntrySignature(entryFunction, input.selection.profile)];

  return { entryFunctionId: entryFunction.id, diagnostics };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/image-entry-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/image-entry-checker.ts tests/unit/semantic/surface/image-entry-checker.test.ts
git commit -m "feat: validate image entry shape -Codex Automated"
```

---

## Task 17: Semantic Surface Orchestrator

**Description:** Wire all subpasses into `checkSemanticSurface(input)` and return total checked results with sorted diagnostics.

**Dependencies:** Tasks 7, 8, 9, 10, 11, 12, 13, 14, 15, and 16.

**Files:**

- Create: `src/semantic/surface/semantic-surface-checker.ts`
- Create: `src/semantic/surface/index.ts`
- Create: `tests/unit/semantic/surface/semantic-surface-checker.test.ts`

**Acceptance Criteria:**

- `checkSemanticSurface` accepts the public input shape from the design.
- It returns `program`, `image`, and phase-local diagnostics.
- It does not aggregate lexer, parser, item-index, or name-resolution diagnostics.
- It wires type declaration checking, generic/interface checking, resource-kind assignment, field/signature checking, proof-surface collection, deferred-member completion, platform certification, image root selection, image devices, and image entry validation.
- It continues after local failures using error checked values, uncertified bindings, and absent image seed.
- Diagnostics and result tables are sorted deterministically.
- Runtime source has no filesystem or Bun dependency.

- [ ] **Step 1: Write failing orchestrator tests**

Code example:

```ts
import { checkSemanticSurface } from "../../../../src/semantic/surface/semantic-surface-checker";

test("orchestrator returns checked program and image seed for valid minimal image", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake(),
  });

  expect(result.program.functions.entries()).toHaveLength(1);
  expect(result.image?.entryFunctionId).toBe(fixture.index.functions()[0]!.id);
  expect(result.diagnostics).toEqual([]);
});

test("orchestrator does not copy name-resolution diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: Missing)\n"]]);
  const result = checkSemanticSurface(validSurfaceInputFromFixture(fixture));

  expect(result.diagnostics.every((diagnostic) => diagnostic.code.startsWith("SURFACE_"))).toBe(
    true,
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/semantic-surface-checker.test.ts
```

Expected: fail with missing orchestrator.

- [ ] **Step 3: Implement orchestrator**

Code example:

```ts
export interface CheckSemanticSurfaceInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly imageRoot?: ImageRootSelection;
}

export function checkSemanticSurface(input: CheckSemanticSurfaceInput): CheckSemanticSurfaceResult {
  const builder = new CheckedProgramBuilder();
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const referenceLookup = buildSurfaceReferenceLookup(input.references);

  const checkedTypes = checkAllTypeDeclarations({ ...input, referenceLookup });
  builder.addTypes(checkedTypes.types.entries());
  diagnostics.push(...checkedTypes.diagnostics);

  const generics = checkAllGenericSurfaces({ ...input, referenceLookup });
  builder.addGenericParameters(generics.genericParameters.entries());
  diagnostics.push(...generics.diagnostics);

  const resources = assignAllResourceKinds({ ...input, checkedTypes: checkedTypes.types });
  builder.addFields(resources.fields.entries());
  diagnostics.push(...resources.diagnostics);

  const signatures = checkAllFunctionSignatures({
    ...input,
    referenceLookup,
    kindContext: resources.kindContext,
  });
  builder.addFunctionSignatures(signatures.signatures.entries());
  diagnostics.push(...signatures.diagnostics);

  const proofSurface = collectProofSurfaceSeeds({
    ...input,
    signatures: signatures.signatures,
  });
  builder.addProofSurfaceSeeds(proofSurface.entries());
  diagnostics.push(...proofSurface.diagnostics);

  const typedOwners = deriveTypedOwnersFromSignatures({
    signatures: signatures.signatures,
    references: input.references,
  });
  const deferredMembers = completeDeferredMembers({
    index: input.index,
    references: input.references,
    memberNamespace: buildMemberNamespace(input.index),
    typedOwners,
  });
  builder.addCompletedMembers(deferredMembers.completed.entries());
  diagnostics.push(...deferredMembers.diagnostics);

  const imageRoot = selectImageRoot(input);
  diagnostics.push(...imageRoot.diagnostics);

  const platform = certifyPlatformBindings({
    ...input,
    signatures: signatures.signatures,
    proofSurface: builder.proofSurface(),
    availability: imageRoot.availability,
  });
  builder.addCertifiedPlatformBindings(platform.bindings.entries());
  diagnostics.push(...platform.diagnostics);

  const devices = imageRoot.selection
    ? checkImageDevices({
        ...input,
        referenceLookup,
        selection: imageRoot.selection,
        kindContext: resources.kindContext,
      })
    : absentImageDevices();
  diagnostics.push(...devices.diagnostics);

  const entry = imageRoot.selection
    ? checkImageEntry({
        ...input,
        selection: imageRoot.selection,
        signatures: signatures.signatures,
      })
    : absentImageEntry();
  diagnostics.push(...entry.diagnostics);

  return {
    program: builder.build(),
    image: checkedImageSeedFromParts(imageRoot.selection, devices.devices, entry.entryFunctionId),
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
```

- [ ] **Step 4: Run the narrow test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface/semantic-surface-checker.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/semantic-surface-checker.ts src/semantic/surface/index.ts tests/unit/semantic/surface/semantic-surface-checker.test.ts
git commit -m "feat: orchestrate semantic surface checking -Codex Automated"
```

---

## Task 18: Determinism Summaries

**Description:** Add stable test-only summary serializers and determinism tests for semantic surface outputs under shuffled input order.

**Dependencies:** Tasks 3, 6, 10, 13, 14, 15, and 17.

**Files:**

- Modify: `tests/support/semantic/semantic-surface-fakes.ts`
- Create: `tests/integration/semantic/semantic-surface-determinism.test.ts`

**Acceptance Criteria:**

- Summary serializers live in test support, not runtime source.
- Equivalent module order, platform primitive order, image profile order, and device surface order produce byte-for-byte equal summaries.
- Diagnostics summary includes code, message, path, span start, span end, and related information.
- Program summary includes checked type/function/field/generic/platform/image seed identifiers and fingerprints.

- [ ] **Step 1: Write failing determinism test**

Code example:

```ts
import {
  checkSemanticSurfaceForTest,
  semanticSurfaceSummary,
  shuffledSemanticTargetSurfaceFake,
} from "../../support/semantic/semantic-surface-fakes";

test("semantic surface is deterministic across shuffled target surface order", () => {
  const files: readonly [string, string][] = [
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ];

  const first = checkSemanticSurfaceForTest(files, {
    targetSurface: shuffledSemanticTargetSurfaceFake(1),
  });
  const second = checkSemanticSurfaceForTest(files, {
    targetSurface: shuffledSemanticTargetSurfaceFake(2),
  });

  expect(semanticSurfaceSummary(first)).toEqual(semanticSurfaceSummary(second));
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/semantic-surface-determinism.test.ts
```

Expected: fail with missing summary helpers.

- [ ] **Step 3: Implement test-only summaries**

Code example:

```ts
export function semanticSurfaceSummary(result: CheckSemanticSurfaceResult): string {
  return JSON.stringify({
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.source?.path,
      start: diagnostic.span?.start,
      end: diagnostic.span?.end,
      related: diagnostic.relatedInformation?.map((info) => info.message) ?? [],
    })),
    functions: result.program.functions
      .entries()
      .map((entry) => [
        entry.functionId,
        checkedTypeFingerprint(entry.returnType),
        resourceKindFingerprint(entry.returnKind),
      ]),
    platform: result.program.certifiedPlatformBindings
      .entries()
      .map((entry) => [
        entry.functionId,
        entry.primitiveId,
        entry.contractId,
        entry.certificate.signatureFingerprint,
        entry.certificate.proofContractFingerprint,
      ]),
    image: result.image
      ? [result.image.imageId, result.image.profileId, result.image.entryFunctionId]
      : undefined,
  });
}
```

- [ ] **Step 4: Run the determinism test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/semantic-surface-determinism.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/support/semantic/semantic-surface-fakes.ts tests/integration/semantic/semantic-surface-determinism.test.ts
git commit -m "test: add semantic surface determinism coverage -Codex Automated"
```

---

## Task 19: Integration Scenarios

**Description:** Add end-to-end semantic-surface integration tests over parsed module graphs and resolved names.

**Dependencies:** Task 17.

**Files:**

- Create: `tests/integration/semantic/semantic-surface.test.ts`

**Acceptance Criteria:**

- Valid minimal `uefi image` produces checked program and image seed.
- Multiple images require explicit root selection.
- Vendored stdlib-like source receives no trust privilege.
- Source `platform fn` that name-resolves but fails certification reports semantic-surface diagnostic.
- Target-unavailable primitive reports target-availability diagnostic.
- Image device unavailable for selected profile reports image-device diagnostic.
- Proof-surface seeds can be recovered from a checked function with `requires`.

- [ ] **Step 1: Write integration tests**

Code example:

```ts
import { checkSemanticSurfaceForTest } from "../../support/semantic/semantic-surface-fakes";

test("valid image produces checked image seed", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "uefi image Boot:\n    fn entry() -> Never\n"],
  ]);

  expect(result.image).toBeDefined();
  expect(result.diagnostics).toEqual([]);
});

test("platform fn with wrong signature fails certification", () => {
  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn firmware_exit(status: u64) -> Never\nuefi image Boot:\n    fn entry() -> Never\n",
      ],
    ],
    { platformNames: ["firmware_exit"] },
  );

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
  );
});

test("requires clause is preserved as proof-surface seed", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "fn is_valid() -> bool\nfn checked_entry() -> Never:\n    requires:\n        is_valid\nuefi image Boot:\n    fn entry() -> Never\n",
    ],
  ]);

  expect(result.program.proofSurface.requirementSurfaces.entries().length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the failing integration test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/semantic-surface.test.ts
```

Expected: fail for missing scenarios until helper/orchestrator behavior is complete.

- [ ] **Step 3: Complete fixtures or narrow bugs exposed by integration**

Code example:

```ts
export function checkSemanticSurfaceForTest(
  files: readonly [string, string][],
  options: SemanticSurfaceFixtureOptions = {},
): CheckSemanticSurfaceResult {
  const fixture = parseAndResolveSurfaceFixture(files, options);
  return checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: options.targetSurface ?? semanticTargetSurfaceFake(),
    imageRoot: options.imageRoot,
  });
}
```

- [ ] **Step 4: Run the integration test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/semantic-surface.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/semantic/semantic-surface.test.ts tests/support/semantic/semantic-surface-fakes.ts
git commit -m "test: add semantic surface integration coverage -Codex Automated"
```

---

## Task 20: Public API Barrels

**Description:** Export semantic surface APIs through the surface barrel and semantic barrel.

**Dependencies:** Task 17.

**Files:**

- Modify: `src/semantic/surface/index.ts`
- Modify: `src/semantic/index.ts`
- Modify: `src/index.ts`
- Modify: `tests/integration/semantic/public-api.test.ts`

**Acceptance Criteria:**

- `checkSemanticSurface` is exported from `src/semantic/surface`.
- `checkSemanticSurface`, target surface types/builders, checked program types, diagnostics, and core result types are re-exported from `src/semantic`.
- Top-level package semantic namespace exposes semantic surface APIs consistently with item-index and name-resolution exports.
- Public API tests import through barrels, not direct paths.

- [ ] **Step 1: Write failing public API tests**

Code example:

```ts
import { semantic } from "../../../src";
import { checkSemanticSurface } from "../../../src/semantic";

test("semantic namespace exports semantic surface API", () => {
  expect(typeof checkSemanticSurface).toBe("function");
  expect(typeof semantic.checkSemanticSurface).toBe("function");
});

test("semantic namespace exports target surface builders", () => {
  expect(typeof semantic.platformPrimitiveCatalog).toBe("function");
  expect(typeof semantic.semanticTargetSurface).toBe("function");
});
```

- [ ] **Step 2: Run the failing public API test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/public-api.test.ts
```

Expected: fail with missing exports.

- [ ] **Step 3: Add barrel exports**

Code example:

```ts
// src/semantic/surface/index.ts
export * from "./checked-program";
export * from "./diagnostics";
export * from "./image-device-checker";
export * from "./image-entry-checker";
export * from "./image-root-selection";
export * from "./platform-surface";
export * from "./reference-lookup";
export * from "./resource-kind";
export * from "./semantic-surface-checker";
export * from "./signature-checker";
export * from "./type-model";
```

```ts
// src/semantic/index.ts
export * from "./ids";
export * from "./item-index";
export * from "./names";
export * from "./surface";
```

- [ ] **Step 4: Run the public API test**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/public-api.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/semantic/surface/index.ts src/semantic/index.ts src/index.ts tests/integration/semantic/public-api.test.ts
git commit -m "feat: export semantic surface API -Codex Automated"
```

---

## Task 21: Final Audit And Handoff

**Description:** Run the complete check suite, fix any final integration issues, and verify the implementation matches the design and this plan.

**Dependencies:** All prior tasks.

**Files:**

- Modify only files needed to fix check failures found by this task.

**Acceptance Criteria:**

- `bun run agent:check` passes.
- No runtime source imports `fast-check`, `Bun.file`, filesystem APIs, HIR, MIR, codegen, linker, or PE/COFF modules.
- All semantic surface diagnostics are deterministic and phase-local.
- No task introduced mocks or spies.
- Public barrels export semantic surface APIs.
- The implementation does not inspect function bodies for platform certification or image entry usage.
- The implementation preserves proof-surface seeds but does not assign final proof IDs.

- [ ] **Step 1: Run policy scans for forbidden dependencies**

Run:

```bash
rg -n "fast-check|Bun\\.file|node:fs|from \\\"fs\\\"|from '../hir|from '../mir|codegen|linker|pe/coff" src/semantic/surface src/semantic/ids.ts src/semantic/index.ts
```

Expected: no matches for forbidden runtime dependencies.

- [ ] **Step 2: Run semantic surface tests together**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/surface ./tests/integration/semantic/semantic-surface.test.ts ./tests/integration/semantic/semantic-surface-determinism.test.ts
```

Expected: pass.

- [ ] **Step 3: Run required handoff check**

Run:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun run agent:check
```

Expected: pass with typecheck, format check, lint, policy check, and all tests.

- [ ] **Step 4: If checks fail, fix the narrow cause and rerun**

Code example for a typical deterministic ordering fix:

```ts
const sorted = [...entries].sort((left, right) => {
  if (left.moduleId !== right.moduleId) {
    return (left.moduleId as number) - (right.moduleId as number);
  }
  if (left.span.start !== right.span.start) return left.span.start - right.span.start;
  if (left.span.end !== right.span.end) return left.span.end - right.span.end;
  return compareCodeUnitStrings(left.code, right.code);
});
```

- [ ] **Step 5: Commit final fixes**

```bash
git add src/semantic/surface src/semantic/ids.ts src/semantic/index.ts src/index.ts tests/unit/semantic/surface tests/integration/semantic tests/support/semantic
git commit -m "chore: validate semantic surface implementation -Codex Automated"
```

---

## Plan Self-Review

Spec coverage:

- Type-reference validation: Tasks 5 and 7.
- Generic parameters, bounds, interface constraints: Task 8.
- Resource kind assignment and parametric kinds: Tasks 4 and 9.
- Signature checking: Task 10.
- Deferred member completion: Task 12.
- Proof-surface preservation: Tasks 6 and 11.
- Platform primitive certification: Tasks 3 and 13.
- Image root selection, profile selection, devices, unique roots, entry shape: Tasks 14, 15, and 16.
- Orchestration and public API: Tasks 17 and 20.
- Determinism: Tasks 2, 6, 18, and 21.
- Integration: Task 19.

Placeholder scan:

- This plan contains only executable implementation tasks.
- Every task has files, dependencies, acceptance criteria, code examples, commands, and a commit example.
- All target-facing concepts used by tasks are implemented in concrete tasks.

Type consistency:

- Type-parameter positions use `index`, matching `ResolvedReference` and `TypeParameterRecord`.
- Platform certification uses `CertifiedPlatformBinding`, not a name-resolution certified type.
- `CheckedResourceKind` is used for signatures and applied types; concrete-only APIs use `ConcreteResourceKind`.
- `ImageRootSelection`, `UniqueEdgeRootKey`, `CheckedImageSeed`, and `CheckedImageDevice` are defined before image tasks depend on them.
