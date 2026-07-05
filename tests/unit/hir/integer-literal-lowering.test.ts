import { expect, test } from "bun:test";
import { descendants } from "../../../src/frontend/ast/syntax-query";
import { RequirementView } from "../../../src/frontend/ast/requirement-views";
import { SyntaxKind } from "../../../src/frontend";
import { lowerExpression } from "../../../src/hir/expression-lowerer";
import { lowerRequirementSurface } from "../../../src/hir/requirement-lowerer";
import { functionId } from "../../../src/semantic/ids";
import {
  createHirUnitContext,
  firstExpressionView,
  lowerTypedHirForTest,
} from "../../support/hir/typed-hir-fixtures";

function integerLiteralValue(sourceText: string): bigint {
  const context = createHirUnitContext(sourceText);
  const expression = lowerExpression({
    view: firstExpressionView(context.graph),
    context,
  });

  if (expression.kind.kind !== "literal" || expression.kind.literal.kind !== "integer") {
    throw new Error("expected integer literal");
  }
  if (expression.kind.literal.value === undefined) {
    throw new Error("expected integer literal value");
  }

  return expression.kind.literal.value;
}

function firstRequirementExpressionSpan(context: ReturnType<typeof createHirUnitContext>) {
  const node = descendants(context.graph.modules[0]!.tree.root(), SyntaxKind.Requirement)[0]!;
  const expression = RequirementView.from(node)!.expression();
  if (expression === undefined) throw new Error("expected requirement expression");
  return expression.span;
}

test("expression lowering parses all integer literal forms through the canonical parser", () => {
  expect(integerLiteralValue("fn process() -> u32:\n    return 0x1F\n")).toBe(31n);
  expect(integerLiteralValue("fn process() -> u32:\n    return 0b11111\n")).toBe(31n);
  expect(integerLiteralValue("fn process() -> u32:\n    return 3_1\n")).toBe(31n);
});

test("layout expression lowering parses prefixed and separated integer literals", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      ["validated buffer Packet:", "    layout:", "        payload: u8 @ 0x10 len 0b1000"].join(
        "\n",
      ),
    ],
  ]);
  const payload = result.program.validatedBuffers.entries()[0]!.layoutFields[0]!;

  expect(payload.offset.kind).toBe("integerLiteral");
  expect(payload.offset.kind === "integerLiteral" ? payload.offset.value : undefined).toBe(16n);
  expect(payload.length?.kind).toBe("integerLiteral");
  expect(payload.length?.kind === "integerLiteral" ? payload.length.value : undefined).toBe(8n);
});

test("requirement lowering parses integer literals through the canonical parser", () => {
  const context = createHirUnitContext(
    "fn guarded() -> bool:\n    requires:\n        0x1F == 31\n",
  );
  const span = firstRequirementExpressionSpan(context);

  const requirement = lowerRequirementSurface({
    surface: {
      ownerFunctionId: functionId(0),
      expression: {
        kind: "checked",
        text: "0x1F == 31",
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
    kind: "binary",
    left: { kind: "literal", value: 31n },
    right: { kind: "literal", value: 31n },
  });
});
