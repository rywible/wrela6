import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenElement } from "../syntax/green-node";
import { canStartExpression } from "./parser-utils";
import {
  parseLetStatement,
  parseReturnStatement,
  parseYieldStatement,
  parseContinueStatement,
  parseLoopStatement,
} from "./binding-statement-parser";
import { parseExpressionOrAssignmentStatement } from "./expression-statement-parser";
import {
  parseIfStatement,
  parseWhileStatement,
  parseForStatement,
  parseTakeStatement,
} from "./control-statement-parser";
import { parseMatchStatement } from "./match-statement-parser";
import { parseFunctionDeclaration } from "./function-declaration-parser";

export function parseStatement(context: ParserContext): GreenElement | undefined {
  switch (context.currentSyntaxKind()) {
    case SyntaxKind.LetKeyword:
      return parseLetStatement(context);
    case SyntaxKind.ReturnKeyword:
      return parseReturnStatement(context);
    case SyntaxKind.YieldKeyword:
      return parseYieldStatement(context);
    case SyntaxKind.ContinueKeyword:
      return parseContinueStatement(context);
    case SyntaxKind.LoopKeyword:
      return parseLoopStatement(context);
    case SyntaxKind.IfKeyword:
      return parseIfStatement(context);
    case SyntaxKind.WhileKeyword:
      return parseWhileStatement(context);
    case SyntaxKind.ForKeyword:
      return parseForStatement(context);
    case SyntaxKind.TakeKeyword:
      return parseTakeStatement(context);
    case SyntaxKind.MatchKeyword:
      return parseMatchStatement(context);
    case SyntaxKind.FnKeyword:
    case SyntaxKind.ConstructorKeyword:
    case SyntaxKind.TerminalKeyword:
    case SyntaxKind.PredicateKeyword:
    case SyntaxKind.PlatformKeyword:
    case SyntaxKind.PrivateKeyword:
      return parseFunctionDeclaration(context);
    default:
      if (canStartExpression(context.currentSyntaxKind())) {
        return parseExpressionOrAssignmentStatement(context);
      }
      return undefined;
  }
}
