# Proof MIR Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Proof MIR builder described in `docs/design/proof-mir-builder-design.md`, including the small upstream mono/runtime prerequisites, deterministic Proof MIR model construction, lowering, structural validation, public API, and integration tests.

**Architecture:** Proof MIR is a pure compiler phase between closed monomorphized HIR and proof checking. The builder consumes `MonomorphizedHirProgram`, `LayoutFactProgram`, and a selected closed runtime catalog, emits canonical-keyed draft records while lowering each source-bodied function, freezes those records into dense deterministic IDs, and validates the frozen graph before returning it. Runtime catalog authority stays in `src/runtime`, target/runtime selection stays in `src/target`, and the builder never reads the filesystem or re-solves name resolution, monomorphization, layout, proof checking, or target lowering.

**Tech Stack:** TypeScript, Bun test runner, existing mono/layout/HIR models, dependency-injected fakes in tests, no new runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- The design source is `docs/design/proof-mir-builder-design.md`. It is currently untracked in the working tree; implementation tasks must treat it as input and not rewrite it.
- There is no `src/proof-mir` directory yet. This plan creates the full directory shape from the design.
- There is no `src/runtime` or `src/target` directory yet. Proof MIR needs only minimal runtime catalog and target selection interfaces, not target code generation.
- `MonomorphizedHirProgram` currently has `image`, `functions`, `types`, `validatedBuffers`, `proofMetadata`, `instantiationGraph`, `origins`, and `reachablePlatformPrimitiveIds`. It does not yet have `externalRoots`.
- Typed HIR already has `program.monoClosure.externalEntryRoots`; the mono prerequisite task should instantiate these into `program.externalRoots`.
- `MonoCallExpression` currently stores `calleeFunctionId`, owner/function type arguments, and call arguments. It does not store the concrete `resolvedTarget` required by the Proof MIR call-lowering contract.
- Mono reachability already resolves certified platform calls through `proofMetadata.platformContractEdgesByCall` and emits reachable `MonoPlatformContractEdge` records. The prerequisite should persist that concrete edge ID on the cloned call instead of making Proof MIR reconstruct the edge.
- `MonoPlatformContractEdge` currently stores source function, primitive, contract, target, optional call expression, and ensured facts. The Proof MIR contract requires enough instantiated owner/function type argument evidence, or a monomorphic key, to validate platform edge identity without re-running substitution.
- `MonoFunctionInstance.bodyIndex` already exists and is the correct source for expression/statement lookups in lowerers and tests. Reachable source-body lowering should use `bodyIndex` when present; if a reachable source-body function lacks it, the builder should fail closed with `PROOF_MIR_MISSING_FUNCTION_BODY` rather than scanning source text or rebuilding an index.
- `LayoutFactProgram` already exposes deterministic layout tables with `get`, `has`, `entries`, and `keyString`. Use those APIs for input compatibility and layout term path resolution.
- `LayoutTerm` already represents recursive source-length, field-value, derived-value, constant, and arithmetic terms. Proof MIR layout-term references must point into layout-owned arrays by root plus `childPath`; they must not use display strings as authority.
- Existing mono/layout fixture helpers live in `tests/support/mono/monomorphization-fixtures.ts` and `tests/support/layout/layout-fixtures.ts`. New Proof MIR fixtures should build on them instead of creating a second independent fake compiler pipeline.
- `scripts/check-policy.ts` already owns repository-wide import and naming policy checks. Task 35 should add the exact Proof MIR import-boundary rules there, not create a parallel policy script.
- In this Codex shell, Bun may need the prefix `PATH="$HOME/.bun/bin:$PATH"`. All `bun ...` commands in this plan may be run with that prefix when `bun` is not already on `PATH`.
- Required repository handoff command from `agents.md`:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

- Useful narrow commands while iterating:

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/ids.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/draft-keys.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/graph-ssa.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/call-targets.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/layout-binding-index.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/graph-validator.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-mir/proof-mir-builder.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-mir/determinism.test.ts
```

## Executor Protocol

Every task below is atomic for one worker. Before starting a task, copy this checklist into that task's work notes and check off each item.

- [ ] Read the task description, dependencies, file list, acceptance criteria, code examples, and verification commands.
- [ ] Confirm every dependency task has landed.
- [ ] Confirm no same-wave task owns the same production files.
- [ ] Write the failing test from the task's code example in the task-owned test file.
- [ ] Run the narrow verification command, with `PATH="$HOME/.bun/bin:$PATH"` if needed, and confirm the new test fails for the expected missing symbol, missing behavior, or diagnostic mismatch.
- [ ] Implement only the files listed by the task.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run any adjacent narrow tests listed by the task.
- [ ] Commit only this task's files. Commit messages created by automation must end with `-Codex Automated`.

## File Structure

The implementation should create or modify these files. Each task below owns a subset.

```text
src/
  mono/
    mono-hir.ts
    function-call-cloner.ts
    reachability.ts
    reachability-finalization.ts
    proof-metadata-instantiator.ts
    diagnostics.ts
    index.ts
  runtime/
    runtime-catalog-types.ts
    runtime-catalog.ts
    index.ts
  target/
    target-runtime-selection.ts
    index.ts
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
      call-lowerer.ts
      function-lowerer.ts
      expression-lowerer.ts
      statement-lowerer.ts
      lowering-context.ts
      local-classifier.ts
      scope-place-lowerer.ts
      if-lowerer.ts
      loop-lowerer.ts
      match-lowerer.ts
      iterator-lowerer.ts
      validation-lowerer.ts
      attempt-lowerer.ts
      take-lowerer.ts
      terminal-lowerer.ts
      validated-buffer-read-lowerer.ts
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
      input-compatibility-validator.ts
      graph-validator.ts
      operand-validator.ts
      effect-validator.ts
      fact-validator.ts
      call-validator.ts
      layout-validator.ts
    extensions/
      extension-gates.ts
    proof-mir-builder.ts

tests/
  support/
    proof-mir/
      proof-mir-fakes.ts
      proof-mir-fixtures.ts
  unit/
    proof-mir/
      ids.test.ts
      diagnostics.test.ts
      runtime-catalog-types.test.ts
      runtime-catalog-fakes.test.ts
      model-program-types.test.ts
      model-graph-types.test.ts
      graph-ssa.test.ts
      effects-resources.test.ts
      fact-recording.test.ts
      call-targets.test.ts
      layout-binding-index.test.ts
      origin-map.test.ts
      draft-keys.test.ts
      draft-graph-builder.test.ts
      canonicalization.test.ts
      id-assignment.test.ts
      graph-validator.test.ts
      operand-validator.test.ts
      effect-validator.test.ts
      fact-validator.test.ts
      call-validator.test.ts
      layout-validator.test.ts
      extensions.test.ts
      lowering-context.test.ts
      local-classifier.test.ts
      scope-place-lowerer.test.ts
      function-lowerer.test.ts
      expression-lowerer.test.ts
      statement-lowerer.test.ts
      if-lowerer.test.ts
      loop-lowerer.test.ts
      match-lowerer.test.ts
      iterator-lowerer.test.ts
      call-lowerer.test.ts
      validated-buffer-read-lowerer.test.ts
      validation-lowerer.test.ts
      attempt-lowerer.test.ts
      take-lowerer.test.ts
      terminal-lowerer.test.ts
      input-compatibility-validator.test.ts
      proof-mir-builder-orchestration.test.ts
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
      iterator-protocol.test.ts
      determinism.test.ts
      public-api.test.ts
