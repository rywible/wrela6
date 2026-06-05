import { TokenKind } from "../../../src/frontend/lexer/token-kind";

export function allTokenKinds(): TokenKind[] {
  return Object.values(TokenKind).filter((value): value is TokenKind => typeof value === "number");
}
