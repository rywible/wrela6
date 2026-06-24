# Typed HIR Proof Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement typed HIR lowering from `docs/design/typed-hir-proof-surface-design.md`, including source-origin-preserving typed body lowering and explicit proof-relevant metadata.

**Architecture:** Typed HIR lives under `src/hir` and consumes the parsed module graph, item index, resolved references, core types, checked semantic program, and optional checked image seed. The implementation keeps frontend parsing, name resolution, semantic declaration checking, filesystem access, monomorphization, layout, Proof MIR, proof checking, and code generation outside HIR. Upstream semantic-surface contracts that the HIR design requires are implemented first as pure checked data tables, then HIR consumes those contracts without re-resolving names or guessing proof meaning from source text.

**Tech Stack:** TypeScript, Bun test runner, existing frontend AST views, semantic item index, semantic name-resolution APIs, semantic surface models, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- Current HIR design input is `docs/design/typed-hir-proof-surface-design.md`.
- Current source has no `src/hir` directory. The plan creates it without moving existing semantic code.
- Existing implementation plans live under `docs/implementation`, so this plan follows that repository convention.
- Required verification before handoff remains:

```bash
bun run agent:check
```

- Narrow commands workers should use while iterating:

```bash
bun test ./tests/unit/hir/ids.test.ts
bun test ./tests/unit/hir/origin.test.ts
bun test ./tests/unit/hir/local-scope.test.ts
bun test ./tests/unit/hir/expression-lowerer.test.ts
bun test ./tests/integration/hir/lower-typed-hir-orchestration.test.ts
```

- HIR input API from the design:

```ts
export interface LowerTypedHirInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly coreTypes: CoreTypeCatalog;
  readonly program: CheckedSemanticProgram;
  readonly image?: CheckedImageSeed;
}

export interface LowerTypedHirResult {
  readonly program: TypedHirProgram;
  readonly diagnostics: readonly HirDiagnostic[];
}
```

- Current semantic surface already exposes these HIR inputs:

```ts
program.functions.get(functionId);
program.fields.get(fieldId);
program.completedMembers.get(syntaxReferenceKey);
program.certifiedPlatformBindings.get(functionId);
program.proofSurface.requirementSurfaces.get(functionId);
program.proofSurface.terminalSurfaces.get(functionId);
```

- Current semantic surface proof contracts are not rich enough for the full HIR proof surface. The plan adds checked contracts for constructibility, take modes, validation, attempt inputs, private-state transitions, match refinements, and structured platform ensured facts before HIR consumes them. Source `ensure` is intentionally not a semantic checked table; HIR consumes parser-backed, name-resolved statement syntax and emits an `ensure` fact only after body typing confirms the expression is `bool`.
- Current frontend has `TakeStatementView`, `AttemptExpressionView`, `ValidatedBufferDeclarationView`, `MatchStatementView`, `ContinueStatementView`, `ReturnStatementView`, and `YieldStatementView`. It does not expose source `break` or `ensure`; this plan adds both in one frontend task because they edit the same parser/token/view files.
- Current code uses `localeCompare` on several HIR input paths, including item-index module ordering, duplicate diagnostics, name-resolution reference ordering, platform primitive ordering, and name diagnostics. The HIR design requires deterministic code-unit ordering, so Task 1 removes those locale-sensitive comparisons across HIR inputs.
- Current unit support already has `tests/support/semantic/semantic-surface-fakes.ts` with parse, index, resolve, and semantic-check helpers. HIR integration tests should build on that pipeline.
- Existing `SourceSpan.from(start, end)` is the constructor used in examples.
- Existing `checkedTypeFingerprint` is exported from `src/semantic/surface/type-model.ts`; HIR tasks must import it rather than creating a second fingerprint format.
- Existing naming preferences from `agents.md`: use descriptive names such as `source`, `diagnostics`, `token`, `result`, and `context`; use fakes through dependency injection; keep runtime source dependency-free.

## Executor Protocol

Every task below is atomic for one worker. Before starting a task, copy this checklist into that task's work notes and check off each item.

- [ ] Read the task description, dependencies, file list, acceptance criteria, code examples, and verification block.
- [ ] Verify every dependency task has landed and no same-wave task owns the files listed here.
- [ ] Write the failing test(s) from the task's code examples in the task-owned test file(s).
- [ ] Run the narrow verification command and confirm the new test fails for the expected missing symbol, missing behavior, or diagnostic mismatch.
- [ ] Implement only the files listed by the task.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run any adjacent narrow tests named by the task when a shared public API is touched.
- [ ] Commit only this task's files, using a message that names the task number.

## Production Scope Decision

This plan intentionally has no staged production split for proof facts. The design now treats source `ensure`, structured platform ensured facts, and match refinements as production HIR proof surfaces. The safety rule is not "defer these variants"; it is: HIR may emit a proof fact only from parser-backed source syntax or semantic-surface-certified structured contracts. Raw target proof text, rejected certifications, recovered syntax, or name matching must fail closed and must not authorize proof metadata.

## Parallel Execution Model

Use these waves to keep ownership small and avoid merge conflicts. Tasks in the same wave can run in parallel after their dependencies are complete.

```text
Wave 0:
  Task 1: Deterministic sort cleanup across HIR input paths
  Task 2: Frontend break and ensure syntax support
  Task 8: HIR ID and table substrate

Wave 1:
  Task 3 after Task 2: Ensure name-resolution walk and bool typing contract
  Task 4A after Task 1: Semantic proof-surface scaffold and preservation checks
  Task 9: HIR diagnostics and origins

Wave 2:
  Task 4B after Task 4A: Semantic constructibility contract
  Task 5 after Task 4A: Semantic take contract
  Task 6 after Task 4A: Semantic validation and attempt contracts
  Task 7 after Task 4A: Semantic private transition and platform ensured-fact contracts
  Task 10 after Tasks 8 and 9: HIR model and proof metadata records

Wave 3:
  Task 11 after Tasks 8, 9, and 10: Lowering context, builder skeleton, and declaration lowering
  Task 13 after Tasks 8, 9, and 10: Local scope and no-shadowing
  Task 14 after Tasks 8, 9, and 10: Resource place interner

Wave 4:
  Task 12 after Task 11: HIR test fakes, per-unit harnesses, and summaries

Wave 5:
  Task 15 after Tasks 12, 13, and 14: Literal, name, member, and object expression lowering
  Task 16 after Tasks 4B, 12, 13, and 14: Generic call inference and constructibility checks
  Task 20 after Tasks 7, 11, 12, and 14: Image and global brand lowering

Wave 6:
  Task 17 after Tasks 12, 13, 14, 15, and 16: Ordinary call lowering
  Task 21 after Tasks 11, 12, and 15: Requirement lowering

Wave 7:
  Task 18 after Tasks 2, 3, 12, 13, 14, 15, and 17: Structured statement lowering
  Task 19 after Tasks 11, 12, and 21: Validated-buffer declaration lowering

Wave 8:
  Task 22 after Tasks 5, 12, 14, 17, and 18: Take lowering
  Task 23 after Tasks 6, 12, 14, 15, 17, and 18: Validation and attempt lowering
  Task 24 after Tasks 3, 7, 12, 14, 17, and 18: Fact and private-transition lowering

Wave 9:
  Task 25 after Tasks 4A, 7, 12, 17, 21, and 24: Platform, terminal, predicate, and call requirement metadata

Wave 10:
  Task 26 after Tasks 11 through 25: `lowerTypedHir` orchestration

Wave 11:
  Task 27 after Task 26: HIR integration and determinism tests
  Task 28 after Task 26: Public API barrels

Wave 12:
  Task 29 after all prior tasks: Final verification and handoff
```

Single-writer coordination:

- HIR-input deterministic sort cleanup is owned by Task 1.
- Frontend parser, syntax kind, AST statement view, and associated frontend tests for both `break` and `ensure` are owned by Task 2.
- Ensure name-resolution traversal is owned by Task 3; HIR body typing enforces the `bool` requirement before Task 24 emits an `ensure` fact.
- `src/semantic/surface/proof-surface.ts`, `src/semantic/surface/proof-contracts/index.ts`, and semantic-surface fake wiring are owned by Task 4A. `src/semantic/surface/proof-contracts/constructibility.ts` is created by Task 4A and populated by Task 4B. Tasks 5 and 6 modify only their contract-specific files under `src/semantic/surface/proof-contracts/`; Task 7 additionally owns the platform proof-contract migration in `platform-surface.ts` and `platform-certifier.ts`.
- `src/hir/ids.ts`, `src/hir/deterministic-sort.ts`, and core table helpers are owned by Task 8.
- `src/hir/diagnostics.ts` and `src/hir/origin.ts` are owned by Task 9. Later tasks import the complete diagnostic registry and do not edit it.
- `src/hir/hir.ts`, `src/hir/proof-metadata.ts`, and `src/hir/brand-registry.ts` are owned by Task 10. Later tasks populate metadata through exported builder APIs and do not edit those files.
- `src/hir/lowering-context.ts` and `src/hir/typed-hir-builder.ts` are first created by Task 11 and integrated by Task 26.
- `tests/support/hir/typed-hir-fakes.ts` and `tests/support/hir/typed-hir-fixtures.ts` are owned by Task 12 until Task 27.
- Lowerer and classifier files are owned by their corresponding tasks. Task 26 is the only task that wires all lowerers into shared orchestration.
- HIR lowerer helpers append proof metadata by mutating the `HirProofMetadataBuilder` exposed through `HirLoweringContext`. They do not return independent metadata diff objects.

## Target File Structure

```text
src/
  semantic/
    surface/
      proof-contracts/
        index.ts
        constructibility.ts
        take.ts
        validation-attempt.ts
        private-platform.ts

  hir/
    index.ts
    ids.ts
    origin.ts
    hir.ts
    hir-table.ts
    lowering-context.ts
    reference-lookup.ts
    typed-hir-builder.ts
    diagnostics.ts
    deterministic-sort.ts
    brand-registry.ts
    constructibility.ts
    body-lowerer.ts
    expression-lowerer.ts
    statement-lowerer.ts
    generic-inference.ts
    generic-substitution.ts
    local-scope.ts
    place.ts
    call-lowerer.ts
    call-proof-metadata.ts
    requirement-lowerer.ts
    take-lowerer.ts
    attempt-lowerer.ts
    validation-lowerer.ts
    fact-lowerer.ts
    proof-metadata.ts
    image-lowerer.ts
    validated-buffer-lowerer.ts

tests/
  support/
    hir/
      typed-hir-fakes.ts
      typed-hir-fixtures.ts

  unit/
    hir/
      ids.test.ts
      origin.test.ts
      lowering-context.test.ts
      reference-lookup.test.ts
      place.test.ts
      local-scope.test.ts
      expression-lowerer.test.ts
      generic-inference.test.ts
      constructibility.test.ts
      statement-lowerer.test.ts
      call-lowerer.test.ts
      call-proof-metadata.test.ts
      requirement-lowerer.test.ts
      take-lowerer.test.ts
      attempt-lowerer.test.ts
      validation-lowerer.test.ts
      fact-lowerer.test.ts
      proof-metadata.test.ts
      image-lowerer.test.ts
      validated-buffer-lowerer.test.ts
      diagnostics.test.ts
      typed-hir-fixtures.test.ts

  integration/
    hir/
      declaration-lowering.test.ts
      lower-typed-hir-orchestration.test.ts
      typed-hir-proof-integration.test.ts
      typed-hir-determinism.test.ts
      proof-surface-completeness.test.ts
      public-api.test.ts
```

## Shared Implementation Rules

- Runtime code must not add new dependencies.
- Use fakes through dependency injection. Do not use mocks.
- HIR must not read the filesystem, parse modules, discover imports, resolve names, run semantic declaration validation, instantiate generics for a closed image, compute layout, build Proof MIR, or emit code.
- HIR must consume `ResolvedReferences`, `CheckedSemanticProgram`, `CheckedImageSeed`, completed member references, certified platform bindings, and checked proof contracts.
- Use `compareCodeUnitStrings` for deterministic string ordering.
- Every lowered proof-relevant operation must carry a `HirOriginId`.
- Any ambiguous proof-relevant construct must fail closed with a HIR diagnostic and no proof-authorizing metadata.
- Unit tests may import implementation files directly. Public API tests should import through barrels only after Task 28.

---

## Task 1: Deterministic Sort Cleanup Across HIR Inputs

**Description:** Replace locale-sensitive ordering on HIR input paths with code-unit ordering so parsed modules, item-index records, name-resolution tables, platform primitive bindings, and diagnostics are deterministic across locales.

**Dependencies:** None.

**Files:**

- Modify: `src/semantic/item-index/source-module-collector.ts`
- Modify: `src/semantic/item-index/duplicate-checker.ts`
- Modify: `src/semantic/names/resolution-result.ts`
- Modify: `src/semantic/names/platform-primitives.ts`
- Modify: `src/semantic/names/diagnostics.ts`
- Test: `tests/unit/semantic/item-index/source-module-collector.test.ts`
- Test: `tests/unit/semantic/item-index/duplicates.test.ts`
- Test: `tests/unit/semantic/names/resolved-references.test.ts`
- Test: `tests/unit/semantic/names/diagnostics.test.ts`

**Acceptance Criteria:**

- `ResolvedReferencesBuilder.build().entries()` sorts `SyntaxReferenceKey.kind` with code-unit comparison.
- `ResolvedPlatformBindingsBuilder.build().entries()` sorts `primitiveId` with code-unit comparison.
- Source module collection sorts module path, source name, and source text with `compareCodeUnitStrings`.
- Duplicate-checker and name-resolution diagnostics sort display strings and codes with `compareCodeUnitStrings`.
- Platform primitive name catalog ordering uses `compareCodeUnitStrings`.
- Existing name-resolution tests pass.
- Unit tests cover non-locale ASCII ordering for references, primitive IDs, module paths, and diagnostics.

**Code Examples:**

```ts
import { compareCodeUnitStrings } from "../surface/deterministic-sort";

function compareKeys(left: SyntaxReferenceKey, right: SyntaxReferenceKey): number {
  if (left.moduleId !== right.moduleId)
    return (left.moduleId as number) - (right.moduleId as number);
  if (left.span.start !== right.span.start) return left.span.start - right.span.start;
  if (left.span.end !== right.span.end) return left.span.end - right.span.end;
  const kindComparison = compareCodeUnitStrings(left.kind, right.kind);
  if (kindComparison !== 0) return kindComparison;
  return left.ordinal - right.ordinal;
}
```

