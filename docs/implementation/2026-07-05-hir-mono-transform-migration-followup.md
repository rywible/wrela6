# HIR Mono Transform Migration Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the previously backed-out WCR-34 and WCR-54 through WCR-57 transform migration by making the live mono cloners use one production transform context and one traversal/remap model.

**Architecture:** Do not reintroduce a broad HIR traversal framework as speculative scaffolding. Extend the existing `MonoTransformContext` into the production clone context, migrate the live expression, call, statement, place, take, and validation cloners to that context, and then delete or audit every legacy hand-rolled traversal entry point that remains.

**Tech Stack:** TypeScript, Bun test runner, existing HIR/mono runtime modules, existing typed HIR and monomorphization fixtures, no new runtime dependencies.

---

## Background

The 2026-07-05 review fix branch intentionally backed out the inert HIR traversal/transform files because they had no runtime consumer and made WCR-34 and WCR-54 through WCR-57 look more complete than they were. That was the correct approval fix for that branch.

This follow-up plan is the real migration. It is worth doing only if each new abstraction immediately owns production work. A task that creates or extends transform plumbing must migrate at least one live cloner in the same task.

## Current Source Map

- `src/mono/mono-transform-context.ts` owns mutable mono remap storage, resource-kind concretization context, outgoing edges, and diagnostics.
- `src/mono/function-instantiator-body.ts` creates the transform context before cloning a body.
- `src/mono/function-expression-cloner.ts` clones HIR expressions to mono expressions and currently passes `remap`, `context`, `outgoingEdges`, and `diagnostics` through many recursive calls.
- `src/mono/function-call-cloner.ts` clones call expressions and call arguments, and currently calls `cloneExpression` directly.
- `src/mono/function-statement-cloner.ts` clones blocks and statements, and currently calls `cloneExpression`, `cloneBlock`, `cloneResourcePlace`, and validation helpers directly.
- `src/mono/function-place-cloner.ts` clones resource places, take operands, take kinds, checked types, resource kinds, and proof IDs.
- `src/mono/function-validation-statement-cloner.ts` clones validation-match statements and currently calls expression and match-arm cloners directly.
- `src/hir/checked-type-transform.ts` is the only HIR transform-like adapter that survived review because `src/hir/generic-substitution.ts` is a real production consumer.
- `tests/audit/mono-maintainability-audit.test.ts` already guards mono file size, remap-map centralization, and recursive traversal growth.

## Migration Rules

- Keep `src/hir/checked-type-transform.ts` focused on checked types and resource kinds. Do not rename it to a general HIR transform module in this plan.
- Do not add `src/hir/traversal.ts`, `src/hir/transform.ts`, or `src/hir/transform-context.ts` unless a task also migrates a production mono cloner to use the new code in the same commit.
- Prefer a mono-specific transform facade over a generic HIR-to-HIR framework, because the live migration target maps HIR nodes into Mono nodes.
- Keep filesystem access out of runtime code.
- Keep runtime source dependency-free.
- Keep each touched runtime file under the current subsystem line-count caps. If a migrated file grows past its cap, split helper code in the same task.
- Run `bun run agent:check` before final handoff.

## Definition Of Done

- WCR-34 status can move from `Not started` only after the traversal primitive has at least one production mono cloner consumer.
- WCR-54 must not be marked `Fixed` by this mono-specific plan unless the implementation also adds a real production HIR-to-HIR transform adapter. The expected closure for this plan is `Superseded by mono-specific transform context`, because the live migration target maps HIR nodes into Mono nodes rather than HIR nodes back into HIR nodes.
- WCR-55 status can move from `Not started` only after expression and call cloners use the shared transform context.
- WCR-56 status can move from `Not started` only after statement, place, take, and validation cloners use the shared transform context.
- WCR-57 status can move from `Not started` only after audits reject new unmanaged traversal/remap paths.
- `bun run agent:check` passes.

## Dependency And Parallel Lane Model

HMT-01 is the serial baseline prelude. HMT-02 is the only shared-contract task and must land before parallel cloner lanes start. HMT-03, HMT-04, and HMT-05 are intentionally parallel lanes: each keeps any legacy wrapper it still needs, owns a disjoint runtime file set, and leaves cross-lane wrapper deletion to HMT-06.

| Task   | Depends                | Lane                            | Runtime File Ownership                                                                                                                                   |
| ------ | ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HMT-01 | None                   | baseline-fixtures               | None                                                                                                                                                     |
| HMT-02 | HMT-01                 | shared-context-contract         | `mono-transform-context.ts`, `function-instantiator-shell.ts`, `function-instantiator-body.ts`, first `function-statement-cloner.ts` context entry point |
| HMT-03 | HMT-02                 | expression-call                 | `function-expression-cloner.ts`, `function-call-cloner.ts`                                                                                               |
| HMT-04 | HMT-02                 | statement-block                 | `function-statement-cloner.ts`                                                                                                                           |
| HMT-05 | HMT-02                 | place-take-validation-statement | `function-place-cloner.ts`, `function-validation-statement-cloner.ts`                                                                                    |
| HMT-06 | HMT-03, HMT-04, HMT-05 | integration-audit               | Cross-file wrapper deletion and final audits                                                                                                             |
| HMT-07 | HMT-06                 | status-closure                  | Docs only                                                                                                                                                |

---

