# Whole-Image Monomorphization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement whole-image monomorphization from `docs/design/whole-image-monomorphization-design.md`, including the typed HIR closure-surface prerequisite, deterministic concrete instance construction, proof metadata cloning, platform primitive retention, and closed-boundary diagnostics.

**Architecture:** Typed HIR becomes the single downstream authority by carrying source type records, field records, ordered generic parameter keys, call owner type arguments, platform edge lookups, and a `HirMonoClosureSurface`. The new `src/mono` phase consumes only typed HIR, uses canonical instance keys for deterministic deduplication, and emits closed image-specific HIR tables with instantiated proof metadata. Filesystem access, package loading, layout, Proof MIR, proof checking, target lowering, and binary emission remain outside this phase.

**Tech Stack:** TypeScript, Bun test runner, existing semantic/HIR pure models, existing `checkedTypeFingerprint` and resource-kind helpers, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- The design file is currently untracked in the working tree. Treat `docs/design/whole-image-monomorphization-design.md` as the source of truth and do not rewrite it while implementing this plan.
- Current `TypedHirProgram` in `src/hir/hir.ts` has `declarations`, `functions`, `validatedBuffers`, `images`, `proofMetadata`, and `origins`. It does not yet have `types`, `fields`, or `monoClosure`.
- Current `HirFunction` does not carry ordered `declaredTypeParameters`; mono must not recover the order from source text.
- Current `HirCallExpression` carries `calleeFunctionId` and function `typeArguments`, but not `ownerTypeId`, `ownerTypeArguments`, or `ownerTypeArgumentSource`.
- Current proof metadata already has deterministic tables for obligations, sessions, brands, resource places, call-site requirements, validations, attempts, terminal calls, private-state transitions, fact origins, platform contract edges, and image origins. Mono should mirror these records instead of inventing unrelated proof IDs.
- Current semantic resource-kind checking classifies applied types by joining argument kinds. The design requires semantic constructor kind rules so proof-relevant constructors such as validated buffers, streams, edge paths, private state, and sealed platform tokens are not silently collapsed to ordinary `Linear`.
- Existing `src/hir/generic-substitution.ts` substitutes checked types for HIR call lowering, but its resource-kind path does not resolve `parametric` or `derived` kinds. Mono needs a total substitution and concretization path under `src/mono`.
- Current public barrel `src/index.ts` exports `hir` and `semantic`; it does not export `mono`.
- Table APIs in this plan follow the current repository shape: `entries()` returns a readonly array of values in deterministic order. When a table needs key/value iteration, the API must be named `keyedEntries()` instead of overloading `entries()`.
- Required repository handoff command:

```bash
bun run agent:check
```

- Narrow commands workers should prefer while iterating:

```bash
bun test ./tests/unit/semantic/surface/resource-kind-checker.test.ts
bun test ./tests/unit/hir/typed-hir-fixtures.test.ts
bun test ./tests/unit/hir/call-lowerer.test.ts
bun test ./tests/unit/mono/instantiation-key.test.ts
bun test ./tests/unit/mono/substitution.test.ts
bun test ./tests/integration/mono/whole-image-monomorphization.test.ts
```

## Executor Protocol

Every task below is atomic for one worker. Before starting a task, copy this checklist into that task's work notes and check off each item.

- [ ] Read the task description, dependencies, file list, acceptance criteria, code examples, and verification commands.
- [ ] Verify every dependency task has landed and no same-wave task owns the files listed here.
- [ ] Write the failing test from the task's code example in the task-owned test file.
- [ ] Run the narrow verification command and confirm the new test fails for the expected missing symbol, missing behavior, or diagnostic mismatch.
- [ ] Implement only the files listed by the task.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run any adjacent narrow tests listed by the task.
- [ ] Commit only this task's files. Commit messages created by automation must end with `-Codex Automated`.

## Common Test Imports

Use these imports in task test files when snippets reference the listed helpers. Task snippets may omit repeated imports for brevity, but implementation PRs must include them.

```ts
import { expect, test } from "bun:test";
import {
  coreTypeId,
  functionId,
  imageId,
  itemId,
  moduleId,
  obligationId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  targetTypeId,
  typeId,
} from "../../../src/semantic/ids";
import {
  appliedType,
  checkedTypeFingerprint,
  coreCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import { concreteKind, derivedKind } from "../../../src/semantic/surface/resource-kind";
import { hirOriginId, ownedObligationId } from "../../../src/hir/ids";
import {
  lowerTypedHirForTest,
  semanticSurfaceForHirTest,
} from "../../support/hir/typed-hir-fixtures";
import { semanticTargetSurfaceFake } from "../../support/semantic/semantic-surface-fakes";
```

## Parallel Execution Model

Tasks in the same wave can be worked by separate subagents after their listed dependencies are complete. Each wave below is an antichain: no task depends on another task in the same wave, and same-wave tasks do not intentionally edit the same production file.

```text
Wave 0:
  Task 1: Semantic mono-closure fact model and builder plumbing
  Task 3: HIR mono prerequisite schema
  Task 7: Mono diagnostics, IDs, deterministic table helpers

Wave 1:
  Task 2 after Task 1: Semantic constructor and target resource-kind facts
  Task 4 after Task 3: HIR call owner type-argument lowering
  Task 6 after Task 3: HIR platform edge lookup index
  Task 8 after Task 7: Monomorphized HIR schema

Wave 2:
  Task 5 after Tasks 1, 2, 3, 4, and 6: HIR mono-closure assembly
  Task 10 after Tasks 7 and 8: MonoCheckedType normalization and canonical keys

Wave 3:
  Task 9 after Tasks 7, 8, and 10: Base mono test fakes and summary helpers

Wave 4:
  Task 11 after Tasks 9 and 10: Mono substitution environment
  Task 14 after Tasks 5, 8, 9, and 10: Monomorphizer API and image root seeding

Wave 5:
  Task 12 after Tasks 5, 9, 10, and 11: Resource-kind concretization

Wave 6:
  Task 13 after Tasks 5, 9, 10, 11, and 12: Instance eligibility checking
  Task 15 after Tasks 5, 8, 9, 10, 11, and 12: Type instance construction
  Task 17 after Tasks 8, 9, 10, 11, and 12: Function signature, local, and requirement instantiation
  Task 20 after Tasks 8, 9, 10, and 11: Proof metadata owner indexes and remap APIs

Wave 7:
  Task 16 after Tasks 9 and 15: Validated-buffer metadata attachment
  Task 18 after Tasks 9 and 17: Function body cloning and call edge extraction

Wave 8:
  Task 19A after Tasks 14, 15, 16, and 18: Reachability DFS skeleton and minimal closed image

Wave 9:
  Task 19B after Task 19A: Reachability dedupe and instantiation graph edges

Wave 10:
  Task 19C after Task 19B: Reachability recursion and SCC validation

Wave 11:
  Task 21 after Tasks 17, 19C, and 20: Proof metadata table instantiation

Wave 12:
  Task 22 after Tasks 19C and 21: Platform primitive retention

Wave 13:
  Task 23 after Tasks 13, 19C, 21, and 22: Closed-boundary checker and diagnostic suppression

Wave 14:
  Task 24A after Task 23: Public API barrels
  Task 24B after Task 23: Whole-image integration coverage

Wave 15:
  Task 24C after Tasks 24A and 24B: Determinism and final verification
```

The back half intentionally becomes mostly serial after Task 18 because reachability, proof metadata, platform retention, and the closed-boundary scan are ordered compiler phases. Parallelism is front-loaded around independent HIR, schema, substitution, type/function instantiation, and proof-index work.

Single-writer coordination:

- `src/semantic/surface/mono-closure.ts` is created by Task 1 and extended only by Task 2.
- `src/hir/hir.ts` structural additions for HIR type records, field records, ordered type parameter keys, call owner type-argument fields, `HirPlatformContractEdgeLookupKey`, and mono-closure interfaces are owned by Task 3. Tasks 4, 5, and 6 populate or consume those interfaces without adding new HIR model fields.
- `src/hir/proof-metadata.ts` platform lookup API is owned by Task 6 after Task 3 defines the lookup key type.
- `src/mono/index.ts` is created by Task 7 with only stable substrate exports. Tasks 8 through 23 import direct module paths in their tests and do not edit the barrel. Task 24A owns the final public `src/mono/index.ts` export surface.
- `src/mono/mono-hir.ts` schema ownership is Task 8. Later tasks populate the schema through builders without changing public record names unless tests prove a missing field.
- `tests/support/mono/monomorphization-fakes.ts` and `tests/support/mono/monomorphization-fixtures.ts` are created by Task 9 with base helpers only. Later tasks append the helpers they first need to these files in their own task, after the production types those helpers depend on exist.
- `src/mono/monomorphizer.ts` orchestration is first created by Task 14 and expanded by Task 19.
- `src/mono/proof-metadata-instantiator.ts` is split by ownership: Task 20 owns indexes/remap APIs, Task 21 owns record construction.
- `src/mono/platform-primitives.ts` is owned by Task 22.
- `src/mono/closed-boundary-checker.ts` is owned by Task 23.
- Shared test files are append-only after their creating task. If a task appends to a shared test file created earlier, its commit includes only that appended test region and the production files listed in that task. Task 9 uses `tests/unit/mono/monomorphization-fixtures.test.ts` for fixture smoke tests instead of borrowing `diagnostics.test.ts`.

## Target File Structure

```text
src/
  semantic/
    surface/
      mono-closure.ts

  hir/
    hir.ts
    proof-metadata.ts
    typed-hir-builder.ts
    call-lowerer.ts

  mono/
    index.ts
    ids.ts
    mono-hir.ts
    diagnostics.ts
    deterministic-sort.ts
    instantiation-key.ts
    substitution.ts
    resource-kind-concretizer.ts
    instance-eligibility.ts
    type-instantiator.ts
    function-instantiator.ts
    proof-metadata-instantiator.ts
    reachability.ts
    closed-boundary-checker.ts
    platform-primitives.ts
    monomorphizer.ts

tests/
  support/
    mono/
      monomorphization-fakes.ts
      monomorphization-fixtures.ts

  unit/
    mono/
      diagnostics.test.ts
      mono-hir.test.ts
      monomorphization-fixtures.test.ts
      instantiation-key.test.ts
      substitution.test.ts
      resource-kind-concretizer.test.ts
      instance-eligibility.test.ts
      type-instantiator.test.ts
      function-instantiator.test.ts
      proof-metadata-instantiator.test.ts
      reachability.test.ts
      closed-boundary-checker.test.ts
      platform-primitives.test.ts

  integration/
    mono/
      whole-image-monomorphization.test.ts
      generic-instantiation.test.ts
      proof-metadata-instantiation.test.ts
      platform-primitive-reachability.test.ts
      closed-boundary-rejection.test.ts
      monomorphization-determinism.test.ts
      public-api.test.ts
```

---

### Task 1: Semantic Mono-Closure Fact Model And Builder Plumbing

