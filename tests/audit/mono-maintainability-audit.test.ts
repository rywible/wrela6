import { expect, test } from "bun:test";
import * as typescript from "typescript";
import {
  legacyRawCloneStateInputDeclarations,
  legacyRawCloneStateInputDeclarationsInSource,
  monoClonerSourcePaths,
  monoContextAwareCallRules,
  monoSource,
  sourceText,
  tsFilesUnder,
  unmanagedCloneCallBlocks,
  unmanagedCloneCallBlocksInSource,
} from "../support/mono/mono-maintainability-audit-helpers";

test("mono runtime modules stay below the thermo-nuclear size threshold", () => {
  const oversized = tsFilesUnder("src/mono")
    .map((path) => ({ path, lines: sourceText(path).split("\n").length }))
    .filter((entry) => entry.lines > 1_000);

  expect(oversized).toEqual([]);
});

test("mono maintainability audits stay decomposed below the thermo-nuclear threshold", () => {
  const oversized = [
    "tests/audit/mono-maintainability-audit.test.ts",
    "tests/support/mono/mono-maintainability-audit-helpers.ts",
  ]
    .map((path) => ({ path, lines: sourceText(path).split("\n").length }))
    .filter((entry) => entry.lines > 900);

  expect(oversized).toEqual([]);
});

test("mono runtime does not expose whole-program test-harness body instantiation", () => {
  const source = monoSource("function-instantiator.ts");

  expect(source).not.toContain("instantiateMonoFunctionBodyFromProgram");
  expect(source).not.toContain("input: InstantiateMonoFunctionBodyInput | TypedHirProgram");
  expect(source).not.toContain("0 as unknown as ImageId");
});

test("closed-boundary and body-index scans use typed visitors instead of reflective object walks", () => {
  const functionSource = monoSource("function-instantiator.ts");
  const boundarySource = monoSource("closed-boundary-checker.ts");

  expect(functionSource).not.toContain("function visit(value: unknown)");
  expect(functionSource).not.toContain("Record<string, unknown>");
  expect(boundarySource).not.toContain("scanUnknownValue");
  expect(boundarySource).not.toContain("Record<string, unknown>");
});

test("mono closure boundaries avoid cast-heavy owner/type escape hatches", () => {
  expect(sourceText("src/hir/typed-hir-builder.ts")).not.toContain(
    "owner.itemId as unknown as TypeId",
  );
});

test("mono closure policy lives outside semantic checking and HIR orchestration", () => {
  expect(sourceText("src/semantic/surface/semantic-surface-checker.ts")).not.toContain(
    "function buildConstructorKindRules",
  );
  expect(sourceText("src/hir/typed-hir-builder.ts")).not.toContain("function lowerMonoClosure");
});

test("generic substitution uses the small checked-type transform adapter only", () => {
  expect(sourceText("src/hir/checked-type-transform.ts")).toContain("transformCheckedType");
  expect(sourceText("src/hir/checked-type-transform.ts")).toContain("transformCheckedResourceKind");
  expect(sourceText("src/hir/generic-substitution.ts")).toContain("./checked-type-transform");
});

test("mono remap map storage is centralized in the transform context adapter", () => {
  const approved = new Set([
    "src/mono/mono-transform-context.ts",
    "src/mono/function-instantiator-body.ts",
    "src/mono/function-instantiator-shell.ts",
  ]);
  const offenders = tsFilesUnder("src/mono").filter((path) => {
    if (approved.has(path)) return false;
    const source = sourceText(path);
    return (
      source.includes("new Map(remap.") ||
      source.includes("new Map(input.remap") ||
      source.includes("Map<HirLocalId") ||
      source.includes("Map<HirExpressionId") ||
      source.includes("Map<HirStatementId")
    );
  });

  expect(offenders).toEqual([]);
});

test("mono recursive clone entry points stay behind canonical transform context", () => {
  const contextAwareCallRules = monoContextAwareCallRules();
  const contextAwareMigrationPaths = new Set(monoClonerSourcePaths());
  const offenders = tsFilesUnder("src/mono").flatMap((path) => {
    if (path === "src/mono/mono-transform-context.ts") return [];
    return unmanagedCloneCallBlocks(
      path,
      contextAwareMigrationPaths.has(path) ? contextAwareCallRules : new Map(),
    );
  });

  expect(offenders).toEqual([]);
});

