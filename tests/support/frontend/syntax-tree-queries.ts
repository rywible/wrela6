import type { SyntaxKind } from "../../../src/frontend/syntax/syntax-kind";
import type { SyntaxTree } from "../../../src/frontend/syntax/syntax-tree";
import { RedNode } from "../../../src/frontend/syntax/red-node";
import { RedToken } from "../../../src/frontend/syntax/red-token";

export function kindsInTree(tree: SyntaxTree): SyntaxKind[] {
  const result: SyntaxKind[] = [];
  visit(tree.root(), result);
  return result;
}

function visit(element: RedNode | RedToken, result: SyntaxKind[]): void {
  result.push(element.kind);
  if (element instanceof RedNode) {
    for (const child of element.children()) {
      visit(child, result);
    }
  }
}

export function findKind(tree: SyntaxTree, kind: SyntaxKind): RedNode | RedToken | undefined {
  return findInNode(tree.root(), kind);
}

function findInNode(element: RedNode | RedToken, kind: SyntaxKind): RedNode | RedToken | undefined {
  if (element.kind === kind) return element;
  if (element instanceof RedNode) {
    for (const child of element.children()) {
      const found = findInNode(child, kind);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