```ts
function compareSourceModuleInput(left: SourceModuleInput, right: SourceModuleInput): number {
  const pathComparison = compareCodeUnitStrings(left.path.key, right.path.key);
  if (pathComparison !== 0) return pathComparison;

  const nameComparison = compareCodeUnitStrings(left.source.name, right.source.name);
  if (nameComparison !== 0) return nameComparison;

  return compareCodeUnitStrings(left.source.text, right.source.text);
}
```

```ts
test("resolved platform bindings sort primitive ids by code unit", () => {
  const builder = new ResolvedPlatformBindingsBuilder();
  builder.add({
    itemId: itemId(0),
    functionId: functionId(2),
    primitiveId: platformPrimitiveId("z"),
  });
  builder.add({
    itemId: itemId(0),
    functionId: functionId(2),
    primitiveId: platformPrimitiveId("A"),
  });

  expect(
    builder
      .build()
      .entries()
      .map((binding) => binding.primitiveId),
  ).toEqual([platformPrimitiveId("A"), platformPrimitiveId("z")]);
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/names/resolved-references.test.ts
bun test ./tests/unit/semantic/item-index/source-module-collector.test.ts
bun test ./tests/unit/semantic/item-index/duplicates.test.ts
bun test ./tests/unit/semantic/names/diagnostics.test.ts
```

---

## Task 2: Frontend Break And Ensure Syntax Support

**Description:** Add `break` and source `ensure` as parsed statements and AST views in one frontend change because they edit the same token, parser, syntax-kind, view, and test files.

**Dependencies:** None.

**Files:**

- Modify: `src/frontend/lexer/keyword-table.ts`
- Modify: `src/frontend/lexer/token-kind.ts`
- Modify: `src/frontend/syntax/syntax-kind.ts`
- Modify: `src/frontend/syntax/syntax-kind-map.ts`
- Modify: `src/frontend/syntax/syntax-tree.ts`
- Modify: `src/frontend/parser/parser-diagnostics.ts`
- Modify: `src/frontend/parser/statement-parser.ts`
- Modify: `src/frontend/parser/control-statement-parser.ts`
- Modify: `src/frontend/ast/statement-views.ts`
- Test: `tests/unit/frontend/parser/control-statement-parser.test.ts`
- Test: `tests/integration/frontend/parser/control-statement-dispatch.test.ts`
- Test: `tests/unit/frontend/ast/statement-requirement-views.test.ts`

**Acceptance Criteria:**

- `break` lexes as `BreakKeyword`.
- `ensure` lexes as `EnsureKeyword`.
- `break` parses as `SyntaxKind.BreakStatement`.
- `ensure expression` parses as `SyntaxKind.EnsureStatement`.
- `BreakStatementView.from(node)` returns a view for break nodes.
- `EnsureStatementView.expression()` exposes the expression payload.
- Statement dispatch recognizes `break` and `ensure` in blocks and loop bodies.
- Parser and syntax diagnostic sorting use code-unit comparison for diagnostic codes so malformed `break` and `ensure` recovery is deterministic without locale-sensitive `localeCompare`.

**Code Examples:**

```ts
export class BreakStatementView extends AstView {
  static from(node: RedNode): BreakStatementView | undefined {
    return node.kind === SyntaxKind.BreakStatement ? new BreakStatementView(node) : undefined;
  }
}

export class EnsureStatementView extends AstView {
  static from(node: RedNode): EnsureStatementView | undefined {
    return node.kind === SyntaxKind.EnsureStatement ? new EnsureStatementView(node) : undefined;
  }

  expression(): ExpressionView | undefined {
    return expressionViewFrom(
      this.node.children().find((child): child is RedNode => child instanceof RedNode),
    );
  }
}
```

```ts
test("parseBreakStatement creates break statement node", () => {
  const context = parserContextForTest("break\n");
  const node = parseStatement(context);
  expect(node.kind).toBe(SyntaxKind.BreakStatement);
});

test("parseEnsureStatement creates ensure statement node", () => {
  const context = parserContextForTest("ensure ready\n");
  const node = parseStatement(context);
  expect(node.kind).toBe(SyntaxKind.EnsureStatement);
});
```

```ts
test("malformed ensure recovery diagnostics sort deterministically", () => {
  const first = parseSourceForTest("fn main() -> Never:\n    ensure\n    break\n");
  const second = parseSourceForTest("fn main() -> Never:\n    ensure\n    break\n");

  expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
    second.diagnostics.map((diagnostic) => diagnostic.code),
  );
});
```

```ts
test("BreakStatementView recognizes break nodes", () => {
  const root = parseRootForTest("fn main() -> Never:\n    loop:\n        break\n");
  const breakNode = descendants(root, SyntaxKind.BreakStatement)[0]!;
  expect(BreakStatementView.from(breakNode)).toBeDefined();
});

test("EnsureStatementView exposes ensured expression", () => {
  const root = parseRootForTest("fn main(x: bool) -> Never:\n    ensure x\n");
  const ensureNode = descendants(root, SyntaxKind.EnsureStatement)[0]!;
  const view = EnsureStatementView.from(ensureNode)!;
  expect(view.expression()).toBeDefined();
});
```

**Verification:**

```bash
bun test ./tests/unit/frontend/parser/control-statement-parser.test.ts
bun test ./tests/integration/frontend/parser/control-statement-dispatch.test.ts
bun test ./tests/unit/frontend/ast/statement-requirement-views.test.ts
```

---

## Task 3: Ensure Name Resolution And Bool Typing Contract

**Description:** Teach name resolution to visit `ensure` expressions so source facts have resolved references before HIR body typing checks them as `bool`.

**Dependencies:** Task 2.

**Files:**

- Modify: `src/semantic/names/expression-resolver.ts`
- Test: `tests/integration/semantic/name-resolution.test.ts`

**Acceptance Criteria:**

- Name resolution walks the expression inside every `EnsureStatementView`.
- Unresolved names inside `ensure` produce ordinary name-resolution diagnostics.
- HIR remains responsible for final body-local type checking, but the plan requires ensure expressions to check to core `bool` before fact metadata is emitted.
- Semantic surface does not create any `ensure` proof table; Task 24 emits source `ensure` facts from parser-backed, name-resolved `EnsureStatementView` nodes after Task 18 lowers the expression.

**Code Examples:**

```ts
test("name resolution walks ensure expressions", () => {
  const result = resolveNamesForTest([
    ["main.wr", "fn use() -> Never:\n    ensure missing_name\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "NAME_UNRESOLVED_REFERENCE",
  );
});
```

**Verification:**

```bash
bun test ./tests/integration/semantic/name-resolution.test.ts
```

---

## Task 4A: Semantic Proof-Surface Scaffold And Preservation Checks

