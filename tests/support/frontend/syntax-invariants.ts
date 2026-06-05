import { expect } from "bun:test";
import type { SourceText } from "../../../src/frontend/lexer/source-text";
import type { SyntaxTree } from "../../../src/frontend/syntax/syntax-tree";
import { RedNode } from "../../../src/frontend/syntax/red-node";
import { RedToken } from "../../../src/frontend/syntax/red-token";

export function expectValidSyntaxTree(params: {
  source: SourceText;
  tree: SyntaxTree;
  allowDiagnostics: boolean;
}): void {
  const { source, tree, allowDiagnostics } = params;

  expect(tree.reconstruct()).toBe(source.text);

  expectGreenWidths(tree);

  expectRedSpansInBounds(tree, source);

  expectDiagnosticsInBounds(tree, source);

  expectRepeatedNavigationEquivalent(tree);

  if (!allowDiagnostics) {
    expect(tree.diagnostics.length).toBe(0);
  }
}

function expectGreenWidths(tree: SyntaxTree): void {
  expectNodeWidths(tree.root());
}

function expectNodeWidths(element: RedNode | RedToken): void {
  if (element instanceof RedNode) {
    let childSum = 0;
    for (const child of element.children()) {
      childSum += child.span.end - child.span.start;
      expectNodeWidths(child);
    }
    const spanLen = element.span.end - element.span.start;
    expect(spanLen).toBe(childSum);
  }
}

function expectRedSpansInBounds(tree: SyntaxTree, source: SourceText): void {
  expectSpanInBounds(tree.root(), source);
}

function expectSpanInBounds(element: RedNode | RedToken, source: SourceText): void {
  expect(element.span.start).toBeGreaterThanOrEqual(0);
  expect(element.span.end).toBeGreaterThanOrEqual(element.span.start);
  expect(element.span.end).toBeLessThanOrEqual(source.length);

  if (element instanceof RedNode) {
    let previousEnd = element.span.start;
    for (const child of element.children()) {
      expect(child.span.start).toBeGreaterThanOrEqual(element.span.start);
      expect(child.span.end).toBeLessThanOrEqual(element.span.end);
      expect(child.span.start).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = child.span.end;
      expectSpanInBounds(child, source);
    }
  }
}

function expectDiagnosticsInBounds(tree: SyntaxTree, source: SourceText): void {
  for (const diagnostic of tree.diagnostics) {
    expect(diagnostic.source).toBe(source);
    expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
    expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
  }
}

function expectRepeatedNavigationEquivalent(tree: SyntaxTree): void {
  const root = tree.root();
  const first = root.children();
  const second = root.children();

  expect(first.length).toBe(second.length);

  for (let index = 0; index < first.length; index++) {
    const elementA = first[index]!;
    const elementB = second[index]!;

    expect(elementA).not.toBe(elementB);

    expect(elementA.kind).toBe(elementB.kind);
    expect(elementA.span.start).toBe(elementB.span.start);
    expect(elementA.span.end).toBe(elementB.span.end);

    if (elementA instanceof RedNode && elementB instanceof RedNode) {
      expect(elementA.childIndex).toBe(elementB.childIndex);
      expect(elementA.offset).toBe(elementB.offset);
    }

    if (elementA instanceof RedToken && elementB instanceof RedToken) {
      expect(elementA.childIndex).toBe(elementB.childIndex);
      expect(elementA.offset).toBe(elementB.offset);
      expect(elementA.isMissing).toBe(elementB.isMissing);
    }
  }
}