**Description:** Add a pure semantic surface model that records mono-closure facts already known by semantic checking. This gives HIR lowering a checked source for constructor kind rules, target type kinds, instance eligibility rules, and external roots without making mono read `CheckedSemanticProgram` directly.

**Dependencies:** None.

**Files:**

- Create: `src/semantic/surface/mono-closure.ts`
- Modify: `src/semantic/surface/checked-program.ts`
- Modify: `src/semantic/surface/index.ts`
- Test: `tests/unit/semantic/surface/checked-program.test.ts`

**Acceptance Criteria:**

- `CheckedSemanticProgram` exposes `monoClosureFacts`.
- `CheckedProgramBuilder` has `setMonoClosureFacts(facts)` and defaults to empty deterministic tables.
- All fact tables expose `get(...)` where the key is unique and `entries()` in deterministic code-unit order.
- No runtime dependency is added.
- Existing semantic and HIR tests pass unchanged.

**Code Examples:**

```ts
// src/semantic/surface/mono-closure.ts
export interface CheckedMonoClosureFacts {
  readonly targetTypeKinds: CheckedTargetTypeKindTable;
  readonly constructorKindRules: CheckedConstructorKindRuleTable;
  readonly instanceEligibilityRules: CheckedInstanceEligibilityRuleTable;
  readonly externalEntryRoots: CheckedExternalEntryRootTable;
}

export function checkedMonoClosureFactsEmpty(): CheckedMonoClosureFacts;
```

```ts
// tests/unit/semantic/surface/checked-program.test.ts
import { expect, test } from "bun:test";
import { CheckedProgramBuilder } from "../../../../src/semantic/surface/checked-program";

test("checked program exposes empty mono closure facts by default", () => {
  const program = new CheckedProgramBuilder().build();

  expect(program.monoClosureFacts.constructorKindRules.entries()).toEqual([]);
  expect(program.monoClosureFacts.targetTypeKinds.entries()).toEqual([]);
  expect(program.monoClosureFacts.instanceEligibilityRules.entries()).toEqual([]);
  expect(program.monoClosureFacts.externalEntryRoots.entries()).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/semantic/surface/checked-program.test.ts
bun test ./tests/unit/semantic/surface/resource-kind.test.ts
```

---

### Task 2: Semantic Constructor And Target Resource-Kind Facts

**Description:** Produce checked constructor kind rules and target type kind records during semantic surface checking. This task fixes the known applied-constructor collapse by preserving proof-relevant constructor identity in checked facts that HIR can copy.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/semantic/surface/mono-closure.ts`
- Modify: `src/semantic/surface/resource-kind-checker.ts`
- Modify: `src/semantic/surface/platform-surface.ts`
- Modify: `src/semantic/surface/semantic-surface-checker.ts`
- Modify: `tests/support/semantic/semantic-surface-fakes.ts`
- Test: `tests/unit/semantic/surface/resource-kind-checker.test.ts`
- Test: `tests/integration/semantic/semantic-surface.test.ts`

**Acceptance Criteria:**

- `SemanticTargetSurface` can carry selected target type kind records; existing fakes default to an empty list.
- Semantic surface checking records constructor rules for every source constructor that can appear in a checked applied type.
- Proof-relevant constructors use `"appliedConstructor"` with `resultKind` when the declaration kind or modifier determines a non-join kind.
- Ordinary generic classes can use `"fieldAggregation"` or `"join"` according to the existing resource-kind vocabulary.
- `resourceKindForType` still works for existing callers, but the mono closure facts preserve the more specific constructor rule.

Constructor rule table:

```text
Source item shape                         Rule                 Result kind
class with private modifier               appliedConstructor   PrivateState
edgeClass with unique modifier            appliedConstructor   UniqueEdgeRoot
edgeClass without unique modifier         appliedConstructor   EdgePath
stream                                    appliedConstructor   Stream
validatedBuffer                           appliedConstructor   ValidatedBuffer
interface                                 appliedConstructor   Copy
enum                                      appliedConstructor   Copy
dataclass                                 fieldAggregation     none
ordinary class without private modifier   fieldAggregation     none
certified platform token surface          appliedConstructor   SealedPlatformToken
```

Core and target constructor decision rules:

```text
core constructor with no target type ID         join             none
target constructor with target type ID          targetDeclared   none; concrete kind comes from targetTypeKinds
target constructor missing target kind record   diagnostic       MONO_MISSING_TARGET_TYPE_KIND when reachable
source constructor not covered above            diagnostic       MONO_MISSING_CONSTRUCTOR_KIND_RULE when reachable
```

If future source kinds are added, this task must add an explicit table row and a unit test before the kind can appear in mono closure facts.

**Code Examples:**

```ts
// tests/unit/semantic/surface/resource-kind-checker.test.ts
import { expect, test } from "bun:test";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";
import { checkedTypeFingerprint } from "../../../../src/semantic/surface/type-model";
import { semanticSurfaceForHirTest } from "../../../support/hir/typed-hir-fixtures";

test("validated buffer constructor rule preserves proof-relevant kind", () => {
  const source = `
validated buffer Packet[T]:
    param value: T
    layout raw: u8
`;
  const surface = semanticSurfaceForHirTest([["main.wr", source]]);
  const rule = surface.program.monoClosureFacts.constructorKindRules
    .entries()
    .find((entry) => entry.resultKind?.kind === "concrete");

  expect(rule?.rule).toBe("appliedConstructor");
  expect(rule?.resultKind).toEqual(concreteKind("ValidatedBuffer"));
});

test("target type kinds are deterministic when target surface order changes", () => {
  const first = semanticSurfaceForHirTest([["main.wr", "fn main() -> Never:\n    return\n"]], {
    targetSurface: semanticTargetSurfaceFake({
      targetTypeKinds: [
        { targetTypeId: targetTypeId("Z"), kind: "Linear" },
        { targetTypeId: targetTypeId("A"), kind: "Copy" },
      ],
    }),
  });
  const fingerprints = first.program.monoClosureFacts.targetTypeKinds
    .entries()
    .map((entry) => `${entry.targetTypeId}:${entry.kind}`);

  expect(fingerprints).toEqual(["A:Copy", "Z:Linear"]);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/semantic/surface/resource-kind-checker.test.ts
bun test ./tests/integration/semantic/semantic-surface.test.ts
```

---

### Task 3: HIR Mono Prerequisite Schema

**Description:** Extend the typed HIR model with the schema fields mono needs before any HIR lowerer starts populating them. This task owns `src/hir/hir.ts` structural additions so parallel HIR tasks do not edit the same model file.

**Dependencies:** None.

**Files:**

- Modify: `src/hir/hir.ts`
- Modify: `src/hir/typed-hir-builder.ts`
- Modify: `src/hir/index.ts`
- Modify: `tests/support/hir/typed-hir-fixtures.ts`
- Test: `tests/unit/hir/typed-hir-fixtures.test.ts`
- Test: `tests/integration/hir/declaration-lowering.test.ts`

**Acceptance Criteria:**

- `TypedHirProgram` includes `types: HirTypeTable` and `fields: HirFieldTable`.
- `HirTypeRecord` includes `typeId`, `itemId`, `sourceKind`, `declaredTypeParameters`, `fieldIds`, `resourceKind`, and `sourceOrigin`.
- `HirFieldRecord` includes `fieldId`, `ownerTypeId`, `name`, `type`, `resourceKind`, and `sourceOrigin`.
- `HirFunction` includes `declaredTypeParameters: readonly TypeParameterKey[]`.
- `HirFunction` includes `ownerTypeId?: TypeId`; methods and constructors get this from the enclosing source item record, and free functions leave it absent.
- `HirCallExpression` includes `ownerTypeId?: TypeId`, `ownerTypeArguments: readonly CheckedType[]`, and `ownerTypeArgumentSource: "none" | "receiverType" | "constructorExpectedType" | "completedMemberReference" | "error"`.
- `HirPlatformContractEdgeLookupKey` is exported from `src/hir/hir.ts`.
- `HirMonoClosureSurface` and the HIR deterministic table interfaces from the design are declared but populated by Task 5.
- Records are deterministic by source ID code-unit ordering, using fixed-width decimal key strings for numeric IDs so `2` sorts before `10`.
- HIR tests cover generic type parameter ordering and function type parameter ordering.

**Code Examples:**

```ts
// tests/unit/hir/typed-hir-fixtures.test.ts
import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("typed HIR records source types, fields, and ordered type parameters", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      `
class Box[T]:
    value: T

fn id[U](value: U) -> U:
    return value
`,
    ],
  ]);

  const typeRecord = result.program.types.entries()[0]!;
  const fieldRecord = result.program.fields.entries()[0]!;
  const functionRecord = result.program.functions
    .entries()
    .find((entry) => entry.declaredTypeParameters.length === 1)!;

  expect(typeRecord.sourceKind).toBe("class");
  expect(typeRecord.declaredTypeParameters.map((parameter) => parameter.index)).toEqual([0]);
  expect(typeRecord.fieldIds).toEqual([fieldRecord.fieldId]);
  expect(fieldRecord.ownerTypeId).toBe(typeRecord.typeId);
  expect(functionRecord.declaredTypeParameters.map((parameter) => parameter.index)).toEqual([0]);
});
```

```ts
// src/hir/hir.ts schema shape owned by this task
export interface HirCallExpression {
  readonly callee: HirExpression;
  readonly calleeFunctionId?: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly ownerTypeArgumentSource:
    | "none"
    | "receiverType"
    | "constructorExpectedType"
    | "completedMemberReference"
    | "error";
  readonly arguments: readonly HirCallArgument[];
  readonly typeArguments: readonly CheckedType[];
  readonly receiver?: HirExpression;
  readonly sourceOrigin?: HirOriginId;
  readonly recovered?: boolean;
}