## HMT-01: Add Mono Clone Migration Baseline Fixtures

**Files:**

- Create: `tests/support/mono/mono-transform-migration-fixtures.ts`
- Create: `tests/unit/mono/mono-transform-migration-baseline.test.ts`
- Modify: `tests/audit/mono-maintainability-audit.test.ts`

**Description:**

Add small, deterministic tests that lock current mono clone behavior before changing cloner internals. These tests are behavior baselines, not source-shape audits, so they should pass before the migration starts.

**Implementation Steps:**

- [ ] Create `tests/support/mono/mono-transform-migration-fixtures.ts` by composing existing mono fixtures that already contain a selected image root.

Use this file content:

```ts
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import {
  genericFunctionWithObligationProgramForMonoTest,
  monoSummary,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
} from "./monomorphization-fixtures";

type MonoWholeImageResult = ReturnType<typeof monomorphizeWholeImage>;

function expectMonoOk(label: string, result: MonoWholeImageResult): MonomorphizedHirProgram {
  if (result.kind !== "ok") {
    throw new Error(
      `${label} monomorphization failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(",")}`,
    );
  }
  return result.program;
}

export function monoTransformMigrationGenericProgramForTest(): MonomorphizedHirProgram {
  return expectMonoOk(
    "generic-call",
    monomorphizeWholeImage({
      program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
    }),
  );
}

export function monoTransformMigrationProofProgramForTest(): MonomorphizedHirProgram {
  return expectMonoOk(
    "proof-metadata",
    monomorphizeWholeImage({
      program: genericFunctionWithObligationProgramForMonoTest(),
    }),
  );
}

export function monoTransformMigrationSummariesForTest(): readonly string[] {
  return [
    monoSummary(
      monomorphizeWholeImage({
        program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
      }),
    ),
    monoSummary(
      monomorphizeWholeImage({
        program: genericFunctionWithObligationProgramForMonoTest(),
      }),
    ),
  ];
}
```

- [ ] Do not introduce a new inline source string in this baseline task. `twoCallSitesSameGenericInstanceProgramForMonoTest()` and `genericFunctionWithObligationProgramForMonoTest()` both lower real source through `lowerTypedHirForTest`, include `uefi image Boot:`, and are known to be valid inputs to `monomorphizeWholeImage`.

- [ ] Create `tests/unit/mono/mono-transform-migration-baseline.test.ts` with a deterministic summary test.

Use this test body:

```ts
import { expect, test } from "bun:test";
import {
  monoTransformMigrationGenericProgramForTest,
  monoTransformMigrationProofProgramForTest,
  monoTransformMigrationSummariesForTest,
} from "../../support/mono/mono-transform-migration-fixtures";

test("mono transform migration fixtures preserve cloned body identity and remaps", () => {
  const programs = [
    monoTransformMigrationGenericProgramForTest(),
    monoTransformMigrationProofProgramForTest(),
  ];
  const instanceIds = programs.flatMap((program) =>
    program.functions.entries().map((function_) => String(function_.instanceId)),
  );

  expect(instanceIds.length).toBeGreaterThan(0);
  expect(instanceIds.sort()).toMatchSnapshot();
  expect(monoTransformMigrationSummariesForTest()).toMatchSnapshot();
});
```

- [ ] Strengthen `tests/audit/mono-maintainability-audit.test.ts` with a comment-free source-shape helper that later tasks can reuse.

Add this helper near the other helpers:

```ts
function monoSource(path: string): string {
  return sourceText(`src/mono/${path}`);
}
```

- [ ] Run the baseline test and accept the new snapshots.

Run:

```bash
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts --update-snapshots
```

Expected: PASS and one snapshot file updated or created.

- [ ] Run the mono audit to confirm no source-shape rule changed yet.

Run:

```bash
bun test tests/audit/mono-maintainability-audit.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- The baseline test passes before any production cloner migration.
- The fixture uses the real parser, HIR lowering, and `monomorphizeWholeImage` path.
- The test does not import production internals beyond public or existing test-support helpers.

**Commit Message:**

```text
Add mono transform migration baselines -Codex Automated
```

---

## HMT-02: Add Production Mono Clone Context Facade

**Files:**

- Modify: `src/mono/mono-transform-context.ts`
- Modify: `src/mono/function-instantiator-shell.ts`
- Modify: `src/mono/function-instantiator-body.ts`
- Modify: `src/mono/function-statement-cloner.ts`
- Modify: `tests/unit/mono/function-cloner-context.test.ts`

**Description:**

Turn `MonoTransformContext` from a remap container into the production clone context facade. This task adds helper APIs and migrates one live production cloner entry point, `cloneBlockWithContext`, so the new plumbing is not inert.

**Implementation Steps:**

- [ ] In `src/mono/mono-transform-context.ts`, update imports so ID formulas can live in this module.

Use this import shape:

```ts
import type { HirExpressionId, HirLocalId, HirRequirementId, HirStatementId } from "../hir/ids";
import type { MonoDiagnostic } from "./diagnostics";
import type { MonoOutgoingEdge } from "./function-instantiator-body";
import { instantiatedHirId, type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoProofExpressionId,
  MonoStatementId,
} from "./mono-hir";
```

- [ ] Move `monoLocalIdFor`, `monoExpressionIdFor`, and `monoStatementIdFor` from `src/mono/function-instantiator-shell.ts` into `src/mono/mono-transform-context.ts`, then update `function-instantiator-shell.ts` to import those helpers from `./mono-transform-context`.

Move this implementation exactly once:

```ts
export function monoLocalIdFor(instanceId: MonoInstanceId, hirLocalId: HirLocalId): MonoLocalId {
  return instantiatedHirId(instanceId, hirLocalId);
}