test("mono recursive clone-call audit rejects rebuilt transform contexts", () => {
  const sourceFile = typescript.createSourceFile(
    "synthetic-clone-calls.ts",
    `
import { createMonoTransformContext, type MonoTransformContext } from "./mono-transform-context";
import { cloneExpression as cloneExpr } from "./function-expression-cloner";

function ok(input: { readonly transformContext: MonoTransformContext }): void {
  cloneExpression({ source, transformContext: input.transformContext });
}

function bad(input: { readonly transformContext: MonoTransformContext }): void {
  cloneExpr({ source, transformContext: { remap, resourceKinds: context, outgoingEdges, diagnostics } });
  cloneValidation({ source, transformContext: { remap, resourceKinds: context, outgoingEdges, diagnostics } });
  const rebuiltTransformContext = { remap, resourceKinds: context, outgoingEdges, diagnostics };
  cloneCall({ source, transformContext: rebuiltTransformContext });
  const rootedTransformContext = createMonoTransformContext({ remap, resourceKinds, outgoingEdges, diagnostics });
  cloneBlock({ source, transformContext: rootedTransformContext });
  const cloneInput = { source, transformContext: rebuiltTransformContext };
  cloneMatchArm(cloneInput);
  {
    const input = { transformContext: rebuiltTransformContext };
    cloners.cloneExpression({ source, transformContext: input.transformContext });
  }
  {
    const transformContext = { remap, resourceKinds: context, outgoingEdges, diagnostics };
    cloneTakeKind({ source, transformContext });
  }
  cloneBlock({ source, nested: { transformContext: input.transformContext } });
  cloneExpression({ source, transformContext: input.transformContext, ...legacyCloneInput });
  cloneExpression({ source, transformContext: input.transformContext, transformContext: rebuiltTransformContext });
  cloners["cloneExpression"]({ source, transformContext: rebuiltTransformContext });
}

function hiddenRawInput(input: { readonly transformContext: { readonly remap: MutableMonoFunctionRemap } }): void {
  cloneCallArgument({ source, transformContext: input.transformContext });
}

function launderingWrapper(input: { readonly transformContext: MonoTransformContext }): void {
  cloneExpression({ source, transformContext: input.transformContext });
}

function positionalContextHelper(source: HirResourcePlace["root"], transformContext: MonoTransformContext): void {}

function helperLaundering(input: { readonly transformContext: MonoTransformContext }): void {
  const rebuiltTransformContext = { remap, resourceKinds: context, outgoingEdges, diagnostics };
  launderingWrapper({ source, transformContext: rebuiltTransformContext });
  positionalContextHelper(source, rebuiltTransformContext);
}

function shadowedFactory(input: { readonly transformContext: MonoTransformContext }): void {
  function createMonoTransformContext(): MonoTransformContext {
    return { remap, resourceKinds: context, outgoingEdges, diagnostics };
  }
  const transformContext = createMonoTransformContext();
  cloneStatement({ source, transformContext });
}

function lateShadowedFactory(input: { readonly transformContext: MonoTransformContext }): void {
  const transformContext = createMonoTransformContext({ remap, resourceKinds, outgoingEdges, diagnostics });
  cloneForIteration({ source, transformContext });
  function createMonoTransformContext(): MonoTransformContext {
    return { remap, resourceKinds: context, outgoingEdges, diagnostics };
  }
}
`,
    typescript.ScriptTarget.Latest,
    true,
  );

  expect(unmanagedCloneCallBlocksInSource(sourceFile)).toEqual([
    "synthetic-clone-calls.ts:10 cloneExpr({...})",
    "synthetic-clone-calls.ts:11 cloneValidation({...})",
    "synthetic-clone-calls.ts:13 cloneCall({...})",
    "synthetic-clone-calls.ts:15 cloneBlock({...})",
    "synthetic-clone-calls.ts:17 cloneMatchArm({...})",
    "synthetic-clone-calls.ts:20 cloneExpression({...})",
    "synthetic-clone-calls.ts:24 cloneTakeKind({...})",
    "synthetic-clone-calls.ts:26 cloneBlock({...})",
    "synthetic-clone-calls.ts:27 cloneExpression({...})",
    "synthetic-clone-calls.ts:28 cloneExpression({...})",
    "synthetic-clone-calls.ts:29 cloneExpression({...})",
    "synthetic-clone-calls.ts:33 cloneCallArgument({...})",
    "synthetic-clone-calls.ts:44 launderingWrapper({...})",
    "synthetic-clone-calls.ts:45 positionalContextHelper({...})",
    "synthetic-clone-calls.ts:53 cloneStatement({...})",
    "synthetic-clone-calls.ts:58 cloneForIteration({...})",
  ]);
});

test("mono root body instantiator may create the production transform context", () => {
  const sourceFile = typescript.createSourceFile(
    "src/mono/function-instantiator-body.ts",
    `
import { createMonoTransformContext, type MonoTransformContext } from "./mono-transform-context";

function instantiate(): void {
  const transformContext = createMonoTransformContext({ remap, resourceKinds, outgoingEdges, diagnostics });
  cloneBlock({ source, transformContext });
}
`,
    typescript.ScriptTarget.Latest,
    true,
  );

  expect(unmanagedCloneCallBlocksInSource(sourceFile)).toEqual([]);
});

