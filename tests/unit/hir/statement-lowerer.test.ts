import { expect, test } from "bun:test";
import { SyntaxKind } from "../../../src/frontend";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { MatchStatementView } from "../../../src/frontend/ast/statement-views";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import { lowerStatement } from "../../../src/hir/statement-lowerer";
import { currentHirModuleId } from "../../../src/hir/lowering-context";
import { hirStatementId } from "../../../src/hir/ids";
import { checkedProofSurface } from "../../../src/semantic/surface/proof-surface";
import {
  CheckedMatchRefinementSurfaceTableBuilder,
  matchRefinementMatchKey,
  matchRefinementScrutineeKey,
} from "../../../src/semantic/surface/proof-contracts";
import { SourceSpan } from "../../../src/shared/source-span";

function firstStatement(kind: SyntaxKind, source: string) {
  const context = createHirUnitContext(source);
  const node = descendants(context.graph.modules[0]!.tree.root(), kind)[0]!;
  return { context, node };
}

test("break lowers to structured HIR statement", () => {
  const { context, node } = firstStatement(
    SyntaxKind.LoopStatement,
    "fn process():\n    loop:\n        break\n",
  );

  const statement = lowerStatement({ node, context });

  expect(statement.kind.kind).toBe("loop");
  if (statement.kind.kind !== "loop") throw new Error("expected loop statement");
  expect(statement.kind.body.statements[0]!.kind.kind).toBe("break");
});

test("compound statements reserve parent statement ids before lowering child blocks", () => {
  const { context, node } = firstStatement(
    SyntaxKind.LoopStatement,
    "fn process():\n    loop:\n        break\n",
  );

  const statement = lowerStatement({ node, context });

  expect(statement.statementId).toBe(hirStatementId(0));
  expect(statement.kind.kind).toBe("loop");
  if (statement.kind.kind !== "loop") throw new Error("expected loop statement");
  expect(statement.kind.body.statements[0]!.statementId).toBe(hirStatementId(1));
});

test("ensure records parser-backed candidate for fact lowering", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    "fn process(ready: bool):\n    ensure ready\n",
  );
  context.locals.addSourceLocal({
    name: "ready",
    type: { kind: "core", coreTypeId: "bool" as any },
    resourceKind: { kind: "concrete", value: "Copy" },
    sourceOrigin: 0 as any,
    introducedBy: "sourceLet",
  });

  const statement = lowerStatement({ node, context });

  expect(statement.kind.kind).toBe("expression");
  expect(context.bodyIndex.build().ensureCandidates).toEqual([
    expect.objectContaining({ sourceStatementKind: "ensure" }),
  ]);
});

test("ensure with string literal does not create a fact candidate", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    'fn process():\n    ensure "ready"\n',
  );

  lowerStatement({ node, context });

  expect(context.bodyIndex.build().ensureCandidates).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CONDITION_NOT_BOOL",
  );
});

test("malformed ensure without condition lowers fail-closed with a diagnostic", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    "fn process():\n    ensure\n",
  );

  const statement = lowerStatement({ node, context });

  expect(statement.kind).toEqual({ kind: "error", reason: "missing-ensure-condition" });
  expect(context.bodyIndex.build().ensureCandidates).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_UNSUPPORTED_EXPRESSION",
  );
});

test("ensure with arithmetic binary expression does not create a fact candidate", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    "fn process():\n    ensure 1 + 2\n",
  );

  lowerStatement({ node, context });

  expect(context.bodyIndex.build().ensureCandidates).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CONDITION_NOT_BOOL",
  );
});

test("ensure with bare function symbol does not create a fact candidate", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    "fn ready() -> bool\nfn process():\n    ensure ready\n",
  );

  lowerStatement({ node, context });

  expect(context.bodyIndex.build().ensureCandidates).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CONDITION_NOT_BOOL",
  );
});

test("ensure with unresolved call does not borrow bool expected type", () => {
  const { context, node } = firstStatement(
    SyntaxKind.EnsureStatement,
    "fn process():\n    ensure missing()\n",
  );

  lowerStatement({ node, context });

  expect(context.bodyIndex.build().ensureCandidates).toEqual([]);
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_CALL_CALLEE_NOT_FUNCTION",
  );
});

