import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenToken } from "../syntax/green-token";

export const topLevelStarterKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.UseKeyword,
  SyntaxKind.EnumKeyword,
  SyntaxKind.DataclassKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.UniqueKeyword,
  SyntaxKind.EdgeKeyword,
  SyntaxKind.ClassKeyword,
  SyntaxKind.InterfaceKeyword,
  SyntaxKind.StreamKeyword,
  SyntaxKind.ValidatedKeyword,
  SyntaxKind.UefiKeyword,
  SyntaxKind.FnKeyword,
  SyntaxKind.NewlineToken,
  SyntaxKind.EndOfFileToken,
]);

export const blockItemRecoveryKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

export const expressionStopKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.IndentToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
  SyntaxKind.CommaToken,
  SyntaxKind.RightParenToken,
  SyntaxKind.RightBracketToken,
  SyntaxKind.RightBraceToken,
  SyntaxKind.ColonToken,
]);

export const validatedBufferSectionStarterKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.ParamsKeyword,
  SyntaxKind.LayoutKeyword,
  SyntaxKind.DeriveKeyword,
  SyntaxKind.RequireKeyword,
]);

export const matchCaseBoundaryKinds: Set<SyntaxKind> = new Set([
  SyntaxKind.CaseKeyword,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

export function recoverUntil(
  context: ParserContext,
  syncKinds: ReadonlySet<SyntaxKind>,
): GreenToken[] {
  return context.skipUntil(syncKinds);
}
