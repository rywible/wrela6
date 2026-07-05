import { SourceSpan } from "../lexer/source-span";
import { RedNode } from "./red-node";
import { RedToken } from "./red-token";
import { SyntaxKind } from "./syntax-kind";
import {
  childIds,
  parentId,
  syntaxNodeId,
  syntaxTokenId,
  type SyntaxElementId,
  type SyntaxNodeId,
  type SyntaxTokenId,
} from "./syntax-identity";

export type SyntaxElement = RedNode | RedToken;

export interface SyntaxAnchor {
  readonly id: SyntaxElementId;
  readonly span: SourceSpan;
}

export class SyntaxIndex {
  private readonly nodesById = new Map<SyntaxNodeId, RedNode>();
  private readonly tokensById = new Map<SyntaxTokenId, RedToken>();
  private readonly parentIdsById = new Map<SyntaxElementId, SyntaxNodeId>();
  private readonly childIdsByNodeId = new Map<SyntaxNodeId, readonly SyntaxElementId[]>();
  private readonly elementsInPreorder: SyntaxElement[] = [];
  private readonly tokensInPreorder: RedToken[] = [];

  constructor(root: RedNode) {
    this.indexNode(root);
  }

  getNode(id: SyntaxNodeId): RedNode | undefined {
    return this.nodesById.get(id);
  }

  getToken(id: SyntaxTokenId): RedToken | undefined {
    return this.tokensById.get(id);
  }

  getElement(id: SyntaxElementId): SyntaxElement | undefined {
    return this.nodesById.get(id as SyntaxNodeId) ?? this.tokensById.get(id as SyntaxTokenId);
  }

  idFor(element: RedNode): SyntaxNodeId;
  idFor(element: RedToken): SyntaxTokenId;
  idFor(element: SyntaxElement): SyntaxElementId {
    return element instanceof RedNode ? syntaxNodeId(element) : syntaxTokenId(element);
  }

  parentIdFor(element: SyntaxElement | SyntaxElementId): SyntaxNodeId | undefined {
    const id =
      typeof element === "string"
        ? element
        : element instanceof RedNode
          ? syntaxNodeId(element)
          : syntaxTokenId(element);
    return this.parentIdsById.get(id);
  }

  childIdsFor(node: RedNode | SyntaxNodeId): readonly SyntaxElementId[] {
    const id = typeof node === "string" ? node : syntaxNodeId(node);
    return this.childIdsByNodeId.get(id) ?? [];
  }

  childrenOf(node: RedNode | SyntaxNodeId): SyntaxElement[] {
    return this.childIdsFor(node)
      .map((id) => this.getElement(id))
      .filter((element): element is SyntaxElement => element !== undefined);
  }

  findSmallestNodeContainingSpan(span: SourceSpan): RedNode | undefined {
    let best: RedNode | undefined;
    for (const node of this.nodesById.values()) {
      if (!containsSpan(node.span, span)) continue;
      if (best === undefined || node.width < best.width) {
        best = node;
      }
    }
    return best;
  }

  findTokenAtOffset(offset: number): RedToken | undefined {
    for (const token of this.tokensInPreorder) {
      if (token.span.start <= offset && offset < token.span.end) return token;
      if (token.span.start === token.span.end && token.span.start === offset) return token;
    }
    return this.tokensInPreorder.find(
      (token) => token.kind === SyntaxKind.EndOfFileToken && token.span.start === offset,
    );
  }

  anchorForSpan(span: SourceSpan): SyntaxAnchor | undefined {
    const token = span.start === span.end ? this.findTokenAtOffset(span.start) : undefined;
    if (token !== undefined) return { id: syntaxTokenId(token), span: token.span };

    const node = this.findSmallestNodeContainingSpan(span);
    if (node === undefined) return undefined;
    return { id: syntaxNodeId(node), span: node.span };
  }

  containsMissingToken(node: RedNode): boolean {
    const stack: RedNode[] = [node];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of this.childrenOf(current)) {
        if (child instanceof RedToken) {
          if (child.isMissing) return true;
        } else {
          stack.push(child);
        }
      }
    }
    return false;
  }

  private indexNode(node: RedNode): void {
    const nodeId = syntaxNodeId(node);
    this.nodesById.set(nodeId, node);
    this.elementsInPreorder.push(node);

    const nodeParentId = parentId(node);
    if (nodeParentId !== undefined) this.parentIdsById.set(nodeId, nodeParentId);

    const ids = childIds(node);
    this.childIdsByNodeId.set(nodeId, ids);

    for (const child of node.children()) {
      if (child instanceof RedNode) {
        this.indexNode(child);
      } else {
        this.indexToken(child);
      }
    }
  }

  private indexToken(token: RedToken): void {
    const tokenId = syntaxTokenId(token);
    this.tokensById.set(tokenId, token);
    this.elementsInPreorder.push(token);
    this.tokensInPreorder.push(token);

    const tokenParentId = parentId(token);
    if (tokenParentId !== undefined) this.parentIdsById.set(tokenId, tokenParentId);
  }
}

export function buildSyntaxIndex(treeOrRoot: { root(): RedNode } | RedNode): SyntaxIndex {
  const root = treeOrRoot instanceof RedNode ? treeOrRoot : treeOrRoot.root();
  return new SyntaxIndex(root);
}

function containsSpan(container: SourceSpan, contained: SourceSpan): boolean {
  return container.start <= contained.start && contained.end <= container.end;
}