```

## Common Test Imports

Use these imports in task test files when snippets reference the listed helpers. Task snippets may omit repeated imports for brevity, but implementation PRs must include them.

```ts
import { expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import { monomorphizeWholeImage } from "../../../src/mono";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
```

Tasks before Task 33 must not import or call `buildProofMir`. They test direct domain, validator, fixture, and lowerer APIs. Public builder examples and integration tests start only after Task 33 owns `src/proof-mir/proof-mir-builder.ts`, `src/proof-mir/index.ts`, and `src/index.ts`.

## Test Helper Ownership

Shared test helpers must have a single owner task. Every other `*ForTest` helper shown in examples is local to that task's own test file unless it is listed here.

- Task 8 owns `proofMirRuntimeOperationFake`, `proofMirRuntimeCatalogFake`, `proofMirOriginForTest`, and runtime-call contract fake helpers in `tests/support/proof-mir/proof-mir-fakes.ts`.
- Task 18 owns `closedProofMirFixture`, `proofMirBuildInputForSource`, `proofMirSummary`, `readTagWorkedExampleFixture`, `platformCallProofMirFixture`, `validatedBufferReadProofMirFixture`, and source-to-mono/layout fixture helpers in `tests/support/proof-mir/proof-mir-fixtures.ts`.
- Tasks that append to a shared sequential test file must append tests and helper names. They must not overwrite existing cases from earlier tasks.
- A task may not move a helper from a local test file into shared support unless that support file is explicitly listed in the task's Files section.
- Each unit task that owns diagnostics must include at least one concrete test snippet for each distinct Proof MIR diagnostic code it can emit.

## Parallel Execution Model

Tasks in the same wave can be worked by separate subagents after dependencies are complete. Each wave is an antichain for the files it intentionally edits.

```text
Wave 0:
  Task 1: Mono external roots
  Task 3: Runtime catalog and target selection interfaces
  Task 4: Proof MIR IDs, diagnostics, and deterministic table helper

Wave 1:
  Task 2 after Task 1: Mono resolved call targets
  Task 5A after Task 4: Program, origin, layout, call, and fact model types
  Task 5B after Task 4: Graph, operand, and effect model types
  Task 6 after Task 4: Draft canonical keys and draft context
  Task 7 after Task 4: Origin map domain
  Task 8 after Tasks 3 and 4: Runtime catalog fakes

Wave 2:
  Task 9 after Tasks 5A, 5B, and 6: Draft graph builder
  Task 10 after Tasks 5A and 6: Layout binding index
  Task 11 after Tasks 2, 5A, and 6: Call target domain
  Task 12 after Tasks 5A, 5B, and 6: Fact recording domain
  Task 13 after Tasks 5B and 6: Effects and resources domain
  Task 14 after Tasks 5B and 6: Graph SSA domain

Wave 3:
  Task 15 after Tasks 5A, 5B, 9, and 14: Canonical ID assignment and program freeze
  Task 16 after Tasks 5B, 13, and 14: Graph and operand validators
  Task 17 after Tasks 10, 11, and 12: Fact, call, and layout validators

Wave 4:
  Task 18 after Tasks 1, 2, 3, 5A, 5B, 8, and 15: Proof MIR fixture support

Wave 5:
  Task 18A after Tasks 6, 9, 10, 11, 12, 13, 14, and 18: Lowering context and dispatch interface
  Task 19A after Tasks 13, 14, and 18: Local pre-scan and storage classifier
  Task 19B after Tasks 13, 14, and 18: Scope tree and place lowering
  Task 22 after Tasks 9, 13, 14, and 18: Extension gate rejection utilities

Wave 6:
  Task 19C after Tasks 9, 18A, 19A, and 19B: Function lowerer entry and parameter wiring

Wave 7:
  Task 20 after Tasks 9, 10, 12, 14, 18A, 19A, and 19B: Expression lowerer for scalar/value operations
  Task 21 after Tasks 9, 13, 14, 18A, and 19C: Statement lowerer for let, assignment, block, return, and panic

Wave 8:
  Task 23 after Tasks 19C, 20, and 21: If/else branch and scalar join lowerer
  Task 26 after Tasks 11, 19C, and 20: Call lowering with source and platform targets
  Task 27 after Tasks 10, 12, 19C, and 20: Validated-buffer read and layout-term lowering
  Task 28 after Tasks 12, 13, 19C, and 20: Validation split lowering
  Task 29 after Tasks 12, 13, 19C, and 20: Attempt split lowering
  Task 30 after Tasks 12, 13, 19C, and 21: Take, session, obligation, and terminal lowering

Wave 9:
  Task 24 after Task 23: Loop header, back-edge, break, and continue lowerer
  Task 25 after Task 23: Match, switch, and scope-exit control-flow lowerer

Wave 10:
  Task 30A after Tasks 24 and 26: Ordinary iterator for lowering
  Task 31 after Tasks 1, 2, 3, 10, 11, and 18: Build input compatibility validator

Wave 11:
  Task 32 after Tasks 20-31 and 30A: Builder function orchestration and draft failure policy

Wave 12:
  Task 33 after Tasks 15, 16, 17, 31, and 32: Public builder freeze, validation, and exports

Wave 13:
  Task 34A after Task 33: Integration coverage for CFG and explicit exits
  Task 34B after Task 33: Integration coverage for validation, attempts, and resources
  Task 34C after Task 33: Integration coverage for layout, platform calls, and ordinary iterators
  Task 35 after Task 33: Determinism, public API, and dependency-boundary tests

Wave 14:
  Task 36 after Tasks 34A, 34B, 34C, and 35: Formatting and full handoff verification
```

---

### Task 1: Mono External Roots

**Description:** Preserve instantiated external entry roots on `MonomorphizedHirProgram` so Proof MIR can copy root reasons into `ProofMirImage.externalRoots` without inferring them from reachability.

**Dependencies:** None.

**Files:**

- Modify: `src/mono/mono-hir.ts`
- Modify: `src/mono/monomorphizer.ts`
- Modify: `src/mono/reachability-finalization.ts`
- Modify: `src/mono/index.ts`
- Test: `tests/unit/mono/mono-hir.test.ts`
- Test: `tests/integration/mono/whole-image-monomorphization.test.ts`

**Acceptance Criteria:**

- `MonoExternalRoot` exists with `functionInstanceId`, `reason`, and `origin`.
- `MonomorphizedHirProgram.externalRoots` exists and is deterministic.
- The image entry root is present when `program.image.entryFunctionInstanceId` is present.
- Non-entry typed HIR `monoClosure.externalEntryRoots` reasons are preserved as instantiated mono roots.
- A missing selected image entry continues to be diagnosed by mono and is not represented as an empty root set.

**Code Examples:**

```ts
test("monomorphization preserves instantiated external roots", () => {
  const program = genericPacketProgramForMonoTest();
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(result.program.externalRoots.map((root) => root.reason)).toEqual([
    "imageEntry",
    "targetRequired",
  ]);
  expect(result.program.externalRoots.every((root) => root.functionInstanceId.length > 0)).toBe(
    true,
  );
});
```

```ts
export interface MonoExternalRoot {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly origin: HirOriginId;
}

export interface MonomorphizedHirProgram {
  readonly image: MonoImage;
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly functions: MonoFunctionTable;
  readonly types: MonoTypeTable;
  readonly validatedBuffers: MonoValidatedBufferTable;
  readonly proofMetadata: MonoProofMetadata;
  readonly instantiationGraph: MonoInstantiationGraph;
  readonly origins: HirOriginTable;
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
}
```

**Verification:**

```bash
bun test ./tests/unit/mono/mono-hir.test.ts ./tests/integration/mono/whole-image-monomorphization.test.ts
```

---

### Task 2: Mono Resolved Call Targets

**Description:** Persist the concrete resolved call target on each cloned mono call expression, including source-function and certified-platform call forms, so Proof MIR lowering verifies identity instead of reconstructing it.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/mono/mono-hir.ts`
- Modify: `src/mono/function-call-cloner.ts`
- Modify: `src/mono/reachability.ts`
- Modify: `src/mono/proof-metadata-instantiator.ts`
- Modify: `src/mono/diagnostics.ts`
- Test: `tests/unit/mono/function-instantiator.test.ts`
- Test: `tests/integration/mono/platform-primitive-reachability.test.ts`

**Acceptance Criteria:**

- `MonoResolvedCallTarget` exists with `sourceFunction` and `certifiedPlatform` variants.
- Every non-recovered mono call with a source function target has `resolvedTarget.kind === "sourceFunction"` and a concrete `targetFunctionInstanceId`.
- Every certified platform mono call has `resolvedTarget.kind === "certifiedPlatform"` with the exact instantiated platform edge ID and primitive ID.
- `MonoPlatformContractEdge` carries `callExpressionId`, `instantiatedOwnerTypeArguments`, `instantiatedFunctionTypeArguments`, `monomorphicEdgeKey`, and ABI metadata for target, primitive, and contract identity.
- Recovered or unresolved calls remain diagnosed by mono and do not receive a fake target.

**Code Examples:**

```ts
test("source calls carry concrete mono target identity", () => {
  const result = monomorphizeWholeImage({ program: callIntoGenericFunctionProgramForMonoTest() });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const caller = result.program.functions
    .entries()
    .find((func) => func.sourceOrigin.includes("caller"));
  const call = caller?.bodyIndex?.expressions
    .entries()
    .map((expression) => expression.kind)
    .find((kind) => kind.kind === "call");

  expect(call?.kind).toBe("call");
  if (call?.kind !== "call") return;
  expect(call.call.resolvedTarget?.kind).toBe("sourceFunction");
});
```

```ts
export type MonoResolvedCallTarget =
  | { readonly kind: "sourceFunction"; readonly targetFunctionInstanceId: MonoInstanceId }
  | {
      readonly kind: "certifiedPlatform";
      readonly targetPlatformEdgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
      readonly primitiveId: PlatformPrimitiveId;
    };

export type MonoPlatformContractEdgeKey = string & {
  readonly __brand: "MonoPlatformContractEdgeKey";
};

export interface MonoPlatformContractEdge {
  readonly id: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly callExpressionId: MonoExpressionId;
  readonly instantiatedOwnerTypeArguments: readonly MonoCheckedType[];
  readonly instantiatedFunctionTypeArguments: readonly MonoCheckedType[];
  readonly monomorphicEdgeKey: MonoPlatformContractEdgeKey;
  readonly abi: {
    readonly targetId: TargetId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: HirPlatformContractId;
  };
  readonly ensuredFacts: readonly MonoInstantiatedProofId<HirProofFactId>[];
}

export interface MonoCallExpression {
  readonly callee: MonoExpression;
  readonly resolvedTarget?: MonoResolvedCallTarget;
  readonly calleeFunctionId?: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly typeArguments: readonly MonoCheckedType[];
  readonly arguments: readonly MonoCallArgument[];
}
```

**Verification:**

```bash
bun test ./tests/unit/mono/function-instantiator.test.ts ./tests/integration/mono/platform-primitive-reachability.test.ts
```

---

### Task 3: Runtime Catalog And Target Selection Interfaces

**Description:** Add the closed compiler-runtime catalog interfaces and target/runtime selection surface that Proof MIR consumes. This task creates type-level authority and deterministic catalog helpers only; it does not emit runtime calls from Proof MIR yet.

**Dependencies:** None.

**Files:**

- Create: `src/runtime/runtime-catalog-types.ts`
- Create: `src/runtime/runtime-catalog.ts`
- Create: `src/runtime/index.ts`
- Create: `src/target/target-runtime-selection.ts`
- Create: `src/target/index.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/proof-mir/runtime-catalog-types.test.ts`

**Acceptance Criteria:**

- `ProofMirRuntimeCatalog`, `ProofMirRuntimeOperation`, availability, fact schema, place schema, effect schema, ABI reference, and lowering-owner types exist outside `src/proof-mir`.
- `runtimeCatalog(entries)` sorts entries deterministically and rejects duplicate runtime IDs with a typed construction result.
- `runtimeOperationAvailableOnTarget` checks `allTargets`, exact target, and target feature entries against deterministic feature arrays.
- `selectProofMirRuntimeCatalog` returns the catalog chosen for a target context through dependency injection.
- No runtime catalog type contains function-local Proof MIR value, place, fact, call, edge, or origin IDs.

**Code Examples:**

```ts
test("runtime catalog entries are deterministic by runtime id", () => {
  const catalog = runtimeCatalog({
    targetId: targetId("x64-test"),
    features: ["sse2"],
    entries: [
      runtimeOperationForCatalogTypesTest({
        runtimeId: proofMirRuntimeOperationId(2),
        name: "panic",
      }),
      runtimeOperationForCatalogTypesTest({
        runtimeId: proofMirRuntimeOperationId(1),
        name: "read_u8",
      }),
    ],
  });

  expect(catalog.kind).toBe("ok");
  if (catalog.kind !== "ok") return;
  expect(catalog.catalog.entries().map((entry) => entry.name)).toEqual(["read_u8", "panic"]);
});

function runtimeOperationForCatalogTypesTest(input: {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
}): ProofMirRuntimeOperation {
  return {
    runtimeId: input.runtimeId,
    name: input.name,
    availability: { kind: "allTargets" },
    loweringOwner: "compilerRuntime",
    abi: { kind: "compilerRuntime", symbol: `__wr_${input.name}` },
    factSchemas: [],
    placeSchemas: [],
    effectSchemas: [],
  };
}
```

```ts
export interface SelectProofMirRuntimeCatalogInput {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly catalogs: readonly ProofMirRuntimeCatalog[];
}

export type SelectProofMirRuntimeCatalogResult =
  | { readonly kind: "ok"; readonly catalog: ProofMirRuntimeCatalog }
  | { readonly kind: "error"; readonly diagnostics: readonly RuntimeCatalogDiagnostic[] };
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/runtime-catalog-types.test.ts
```

---

### Task 4: Proof MIR IDs, Diagnostics, And Deterministic Table Helper

**Description:** Establish Proof MIR branded IDs, owned IDs, diagnostic registry/sorting, canonical-key branding, and deterministic table construction with duplicate-key diagnostics.

**Dependencies:** None.

**Files:**

- Create: `src/proof-mir/ids.ts`
- Create: `src/proof-mir/diagnostics.ts`
- Create: `src/proof-mir/canonicalization/canonical-keys.ts`
- Create: `src/proof-mir/canonicalization/canonical-order.ts`
- Create: `src/proof-mir/index.ts`
- Test: `tests/unit/proof-mir/ids.test.ts`
- Test: `tests/unit/proof-mir/diagnostics.test.ts`
- Test: `tests/unit/proof-mir/canonicalization.test.ts`

**Acceptance Criteria:**

- Every ID named in the design exists with the correct brand.
- Owned IDs include the enclosing `MonoInstanceId`.
- `PROOF_MIR_DIAGNOSTIC_CODES` includes every code named by the design.
- `proofMirDiagnosticCode(code)` validates and brands only codes from `PROOF_MIR_DIAGNOSTIC_CODES`.
- Unknown diagnostic codes throw at construction time.
- `sortProofMirDiagnostics` sorts by source origin, function instance, node detail, code, owner key, root cause, and stable detail.
- `proofMirDeterministicTable` exposes `get`, `has`, `entries`, `keyOf`, and `lookupKeyOf`.
- Duplicate canonical keys with different normalized payloads return a deterministic diagnostic; duplicate equivalent payloads collapse to one record.

**Code Examples:**

```ts
test("unknown Proof MIR diagnostic codes are rejected", () => {
  expect(() =>
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_NOT_A_REAL_CODE",
      message: "bad",
      ownerKey: "program",
      rootCauseKey: "test",
      stableDetail: "bad",
    }),
  ).toThrow("Unknown Proof MIR diagnostic code");
});
```

```ts
const table = proofMirDeterministicTable({
  entries: [
    { id: proofMirBlockId(2), name: "b" },
    { id: proofMirBlockId(1), name: "a" },
  ],
  keyOf: (entry) => proofMirCanonicalKey(`block:${entry.id}`),
  lookupKeyOf: (id) => proofMirCanonicalKey(`block:${id}`),
  duplicateDetail: (key) => `duplicate:${key}`,
});

expect(table.kind).toBe("ok");
if (table.kind === "ok") {
  expect(table.table.entries().map((entry) => entry.name)).toEqual(["a", "b"]);
}
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/ids.test.ts ./tests/unit/proof-mir/diagnostics.test.ts ./tests/unit/proof-mir/canonicalization.test.ts
```

---

### Task 5A: Program, Origin, Layout, Call, And Fact Model Types

**Description:** Add the whole-program and proof-facing model interfaces from the design: program/image tables, origins, layout references, layout terms, facts, call targets, call graph edges, runtime-call contracts, and private-state generation records. This task is type-model only and must not implement lowering logic.

**Dependencies:** Task 4.

**Files:**

- Create: `src/proof-mir/model/origins.ts`
- Create: `src/proof-mir/model/layout-bindings.ts`
- Create: `src/proof-mir/model/facts.ts`
- Create: `src/proof-mir/model/calls.ts`
- Create: `src/proof-mir/model/program.ts`
- Test: `tests/unit/proof-mir/model-program-types.test.ts`

**Acceptance Criteria:**

- `ProofMirProgram`, `ProofMirImage`, whole-image function table references, `ProofMirOrigin`, `ProofMirLayoutReference`, `ProofMirLayoutTermReference`, `ProofMirFact`, `ProofMirCallTarget`, `ProofMirCallGraphEdge`, `ProofMirRuntimeCallContract`, and `ProofMirPrivateStateGeneration` exist.
- `ProofMirCallTarget` has exactly `sourceFunction`, `certifiedPlatform`, and `compilerRuntime`.
- Program-level records that reference function-local records use owned IDs and include the owning `MonoInstanceId`.
- Fact records reference canonical `ProofMirFactId` dependencies instead of embedding fact objects.
- Runtime-call contracts reference runtime catalog operation IDs and schema names, not function-local runtime catalog state.
- The model compiles without importing parser, AST, filesystem, proof checker, target backend, AArch64, linker, or PE/COFF modules.

**Code Examples:**

```ts
test("ProofMirProgram exposes checker-facing whole-image tables", () => {
  const program = proofMirProgramModelFake();

  expect(program.functions.entries()).toEqual([]);
  expect(program.layout).toBeDefined();
  expect(program.runtimeCatalog.entries()).toEqual([]);
});
```

```ts
const target: ProofMirCallTarget = {
  kind: "certifiedPlatform",
  platformEdgeId: instantiatedHirProofId(monoInstanceId("fn:main"), hirPlatformContractEdgeId(0)),
  primitiveId: platformPrimitiveId("uefi.read"),
  abi: { kind: "platform", layoutKey: "platform-abi:uefi.read" },
};

expect(target.kind).toBe("certifiedPlatform");
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/model-program-types.test.ts
bun run typecheck
```

---

### Task 5B: Graph, Operand, And Effect Model Types

**Description:** Add the function-local CFG, SSA, operand, place, scope, effect, exit, validation, attempt, take/session/obligation, and extension placeholder model interfaces. This task is type-model only and must not implement lowering logic.

**Dependencies:** Task 4.

**Files:**

- Create: `src/proof-mir/model/operands.ts`
- Create: `src/proof-mir/model/effects.ts`
- Create: `src/proof-mir/model/graph.ts`
- Test: `tests/unit/proof-mir/model-graph-types.test.ts`

**Acceptance Criteria:**

- Function/block/value/local/place/scope tables, statements, terminators, edge effects, exits, validation records, attempt records, take/session/obligation records, and extension records exist.
- Function-local records use bare dense IDs inside a `ProofMirFunction`.
- Any graph record that is exported into program-level tables has a corresponding owned ID form.
- `ProofMirOperand` distinguishes value-only, place-only, and value-and-place operands for observe/consume validation.
- `ProofMirControlEdge.arguments` is the only owner of join arguments; `ProofMirBlockTarget` does not duplicate them.
- Extension records are representable but gated; no enabled extension validator or lowering semantics are implemented here.
- The model compiles without importing parser, AST, filesystem, proof checker, target backend, AArch64, linker, or PE/COFF modules.

**Code Examples:**

```ts
test("function graph keeps local IDs function-scoped", () => {
  const func = proofMirFunctionGraphModelFake({
    functionInstanceId: monoInstanceId("fn:main"),
  });

  expect(func.entryBlockId).toBe(proofMirBlockId(0));
  expect(func.blocks.entries()[0]?.id).toBe(proofMirBlockId(0));
});
```

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

**Verification:**

```bash
bun test ./tests/unit/proof-mir/model-graph-types.test.ts
bun run typecheck
```

---

### Task 6: Draft Canonical Keys And Draft Context

**Description:** Add draft record key builders and a per-build context that stores canonical-keyed draft tables before dense ID assignment.

**Dependencies:** Task 4.

**Files:**

- Create: `src/proof-mir/draft/draft-keys.ts`
- Create: `src/proof-mir/draft/draft-program.ts`
- Create: `src/proof-mir/draft/draft-builder-context.ts`
- Test: `tests/unit/proof-mir/draft-keys.test.ts`

**Acceptance Criteria:**

- Draft canonical keys are length-delimited and deterministic for origins, blocks, statements, terminators, edges, exits, values, locals, places, scopes, calls, facts, layout terms, runtime calls, and private-state generations.
- Draft keys contain mono IDs, layout keys, structural role names, and referenced canonical keys.
- Draft keys never contain final dense Proof MIR IDs, insertion indexes, JavaScript object identity, host paths, or source text not preserved by mono/layout.
- `DraftProofMirBuildContext` accumulates diagnostics and can mark a function draft as failed without preserving invalid draft graph output.
- Duplicate draft records with the same canonical key are normalized before acceptance.

**Code Examples:**

```ts
test("draft keys length-delimit structural fields", () => {
  const left = draftBlockKey({
    functionInstanceId: monoInstanceId("fn:a:b"),
    role: "entry",
    sourceOrigin: "source:1",
  });
  const right = draftBlockKey({
    functionInstanceId: monoInstanceId("fn:a"),
    role: "b:entry",
    sourceOrigin: "source:1",
  });

  expect(left).not.toBe(right);
});
```

```ts
const context = createDraftProofMirBuildContext({
  program,
  layout,
  target,
});

context.addDiagnostic(
  proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
    message: "Reachable mono statement cannot be lowered.",
    ownerKey: "function:fn:main",
    rootCauseKey: "mono-statement",
    stableDetail: "statement:17",
    sourceOrigin: "main.wr:3:9",
  }),
);
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/draft-keys.test.ts
```

---

### Task 7: Origin Map Domain

**Description:** Implement origin interning from HIR origins, mono expression/statement/proof IDs, layout references, runtime catalog records, and synthetic notes.

**Dependencies:** Task 4.

**Files:**

- Create: `src/proof-mir/domains/origin-map.ts`
- Test: `tests/unit/proof-mir/origin-map.test.ts`

**Acceptance Criteria:**

- The origin map interns equivalent source/HIR origins to one draft origin key.
- Synthetic origins inherit owner and nearest source origin while adding stable notes such as `if.join`, `while.condition`, `validation.ok`, `attempt.error`, and `take.exit`.
- Layout-origin records can carry `layoutKey` and display-only `diagnosticOrigin`.
- Origin allocation is deterministic across shuffled insertion order.
- Missing required source origins produce `PROOF_MIR_ORIGIN_MISSING`.

**Code Examples:**

```ts
test("synthetic origins preserve nearest source origin and stable note", () => {
  const map = createProofMirOriginMap();
  const base = map.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: monoInstanceId("fn:main") },
    sourceOrigin: hirOriginId(4),
    monoStatementId: instantiatedHirId(monoInstanceId("fn:main"), hirStatementId(9)),
  });
  const join = map.syntheticFrom(base, "if.join");

  expect(map.draftRecord(join).note).toBe("if.join");
  expect(map.draftRecord(join).sourceOrigin).toBe(hirOriginId(4));
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/origin-map.test.ts
```

---

### Task 8: Runtime Catalog Fakes

**Description:** Add Proof MIR runtime catalog test fakes that satisfy the runtime interfaces and are reusable by lowerer, validator, and integration tests.

**Dependencies:** Tasks 3 and 4.

**Files:**

- Create: `tests/support/proof-mir/proof-mir-fakes.ts`
- Test: `tests/unit/proof-mir/runtime-catalog-fakes.test.ts`

**Acceptance Criteria:**

- `proofMirRuntimeOperationFake` creates complete runtime operation definitions with deterministic IDs, availability, ABI, fact schemas, place schemas, effect schemas, and lowering owner.
- `proofMirRuntimeCatalogFake` creates a sorted closed catalog for a target ID and feature set.
- Fakes use dependency injection and do not mock module imports.
- Fakes do not depend on `src/proof-mir/proof-mir-builder.ts`.

**Code Examples:**

```ts
test("runtime fake can model a validated-buffer helper", () => {
  const catalog = proofMirRuntimeCatalogFake({
    operations: [
      proofMirRuntimeOperationFake({
        runtimeId: proofMirRuntimeOperationId(10),
        name: "read_validated_u8",
        loweringOwner: "validatedBufferHelper",
        effectSchemas: [{ kind: "readsMemory", place: { kind: "argument", index: 0 } }],
      }),
    ],
  });

  expect(catalog.entries().map((entry) => entry.name)).toEqual(["read_validated_u8"]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/runtime-catalog-fakes.test.ts
```

---

### Task 9: Draft Graph Builder

**Description:** Implement canonical-keyed draft graph building primitives for scopes, blocks, statements, terminators, control edges, exit edges, locals, values, and places.

**Dependencies:** Tasks 5A, 5B, and 6.

**Files:**

- Create: `src/proof-mir/draft/draft-graph-builder.ts`
- Test: `tests/unit/proof-mir/draft-graph-builder.test.ts`

**Acceptance Criteria:**

- A function draft can create a root function scope, entry block, block parameters, statements, terminators, normal edges, branch edges, return edges, panic edges, and exit records.
- No block can be finalized twice.
- No block can be frozen without a terminator.
- Edge records store facts, effects, argument keys, source/target scope keys, and origin key.
- Draft edges can reference target blocks by canonical key before final dense IDs exist.

**Code Examples:**

```ts
test("draft graph builder records explicit return edge and exit", () => {
  const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
  const origin = graph.originForTest("return");
  const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });
  const exit = graph.createReturnExit({ fromBlock: entry, origin, terminal: false });

  graph.setTerminator(entry, {
    kind: "return",
    value: undefined,
    edge: exit.edge,
    exit: exit.exit,
    origin,
  });

  expect(graph.block(entry).terminator?.kind).toBe("return");
  expect(graph.edge(exit.edge).kind).toBe("returnExit");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/draft-graph-builder.test.ts
```

---

### Task 10: Layout Binding Index

**Description:** Implement canonical layout reference and layout-term path resolution over `LayoutFactProgram`, including recursive child paths and validated-buffer read requirements.

**Dependencies:** Tasks 5A and 6.

**Files:**

- Create: `src/proof-mir/domains/layout-binding-index.ts`
- Test: `tests/unit/proof-mir/layout-binding-index.test.ts`

**Acceptance Criteria:**

- The index resolves type, field, validated-buffer, validated-buffer-field, image-device, function-ABI, platform-ABI, and image-entry layout references.
- It resolves layout-term roots for validated-buffer source length, field offset, field byte length, field element count, field end, derived sources, derived cases, and read requirements.
- It resolves `childPath` through supported binary arithmetic terms.
- Unsupported term shapes return `PROOF_MIR_INVALID_LAYOUT_TERM_PATH`.
- Unit mismatches return `PROOF_MIR_INVALID_LAYOUT_TERM_PATH`.
- Repeated references to the same term path reuse the same draft term key.

**Code Examples:**

```ts
test("layout term paths distinguish read requirement operands", () => {
  const fixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1"],
  });
  const index = createProofMirLayoutBindingIndex({
    program: fixture.program,
    layout: fixture.layout,
  });

  const left = index.resolveTerm({
    root: {
      kind: "validatedBufferReadRequirement",
      instanceId: fixture.bufferInstanceId,
      fieldId: fixture.payloadFieldId,
      requirementIndex: 0,
      slot: "left",
    },
    childPath: [],
    expectedUnit: "bytes",
  });

  expect(left.kind).toBe("ok");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/layout-binding-index.test.ts
```

---

### Task 11: Call Target Domain

**Description:** Build Proof MIR call-target verification indexes for source functions, certified platform edges, and compiler-runtime catalog operations.

**Dependencies:** Tasks 2, 5A, and 6.

**Files:**

- Create: `src/proof-mir/domains/call-targets.ts`
- Test: `tests/unit/proof-mir/call-targets.test.ts`

**Acceptance Criteria:**

- Source calls require `MonoCallExpression.resolvedTarget.kind === "sourceFunction"`.
- Source call targets resolve to an existing `MonoFunctionInstance` with `bodyStatus === "sourceBody"` and a matching `LayoutFunctionAbiFact`.
- Certified platform calls require `resolvedTarget.kind === "certifiedPlatform"`, a matching `MonoPlatformContractEdge`, a matching primitive ID, and a matching `LayoutPlatformAbiFact`.
- `bodylessRecovery`, missing target, missing ABI, missing concrete target, recovered call, and target-kind mismatch cases return the corresponding Proof MIR diagnostic codes.
- Compiler-runtime target lookup checks target availability before instantiating runtime call contracts.

**Code Examples:**

```ts
test("bodyless recovery call target is rejected before lowering", () => {
  const fixture = proofMirCallTargetFixture({ targetBodyStatus: "bodylessRecovery" });
  const index = createProofMirCallTargetIndex(fixture);

  const result = index.resolveMonoCall(fixture.callExpression);

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_CALL_TARGET_KIND_MISMATCH"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/call-targets.test.ts
```

---

### Task 12: Fact Recording Domain

**Description:** Implement canonical fact construction, fact operand normalization, comparison complementing, fact roles, dependencies, and private-state generation draft records.

**Dependencies:** Tasks 5A, 5B, and 6.

**Files:**

- Create: `src/proof-mir/domains/fact-recording.ts`
- Test: `tests/unit/proof-mir/fact-recording.test.ts`

**Acceptance Criteria:**

- Facts support roles `evidence`, `requirement`, `trustedAxiom`, and `candidate`.
- Comparison facts use closed Proof MIR comparison operators and deterministic complements.
- Predicate, match refinement, layout fits, payload end, platform ensured, runtime ensured, and terminal call fact kinds can be recorded.
- Trusted axioms require platform-edge or runtime-call dependencies at construction time.
- Fact records are interned by canonical key and referenced by fact IDs after freeze.
- Private-state generation records include the place, previous generation, optional transition, and origin.

**Code Examples:**

```ts
test("comparison complement table is deterministic", () => {
  expect(complementProofMirComparisonOperator("eq")).toBe("ne");
  expect(complementProofMirComparisonOperator("ne")).toBe("eq");
  expect(complementProofMirComparisonOperator("lt")).toBe("ge");
  expect(complementProofMirComparisonOperator("le")).toBe("gt");
  expect(complementProofMirComparisonOperator("gt")).toBe("le");
  expect(complementProofMirComparisonOperator("ge")).toBe("lt");
});
```

```ts
const fact = recorder.recordComparisonFact({
  role: "candidate",
  left: { kind: "value", valueId: ownedValueId },
  operator: "ge",
  right: { kind: "constant", literal: { kind: "integer", text: "2", value: 2n } },
  dependsOn: [{ kind: "value", valueId: ownedValueId }],
  origin,
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/fact-recording.test.ts
```

---

### Task 13: Effects And Resources Domain

**Description:** Implement structured places, local storage classification inputs, loans, edge effects, scope boundary utilities, resource boundary sets, and private-state transition records.

**Dependencies:** Tasks 5B and 6.

**Files:**

- Create: `src/proof-mir/domains/effects-resources.ts`
- Test: `tests/unit/proof-mir/effects-resources.test.ts`

**Acceptance Criteria:**

- Place roots and projections preserve mono structured places, block-parameter places, runtime temporaries, validation packet payloads, and image-device projections.
- Local storage classification can mark locals as `scalarSsa` or `placeBacked` from deterministic pre-scan facts.
- Borrow operations allocate stable loans with mode, place, owning scope, start origin, and optional end origin.
- Scope-crossing utilities compute crossed scopes from source and target scope stacks.
- Loop boundary sets are sorted by canonical resource keys and include places, loans, obligations, session members, and private-state generations.
- Consume, introduce, loan, obligation, session, and private-state edge effects are normalized with canonical keys.

**Code Examples:**

```ts
test("crossed scopes are innermost to outermost until shared ancestor", () => {
  const tree = proofMirScopeTreeForTest([
    { key: "function" },
    { key: "loop", parent: "function" },
    { key: "body", parent: "loop" },
    { key: "after", parent: "function" },
  ]);

  expect(crossedScopesForDraftEdge(tree, { from: "body", to: "after" })).toEqual(["body", "loop"]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/effects-resources.test.ts
```

---

### Task 14: Graph SSA Domain

**Description:** Implement sealed-block SSA construction for copy scalar locals and proof fact tokens, including incomplete parameters, block sealing, loop-header parameters, and edge-owned join arguments.

**Dependencies:** Tasks 5B and 6.

**Files:**

- Create: `src/proof-mir/domains/graph-ssa.ts`
- Test: `tests/unit/proof-mir/graph-ssa.test.ts`

**Acceptance Criteria:**

- Entry block parameters are created in signature order for copy scalar parameters.
- Reads from sealed blocks with one predecessor reuse predecessor values.
- Reads from sealed blocks with multiple different predecessors create block parameters.
- Reads from unsealed blocks create incomplete parameters that are completed on seal.
- Predeclared loop-header parameters are keyed by scalar local or fact key and win over on-demand incomplete parameters.
- Edge arguments are stored only on `ProofMirControlEdge.arguments`, never duplicated on `ProofMirBlockTarget`.
- Missing arguments, duplicate definitions, and incomplete parameters after sealing produce `PROOF_MIR_INVALID_SSA`.

**Code Examples:**

```ts
test("sealed block SSA writes join arguments on predecessor edges", () => {
  const graph = createSsaGraphForTest();
  const thenValue = graph.defineLocal("x", "then");
  const elseValue = graph.defineLocal("x", "else");
  const join = graph.createBlock({ sealed: false });

  graph.addPredecessor(join, "edge:then", { x: thenValue });
  graph.addPredecessor(join, "edge:else", { x: elseValue });
  graph.seal(join);

  const joined = graph.readLocal(join, "x");

  expect(graph.blockParameters(join).map((parameter) => parameter.valueKey)).toEqual([joined]);
  expect(graph.edgeArguments("edge:then")).toEqual([thenValue]);
  expect(graph.edgeArguments("edge:else")).toEqual([elseValue]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/graph-ssa.test.ts
```

---

### Task 15: Canonical ID Assignment And Program Freeze

**Description:** Freeze draft records into deterministic dense IDs, rewrite canonical-key references, build deterministic tables, and reject unresolved or duplicate references before validation.

**Dependencies:** Tasks 5A, 5B, 9, and 14.

**Files:**

- Create: `src/proof-mir/canonicalization/id-assignment.ts`
- Create: `src/proof-mir/canonicalization/program-freeze.ts`
- Test: `tests/unit/proof-mir/id-assignment.test.ts`
- Test: `tests/unit/proof-mir/canonicalization.test.ts`

**Acceptance Criteria:**

- Program freeze validates that every draft reference resolves by canonical key before assigning IDs.
- Each table sorts by table-owned canonical key and assigns dense IDs from zero in that order.
- Draft references are rewritten to dense IDs or owned dense IDs.
- Function-local IDs are never compared across functions without an owner.
- Duplicate canonical keys with incompatible payloads emit `PROOF_MIR_INVALID_TABLE_CANONICAL_KEY`.
- A helper refactor that changes draft insertion order but not keys leaves frozen IDs unchanged.

**Code Examples:**

```ts
test("ID assignment is stable across shuffled draft insertion order", () => {
  const first = freezeDraftProgram(draftProgramFixture({ order: ["b", "a", "c"] }));
  const second = freezeDraftProgram(draftProgramFixture({ order: ["c", "b", "a"] }));

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;

  expect(frozenProgramStableSummaryForTest(first.program)).toBe(
    frozenProgramStableSummaryForTest(second.program),
  );
});

function frozenProgramStableSummaryForTest(program: ProofMirProgram): string {
  return JSON.stringify({
    functions: program.functions.entries().map((func) => ({
      functionInstanceId: func.functionInstanceId,
      blocks: func.blocks.entries().map((block) => block.id),
      edges: func.edges.entries().map((edge) => [edge.id, edge.fromBlockId, edge.toBlockId]),
    })),
    facts: program.facts.entries().map((fact) => fact.id),
    layoutTerms: program.layoutTerms.entries().map((term) => term.id),
  });
}
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/id-assignment.test.ts ./tests/unit/proof-mir/canonicalization.test.ts
```

---

### Task 16: Graph And Operand Validators

**Description:** Implement local structural validation for CFG shape, terminators, edges, exits, SSA definitions/uses, operands, values, locals, places, scopes, joins, and resource-kind consistency.

**Dependencies:** Tasks 5B, 13, and 14.

**Files:**

- Create: `src/proof-mir/validation/graph-validator.ts`
- Create: `src/proof-mir/validation/operand-validator.ts`
- Create: `src/proof-mir/validation/effect-validator.ts`
- Test: `tests/unit/proof-mir/graph-validator.test.ts`
- Test: `tests/unit/proof-mir/operand-validator.test.ts`
- Test: `tests/unit/proof-mir/effect-validator.test.ts`

**Acceptance Criteria:**

- Every function has an entry block.
- Every block has exactly one terminator and no implicit fallthrough.
- Terminators list exactly the outgoing edges they use.
- Every `ProofMirBlockTarget.edgeId` resolves to an edge whose `toBlockId` matches.
- Return and panic terminators have both a control edge and an exit edge with matching closure policy.
- Edge argument count and types match target block parameters.
- Every scalar value has one definition and every use resolves.
- Block parameters carry only copy scalar or proof-fact representations.
- Consuming receiver and argument operands cannot be value-only.
- Scope parent links are acyclic and crossed-scope lists match source/target scope stacks.
- Loan references have stable identity, mode, scope, start origin, and matching release or exit closure policy.

**Code Examples:**

```ts
test("validator rejects value-only consume operands", () => {
  const program = proofMirProgramWithCallOperandForTest({
    mode: "consume",
    operand: { kind: "value", value: proofMirValueId(0) },
  });

  const diagnostics = validateProofMirOperands(program);

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_INVALID_CALL_OPERAND"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/graph-validator.test.ts ./tests/unit/proof-mir/operand-validator.test.ts ./tests/unit/proof-mir/effect-validator.test.ts
```

---

### Task 17: Fact, Call, And Layout Validators

**Description:** Implement structural validation for fact table references, fact authority, call graph edges, call targets, runtime calls, layout references, layout-term paths, validated-buffer reads, validation matches, attempts, private-state generations, and extension hooks.

**Dependencies:** Tasks 10, 11, and 12.

**Files:**

- Create: `src/proof-mir/validation/fact-validator.ts`
- Create: `src/proof-mir/validation/call-validator.ts`
- Create: `src/proof-mir/validation/layout-validator.ts`
- Test: `tests/unit/proof-mir/fact-validator.test.ts`
- Test: `tests/unit/proof-mir/call-validator.test.ts`
- Test: `tests/unit/proof-mir/layout-validator.test.ts`

**Acceptance Criteria:**

- Every fact ID resolves in `ProofMirProgram.facts`.
- Every trusted axiom fact has a platform-edge or runtime-call dependency.
- Every fact operand resolves and uses a normalized operand kind.
- Every call graph edge uses an owned call ID and points to the same target as the call statement.
- Every platform call has a matching platform contract edge and ABI fact.
- Every compiler-runtime call has a closed catalog operation and an instantiated runtime call contract with owned places and effects.
- Runtime catalog entries containing function-local IDs are rejected.
- Every layout reference resolves into `LayoutFactProgram`.
- Every layout term reference resolves through canonical path and unit.
- Every validated-buffer read has layout field reference, offset/end term references, term bindings, and fact IDs derived from `readRequires`.
- Every validation match records ok/err bindings visible only on the corresponding edge.
- Every attempt start records a lowered arbitrary expression operand and deterministic pending result place.

**Code Examples:**

```ts
test("trusted axiom without catalog dependency is rejected", () => {
  const program = proofMirProgramWithFactForTest({
    role: "trustedAxiom",
    kind: { kind: "runtimeEnsured", runtimeCallId: proofMirRuntimeCallId(0) },
    dependsOn: [],
  });

  const diagnostics = validateProofMirFacts(program);

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_INVALID_FACT_AUTHORITY"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/fact-validator.test.ts ./tests/unit/proof-mir/call-validator.test.ts ./tests/unit/proof-mir/layout-validator.test.ts
```

---

### Task 18: Proof MIR Fixture Support

**Description:** Add support fixtures that lower source through existing HIR, mono, and layout phases, select a runtime catalog, call Proof MIR build inputs, and produce stable normalized snapshots.

**Dependencies:** Tasks 1, 2, 3, 5A, 5B, 8, and 15.

**Files:**

- Create: `tests/support/proof-mir/proof-mir-fixtures.ts`
- Test: `tests/unit/proof-mir/proof-mir-fixtures.test.ts`

**Acceptance Criteria:**

- `proofMirBuildInputForSource(source, options)` returns closed mono program, layout facts, and target/runtime context.
- `closedProofMirFixture` returns a valid minimal closed executable-image input.
- `proofMirSummary` normalizes BigInt, deterministic table entries, origins, layout references, and diagnostics into stable JSON.
- Fixture helpers reuse existing HIR, mono, and layout fixture helpers.
- Fixture helpers can build source with platform primitives, validated buffers, branches, loops, validation, attempt, take, and image devices.

**Code Examples:**

```ts
test("closed Proof MIR fixture creates matching mono and layout inputs", () => {
  const fixture = closedProofMirFixture();

  expect(fixture.layout.imageEntry.imageInstanceId).toBe(fixture.program.image.instanceId);
  expect(fixture.target.runtimeCatalog.targetId).toBe(fixture.target.targetId);
  expect(fixture.program.externalRoots.map((root) => root.reason)).toContain("imageEntry");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/proof-mir-fixtures.test.ts
```

---

### Task 18A: Lowering Context And Dispatch Interface

**Description:** Define the shared lowering context and dispatch interfaces consumed by all lowerer tasks. This task creates the stable registry shape for sub-lowerers, callback types, draft handles, and diagnostic/reporting helpers without lowering any source construct itself.

**Dependencies:** Tasks 6, 9, 10, 11, 12, 13, 14, and 18.

**Files:**

- Create: `src/proof-mir/lower/lowering-context.ts`
- Test: `tests/unit/proof-mir/lowering-context.test.ts`

**Acceptance Criteria:**

- `ProofMirLoweringContext` exposes program, layout, target/runtime catalog, draft build context, draft graph builder, origin map, layout binding index, call target index, fact recorder, effects/resources domain, SSA domain, local classifier, and scope/place lowering handles.
- `ProofMirExpressionLowerer`, `ProofMirStatementLowerer`, `ProofMirControlFlowLowerer`, and specialized lowerer callback types exist and return typed `ok` or `error` results with diagnostics.
- `createProofMirLoweringRegistry` accepts dependency-injected sub-lowerers and rejects missing required callbacks before lowering starts with the design-listed unlowerable diagnostic for the affected construct.
- Lowerers receive context and callbacks through parameters; no lowerer imports a sibling lowerer to create a cycle.
- The registry defines an extension callback slot for gated constructs; Task 22 provides the default fail-closed implementation.
- The context and registry do not import filesystem APIs, parser/AST internals, proof checker, target backends, linkers, or `buildProofMir`.

**Code Examples:**

```ts
test("registry rejects missing expression lowerer before lowering", () => {
  const result = createProofMirLoweringRegistry({
    expression: undefined,
    statement: statementLowererForRegistryTest(),
    controlFlow: controlFlowLowererForRegistryTest(),
    call: callLowererForRegistryTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION"),
  );
});
```

```ts
export interface ProofMirExpressionLowerer {
  lowerExpression(input: ProofMirExpressionLoweringInput): ProofMirLoweringResult<ProofMirOperand>;
  lowerExpressionAsPlace(
    input: ProofMirExpressionLoweringInput,
  ): ProofMirLoweringResult<ProofMirPlaceOperand>;
}
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/lowering-context.test.ts
```

---

### Task 19A: Local Pre-Scan And Storage Classifier

**Description:** Implement the deterministic local pre-scan and storage classifier used by function, expression, statement, control-flow, and resource lowerers.

**Dependencies:** Tasks 13, 14, and 18.

**Files:**

- Create: `src/proof-mir/lower/local-classifier.ts`
- Test: `tests/unit/proof-mir/local-classifier.test.ts`

**Acceptance Criteria:**

- The pre-scan reads reachable source-body `MonoFunctionInstance.bodyIndex`; it does not inspect source text or parser AST.
- Copy scalar parameters and locals without address, borrow, projection, consume, validated-buffer, session, private-state, capability, or aggregate use classify as `scalarSsa`.
- Non-copy, address-taken, borrowed, projected, consumed, validated-buffer, session-bound, private-state, capability, and aggregate locals classify as `placeBacked`.
- Classification order is deterministic by mono local ID and does not depend on traversal insertion order.
- Missing `bodyIndex` on a reachable source-body function returns `PROOF_MIR_MISSING_FUNCTION_BODY`.
- A later lowerer request for an unseen place/borrow use returns `PROOF_MIR_INVALID_VALUE_RESOURCE_KIND`.

**Code Examples:**

```ts
test("borrowed locals classify as place backed", () => {
  const result = classifyProofMirLocalsForTest({
    parameters: [{ name: "packet", type: "&Packet" }],
    body: ["let view = borrow packet.payload", "return view.len"],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.classification.local("packet").storage).toBe("placeBacked");
});
```

```ts
test("missing body index is a construction diagnostic", () => {
  const result = classifyProofMirLocalsForFunctionForTest({
    bodyStatus: "sourceBody",
    bodyIndex: undefined,
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/local-classifier.test.ts
```

---

### Task 19B: Scope Tree And Place Lowering

**Description:** Implement source scope-tree construction, structured place roots/projections, and loop/resource boundary-set input collection.

**Dependencies:** Tasks 13, 14, and 18.

**Files:**

- Create: `src/proof-mir/lower/scope-place-lowerer.ts`
- Test: `tests/unit/proof-mir/scope-place-lowerer.test.ts`

**Acceptance Criteria:**

- Function, block, loop, match-arm, take-body, validation-arm, and attempt-arm scopes are created with deterministic canonical keys.
- Scope parent links are acyclic and preserve source nesting from mono body metadata.
- Place roots preserve mono structured places for locals, parameters, block parameters, runtime temporaries, validation packets, payloads, and image-device projections.
- Place projections preserve field/index/member order and attach layout references when layout facts are available.
- Loop boundary-set inputs include places, loans, obligations, session members, and private-state generations sorted by canonical resource key.
- Unsupported or missing place metadata returns `PROOF_MIR_INVALID_VALUE_RESOURCE_KIND` without inventing a synthetic place.

**Code Examples:**

```ts
test("field projection keeps layout field reference", () => {
  const lowered = lowerProofMirPlaceForTest({
    sourcePlace: "packet.payload",
    layoutFieldKey: "validated-buffer-field:Packet.payload",
  });

  expect(lowered.kind).toBe("ok");
  if (lowered.kind !== "ok") return;
  expect(lowered.place.projections[0]).toMatchObject({
    kind: "field",
    layout: { kind: "validatedBufferField" },
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/scope-place-lowerer.test.ts
```

---

### Task 19C: Function Lowerer Entry And Parameter Wiring

**Description:** Implement the function-level lowerer shell: source function origin, root scope, entry block, parameter wiring, and handoff into statement/control-flow dispatch.

**Dependencies:** Tasks 9, 18A, 19A, and 19B.

**Files:**

- Create: `src/proof-mir/lower/function-lowerer.ts`
- Test: `tests/unit/proof-mir/function-lowerer.test.ts`

**Acceptance Criteria:**

- Source-bodied functions receive one draft function graph with root function scope and entry block.
- Certified platform functions do not receive Proof MIR function bodies.
- `bodylessRecovery` functions produce `PROOF_MIR_MISSING_FUNCTION_BODY`.
- Entry copy scalar parameters become entry block parameters in signature order.
- Place-backed parameters become structured place roots and do not become entry scalar block parameters.
- The function lowerer calls statement/control-flow dispatch through `ProofMirLoweringRegistry`.
- A failed body statement abandons the function draft and returns diagnostics without preserving a partial graph as usable output.

**Code Examples:**

```ts
test("copy scalar parameters become entry block parameters", () => {
  const fixture = proofMirFunctionLowererFixture([
    "fn add_one(value: u8) -> u8:",
    "    return value",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ]);

  const lowered = lowerProofMirFunctionForTest(fixture, "add_one");

  expect(lowered.entry.parameters.map((parameter) => parameter.parameterKind.kind)).toEqual([
    "copyScalar",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/function-lowerer.test.ts
```

---

### Task 20: Expression Lowerer For Scalar And Value Operations

**Description:** Lower literals, names, member loads, object fragments, unary operators, binary operators, comparisons, and value/place operand production into draft statements and SSA values.

**Dependencies:** Tasks 9, 10, 12, 14, 18A, 19A, and 19B.

**Files:**

- Create: `src/proof-mir/lower/expression-lowerer.ts`
- Test: `tests/unit/proof-mir/expression-lowerer.test.ts`

**Acceptance Criteria:**

- Literals allocate fresh SSA values and `literal` statements.
- Names read scalar SSA locals or place-backed locals according to local storage classification.
- Member expressions preserve field-sensitive places and emit `load` only when a scalar value is required.
- Unary, binary, and comparison operators map to closed Proof MIR operator enums.
- Unknown source operator spelling returns `PROOF_MIR_INVALID_STATEMENT_OPERATOR`.
- Object expressions allocate a place when they contain proof-relevant, aggregate, borrowed, or field-updated values.
- Produced operands are shape-specific: value, place, or value-and-place.

**Code Examples:**

```ts
test("comparison expression records closed operator and result value", () => {
  const lowered = lowerProofMirExpressionForTest("value >= 2", {
    locals: [{ name: "value", type: "u8", storage: "scalarSsa" }],
  });

  expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("comparison");
  expect(
    lowered.statements.find((statement) => statement.kind.kind === "comparison"),
  ).toMatchObject({
    kind: { kind: "comparison", operator: "ge" },
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/expression-lowerer.test.ts
```

---

### Task 21: Statement Lowerer For Basic Statements And Function Exits

**Description:** Lower blocks, lets, assignments, expression statements, ordinary returns, terminal returns, panic exits where represented by mono/runtime lowering, and unreachable/error statements.

**Dependencies:** Tasks 9, 13, 14, 18A, and 19C.

**Files:**

- Create: `src/proof-mir/lower/statement-lowerer.ts`
- Create: `src/proof-mir/lower/terminal-lowerer.ts`
- Test: `tests/unit/proof-mir/statement-lowerer.test.ts`
- Test: `tests/unit/proof-mir/terminal-lowerer.test.ts`

**Acceptance Criteria:**

- `let` with scalar SSA target records a current value definition.
- `let` or assignment to place-backed target emits `store`, `movePlace`, or `consumePlace` according to operand role.
- Assignments never overwrite proof-relevant resources without an explicit operation.
- Expression statements lower their expression and discard unused results without deleting side effects.
- Ordinary returns create return terminator, `returnExit` edge, exit record, and function-exit closure policy with terminal reachability not required.
- Terminal returns use terminal closure policy with terminal reachability required.
- Reachable mono `error` statements return `PROOF_MIR_REACHABLE_MONO_ERROR`.

**Code Examples:**

```ts
test("ordinary return creates explicit function exit policy", () => {
  const lowered = lowerProofMirFunctionForSource([
    "fn value() -> u8:",
    "    return 1",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ]);

  expect(lowered.exits).toContainEqual(
    expect.objectContaining({
      kind: "ordinaryReturn",
      boundary: { kind: "function", unwind: "none" },
      closure: expect.objectContaining({
        kind: "functionExit",
        terminalReachability: "notRequired",
      }),
    }),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/statement-lowerer.test.ts ./tests/unit/proof-mir/terminal-lowerer.test.ts
```

---

### Task 22: Extension Gate Rejection Utilities

**Description:** Add only the default fail-closed extension-gate checks for coroutine yield, stream loops, and cross-core ownership. Enabled extension validators are not part of the initial core builder plan because the design requires corresponding proof-semantics rules and mono metadata before they can be wired.

**Dependencies:** Tasks 9, 13, 14, and 18.

**Files:**

- Create: `src/proof-mir/extensions/extension-gates.ts`
- Test: `tests/unit/proof-mir/extensions.test.ts`

**Acceptance Criteria:**

- `rejectUnsupportedProofMirExtensionConstruct` accepts a construct kind, target feature list, optional mono metadata availability flag, and origin context.
- Coroutine `yield` without an enabled `coroutineYield` feature returns `PROOF_MIR_MISSING_SEMANTICS_GATE`.
- Stream `for` without an enabled `streamLoop` feature returns `PROOF_MIR_MISSING_SEMANTICS_GATE`.
- Cross-core constructs without mono concurrency metadata return `PROOF_MIR_MISSING_CONCURRENCY_METADATA`.
- The file does not define enabled extension validators, frame convergence checks, stream convergence checks, or transfer legality checks.
- The unit tests call the gate utility directly and do not import `buildProofMir`.

**Code Examples:**

```ts
test("yield is rejected when coroutine semantics are not enabled", () => {
  const result = rejectUnsupportedProofMirExtensionConstruct({
    construct: "coroutineYield",
    targetFeatures: [],
    monoMetadataAvailable: false,
    origin: proofMirOriginForTest("yield"),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/extensions.test.ts
```

---

### Task 23: If/Else Branch And Scalar Join Lowerer

**Description:** Implement the first control-flow lowering slice: `if` statements, condition branches, branch-local facts, arm blocks, optional join blocks, and scalar edge arguments.

**Dependencies:** Tasks 19C, 20, and 21.

**Files:**

- Create: `src/proof-mir/lower/if-lowerer.ts`
- Test: `tests/unit/proof-mir/if-lowerer.test.ts`

**Acceptance Criteria:**

- `if` lowers to condition value, branch terminator, true/false edges, arm blocks, and join block when needed.
- Comparison branch facts live on the true and false `ProofMirControlEdge` records.
- False-edge comparison facts use the deterministic complement table from Task 12.
- Joins use block parameters and edge arguments only for copy scalar SSA values.
- Join arguments are stored on predecessor edges, not on block targets.
- If one branch exits, the continuing branch targets the next block without creating an unused join parameter.
- Tests call `lowerProofMirIfStatementForTest` or `lowerProofMirControlFlowForTest` directly and do not import `buildProofMir`.

**Code Examples:**

```ts
test("if scalar join uses edge arguments on predecessor edges", () => {
  const lowered = lowerProofMirIfStatementForTest({
    source: ["let x = 0", "if flag:", "    x = 1", "else:", "    x = 2", "return x"],
    scalarLocals: ["flag", "x"],
  });

  expect(lowered.join?.parameters.map((parameter) => parameter.parameterKind.kind)).toEqual([
    "copyScalar",
  ]);
  expect(lowered.edgesTo(lowered.join!.blockKey).map((edge) => edge.arguments.length)).toEqual([
    1, 1,
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/if-lowerer.test.ts
```

---

### Task 24: Loop Header, Back-Edge, Break, And Continue Lowerer

**Description:** Extend the control-flow lowerer with `while`, infinite `loop`, loop headers, loop condition branches, loop back-edges, loop exits, scalar loop-carried parameters, and `break`/`continue` edge metadata.

**Dependencies:** Task 23.

**Files:**

- Create: `src/proof-mir/lower/loop-lowerer.ts`
- Test: `tests/unit/proof-mir/loop-lowerer.test.ts`

**Acceptance Criteria:**

- `while` lowers to header, condition block or header condition terminator, body block, back-edge, and exit block.
- Infinite `loop` lowers to a loop header/body with explicit break exits and back-edge.
- Loop-carried copy scalar locals become deterministic loop-header block parameters before body lowering.
- Predeclared loop-header parameters win over on-demand incomplete SSA parameters.
- Loop resource state is named in `ProofMirResourceBoundarySet`, never carried through scalar block parameters.
- `break` emits a `scopeBreak` edge to the loop exit with crossed scopes.
- `continue` emits a `scopeContinue` edge to the loop continue/header target with crossed scopes and scalar loop-carried arguments.

**Code Examples:**

```ts
test("while loop predeclares loop-carried scalar parameter", () => {
  const lowered = lowerProofMirLoopForTest({
    source: ["let i = 0", "while i < 3:", "    i = i + 1", "return i"],
    loopCarriedLocals: ["i"],
  });

  expect(lowered.header.parameters.map((parameter) => parameter.parameterKind.kind)).toEqual([
    "copyScalar",
  ]);
  expect(lowered.backEdge.arguments).toHaveLength(1);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/loop-lowerer.test.ts
```

---

### Task 25: Match, Switch, And Scope-Exit Control-Flow Lowerer

**Description:** Complete the core structured control-flow lowerer with ordinary match/switch lowering, exhaustive-fallback checks, switch case edges, and non-loop scope-exit edge metadata.

**Dependencies:** Task 23.

**Files:**

- Create: `src/proof-mir/lower/match-lowerer.ts`
- Test: `tests/unit/proof-mir/match-lowerer.test.ts`

**Acceptance Criteria:**

- Ordinary match lowers to a `switch` terminator with deterministic case ordering from mono arm order.
- A `switch` without fallback requires mono exhaustiveness evidence.
- Missing exhaustiveness evidence returns `PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS`.
- Match arm scopes are represented as child scopes when arms own locals or resources.
- Arm exits record crossed scopes using the scope-tree algorithm from Task 13.
- Match refinements are recorded as edge-local facts when mono proof metadata supplies them.

**Code Examples:**

```ts
test("non-exhaustive switch without mono evidence is rejected", () => {
  const result = lowerProofMirMatchForTest({
    scrutinee: "kind",
    cases: ["Arp"],
    monoExhaustive: false,
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/match-lowerer.test.ts
```

---

### Task 26: Call Lowering With Source And Platform Targets

**Description:** Lower mono call expressions to Proof MIR calls, call graph edges, call-site requirements, source-function targets, certified-platform targets, ABI references, platform ensured facts, and runtime-call contracts for compiler-introduced calls.

**Dependencies:** Tasks 11, 19C, and 20.

**Files:**

- Create: `src/proof-mir/lower/call-lowerer.ts`
- Test: `tests/unit/proof-mir/call-lowerer.test.ts`

**Acceptance Criteria:**

- Calls evaluate receiver and arguments in checked parameter order through dependency-injected expression-lowering callbacks.
- Observe operands may be value, place, or value-and-place.
- Consume operands must be place or value-and-place.
- Source-function calls reference `ProofMirCallTarget.kind === "sourceFunction"` and matching function ABI facts.
- Certified-platform calls reference `ProofMirCallTarget.kind === "certifiedPlatform"`, platform edge ID, primitive ID, and platform ABI facts.
- Call graph edges use `ProofMirOwnedCallId` and match the call statement target.
- Call-site requirement IDs are preserved from mono proof metadata.
- Platform ensured facts become `trustedAxiom` facts with platform-edge dependency.
- Compiler-runtime call instantiation maps runtime schemas to owned places, facts, and effects and checks target availability.

**Code Examples:**

```ts
test("certified platform call keeps contract edge and ABI reference", () => {
  const lowered = lowerProofMirCallForTest(platformCallLowererFixture());

  expect(lowered.call.target).toMatchObject({ kind: "certifiedPlatform" });
  expect(lowered.platformEdges).toHaveLength(1);
  expect(lowered.callGraphEdges[0]?.target).toEqual(lowered.call.target);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/call-lowerer.test.ts
```

---

### Task 27: Validated-Buffer Read And Layout-Term Lowering

**Description:** Lower validated-buffer source-length reads, packet field reads, payload end computations, derived field values, and layout-term/value bindings with concrete layout fact references.

**Dependencies:** Tasks 10, 12, 19C, and 20.

**Files:**

- Create: `src/proof-mir/lower/validated-buffer-read-lowerer.ts`
- Test: `tests/unit/proof-mir/validated-buffer-read-lowerer.test.ts`

**Acceptance Criteria:**

- Source length values emit `bindLayoutTerm` statements connected to `validatedBufferSourceLength`.
- Validated-buffer field reads emit `readValidatedBufferField` with source place, optional packet place, validated-buffer instance ID, field ID, layout field reference, offset term, end term, term bindings, read requirement fact IDs, result value, and origin.
- Read requirement facts are derived from the layout field's deterministic `readRequires` array.
- Offset/end/read-requirement terms resolve through `ProofMirLayoutTermPath`.
- Dynamic payload/end terms can be bound to runtime SSA values.
- The lowerer never recomputes offsets, sizes, endianness, read policy, or requirement expressions.

**Code Examples:**

```ts
test("validated-buffer read references layout field and read requirements", () => {
  const lowered = lowerProofMirValidatedBufferReadForTest(validatedBufferReadLowererFixture());

  expect(lowered.statement.kind).toMatchObject({
    kind: "readValidatedBufferField",
    read: expect.objectContaining({
      layoutField: expect.objectContaining({ kind: "validatedBufferField" }),
    }),
  });
  expect(lowered.readRequirements.map((fact) => fact.kind.kind)).toContain("layoutFits");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/validated-buffer-read-lowerer.test.ts
```

---

### Task 28: Validation Split Lowering

**Description:** Lower validation creation and validation matches into explicit `validate` statements, ok/err split edges, payload bindings, packet places, and validation edge effects.

**Dependencies:** Tasks 12, 13, 19C, and 20.

**Files:**

- Create: `src/proof-mir/lower/validation-lowerer.ts`
- Test: `tests/unit/proof-mir/validation-lowerer.test.ts`

**Acceptance Criteria:**

- Validation creation records validation ID, source place, pending result place, ok packet place, optional payload places, ok/err payload types, validated-buffer instance ID, layout reference, and origin.
- Validation match lowers to `matchValidation` terminator with distinct ok and err targets.
- Ok edge consumes pending result, consumes source, introduces packet/payload, and carries validation evidence facts.
- Err edge consumes pending result, introduces error payload only when materialized, and leaves source live.
- Ok/err arm bindings map mono arm locals to operands visible only on the corresponding edge.
- Missing validation arm metadata returns `PROOF_MIR_INVALID_VALIDATION_BINDING`; inconsistent ok/err edge effects return `PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS`.

**Code Examples:**

```ts
test("validation ok edge consumes source and introduces packet", () => {
  const lowered = lowerProofMirValidationMatchForTest(validationLowererFixture());

  expect(lowered.okEdge.effects.map((effect) => effect.kind)).toEqual([
    "consumePlace",
    "consumePlace",
    "introducePlace",
  ]);
  expect(lowered.errEdge.effects.map((effect) => effect.kind)).toEqual(["consumePlace"]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/validation-lowerer.test.ts
```

---

### Task 29: Attempt Split Lowering

**Description:** Lower arbitrary fallible attempt expressions, alternatives, pending result places, success/error edge effects, and `matchAttempt` terminators.

**Dependencies:** Tasks 12, 13, 19C, and 20.

**Files:**

- Create: `src/proof-mir/lower/attempt-lowerer.ts`
- Test: `tests/unit/proof-mir/attempt-lowerer.test.ts`

**Acceptance Criteria:**

- Fallible expressions are lowered through a dependency-injected ordinary expression lowerer first, preserving nested calls, validation, inner attempts, block temporaries, and method chains.
- `ProofMirAttemptStart.fallible` records the final lowered result operand for the fallible expression.
- Alternative expressions are recorded when present.
- Pending result place allocation is deterministic at the attempt statement's place-root allocation point.
- Success and error edges carry edge effects for pending-result consumption and source-declared transfers.
- The attempt record does not enumerate producer calls or run reaching-definition dataflow.
- Missing attempt operand returns `PROOF_MIR_INVALID_ATTEMPT_OPERAND`.

**Code Examples:**

```ts
test("attempt records arbitrary lowered fallible expression operand", () => {
  const lowered = lowerProofMirAttemptForTest(attemptWithBranchyFallibleExpressionFixture());

  expect(lowered.statement.kind).toMatchObject({
    kind: "attempt",
    attempt: expect.objectContaining({
      fallible: expect.objectContaining({ result: expect.any(Object) }),
    }),
  });
  expect(lowered.successEdge.kind).toBe("attemptSuccess");
  expect(lowered.errorEdge.kind).toBe("attemptError");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/attempt-lowerer.test.ts
```

---

### Task 30: Take, Session, Obligation, And Terminal Lowering

**Description:** Lower take forms, session members, brands, obligations, open/close/discharge operations, take body scope exits, terminal calls, and terminal closure metadata.

**Dependencies:** Tasks 12, 13, 19C, and 21.

**Files:**

- Create: `src/proof-mir/lower/take-lowerer.ts`
- Modify: `src/proof-mir/lower/terminal-lowerer.ts`
- Test: `tests/unit/proof-mir/take-lowerer.test.ts`
- Test: `tests/unit/proof-mir/terminal-lowerer.test.ts`

**Acceptance Criteria:**

- Take lowering evaluates the operand and opens the closure obligation.
- Stream and validated-buffer take forms open session members with session ID, brand ID, optional obligation ID, optional place, and origin.
- Take alias locals bind to place-backed storage when present.
- Take body exits emit scope-exit edges with crossed scopes and allowed transfers.
- Close-session-member and discharge-obligation statements are emitted only from explicit mono proof metadata sites.
- Terminal calls preserve terminal call IDs and closure obligation IDs from mono.
- Terminal returns have function-exit closure policy with terminal reachability required.

**Code Examples:**

```ts
test("take lowering records session member separately from obligation", () => {
  const lowered = lowerProofMirTakeForTest(takeLowererFixture());

  expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("openSessionMember");
  expect(lowered.statements.map((statement) => statement.kind.kind)).toContain("openObligation");
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/take-lowerer.test.ts ./tests/unit/proof-mir/terminal-lowerer.test.ts
```

---

### Task 30A: Ordinary Iterator For Lowering

**Description:** Lower ordinary `for` loops that use the checked iterator protocol into explicit iterator setup, protocol calls, loop shape, item/finished/error edges, and finish/close obligations. Stream `for` remains semantics-gated by Task 22.

**Dependencies:** Tasks 24 and 26.

**Files:**

- Create: `src/proof-mir/lower/iterator-lowerer.ts`
- Test: `tests/unit/proof-mir/iterator-lowerer.test.ts`

**Acceptance Criteria:**

- Ordinary `for` evaluates the iterable expression once and binds the iterator place or iterator state object before loop entry.
- Mono-recorded iterator obligations or call-site requirements are opened before the loop header.
- The loop header, body, back-edge, and exit reuse Task 24 loop lowering; iterator/resource state remains in places, obligations, and boundary sets rather than scalar block parameters.
- Each iteration lowers the checked iterator `next` operation through Task 26 call lowering as a source, platform, or compiler-runtime call according to mono target identity.
- The `next` result splits into item-present, finished, and fallible-error edges when the protocol is fallible.
- Item-present edges introduce the item binding and carry any iterator evidence facts recorded by mono.
- Finished edges record finish/close requirements and prove the iterator obligation is closed or intentionally transferred on every loop exit.
- Stream `for` inputs return `PROOF_MIR_MISSING_SEMANTICS_GATE` and are not lowered by this task.

**Code Examples:**

```ts
test("ordinary iterator for lowers next result into item and finished edges", () => {
  const lowered = lowerProofMirOrdinaryForForTest({
    source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
    iteratorProtocol: "checkedIterator",
  });

  expect(lowered.header.kind).toBe("loopHeader");
  expect(lowered.nextCall.target.kind).toBe("sourceFunction");
  expect(lowered.itemEdge.effects.map((effect) => effect.kind)).toContain("introducePlace");
  expect(lowered.finishedEdge.facts.map((fact) => fact.kind.kind)).toContain("runtimeEnsured");
});
```

```ts
test("stream for remains gated in the core lowerer", () => {
  const result = lowerProofMirOrdinaryForForTest({
    source: ["for event in stream packets:", "    take event"],
    iteratorProtocol: "stream",
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/iterator-lowerer.test.ts
```

---

### Task 31: Build Input Compatibility Validator

**Description:** Implement the pure build-boundary validator that checks mono, layout, target, runtime catalog, image, root, ABI, platform edge, field, validated-buffer, image-device, and provenance key compatibility before any function lowering runs.

**Dependencies:** Tasks 1, 2, 3, 10, 11, and 18.

**Files:**

- Create: `src/proof-mir/validation/input-compatibility-validator.ts`
- Test: `tests/unit/proof-mir/input-compatibility-validator.test.ts`

**Acceptance Criteria:**

- Target ID mismatch between input target and layout returns `PROOF_MIR_INPUT_LAYOUT_MISMATCH`.
- Runtime catalog target/features mismatch returns `PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY`.
- Missing executable image entry returns `PROOF_MIR_MISSING_IMAGE_ENTRY`.
- Missing or invalid external roots return `PROOF_MIR_MISSING_EXTERNAL_ROOTS` or `PROOF_MIR_INVALID_EXTERNAL_ROOT`.
- Type, field, validated-buffer, function ABI, platform edge, and image-device key set mismatches return `PROOF_MIR_LAYOUT_KEY_SET_MISMATCH` or the narrower missing-layout diagnostic named by the design.
- Reachable `bodylessRecovery` functions return `PROOF_MIR_MISSING_FUNCTION_BODY`.
- The validator reports all independent compatibility diagnostics in deterministic order and does not create a partial `ProofMirProgram`.

**Code Examples:**

```ts
test("stale layout target is rejected before function lowering", () => {
  const input = closedProofMirFixture();
  const diagnostics = validateProofMirBuildInputCompatibility({
    ...input,
    target: {
      ...input.target,
      targetId: targetId("different-target"),
    },
  });

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/input-compatibility-validator.test.ts
```

---

### Task 32: Builder Function Orchestration And Draft Failure Policy

**Description:** Implement internal builder orchestration that iterates reachable source-bodied functions, invokes the lowerers, abandons failed function drafts, and preserves batch diagnostics without yet exposing a frozen public `ProofMirProgram`.

**Dependencies:** Tasks 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 30A, and 31.

**Files:**

- Create: `src/proof-mir/proof-mir-builder.ts`
- Test: `tests/unit/proof-mir/proof-mir-builder-orchestration.test.ts`

**Acceptance Criteria:**

- `buildProofMirDraftProgramForTest` or an equivalent internal helper validates input compatibility first.
- Source-bodied functions are lowered in `program.functions.entries()` deterministic order.
- Certified platform functions are skipped as source bodies and remain available to call-target verification.
- A construction error in one source-bodied function abandons that function draft and continues with later reachable functions.
- If any function fails, the helper returns diagnostics plus trace context and no usable draft program.
- The helper never synthesizes values, places, edges, facts, calls, or unreachable blocks to continue after a failed node.
- Tests call the internal orchestration helper directly and do not require `buildProofMir` to return `kind: "ok"`.

**Code Examples:**

```ts
test("function draft failure does not stop later function diagnostics", () => {
  const result = buildProofMirDraftProgramForTest(twoFailingFunctionsProofMirFixture());

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "function:first:statement:3",
    "function:second:statement:7",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/proof-mir/proof-mir-builder-orchestration.test.ts
```

---

### Task 33: Public Builder Freeze, Validation, And Exports

**Description:** Complete the public `buildProofMir` API by freezing successful drafts, running structural validators, enforcing output/error policy, and exporting the Proof MIR namespace through public barrels.

**Dependencies:** Tasks 15, 16, 17, 31, and 32.

**Files:**

- Modify: `src/proof-mir/proof-mir-builder.ts`
- Modify: `src/proof-mir/index.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/proof-mir/proof-mir-builder.test.ts`
- Test: `tests/integration/proof-mir/public-api.test.ts`
- Test: `tests/integration/public-api.test.ts`

**Acceptance Criteria:**

- `BuildProofMirInput`, `ProofMirBuildTargetContext`, `BuildProofMirResult`, and `buildProofMir` match the public API in the design.
- Public `buildProofMir` returns `kind: "error"` with no `mir` when compatibility, lowering, freeze, or structural validation emits any error diagnostic.
- Public `buildProofMir` returns `kind: "ok"` only after successful draft lowering, canonical freeze, and all core structural validators pass.
- Successful output includes `image`, `functions`, `layout`, `proofMetadata`, `origins`, `facts`, `layoutTerms`, `privateStateGenerations`, `callGraph`, `platformEdges`, `runtimeCatalog`, and `runtimeCalls`.
- `src/proof-mir/index.ts` exports `buildProofMir`, input/result types, diagnostics, IDs, and model types.
- `src/index.ts` exports `proofMir` without removing existing public namespaces.

**Code Examples:**

```ts
test("public barrel exports Proof MIR builder", async () => {
  const api = await import("../../../src");

  expect(api.proofMir.buildProofMir).toBeFunction();
});
```

```ts
test("successful minimal program returns frozen Proof MIR", () => {
  const result = buildProofMir(closedProofMirFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.mir.image.externalRoots.map((root) => root.reason)).toContain("imageEntry");
});
```

**Verification:**

```bash
bun test ./tests/integration/proof-mir/proof-mir-builder.test.ts ./tests/integration/proof-mir/public-api.test.ts ./tests/integration/public-api.test.ts
```

---

### Task 34A: Integration Coverage For CFG And Explicit Exits

**Description:** Add end-to-end integration tests that prove the public builder emits explicit CFG and exit shapes for branches, loops, matches, returns, terminal returns, loop exits, and panic/abort where represented by current mono/runtime lowering.

**Dependencies:** Task 33.

**Files:**

- Test: `tests/integration/proof-mir/cfg-shape.test.ts`
- Test: `tests/integration/proof-mir/explicit-exits.test.ts`

**Acceptance Criteria:**

- Nested branch program snapshots show explicit branch edges, join blocks, block parameters, and edge arguments.
- Explicit exit snapshots show ordinary return, terminal return, scope break, scope continue, and panic/abort where represented.
- Loop snapshots show loop headers, back-edges, scalar loop-carried parameters, and resource boundary references.
- Match snapshots show deterministic switch cases, fallback/exhaustiveness behavior, and arm scope exits.
- Tests use public `buildProofMir` and `proofMirSummary`; they do not inspect draft-only APIs.

**Code Examples:**

```ts
test("branch and loop shape keeps joins and loop-carried values explicit", () => {
  const result = buildProofMir(branchAndLoopProofMirFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(proofMirSummary(result.mir)).toMatchSnapshot();
});
```

**Verification:**

```bash
bun test ./tests/integration/proof-mir/cfg-shape.test.ts ./tests/integration/proof-mir/explicit-exits.test.ts
```

---

### Task 34B: Integration Coverage For Validation, Attempts, And Resources

**Description:** Add end-to-end integration tests that prove the public builder emits explicit validation, attempt, take/session/obligation, and resource-operation shapes.

**Dependencies:** Task 33.

**Files:**

- Test: `tests/integration/proof-mir/validation-and-attempt-splits.test.ts`
- Test: `tests/integration/proof-mir/resource-operation-lowering.test.ts`

**Acceptance Criteria:**

- Validation snapshots show validate statement, matchValidation terminator, ok/err edge effects, and arm bindings.
- Attempt snapshots show attempt statement, matchAttempt terminator, success/error edge effects, and arbitrary expression operand.
- Resource snapshots show load, store, move, consume, borrow, release, open/close session member, open/discharge obligation, and take body exits.
- Terminal-resource snapshots show function-exit closure policy with terminal reachability required when terminal calls are present.
- Tests use public `buildProofMir` and `proofMirSummary`; they do not inspect draft-only APIs.

**Code Examples:**

```ts
test("validation and attempt splits preserve edge-local bindings", () => {
  const result = buildProofMir(validationAttemptProofMirFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(proofMirSummary(result.mir)).toMatchSnapshot();
});
```

**Verification:**

```bash
bun test ./tests/integration/proof-mir/validation-and-attempt-splits.test.ts ./tests/integration/proof-mir/resource-operation-lowering.test.ts
```

---

### Task 34C: Integration Coverage For Layout, Platform Calls, And Ordinary Iterators

**Description:** Add end-to-end integration tests that prove the public builder emits layout fact references, platform call records, and ordinary checked iterator protocol lowering.

**Dependencies:** Task 33.

**Files:**

- Test: `tests/integration/proof-mir/layout-fact-references.test.ts`
- Test: `tests/integration/proof-mir/platform-call-lowering.test.ts`
- Test: `tests/integration/proof-mir/iterator-protocol.test.ts`

**Acceptance Criteria:**

- Layout snapshots show bindLayoutTerm, readValidatedBufferField, layout fact references, layout term paths, and read requirement facts.
- Platform snapshots show certified platform call target, call graph edge, platform edge table, ABI reference, and trusted platform facts.
- Iterator snapshots show ordinary `for` lowering with iterator setup, checked `next` call, item-present edge, finished edge, optional error edge, and finish/close obligation evidence.
- Stream `for` integration returns a deterministic `PROOF_MIR_MISSING_SEMANTICS_GATE` diagnostic and no successful Proof MIR.
- Tests use public `buildProofMir` and `proofMirSummary`; they do not inspect draft-only APIs.

**Code Examples:**

```ts
test("worked read-tag shape keeps layout read and platform call facts explicit", () => {
  const result = buildProofMir(readTagWorkedExampleFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(proofMirSummary(result.mir)).toMatchSnapshot();
});
```

**Verification:**

```bash
bun test ./tests/integration/proof-mir/layout-fact-references.test.ts ./tests/integration/proof-mir/platform-call-lowering.test.ts ./tests/integration/proof-mir/iterator-protocol.test.ts
```

---

### Task 35: Determinism, Public API, And Dependency-Boundary Tests

**Description:** Verify byte-for-byte deterministic Proof MIR snapshots, deterministic diagnostics, public exports, and dependency boundaries.

**Dependencies:** Task 33.

**Files:**

- Test: `tests/integration/proof-mir/determinism.test.ts`
- Test: `tests/integration/proof-mir/public-api.test.ts`
- Test: `tests/integration/public-api.test.ts`
- Modify: `scripts/check-policy.ts`

**Acceptance Criteria:**

- Equivalent mono/layout inputs with shuffled construction order produce identical `proofMirSummary` output.
- Diagnostics sort deterministically across shuffled error discovery order.
- Public API tests confirm `src/proof-mir/index.ts` and `src/index.ts` exports added in Task 33.
- Policy checks confirm `src/proof-mir/**` rejects imports from `src/frontend/**`, `src/lexer/**`, `src/parser/**`, `src/semantic/names/**`, `src/semantic/item-index/**`, `src/proof/**`, `src/codegen/**`, `src/linker/**`, AArch64 modules, PE/COFF modules, `bun:*`, `fs`, `node:fs`, `path`, `node:path`, `os`, `node:os`, `process`, and `node:process`.
- Policy checks allow `src/proof-mir/**` imports from pure compiler data/model modules it consumes: `src/mono/**`, `src/layout/**`, `src/hir/**` ID/origin/type records, `src/semantic/ids/**`, `src/semantic/surface/type-model/**`, `src/semantic/surface/resource-kind/**`, `src/runtime/**`, `src/target/target-runtime-selection.ts`, and `src/shared/**`.
- This task does not own public barrel source edits; failures here should point back to Task 33.

**Code Examples:**

```ts
test("deterministic snapshots survive shuffled function table construction", () => {
  const first = buildProofMir(shuffledProofMirInputFixture({ shuffle: "abc" }));
  const second = buildProofMir(shuffledProofMirInputFixture({ shuffle: "cba" }));

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;

  expect(proofMirSummary(first.mir)).toBe(proofMirSummary(second.mir));
});
```

```ts
const proofMirImportForbiddenPatterns = [
  /from\s+["'][^"']*\/frontend\//,
  /from\s+["'][^"']*\/lexer\//,
  /from\s+["'][^"']*\/parser\//,
  /from\s+["'][^"']*\/semantic\/names\//,
  /from\s+["'][^"']*\/semantic\/item-index\//,
  /from\s+["'][^"']*\/proof\//,
  /from\s+["'][^"']*\/codegen\//,
  /from\s+["'][^"']*\/linker\//,
  /from\s+["'][^"']*(aarch64|pe-coff)/i,
  /from\s+["'](?:bun:|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
] as const;
```

**Verification:**

```bash
bun test ./tests/integration/proof-mir/determinism.test.ts ./tests/integration/proof-mir/public-api.test.ts ./tests/integration/public-api.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run policy:check
```

---

### Task 36: Formatting And Full Handoff Verification

**Description:** Run formatting and whole-repository verification after all implementation and integration tasks have landed.

**Dependencies:** Tasks 34A, 34B, 34C, and 35.

**Files:**

- Modify: any test snapshots produced by Task 34A, 34B, 34C, or 35

**Acceptance Criteria:**

- Every Proof MIR test file uses fakes through dependency injection and does not mock modules.
- Formatting is applied to new and modified files.
- Full repository handoff command passes.
- Any remaining warnings are documented as pre-existing or fixed before handoff.

**Code Examples:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun run format
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun run format
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

## Self-Review Checklist

- [ ] Every production contract in `docs/design/proof-mir-builder-design.md` has a task: upstream mono roots and call targets, runtime catalog, model, draft records, canonicalization, origins, CFG, SSA, locals, scopes, places, statements, terminators, calls, facts, private-state generations, layout bindings, validated-buffer reads, validation, attempt, ordinary iterator protocol lowering, take/session/obligation, extension gates, validators, diagnostics, determinism, and public API.
- [ ] Every task has concrete description, dependencies, files, acceptance criteria, code examples, and verification commands.
- [ ] Every task lands tests and implementation rather than exploratory-only notes.
- [ ] Semantics-gated feature areas fail closed in the core builder; enabled extension validators are outside this core implementation because the design requires proof-semantics rules and mono metadata before they can be wired.
- [ ] No task asks workers to add filesystem, Bun, parser, AST, proof checker, target backend, AArch64, linker, or PE/COFF dependencies to runtime Proof MIR source.
- [ ] Final handoff runs `PATH="$HOME/.bun/bin:$PATH" bun run agent:check` when Bun is not already on `PATH`.
