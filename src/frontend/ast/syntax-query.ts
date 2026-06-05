import { SourceSpan } from "../lexer";
import { RedNode, RedToken, SyntaxKind, isNameTokenSyntaxKind } from "../syntax";

export function childNode(node: RedNode, kind: SyntaxKind): RedNode | undefined {
  return node
    .children()
    .find((child): child is RedNode => child instanceof RedNode && child.kind === kind);
}

export function childNodes(node: RedNode, kind: SyntaxKind): RedNode[] {
  return node
    .children()
    .filter((child): child is RedNode => child instanceof RedNode && child.kind === kind);
}

export function childToken(node: RedNode, kind: SyntaxKind): RedToken | undefined {
  return node
    .children()
    .find((child): child is RedToken => child instanceof RedToken && child.kind === kind);
}

export function childTokens(node: RedNode, kind: SyntaxKind): RedToken[] {
  return node
    .children()
    .filter((child): child is RedToken => child instanceof RedToken && child.kind === kind);
}

export function childNameTokens(node: RedNode): RedToken[] {
  return node
    .children()
    .filter(
      (child): child is RedToken =>
        child instanceof RedToken && isNameTokenSyntaxKind(child.kind) && !child.isMissing,
    );
}

export function childNameToken(node: RedNode): RedToken | undefined {
  return node
    .children()
    .find(
      (child): child is RedToken =>
        child instanceof RedToken && isNameTokenSyntaxKind(child.kind) && !child.isMissing,
    );
}

export function descendants(node: RedNode, kind: SyntaxKind): RedNode[] {
  const result: RedNode[] = [];
  const stack = node.children().slice().reverse();
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child instanceof RedNode) {
      if (child.kind === kind) {
        result.push(child);
      }
      stack.push(...child.children().reverse());
    }
  }
  return result;
}

export function blockStatementList(block: RedNode): RedNode | undefined {
  return childNode(block, SyntaxKind.StatementList);
}

export function blockItems(block: RedNode): RedNode[] {
  const statementList = blockStatementList(block);
  if (statementList === undefined) return [];
  return statementList.children().filter((child): child is RedNode => child instanceof RedNode);
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
