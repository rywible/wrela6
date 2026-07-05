import { SourceSpan } from "../lexer";
import {
  buildSyntaxIndex,
  RedNode,
  RedToken,
  SyntaxIndex,
  SyntaxKind,
  isNameTokenSyntaxKind,
} from "../syntax";

export interface SyntaxQuery {
  readonly index: SyntaxIndex;
}

export function createSyntaxQuery(input: {
  readonly root: RedNode;
  readonly index?: SyntaxIndex;
}): SyntaxQuery {
  return { index: input.index ?? indexForNode(input.root) };
}

export function childNode(
  node: RedNode,
  kind: SyntaxKind,
  query?: SyntaxQuery,
): RedNode | undefined {
  return childrenOf(node, query).find(
    (child): child is RedNode => child instanceof RedNode && child.kind === kind,
  );
}

export function childNodes(node: RedNode, kind: SyntaxKind, query?: SyntaxQuery): RedNode[] {
  return childrenOf(node, query).filter(
    (child): child is RedNode => child instanceof RedNode && child.kind === kind,
  );
}

export function childToken(
  node: RedNode,
  kind: SyntaxKind,
  query?: SyntaxQuery,
): RedToken | undefined {
  return childrenOf(node, query).find(
    (child): child is RedToken => child instanceof RedToken && child.kind === kind,
  );
}

export function childTokens(node: RedNode, kind: SyntaxKind, query?: SyntaxQuery): RedToken[] {
  return childrenOf(node, query).filter(
    (child): child is RedToken => child instanceof RedToken && child.kind === kind,
  );
}

export function childNameTokens(node: RedNode, query?: SyntaxQuery): RedToken[] {
  return childrenOf(node, query).filter(
    (child): child is RedToken =>
      child instanceof RedToken && isNameTokenSyntaxKind(child.kind) && !child.isMissing,
  );
}

export function childNameToken(node: RedNode, query?: SyntaxQuery): RedToken | undefined {
  return childrenOf(node, query).find(
    (child): child is RedToken =>
      child instanceof RedToken && isNameTokenSyntaxKind(child.kind) && !child.isMissing,
  );
}

export function descendants(node: RedNode, kind: SyntaxKind, query?: SyntaxQuery): RedNode[] {
  const result: RedNode[] = [];
  const activeQuery = query ?? createSyntaxQuery({ root: rootForNode(node) });
  const stack = childrenOf(node, activeQuery).slice().reverse();
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child instanceof RedNode) {
      if (child.kind === kind) {
        result.push(child);
      }
      stack.push(...childrenOf(child, activeQuery).reverse());
    }
  }
  return result;
}

export function blockStatementList(block: RedNode, query?: SyntaxQuery): RedNode | undefined {
  return childNode(block, SyntaxKind.StatementList, query);
}

export function blockItems(block: RedNode, query?: SyntaxQuery): RedNode[] {
  const statementList = blockStatementList(block, query);
  if (statementList === undefined) return [];
  return childrenOf(statementList, query).filter(
    (child): child is RedNode => child instanceof RedNode,
  );
}

export function presentTokenText(token: RedToken | undefined): string | undefined {
  if (token === undefined || token.isMissing) return undefined;
  return token.green.lexeme;
}

export function presentTokenSpan(token: RedToken | undefined): SourceSpan | undefined {
  if (token === undefined || token.isMissing) return undefined;
  const leadingWidth = token.green.leadingTrivia.reduce((sum, trivia) => sum + trivia.width, 0);
  const start = token.offset + leadingWidth;
  return SourceSpan.from(start, start + token.green.lexeme.length);
}

export function childrenOf(node: RedNode, query?: SyntaxQuery): (RedNode | RedToken)[] {
  const activeQuery = query ?? createSyntaxQuery({ root: rootForNode(node) });
  return activeQuery.index.childrenOf(node);
}

const rootIndexes = new WeakMap<RedNode, SyntaxIndex>();

function indexForNode(root: RedNode): SyntaxIndex {
  let index = rootIndexes.get(root);
  if (index === undefined) {
    index = buildSyntaxIndex(root);
    rootIndexes.set(root, index);
  }
  return index;
}

function rootForNode(node: RedNode): RedNode {
  let current = node;
  while (current.parent !== undefined) {
    current = current.parent;
  }
  return current;
}
