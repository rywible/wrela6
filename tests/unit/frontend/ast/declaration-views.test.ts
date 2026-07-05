import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import {
  SourceFileView,
  EnumDeclarationView,
  ClassDeclarationView,
  DataclassDeclarationView,
} from "../../../../src/frontend/ast/declaration-views";
import { presentTokenText } from "../../../../src/frontend/ast/syntax-query";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("source declaration views", () => {
  test("SourceFileView separates imports and declarations", () => {
    const root = parseSourceRoot("use Packet from core.net\n\nprivate class Box:\n    field: U8\n");
    const view = SourceFileView.fromRoot(root)!;

    expect(view.imports().map((item) => item.moduleName()!.text())).toEqual(["core.net"]);
    expect(view.declarations().map((item) => item.nameText())).toEqual(["Box"]);
    const classView = view.declarations()[0]! as ClassDeclarationView;
    expect(classView.modifiers()).toEqual(["private"]);
  });

  test("enum cases are declaration-local children", () => {
    const root = parseSourceRoot("enum Color:\n    Red\n    Blue\n");
    const view = SourceFileView.fromRoot(root)!;
    const enumView = view.declarations()[0]!;

    expect(enumView.kind).toBe(SyntaxKind.EnumDeclaration);
    expect((enumView as EnumDeclarationView).enumCases().map((item) => item.nameText())).toEqual([
      "Red",
      "Blue",
    ]);
  });

  test("enum case view exposes payload fields", () => {
    const root = parseSourceRoot("enum Result:\n    ok(value: U8)\n    err\n");
    const view = SourceFileView.fromRoot(root)!;
    const enumView = view.declarations()[0]! as EnumDeclarationView;
    const okCase = enumView.enumCases()[0]!;

    expect(okCase.nameText()).toBe("ok");
    expect(okCase.payloadFields().map((field) => field.nameText())).toEqual(["value"]);
    expect(okCase.payloadFields()[0]?.type()?.qualifiedNameText()).toBe("U8");
    expect(enumView.enumCases()[1]?.payloadFields()).toEqual([]);
  });

  test("enum declaration view exposes type parameters", () => {
    const root = parseSourceRoot("enum Result[Ok, Err]:\n    ok(value: Ok)\n    err(error: Err)\n");
    const view = SourceFileView.fromRoot(root)!;
    const enumView = view.declarations()[0]! as EnumDeclarationView;

    expect(enumView.typeParameters().map((param) => param.nameText())).toEqual(["Ok", "Err"]);
    expect(enumView.enumCases().map((item) => item.nameText())).toEqual(["ok", "err"]);
  });

  test("ClassDeclarationView modifiers returns private when present", () => {
    const root = parseSourceRoot("private class Box:\n    field: U8\n");
    const view = SourceFileView.fromRoot(root)!;
    const classView = view.declarations()[0]! as ClassDeclarationView;

    expect(classView.modifiers()).toEqual(["private"]);
  });

  test("ClassDeclarationView modifiers returns empty when absent", () => {
    const root = parseSourceRoot("class Box:\n    field: U8\n");
    const view = SourceFileView.fromRoot(root)!;
    const classView = view.declarations()[0]! as ClassDeclarationView;

    expect(classView.modifiers()).toEqual([]);
  });

  test("dataclass exposes fields and type parameters", () => {
    const root = parseSourceRoot("dataclass Box[T]:\n    field: U8\n");
    const view = SourceFileView.fromRoot(root)!;
    const dataclassView = view.declarations()[0]! as DataclassDeclarationView;

    expect(dataclassView.typeParameters().map((param) => param.nameText())).toEqual(["T"]);
    expect(dataclassView.fields().map((field) => field.nameText())).toEqual(["field"]);
  });

  test("SourceFileView with multiple declarations returns in order", () => {
    const root = parseSourceRoot("enum Color:\n    Red\ndataclass Box:\n    field: U8\nfn run()\n");
    const view = SourceFileView.fromRoot(root)!;

    expect(view.declarations().map((decl) => decl.nameText())).toEqual(["Color", "Box", "run"]);
  });

  test("ImportDeclarationView.importedNames returns only ImportNameList names", () => {
    const root = parseSourceRoot("use Writer, Status from std.io\n");
    const view = SourceFileView.fromRoot(root)!;
    const importView = view.imports()[0]!;

    expect(importView.importedNames().map((token) => presentTokenText(token))).toEqual([
      "Writer",
      "Status",
    ]);
    expect(importView.moduleName()!.text()).toBe("std.io");
  });
});