test("legacy raw clone-state audit follows nested parameter input declarations", () => {
  const sourceFile = typescript.createSourceFile(
    "synthetic-cloner.ts",
    `
import { type MonoTransformContext } from "./mono-transform-context";

interface HeritageInput {
  readonly diagnostics: readonly MonoDiagnostic[];
}

interface InterfaceInput extends HeritageInput {
  readonly expressionId: HirExpressionId;
}

interface ImportedBaseInput extends ImportedLegacyCloneInput {
  readonly statementId: HirStatementId;
}

type LiteralInput = {
  readonly remap: MutableMonoFunctionRemap;
};

type IntersectedInput = LiteralInput & {
  readonly context: MonoResourceKindConcretizationContext;
};

type NestedInput = IntersectedInput;

type RawRemap = MutableMonoFunctionRemap;
interface MemberAliasInput {
  readonly remap: RawRemap;
}

interface CanonicalTransformContextInput {
  readonly transformContext: MonoTransformContext;
}

interface StructuralTransformContextInput {
  readonly transformContext: {
    readonly remap: MutableMonoFunctionRemap;
    readonly resourceKinds: MonoResourceKindConcretizationContext;
    readonly outgoingEdges: readonly MonoOutgoingEdge[];
    readonly diagnostics: readonly MonoDiagnostic[];
  };
}

type StructuralTransformContextAlias = {
  readonly remap: MutableMonoFunctionRemap;
};

interface AliasedTransformContextInput {
  readonly transformContext: StructuralTransformContextAlias;
}

function cloneWithIntersection(input: NestedInput): void {}
function cloneWithInterface(input: InterfaceInput): void {}
function cloneWithImportedBase(input: ImportedBaseInput): void {}
function cloneWithMemberAlias(input: MemberAliasInput): void {}
function cloneWithCanonicalTransformContext(input: CanonicalTransformContextInput): void {}
function cloneWithStructuralTransformContext(input: StructuralTransformContextInput): void {}
function cloneWithAliasedTransformContext(input: AliasedTransformContextInput): void {}
function cloneWithRenamedRawInput(options: { readonly remap: MutableMonoFunctionRemap }): void {}
function cloneWithImportedAliasName(state: CloneArgs): void {}
function cloneWithDestructuredRawInput({ remap }: { readonly remap: MutableMonoFunctionRemap }): void {}
function cloneWithUtility(input: Pick<{ outgoingEdges: readonly MonoOutgoingEdge[] }, "outgoingEdges">): void {}
function cloneWithImportedAlias(input: ImportedCloneInput): void {}
const cloneWithFunctionExpression = function (input: MemberAliasInput): void {};
const clonerObject = {
  cloneMethod(input: InterfaceInput): void {},
};
`,
    typescript.ScriptTarget.Latest,
    true,
  );

  expect(legacyRawCloneStateInputDeclarationsInSource(sourceFile)).toEqual([
    "synthetic-cloner.ts:17 remap: MutableMonoFunctionRemap",
    "synthetic-cloner.ts:21 context: MonoResourceKindConcretizationContext",
    "synthetic-cloner.ts:5 diagnostics: readonly MonoDiagnostic[]",
    "synthetic-cloner.ts:12 unresolved interface heritage: ImportedLegacyCloneInput",
    "synthetic-cloner.ts:28 remap: RawRemap",
    "synthetic-cloner.ts:36 transformContext: {\n    readonly remap: MutableMonoFunctionRemap;\n    readonly resourceKinds: MonoResourceKindConcretizationContext;\n    readonly outgoingEdges: readonly MonoOutgoingEdge[];\n    readonly diagnostics: readonly MonoDiagnostic[];\n  }",
    "synthetic-cloner.ts:49 transformContext: StructuralTransformContextAlias",
    "synthetic-cloner.ts:59 remap: MutableMonoFunctionRemap",
    "synthetic-cloner.ts:60 unresolved input type reference: CloneArgs",
    "synthetic-cloner.ts:61 remap: MutableMonoFunctionRemap",
    'synthetic-cloner.ts:62 Pick<{ outgoingEdges: readonly MonoOutgoingEdge[] }, "outgoingEdges">',
    "synthetic-cloner.ts:63 unresolved input type reference: ImportedCloneInput",
    "synthetic-cloner.ts:28 remap: RawRemap",
    "synthetic-cloner.ts:5 diagnostics: readonly MonoDiagnostic[]",
  ]);
});

test("mono cloners do not expose legacy raw clone-state inputs", () => {
  const clonerPaths = monoClonerSourcePaths();
  const offenders = clonerPaths.flatMap((path) => legacyRawCloneStateInputDeclarations(path));

  expect(offenders).toEqual([]);

  for (const path of clonerPaths) {
    const source = sourceText(path);
    expect(source).not.toContain("monoTransformContextFromLegacyCloneState");
  }
});

test("mono canonical clone entry points require the transform context", () => {
  const clonerPaths = monoClonerSourcePaths();
  for (const path of clonerPaths) {
    expect(sourceText(path)).toContain("transformContext: MonoTransformContext");
  }

  expect(monoSource("function-expression-cloner.ts")).toContain("monoTransformExpressionId(");
  expect(monoSource("function-statement-cloner.ts")).toContain("monoTransformStatementId(");
});
