import { RedNode } from "./red-node";
import { RedToken } from "./red-token";

declare const syntaxNodeIdBrand: unique symbol;
declare const syntaxTokenIdBrand: unique symbol;

export type SyntaxNodeId = string & { readonly [syntaxNodeIdBrand]: true };
export type SyntaxTokenId = string & { readonly [syntaxTokenIdBrand]: true };
export type SyntaxElementId = SyntaxNodeId | SyntaxTokenId;

export function syntaxNodeId(node: RedNode): SyntaxNodeId {
  return syntaxElementKey("node", node) as SyntaxNodeId;
}

export function syntaxTokenId(token: RedToken): SyntaxTokenId {
  return syntaxElementKey("token", token) as SyntaxTokenId;
}

export function parentId(node: RedNode | RedToken): SyntaxNodeId | undefined {
  return node.parent === undefined ? undefined : syntaxNodeId(node.parent);
}

export function childIds(node: RedNode): SyntaxElementId[] {
  return node.children().map((child) => {
    if (child instanceof RedNode) {
      return syntaxNodeId(child);
    }
    return syntaxTokenId(child);
  });
}

function syntaxElementKey(prefix: "node" | "token", element: RedNode | RedToken): string {
  return `${prefix}:${pathKey(element)}:${element.kind}:${element.span.start}:${element.span.end}`;
}

function pathKey(element: RedNode | RedToken): string {
  const path: number[] = [];
  let current: RedNode | RedToken | undefined = element;
  while (current !== undefined) {
    path.push(current.childIndex);
    current = current.parent;
  }
  return path.reverse().join(".");
}
