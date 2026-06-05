import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, descendants } from "../../../../src/frontend/ast/syntax-query";
import {
  BlockView,
  IfStatementView,
  ConditionView,
} from "../../../../src/frontend/ast/statement-views";
import {
  RequireSectionView,
  RequiresSectionView,
} from "../../../../src/frontend/ast/requirement-views";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("statement and requirement views", () => {
  test("BlockView returns only direct items", () => {
    const root = parseSourceRoot(
      "fn main():\n    if flag:\n        fn nested()\n    fn direct()\n",
    );
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const block = childNode(functionNode, SyntaxKind.Block)!;
    const view = BlockView.from(block)!;

    expect(view.items().map((item) => item.kind)).toEqual([
      SyntaxKind.IfStatement,
      SyntaxKind.FunctionDeclaration,
    ]);
  });

  test("function requires sections expose requirements", () => {
    const root = parseSourceRoot("fn check():\n    requires:\n        flag else backup\n");
    const section = descendants(root, SyntaxKind.RequiresSection)[0]!;
    const view = RequiresSectionView.from(section)!;

    expect(view.requirements()).toHaveLength(1);
    expect(view.requirements()[0]!.expression()!.kind).toBe(SyntaxKind.ElseRequirementExpression);
  });

  test("validated-buffer require sections expose requirements", () => {
    const root = parseSourceRoot("validated buffer Packet:\n    require:\n        size > 0\n");
    const section = descendants(root, SyntaxKind.RequireSection)[0]!;
    const view = RequireSectionView.from(section)!;

    expect(view.requirements()).toHaveLength(1);
  });

  test("IfStatementView exposes condition and body", () => {
    const root = parseSourceRoot("fn main():\n    if flag:\n        1\n");
    const ifNode = descendants(root, SyntaxKind.IfStatement)[0]!;
    const view = IfStatementView.from(ifNode)!;

    expect(view.condition()).toBeDefined();
    expect(view.body()).toBeDefined();
    expect(view.elseClause()).toBeUndefined();
  });

  test("ConditionView exposes expression", () => {
    const root = parseSourceRoot("fn main():\n    if flag:\n        1\n");
    const condNode = descendants(root, SyntaxKind.Condition)[0]!;
    const view = ConditionView.from(condNode)!;

    expect(view.expression()).toBeDefined();
  });
});