export function monoExpressionIdFor(
  instanceId: MonoInstanceId,
  hirExpressionId: HirExpressionId,
): MonoExpressionId {
  return instantiatedHirId(instanceId, hirExpressionId);
}

export function monoStatementIdFor(
  instanceId: MonoInstanceId,
  hirStatementId: HirStatementId,
): MonoStatementId {
  return instantiatedHirId(instanceId, hirStatementId);
}
```

- [ ] Add transform facade helper methods to `src/mono/mono-transform-context.ts`.

Add these exports below `MonoTransformContext`:

```ts
export interface LegacyMonoCloneState {
  readonly remap: MutableMonoFunctionRemap;
  readonly resourceKinds: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}

export function monoTransformContextFromLegacyCloneState(
  input: LegacyMonoCloneState,
): MonoTransformContext {
  return {
    remap: input.remap,
    resourceKinds: input.resourceKinds,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  };
}

export function monoTransformLocalId(
  context: MonoTransformContext,
  sourceId: HirLocalId,
): MonoLocalId {
  const id = monoLocalIdFor(context.remap.instanceId, sourceId);
  context.remap.localRemap.set(sourceId, id);
  return id;
}

export function monoTransformExpressionId(
  context: MonoTransformContext,
  sourceId: HirExpressionId,
): MonoExpressionId {
  const id = monoExpressionIdFor(context.remap.instanceId, sourceId);
  context.remap.expressionRemap.set(sourceId, id);
  return id;
}

export function monoTransformStatementId(
  context: MonoTransformContext,
  sourceId: HirStatementId,
): MonoStatementId {
  const id = monoStatementIdFor(context.remap.instanceId, sourceId);
  context.remap.statementRemap.set(sourceId, id);
  return id;
}
```

- [ ] In `src/mono/function-instantiator-shell.ts`, remove the local imports of `instantiatedHirId`, `HirExpressionId`, `HirLocalId`, `HirStatementId`, `MonoExpressionId`, `MonoLocalId`, and `MonoStatementId` if they were only used by the moved helpers. Add this import instead:

```ts
import { monoExpressionIdFor, monoLocalIdFor, monoStatementIdFor } from "./mono-transform-context";
```

- [ ] Run `rg -n "function mono(Expression|Statement|Local)IdFor|export function mono(Expression|Statement|Local)IdFor" src/mono` and confirm the three helper definitions exist only in `src/mono/mono-transform-context.ts`.

- [ ] Add tests to `tests/unit/mono/function-cloner-context.test.ts` for all three ID helpers.

Update the existing imports to include the statement ID helper and the new facade functions:

```ts
import { hirExpressionId, hirLocalId, hirStatementId } from "../../../src/hir/ids";
import {
  createMonoTransformContext,
  monoTransformExpressionId,
  monoTransformLocalId,
  monoTransformRemap,
  monoTransformStatementId,
} from "../../../src/mono/mono-transform-context";
```

Use this test:

```ts
test("mono transform context allocates local expression and statement ids through one facade", () => {
  const instanceId = monoInstanceId("function:context<u8>");
  const remap: MonoFunctionRemap = {
    instanceId,
    localRemap: new Map(),
    expressionRemap: new Map(),
    statementRemap: new Map(),
    requirementIdRemap: new Map(),
    proofExpressionIdRemap: new Map(),
  };
  const context = createMonoTransformContext({
    remap,
    resourceKinds: {} as MonoResourceKindConcretizationContext,
  });

  const localId = monoTransformLocalId(context, hirLocalId(5));
  const expressionId = monoTransformExpressionId(context, hirExpressionId(7));
  const statementId = monoTransformStatementId(context, hirStatementId(9));

  expect(context.remap.localRemap.get(hirLocalId(5))).toEqual(localId);
  expect(context.remap.expressionRemap.get(hirExpressionId(7))).toEqual(expressionId);
  expect(context.remap.statementRemap.get(hirStatementId(9))).toEqual(statementId);
});
```

- [ ] Modify `src/mono/function-statement-cloner.ts` to export a context-first production entry point while preserving the current legacy `cloneBlock` wrapper for parallel lanes.

Use this input type and wrapper shape:

```ts
interface CloneBlockWithContextInput {
  readonly source: HirBlock;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}

