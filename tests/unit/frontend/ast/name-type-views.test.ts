import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, presentTokenText } from "../../../../src/frontend/ast/syntax-query";
import { DottedModuleNameView, QualifiedNameView } from "../../../../src/frontend/ast/name-views";
import {
  TypeParameterView,
  TypeReferenceView,
  ReturnTypeClauseView,
} from "../../../../src/frontend/ast/type-views";
import { RedNode } from "../../../../src/frontend/syntax";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("name and type views", () => {
  test("DottedModuleNameView preserves import path text", () => {
    const root = parseSourceRoot("use Packet from core.net.driver\n");
    const importNode = childNode(root, SyntaxKind.ImportDeclaration)!;
    const moduleName = childNode(importNode, SyntaxKind.DottedModuleName)!;
    const view = DottedModuleNameView.from(moduleName)!;

    expect(view.segments().map((token) => presentTokenText(token))).toEqual([
      "core",
      "net",
      "driver",
    ]);
    expect(view.text()).toBe("core.net.driver");
  });

  test("TypeReferenceView exposes qualified name and type arguments", () => {
    const root = parseSourceRoot("dataclass Box[T: core.Value]:\n    item: core.List[T]\n");
    const dataclassNode = childNode(root, SyntaxKind.DataclassDeclaration)!;
    const block = childNode(dataclassNode, SyntaxKind.Block)!;
    const statementList = childNode(block, SyntaxKind.StatementList)!;
    const field = statementList.child(0)! as RedNode;
    const typeReference = childNode(field, SyntaxKind.TypeReference)!;
    const view = TypeReferenceView.from(typeReference)!;

    expect(view.qualifiedNameText()).toBe("core.List");
    expect(view.typeArguments()).toHaveLength(1);
  });

  test("QualifiedNameView segments and text", () => {
    const root = parseSourceRoot("dataclass Box:\n    item: core.memory.Buffer\n");
    const dataclassNode = childNode(root, SyntaxKind.DataclassDeclaration)!;
    const block = childNode(dataclassNode, SyntaxKind.Block)!;
    const statementList = childNode(block, SyntaxKind.StatementList)!;
    const field = statementList.child(0)! as RedNode;
    const typeRef = childNode(field, SyntaxKind.TypeReference)!;
    const qualifiedName = childNode(typeRef, SyntaxKind.QualifiedName)!;
    const view = QualifiedNameView.from(qualifiedName)!;

    expect(view.segments().map((token) => presentTokenText(token))).toEqual([
      "core",
      "memory",
      "Buffer",
    ]);
    expect(view.text()).toBe("core.memory.Buffer");
  });

  test("TypeParameterView handles name and bound", () => {
    const root = parseSourceRoot("fn parse[T: core.Value](x: T)\n");
    const fnNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const typeParamList = childNode(fnNode, SyntaxKind.TypeParameterList)!;
    const typeParam = typeParamList.child(1)! as RedNode;
    const view = TypeParameterView.from(typeParam)!;

    expect(view.nameText()).toBe("T");
    expect(view.bound()!.qualifiedNameText()).toBe("core.Value");
  });

  test("ReturnTypeClauseView returns direct type", () => {
    const root = parseSourceRoot("fn parse() -> Result\n");
    const fnNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const returnClause = childNode(fnNode, SyntaxKind.ReturnTypeClause)!;
    const view = ReturnTypeClauseView.from(returnClause)!;

    expect(view.type()!.qualifiedNameText()).toBe("Result");
  });

  test("TypeReferenceView returns empty typeArguments without TypeArgumentList", () => {
    const root = parseSourceRoot("fn parse(x: U8)\n");
    const fnNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const paramList = childNode(fnNode, SyntaxKind.ParameterList)!;
    const param = paramList.child(1)! as RedNode;
    const typeRef = childNode(param, SyntaxKind.TypeReference)!;
    const view = TypeReferenceView.from(typeRef)!;

    expect(view.qualifiedNameText()).toBe("U8");
    expect(view.typeArguments()).toEqual([]);
  });
});