export interface HirFunction {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly ownerTypeId?: TypeId;
  readonly declaredTypeParameters: readonly TypeParameterKey[];
}
```

**Verification Commands:**

```bash
bun test ./tests/unit/hir/typed-hir-fixtures.test.ts
bun test ./tests/integration/hir/declaration-lowering.test.ts
```

---

### Task 4: HIR Call Owner Type-Argument Lowering

**Description:** Populate the call owner type-argument fields introduced by Task 3 so each reachable call carries owner type identity and concrete owner type arguments when the callee is a method or constructor. Mono uses this checked HIR surface instead of doing member lookup.

**Dependencies:** Task 3.

**Files:**

- Modify: `src/hir/call-lowerer.ts`
- Modify: `src/hir/expression-lowerer.ts`
- Test: `tests/unit/hir/call-lowerer.test.ts`
- Test: `tests/integration/hir/typed-hir-proof-integration.test.ts`

**Acceptance Criteria:**

- Free function calls have `ownerTypeArgumentSource: "none"` and an empty owner argument list.
- Method calls derive owner arguments from the lowered receiver type.
- Constructor/object calls derive owner arguments from the expected constructed type or checked return type.
- Failed owner argument derivation records `ownerTypeArgumentSource: "error"` and keeps `recovered: true`.

**Code Examples:**

```ts
// tests/unit/hir/call-lowerer.test.ts
import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("method call records owner type arguments from receiver type", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      `
class Box[T]:
    value: T
    fn get(self) -> T:
        return self.value

fn main(box: Box[u8]) -> u8:
    return box.get()
`,
    ],
  ]);

  const callExpressions = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? [])
    .filter((expression) => expression.kind.kind === "call");
  const methodCall = callExpressions.at(-1)!;

  expect(methodCall.kind.kind).toBe("call");
  if (methodCall.kind.kind === "call") {
    expect(methodCall.kind.call.ownerTypeArgumentSource).toBe("receiverType");
    expect(methodCall.kind.call.ownerTypeArguments.map((type) => type.kind)).toEqual(["core"]);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/hir/call-lowerer.test.ts
bun test ./tests/integration/hir/typed-hir-proof-integration.test.ts
```

---

### Task 5: HIR Mono-Closure Surface Assembly

**Description:** Populate the `HirMonoClosureSurface` schema introduced by Task 3 from checked semantic facts, HIR type/field records, selected target records, certified platform bindings, and selected image roots.

**Dependencies:** Tasks 1, 2, 3, 4, and 6.

**Files:**

- Modify: `src/hir/typed-hir-builder.ts`
- Modify: `src/hir/image-lowerer.ts`
- Modify: `tests/support/hir/typed-hir-fixtures.ts`
- Test: `tests/unit/hir/typed-hir-fixtures.test.ts`
- Test: `tests/integration/hir/lower-typed-hir-orchestration.test.ts`
- Test: `tests/integration/hir/typed-hir-determinism.test.ts`

**Acceptance Criteria:**

- `TypedHirProgram.monoClosure` is always present in lowered HIR.
- `sourceTypeKinds` is built from HIR type records and checked resource kinds.
- `targetTypeKinds`, `constructorKindRules`, and `instanceEligibilityRules` are copied from `program.monoClosureFacts`.
- `certifiedPlatformBindings` is copied from `program.certifiedPlatformBindings`.
- `externalEntryRoots` includes the selected image entry root with concrete empty argument lists for non-generic entries.
- Generic image entries without concrete root arguments are represented as closure-surface roots whose missing type-argument slots contain `errorCheckedType()`. Mono then emits the authoritative closure diagnostic instead of HIR lowering inventing concrete arguments.

**Code Examples:**

```ts
// tests/integration/hir/lower-typed-hir-orchestration.test.ts
import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

test("typed HIR exposes mono closure surface for selected image", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn main() -> Never:\n    return\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);

  expect(result.program.monoClosure.externalEntryRoots.map((root) => root.reason)).toEqual([
    "imageEntry",
  ]);
  expect(result.program.monoClosure.sourceTypeKinds.entries()).toEqual([]);
  expect(result.program.monoClosure.certifiedPlatformBindings.entries()).toEqual([]);
});
```

```ts
// tests/integration/hir/lower-typed-hir-orchestration.test.ts
test("generic image entry root carries error-shaped closure arguments", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn main[T]() -> Never:\n    return\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);
  const root = result.program.monoClosure.externalEntryRoots[0]!;

  expect(root.reason).toBe("imageEntry");
  expect(root.functionTypeArguments.map((type) => type.kind)).toContain("error");
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/hir/typed-hir-fixtures.test.ts
bun test ./tests/integration/hir/lower-typed-hir-orchestration.test.ts
bun test ./tests/integration/hir/typed-hir-determinism.test.ts
```

---

### Task 6: HIR Platform Edge Lookup Index

**Description:** Add a deterministic lookup index for HIR platform contract edges by caller owner, call expression ID, and callee function ID. Mono uses this lookup to reject missing or duplicate certified platform edges deterministically.

**Dependencies:** Task 3.

**Files:**

- Modify: `src/hir/proof-metadata.ts`
- Modify: `src/hir/call-proof-metadata.ts`
- Test: `tests/unit/hir/proof-metadata.test.ts`
- Test: `tests/unit/hir/call-proof-metadata.test.ts`

**Acceptance Criteria:**

- The lookup uses the `HirPlatformContractEdgeLookupKey` type introduced by Task 3.
- `HirProofMetadata` exposes `platformContractEdgesByCall.get(key): readonly HirPlatformContractEdge[]`.
- Lookup returns all matching edges, not just one, so duplicate-edge diagnostics can be emitted by mono.
- Lookup order is deterministic by edge ID.
- Existing proof metadata table behavior remains unchanged.

**Code Examples:**

```ts
// tests/unit/hir/proof-metadata.test.ts
import { expect, test } from "bun:test";
import { HirProofMetadataBuilder } from "../../../src/hir/proof-metadata";
import { functionId } from "../../../src/semantic/ids";
import { hirExpressionId, ownedHirPlatformContractEdgeId } from "../../../src/hir/ids";