test("annotated let provides expected type to object literal initializer", () => {
  const { context, node } = firstStatement(
    SyntaxKind.LetStatement,
    "class Binding:\n    value: u32\nfn process():\n    let binding: Binding = { value: 1 }\n",
  );

  const statement = lowerStatement({ node, context });

  expect(statement.kind.kind).toBe("let");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
  );
  if (statement.kind.kind !== "let") throw new Error("expected let statement");
  expect(statement.kind.statement.local.type).toEqual(context.program.types.entries()[0]!.type);
});

test("malformed if without condition lowers fail-closed instead of throwing", () => {
  const { context, node } = firstStatement(
    SyntaxKind.IfStatement,
    "fn caller() -> Never:\n    if:\n        return\n",
  );

  const statement = lowerStatement({ node, context });

  expect(statement.kind).toEqual({ kind: "error", reason: "missing-if-condition" });
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_UNSUPPORTED_EXPRESSION",
  );
});

test("assignment to a non-place target emits HIR_NON_PLACE_ASSIGNMENT_TARGET", () => {
  const { context, node } = firstStatement(
    SyntaxKind.AssignmentStatement,
    "fn process():\n    1 = 2\n",
  );

  lowerStatement({ node, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_NON_PLACE_ASSIGNMENT_TARGET",
  );
});

test("constructor-style let pattern emits HIR_UNSUPPORTED_PATTERN and recovers local", () => {
  const { context, node } = firstStatement(
    SyntaxKind.LetStatement,
    "fn process():\n    let Some(value) = 1\n",
  );

  const statement = lowerStatement({ node, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_UNSUPPORTED_PATTERN",
  );
  expect(statement.kind.kind).toBe("let");
  if (statement.kind.kind !== "let") throw new Error("expected let statement");
  expect(statement.kind.statement.local?.name).toBe("Some");
});

test("ordinary match does not apply unrelated global match refinement surface", () => {
  const { context, node } = firstStatement(
    SyntaxKind.MatchStatement,
    "fn process(flag: bool):\n    match flag:\n        case true:\n            return\n",
  );
  context.locals.addSourceLocal({
    name: "flag",
    type: { kind: "core", coreTypeId: "bool" as any },
    resourceKind: { kind: "concrete", value: "Copy" },
    sourceOrigin: 0 as any,
    introducedBy: "sourceLet",
  });
  const builder = new CheckedMatchRefinementSurfaceTableBuilder();
  builder.add({
    matchStatementKey: "other-match",
    scrutineeKey: "other-scrutinee",
    variantReferenceKey: "other-variant",
    fieldBindingKeys: [],
    span: SourceSpan.from(0, 1),
  });
  Object.assign(context, {
    program: {
      ...context.program,
      proofSurface: checkedProofSurface({ matchRefinements: builder.build() }),
    },
  });

  lowerStatement({ node, context });

  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  );
});

test("match lowers linked checked refinement surface into proof metadata", () => {
  const { context, node } = firstStatement(
    SyntaxKind.MatchStatement,
    "fn process(flag: bool):\n    match flag:\n        case true:\n            return\n",
  );
  context.locals.addSourceLocal({
    name: "flag",
    type: { kind: "core", coreTypeId: "bool" as any },
    resourceKind: { kind: "concrete", value: "Copy" },
    sourceOrigin: 0 as any,
    introducedBy: "sourceLet",
  });
  const builder = new CheckedMatchRefinementSurfaceTableBuilder();
  const match = MatchStatementView.from(node)!;
  const scrutinee = match.condition()?.expression() ?? match.expression();
  if (scrutinee === undefined) throw new Error("expected match scrutinee");
  builder.add({
    matchStatementKey: matchRefinementMatchKey({
      moduleId: currentHirModuleId(context),
      span: match.node.span,
    }),
    scrutineeKey: matchRefinementScrutineeKey({
      moduleId: currentHirModuleId(context),
      span: scrutinee.node.span,
    }),
    variantReferenceKey: "variant:true",
    fieldBindingKeys: ["field:payload"],
    span: SourceSpan.from(0, 1),
  });
  Object.assign(context, {
    program: {
      ...context.program,
      proofSurface: checkedProofSurface({ matchRefinements: builder.build() }),
    },
  });

  lowerStatement({ node, context });

  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  );
  expect(context.proofMetadata.factOrigins.entries()).toEqual([
    expect.objectContaining({
      fact: expect.objectContaining({
        kind: "matchRefinement",
        variantReferenceKey: "variant:true",
        fieldBindingKeys: ["field:payload"],
      }),
    }),
  ]);
});