**Description:** Create the proof-surface contract file split and empty table scaffolds while preserving every existing `CheckedProofSurface` field and semantic-surface producer.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/semantic/surface/proof-surface.ts`
- Modify: `src/semantic/surface/checked-program.ts`
- Modify: `src/semantic/surface/semantic-surface-checker.ts`
- Modify: `src/semantic/surface/index.ts`
- Create: `src/semantic/surface/proof-contracts/index.ts`
- Create: `src/semantic/surface/proof-contracts/constructibility.ts`
- Create: `src/semantic/surface/proof-contracts/take.ts`
- Create: `src/semantic/surface/proof-contracts/validation-attempt.ts`
- Create: `src/semantic/surface/proof-contracts/private-platform.ts`
- Modify: `tests/support/semantic/semantic-surface-fakes.ts`
- Test: `tests/unit/semantic/surface/proof-surface.scaffold.test.ts`
- Test: `tests/integration/semantic/semantic-surface.proof-preservation.test.ts`

**Acceptance Criteria:**

- `CheckedProofSurface` preserves all existing fields: `resourceKindByType`, `signatureModes`, `requirementSurfaces`, `predicateFactSurfaces`, `terminalSurfaces`, `validationSurfaces`, `privateStateSurfaces`, `imageSurfaces`, and `platformContracts`.
- `CheckedProofSurface` adds table slots for constructibility, take modes, validation contracts, attempt contracts, private transitions, match refinements, and structured platform ensured facts.
- Empty table implementations exist for every proof-surface contract, so Tasks 5 through 7 can modify only their contract-specific files.
- Existing semantic-surface producers continue to populate requirements, predicate facts, terminal surfaces, validation/private/image seeds, and certified platform bindings exactly as before.
- Integration regressions prove `requires` sections still appear in `program.proofSurface.requirementSurfaces`, terminal functions still appear in `terminalSurfaces`, and certified platform bindings still appear in `platformContracts`.

**Code Examples:**

```ts
export interface CheckedProofSurface {
  readonly resourceKindByType: CheckedProofSeedTable<CheckedResourceKindByTypeSurface>;
  readonly signatureModes: CheckedProofSeedTable<CheckedSignatureModeSurface>;
  readonly requirementSurfaces: CheckedRequirementSurfaceTable;
  readonly predicateFactSurfaces: CheckedProofSeedTable<CheckedPredicateFactSurface>;
  readonly terminalSurfaces: CheckedTerminalSurfaceTable;
  readonly validationSurfaces: CheckedProofSeedTable<CheckedValidationSurface>;
  readonly privateStateSurfaces: CheckedProofSeedTable<CheckedPrivateStateSurface>;
  readonly imageSurfaces: CheckedProofSeedTable<CheckedImageSurface>;
  readonly platformContracts: CertifiedPlatformBindingTable;
  readonly constructibilitySurfaces: CheckedConstructibilitySurfaceTable;
  readonly takeModeSurfaces: CheckedTakeModeSurfaceTable;
  readonly validationContracts: CheckedValidationContractSurfaceTable;
  readonly attemptContracts: CheckedAttemptContractSurfaceTable;
  readonly privateTransitions: CheckedPrivateTransitionSurfaceTable;
  readonly platformEnsuredFacts: CheckedPlatformEnsuredFactSurfaceTable;
  readonly matchRefinements: CheckedMatchRefinementSurfaceTable;
}
```

```ts
test("proof surface scaffold preserves existing requirement and terminal tables", () => {
  const surface = checkedProofSurface({
    requirements: [requirementSurface({ ownerFunctionId: functionId(1), expression, span })],
    terminalSurfaces: [terminalSurface({ functionId: functionId(1), span })],
  });

  expect(surface.requirementSurfaces.get(functionId(1))).toHaveLength(1);
  expect(surface.terminalSurfaces.get(functionId(1))).toBeDefined();
  expect(surface.constructibilitySurfaces.entries()).toEqual([]);
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/proof-surface.scaffold.test.ts
bun test ./tests/integration/semantic/semantic-surface.proof-preservation.test.ts
```

---

## Task 4B: Semantic Constructibility Contract

**Description:** Populate checked constructibility surfaces so HIR can reject forged sealed or proof-relevant values without inventing rules from raw syntax.

**Dependencies:** Task 4A.

**Files:**

- Modify: `src/semantic/surface/proof-contracts/constructibility.ts`
- Modify: `src/semantic/surface/semantic-surface-checker.ts`
- Test: `tests/unit/semantic/surface/proof-surface.constructibility.test.ts`
- Test: `tests/integration/semantic/semantic-surface.constructibility.test.ts`

**Acceptance Criteria:**

- `CheckedConstructibilitySurface` is keyed by `TypeId` and optional constructor `FunctionId`.
- Ordinary non-proof-relevant source types receive `authorization: "ordinary"`.
- Validated-buffer declarations produce `authorization: "validatedBufferMint"` for the validated-buffer type.
- Private-state resource kinds produce `authorization: "privateStateMint"` only from checked private-state constructors or declarations.
- Stream/session, sealed platform token, image-capability, and edge-internal authorizations are emitted only when semantic surface has an explicit checked source declaration, checked constructor, checked image/device seed, or certified platform binding proving the mint authority.
- If semantic surface cannot prove special construction authority, no special authorization is emitted. HIR treats absent constructibility as default-allow only for types whose checked resource kind is not sealed or proof-relevant; absent authorization for sealed/proof-relevant construction is default-reject with `HIR_FORGED_SEALED_CONSTRUCTION`.
- HIR tests can query constructibility through `program.proofSurface.constructibilitySurfaces`.

**Code Examples:**

```ts
export interface CheckedConstructibilitySurface {
  readonly typeId: TypeId;
  readonly constructorFunctionId?: FunctionId;
  readonly authorization:
    | "ordinary"
    | "sealedPlatformTokenMint"
    | "validatedBufferMint"
    | "privateStateMint"
    | "streamMint"
    | "imageCapabilityMint"
    | "edgeInternalTokenMint";
  readonly sourceOrigin: SourceSpan;
}

export interface CheckedConstructibilitySurfaceTable {
  get(typeId: TypeId): readonly CheckedConstructibilitySurface[];
  entries(): readonly CheckedConstructibilitySurface[];
}
```

```ts
test("constructibility surfaces sort by type and constructor id", () => {
  const surface = checkedProofSurface({
    constructibilitySurfaces: [
      {
        typeId: typeId(2),
        authorization: "ordinary",
        sourceOrigin: SourceSpan.from(0, 5),
      },
      {
        typeId: typeId(1),
        constructorFunctionId: functionId(4),
        authorization: "validatedBufferMint",
        sourceOrigin: SourceSpan.from(6, 11),
      },
    ],
  });

  expect(surface.constructibilitySurfaces.entries().map((entry) => entry.typeId)).toEqual([
    typeId(1),
    typeId(2),
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/proof-surface.constructibility.test.ts
bun test ./tests/integration/semantic/semantic-surface.constructibility.test.ts
```

---

## Task 5: Semantic Take Contract

**Description:** Add checked take-mode contract records that classify stream, buffer, and validated-buffer take operands before HIR lowers `take`.

**Dependencies:** Task 4A.

**Files:**

- Modify: `src/semantic/surface/proof-contracts/take.ts`
- Test: `tests/unit/semantic/surface/proof-surface.take.test.ts`
- Test: `tests/integration/semantic/semantic-surface.take.test.ts`

**Acceptance Criteria:**

- `CheckedTakeModeSurface` distinguishes `stream`, `buffer`, and `validatedBuffer`.
- Stream contracts can name take-only producer functions by `FunctionId`.
- Buffer contracts can name source types that carry buffer obligations.
- Validated-buffer contracts can name the checked validated-buffer `TypeId`.
- Producers are explicit: stream take modes come only from checked functions or certified platform primitives whose checked return contract is marked take-only stream; buffer take modes come only from checked source/target types whose checked resource kind is `Affine`, `Linear`, `EdgePath`, or `SealedPlatformToken` and whose declaration is marked as a buffer obligation; validated-buffer take modes come only from checked validated-buffer declarations.
- A `Stream` resource kind without take-only authorization is not a take-mode surface and must later fail closed in HIR with `HIR_TAKE_ONLY_CALL_REQUIRED`.
- No take mode is produced from source or target names alone.
- The table returns deterministic entries sorted by mode, type/function IDs, and source span.

**Code Examples:**

```ts
export type CheckedTakeModeSurface =
  | {
      readonly kind: "stream";
      readonly producerFunctionId: FunctionId;
      readonly itemType: CheckedType;
      readonly itemResourceKind: CheckedResourceKind;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "buffer";
      readonly sourceTypeId: TypeId;
      readonly bufferResourceKind: CheckedResourceKind;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "validatedBuffer";
      readonly validatedBufferTypeId: TypeId;
      readonly span: SourceSpan;
    };
```

```ts
test("take-mode surfaces sort deterministically", () => {
  const surface = checkedProofSurface({
    takeModeSurfaces: [
      { kind: "buffer", sourceTypeId: typeId(2), bufferResourceKind: concreteKind("Linear"), span },
      { kind: "validatedBuffer", validatedBufferTypeId: typeId(1), span },
    ],
  });

  expect(surface.takeModeSurfaces.entries().map((entry) => entry.kind)).toEqual([
    "buffer",
    "validatedBuffer",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/proof-surface.take.test.ts
bun test ./tests/integration/semantic/semantic-surface.take.test.ts
```

---

## Task 6: Semantic Validation And Attempt Contracts

**Description:** Add checked validation and attempt contracts that map source declarations and fallible call shapes to explicit HIR-consumable data.

**Dependencies:** Task 4A.

**Files:**

- Modify: `src/semantic/surface/proof-contracts/validation-attempt.ts`
- Test: `tests/unit/semantic/surface/proof-surface.validation-attempt.test.ts`
- Test: `tests/integration/semantic/semantic-surface.validation-attempt.test.ts`

**Acceptance Criteria:**

- `CheckedValidationContractSurface` names validation result type, source type, ok payload, err payload, and source parameter mapping.
- `CheckedAttemptContractSurface` names fallible function, ok type, err type, result type, and declared input positions by receiver or parameter identity.
- Attempt inputs are not inferred from consume modes; they are explicit checked contract entries.
- Validation contracts are produced only from checked validated-buffer declarations and checked validation function/constructor signatures that name the validated-buffer type, result type, source parameter, and Ok/Err payload shapes.
- Attempt contracts are produced only from checked fallible function signatures or checked target contracts that explicitly expose result, Ok, Err, and input-position metadata.
- Ambiguous validation result shapes, missing Ok/Err payload fields, missing source parameter mapping, or attempt inputs that cannot be tied to receiver/parameter identity produce no contract; HIR later lowers matching source shapes as fail-closed recovery.
- Contract table ordering is deterministic and independent of input insertion order.

**Code Examples:**

```ts
export type CheckedAttemptInputPosition =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId };

export interface CheckedAttemptContractSurface {
  readonly fallibleFunctionId: FunctionId;
  readonly resultType: CheckedType;
  readonly okType: CheckedType;
  readonly errType: CheckedType;
  readonly inputs: readonly CheckedAttemptInputPosition[];
  readonly span: SourceSpan;
}

export interface CheckedValidationContractSurface {
  readonly validatedBufferTypeId: TypeId;
  readonly resultType: CheckedType;
  readonly sourceType: CheckedType;
  readonly okPayloadType: CheckedType;
  readonly errPayloadType: CheckedType;
  readonly sourceParameterId?: ParameterId;
  readonly span: SourceSpan;
}
```

```ts
test("attempt contracts preserve declared inputs", () => {
  const surface = checkedProofSurface({
    attemptContracts: [
      {
        fallibleFunctionId: functionId(3),
        resultType: coreCheckedType(coreTypeId("Attempt")),
        okType: coreCheckedType(coreTypeId("bool")),
        errType: coreCheckedType(coreTypeId("u32")),
        inputs: [{ kind: "parameter", parameterId: parameterId(0) }],
        span,
      },
    ],
  });

  expect(surface.attemptContracts.get(functionId(3))![0]!.inputs).toEqual([
    { kind: "parameter", parameterId: parameterId(0) },
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/proof-surface.validation-attempt.test.ts
bun test ./tests/integration/semantic/semantic-surface.validation-attempt.test.ts
```

---

## Task 7: Semantic Private Transition And Platform Ensured-Fact Contracts

**Description:** Add checked private-state transition and structured platform ensured-fact contracts so HIR can preserve those proof edges rather than synthesizing them.

**Dependencies:** Task 4A.

**Files:**

- Modify: `src/semantic/surface/proof-contracts/private-platform.ts`
- Modify: `src/semantic/surface/platform-surface.ts`
- Modify: `src/semantic/surface/platform-certifier.ts`
- Test: `tests/unit/semantic/surface/proof-surface.private-platform.test.ts`
- Test: `tests/unit/semantic/surface/platform-certifier.test.ts`
- Test: `tests/integration/semantic/semantic-surface.private-platform.test.ts`

**Acceptance Criteria:**

- `CheckedPrivateTransitionSurface` maps source functions to `predicate`, `advance`, `close`, or `unknown`.
- Predicate private-state functions are represented as fact-producing, not transition-producing.
- `TargetProofContractSurface.ensuredFacts` is migrated from the current text-placeholder shape to structured checked fact records.
- The old raw target proof-text placeholder remains rejected by certification and is not exposed to HIR.
- Platform certification accepts and preserves structured ensured facts only for certified bindings.
- Unsupported raw target ensured facts produce deterministic certification diagnostics and do not reach HIR.
- Fingerprints remain for auditing, but HIR consumes structured records.
- Private-transition surfaces are produced from checked private-state resource kinds plus checked function receiver modes: checked predicate/private-state functions produce `predicate`, checked consuming or mutating receiver calls produce `advance`, checked destructor-like terminal receivers produce `close`, and unclear receiver/return shapes produce `unknown`.
- Platform ensured-fact surfaces are produced only from structured `TargetProofContractSurface.ensuredFacts` records on bindings that pass exact target certification. Rejected certification, raw text, unsupported argument binding kinds, or target/source signature mismatch produce no HIR-consumable platform ensured fact.
- The migration is a hard cutover for HIR-facing data: structured facts replace raw target proof text in certified bindings. Tests may keep a legacy `rawText` fixture only to assert certification rejects it.

**Code Examples:**

```ts
export interface CheckedPrivateTransitionSurface {
  readonly functionId: FunctionId;
  readonly kind: "predicate" | "advance" | "close" | "unknown";
  readonly receiverParameterId?: ParameterId;
  readonly span: SourceSpan;
}

export interface CheckedPlatformEnsuredFactSurface {
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly fingerprint: string;
  readonly fact: CheckedPlatformEnsuredFact;
}

export type CheckedPlatformEnsuredFact =
  | {
      readonly kind: "predicate";
      readonly predicateFunctionId: FunctionId;
      readonly argumentBindings: readonly CheckedPlatformFactArgument[];
    }
  | {
      readonly kind: "state";
      readonly stateKind: "advanced" | "closed" | "available";
      readonly argumentBindings: readonly CheckedPlatformFactArgument[];
    };
```

```ts
test("private transition surface preserves close classification", () => {
  const surface = checkedProofSurface({
    privateTransitions: [
      {
        functionId: functionId(5),
        kind: "close",
        receiverParameterId: parameterId(0),
        span,
      },
    ],
  });

  expect(surface.privateTransitions.get(functionId(5))![0]!.kind).toBe("close");
});
```

**Verification:**

```bash
bun test ./tests/unit/semantic/surface/proof-surface.private-platform.test.ts
bun test ./tests/unit/semantic/surface/platform-certifier.test.ts
bun test ./tests/integration/semantic/semantic-surface.private-platform.test.ts
```

---

## Task 8: HIR ID And Table Substrate

**Description:** Create branded HIR IDs, owner-scoped proof IDs, canonical table keys, and deterministic table builders.

**Dependencies:** None.

**Files:**

- Create: `src/hir/deterministic-sort.ts`
- Create: `src/hir/ids.ts`
- Create: `src/hir/hir-table.ts`
- Test: `tests/unit/hir/ids.test.ts`

**Acceptance Criteria:**

- Every ID family from the design is branded.
- `src/hir/deterministic-sort.ts` re-exports `compareCodeUnitStrings` from `src/semantic/surface/deterministic-sort.ts`; it must not contain a second implementation.
- Numeric constructors reject negative or non-integer values.
- `HirOwnedId<T>` includes `HirProofOwner`.
- `ownedIdKey` renders canonical owner-local keys such as `function:12/obligation:3`.
- `hirTable` stores immutable sorted entries and exposes `get`, `keyOf`, `lookupKeyOf`, and `entries`.
- `hirTable` has two explicit key functions: `keyOf(entry)` produces the canonical storage key for a table entry, and `lookupKeyOf(id)` produces the same canonical key from the public lookup ID accepted by `get`.
- `get(id)` must use `lookupKeyOf(id)` and must never rely on `String(id)`, object identity, branded-number widening, or raw `Map` insertion keys.
- Unit tests cover a table whose entry stores an owned key string but whose public lookup ID is a branded ID object, proving `keyOf` and `lookupKeyOf` are intentionally different hooks.
- Tables do not depend on `Map` insertion order at read time.

**Code Examples:**

```ts
export type HirProofOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "image"; readonly imageId: ImageId }
  | { readonly kind: "type"; readonly typeId: TypeId };

export interface HirOwnedId<Id> {
  readonly owner: HirProofOwner;
  readonly id: Id;
}
```

```ts
export interface HirTable<LookupId, Entry> {
  get(id: LookupId): Entry | undefined;
  keyOf(entry: Entry): string;
  lookupKeyOf(id: LookupId): string;
  entries(): readonly Entry[];
}

export function hirTable<LookupId, Entry>(input: {
  readonly entries: readonly Entry[];
  readonly keyOf: (entry: Entry) => string;
  readonly lookupKeyOf: (id: LookupId) => string;
}): HirTable<LookupId, Entry>;
```

```ts
test("owned proof id keys include owner and id family", () => {
  const id = ownedId(
    { kind: "function", functionId: functionId(12) },
    obligationId(3),
    "obligation",
  );

  expect(ownedIdKey(id, "obligation")).toBe("function:12/obligation:3");
});
```

```ts
test("hir tables return immutable deterministic entries", () => {
  const table = hirTable({
    entries: [entryB, entryA],
    keyOf: (entry) => entry.key,
    lookupKeyOf: (key) => key,
  });

  expect(table.entries().map((entry) => entry.key)).toEqual(["a", "b"]);
  expect(table.entries()).not.toBe(table.entries());
});
```

```ts
test("hir table lookup key can differ from entry storage field", () => {
  const table = hirTable({
    entries: [{ obligationId: ownedObligationId(functionId(12), 3), text: "ready" }],
    keyOf: (entry) => ownedIdKey(entry.obligationId, "obligation"),
    lookupKeyOf: (id) => ownedIdKey(id, "obligation"),
  });

  expect(table.get(ownedObligationId(functionId(12), 3))!.text).toBe("ready");
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/ids.test.ts
```

---

## Task 9: HIR Diagnostics And Origins

**Description:** Implement HIR origin allocation and the complete closed deterministic diagnostic registry used by every later HIR task.

**Dependencies:** Task 8.

**Files:**

- Create: `src/hir/origin.ts`
- Create: `src/hir/diagnostics.ts`
- Test: `tests/unit/hir/origin.test.ts`
- Test: `tests/unit/hir/diagnostics.test.ts`

**Acceptance Criteria:**

- `HirOrigin` records `originId`, `moduleId`, `span`, optional `syntaxKind`, `ownerItemId`, and `ownerFunctionId`.
- Origin allocation is deterministic by module ID, span, owner IDs, syntax kind, and source-order tie breaker.
- The source-order tie breaker is the preorder ordinal of the syntax node within its module. Missing synthetic nodes use `missing:<parentSyntaxKind>:<expectedSlotIndex>` so zero-width recovery origins are deterministic.
- HIR diagnostic codes are a complete closed registry with stable `HIR_` names for all planned lowerers.
- Diagnostic sorting uses `HirDiagnosticOrder`, not localized message text.
- `HirDiagnostic` and `HirDiagnosticOrder` are defined here and are the only diagnostic shape HIR lowerers emit.
- `HirDiagnosticOrder.tieBreaker` uses `owner:<ownerKey>/origin:<originKey>/code:<code>/detail:<stableDetail>`; `stableDetail` is a code-unit string chosen by the first-emitting task, such as `missing-callee` or `field:<fieldId>`.
- Diagnostics can reference `originId` and related origin information.
- Tasks 13 through 25 must not modify `src/hir/diagnostics.ts`; missing code needs are a Task 9 defect, not a downstream edit.

**Code Examples:**

```ts
export interface HirOrigin {
  readonly originId: HirOriginId;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly syntaxKind?: SyntaxKind;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
}

export interface HirOriginAllocator {
  forSyntax(input: {
    readonly moduleId: ModuleId;
    readonly node: RedNode;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
  forMissingSyntax(input: {
    readonly moduleId: ModuleId;
    readonly parent: RedNode;
    readonly expectedSlotIndex: number;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
  forSynthetic(input: {
    readonly moduleId: ModuleId;
    readonly span: SourceSpan;
    readonly stableDetail: string;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
}
```

```ts
export const HIR_DIAGNOSTIC_CODES = [
  "HIR_BODYLESS_RECOVERY",
  "HIR_LOCAL_NAME_SHADOWS",
  "HIR_UNSUPPORTED_PATTERN",
  "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
  "HIR_NAME_REFERENCE_MISSING",
  "HIR_MEMBER_REFERENCE_MISSING",
  "HIR_MEMBER_REFERENCE_MISMATCH",
  "HIR_UNSUPPORTED_EXPRESSION",
  "HIR_EXPRESSION_TYPE_MISMATCH",
  "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
  "HIR_OBJECT_FIELD_TYPE_MISMATCH",
  "HIR_NON_PLACE_ASSIGNMENT_TARGET",
  "HIR_CONDITION_NOT_BOOL",
  "HIR_RETURN_TYPE_MISMATCH",
  "HIR_YIELD_TYPE_MISMATCH",
  "HIR_CALL_CALLEE_NOT_FUNCTION",
  "HIR_CALL_ARGUMENT_MISMATCH",
  "HIR_WRONG_GENERIC_ARGUMENT_COUNT",
  "HIR_UNRESOLVED_GENERIC_ARGUMENT",
  "HIR_CONFLICTING_GENERIC_ARGUMENT",
  "HIR_GENERIC_BOUND_NOT_SATISFIED",
  "HIR_FORGED_SEALED_CONSTRUCTION",
  "HIR_UNLOWERABLE_REQUIREMENT",
  "HIR_UNSUPPORTED_REQUIREMENT_FORM",
  "HIR_REQUIREMENT_REFERENCE_MISMATCH",
  "HIR_UNCLASSIFIED_TAKE",
  "HIR_TAKE_ONLY_CALL_REQUIRED",
  "HIR_UNLINKED_VALIDATION_MATCH",
  "HIR_AMBIGUOUS_VALIDATION_MATCH",
  "HIR_ATTEMPT_INPUT_NOT_PLACE",
  "HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE",
  "HIR_PLATFORM_ENSURE_NOT_CERTIFIED",
  "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  "HIR_INPUT_SURFACE_DISAGREEMENT",
  "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
  "HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED",
  "HIR_IMAGE_DEVICE_SURFACE_MISSING",
  "HIR_IMAGE_ENTRY_SURFACE_MISSING",
] as const;

export type HirDiagnosticCode = (typeof HIR_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "HirDiagnosticCode";
};
```

```ts
export const HIR_DIAGNOSTIC_FIRST_EMITTER = {
  HIR_BODYLESS_RECOVERY: "Task 11",
  HIR_LOCAL_NAME_SHADOWS: "Task 13",
  HIR_UNSUPPORTED_PATTERN: "Task 18",
  HIR_INTEGER_LITERAL_OUT_OF_RANGE: "Task 15",
  HIR_NAME_REFERENCE_MISSING: "Task 15",
  HIR_MEMBER_REFERENCE_MISSING: "Task 15",
  HIR_MEMBER_REFERENCE_MISMATCH: "Task 15",
  HIR_UNSUPPORTED_EXPRESSION: "Task 15",
  HIR_EXPRESSION_TYPE_MISMATCH: "Task 15",
  HIR_OBJECT_LITERAL_TYPE_REQUIRED: "Task 15",
  HIR_OBJECT_FIELD_TYPE_MISMATCH: "Task 15",
  HIR_NON_PLACE_ASSIGNMENT_TARGET: "Task 18",
  HIR_CONDITION_NOT_BOOL: "Task 18",
  HIR_RETURN_TYPE_MISMATCH: "Task 18",
  HIR_YIELD_TYPE_MISMATCH: "Task 18",
  HIR_CALL_CALLEE_NOT_FUNCTION: "Task 17",
  HIR_CALL_ARGUMENT_MISMATCH: "Task 17",
  HIR_WRONG_GENERIC_ARGUMENT_COUNT: "Task 16",
  HIR_UNRESOLVED_GENERIC_ARGUMENT: "Task 16",
  HIR_CONFLICTING_GENERIC_ARGUMENT: "Task 16",
  HIR_GENERIC_BOUND_NOT_SATISFIED: "Task 16",
  HIR_FORGED_SEALED_CONSTRUCTION: "Task 16",
  HIR_UNLOWERABLE_REQUIREMENT: "Task 21",
  HIR_UNSUPPORTED_REQUIREMENT_FORM: "Task 21",
  HIR_REQUIREMENT_REFERENCE_MISMATCH: "Task 21",
  HIR_UNCLASSIFIED_TAKE: "Task 22",
  HIR_TAKE_ONLY_CALL_REQUIRED: "Task 22",
  HIR_UNLINKED_VALIDATION_MATCH: "Task 23",
  HIR_AMBIGUOUS_VALIDATION_MATCH: "Task 23",
  HIR_ATTEMPT_INPUT_NOT_PLACE: "Task 23",
  HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE: "Task 22",
  HIR_PLATFORM_ENSURE_NOT_CERTIFIED: "Task 24",
  HIR_MATCH_REFINEMENT_UNSUPPORTED: "Task 24",
  HIR_INPUT_SURFACE_DISAGREEMENT: "Task 11",
  HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING: "Task 19",
  HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED: "Task 19",
  HIR_IMAGE_DEVICE_SURFACE_MISSING: "Task 20",
  HIR_IMAGE_ENTRY_SURFACE_MISSING: "Task 20",
} satisfies Record<(typeof HIR_DIAGNOSTIC_CODES)[number], string>;
```

```ts
export interface HirDiagnostic {
  readonly code: HirDiagnosticCode;
  readonly message: string;
  readonly originId?: HirOriginId;
  readonly span?: SourceSpan;
  readonly order: HirDiagnosticOrder;
  readonly relatedInformation?: readonly HirDiagnosticRelatedInformation[];
}

export interface HirDiagnosticOrder {
  readonly ownerKey: string;
  readonly originKey: string;
  readonly code: HirDiagnosticCode;
  readonly tieBreaker: string;
}

export function hirDiagnosticTieBreaker(input: {
  readonly ownerKey: string;
  readonly originKey: string;
  readonly code: HirDiagnosticCode;
  readonly stableDetail: string;
}): string {
  return `owner:${input.ownerKey}/origin:${input.originKey}/code:${input.code}/detail:${input.stableDetail}`;
}
```

```ts
test("diagnostics sort by order before display message", () => {
  const sorted = sortHirDiagnostics([lateDiagnostic, earlyDiagnostic]);
  expect(sorted.map((diagnostic) => diagnostic.order.tieBreaker)).toEqual([
    "owner:function:1/origin:NameExpression:0/code:HIR_CALL_CALLEE_NOT_FUNCTION/detail:missing-callee",
    "owner:function:1/origin:NameExpression:1/code:HIR_CALL_CALLEE_NOT_FUNCTION/detail:missing-callee",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/origin.test.ts
bun test ./tests/unit/hir/diagnostics.test.ts
```

---

## Task 10: HIR Model And Proof Metadata Records

**Description:** Define the typed HIR program model, function/body/index models, expression and statement ADTs, proof metadata records, and table factories.

**Dependencies:** Tasks 8 and 9.

**Files:**

- Create: `src/hir/hir.ts`
- Create: `src/hir/proof-metadata.ts`
- Create: `src/hir/brand-registry.ts`
- Test: `tests/unit/hir/proof-metadata.test.ts`

**Acceptance Criteria:**

- `TypedHirProgram` contains declarations, functions, validated buffers, images, proof metadata, and origins.
- `HirFunction` supports `sourceBody`, `certifiedPlatform`, and `bodylessRecovery`.
- `HirBodyIndex` indexes immutable statement and expression nodes and includes `ensureCandidates`.
- `src/hir/hir.ts` exports the full public ADT surface from the design: `HirExpressionKind`, `HirStatementKind`, `HirTakeKind`, `HirForIteration`, `HirEnsureCandidate`, `HirRequirementExpression`, `HirProofExpression`, `HirCallExpression`, `HirFactContent`, `HirCertifiedPlatformEnsuredFact`, `HirValidation`, `HirAttempt`, `HirTerminalCall`, `HirPrivateStateTransition`, `HirPlatformContractEdge`, `HirImage`, and `HirValidatedBuffer`.
- Discriminant literals are closed here and imported by lowerer tests instead of retyping ad hoc unions.
- Proof metadata tables cover obligations, sessions, brands, resource places, call-site requirements, validations, attempts, terminal calls, private transitions, fact origins, platform contract edges, and image origins.
- Public records use `HirOwnedId<T>` for proof metadata IDs.
- `HirProofMetadataBuilder` exposes append methods for every proof table, so Tasks 20 through 25 do not edit `proof-metadata.ts`.
- `HirProofMetadataBuilder` exposes read-only staged table accessors used by unit harnesses, such as `builder.factOrigins.entries()`, before final `build()`.
- `HirBrandRegistry` implements the two-pass allocation seam for global image/device/platform-token brands and function-owned brands.
- Brand canonical keys are fixed here and reused by Task 20: `image:<imageId>:field:<fieldId>:root:<uniqueEdgeRootKey>`, `platform:<sourceFunctionId>:primitive:<primitiveId>:contract:<contractId>:target:<targetId>`, `function:<functionId>:session:<ordinal>`, `function:<functionId>:validation:<ordinal>`, and `function:<functionId>:take:<statementOrdinal>`.

**Code Examples:**

```ts
export interface TypedHirProgram {
  readonly declarations: HirDeclarationTable;
  readonly functions: HirFunctionTable;
  readonly validatedBuffers: HirValidatedBufferTable;
  readonly images: HirImageTable;
  readonly proofMetadata: HirProofMetadata;
  readonly origins: HirOriginTable;
}
```

```ts
export interface HirFunction {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly signature: CheckedFunctionSignature;
  readonly bodyStatus: "sourceBody" | "certifiedPlatform" | "bodylessRecovery";
  readonly locals: HirLocalTable;
  readonly body?: HirBlock;
  readonly bodyIndex?: HirBodyIndex;
  readonly declaredRequirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}
```

```ts
export interface HirBodyIndex {
  readonly expressions: HirExpressionTable;
  readonly statements: HirStatementTable;
  readonly ensureCandidates: readonly HirEnsureCandidate[];
}

export interface HirEnsureCandidate {
  readonly statementId: HirStatementId;
  readonly expressionId: HirExpressionId;
  readonly sourceStatementKind: "ensure";
  readonly sourceOrigin: HirOriginId;
}
```

```ts
export const HIR_FACT_CONTENT_KINDS = [
  "predicateCall",
  "ensure",
  "platformEnsure",
  "matchRefinement",
] as const;

export const HIR_TAKE_OPERAND_KINDS = ["place", "takeOnlyCall", "error"] as const;
export const HIR_TAKE_KIND_KINDS = ["stream", "buffer", "validatedBuffer", "error"] as const;
export const HIR_FOR_ITERATION_KINDS = ["ordinary", "stream", "error"] as const;
export const HIR_ATTEMPT_KINDS = ["attempt", "error"] as const;
export const HIR_VALIDATION_MATCH_KINDS = ["validationMatch", "error"] as const;
```

```ts
export interface HirValidation {
  readonly validationId: HirOwnedId<ValidationId>;
  readonly validationExpressionId: HirExpressionId;
  readonly sourcePlace: HirResourcePlace;
  readonly pendingResultPlace: HirResourcePlace;
  readonly resultLocalId?: HirLocalId;
  readonly validatedBufferTypeId: TypeId;
  readonly sourceOrigin: HirOriginId;
}

export interface HirAttempt {
  readonly attemptId: HirOwnedId<AttemptId>;
  readonly attemptExpressionId: HirExpressionId;
  readonly fallibleExpression: HirExpression;
  readonly alternativeExpression?: HirExpression;
  readonly declaredInputPlaces: readonly HirResourcePlace[];
  readonly sourceOrigin: HirOriginId;
}
```

```ts
test("empty proof metadata exposes all tables", () => {
  const metadata = emptyHirProofMetadata();
  expect(metadata.obligations.entries()).toEqual([]);
  expect(metadata.sessions.entries()).toEqual([]);
  expect(metadata.brands.entries()).toEqual([]);
  expect(metadata.platformContractEdges.entries()).toEqual([]);
});
```

```ts
const metadata = new HirProofMetadataBuilder()
  .addResourcePlace(place)
  .addFactOrigin(factOrigin)
  .addPlatformContractEdge(edge)
  .build();
```

```ts
export interface HirProofMetadataBuilderApi {
  addObligation(obligation: HirObligation): this;
  addSession(session: HirSession): this;
  addBrand(brand: HirBrand): this;
  addResourcePlace(place: HirResourcePlace): this;
  addCallSiteRequirement(requirement: HirCallSiteRequirement): this;
  addValidation(validation: HirValidation): this;
  addAttempt(attempt: HirAttempt): this;
  addTerminalCall(call: HirTerminalCall): this;
  addPrivateStateTransition(transition: HirPrivateStateTransition): this;
  addFactOrigin(origin: HirFactOrigin): this;
  addPlatformContractEdge(edge: HirPlatformContractEdge): this;
  addImageOrigin(origin: HirImageOrigin): this;
  build(): HirProofMetadata;
}
```

```ts
export type HirBrandCanonicalKey =
  | `image:${number}:field:${number}:root:${string}`
  | `platform:${number}:primitive:${string}:contract:${string}:target:${string}`
  | `function:${number}:session:${number}`
  | `function:${number}:validation:${number}`
  | `function:${number}:take:${number}`;
```

**Verification:**

```bash
bun test ./tests/unit/hir/proof-metadata.test.ts
```

---

## Task 11: Lowering Context, Builder Skeleton, And Declaration Lowering

**Description:** Create the shared lowering context seam, the `TypedHirBuilder`, and the skeleton `lowerTypedHir` flow that lowers declarations and function shells without body expression lowering.

**Dependencies:** Tasks 8, 9, and 10.

**Files:**

- Create: `src/hir/lowering-context.ts`
- Create: `src/hir/reference-lookup.ts`
- Create: `src/hir/typed-hir-builder.ts`
- Create: `src/hir/body-lowerer.ts`
- Test: `tests/unit/hir/lowering-context.test.ts`
- Test: `tests/unit/hir/reference-lookup.test.ts`
- Test: `tests/integration/hir/declaration-lowering.test.ts`

**Acceptance Criteria:**

- `lowerTypedHir` returns a `TypedHirProgram` and sorted HIR diagnostics.
- `HirLoweringContext` is exported and is the only context type later lowerers accept.
- The context exposes origin allocation, diagnostic reporting, local scope, place interning, brand registry, and the mutable `HirProofMetadataBuilder`.
- The context exposes a per-function `HirBodyIndexBuilder`; it resets for each source-body function and builds `HirBodyIndex` after body lowering.
- Context lifecycle is explicit: one program context owns global diagnostics, origins, brand registry, proof metadata, and reference lookup; each source-body function creates a child function context with fresh local scope, place interner, and body-index builder.
- `HirReferenceLookup` indexes `ResolvedReferences.entries()`, `program.completedMembers`, and checked requirement references by syntax key/span. Disagreements for the same key emit `HIR_INPUT_SURFACE_DISAGREEMENT`.
- Task 15 consumes completed member references only through `HirReferenceLookup.completedMemberFor(key)`.
- Lowerer-for-test signatures and harness result types are exported here; Task 12 implements the harnesses against these signatures.
- Source declarations are lowered as `HirDeclaration` records in item-index order.
- Function records are created for all checked signatures.
- Certified platform functions are `bodyStatus: "certifiedPlatform"`.
- Functions with missing checked signatures are recovered as `bodylessRecovery`.
- Source-body functions reserve origin, local, statement, expression, and proof cursors but can initially contain an empty recovered block.
- `lowerSelectedImage()` exists only as an empty stub until Task 20; it must not create image metadata in Task 11.

**Code Examples:**

```ts
export interface HirLoweringContext {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly coreTypes: CoreTypeCatalog;
  readonly program: CheckedSemanticProgram;
  readonly image?: CheckedImageSeed;
  readonly origins: HirOriginAllocator;
  readonly diagnostics: HirDiagnosticSink;
  readonly locals: HirLocalScope;
  readonly places: HirResourcePlaceInterner;
  readonly brands: HirBrandRegistry;
  readonly proofMetadata: HirProofMetadataBuilder;
  readonly bodyIndex: HirBodyIndexBuilder;
  readonly referenceLookup: HirReferenceLookup;
}

export interface LowerExpressionHarnessResult {
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}

export interface LowerStatementHarnessResult {
  readonly statement: HirStatement;
  readonly context: HirLoweringContext;
}

export interface LowerTakeHarnessResult {
  readonly statement: HirTakeStatement;
  readonly context: HirLoweringContext;
}

export interface LowerCallProofMetadataHarnessResult {
  readonly call: HirCallExpression;
  readonly context: HirLoweringContext;
}
```

```ts
export interface HirReferenceLookup {
  referenceFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
  completedMemberFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
  requirementReferenceFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
}

export function buildHirReferenceLookup(input: {
  readonly references: ResolvedReferences;
  readonly completedMembers: CheckedCompletedMemberTable;
  readonly requirementReferences: readonly CheckedRequirementReference[];
  readonly diagnostics: HirDiagnosticSink;
}): HirReferenceLookup;
```

```ts
test("reference lookup reports checked input disagreements deterministically", () => {
  const diagnostics = new HirDiagnosticSink();
  buildHirReferenceLookup({
    references: resolvedReferencesFake({ [keyId]: builtinTypeRef("u32") }),
    completedMembers: completedMembersFake({ [keyId]: fieldRef(fieldId(1)) }),
    requirementReferences: [],
    diagnostics,
  });

  expect(diagnostics.entries().map((diagnostic) => diagnostic.code)).toEqual([
    "HIR_INPUT_SURFACE_DISAGREEMENT",
  ]);
});
```

```ts
export function lowerTypedHir(input: LowerTypedHirInput): LowerTypedHirResult {
  const builder = new TypedHirBuilder(input);
  builder.lowerDeclarations();
  builder.lowerFunctionShells();
  builder.lowerSelectedImage();
  return builder.build();
}

class TypedHirBuilder {
  lowerSelectedImage(): void {
    // Task 20 replaces this stub with checked image-seed lowering.
  }
}
```

```ts
test("lowerTypedHir creates function shells from checked signatures", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "fn helper() -> bool\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });
  const result = lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });

  expect(result.program.functions.entries().map((func) => func.bodyStatus)).toContain("sourceBody");
  expect(result.diagnostics).toEqual([]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/lowering-context.test.ts
bun test ./tests/unit/hir/reference-lookup.test.ts
bun test ./tests/integration/hir/declaration-lowering.test.ts
```

---

## Task 12: HIR Test Fakes And Summary Serializers

**Description:** Create focused shared test support for HIR unit and integration tests without mocks or filesystem access. Task-specific `lowerXForTest` helpers are owned by the lowerer task that first uses them.

**Dependencies:** Tasks 4A, 5, 6, 7, and 11.

**Files:**

- Create: `tests/support/hir/typed-hir-fakes.ts`
- Create: `tests/support/hir/typed-hir-fixtures.ts`
- Test: `tests/unit/hir/typed-hir-fixtures.test.ts`
- Test: `tests/integration/hir/typed-hir-fixtures.test.ts`

**Acceptance Criteria:**

- Unit fakes can build checked signatures, checked fields, proof surfaces, resolved references, and source spans.
- Integration fixture parses, indexes, resolves, checks semantic surface, and lowers HIR through the real pipeline introduced by Task 11.
- Unit harnesses are hand-built by default: they construct a `HirLoweringContext` from fake checked semantic data and do not run parser/name-resolution/semantic-surface unless the test explicitly calls `lowerTypedHirForTest`.
- Integration harnesses are pipeline-backed: `lowerTypedHirForTest` runs parse, item index, name resolution, semantic surface, and HIR lowering.
- Generic harness factories exist for expression, statement, call, declaration, and metadata-focused lowerer tests.
- Later tasks define task-local convenience helpers such as `lowerTakeForTest` or `lowerFactForTest` in their own task-owned test files by calling the shared harness factories.
- Named fake builders used by later examples exist: `targetWithCertifiedExit`, `targetWithSerialDevice`, `targetWithRejectedRawEnsuredFact`, `shuffledSemanticTargetSurfaceFake`, `proofSurfaceKitchenSinkProgram`, `streamTakeSurface`, `bufferTakeSurface`, `attemptContractForParameter`, `validationContractForBuffer`, `certifiedPlatformBindingFake`, `terminalSurfaceFake`, `successfulCallFake`, `parameterPlace`, and `localFake`.
- `tests/support/hir/typed-hir-fakes.ts` imports and reuses existing semantic fakes such as `primitiveSpecFake`, `deviceSurfaceFake`, `uefiImageProfileFake`, and `semanticTargetSurfaceFake` rather than redefining them.
- Harnesses use the `HirLoweringContext` and `Lower*HarnessResult` types exported by Task 11; they do not define alternate context or metadata result shapes.
- Every harness documents the grammar it requires and uses only syntax already available from Tasks 2 and 3 or existing frontend support.
- Summary serializer covers diagnostics, function order, origins, local IDs, places, proof metadata, and image records.
- Summaries use code-unit sorting and stable fingerprints.

**Code Examples:**

```ts
export function lowerTypedHirForTest(
  files: readonly [string, string][],
  options?: {
    readonly platformNames?: readonly string[];
    readonly targetSurface?: SemanticTargetSurface;
    readonly imageRoot?: ImageRootSelection;
  },
): LowerTypedHirResult {
  const targetSurface = options?.targetSurface ?? semanticTargetSurfaceFake();
  const fixture = parseAndResolveSurfaceFixture(files, { ...options, targetSurface });
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
    imageRoot: options?.imageRoot,
  });

  return lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });
}
```

```ts
export function createExpressionLowererHarness(lowerExpression: ExpressionLowererForTest) {
  return function lowerExpressionForTest(
    sourceText: string,
    options?: HirUnitHarnessOptions,
  ): LowerExpressionHarnessResult {
    const context = createHirUnitContext(sourceText, options);
    const expression = firstExpressionView(context.graph);
    return lowerExpression({ view: expression, expectedType: options?.expectedType, context });
  };
}
```

```ts
export function targetWithCertifiedExit(): SemanticTargetSurface {
  const exitPrimitive = primitiveSpecFake({
    name: "exit",
    signature: {
      ...voidTargetSignature(),
      returnType: coreCheckedType(coreTypeId("Never")),
      returnKind: concreteKind("Never"),
      requiredModifiers: ["terminal"],
    },
  });

  return semanticTargetSurfaceFake({
    primitives: [exitPrimitive],
  });
}

export function targetWithSerialDevice(edgeRootNames: readonly string[]): SemanticTargetSurface {
  const serialDevice = deviceSurfaceFake({
    name: "serial",
    sourceTypeName: "SerialDevice",
    resourceKind: "UniqueEdgeRoot",
    uniqueEdgeRoots: edgeRootNames,
  });

  return semanticTargetSurfaceFake({
    devices: [serialDevice],
    profiles: [
      {
        ...uefiImageProfileFake(),
        availableDeviceSurfaces: [serialDevice.deviceSurfaceId],
      },
    ],
  });
}

export function shuffledSemanticTargetSurfaceFake(seed: number): SemanticTargetSurface {
  const primitives = [
    primitiveSpecFake({ name: "alpha" }),
    primitiveSpecFake({ name: "omega" }),
    primitiveSpecFake({ name: "middle" }),
  ];
  const devices = [
    deviceSurfaceFake({ name: "keyboard" }),
    deviceSurfaceFake({ name: "serial" }),
    deviceSurfaceFake({ name: "timer" }),
  ];

  return semanticTargetSurfaceFake({
    primitives: seed % 2 === 0 ? primitives : [...primitives].reverse(),
    devices: seed % 2 === 0 ? devices : [...devices].reverse(),
  });
}

export function targetWithRejectedRawEnsuredFact(): SemanticTargetSurface {
  return semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "raw_contract",
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [{ kind: "rawText", text: "ready(self)" }],
        },
      }),
    ],
  });
}

export function proofSurfaceKitchenSinkProgram(): readonly [string, string][] {
  return [
    [
      "main.wr",
      [
        "predicate fn ready() -> bool",
        "terminal fn stop() -> Never",
        "platform fn exit() -> Never",
        "fn validate(input: Buffer) -> ValidationResult",
        "fn fallible(input: Buffer) -> Attempt<bool, u32>",
        "private type Door:",
        "    fn advance(self: consume Door) -> Door",
        "fn use(self: consume Receiver, buffer: Buffer, door: consume Door) -> Never:",
        "    ensure ready()",
        "    take self.rx.receive() as batch:",
        "        continue",
        "    let validation = validate(buffer)",
        "    match validation:",
        "        Ok(validated):",
        "            fallible(validated)",
        "        Err(error):",
        "            exit()",
        "    door.advance()",
        "    stop()",
        "uefi image Boot:",
        "    devices:",
        "        serial: Serial",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ];
}

export function bufferTakeSurface(typeId: TypeId): CheckedTakeModeSurface {
  return {
    kind: "buffer",
    sourceTypeId: typeId,
    bufferResourceKind: concreteKind("Linear"),
    span: SourceSpan.from(0, 0),
  };
}

export function streamTakeSurface(producerFunctionId: FunctionId): CheckedTakeModeSurface {
  return {
    kind: "stream",
    producerFunctionId,
    itemType: coreCheckedType(coreTypeId("u8")),
    itemResourceKind: concreteKind("Affine"),
    span: SourceSpan.from(0, 0),
  };
}

export function attemptContractForParameter(
  parameterId: ParameterId,
): CheckedAttemptContractSurface {
  return {
    fallibleFunctionId: functionId(0),
    resultType: coreCheckedType(coreTypeId("Attempt")),
    okType: coreCheckedType(coreTypeId("bool")),
    errType: coreCheckedType(coreTypeId("u32")),
    inputs: [{ kind: "parameter", parameterId }],
    span: SourceSpan.from(0, 0),
  };
}

export function validationContractForBuffer(typeId: TypeId): CheckedValidationContractSurface {
  return {
    validatedBufferTypeId: typeId,
    resultType: coreCheckedType(coreTypeId("ValidationResult")),
    sourceType: coreCheckedType(coreTypeId("Buffer")),
    okPayloadType: coreCheckedType(coreTypeId("Buffer")),
    errPayloadType: coreCheckedType(coreTypeId("u32")),
    span: SourceSpan.from(0, 0),
  };
}
```

```ts
export function successfulCallFake(input: {
  readonly calleeFunctionId: FunctionId;
  readonly arguments?: readonly HirCallArgument[];
}): HirCallExpression {
  return {
    callee: nameExpressionFake(input.calleeFunctionId),
    calleeFunctionId: input.calleeFunctionId,
    arguments: input.arguments ?? [],
    typeArguments: [],
  };
}

export function terminalSurfaceFake(input: {
  readonly functionId: FunctionId;
}): CheckedTerminalSurface {
  return terminalSurface({
    functionId: input.functionId,
    span: SourceSpan.from(0, 0),
  });
}

export function certifiedPlatformBindingFake(input: {
  readonly primitiveName: string;
}): CertifiedPlatformBinding {
  return {
    sourceFunctionId: functionId(0),
    primitiveId: platformPrimitiveId(input.primitiveName),
    contractId: platformContractId(`${input.primitiveName}_contract`),
    targetId: targetId("uefi-aarch64"),
    certificateFingerprint: `cert:${input.primitiveName}`,
    requiredFacts: [],
    ensuredFacts: [],
  };
}

export function parameterPlace(parameterId: ParameterId): HirResourcePlace {
  return resourcePlaceFake({
    root: { kind: "parameter", parameterId },
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
  });
}

export function localFake(input: { readonly name: string; readonly type: CheckedType }): HirLocal {
  return {
    localId: hirLocalId(0),
    name: input.name,
    type: input.type,
    resourceKind: concreteKind("Copy"),
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: hirOriginId(0),
  };
}
```

```ts
export function typedHirSummary(result: LowerTypedHirResult): string {
  return JSON.stringify({
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      start: diagnostic.span?.start ?? null,
      end: diagnostic.span?.end ?? null,
      tieBreaker: diagnostic.order.tieBreaker,
    })),
    functions: result.program.functions.entries().map((func) => ({
      functionId: func.functionId,
      bodyStatus: func.bodyStatus,
      locals: func.locals.entries().map((local) => local.localId),
    })),
  });
}
```

**Verification:**

```bash
bun test ./tests/unit/hir/typed-hir-fixtures.test.ts
bun test ./tests/integration/hir/typed-hir-fixtures.test.ts
```

---

## Task 13: Local Scope And No-Shadowing

**Description:** Implement function-local scope seeding, source local allocation, compiler temporary locals, and no-shadowing diagnostics.

**Dependencies:** Tasks 8, 9, and 10.

**Files:**

- Create: `src/hir/local-scope.ts`
- Test: `tests/unit/hir/local-scope.test.ts`

**Acceptance Criteria:**

- Function entry scope is seeded from receiver and parameters in checked signature order.
- Local IDs are unique within a `HirFunction`.
- Duplicate names across receiver, parameters, lets, patterns, for bindings, take aliases, validation-arm bindings, and named temporaries emit `HIR_LOCAL_NAME_SHADOWS`.
- Duplicate binding creates an error local and does not shadow the original binding.
- Scope lookup returns the original local for non-duplicate references and the error local for recovered duplicate references when explicitly bound to that syntax.
- `addSourceLocal` returns `{ local, diagnostics }`; local-scope helpers do not emit `HIR_UNSUPPORTED_PATTERN`, which is owned by Task 18.

**Code Examples:**

```ts
const scope = HirLocalScope.fromSignature({
  owner: { kind: "function", functionId: functionId(1) },
  signature,
  originForParameter(parameter) {
    return parameterOriginIds.get(parameter.parameterId)!;
  },
});
```

```ts
test("local scope rejects shadowing across nested blocks", () => {
  const scope = HirLocalScope.empty(owner);
  const first = scope.addSourceLocal({ name: "value", type, resourceKind, sourceOrigin });
  const second = scope.addSourceLocal({
    name: "value",
    type,
    resourceKind,
    sourceOrigin: nestedOrigin,
  });

  expect(first.diagnostics).toEqual([]);
  expect(second.local.mode).toBe("error");
  expect(second.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "HIR_LOCAL_NAME_SHADOWS",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/local-scope.test.ts
```

---

## Task 14: Resource Place Interner

**Description:** Implement canonical owner-scoped resource-place interning for parameters, receiver fields, locals, temporaries, validation payloads, and image devices.

**Dependencies:** Tasks 8, 9, and 10.

**Files:**

- Create: `src/hir/place.ts`
- Test: `tests/unit/hir/place.test.ts`

**Acceptance Criteria:**

- `HirResourcePlace` includes `placeId`, `canonicalKey`, root, projection, checked type, checked resource kind, and origin.
- Repeated `self.rx` occurrences in one function share one `ResourcePlaceId`.
- Disjoint receiver fields have distinct place IDs.
- Place canonical keys include owner, root, projection, type fingerprint, and resource-kind fingerprint.
- Canonical keys use this exact format: `function:<functionId>/root:<rootKind>:<rootId>/projection:<projectionParts>/type:<checkedTypeFingerprint>/kind:<resourceKindFingerprint>`.
- Copy-only intermediate expressions do not allocate places unless asked by a proof-relevant caller.
- Temporary roots are allocated only for proof-relevant expression results.

**Code Examples:**

```ts
const selfRx = interner.placeForProjection({
  root: { kind: "receiver", parameterId: parameterId(0) },
  projection: [{ kind: "field", fieldId: fieldId(2) }],
  type: rxType,
  resourceKind: concreteKind("Stream"),
  sourceOrigin,
});
```

```ts
const key = "function:1/root:receiver:0/projection:field:2/type:source:7/kind:concrete:Stream";
```

```ts
test("place interner reuses canonical receiver field place", () => {
  const first = interner.placeForProjection(receiverRxInput);
  const second = interner.placeForProjection(receiverRxInput);

  expect(first.placeId).toEqual(second.placeId);
  expect(first.canonicalKey).toBe(second.canonicalKey);
});
```

```ts
test("place interner separates disjoint receiver fields", () => {
  const rx = interner.placeForProjection({
    ...base,
    projection: [{ kind: "field", fieldId: fieldId(1) }],
  });
  const tx = interner.placeForProjection({
    ...base,
    projection: [{ kind: "field", fieldId: fieldId(2) }],
  });

  expect(rx.placeId).not.toEqual(tx.placeId);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/place.test.ts
```

---

## Task 15: Literal, Name, Member, And Object Expression Lowering

**Description:** Implement expression lowering for non-call expression shapes and exact body-local type synthesis.

**Dependencies:** Tasks 12, 13, and 14.

**Files:**

- Create: `src/hir/expression-lowerer.ts`
- Test: `tests/unit/hir/expression-lowerer.test.ts`

**Acceptance Criteria:**

- Integer, string, and boolean literals lower with checked type and resource kind.
- Integer literals use expected integer type first, then default core integer type.
- Out-of-range integer literals emit deterministic diagnostics and lower to error type/kind.
- Name expressions use local scope first and `ResolvedReferences` for semantic symbols.
- Member expressions consume completed member references through `context.referenceLookup.completedMemberFor(key)` and do not run a second member resolver.
- Place-like member access creates field-sensitive `HirResourcePlace` projections.
- Object literals require an expected source type or constructor target and lower fields to checked `FieldId`s when available.
- Object literals without an expected source type or constructor target emit `HIR_OBJECT_LITERAL_TYPE_REQUIRED`.
- Object literal field/value type mismatches emit `HIR_OBJECT_FIELD_TYPE_MISMATCH`.
- Expression type mismatches outside object literals emit `HIR_EXPRESSION_TYPE_MISMATCH`.
- Unsupported expression forms emit `HIR_UNSUPPORTED_EXPRESSION` and lower to error expressions with source origins.
- `tests/unit/hir/expression-lowerer.test.ts` defines `lowerExpressionForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
const expression = lowerExpression({
  view,
  expectedType: coreCheckedType(coreTypeId("u32")),
  context,
});
expect(expression.kind.kind).toBe("literal");
expect(expression.type).toEqual(coreCheckedType(coreTypeId("u32")));
```

```ts
test("member expression uses completed member reference", () => {
  const result = lowerExpressionForTest("fn use(self: consume Device) -> bool:\n    self.rx\n", {
    completedMembers: [
      { key: memberKey, reference: { kind: "field", ownerItemId: itemId(1), fieldId: fieldId(2) } },
    ],
  });

  expect(result.expression.kind).toMatchObject({
    kind: "member",
    memberPlace: expect.objectContaining({
      projection: [{ kind: "field", fieldId: fieldId(2) }],
    }),
  });
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/expression-lowerer.test.ts
```

---

## Task 16: Generic Call Inference And Constructibility Checks

**Description:** Implement deterministic call-site type argument inference, bound checking, type substitution, and no-forgery construction checks.

**Dependencies:** Tasks 4B, 12, 13, and 14.

**Files:**

- Create: `src/hir/generic-inference.ts`
- Create: `src/hir/generic-substitution.ts`
- Create: `src/hir/constructibility.ts`
- Test: `tests/unit/hir/generic-inference.test.ts`
- Test: `tests/unit/hir/constructibility.test.ts`

**Acceptance Criteria:**

- Explicit type arguments check arity and checked bounds.
- Inferred type arguments collect constraints from receiver, positional arguments, named arguments in checked parameter order, and expected return type.
- Unresolved parameters emit `HIR_UNRESOLVED_GENERIC_ARGUMENT`.
- Conflicting candidates emit `HIR_CONFLICTING_GENERIC_ARGUMENT`.
- Call result type and result resource kind use substituted checked signature facts.
- `generic-substitution.ts` imports `checkedTypeFingerprint` and `checkedTypesEqual` from `src/semantic/surface/type-model.ts`; it does not create a second checked-type fingerprint format.
- Constructibility helpers are pure in this task and do not edit `expression-lowerer.ts`; Task 26 invokes them from object-literal and constructor-call lowering.
- Object literals and constructor calls reject forged sealed/proof-relevant construction unless `CheckedConstructibilitySurface` authorizes it.
- Missing constructibility surface allows ordinary non-proof-relevant types and rejects sealed/proof-relevant types using `HIR_FORGED_SEALED_CONSTRUCTION`.
- Task 16 tests are fake-based and call `inferCallTypeArguments`, `substituteCheckedSignature`, and `checkConstructibility` directly; they do not parse snippets or use `lowerCallForTest`.

**Code Examples:**

```ts
const inference = inferCallTypeArguments({
  signature,
  receiverExpression,
  arguments: loweredArguments,
  expectedReturnType,
});

expect(inference.typeArguments.map(checkedTypeFingerprint)).toEqual(["core:u32"]);
```

```ts
test("generic inference reports conflicting parameter candidates deterministically", () => {
  const result = inferCallTypeArguments({
    signature: genericIdentityPairSignatureFake(),
    receiverExpression: undefined,
    arguments: [
      argumentFake({ type: coreCheckedType(coreTypeId("u32")) }),
      argumentFake({ type: coreCheckedType(coreTypeId("bool")) }),
    ],
    expectedReturnType: undefined,
    context: genericInferenceContextFake(),
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "HIR_CONFLICTING_GENERIC_ARGUMENT",
  );
});
```

```ts
test("constructibility rejects private state object literal without authorization", () => {
  const result = checkConstructibility({
    targetType: sourceCheckedType({ itemId: itemId(1), typeId: typeId(1) }),
    targetKind: concreteKind("PrivateState"),
    constructorFunctionId: undefined,
    surfaces: emptyConstructibilitySurfaceTable(),
    sourceOrigin,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "HIR_FORGED_SEALED_CONSTRUCTION",
  );
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/generic-inference.test.ts
bun test ./tests/unit/hir/constructibility.test.ts
```

---

## Task 17: Ordinary Call Lowering

**Description:** Lower direct source calls, receiver calls, positional and named arguments, and call result expressions before proof metadata classification.

**Dependencies:** Tasks 12, 13, 14, 15, and 16.

**Files:**

- Create: `src/hir/call-lowerer.ts`
- Test: `tests/unit/hir/call-lowerer.test.ts`

**Acceptance Criteria:**

- Callee expressions resolve to direct `FunctionId`; dynamic dispatch emits `HIR_CALL_CALLEE_NOT_FUNCTION`.
- Receiver and parameter arguments are type-checked against checked signature facts.
- Named arguments are matched to checked parameters deterministically.
- Consume and observe parameter modes are preserved on call argument place candidates.
- Error in callee, receiver, argument, or type argument suppresses proof-authorizing metadata.
- Constructor calls remain ordinary checked calls until constructibility authorizes the returned type.
- `tests/unit/hir/call-lowerer.test.ts` defines `lowerCallForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
const call = lowerCallExpression({
  view,
  expectedType,
  context,
});

expect(call.kind).toMatchObject({
  kind: "call",
  call: {
    calleeFunctionId: functionId(2),
    arguments: expect.any(Array),
    typeArguments: [],
  },
});
```

```ts
test("named arguments lower in checked parameter order", () => {
  const result = lowerCallForTest(
    "fn pair(left: u32, right: u32) -> u32\nfn use() -> u32:\n    pair(right: 2, left: 1)\n",
  );

  const argumentNames = result.call.arguments.map((argument) => argument.name);
  expect(argumentNames).toEqual(["left", "right"]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/call-lowerer.test.ts
```

---

## Task 18: Structured Statement Lowering

**Description:** Lower source blocks, let, assignment, if, while, loop, for, match, return, yield, break, continue, expression statements, and source `ensure` statements as structured HIR.

**Dependencies:** Tasks 2, 3, 12, 13, 14, 15, and 17.

**Files:**

- Create: `src/hir/statement-lowerer.ts`
- Modify: `src/hir/body-lowerer.ts`
- Test: `tests/unit/hir/statement-lowerer.test.ts`

**Acceptance Criteria:**

- Blocks lower statements in source order and allocate deterministic `HirStatementId`s.
- Let statements allocate locals and optional value expressions.
- Assignments require place-like targets and emit `HIR_NON_PLACE_ASSIGNMENT_TARGET` otherwise.
- Conditions must be checked `bool`.
- Return and yield values match checked function return type.
- `break` and `continue` lower to explicit statement kinds.
- Ordinary `for` lowers to `HirForStatement` with `iteration.kind: "ordinary"` unless proof-relevant classification applies in Task 22.
- `ensure` does not add a new `HirStatementKind`; it lowers the checked expression as `HirStatementKind.kind: "expression"` and appends a `HirEnsureCandidate` to `HirBodyIndex.ensureCandidates`.
- Each `HirEnsureCandidate` records `statementId`, `expressionId`, `sourceStatementKind: "ensure"`, and `sourceOrigin`, and Task 24 consumes only these candidates for source `ensure` fact origins.
- Non-bool `if`, `while`, and `ensure` conditions emit `HIR_CONDITION_NOT_BOOL`.
- Body indexes include every lowered statement and expression node.
- `tests/unit/hir/statement-lowerer.test.ts` defines `lowerStatementForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
test("break lowers to structured HIR statement", () => {
  const result = lowerStatementForTest("loop:\n    break\n");

  expect(result.statement.kind.kind).toBe("loop");
  expect(result.statement.kind.body.statements[0]!.kind.kind).toBe("break");
});
```

```ts
test("assignment to non-place emits deterministic diagnostic", () => {
  const result = lowerStatementForTest("(1 + 2) = 3");

  expect(result.context.diagnostics.entries().map((diagnostic) => diagnostic.code)).toContain(
    "HIR_NON_PLACE_ASSIGNMENT_TARGET",
  );
});
```

```ts
test("ensure records parser-backed candidate for fact lowering", () => {
  const result = lowerStatementForTest("ensure ready", {
    locals: [localFake({ name: "ready", type: coreCheckedType(coreTypeId("bool")) })],
  });

  expect(result.context.bodyIndex.ensureCandidates).toEqual([
    expect.objectContaining({ sourceStatementKind: "ensure" }),
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/statement-lowerer.test.ts
```

---

## Task 19: Validated-Buffer Declaration Lowering

**Description:** Lower validated-buffer declarations into HIR tables, preserving parameter, layout, derived fields, and requirement surfaces.

**Dependencies:** Tasks 11, 12, and 21.

Task 19 depends on Task 21 because validated-buffer `requires` sections must lower through the shared requirement lowerer before `HirValidatedBuffer.requirements` can be populated.

**Files:**

- Create: `src/hir/validated-buffer-lowerer.ts`
- Test: `tests/unit/hir/validated-buffer-lowerer.test.ts`

**Acceptance Criteria:**

- Each checked validated-buffer type produces one `HirValidatedBuffer`.
- Parameter fields, layout fields, and derived fields preserve `FieldId` source order.
- Validated-buffer requirements lower through `requirement-lowerer.ts` to `HirRequirement` records whose owned IDs use `{ kind: "type"; typeId }`.
- Missing checked field facts emit `HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING` and create recovered declaration entries.
- Requirement-lowering failure emits `HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED` and keeps the recovered validated-buffer record fail-closed.
- HIR does not compute layout offsets, payload ends, or layout facts.
- `tests/unit/hir/validated-buffer-lowerer.test.ts` defines `lowerValidatedBufferForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
test("validated buffer lowering preserves field roles", () => {
  const result = lowerValidatedBufferForTest(
    "validated buffer Packet:\n    params:\n        bytes: Bytes\n    layout:\n        len: u32\n",
  );

  const buffer = result.validatedBuffer;
  expect(buffer.parameterFields).toEqual([fieldId(0)]);
  expect(buffer.layoutFields).toEqual([fieldId(1)]);
});
```

```ts
export interface HirValidatedBuffer {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly parameterFields: readonly FieldId[];
  readonly layoutFields: readonly FieldId[];
  readonly derivedFields: readonly FieldId[];
  readonly requirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}
```

**Verification:**

```bash
bun test ./tests/unit/hir/validated-buffer-lowerer.test.ts
```

---

## Task 20: Image And Global Brand Lowering

**Description:** Lower selected image metadata, image device places, unique-edge-root origins, image origins, and preallocated global brands.

**Dependencies:** Tasks 7, 10, 11, 12, and 14.

**Files:**

- Create: `src/hir/image-lowerer.ts`
- Test: `tests/unit/hir/image-lowerer.test.ts`

**Acceptance Criteria:**

- Absent `CheckedImageSeed` produces an empty `HirImageTable` and no image-origin metadata.
- Present `CheckedImageSeed` produces one `HirImage` for the selected image.
- Missing selected image entry data emits `HIR_IMAGE_ENTRY_SURFACE_MISSING` and produces no proof-authorizing image origin.
- Missing checked device surface data emits `HIR_IMAGE_DEVICE_SURFACE_MISSING` and produces a recovered image entry without minting device brands.
- Body references to image-device places whose checked device surface was missing resolve to error resource places with preserved origins, and they do not receive proof-authorizing image/device brands.
- Device field places use `HirPlaceRoot.kind: "imageDevice"`.
- Unique-edge roots allocate distinct root place IDs and image-owned brand IDs.
- Global brand registry preallocates image/device brands and platform-token brands by sorted canonical minting keys before function body lowering.
- This image/global-brand prepass is part of the final production lowering order: image records and brand seeds are lowered after declaration lowering and before any function body lowerer can request a brand.
- Platform-token brand keys use certified platform binding identity from semantic surface, not raw target ensured-fact text.
- Image origins are separate from resource places and preserve source origins.
- `tests/unit/hir/image-lowerer.test.ts` defines `lowerImageForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
test("selected image lowers device roots and unique brands", () => {
  const result = lowerImageForTest("uefi image Boot:\n    devices:\n        serial: Serial\n", {
    targetSurface: targetWithSerialDevice(["rx", "tx"]),
  });

  expect(result.images.entries()).toHaveLength(1);
  expect(result.context.proofMetadata.imageOrigins.entries()).toHaveLength(1);
  expect(result.context.proofMetadata.brands.entries().map((brand) => brand.origin.kind)).toContain(
    "imageDevice",
  );
});
```

```ts
const imageBrandKey = `image:${imageId}:field:${fieldId}:root:${uniqueEdgeRootKey}`;
const platformBrandKey = `platform:${sourceFunctionId}:primitive:${primitiveId}:contract:${contractId}:target:${targetId}`;
```

**Verification:**

```bash
bun test ./tests/unit/hir/image-lowerer.test.ts
```

---

## Task 21: Requirement Lowering

**Description:** Lower checked and opaque requirement seeds to structured `HirProofExpression` trees for function and validated-buffer owners.

**Dependencies:** Tasks 11, 12, and 15.

**Files:**

- Create: `src/hir/requirement-lowerer.ts`
- Test: `tests/unit/hir/requirement-lowerer.test.ts`

**Acceptance Criteria:**

- Function `requires` sections lower to `HirRequirement` records attached to owning `HirFunction`.
- Requirement expressions use separate `HirProofExpressionId` allocation.
- Requirement mode supports literals, names, member references, call references, and binary expressions.
- Requirement lowering never mints ordinary call metadata, predicate facts, terminal calls, private transitions, or platform edges.
- Checked seed references are compared against re-lowered references; mismatch emits `HIR_REQUIREMENT_REFERENCE_MISMATCH`.
- Unsupported forms emit `HIR_UNSUPPORTED_REQUIREMENT_FORM` and produce fail-closed error requirements.
- Call-site requirement instantiation is not done here; Task 25 consumes these requirement records when composing call proof metadata.
- `tests/unit/hir/requirement-lowerer.test.ts` defines `lowerRequirementForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
test("requirement lowering preserves call references without call metadata", () => {
  const result = lowerRequirementForTest("ready()", {
    checkedReferences: [checkedFunctionReference("ready", functionId(1))],
  });

  expect(result.requirement.expression.kind).toBe("structured");
  expect(result.context.proofMetadata.factOrigins.entries()).toHaveLength(0);
});
```

```ts
export interface HirRequirement {
  readonly requirementId: HirOwnedId<HirRequirementId>;
  readonly owner: HirRequirementOwner;
  readonly expression: HirRequirementExpression;
  readonly sourceOrigin: HirOriginId;
}
```

**Verification:**

```bash
bun test ./tests/unit/hir/requirement-lowerer.test.ts
```

---

## Task 22: Take Lowering

**Description:** Implement standalone `take` classification/lowering helpers and stream-iteration metadata producers using checked take-mode contracts. Task 26 wires these helpers into statement lowering.

**Dependencies:** Tasks 5, 12, 14, 17, and 18.

**Files:**

- Create: `src/hir/take-lowerer.ts`
- Test: `tests/unit/hir/take-lowerer.test.ts`

**Acceptance Criteria:**

- `take stream` over a take-only call lowers to `HirTakeOperand.kind: "takeOnlyCall"` with a temporary result place.
- `take buffer` lowers to a buffer obligation and no stream item brand.
- `take` on validated buffer lowers to session, member brand, and closure obligation.
- `take expr as alias` creates an alias local with `introducedBy: "takeAlias"`.
- Unclassified proof-relevant take emits `HIR_UNCLASSIFIED_TAKE`, lowers `takeKind: "error"`, and mints no authorizing session or brand.
- Stream `for` iteration uses checked stream classification and emits `HirForIteration.kind: "stream"` with session, item brand, and closure obligation.
- The task exports pure helpers that accept a statement/expression lowering context and return HIR nodes plus metadata additions; it does not edit `statement-lowerer.ts`.
- Production integration seam for Task 26 is `lowerTakeStatement(input)` and `classifyForIteration(input)`.
- `tests/unit/hir/take-lowerer.test.ts` defines `lowerTakeForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
export function lowerTakeStatement(input: {
  readonly view: TakeStatementView;
  readonly context: HirLoweringContext;
  readonly lowerExpression: HirExpressionLowerer;
  readonly lowerBlock: HirBlockLowerer;
}): HirTakeStatement;

export function classifyForIteration(input: {
  readonly iterable: HirExpression;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): HirForIteration;
```

```ts
test("take-only stream call creates session and temporary result place", () => {
  const result = lowerTakeForTest("take self.rx.receive() as batch:\n    continue\n", {
    takeSurface: streamTakeSurface(functionId(1)),
  });

  expect(result.statement.operand.kind).toBe("takeOnlyCall");
  expect(result.statement.takeKind.kind).toBe("stream");
  expect(result.context.proofMetadata.sessions.entries()).toHaveLength(1);
});
```

```ts
test("buffer take creates only buffer discharge obligation", () => {
  const result = lowerTakeForTest("take packet:\n    continue\n", {
    takeSurface: bufferTakeSurface(typeId(1)),
  });

  expect(result.statement.takeKind.kind).toBe("buffer");
  expect(result.statement.takeKind).toHaveProperty("obligationId");
  expect(result.statement.takeKind).not.toHaveProperty("itemBrandId");
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/take-lowerer.test.ts
```

---

## Task 23: Validation And Attempt Lowering

**Description:** Implement standalone validation creation, validation match, and attempt expression lowering helpers using checked validation and attempt contracts. Task 26 wires these helpers into expression and statement lowering.

**Dependencies:** Tasks 6, 12, 14, 15, 17, and 18.

**Files:**

- Create: `src/hir/validation-lowerer.ts`
- Create: `src/hir/attempt-lowerer.ts`
- Test: `tests/unit/hir/validation-lowerer.test.ts`
- Test: `tests/unit/hir/attempt-lowerer.test.ts`

**Acceptance Criteria:**

- Validation creation records `HirValidation`, source place, pending result place, result local when bound, and validated buffer type.
- Validation match is recognized only when scrutinee links to a recorded pending validation result.
- Unlinked validation result matches emit `HIR_UNLINKED_VALIDATION_MATCH` and lower an error validation match.
- Ok and Err arms preserve source blocks and binding locals.
- Attempt expressions record fallible expression, optional alternative expression, and declared input places mapped from checked contract positions.
- Contract inputs that map to non-place expressions emit `HIR_ATTEMPT_INPUT_NOT_PLACE` and produce an error attempt.
- HIR does not diagnose unmatched validations or attempt convergence.
- The task exports pure helpers that accept expression/statement lowering context and return HIR nodes plus metadata additions; it does not edit `expression-lowerer.ts` or `statement-lowerer.ts`.
- Production integration seam for Task 26 is `lowerValidationCreation(input)`, `lowerValidationMatch(input)`, and `lowerAttemptExpression(input)`.
- `tests/unit/hir/validation-lowerer.test.ts` defines `lowerValidationForTest`, and `tests/unit/hir/attempt-lowerer.test.ts` defines `lowerAttemptForTest`, using Task 12's shared harness factories.

**Code Examples:**

```ts
export function lowerValidationCreation(input: {
  readonly call: HirCallExpression;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
}): HirValidation | undefined;

export function lowerValidationMatch(input: {
  readonly view: MatchStatementView;
  readonly scrutinee: HirExpression;
  readonly context: HirLoweringContext;
  readonly lowerBlock: HirBlockLowerer;
}): HirValidationMatchStatement | undefined;

export function lowerAttemptExpression(input: {
  readonly view: AttemptExpressionView;
  readonly fallibleExpression: HirExpression;
  readonly alternativeExpression?: HirExpression;
  readonly context: HirLoweringContext;
}): HirExpression;
```

```ts
test("validation creation records source and pending result places", () => {
  const result = lowerValidationForTest("let result = validate(packet)", {
    contract: validationContractForBuffer(typeId(1)),
  });

  const validation = result.context.proofMetadata.validations.entries()[0]!;
  expect(validation.sourcePlace.root.kind).toBe("parameter");
  expect(validation.pendingResultPlace.root.kind).toBe("temporary");
});
```

```ts
test("attempt preserves declared input places from contract", () => {
  const expression = lowerAttemptForTest(
    "fallible(buffer)?",
    attemptContractForParameter(parameterId(0)),
  );

  expect(expression.kind.kind).toBe("attempt");
  expect(expression.kind.attempt.declaredInputPlaces.map((place) => place.root.kind)).toEqual([
    "parameter",
  ]);
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/validation-lowerer.test.ts
bun test ./tests/unit/hir/attempt-lowerer.test.ts
```

---

## Task 24: Fact And Private-Transition Lowering

**Description:** Implement standalone fact-origin and private-transition metadata producers for predicate calls, source `ensure`, platform ensured facts, match refinements, and private-state calls. Task 26 wires these producers into call and statement lowering.

**Dependencies:** Tasks 3, 7, 12, 14, 17, and 18.

**Files:**

- Create: `src/hir/fact-lowerer.ts`
- Test: `tests/unit/hir/fact-lowerer.test.ts`

**Acceptance Criteria:**

- Predicate calls create `HirFactOrigin` with `kind: "predicateCall"`.
- Source `ensure` statements create `HirFactOrigin` with `kind: "ensure"` and the lowered expression.
- Source `ensure` facts are emitted only when the lowered expression checks to core `bool`; non-bool expressions emit `HIR_CONDITION_NOT_BOOL` and no fact origin.
- Structured certified target ensured facts create `HirFactOrigin` with `kind: "platformEnsure"` tied to a platform contract edge.
- Private-state calls use checked transition contracts and emit `advance`, `close`, or `unknown` transitions.
- Predicate private-state calls create facts and never transitions.
- `transitionOrdinalForPlace` is deterministic by source order per place.
- HIR does not store invalidated fact sets or path generations.
- Match refinement facts identify scrutinee, variant reference, and field bindings when match lowering has checked scrutinee type, checked variant reference, and checked field bindings.
- If match lowering cannot identify the scrutinee variant or field bindings, emit `HIR_MATCH_REFINEMENT_UNSUPPORTED`, lower the ordinary match/error validation match as appropriate for the scrutinee, and mint no match-refinement fact.
- Platform ensure helpers require a certified `HirPlatformContractEdge`; they never parse target proof text or accept uncertified bindings.
- The task exports pure metadata producers and does not edit `call-lowerer.ts` or `statement-lowerer.ts`.
- Production integration seam for Task 26 is `recordPredicateFact(input)`, `recordEnsureFact(input)`, `recordPlatformEnsureFacts(input)`, `recordMatchRefinement(input)`, and `recordPrivateTransition(input)`.
- `tests/unit/hir/fact-lowerer.test.ts` defines `lowerFactForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
export function recordEnsureFact(input: {
  readonly candidate: HirEnsureCandidate;
  readonly expression: HirExpression;
  readonly context: HirLoweringContext;
}): HirFactOrigin | undefined;

export function recordPredicateFact(input: {
  readonly call: HirCallExpression;
  readonly predicateFunctionId: FunctionId;
  readonly statePlace?: HirResourcePlace;
  readonly context: HirLoweringContext;
}): HirFactOrigin | undefined;

export function recordPlatformEnsureFacts(input: {
  readonly edge: HirPlatformContractEdge;
  readonly ensuredFacts: readonly CheckedPlatformEnsuredFactSurface[];
  readonly context: HirLoweringContext;
}): readonly HirFactOrigin[];
```

```ts
test("predicate call creates fact origin without private transition", () => {
  const result = lowerFactForTest("is_ready(state)", {
    predicateFunctionId: functionId(1),
    statePlace: parameterPlace(parameterId(0)),
  });

  expect(result.context.proofMetadata.factOrigins.entries().map((fact) => fact.fact.kind)).toEqual([
    "predicateCall",
  ]);
  expect(result.context.proofMetadata.privateStateTransitions.entries()).toEqual([]);
});
```

```ts
test("ensure statement creates source fact origin", () => {
  const result = lowerFactForTest("ensure ready", {
    locals: [localFake({ name: "ready", type: coreCheckedType(coreTypeId("bool")) })],
  });

  expect(result.context.proofMetadata.factOrigins.entries()[0]!.fact.kind).toBe("ensure");
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/fact-lowerer.test.ts
```

---

## Task 25: Platform, Terminal, Predicate, And Call Requirement Metadata

**Description:** Implement standalone call proof-metadata composition for successfully typed calls: call-site requirements, certified platform contract edges, terminal calls, predicate facts, structured platform ensured facts, and private transitions. Task 26 wires this classifier into `call-lowerer.ts`.

**Dependencies:** Tasks 4A, 7, 12, 17, 21, and 24.

**Files:**

- Create: `src/hir/call-proof-metadata.ts`
- Test: `tests/unit/hir/call-proof-metadata.test.ts`

**Acceptance Criteria:**

- Every call to a function with requirements gets `HirCallSiteRequirement` records.
- Certified platform calls attach one per-call `HirPlatformContractEdge`.
- Platform edge records carry source function ID, primitive ID, contract ID, target ID, certificate, source requirement IDs, and call origin.
- Structured certified platform ensured facts on the binding create `platformEnsure` fact origins tied to the per-call platform edge.
- Terminal calls create `HirTerminalCall` and terminal closure obligation records.
- Platform-certified terminal calls carry both platform edge and terminal metadata.
- Platform-certified predicate calls carry both platform edge and predicate fact origin.
- Any call recovery suppresses proof-authorizing metadata for that call.
- This task creates `call-proof-metadata.ts` and does not edit `call-lowerer.ts`; integration happens in Task 26.
- Production integration seam for Task 26 is `composeCallProofMetadata(input)`.
- `tests/unit/hir/call-proof-metadata.test.ts` defines `composeCallProofMetadataForTest` using Task 12's shared harness factories.

**Code Examples:**

```ts
export function composeCallProofMetadata(input: {
  readonly call: HirCallExpression;
  readonly context: HirLoweringContext;
  readonly sourceRequirements: readonly HirRequirement[];
  readonly platformBinding?: CertifiedPlatformBinding;
  readonly terminalSurface?: CheckedTerminalSurface;
  readonly predicateSurface?: CheckedPredicateFactSurface;
  readonly privateTransitionSurface?: CheckedPrivateTransitionSurface;
}): void;
```

```ts
test("certified platform call carries contract edge and source requirements", () => {
  const result = composeCallProofMetadataForTest({
    call: successfulCallFake({ calleeFunctionId: functionId(0) }),
    platformBinding: certifiedPlatformBindingFake({ primitiveName: "exit" }),
    sourceRequirements: [],
  });

  const edge = result.context.proofMetadata.platformContractEdges.entries()[0]!;
  expect(edge.sourceFunctionId).toBe(functionId(0));
  expect(edge.sourceRequirementIds).toEqual([]);
  expect(edge.callOrigin).toBeDefined();
});
```

```ts
test("terminal call creates terminal obligation", () => {
  const result = composeCallProofMetadataForTest({
    call: successfulCallFake({ calleeFunctionId: functionId(2) }),
    terminalSurface: terminalSurfaceFake({ functionId: functionId(2) }),
  });

  expect(result.context.proofMetadata.terminalCalls.entries()).toHaveLength(1);
  expect(
    result.context.proofMetadata.obligations.entries().map((obligation) => obligation.kind),
  ).toContain("terminalClosure");
});
```

**Verification:**

```bash
bun test ./tests/unit/hir/call-proof-metadata.test.ts
```

---

## Task 26: `lowerTypedHir` Orchestration

**Description:** Connect all HIR lowerers into the final pure public lowering function and ensure diagnostics and tables are deterministic.

**Dependencies:** Tasks 11 through 25.

**Files:**

- Modify: `src/hir/typed-hir-builder.ts`
- Modify: `src/hir/body-lowerer.ts`
- Modify: `src/hir/expression-lowerer.ts`
- Modify: `src/hir/statement-lowerer.ts`
- Modify: `src/hir/call-lowerer.ts`
- Create: `src/hir/index.ts`
- Test: `tests/integration/hir/lower-typed-hir-orchestration.test.ts`

**Acceptance Criteria:**

- `lowerTypedHir` builds origins, declarations, validated buffers, function bodies, image records, proof metadata, and diagnostics.
- Function lowering is single-pass in deterministic function order.
- Bodyless recovery preserves function origin and declared requirements when possible.
- Error expressions and statements use semantic-surface error checked type and error resource kind.
- HIR diagnostics do not include lexer, parser, item-index, name-resolution, or semantic-surface diagnostics.
- No lowerer reads source files or Bun APIs.
- `typed-hir-builder.ts` invokes validated-buffer lowering from Task 19 during declaration lowering.
- Production orchestration order is declarations, validated-buffer declaration bodies, image/global-brand prepass, function bodies, and final immutable table assembly.
- `typed-hir-builder.ts` invokes image lowering from Task 20 after declarations and before function body lowering; image lowering is not repeated after bodies.
- `body-lowerer.ts` invokes statement lowering from Task 18 for source-body functions.
- `expression-lowerer.ts` invokes constructibility checks from Task 16 for object literals and constructor calls.
- `expression-lowerer.ts` invokes attempt and validation creation helpers from Task 23 where expression shape and checked contracts require them.
- `statement-lowerer.ts` invokes take and stream-for helpers from Task 22.
- `statement-lowerer.ts` invokes validation-match and source-ensure fact helpers from Tasks 23 and 24.
- `statement-lowerer.ts` invokes match-refinement helpers from Task 24 for checked pattern narrowing.
- `call-lowerer.ts` invokes call-proof metadata composition from Task 25 after ordinary call lowering succeeds.
- Task 26 calls only the production seams documented by Tasks 22 through 25: `lowerTakeStatement`, `classifyForIteration`, `lowerValidationCreation`, `lowerValidationMatch`, `lowerAttemptExpression`, `recordPredicateFact`, `recordEnsureFact`, `recordPlatformEnsureFacts`, `recordMatchRefinement`, `recordPrivateTransition`, and `composeCallProofMetadata`.
- If a required seam is missing or cannot be called without inventing new proof semantics, Task 26 fails its integration test and the fix belongs to the owning lowerer task, not to new design work in orchestration.
- The mutable `HirProofMetadataBuilder` from `HirLoweringContext` is the single path by which Tasks 20 through 25 add metadata to the final program.
- If two checked inputs disagree for the same HIR key, orchestration propagates the `HIR_INPUT_SURFACE_DISAGREEMENT` emitted by Task 11's reference/input-surface reconciliation helpers and continues fail-closed.

**Code Examples:**

```ts
test("lowerTypedHir returns pure HIR result without upstream diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn use() -> Never:\n    return\n"]]);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  const result = lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });

  expect(result).toHaveProperty("program");
  expect(result).toHaveProperty("diagnostics");
});
```

```ts
test("orchestration wires take lowering into full HIR", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "fn use(self: consume Receiver) -> Never:\n    take self.rx.receive() as batch:\n        continue\n",
    ],
  ]);

  expect(result.program.proofMetadata.sessions.entries()).toHaveLength(1);
});
```

```ts
test("orchestration wires ensure fact lowering into full HIR", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn use(ready: bool) -> Never:\n    ensure ready\n"],
  ]);

  expect(result.program.proofMetadata.factOrigins.entries()[0]!.fact.kind).toBe("ensure");
});
```

```ts
test("orchestration wires certified platform call metadata", () => {
  const result = lowerTypedHirForTest(
    [["main.wr", "platform fn exit() -> Never\nfn use() -> Never:\n    exit()\n"]],
    { platformNames: ["exit"], targetSurface: targetWithCertifiedExit() },
  );

  expect(result.program.proofMetadata.platformContractEdges.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.terminalCalls.entries()).toHaveLength(1);
});
```

```ts
test("orchestration exercises every proof metadata seam", () => {
  const result = lowerTypedHirForTest(proofSurfaceKitchenSinkProgram(), {
    targetSurface: targetWithCertifiedExit(),
  });

  expect(result.program.proofMetadata.sessions.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.validations.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.attempts.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.factOrigins.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.privateStateTransitions.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.platformContractEdges.entries().length).toBeGreaterThan(0);
});
```

```ts
export { lowerTypedHir } from "./typed-hir-builder";
export type { LowerTypedHirInput, LowerTypedHirResult } from "./typed-hir-builder";
export type { TypedHirProgram, HirFunction, HirExpression, HirStatement } from "./hir";
```

**Verification:**

```bash
bun test ./tests/integration/hir/lower-typed-hir-orchestration.test.ts
```

---

## Task 27: HIR Integration, Determinism, And Completeness Tests

**Description:** Add end-to-end tests that parse, index, resolve, semantic-check, and lower typed HIR for proof-relevant programs.

**Dependencies:** Task 26.

**Files:**

- Create: `tests/integration/hir/typed-hir-proof-integration.test.ts`
- Create: `tests/integration/hir/typed-hir-determinism.test.ts`
- Create: `tests/integration/hir/proof-surface-completeness.test.ts`
- Modify: `tests/support/hir/typed-hir-fixtures.ts`

**Acceptance Criteria:**

- Integration tests cover ordinary functions, member calls, requirements, consumed receivers, field-sensitive receiver access, take aliases, terminal calls, attempt expressions, validation matches, predicate facts, private-state advancement, platform primitive calls, and UEFI image roots.
- Negative integration tests cover rejected raw target proof text and assert HIR emits no `platformEnsure` fact origins for uncertified or unsupported target facts.
- Determinism tests compare stable HIR summaries across equivalent module orderings and shuffled target surfaces.
- Completeness test independently recognizes proof-relevant source constructs and asserts each has either HIR metadata or fail-closed HIR diagnostics.
- Completeness recognizer does not call the HIR production classifiers.

**Code Examples:**

```ts
test("typed HIR lowers proof-relevant surface end to end", () => {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "predicate fn ready() -> bool",
          "terminal fn stop() -> Never",
          "fn guarded() -> Never:",
          "    requires:",
          "        ready()",
          "    stop()",
          "fn caller() -> Never:",
          "    guarded()",
          "uefi image Boot:",
          "    fn main() -> Never",
        ].join("\n"),
      ],
    ],
    { targetSurface: semanticTargetSurfaceFake() },
  );

  expect(result.program.proofMetadata.callSiteRequirements.entries().length).toBeGreaterThan(0);
  expect(result.program.proofMetadata.terminalCalls.entries().length).toBeGreaterThan(0);
});
```

```ts
test("raw target proof text never becomes platformEnsure metadata", () => {
  const result = lowerTypedHirForTest(
    [["main.wr", "platform fn raw_contract() -> Never\nfn use() -> Never:\n    raw_contract()\n"]],
    { targetSurface: targetWithRejectedRawEnsuredFact() },
  );

  expect(
    result.program.proofMetadata.factOrigins
      .entries()
      .filter((fact) => fact.fact.kind === "platformEnsure"),
  ).toEqual([]);
});
```

```ts
test("typed HIR summary is deterministic for shuffled target surface", () => {
  const sourceFiles = [
    ["main.wr", "fn helper() -> bool\nuefi image Boot:\n    fn main() -> Never\n"],
  ] as const;

  const first = lowerTypedHirForTest(sourceFiles, {
    targetSurface: shuffledSemanticTargetSurfaceFake(1),
  });
  const second = lowerTypedHirForTest(sourceFiles, {
    targetSurface: shuffledSemanticTargetSurfaceFake(99),
  });

  expect(typedHirSummary(first)).toBe(typedHirSummary(second));
});
```

**Verification:**

```bash
bun test ./tests/integration/hir/typed-hir-proof-integration.test.ts
bun test ./tests/integration/hir/typed-hir-determinism.test.ts
bun test ./tests/integration/hir/proof-surface-completeness.test.ts
```

---

## Task 28: Public API Barrels

**Description:** Export typed HIR APIs through `src/hir`, `src/index.ts`, and public API tests.

**Dependencies:** Task 26.

**Files:**

- Modify: `src/hir/index.ts`
- Modify: `src/index.ts`
- Create: `tests/integration/hir/public-api.test.ts`
- Modify: `tests/integration/public-api.test.ts`

**Acceptance Criteria:**

- Callers can import `lowerTypedHir` from `src/hir`.
- Top-level package exports include a `hir` namespace.
- Public HIR model types are exported without exposing builder internals.
- `src/index.ts` and `tests/integration/public-api.test.ts` already exist in the repository; this task modifies those files and does not create a new top-level public API entrypoint.
- Existing public API tests still pass.

**Code Examples:**

```ts
import { lowerTypedHir } from "../../../src/hir";
import * as wrela from "../../../src";

test("typed HIR public API is exported", () => {
  expect(typeof lowerTypedHir).toBe("function");
  expect(wrela.hir).toBeDefined();
});
```

```ts
export * as hir from "./hir";
```

**Verification:**

```bash
bun test ./tests/integration/hir/public-api.test.ts
bun test ./tests/integration/public-api.test.ts
```

---

## Task 29: Final Verification And Handoff

**Description:** Run the full repository verification, format if needed, and prepare the final implementation handoff.

**Dependencies:** All prior tasks.

**Files:**

- No source ownership beyond formatting changes produced by the repository formatter.

**Acceptance Criteria:**

- Narrow HIR tests pass.
- Full agent check passes.
- Formatting check passes.
- Final handoff names any residual risk with exact test gaps if a command cannot run.

**Code Examples:**

```bash
bun test ./tests/unit/hir
bun test ./tests/integration/hir
bun run agent:check
```

```bash
bun run format
bun run agent:check
```

**Verification:**

```bash
bun run agent:check
```

---

## Plan Self-Review

- Spec coverage: The plan covers HIR skeleton, body typing, places, requirements, platform calls, constructibility, take, validation, attempt, facts, private-state transitions, image/device origins, diagnostics, determinism, and public API.
- Upstream contract coverage: Tasks 2 through 7 implement frontend and semantic-surface prerequisites explicitly before HIR consumes them.
- Parallelism: Tasks are grouped by waves with single-writer file ownership. Same-wave tasks are independent or depend only on earlier waves.
- Placeholder scan: This plan contains no open research tasks, no unspecified design tasks, and no empty implementation slots.
- Type consistency: Public examples use current repository names such as `ParsedModuleGraph`, `ItemIndex`, `ResolvedReferences`, `CoreTypeCatalog`, `CheckedSemanticProgram`, `CheckedImageSeed`, `CheckedType`, `CheckedResourceKind`, `FunctionId`, `TypeId`, `FieldId`, and `ParameterId`.