export function cloneBlock(input: {
  readonly source: HirBlock;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly block: MonoBlock } | { readonly kind: "error" } {
  return cloneBlockWithContext({
    source: input.source,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: monoTransformContextFromLegacyCloneState({
      remap: input.remap,
      resourceKinds: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    }),
  });
}

export function cloneBlockWithContext(
  input: CloneBlockWithContextInput,
): { readonly kind: "ok"; readonly block: MonoBlock } | { readonly kind: "error" } {
  const statements: MonoStatement[] = [];
  for (const source of input.source.statements) {
    const cloned = cloneStatement({
      source,
      instance: input.instance,
      substitution: input.substitution,
      remap: input.transformContext.remap,
      program: input.program,
      context: input.transformContext.resourceKinds,
      outgoingEdges: input.transformContext.outgoingEdges,
      diagnostics: input.transformContext.diagnostics,
      transformContext: input.transformContext,
    });
    if (cloned.kind === "error") return { kind: "error" };
    if (cloned.statement !== null) statements.push(cloned.statement);
  }
  return {
    kind: "ok",
    block: { statements, sourceOrigin: String(input.source.sourceOrigin) },
  };
}
```

- [ ] In the same file, add `transformContext: MonoTransformContext` to `cloneStatement` input and use the facade for statement IDs.

Use this exact statement-ID allocation:

```ts
const monoStatementId = monoTransformStatementId(input.transformContext, input.source.statementId);
```

- [ ] For this task only, keep the existing raw fields on `cloneStatement` and pass them to existing statement helper functions. HMT-04 finishes the statement helper migration; this task is only the shared contract plus first live consumer.

- [ ] Modify `src/mono/function-instantiator-body.ts` so the object created by `createMonoTransformContext` is passed to `cloneBlockWithContext`.

Update the import:

```ts
import { cloneBlockWithContext } from "./function-statement-cloner";
```

Target call shape:

```ts
const cloned = cloneBlockWithContext({
  source: sourceFunction.body,
  instance: input.instance,
  substitution: input.substitution,
  program: input.program,
  transformContext,
});
```

- [ ] Keep the old `cloneBlock` input properties temporarily for HMT-03 and HMT-05 parallel work. Remove legacy wrappers only in HMT-06 after all cloner lanes have landed.

- [ ] Run focused tests.

Run:

```bash
bun test tests/unit/mono/function-cloner-context.test.ts tests/integration/mono/generic-instantiation.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- `MonoTransformContext` exposes ID/remap helpers used by production code.
- No second remap owner is introduced.
- `function-instantiator-body.ts` calls `cloneBlockWithContext`, so the context facade has a live cloner consumer in this task.

**Commit Message:**

```text
Add mono clone context facade -Codex Automated
```

---

## HMT-03: Migrate Expression And Call Cloners To The Transform Context

**Files:**

- Modify: `src/mono/function-expression-cloner.ts`
- Modify: `src/mono/function-call-cloner.ts`
- Modify: `tests/audit/mono-maintainability-audit.test.ts`
- Test: `tests/unit/mono/mono-transform-migration-baseline.test.ts`

**Description:**

Make expression and call cloning consume `MonoTransformContext` directly through context-first helpers. This is a parallel lane: do not modify statement, place, or validation-statement files here. Keep legacy expression/call wrappers until HMT-06 so other lanes can land independently.

**Implementation Steps:**

- [ ] In `src/mono/function-expression-cloner.ts`, add exact imports for the context facade.

Use this import shape:

```ts
import {
  monoTransformContextFromLegacyCloneState,
  monoTransformExpressionId,
  type MonoTransformContext,
} from "./mono-transform-context";
```

- [ ] Keep the existing exported `cloneExpression` as a legacy wrapper, and add `cloneExpressionWithContext` as the migrated production implementation.

Target input type:

```ts
interface CloneExpressionWithContextInput {
  readonly source: HirExpression;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}

export function cloneExpression(input: {
  readonly source: HirExpression;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): CloneExpressionResult {
  return cloneExpressionWithContext({
    source: input.source,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: monoTransformContextFromLegacyCloneState({
      remap: input.remap,
      resourceKinds: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    }),
  });
}

export function cloneExpressionWithContext(
  input: CloneExpressionWithContextInput,
): CloneExpressionResult {
  const monoExpressionId = monoTransformExpressionId(
    input.transformContext,
    input.source.expressionId,
  );
  const sourceOrigin = String(input.source.sourceOrigin);
  // existing switch remains here during this task
}
```

- [ ] In context-first expression helpers, replace every use of `input.remap` with `input.transformContext.remap`.

- [ ] In context-first expression helpers, replace every use of `input.context` with `input.transformContext.resourceKinds`.

- [ ] In context-first expression helpers, replace every use of `input.outgoingEdges` with `input.transformContext.outgoingEdges`.

- [ ] In context-first expression helpers, replace every use of `input.diagnostics` with `input.transformContext.diagnostics`.

- [ ] Migrate `cloneValidation` in `src/mono/function-expression-cloner.ts` in this task, not HMT-05, because the helper is owned by the expression cloner. Name the context-first helper `cloneValidationWithContext` and keep the legacy wrapper only until HMT-06.

Use this input shape:

```ts
function cloneValidationWithContext(input: {
  readonly validation: HirValidation;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): { readonly kind: "ok"; readonly validation: MonoValidation } | { readonly kind: "error" } {
  // Existing validation clone body, with diagnostics/remap access through input.transformContext.
}
```

- [ ] In `src/mono/function-call-cloner.ts`, add exact imports for the context facade and context-first expression cloner.

Use this import shape:

```ts
import {
  cloneExpression,
  cloneExpressionWithContext,
  type CloneExpressionResult,
} from "./function-expression-cloner";
import {
  monoTransformContextFromLegacyCloneState,
  type MonoTransformContext,
} from "./mono-transform-context";
```

- [ ] Keep the existing exported `cloneCallExpression` as a legacy wrapper, and add `cloneCallExpressionWithContext`, `cloneCallWithContext`, and `cloneCallArgumentWithContext`.

Target recursive call shape:

```ts
const callee = cloneExpressionWithContext({
  source: input.call.callee,
  instance: input.instance,
  substitution: input.substitution,
  program: input.program,
  transformContext: input.transformContext,
});
```

- [ ] Do not update callers in `function-statement-cloner.ts`, `function-place-cloner.ts`, or `function-validation-statement-cloner.ts` in this task. Their legacy calls should still compile through the wrappers. HMT-06 performs cross-lane call-site cleanup after all lanes land.

- [ ] Add an audit to `tests/audit/mono-maintainability-audit.test.ts` proving expression and call cloners expose context-first entry points while legacy wrappers are still allowed.

Use this test:

```ts
test("mono expression and call cloners expose context-first clone entry points", () => {
  const expressionSource = monoSource("function-expression-cloner.ts");
  const callSource = monoSource("function-call-cloner.ts");

  expect(expressionSource).toContain("export function cloneExpressionWithContext");
  expect(expressionSource).toContain("function cloneValidationWithContext");
  expect(expressionSource).toContain("transformContext: MonoTransformContext");
  expect(expressionSource).toContain("monoTransformExpressionId(");

  expect(callSource).toContain("export function cloneCallExpressionWithContext");
  expect(callSource).toContain("function cloneCallWithContext");
  expect(callSource).toContain("function cloneCallArgumentWithContext");
  expect(callSource).toContain("transformContext: MonoTransformContext");
});
```

- [ ] Run expression/call migration checks.

Run:

```bash
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts tests/audit/mono-maintainability-audit.test.ts
bun test tests/integration/mono/generic-instantiation.test.ts tests/integration/mono/proof-metadata-instantiation.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- `function-expression-cloner.ts` and `function-call-cloner.ts` have context-first implementations for expression, call, call-argument, and validation-expression cloning.
- Legacy expression/call wrappers remain only so HMT-04 and HMT-05 can run in parallel.
- Context-first expression and call remaps are written through `MonoTransformContext`.
- Baseline mono output snapshots do not change unless the previous snapshots exposed nondeterministic ordering; if snapshots change, explain the exact structural reason in the commit body.

**Commit Message:**

```text
Migrate mono expression call cloners to transform context -Codex Automated
```

---

## HMT-04: Migrate Statement And Block Cloners To The Transform Context

**Files:**

- Modify: `src/mono/function-statement-cloner.ts`
- Modify: `tests/audit/mono-maintainability-audit.test.ts`
- Test: `tests/unit/mono/mono-transform-migration-baseline.test.ts`

**Description:**

Make block, statement, arm, branch, loop, return, yield, and expression-statement cloning use the shared transform context. This is a parallel lane: keep legacy wrappers and use legacy expression/place/validation-statement calls until HMT-06 integrates all lanes.

**Implementation Steps:**

- [ ] Change `cloneBlockWithContext`, `cloneStatement`, `cloneMatchArmWithContext`, and every statement-specific helper input to accept `transformContext: MonoTransformContext`.

Target `cloneBlockWithContext` shape:

```ts
export function cloneBlockWithContext(input: {
  readonly source: HirBlock;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): { readonly kind: "ok"; readonly block: MonoBlock } | { readonly kind: "error" } {
  const statements: MonoStatement[] = [];
  for (const source of input.source.statements) {
    const cloned = cloneStatement({
      source,
      instance: input.instance,
      substitution: input.substitution,
      program: input.program,
      transformContext: input.transformContext,
    });
    if (cloned.kind === "error") return { kind: "error" };
    if (cloned.statement !== null) statements.push(cloned.statement);
  }
  return { kind: "ok", block: { statements, sourceOrigin: String(input.source.sourceOrigin) } };
}
```

- [ ] Replace statement ID remapping with `monoTransformStatementId`.

Use this shape inside `cloneStatement`:

```ts
const monoStatementId = monoTransformStatementId(input.transformContext, input.source.statementId);
```

- [ ] Replace every statement-helper use of raw `remap`, resource-kind `context`, `outgoingEdges`, and `diagnostics` with `input.transformContext`.

- [ ] Do not modify `src/mono/function-instantiator-body.ts` in this task. HMT-02 already switched the production boundary to `cloneBlockWithContext`.

- [ ] Add an audit to `tests/audit/mono-maintainability-audit.test.ts` proving the statement cloner exposes context-first block and match-arm entry points while the legacy `cloneBlock` wrapper remains allowed until HMT-06.

Use this test:

```ts
test("mono statement cloner exposes context-first block and match-arm entry points", () => {
  const source = monoSource("function-statement-cloner.ts");

  expect(source).toContain("export function cloneBlockWithContext");
  expect(source).toContain("function cloneMatchArmWithContext");
  expect(source).toContain("transformContext: MonoTransformContext");
  expect(source).toContain("monoTransformStatementId(");
});
```

- [ ] Run statement migration checks.

Run:

```bash
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts tests/audit/mono-maintainability-audit.test.ts
bun test tests/integration/mono/generic-instantiation.test.ts tests/integration/mono/whole-image-monomorphization.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- Statement and block cloning write statement remaps through `MonoTransformContext`.
- `cloneBlockWithContext` is the production path used by `function-instantiator-body.ts`.
- The legacy `cloneBlock` wrapper remains only for parallel lane compatibility and is removed in HMT-06.
- Mono migration baseline snapshots remain stable.

**Commit Message:**

```text
Migrate mono statement cloners to transform context -Codex Automated
```

---

## HMT-05: Migrate Place Take And Validation Cloners To The Transform Context

**Files:**

- Modify: `src/mono/function-place-cloner.ts`
- Modify: `src/mono/function-validation-statement-cloner.ts`
- Modify: `tests/audit/mono-maintainability-audit.test.ts`
- Test: `tests/unit/mono/mono-transform-migration-baseline.test.ts`

**Description:**

Move resource-place, take, owned-proof-ID, checked-type/resource-kind, and validation-match-statement cloning to the shared transform context. This is a parallel lane: `cloneValidation` itself lives in `function-expression-cloner.ts` and is migrated by HMT-03, not here.

**Implementation Steps:**

- [ ] In `src/mono/function-place-cloner.ts`, add exact imports for the context facade and context-first expression cloner.

Use this import shape:

```ts
import { cloneExpression, cloneExpressionWithContext } from "./function-expression-cloner";
import {
  monoTransformContextFromLegacyCloneState,
  type MonoTransformContext,
} from "./mono-transform-context";
```

- [ ] Keep existing exported place/take helpers as legacy wrappers, and add context-first helpers with these exact names: `cloneResourcePlaceWithContext`, `cloneTakeOperandWithContext`, `cloneTakeKindWithContext`, and `cloneForIterationWithContext`.

Use this wrapper shape for `cloneResourcePlace`:

```ts
export function cloneResourcePlace(input: {
  readonly place: HirResourcePlace;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly remap: MutableMonoFunctionRemap;
  readonly program: TypedHirProgram;
  readonly context: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}): { readonly kind: "ok"; readonly place: MonoResourcePlace } | { readonly kind: "error" } {
  return cloneResourcePlaceWithContext({
    place: input.place,
    instance: input.instance,
    substitution: input.substitution,
    program: input.program,
    transformContext: monoTransformContextFromLegacyCloneState({
      remap: input.remap,
      resourceKinds: input.context,
      outgoingEdges: input.outgoingEdges,
      diagnostics: input.diagnostics,
    }),
  });
}
```

- [ ] In `src/mono/function-validation-statement-cloner.ts`, add exact imports for the context facade and context-first expression cloner.

Use this import shape:

```ts
import { cloneExpression, cloneExpressionWithContext } from "./function-expression-cloner";
import {
  monoTransformContextFromLegacyCloneState,
  type MonoTransformContext,
} from "./mono-transform-context";
```

- [ ] Keep the existing exported `cloneValidationMatchStatement` as a legacy wrapper, and add `cloneValidationMatchStatementWithContext`.

Use this input shape:

```ts
export function cloneValidationMatchStatementWithContext(input: {
  readonly inner: HirValidationMatchStatement;
  readonly statementId: MonoStatementId;
  readonly sourceOrigin: string;
  readonly instance: MonoFunctionInstance;
  readonly substitution: MonoSubstitution;
  readonly program: TypedHirProgram;
  readonly transformContext: MonoTransformContext;
}): CloneStatementResult {
  // Existing validation-match clone body, with expression and diagnostics access through input.transformContext.
}
```

- [ ] Keep pure checked-type helpers as pure functions, but pass diagnostics through `transformContext.diagnostics` when they need to report errors.

Target checked-type call shape:

```ts
const itemType = normalizeMonoCheckedTypeForClone({
  type: input.iteration.itemType,
  substitution: input.substitution,
  program: input.program,
  diagnostics: input.transformContext.diagnostics,
});
```

- [ ] Keep `remapOwnedProofId` pure. Do not hide the formula in mutable context unless it writes to `requirementIdRemap` or `proofExpressionIdRemap`.

- [ ] Replace recursive expression calls inside context-first place/take/validation-statement helpers with `cloneExpressionWithContext`. Keep legacy wrapper calls only inside legacy wrapper implementations.

- [ ] Add an audit to `tests/audit/mono-maintainability-audit.test.ts` proving place and validation-statement cloners expose context-first entry points while legacy wrappers remain allowed until HMT-06.

Use this test:

```ts
test("mono place take and validation-statement cloners expose context-first entry points", () => {
  const placeSource = monoSource("function-place-cloner.ts");
  const validationSource = monoSource("function-validation-statement-cloner.ts");

  expect(placeSource).toContain("export function cloneResourcePlaceWithContext");
  expect(placeSource).toContain("function cloneTakeOperandWithContext");
  expect(placeSource).toContain("function cloneTakeKindWithContext");
  expect(placeSource).toContain("function cloneForIterationWithContext");
  expect(placeSource).toContain("transformContext: MonoTransformContext");

  expect(validationSource).toContain("export function cloneValidationMatchStatementWithContext");
  expect(validationSource).toContain("transformContext: MonoTransformContext");
});
```

- [ ] Run place/take/validation migration checks.

Run:

```bash
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts tests/audit/mono-maintainability-audit.test.ts
bun test tests/integration/mono/proof-metadata-instantiation.test.ts tests/integration/proof-mir/validation-and-attempt-splits.test.ts
bun test tests/unit/hir/take-lowerer.test.ts tests/unit/hir/validation-lowerer.test.ts
bun test tests/unit/proof-mir/take-lowerer.test.ts tests/unit/proof-mir/validation-lowerer.test.ts
bun test tests/integration/proof-check/take-session-closure.test.ts tests/integration/proof-check/validation-and-attempts.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- Place, take, and validation-match-statement context-first helpers receive shared mutable clone state through `MonoTransformContext`.
- This task does not modify `function-expression-cloner.ts`; `cloneValidationWithContext` belongs to HMT-03.
- Take and validation behavior coverage passes in HIR, Proof MIR, and proof-check integration tests.
- Validation and attempt proof metadata snapshots remain stable.

**Commit Message:**

```text
Migrate mono place take validation cloners -Codex Automated
```

---

## HMT-06: Delete Legacy Traversal Shapes And Enforce Canonical Ownership

**Files:**

- Modify: `tests/audit/mono-maintainability-audit.test.ts`
- Modify: `tests/unit/architecture/dependency-boundaries.test.ts`
- Modify: `src/mono/function-expression-cloner.ts`
- Modify: `src/mono/function-call-cloner.ts`
- Modify: `src/mono/function-statement-cloner.ts`
- Modify: `src/mono/function-place-cloner.ts`
- Modify: `src/mono/function-validation-statement-cloner.ts`

**Description:**

Remove leftover compatibility inputs, adapter wrappers, duplicate traversal helpers, and permissive audit allowlists. After this task, adding a new unmanaged recursive mono traversal should fail tests.

**Implementation Steps:**

- [ ] Remove unused imports of `MutableMonoFunctionRemap`, `MonoOutgoingEdge`, and `MonoResourceKindConcretizationContext` from cloner files that no longer declare them in input types.

- [ ] Remove any helper overloads that accept both old raw clone state and the new `transformContext`.

- [ ] Rename context-first helpers back to the canonical exported names after all callers are migrated.

Use these final names:

```text
cloneExpressionWithContext -> cloneExpression
cloneCallExpressionWithContext -> cloneCallExpression
cloneCallWithContext -> cloneCall
cloneCallArgumentWithContext -> cloneCallArgument
cloneBlockWithContext -> cloneBlock
cloneMatchArmWithContext -> cloneMatchArm
cloneResourcePlaceWithContext -> cloneResourcePlace
cloneTakeOperandWithContext -> cloneTakeOperand
cloneTakeKindWithContext -> cloneTakeKind
cloneForIterationWithContext -> cloneForIteration
cloneValidationMatchStatementWithContext -> cloneValidationMatchStatement
```

- [ ] Delete `monoTransformContextFromLegacyCloneState` from `src/mono/mono-transform-context.ts` after no legacy wrapper imports it.

Verify with:

```bash
rg -n "monoTransformContextFromLegacyCloneState|WithContext" src/mono
```

Expected: no matches, except `WithContext` in comments is also removed.

- [ ] Tighten `tests/audit/mono-maintainability-audit.test.ts` by replacing the broad approved traversal set with transform-context ownership checks.

Use this audit shape:

```ts
function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function unmanagedCloneCallBlocks(path: string): readonly string[] {
  const source = sourceText(path);
  const callPattern =
    /\bclone(?:Expression|CallExpression|Call|CallArgument|Block|Statement|MatchArm|ResourcePlace|TakeOperand|TakeKind|ForIteration|ValidationMatchStatement)\(\{[\s\S]*?\n\s*\}\)/g;
  return [...source.matchAll(callPattern)]
    .filter((match) => !match[0].includes("transformContext"))
    .map((match) => {
      const index = match.index ?? 0;
      return `${path}:${lineNumberForIndex(source, index)} ${match[0].split("\n")[0]!.trim()}`;
    });
}

test("mono recursive clone entry points stay behind canonical transform context", () => {
  const offenders = tsFilesUnder("src/mono").flatMap((path) => {
    if (path === "src/mono/mono-transform-context.ts") return [];
    return unmanagedCloneCallBlocks(path);
  });

  expect(offenders).toEqual([]);
});
```

- [ ] Add a second audit proving raw clone-state input declarations are gone from cloner files, not just hidden by one managed call in the same file.

Use this test:

```ts
test("mono cloners do not expose legacy raw clone-state inputs", () => {
  for (const path of [
    "function-expression-cloner.ts",
    "function-call-cloner.ts",
    "function-statement-cloner.ts",
    "function-place-cloner.ts",
    "function-validation-statement-cloner.ts",
  ]) {
    const source = monoSource(path);
    expect(source).not.toContain("readonly remap: MutableMonoFunctionRemap");
    expect(source).not.toContain("readonly context: MonoResourceKindConcretizationContext");
    expect(source).not.toContain("readonly outgoingEdges: MonoOutgoingEdge[]");
    expect(source).not.toContain("readonly diagnostics: MonoDiagnostic[]");
    expect(source).not.toContain("monoTransformContextFromLegacyCloneState");
  }
});
```

- [ ] Add or update the architecture test in `tests/unit/architecture/dependency-boundaries.test.ts` so the backed-out generic HIR transform files remain absent.

Use this test shape:

```ts
test("general HIR transform framework is not reintroduced without production consumers", () => {
  for (const path of [
    "src/hir/traversal.ts",
    "src/hir/transform.ts",
    "src/hir/transform-context.ts",
  ]) {
    expect(existsSync(join(root, path))).toBe(false);
  }

  expect(sourceText("src/mono/function-expression-cloner.ts")).toContain(
    "transformContext: MonoTransformContext",
  );
});
```

- [ ] Run deletion/audit checks.

Run:

```bash
bun test tests/audit/mono-maintainability-audit.test.ts tests/unit/architecture/dependency-boundaries.test.ts
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts
```

Expected: PASS.

**Acceptance Criteria:**

- No cloner file has dual old/new input shapes.
- Audit tests reject unmanaged clone call blocks individually, so one managed call cannot mask one unmanaged call in the same file.
- Audit tests reject raw remap/context/outgoing-edge/diagnostic fan-out in migrated cloners.
- General HIR transform framework files remain absent for this migration; the production transform ownership lives in `src/mono/mono-transform-context.ts`.

**Commit Message:**

```text
Enforce canonical mono transform ownership -Codex Automated
```

---

## HMT-07: Update Closure Status And Run Full Verification

**Files:**

- Modify: `docs/reviews/2026-07-05-remediation-status.md`
- Modify: `docs/implementation/2026-07-05-hir-mono-transform-migration-followup.md`

**Description:**

Only after HMT-01 through HMT-06 pass, update the closure status rows that were intentionally left `Not started`.

**Implementation Steps:**

- [x] Update `docs/reviews/2026-07-05-remediation-status.md` rows for WCR-34 and WCR-54 through WCR-57.

Use these status rules:

```text
WCR-34: Fixed only if a traversal or transform primitive has a production mono cloner consumer.
WCR-54: Superseded by mono-specific transform context unless this implementation adds a real production HIR-to-HIR transform adapter. Do not mark Fixed for the mono-specific design alone.
WCR-55: Fixed only if expression and call cloners use MonoTransformContext.
WCR-56: Fixed only if statement, place, take, and validation cloners use MonoTransformContext.
WCR-57: Fixed only if audits fail on unmanaged traversal/remap reintroduction.
```

- [x] Add the final verification commands and outcomes to this plan's "Execution Notes" section.

- [x] Run focused verification.

Run:

```bash
bun test tests/unit/mono/mono-transform-migration-baseline.test.ts
bun test tests/audit/mono-maintainability-audit.test.ts tests/unit/architecture/dependency-boundaries.test.ts
bun test tests/integration/mono/generic-instantiation.test.ts tests/integration/mono/proof-metadata-instantiation.test.ts
bun test tests/integration/proof-mir/validation-and-attempt-splits.test.ts
bun test tests/unit/hir/take-lowerer.test.ts tests/unit/hir/validation-lowerer.test.ts
bun test tests/unit/proof-mir/take-lowerer.test.ts tests/unit/proof-mir/validation-lowerer.test.ts
bun test tests/integration/proof-check/take-session-closure.test.ts tests/integration/proof-check/validation-and-attempts.test.ts
```

Expected: PASS.

- [x] Run required full verification.

Run:

```bash
bun run format
bun run agent:check
```

Expected: PASS.

**Acceptance Criteria:**

- Status rows are updated only after code and audits prove the migration is complete.
- This plan records final execution evidence.
- `bun run agent:check` passes.

**Commit Message:**

```text
Close HIR mono transform migration follow-up -Codex Automated
```

## Execution Notes

- HMT-01 used a focused, structured mono summary baseline instead of a full `monoSummary` snapshot so the migration baseline stayed deterministic and reviewable while still covering cloned body identity and remaps.
- HMT-06 ended stricter than the initial source-text audit plan: the final audit uses TypeScript AST helpers, split into `tests/support/mono/mono-maintainability-audit-helpers.ts`, to reject unmanaged clone traversal, raw remap/context inputs, structural or rebuilt transform contexts, helper laundering, import aliases, string-literal element access, spread or duplicate `transformContext` overwrites, and new `*-cloner.ts` raw-state reintroductions.
- WCR-54 was closed as `Superseded`, not `Fixed`, because this plan intentionally shipped the production mono transform context rather than a generic production HIR-to-HIR transform adapter.
- `bun test tests/unit/mono/mono-transform-migration-baseline.test.ts` passed during HMT-07 final verification.
- `bun test tests/audit/mono-maintainability-audit.test.ts tests/unit/architecture/dependency-boundaries.test.ts` passed during HMT-07 final verification.
- `bun test tests/integration/mono/generic-instantiation.test.ts tests/integration/mono/proof-metadata-instantiation.test.ts` passed during HMT-07 final verification.
- `bun test tests/integration/proof-mir/validation-and-attempt-splits.test.ts` passed during HMT-07 final verification.
- `bun test tests/unit/hir/take-lowerer.test.ts tests/unit/hir/validation-lowerer.test.ts` passed during HMT-07 final verification.
- `bun test tests/unit/proof-mir/take-lowerer.test.ts tests/unit/proof-mir/validation-lowerer.test.ts` passed during HMT-07 final verification.
- `bun test tests/integration/proof-check/take-session-closure.test.ts tests/integration/proof-check/validation-and-attempts.test.ts` passed during HMT-07 final verification.
- `bun run format` passed during HMT-07 final verification.
- `bun run agent:check` passed during HMT-07 final verification.