test("platform contract edges can be looked up by caller call and callee", () => {
  const builder = new HirProofMetadataBuilder();
  const owner = { kind: "function" as const, functionId: functionId(1) };
  builder.addPlatformContractEdge({
    edgeId: ownedHirPlatformContractEdgeId(owner, 0),
    sourceFunctionId: functionId(2),
    primitiveId: platformPrimitiveId("print"),
    contractId: platformContractId("print_contract"),
    targetId: targetId("uefi-aarch64"),
    callExpressionId: hirExpressionId(4),
    ensuredFacts: [],
    sourceOrigin: hirOriginId(0),
  });

  const metadata = builder.build();
  expect(
    metadata.platformContractEdgesByCall.get({
      owner,
      callExpressionId: hirExpressionId(4),
      calleeFunctionId: functionId(2),
    }).length,
  ).toBe(1);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/hir/proof-metadata.test.ts
bun test ./tests/unit/hir/call-proof-metadata.test.ts
```

---

### Task 7: Mono Diagnostics, IDs, And Deterministic Table Helpers

**Description:** Create the `src/mono` substrate: branded mono IDs, code-unit sorting, immutable deterministic table helpers, and diagnostic infrastructure with stable ordering and suppression keys.

**Dependencies:** None.

**Files:**

- Create: `src/mono/ids.ts`
- Create: `src/mono/deterministic-sort.ts`
- Create: `src/mono/diagnostics.ts`
- Create: `src/mono/index.ts`
- Test: `tests/unit/mono/diagnostics.test.ts`

**Acceptance Criteria:**

- `MonoInstanceId` is a branded string.
- Diagnostic severities include `"error"`, `"warning"`, and `"info"`.
- `MonoDiagnostic` includes `code`, `severity`, `message`, optional `sourceOrigin`, optional `span`, optional `moduleId`, optional `relatedInformation`, and a stable `order` object.
- Diagnostics sort by source span, owner key, diagnostic code, and stable detail using code-unit string comparison.
- Suppression keys use `(canonicalInstanceKey, diagnosticCode, rootCauseKey)`.
- `src/mono/index.ts` exports only substrate modules created in this task: IDs, deterministic sort helpers, and diagnostics. Later feature tasks import direct module paths until Task 24A owns the final public barrel.

Diagnostic registry table:

```text
Code                                      Severity  Category          Root cause key
MONO_MISSING_SELECTED_IMAGE               error     user-closure      image-selection
MONO_AMBIGUOUS_SELECTED_IMAGE             error     inconsistent-HIR  image-selection
MONO_SELECTED_IMAGE_NOT_FOUND             error     user-closure      image-selection
MONO_SELECTED_IMAGE_ENTRY_MISSING         error     user-closure      image-entry
MONO_MISSING_REACHABLE_FUNCTION           error     user-closure      source-function
MONO_MISSING_REACHABLE_TYPE               error     user-closure      source-type
MONO_MISSING_HIR_FIELD                    error     user-closure      source-field
MONO_MISSING_TARGET_TYPE_KIND             error     user-closure      target-type-kind
MONO_MISSING_CONSTRUCTOR_KIND_RULE        error     user-closure      constructor-kind-rule
MONO_REACHABLE_HIR_RECOVERY               error     user-closure      hir-recovery
MONO_GENERIC_ARITY_MISMATCH               error     user-closure      generic-arity
MONO_OWNER_TYPE_ARGUMENT_ARITY_MISMATCH   error     user-closure      owner-arity
MONO_OWNER_TYPE_ID_MISMATCH               error     inconsistent-HIR  owner-type-id
MONO_UNRESOLVED_TYPE_PARAMETER            error     user-closure      substitution
MONO_UNRESOLVED_RESOURCE_KIND             error     user-closure      resource-kind
MONO_MISSING_VALIDATED_BUFFER             error     user-closure      validated-buffer
MONO_INSTANCE_KIND_ELIGIBILITY_FAILED     error     user-closure      eligibility
MONO_RECURSIVE_FUNCTION_CYCLE             error     user-closure      recursion
MONO_RECURSIVE_TYPE_CYCLE                 error     user-closure      recursion
MONO_POLYMORPHIC_RECURSION                error     user-closure      polymorphic-recursion
MONO_DANGLING_PROOF_METADATA              error     user-closure      proof-metadata
MONO_INCONSISTENT_PROOF_METADATA          error     inconsistent-HIR  proof-metadata
MONO_UNRESOLVED_CALL_TARGET               error     user-closure      call-target
MONO_CERTIFIED_PLATFORM_BINDING_MISSING   error     user-closure      platform-binding
MONO_PLATFORM_CONTRACT_EDGE_MISSING       error     user-closure      platform-edge
MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE     error     inconsistent-HIR  platform-edge
MONO_PLATFORM_EDGE_BINDING_MISMATCH       error     inconsistent-HIR  platform-edge
MONO_INCONSISTENT_PLATFORM_ENSURED_FACT   error     inconsistent-HIR  platform-edge
MONO_PLATFORM_EDGE_UNRESOLVED_POLYMORPHISM error    user-closure      platform-edge
MONO_DUPLICATE_CANONICAL_INSTANCE_KEY     error     inconsistent-HIR  canonical-key
MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID  error     inconsistent-HIR  generic-parameter-order
```

Origin selection rules:

```text
image-selection diagnostics use pre-image owner key and the image/source origin when present
arity/substitution diagnostics use the call/type application origin that created the instance
resource-kind diagnostics use the field, parameter, target type, or constructor rule origin
recursion diagnostics use the rediscovering graph edge origin plus ancestor relatedInformation
proof metadata diagnostics use the body node or metadata record that references the bad proof ID
platform diagnostics use the call origin for call-site edges or binding origin for declaration mismatch
```

**Code Examples:**

```ts
// tests/unit/mono/diagnostics.test.ts
import { expect, test } from "bun:test";
import { monoDiagnostic, sortMonoDiagnostics } from "../../../src/mono/diagnostics";

test("mono diagnostics sort deterministically without locale comparison", () => {
  const diagnostics = [
    monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_SELECTED_IMAGE",
      message: "Missing selected image.",
      moduleId: moduleId(0),
      spanStart: 4,
      spanEnd: 5,
      ownerKey: "pre-image",
      rootCauseKey: "image",
      stableDetail: "b",
    }),
    monoDiagnostic({
      severity: "error",
      code: "MONO_MISSING_SELECTED_IMAGE",
      message: "Missing selected image.",
      moduleId: moduleId(0),
      spanStart: 4,
      spanEnd: 5,
      ownerKey: "pre-image",
      rootCauseKey: "image",
      stableDetail: "a",
    }),
  ];

  expect(
    sortMonoDiagnostics(diagnostics).map((diagnostic) => diagnostic.order.stableDetail),
  ).toEqual(["a", "b"]);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/diagnostics.test.ts
bun test ./tests/unit/hir/diagnostics.test.ts
```

---

### Task 8: Monomorphized HIR Schema

**Description:** Define the concrete monomorphized HIR model that mirrors current HIR with instance-scoped IDs, `MonoCheckedType`, concrete resource kinds, and instantiated proof IDs.

**Dependencies:** Task 7.

**Files:**

- Create: `src/mono/mono-hir.ts`
- Test: `tests/unit/mono/mono-hir.test.ts`

**Acceptance Criteria:**

- `MonomorphizedHirProgram`, `MonoFunctionInstance`, `MonoTypeInstance`, `MonoProofMetadata`, `MonoInstantiationGraph`, and remapped ID aliases are exported.
- `MonoCheckedType` is declared as an opaque branded `CheckedType`.
- `MonoDeterministicTable<Key, Value>` exposes `get` and `entries`.
- Mono statement, expression, block, requirement, proof, image, field, local, and validated-buffer schemas cover every current HIR record family.
- Schema does not include mutation APIs.
- The schema file exports coverage maps or discriminated union type aliases that force TypeScript to fail when a HIR statement, expression, or proof metadata family is missing from the mono model.

HIR coverage checklist:

```text
Statements: block, let, assignment, if, while, loop, for, match, validationMatch, take, return, yield, break, continue, expression, error
Expressions: literal, name, member, object, call, attempt, validationCreation, unary, binary, comparison, error
Proof metadata: obligations, sessions, brands, resourcePlaces, callSiteRequirements, validations, attempts, terminalCalls, privateStateTransitions, factOrigins, platformContractEdges, imageOrigins
Other executable records: image, imageDevice, typeInstance, field, validatedBuffer, local, requirement, proofExpression, resourcePlace
```

**Code Examples:**

```ts
// tests/unit/mono/mono-hir.test.ts
import { expect, test } from "bun:test";
import type {
  MonomorphizedHirProgram,
  MonoFunctionInstance,
  MonoTypeInstance,
  MonoProofMetadata,
} from "../../../src/mono/mono-hir";
import {
  MONO_EXPRESSION_KIND_COVERAGE,
  MONO_PROOF_METADATA_TABLE_COVERAGE,
  MONO_STATEMENT_KIND_COVERAGE,
} from "../../../src/mono/mono-hir";
import { HIR_EXPRESSION_KINDS, HIR_STATEMENT_KINDS } from "../../../src/hir";

type PublicMonoSmoke = {
  readonly program?: MonomorphizedHirProgram;
  readonly functionInstance?: MonoFunctionInstance;
  readonly typeInstance?: MonoTypeInstance;
  readonly proofMetadata?: MonoProofMetadata;
};

const acceptPublicMonoModel = (model: PublicMonoSmoke): PublicMonoSmoke => model;

test("mono schema types are exported from the schema module", () => {
  expect(acceptPublicMonoModel({})).toEqual({});
});

test("mono schema coverage maps stay exhaustive with HIR unions", () => {
  const statementKinds = Object.keys(MONO_STATEMENT_KIND_COVERAGE).sort();
  const expressionKinds = Object.keys(MONO_EXPRESSION_KIND_COVERAGE).sort();
  const proofTables = Object.keys(MONO_PROOF_METADATA_TABLE_COVERAGE).sort();

  expect(statementKinds).toEqual([...HIR_STATEMENT_KINDS].sort());
  expect(expressionKinds).toEqual([...HIR_EXPRESSION_KINDS].sort());
  expect(proofTables).toEqual([
    "attempts",
    "brands",
    "callSiteRequirements",
    "factOrigins",
    "imageOrigins",
    "obligations",
    "platformContractEdges",
    "privateStateTransitions",
    "resourcePlaces",
    "sessions",
    "terminalCalls",
    "validations",
  ]);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/mono-hir.test.ts
bun test ./tests/integration/hir/public-api.test.ts
```

---

### Task 9: Base Mono Test Fakes And Summary Helpers

**Description:** Add the base typed HIR and mono fixture helpers whose production types exist after Tasks 7, 8, and 10. Later tasks append specialized fixtures only after they introduce the production APIs those fixtures depend on. Tests should use fakes through dependency injection and avoid mocks.

**Dependencies:** Tasks 7, 8, and 10.

**Files:**

- Create: `tests/support/mono/monomorphization-fakes.ts`
- Create: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/monomorphization-fixtures.test.ts`

**Acceptance Criteria:**

- Base fixtures can build a minimal non-generic selected image HIR program.
- Base fixtures expose normalized mono core/source type helpers and canonical key helpers that depend only on Tasks 7, 8, and 10.
- Fixture helpers return deterministic IDs and table entry ordering independent of insertion order.
- `monoSummary(result)` accepts the structural mono result shape and returns JSON sorted by stable keys for determinism assertions.
- Fixtures do not use mocks, spies, `Bun.file`, or runtime dependencies.

Base fixture catalog:

```ts
// tests/support/mono/monomorphization-fixtures.ts
export function minimalSelectedImageProgramForMonoTest(options?: {
  readonly images?: readonly HirImage[];
  readonly functions?: readonly HirFunction[];
  readonly types?: readonly HirTypeRecord[];
  readonly fields?: readonly HirFieldRecord[];
}): TypedHirProgram;

export function monoCoreType(name: "u8" | "u32" | "bool" | "Never" | "void"): MonoCheckedType;
export function monoSourceTypeWithKind(kind: ConcreteResourceKind): MonoCheckedType;
export function normalizeOk(type: CheckedType): MonoCheckedType;
export function monoNormalizationContextFake(
  overrides?: Partial<MonoTypeNormalizationContext>,
): MonoTypeNormalizationContext;
export function monoTypeKeyForTest(input: {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
}): MonoTypeKey;
export function monoFunctionKeyForTest(input: {
  readonly functionId: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
}): MonoFunctionKey;
export function monoInstanceIdForTest(key: string): MonoInstanceId;

export function monoSummary(result: {
  readonly kind: "ok" | "error";
  readonly diagnostics: readonly MonoDiagnostic[];
  readonly reachablePlatformPrimitiveIds?: readonly PlatformPrimitiveId[];
  readonly program?: MonomorphizedHirProgram;
}): string;
```

Staged fixture additions:

```text
Task 12 adds: monoConcretizationContextFake, appliedSourceTypeForMonoTest
Task 13 adds: eligibilityRuleTableFake
Task 15 adds: genericBoxProgramForMonoTest, programWithDanglingTypeFieldForMonoTest, emptyMonoAncestryForTest
Task 16 adds: genericValidatedBufferProgramForMonoTest
Task 17 adds: genericIdentityFunctionProgramForMonoTest, bodylessRecoveryFunctionProgramForMonoTest
Task 18 adds: callIntoGenericFunctionProgramForMonoTest, errorExpressionBodyProgramForMonoTest, instantiateShellOk
Task 19A adds: minimalClosedProgramForMonoTest
Task 19B adds: twoCallSitesSameGenericInstanceProgramForMonoTest
Task 19C adds: mutualFunctionRecursionProgramForMonoTest
Task 20 adds: proofMetadataProgramForMonoTest
Task 21 adds: genericFunctionWithObligationProgramForMonoTest, danglingProofReferenceProgramForMonoTest
Task 22 adds: duplicatePlatformEdgesProgramForMonoTest, monomorphizedProgramWithPlatformEdgesForTest
Task 23 adds: unresolvedGenericAtBoundaryProgramForMonoTest
Task 24B adds: vendoredStdlibReachabilityProgramForMonoTest, replacementStdlibReachabilityProgramForMonoTest, packageModuleReachabilityProgramForMonoTest
Task 24C adds: shuffledClosedProgramForMonoTest
```

**Code Examples:**

```ts
export function monoSummary(result: {
  readonly kind: "ok" | "error";
  readonly diagnostics: readonly MonoDiagnostic[];
  readonly reachablePlatformPrimitiveIds?: readonly PlatformPrimitiveId[];
  readonly program?: MonomorphizedHirProgram;
}): string {
  return JSON.stringify({
    kind: result.kind,
    diagnostics: result.diagnostics.map((diagnostic) => diagnostic.code),
    primitiveIds:
      result.kind === "ok" ? (result.reachablePlatformPrimitiveIds ?? []).map(String) : [],
    functions:
      result.kind === "ok" && result.program !== undefined
        ? result.program.functions.entries().map((entry) => String(entry.instanceId))
        : [],
    types:
      result.kind === "ok" && result.program !== undefined
        ? result.program.types.entries().map((entry) => String(entry.instanceId))
        : [],
  });
}
```

```ts
// tests/unit/mono/monomorphization-fixtures.test.ts
import { expect, test } from "bun:test";
import { minimalSelectedImageProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

test("mono fixtures produce one selected image", () => {
  const program = minimalSelectedImageProgramForMonoTest();

  expect(program.images.entries()).toHaveLength(1);
  expect(program.images.entries()[0]?.entryFunctionId).toBeDefined();
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/monomorphization-fixtures.test.ts
bun run policy:check
```

---

### Task 10: MonoCheckedType Normalization And Canonical Keys

**Description:** Implement the only allowed `MonoCheckedType` factory plus canonical function/type key builders. These keys drive deterministic instance identity and deduplication.

**Dependencies:** Tasks 7 and 8.

**Files:**

- Create: `src/mono/instantiation-key.ts`
- Test: `tests/unit/mono/instantiation-key.test.ts`

**Acceptance Criteria:**

- `normalizeMonoCheckedType(type, context)` recursively rejects `genericParameter`, `error`, non-concrete applied resource kinds, missing reachable target type kinds, and missing constructor kind rules.
- The only `as MonoCheckedType` cast is inside the normalization factory.
- Canonical function keys include source function ID, owner type arguments, and function type arguments.
- Canonical function keys include `ownerTypeId?: TypeId` so method/constructor instances validate their owner identity before using owner type arguments.
- Canonical type keys include source type ID and concrete type arguments.
- Key segment serialization length-delimits checked type fingerprints and never parses fingerprint internals.
- `MonoInstanceId` values come from canonical key strings, not discovery order.
- Unit tests assert the compiler invariant that distinct checked type values used by mono fixtures produce distinct `checkedTypeFingerprint` strings, and key serialization length-delimits those opaque fingerprints.
- Unit tests scan `src/mono` and reject `as MonoCheckedType` casts outside `src/mono/instantiation-key.ts`.

**Code Examples:**

```ts
// tests/unit/mono/instantiation-key.test.ts
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  canonicalFunctionInstanceId,
  canonicalTypeInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "../../../src/mono/instantiation-key";

function normalizationContextForTask10Test(): MonoTypeNormalizationContext {
  const emptyTable = {
    get: () => undefined,
    has: () => false,
    entries: function* () {},
  };
  return {
    targetTypeKinds: emptyTable,
    constructorKindRules: emptyTable,
    sourceOrigin: hirOriginId(0),
  };
}

function normalizeOkForTask10Test(type: CheckedType): MonoCheckedType {
  const result = normalizeMonoCheckedType(type, normalizationContextForTask10Test());
  if (result.kind === "error") {
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.code).join(","));
  }
  return result.type;
}

test("normalization rejects nested generic parameter", () => {
  const result = normalizeMonoCheckedType(
    appliedType({
      constructor: { kind: "source", typeId: typeId(1) },
      arguments: [
        genericParameterCheckedType({ owner: { kind: "item", itemId: itemId(1) }, index: 0 }),
      ],
      resourceKind: concreteKind("Copy"),
    }),
    normalizationContextForTask10Test(),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "MONO_UNRESOLVED_TYPE_PARAMETER",
  );
});

test("canonical key length-delimits type fingerprints", () => {
  const u8 = normalizeOkForTask10Test(coreCheckedType(coreTypeId("u8")));
  const key = canonicalFunctionInstanceId({
    functionId: functionId(12),
    ownerTypeId: undefined,
    ownerTypeArguments: [],
    functionTypeArguments: [u8],
  });

  expect(String(key)).toBe("fn:12|ownerType:none|owner:<>|fn:<7:core:u8>");
});

test("checked type fingerprints used by mono fixture types are distinct", () => {
  const u8 = checkedTypeFingerprint(coreCheckedType(coreTypeId("u8")));
  const bool = checkedTypeFingerprint(coreCheckedType(coreTypeId("bool")));
  const sourceBox = checkedTypeFingerprint(
    sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
  );

  expect(new Set([u8, bool, sourceBox]).size).toBe(3);
});

test("MonoCheckedType casts exist only in the normalization factory", () => {
  const files = readdirSync("src/mono", { recursive: true })
    .filter((file) => typeof file === "string" && file.endsWith(".ts"))
    .map((file) => `src/mono/${file}`);
  const offenders = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    return file !== "src/mono/instantiation-key.ts" && source.includes("as MonoCheckedType");
  });

  expect(offenders).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/instantiation-key.test.ts
bun run policy:check
```

---

### Task 11: Mono Substitution Environment

**Description:** Implement a total mono substitution API that zips ordered HIR type parameter keys to concrete `MonoCheckedType` values and substitutes checked types, resource kinds, proof expressions, and requirement expressions.

**Dependencies:** Tasks 9 and 10.

**Files:**

- Create: `src/mono/substitution.ts`
- Test: `tests/unit/mono/substitution.test.ts`

**Acceptance Criteria:**

- Substitution keys include full `TypeParameterOwner`, so owner and function parameter index `0` cannot collide.
- Builder validates exact arity, duplicate keys, and out-of-order keys before body cloning.
- Checked type substitution recursively rewrites applied arguments and generic parameters.
- Resource-kind substitution rewrites `parametric` and `derived` kind arguments without concretizing them.
- Requirement and proof expression substitution preserves source origins and emits diagnostics for unresolved references.

**Code Examples:**

```ts
// tests/unit/mono/substitution.test.ts
import { expect, test } from "bun:test";
import { buildMonoSubstitution, substituteCheckedType } from "../../../src/mono/substitution";

test("owner and function type parameters do not collide", () => {
  const ownerParameter = { owner: { kind: "item" as const, itemId: itemId(1) }, index: 0 };
  const functionParameter = {
    owner: { kind: "function" as const, itemId: itemId(2), functionId: functionId(3) },
    index: 0,
  };
  const context = buildMonoSubstitution({
    ownerParameters: [ownerParameter],
    ownerArguments: [monoCoreType("u8")],
    functionParameters: [functionParameter],
    functionArguments: [monoCoreType("bool")],
    sourceOrigin: hirOriginId(0),
  });

  expect(substituteCheckedType(genericParameterCheckedType(ownerParameter), context).type).toEqual(
    monoCoreType("u8"),
  );
  expect(
    substituteCheckedType(genericParameterCheckedType(functionParameter), context).type,
  ).toEqual(monoCoreType("bool"));
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/substitution.test.ts
bun test ./tests/unit/hir/generic-inference.test.ts
```

---

### Task 12: Resource-Kind Concretization

**Description:** Implement resource-kind concretization over substituted checked types and `program.monoClosure`. The output must never store `parametric`, `derived`, or `error` kinds in reachable executable or proof-relevant records.

**Dependencies:** Tasks 5, 9, 10, and 11.

**Files:**

- Create: `src/mono/resource-kind-concretizer.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/resource-kind-concretizer.test.ts`

**Acceptance Criteria:**

- `concrete(K)` returns `K`.
- `parametric(P)` resolves through the mono substitution environment and computes the argument type's concrete kind.
- `"join"` concretizes each argument and uses `joinConcreteResourceKinds`.
- `"appliedConstructor"` uses the HIR constructor kind rule and its `resultKind`.
- `"fieldAggregation"` requests instantiated field kinds through an injected `FieldKindProvider`; Task 15 wires the provider to the active type-instantiation guard.
- `"targetDeclared"` reads from `program.monoClosure.targetTypeKinds`.
- `error` produces a closure diagnostic.
- Missing constructor or target kind data is an error diagnostic with the most specific available origin.
- This task appends `monoConcretizationContextFake` and `appliedSourceTypeForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

Provider API:

```ts
export interface FieldKindProvider {
  fieldKindsForType(input: {
    readonly typeId: TypeId;
    readonly typeArguments: readonly MonoCheckedType[];
    readonly sourceOrigin: HirOriginId;
  }): ConcretizeFieldKindsResult;
}

export type ConcretizeFieldKindsResult =
  | { readonly kind: "ok"; readonly fieldKinds: readonly ConcreteResourceKind[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export interface MonoResourceKindConcretizationContext {
  readonly program: TypedHirProgram;
  readonly substitution: MonoSubstitution;
  readonly fieldKindProvider: FieldKindProvider;
  readonly canonicalInstanceKey: string;
}
```

**Code Examples:**

```ts
// tests/unit/mono/resource-kind-concretizer.test.ts
import { expect, test } from "bun:test";
import { concretizeResourceKind } from "../../../src/mono/resource-kind-concretizer";

test("applied constructor uses HIR constructor rule instead of ordinary join", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("appliedConstructor", [concreteKind("Copy")]),
    appliedType: appliedSourceTypeForMonoTest({
      sourceTypeId: typeId(7),
      argumentKinds: [concreteKind("Copy")],
    }),
    context: monoConcretizationContextFake({
      constructorRule: {
        constructor: { kind: "source", typeId: typeId(7) },
        rule: "appliedConstructor",
        resultKind: concreteKind("ValidatedBuffer"),
        sourceOrigin: hirOriginId(0),
      },
    }),
  });

  expect(result).toEqual({ kind: "ok", value: "ValidatedBuffer" });
});

test("target declared kind requires HIR target kind data", () => {
  const result = concretizeResourceKind({
    kind: derivedKind("targetDeclared", []),
    targetTypeId: targetTypeId("mmio-register"),
    context: monoConcretizationContextFake(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") expect(result.diagnostic.code).toBe("MONO_MISSING_TARGET_TYPE_KIND");
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/resource-kind-concretizer.test.ts
bun test ./tests/unit/semantic/surface/resource-kind.test.ts
```

---

### Task 13: Instance Eligibility Checking

**Description:** Enforce explicit instance-level concrete resource-kind eligibility rules from `program.monoClosure.instanceEligibilityRules`.

**Dependencies:** Tasks 5, 9, 10, 11, and 12.

**Files:**

- Create: `src/mono/instance-eligibility.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/instance-eligibility.test.ts`

**Acceptance Criteria:**

- Empty eligibility table accepts every instance.
- Function-owned and type-owned eligibility rules are matched by source owner ID and `TypeParameterKey`.
- The checker evaluates the substituted argument's concrete resource kind.
- Failure emits `MONO_INSTANCE_KIND_ELIGIBILITY_FAILED` at the rule origin and includes the canonical instance key.
- Duplicate rules for the same owner/parameter are deterministic and both enforced.
- This task appends `eligibilityRuleTableFake` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/instance-eligibility.test.ts
import { expect, test } from "bun:test";
import { checkInstanceEligibility } from "../../../src/mono/instance-eligibility";

test("explicit eligibility rule rejects disallowed concrete resource kind", () => {
  const result = checkInstanceEligibility({
    owner: { kind: "function", functionId: functionId(4) },
    parameters: [
      { owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) }, index: 0 },
    ],
    arguments: [monoSourceTypeWithKind("Linear")],
    rules: eligibilityRuleTableFake([
      {
        owner: { kind: "function", functionId: functionId(4) },
        parameter: {
          owner: { kind: "function", itemId: itemId(4), functionId: functionId(4) },
          index: 0,
        },
        allowedConcreteKinds: ["Copy"],
        sourceOrigin: hirOriginId(0),
      },
    ]),
    canonicalInstanceKey: "fn:4|owner:<>|fn:<linear>",
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "MONO_INSTANCE_KIND_ELIGIBILITY_FAILED",
    ]);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/instance-eligibility.test.ts
```

---

### Task 14: Monomorphizer API And Image Root Seeding

**Description:** Implement the public `monomorphizeWholeImage` input/result types, image selection diagnostics, and deterministic root-seeding helpers used by the reachability algorithm. This task establishes the orchestration boundary and gives later graph construction a tested list of initial work items.

**Dependencies:** Tasks 5, 8, 9, and 10.

**Files:**

- Create: `src/mono/monomorphizer.ts`
- Test: `tests/unit/mono/reachability.test.ts`
- Test: `tests/integration/mono/whole-image-monomorphization.test.ts`

**Acceptance Criteria:**

- Public input type is `MonomorphizeWholeImageInput`.
- Public result type is `MonomorphizeWholeImageResult`.
- Omitted `imageId` requires exactly one HIR image.
- Missing image, ambiguous image, absent requested image, and selected image missing entry function return `kind: "error"`.
- `selectMonoImageRoot(input)` returns the selected image or sorted diagnostics without starting graph expansion.
- `seedMonoRootWork({ program, image })` returns deterministic work items for the selected image, image entry function, image device types, image-owned proof metadata, and external roots.
- Function root work items include `functionId`, `ownerTypeId`, concrete owner type arguments, and concrete function type arguments. For image entries and non-method external roots, `ownerTypeId` is absent and owner type arguments are empty.
- Diagnostics are sorted and suppressed through the Task 7 infrastructure.

**Code Examples:**

```ts
// tests/integration/mono/whole-image-monomorphization.test.ts
import { expect, test } from "bun:test";
import {
  monomorphizeWholeImage,
  seedMonoRootWork,
  selectMonoImageRoot,
} from "../../../src/mono/monomorphizer";
import { minimalSelectedImageProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

test("monomorphizer reports missing selected image before graph work", () => {
  const program = minimalSelectedImageProgramForMonoTest({ images: [] });
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "MONO_MISSING_SELECTED_IMAGE",
  ]);
});

test("root seeding returns deterministic initial work items", () => {
  const program = minimalSelectedImageProgramForMonoTest();
  const selected = selectMonoImageRoot({ program });

  expect(selected.kind).toBe("ok");
  if (selected.kind === "ok") {
    expect(seedMonoRootWork({ program, image: selected.image }).map((item) => item.kind)).toEqual([
      "imageProofMetadata",
      "function",
    ]);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/reachability.test.ts
bun test ./tests/integration/mono/whole-image-monomorphization.test.ts
```

---

### Task 15: Type Instance Construction

**Description:** Implement `MonoTypeInstance` construction for source types, including concrete type arguments, field type substitution, field kind concretization, source kind preservation, canonical key deduplication, and type graph edge recording.

**Dependencies:** Tasks 5, 8, 9, 10, 11, and 12.

**Files:**

- Create: `src/mono/type-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/type-instantiator.test.ts`

**Acceptance Criteria:**

- Source types and applied source constructors produce `MonoTypeKey`.
- Core and target checked types do not produce source type instances.
- Missing HIR type or field data emits closure diagnostics.
- Field types are substituted, normalized, and concretized before storage.
- Type instantiation implements the `FieldKindProvider` interface from Task 12 and passes the active DFS ancestry guard into field aggregation.
- Recursive source type expansion uses an ancestry guard supplied by reachability and reports a cycle rather than looping.
- Duplicate canonical keys reuse the existing instance and add graph edges only.
- This task appends `genericBoxProgramForMonoTest`, `programWithDanglingTypeFieldForMonoTest`, and `emptyMonoAncestryForTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/type-instantiator.test.ts
import { expect, test } from "bun:test";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";

test("generic source type instantiates field types with concrete arguments", () => {
  const program = genericBoxProgramForMonoTest();
  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.fields.map((field) => field.type.kind)).toEqual(["core"]);
    expect(result.instance.resourceKind).toBe("Copy");
  }
});

test("missing source field data is a closure error", () => {
  const result = instantiateMonoType({
    program: programWithDanglingTypeFieldForMonoTest(),
    key: monoTypeKeyForTest({ typeId: typeId(2), typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") expect(result.diagnostics[0]?.code).toBe("MONO_MISSING_HIR_FIELD");
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/type-instantiator.test.ts
bun test ./tests/unit/mono/resource-kind-concretizer.test.ts
```

---

### Task 16: Validated-Buffer Metadata Attachment

**Description:** Instantiate validated-buffer metadata as attached rows keyed by the canonical `MonoTypeInstance` for the validated-buffer source type.

**Dependencies:** Tasks 9 and 15.

**Files:**

- Modify: `src/mono/type-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/type-instantiator.test.ts`
- Test: `tests/integration/mono/generic-instantiation.test.ts`

**Acceptance Criteria:**

- Each reachable validated-buffer source type has one canonical `MonoTypeInstance`.
- `MonoHirValidatedBufferTable` entries reference the same `MonoInstanceId` as the type instance.
- Parameter, layout, derived, and requirement sections are substituted and normalized.
- Divergence between validated-buffer metadata and canonical type identity is rejected in tests.
- Non-validated-buffer source types do not create validated-buffer rows.
- The `MonoHirValidatedBufferTable` schema used here is fully declared by Task 8.
- This task appends `genericValidatedBufferProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/type-instantiator.test.ts
import { expect, test } from "bun:test";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";

test("validated buffer metadata attaches to canonical type instance", () => {
  const result = instantiateMonoType({
    program: genericValidatedBufferProgramForMonoTest(),
    key: monoTypeKeyForTest({
      typeId: typeId(10),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const buffer = result.validatedBuffer;
    expect(buffer?.instanceId).toBe(result.instance.instanceId);
    expect(buffer?.parameterFields.map((field) => field.type.kind)).toEqual(["core"]);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/type-instantiator.test.ts
bun test ./tests/integration/mono/generic-instantiation.test.ts
```

---

### Task 17: Function Signature, Local, And Requirement Instantiation

**Description:** Instantiate function-level records that do not require body traversal: signatures, receiver/parameters, return type, locals, declared requirements, certified platform body status, and canonical function identity.

**Dependencies:** Tasks 8, 9, 10, 11, and 12.

**Files:**

- Create: `src/mono/function-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/function-instantiator.test.ts`

**Acceptance Criteria:**

- Function keys validate owner and function argument arity using HIR ordered parameter lists.
- Function keys validate that `MonoFunctionKey.ownerTypeId` matches `HirFunction.ownerTypeId`; a mismatch emits `MONO_OWNER_TYPE_ID_MISMATCH`.
- `MonoFunctionInstance` stores source function ID, source item ID, owner type instance ID when present, owner arguments, function arguments, signature, locals, declared requirements, body status, and origin.
- Certified platform functions instantiate signature and requirements but do not require a body.
- Reachable `bodylessRecovery` functions emit closure diagnostics.
- Local IDs are remapped to `MonoLocalId` with the function instance ID.
- This task appends `genericIdentityFunctionProgramForMonoTest` and `bodylessRecoveryFunctionProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

Function-shell mapping table:

```text
HIR source                                      Mono field / behavior
HirFunction.functionId                         sourceFunctionId, canonical function key segment
HirFunction.itemId                             sourceItemId
HirFunction.ownerTypeId                        owner type identity validation and ownerTypeInstance lookup
HirFunction.declaredTypeParameters             function arity zip authority
HirTypeRecord.declaredTypeParameters            owner arity zip authority for methods/constructors
HirFunction.signature.receiver                 substituted, normalized Mono receiver when present
HirFunction.signature.parameters               substituted, normalized Mono parameters in checked order
HirFunction.signature.returnType/returnKind     substituted, normalized Mono return type and concrete return kind
HirFunction.locals                             MonoLocalTable with MonoLocalId = {hirId, instanceId}
HirFunction.declaredRequirements                substituted MonoRequirement records
HirFunction.bodyStatus certifiedPlatform        accepted without body clone
HirFunction.bodyStatus bodylessRecovery         MONO_REACHABLE_HIR_RECOVERY
HirFunction.sourceOrigin                        sourceOrigin
owner type instance                             ownerTypeInstanceId plus ownerTypeArguments when present
```

**Code Examples:**

```ts
// tests/unit/mono/function-instantiator.test.ts
import { expect, test } from "bun:test";
import { instantiateMonoFunctionShell } from "../../../src/mono/function-instantiator";

test("generic function signature and locals are instantiated", () => {
  const result = instantiateMonoFunctionShell({
    program: genericIdentityFunctionProgramForMonoTest(),
    key: monoFunctionKeyForTest({
      functionId: functionId(3),
      ownerTypeArguments: [],
      functionTypeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.signature.returnType.kind).toBe("core");
    expect(result.instance.locals.entries().map((local) => local.type.kind)).toEqual(["core"]);
  }
});

test("reachable bodyless recovery function is rejected", () => {
  const result = instantiateMonoFunctionShell({
    program: bodylessRecoveryFunctionProgramForMonoTest(),
    key: monoFunctionKeyForTest({
      functionId: functionId(4),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error")
    expect(result.diagnostics[0]?.code).toBe("MONO_REACHABLE_HIR_RECOVERY");
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/function-instantiator.test.ts
bun test ./tests/unit/mono/substitution.test.ts
```

---

### Task 18: Function Body Cloning And Call Edge Extraction

**Description:** Clone source-body HIR statements and expressions into mono body records, remap instance-scoped IDs, normalize every stored type, concretize every stored resource kind, reject recovery nodes, and extract outgoing function/type/proof work edges.

**Dependencies:** Tasks 9 and 17.

**Files:**

- Modify: `src/mono/function-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/function-instantiator.test.ts`
- Test: `tests/integration/mono/generic-instantiation.test.ts`

**Acceptance Criteria:**

- Every current `HirStatementKind` has a mono clone path or a recovery diagnostic path.
- Every current `HirExpressionKind` has a mono clone path or a recovery diagnostic path.
- Call expressions with concrete callee and owner/function arguments emit outgoing function edges.
- Calls through unresolved or recovered HIR call targets emit closure diagnostics and no speculative edge.
- Every cloned expression/local/requirement type is a `MonoCheckedType`.
- Every cloned resource kind is a `ConcreteResourceKind`.
- The implementation exports statement/expression clone coverage maps that are checked against `HIR_STATEMENT_KINDS` and `HIR_EXPRESSION_KINDS`.
- This task appends `callIntoGenericFunctionProgramForMonoTest`, `errorExpressionBodyProgramForMonoTest`, and `instantiateShellOk` to `tests/support/mono/monomorphization-fixtures.ts`.

Body clone mapping table:

```text
Statement kind      Clone behavior
block               clone child statements and remap block origin
let                 remap local, clone optional value expression
assignment          clone target/value and remap targetPlace
if                  clone condition, thenBlock, optional elseBlock
while               clone condition and body
loop                clone body
for                 remap binding, clone iterable, instantiate iteration proof IDs
match               clone scrutinee, arms, arm locals, and arm bodies
validationMatch     remap validation ID, clone scrutinee, arms, validation payloads
take                remap take operand, session/brand/obligation proof IDs, alias local, body
return/yield        clone optional expression
break/continue      copy source origin only
expression          clone expression
error               MONO_REACHABLE_HIR_RECOVERY

Expression kind       Clone behavior
literal               copy literal, normalize type, concretize kind
name                  remap local/function/parameter references
member                clone receiver, remap field and member place
object                remap type ID and clone field values
call                  clone callee/arguments/receiver, extract function/platform edge
attempt               remap attempt proof IDs and child expressions
validationCreation    remap validation proof IDs and child expressions
unary                 clone operand
binary/comparison     clone left and right expressions
error                 MONO_REACHABLE_HIR_RECOVERY
```

**Code Examples:**

```ts
// tests/unit/mono/function-instantiator.test.ts
import { expect, test } from "bun:test";
import { instantiateMonoFunctionBody } from "../../../src/mono/function-instantiator";

test("body instantiation remaps expression ids and extracts call edge", () => {
  const shell = instantiateShellOk(callIntoGenericFunctionProgramForMonoTest());
  const body = instantiateMonoFunctionBody({
    program: callIntoGenericFunctionProgramForMonoTest(),
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
  });

  expect(body.kind).toBe("ok");
  if (body.kind === "ok") {
    expect(body.body.statements).toHaveLength(1);
    expect(body.outgoingEdges.map((edge) => edge.targetKind)).toContain("function");
    expect(body.outgoingEdges[0]?.source.kind).toBe("function");
  }
});

test("reachable error expression is a closure error", () => {
  const body = instantiateMonoFunctionBody(errorExpressionBodyProgramForMonoTest());

  expect(body.kind).toBe("error");
  if (body.kind === "error") expect(body.diagnostics[0]?.code).toBe("MONO_REACHABLE_HIR_RECOVERY");
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/function-instantiator.test.ts
bun test ./tests/integration/mono/generic-instantiation.test.ts
```

---

### Task 19A: Reachability DFS Skeleton And Minimal Closed Image

**Description:** Implement the first end-to-end reachability slice: selected image root seeding, deterministic DFS over non-recursive work items, and a closed non-generic image without proof metadata table instantiation.

**Dependencies:** Tasks 14, 15, 16, and 18.

**Files:**

- Create: `src/mono/reachability.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/reachability.test.ts`
- Test: `tests/integration/mono/whole-image-monomorphization.test.ts`

**Acceptance Criteria:**

- Image root seeding adds image metadata, entry function, image field/device types, image-owned proof metadata, and external roots.
- DFS sorts outgoing edges by canonical edge key before recursion.
- A minimal non-generic selected image with source-body functions and ordinary source types returns `kind: "ok"` with closed function/type/validated-buffer tables, an instantiation graph, empty proof metadata tables, and no reachable platform primitive IDs.
- This task appends `minimalClosedProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/reachability.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("minimal non-generic image closes before proof and platform phases", () => {
  const result = monomorphizeWholeImage({ program: minimalClosedProgramForMonoTest() });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().length).toBeGreaterThan(0);
    expect(result.program.types.entries()).toEqual([]);
    expect(result.program.proofMetadata.obligations.entries()).toEqual([]);
    expect(result.reachablePlatformPrimitiveIds).toEqual([]);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/reachability.test.ts
bun test ./tests/integration/mono/whole-image-monomorphization.test.ts
```

---

### Task 19B: Reachability Dedupe And Instantiation Graph Edges

**Description:** Add canonical instance deduplication and retained instantiation graph edges for repeated discoveries of the same concrete function/type instance.

**Dependencies:** Task 19A.

**Files:**

- Modify: `src/mono/reachability.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/reachability.test.ts`
- Test: `tests/integration/mono/generic-instantiation.test.ts`

**Acceptance Criteria:**

- Completed function/type instances are reused by canonical key.
- Later discoveries add graph edges only and do not duplicate instance bodies.
- Output function, type, and graph edge tables are sorted by canonical key, not discovery order.
- This task appends `twoCallSitesSameGenericInstanceProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/reachability.test.ts
test("two call sites dedupe to one generic function instance and retain two graph edges", () => {
  const result = monomorphizeWholeImage({
    program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const identityInstances = result.program.functions
      .entries()
      .filter((entry) => entry.sourceFunctionId === functionId(9));
    const incomingEdges = result.program.instantiationGraph.edges.filter(
      (edge) => edge.targetInstanceId === identityInstances[0]?.instanceId,
    );

    expect(identityInstances).toHaveLength(1);
    expect(incomingEdges).toHaveLength(2);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/reachability.test.ts
bun test ./tests/integration/mono/generic-instantiation.test.ts
```

---

### Task 19C: Reachability Recursion And SCC Validation

**Description:** Add DFS gray-state recursion rejection, polymorphic recursion diagnostics, recursive source type cycle diagnostics, and deterministic SCC/topological validation over the retained graph.

**Dependencies:** Task 19B.

**Files:**

- Modify: `src/mono/reachability.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/reachability.test.ts`
- Test: `tests/integration/mono/closed-boundary-rejection.test.ts`

**Acceptance Criteria:**

- Each function/type key has state `"unseen"`, `"inProgress"`, or `"completed"`.
- Rediscovering an in-progress function key reports `MONO_RECURSIVE_FUNCTION_CYCLE`.
- Rediscovering the same source function/type with a different concrete type vector on the active path reports `MONO_POLYMORPHIC_RECURSION`.
- Type work items use the same ancestry guard and report `MONO_RECURSIVE_TYPE_CYCLE` for source type instantiation cycles.
- SCC validation rejects any retained function/type self-edge or multi-node cycle.
- This task appends `mutualFunctionRecursionProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/reachability.test.ts
test("mutual function recursion is rejected", () => {
  const result = monomorphizeWholeImage({ program: mutualFunctionRecursionProgramForMonoTest() });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "MONO_RECURSIVE_FUNCTION_CYCLE",
  );
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/reachability.test.ts
bun test ./tests/integration/mono/closed-boundary-rejection.test.ts
```

---

### Task 20: Proof Metadata Owner Indexes And Remap APIs

**Description:** Build owner-scoped proof metadata indexes and instance remap helpers. These APIs let function/type/image instantiation reference global HIR proof records deterministically without scanning arbitrary tables during body cloning.

**Dependencies:** Tasks 8, 9, 10, and 11.

**Files:**

- Create: `src/mono/proof-metadata-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/proof-metadata-instantiator.test.ts`

**Acceptance Criteria:**

- `buildProofMetadataIndex(program.proofMetadata)` indexes every table by `HirProofOwner`.
- `MonoRemapIndex` maps HIR local/expression/statement IDs to mono IDs and HIR-owned proof IDs to instantiated proof IDs.
- Missing owner records return structured diagnostics instead of throwing.
- Owner-mismatched records produce `MONO_DANGLING_PROOF_METADATA`.
- Image-owned records can be instantiated once for the selected image instance key.
- This task appends `proofMetadataProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/proof-metadata-instantiator.test.ts
import { expect, test } from "bun:test";
import {
  buildProofMetadataIndex,
  createMonoRemapIndex,
} from "../../../src/mono/proof-metadata-instantiator";

test("proof metadata index groups records by owner", () => {
  const program = proofMetadataProgramForMonoTest();
  const index = buildProofMetadataIndex(program.proofMetadata);
  const functionRecords = index.recordsForOwner({ kind: "function", functionId: functionId(3) });

  expect(functionRecords.resourcePlaces).toHaveLength(1);
  expect(functionRecords.obligations).toHaveLength(1);
});

test("remap pairs proof id with owner and mono instance id", () => {
  const remap = createMonoRemapIndex({ instanceId: monoInstanceIdForTest("fn:3|owner:<>|fn:<>") });
  const proofId = remap.proof(ownedObligationId(functionId(3), 0));

  expect(proofId.hirOwner).toEqual({ kind: "function", functionId: functionId(3) });
  expect(proofId.hirId).toBe(obligationId(0));
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/proof-metadata-instantiator.test.ts
```

---

### Task 21: Proof Metadata Table Instantiation

**Description:** Instantiate every HIR proof metadata table into `MonoProofMetadata`, substituting types, concretizing resource kinds, remapping body/proof IDs, and rejecting dangling or inconsistent references.

**Dependencies:** Tasks 17, 19C, and 20.

**Files:**

- Modify: `src/mono/proof-metadata-instantiator.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/proof-metadata-instantiator.test.ts`
- Test: `tests/integration/mono/proof-metadata-instantiation.test.ts`

**Acceptance Criteria:**

- Resource places, obligations, sessions, brands, call-site requirements, validations, attempts, terminal calls, private-state transitions, fact origins, platform contract edges, and image origins are instantiated.
- `InstantiatedProofId.hirId` stores the bare proof ID value, not `HirOwnedId<T>`.
- Function-owned records are instantiated only for reachable function instances.
- Type-owned records are instantiated only for reachable type instances.
- Image-owned records are instantiated once for the selected image instance.
- Inline body proof references must agree with global `program.proofMetadata` records.
- Missing or owner-mismatched proof metadata references are closure errors.
- This task appends `genericFunctionWithObligationProgramForMonoTest` and `danglingProofReferenceProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

Proof metadata mapping table:

```text
HIR table                    Mono table                    Substitution/remap rule
obligations                  obligations                   instantiate obligationId; remap optional place
sessions                     sessions                      instantiate sessionId; remap optional place
brands                       brands                        instantiate function-owned brands; preserve image/platform canonical origin
resourcePlaces               resourcePlaces                substitute type; concretize resourceKind; remap local/parameter/field roots
callSiteRequirements         callSiteRequirements          instantiate requirement ID; remap callExpressionId; substitute proof expression
validations                  validations                   remap validationExpressionId, sourcePlace, pendingResultPlace, resultLocalId, payload types
attempts                     attempts                      remap attemptExpressionId, fallible/alternative expressions, input places
terminalCalls                terminalCalls                 remap callExpressionId and closureObligationId
privateStateTransitions      privateStateTransitions       remap private-state place and preserve transition kind/ordinal
factOrigins                  factOrigins                   substitute predicate arguments; remap ensure/platform/match references
platformContractEdges        platformContractEdges         remap source requirement IDs and callExpressionId; substitute ensured facts
imageOrigins                 imageOrigins                  instantiate once for selected image; preserve image/device IDs
```

**Code Examples:**

```ts
// tests/integration/mono/proof-metadata-instantiation.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("same generic function proof ids are distinct per concrete instance", () => {
  const result = monomorphizeWholeImage({
    program: genericFunctionWithObligationProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const obligationIds = result.program.proofMetadata.obligations
      .entries()
      .map((entry) => `${entry.obligationId.hirId}:${entry.obligationId.instanceId}`);

    expect(new Set(obligationIds).size).toBe(obligationIds.length);
    expect(obligationIds.length).toBeGreaterThan(1);
  }
});

test("dangling proof metadata reference is rejected", () => {
  const result = monomorphizeWholeImage({ program: danglingProofReferenceProgramForMonoTest() });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "MONO_DANGLING_PROOF_METADATA",
  );
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/proof-metadata-instantiator.test.ts
bun test ./tests/integration/mono/proof-metadata-instantiation.test.ts
```

---

### Task 22: Platform Primitive Retention

**Description:** Retain reachable platform primitive IDs only through certified platform function bindings and matching caller-owned mono platform contract edges.

**Dependencies:** Tasks 19C and 21.

**Files:**

- Create: `src/mono/platform-primitives.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/platform-primitives.test.ts`
- Test: `tests/integration/mono/platform-primitive-reachability.test.ts`

**Acceptance Criteria:**

- Reachable calls to certified platform functions look up HIR edges by `(caller owner, callExpressionId, calleeFunctionId)`.
- Missing binding, missing edge, duplicate edge, or edge/binding mismatch emits closure diagnostics.
- Platform edges instantiate source requirement IDs and ensured facts only after binding consistency succeeds.
- Certified platform functions are graph leaves and do not add body call edges.
- External entry roots cannot be certified platform functions in v1.
- `reachablePlatformPrimitiveIds` is derived from mono platform contract edges, sorted, deduped, and verified against the output proof metadata table.
- This task appends `duplicatePlatformEdgesProgramForMonoTest` and `monomorphizedProgramWithPlatformEdgesForTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/unit/mono/platform-primitives.test.ts
import { expect, test } from "bun:test";
import { collectReachablePlatformPrimitiveIds } from "../../../src/mono/platform-primitives";

test("reachable primitive ids are derived from mono platform edges", () => {
  const program = monomorphizedProgramWithPlatformEdgesForTest(["z_write", "a_read", "z_write"]);
  const primitiveIds = collectReachablePlatformPrimitiveIds(program);

  expect(primitiveIds.map(String)).toEqual(["a_read", "z_write"]);
});

test("duplicate HIR platform edges for one call are rejected", () => {
  const result = monomorphizeWholeImage({ program: duplicatePlatformEdgesProgramForMonoTest() });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE",
  );
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/platform-primitives.test.ts
bun test ./tests/integration/mono/platform-primitive-reachability.test.ts
```

---

### Task 23: Closed-Boundary Checker And Diagnostic Suppression

**Description:** Implement the final closed-boundary scan and hard error result behavior. This checker validates that no unresolved polymorphism, unresolved resource kind, recovery node, recursion edge, dangling proof record, or platform inconsistency survives in closed output.

**Dependencies:** Tasks 13, 19C, 21, and 22.

**Files:**

- Create: `src/mono/closed-boundary-checker.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `src/mono/diagnostics.ts`
- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/unit/mono/closed-boundary-checker.test.ts`
- Test: `tests/integration/mono/closed-boundary-rejection.test.ts`

**Acceptance Criteria:**

- The checker scans function signatures, locals, expressions, statements, fields, requirements, proof expressions, proof facts, resource places, validations, attempts, terminal calls, private-state transitions, platform ensured facts, and image metadata.
- Any nested `genericParameter`, `error` type, `parametric`, `derived`, or `error` resource kind is an error.
- Any source type field needed by a reachable type but missing from `program.fields` is an error.
- Any reachable HIR recovery node or `bodylessRecovery` function is an error.
- Any unresolved call target or generic call/type construction without concrete arguments is an error.
- Error diagnostics return `kind: "error"` with no `MonomorphizedHirProgram`.
- Duplicate downstream diagnostics with the same root cause are suppressed and related context is retained.
- This task appends `unresolvedGenericAtBoundaryProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/integration/mono/closed-boundary-rejection.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("unresolved generic type parameter at boundary is rejected once per root cause", () => {
  const result = monomorphizeWholeImage({
    program: unresolvedGenericAtBoundaryProgramForMonoTest(),
  });

  expect(result.kind).toBe("error");
  const unresolved = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "MONO_UNRESOLVED_TYPE_PARAMETER",
  );

  expect(unresolved).toHaveLength(1);
  expect(unresolved[0]?.relatedInformation?.length).toBeGreaterThan(0);
});

test("successful result contains no error diagnostics", () => {
  const result = monomorphizeWholeImage({
    program: minimalClosedProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/unit/mono/closed-boundary-checker.test.ts
bun test ./tests/integration/mono/closed-boundary-rejection.test.ts
```

---

### Task 24A: Public API Barrels

**Description:** Wire the completed mono phase into public exports without adding new behavior. This is intentionally separate from integration coverage so public API work can land without modifying shared integration scenario files.

**Dependencies:** Task 23.

**Files:**

- Modify: `src/index.ts`
- Modify: `src/mono/index.ts`
- Test: `tests/integration/mono/public-api.test.ts`

**Acceptance Criteria:**

- `src/mono/index.ts` exports the public monomorphizer entry point and stable public result types.
- `src/index.ts` exports the mono namespace as `wrela.mono`.
- `monomorphizeWholeImage` is reachable from both `../../../src/mono` and `../../../src`.
- No task-private helper from `src/mono/*` is exported unless an earlier task explicitly marked it as public.
- This task does not edit scenario integration tests.

**Code Examples:**

```ts
// tests/integration/mono/public-api.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono";
import * as wrela from "../../../src";

test("whole-image monomorphization is public API", () => {
  expect(typeof monomorphizeWholeImage).toBe("function");
  expect(typeof wrela.mono.monomorphizeWholeImage).toBe("function");
});
```

**Verification Commands:**

```bash
bun test ./tests/integration/mono/public-api.test.ts
```

---

### Task 24B: Whole-Image Integration Coverage

**Description:** Add end-to-end integration coverage for the design's required whole-image scenarios using concrete fixtures. This task validates that completed compiler phases compose correctly without changing public API barrels or determinism property tests.

**Dependencies:** Task 23.

**Files:**

- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/integration/mono/whole-image-monomorphization.test.ts`
- Test: `tests/integration/mono/generic-instantiation.test.ts`
- Test: `tests/integration/mono/proof-metadata-instantiation.test.ts`
- Test: `tests/integration/mono/platform-primitive-reachability.test.ts`
- Test: `tests/integration/mono/closed-boundary-rejection.test.ts`

**Acceptance Criteria:**

- Integration tests cover ordinary project function reachability, generic function instantiation, generic type instantiation, owner method instantiation, dedupe with multiple graph edges, proof metadata cloning, platform primitive retention, unresolved polymorphism rejection, and recursion rejection.
- Integration tests cover project code reaching vendored stdlib declarations, replacement stdlib declarations, and package module declarations as ordinary HIR declarations.
- Mono implementation contains no special authority, package-path, vendored-stdlib, replacement-stdlib, or package-module reachability branch; those cases are accepted because they are reachable HIR declarations.
- `reachablePlatformPrimitiveIds` matches the primitive IDs present in mono platform contract edges.
- This task appends `vendoredStdlibReachabilityProgramForMonoTest`, `replacementStdlibReachabilityProgramForMonoTest`, and `packageModuleReachabilityProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.

**Code Examples:**

```ts
// tests/integration/mono/whole-image-monomorphization.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("project function reaches vendored stdlib declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: vendoredStdlibReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(700),
    );
  }
});

test("project function reaches replacement stdlib declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: replacementStdlibReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(710),
    );
  }
});

test("project function reaches package module declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: packageModuleReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(720),
    );
  }
});
```

```ts
// tests/integration/mono/platform-primitive-reachability.test.ts
import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("reachable primitive ids match instantiated platform contract edges", () => {
  const result = monomorphizeWholeImage({
    program: monomorphizedProgramWithPlatformEdgesForTest(["clock_read", "event_send"]),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const edgePrimitiveIds = result.program.proofMetadata.platformContractEdges
      .entries()
      .map((edge) => edge.platformPrimitiveId)
      .sort();

    expect(result.program.reachablePlatformPrimitiveIds).toEqual(edgePrimitiveIds);
  }
});
```

**Verification Commands:**

```bash
bun test ./tests/integration/mono/whole-image-monomorphization.test.ts
bun test ./tests/integration/mono/generic-instantiation.test.ts
bun test ./tests/integration/mono/proof-metadata-instantiation.test.ts
bun test ./tests/integration/mono/platform-primitive-reachability.test.ts
bun test ./tests/integration/mono/closed-boundary-rejection.test.ts
```

---

### Task 24C: Determinism Property Tests And Final Verification

**Description:** Prove deterministic output with property-based shuffled table construction and run the final repository handoff check. This task is the final execution gate after public API and scenario coverage are complete.

**Dependencies:** Tasks 24A and 24B.

**Files:**

- Modify: `tests/support/mono/monomorphization-fixtures.ts`
- Test: `tests/integration/mono/monomorphization-determinism.test.ts`

**Acceptance Criteria:**

- Determinism coverage uses `fast-check`, not two hand-picked seeds.
- Equivalent shuffled HIR table construction always produces the same `monoSummary` for at least 50 generated seeds.
- The fixture helper creates semantically equivalent programs by changing insertion order only; it must not change function bodies, IDs, image roots, proof metadata content, or platform edges.
- This task appends `shuffledClosedProgramForMonoTest` to `tests/support/mono/monomorphization-fixtures.ts`.
- `bun run agent:check` passes after Tasks 24A and 24B are present.

**Code Examples:**

```ts
// tests/integration/mono/monomorphization-determinism.test.ts
import { expect, test } from "bun:test";
import fc from "fast-check";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import {
  monoSummary,
  shuffledClosedProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

test("monomorphized output is deterministic for shuffled equivalent HIR tables", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 10_000 }), (seed) => {
      const baseline = monomorphizeWholeImage({
        program: shuffledClosedProgramForMonoTest(0),
      });
      const shuffled = monomorphizeWholeImage({
        program: shuffledClosedProgramForMonoTest(seed),
      });

      expect(monoSummary(shuffled)).toBe(monoSummary(baseline));
    }),
    { numRuns: 50 },
  );
});
```

**Verification Commands:**

```bash
bun test ./tests/integration/mono/monomorphization-determinism.test.ts
bun test ./tests/integration/mono/public-api.test.ts
bun test ./tests/integration/mono/whole-image-monomorphization.test.ts
bun test ./tests/integration/mono/generic-instantiation.test.ts
bun test ./tests/integration/mono/proof-metadata-instantiation.test.ts
bun test ./tests/integration/mono/platform-primitive-reachability.test.ts
bun test ./tests/integration/mono/closed-boundary-rejection.test.ts
bun run agent:check
```

---

## Self-Review

Spec coverage:

- HIR closure-surface prerequisite is covered by Tasks 1-6.
- Monomorphized HIR schema and deterministic tables are covered by Tasks 7-10.
- Substitution, resource-kind concretization, and instance eligibility are covered by Tasks 11-13.
- Image root seeding, function/type construction, validated buffers, dedupe, reachability, recursion rejection, and SCC validation are covered by Tasks 14-19.
- Proof metadata instantiation is covered by Tasks 20-21.
- Platform primitive retention is covered by Task 22.
- Closed-boundary hard errors and diagnostic suppression are covered by Task 23.
- Public API, whole-image integration coverage, and determinism coverage are split across Tasks 24A-24C.

Placeholder scan:

- This plan contains no open-ended research tasks.
- Every task has concrete files, acceptance criteria, code examples, and verification commands.
- Each task produces testable software behavior on completion.

Type consistency:

- `MonoInstanceId`, `MonoCheckedType`, `MonoFunctionInstance`, `MonoTypeInstance`, `MonoProofMetadata`, `MonoRemapIndex`, `HirMonoClosureSurface`, and `HirPlatformContractEdgeLookupKey` are used consistently with the design.
- Function/type canonical keys always use normalized `MonoCheckedType` arguments.
- Proof IDs are consistently represented as `(hirOwner, bare hirId, instanceId)` in mono records.
