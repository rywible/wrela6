import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { lowerRequirementSurface } from "../../../src/hir/requirement-lowerer";
import { createHirUnitContext } from "../../support/hir/typed-hir-fixtures";
import { functionId } from "../../../src/semantic/ids";
import { RequirementView } from "../../../src/frontend/ast/requirement-views";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { SyntaxKind } from "../../../src/frontend";

function firstRequirementSurface(sourceText: string) {
  const context = createHirUnitContext(sourceText);
  const surface = context.program.proofSurface.requirementSurfaces.entries()[0];
  if (surface === undefined || surface.ownerFunctionId === undefined) {
    throw new Error("expected requirement surface");
  }
  return { context, surface };
}

function firstRequirementExpressionSpan(context: ReturnType<typeof createHirUnitContext>) {
  const node = descendants(context.graph.modules[0]!.tree.root(), SyntaxKind.Requirement)[0]!;
  const expression = RequirementView.from(node)!.expression();
  if (expression === undefined) throw new Error("expected requirement expression");
  return expression.span;
}

test("requirement lowering preserves opaque expressions without call metadata", () => {
  const context = createHirUnitContext("fn guarded() -> bool\n");
  const requirement = lowerRequirementSurface({
    surface: {
      ownerFunctionId: functionId(0),
      expression: { kind: "opaque", text: "ready()" },
      span: SourceSpan.from(0, 7),
    },
    owner: { kind: "function", functionId: functionId(0) },
    context,
  });

  expect(requirement.expression).toEqual({ kind: "opaque", text: "ready()" });
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
});

test("requirement lowering preserves simple checked references as structured expressions", () => {
  const { context, surface } = firstRequirementSurface(
    "fn guarded() -> bool:\n    requires:\n        guarded\n",
  );

  const requirement = lowerRequirementSurface({
    surface,
    owner: { kind: "function", functionId: surface.ownerFunctionId! },
    context,
  });

  expect(requirement.expression.kind).toBe("structured");
  if (requirement.expression.kind !== "structured") throw new Error("expected structured");
  expect(requirement.expression.expression).toMatchObject({
    kind: "reference",
    functionId: surface.ownerFunctionId,
    name: "guarded",
  });
});

test("requirement lowering preserves checked literal expressions", () => {
  const context = createHirUnitContext("fn guarded() -> bool:\n    requires:\n        false\n");
  const span = firstRequirementExpressionSpan(context);

  const requirement = lowerRequirementSurface({
    surface: {
      ownerFunctionId: functionId(0),
      expression: {
        kind: "checked",
        text: "false",
        references: [],
        completedMembers: [],
      },
      span,
    },
    owner: { kind: "function", functionId: functionId(0) },
    context,
  });

  expect(requirement.expression.kind).toBe("structured");
  if (requirement.expression.kind !== "structured") throw new Error("expected structured");
  expect(requirement.expression.expression).toMatchObject({
    kind: "literal",
    value: false,
  });
});

test("requirement lowering preserves checked call references without call metadata", () => {
  const { context, surface } = firstRequirementSurface(
    "fn guarded() -> bool:\n    requires:\n        guarded()\n",
  );

  const requirement = lowerRequirementSurface({
    surface,
    owner: { kind: "function", functionId: surface.ownerFunctionId! },
    context,
  });

  expect(requirement.expression.kind).toBe("structured");
  if (requirement.expression.kind !== "structured") throw new Error("expected structured");
  expect(requirement.expression.expression).toMatchObject({
    kind: "call",
    calleeFunctionId: surface.ownerFunctionId,
    arguments: [],
  });
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.proofMetadata.platformContractEdges.entries()).toEqual([]);
});

test("requirement lowering preserves checked binary expressions", () => {
  const { context, surface } = firstRequirementSurface(
    "fn guarded() -> bool:\n    requires:\n        guarded == false\n",
  );

  const requirement = lowerRequirementSurface({
    surface,
    owner: { kind: "function", functionId: surface.ownerFunctionId! },
    context,
  });

  expect(requirement.expression.kind).toBe("structured");
  if (requirement.expression.kind !== "structured") throw new Error("expected structured");
  expect(requirement.expression.expression).toMatchObject({
    kind: "binary",
    operator: "==",
    left: { kind: "reference", name: "guarded", functionId: surface.ownerFunctionId },
    right: { kind: "literal", value: false },
  });
});

test("checked member requirements with receiver references fail closed with unsupported-form diagnostic", () => {
  const { context, surface } = firstRequirementSurface(
    [
      "class Packet:",
      "    ready: bool",
      "fn guarded(packet: Packet) -> bool:",
      "    requires:",
      "        packet.ready",
    ].join("\n"),
  );

  const requirement = lowerRequirementSurface({
    surface,
    owner: { kind: "function", functionId: surface.ownerFunctionId! },
    context,
  });

  expect(requirement.expression.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_UNSUPPORTED_REQUIREMENT_FORM",
  );
});

test("checked requirements with unsupported reference kinds fail closed with mismatch diagnostic", () => {
  const { context, surface } = firstRequirementSurface(
    "fn guarded(value: u32) -> bool:\n    requires:\n        value\n",
  );

  const requirement = lowerRequirementSurface({
    surface,
    owner: { kind: "function", functionId: surface.ownerFunctionId! },
    context,
  });

  expect(requirement.expression.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_REQUIREMENT_REFERENCE_MISMATCH",
  );
});
