import type { Token } from "../lexer/token";
import type { GreenDiagnostic } from "./green-diagnostic";
import type { GreenElement } from "./green-node";
import { GreenNode } from "./green-node";
import { GreenToken } from "./green-token";
import { SyntaxKind } from "./syntax-kind";

export class SyntaxFactory {
  tokenFromLexToken(token: Token): GreenToken {
    return GreenToken.fromToken(token);
  }

  missingToken(expectedKind: SyntaxKind): GreenToken {
    return GreenToken.missing(expectedKind);
  }

  node(kind: SyntaxKind, children: GreenElement[], diagnostics?: GreenDiagnostic[]): GreenNode {
    return new GreenNode({ kind, children, diagnostics });
  }

  errorNode(children: GreenElement[], diagnostics?: GreenDiagnostic[]): GreenNode {
    return new GreenNode({ kind: SyntaxKind.ErrorNode, children, diagnostics });
  }

  missingNode(): GreenNode {
    return new GreenNode({ kind: SyntaxKind.MissingNode, children: [] });
  }

  skippedTokens(tokens: GreenToken[], diagnostics?: GreenDiagnostic[]): GreenNode {
    return new GreenNode({ kind: SyntaxKind.SkippedTokens, children: tokens, diagnostics });
  }
}
