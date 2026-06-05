import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, descendants } from "../../../../src/frontend/ast/syntax-query";
import {
  BlockView,
  IfStatementView,
  ConditionView,
  LetStatementView,
  ForStatementView,
  TakeStatementView,
  ElseClauseView,
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

  test("LetStatementView exposes type and value", () => {
    const root = parseSourceRoot("fn main():\n    let x: U8 = 5\n");
    const letNode = descendants(root, SyntaxKind.LetStatement)[0]!;
    const view = LetStatementView.from(letNode)!;

    expect(view.type()).toBeDefined();
    expect(view.type()!.qualifiedNameText()).toBe("U8");
    expect(view.value()).toBeDefined();
  });

  test("LetStatementView returns undefined type when no annotation", () => {
    const root = parseSourceRoot("fn main():\n    let x = 5\n");
    const letNode = descendants(root, SyntaxKind.LetStatement)[0]!;
    const view = LetStatementView.from(letNode)!;

    expect(view.type()).toBeUndefined();
    expect(view.value()).toBeDefined();
  });

  test("ForStatementView exposes iterable and body", () => {
    const root = parseSourceRoot("fn main():\n    for x in items:\n        process(x)\n");
    const forNode = descendants(root, SyntaxKind.ForStatement)[0]!;
    const view = ForStatementView.from(forNode)!;

    expect(view.iterable()).toBeDefined();
    expect(view.body()).toBeDefined();
  });

  test("TakeStatementView exposes expression, alias, and body", () => {
    const root = parseSourceRoot("fn main():\n    take stream as packet:\n        close(packet)\n");
    const takeNode = descendants(root, SyntaxKind.TakeStatement)[0]!;
    const view = TakeStatementView.from(takeNode)!;

    expect(view.expression()).toBeDefined();
    expect(view.aliasText()).toBe("packet");
    expect(view.body()).toBeDefined();
    expect(view.body()!.items()).toHaveLength(1);
  });

  test("TakeStatementView returns undefined alias when no as clause", () => {
    const root = parseSourceRoot("fn main():\n    take stream:\n        close(stream)\n");
    const takeNode = descendants(root, SyntaxKind.TakeStatement)[0]!;
    const view = TakeStatementView.from(takeNode)!;

    expect(view.expression()).toBeDefined();
    expect(view.aliasText()).toBeUndefined();
    expect(view.body()).toBeDefined();
  });

  test("ElseClauseView exposes body for block form", () => {
    const root = parseSourceRoot("fn main():\n    if flag:\n        1\n    else:\n        2\n");
    const elseNode = descendants(root, SyntaxKind.ElseClause)[0]!;
    const view = ElseClauseView.from(elseNode)!;

    expect(view.body()).toBeDefined();
    expect(view.statement()).toBeUndefined();
  });

  test("ElseClauseView exposes statement for inline form", () => {
    const root = parseSourceRoot("fn main():\n    if flag:\n        1\n    else return 2\n");
    const elseNode = descendants(root, SyntaxKind.ElseClause)[0]!;
    const view = ElseClauseView.from(elseNode)!;

    expect(view.body()).toBeUndefined();
    expect(view.statement()).toBeDefined();
  });
});
