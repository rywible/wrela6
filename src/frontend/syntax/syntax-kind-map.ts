import { TokenKind } from "../lexer/token-kind";
import { SyntaxKind } from "./syntax-kind";

const TOKEN_KIND_TO_SYNTAX_KIND = {
  [TokenKind.Identifier]: SyntaxKind.IdentifierToken,
  [TokenKind.IntegerLiteral]: SyntaxKind.IntegerLiteralToken,
  [TokenKind.StringLiteral]: SyntaxKind.StringLiteralToken,
  [TokenKind.Invalid]: SyntaxKind.InvalidToken,
  [TokenKind.Use]: SyntaxKind.UseKeyword,
  [TokenKind.From]: SyntaxKind.FromKeyword,
  [TokenKind.Uefi]: SyntaxKind.UefiKeyword,
  [TokenKind.Image]: SyntaxKind.ImageKeyword,
  [TokenKind.Devices]: SyntaxKind.DevicesKeyword,
  [TokenKind.Unique]: SyntaxKind.UniqueKeyword,
  [TokenKind.Edge]: SyntaxKind.EdgeKeyword,
  [TokenKind.Class]: SyntaxKind.ClassKeyword,
  [TokenKind.Dataclass]: SyntaxKind.DataclassKeyword,
  [TokenKind.Validated]: SyntaxKind.ValidatedKeyword,
  [TokenKind.Buffer]: SyntaxKind.BufferKeyword,
  [TokenKind.Stream]: SyntaxKind.StreamKeyword,
  [TokenKind.Contains]: SyntaxKind.ContainsKeyword,
  [TokenKind.Bound]: SyntaxKind.BoundKeyword,
  [TokenKind.Enum]: SyntaxKind.EnumKeyword,
  [TokenKind.Interface]: SyntaxKind.InterfaceKeyword,
  [TokenKind.Constructor]: SyntaxKind.ConstructorKeyword,
  [TokenKind.Fn]: SyntaxKind.FnKeyword,
  [TokenKind.Private]: SyntaxKind.PrivateKeyword,
  [TokenKind.Platform]: SyntaxKind.PlatformKeyword,
  [TokenKind.Terminal]: SyntaxKind.TerminalKeyword,
  [TokenKind.Predicate]: SyntaxKind.PredicateKeyword,
  [TokenKind.Requires]: SyntaxKind.RequiresKeyword,
  [TokenKind.Consume]: SyntaxKind.ConsumeKeyword,
  [TokenKind.Params]: SyntaxKind.ParamsKeyword,
  [TokenKind.Layout]: SyntaxKind.LayoutKeyword,
  [TokenKind.Derive]: SyntaxKind.DeriveKeyword,
  [TokenKind.Require]: SyntaxKind.RequireKeyword,
  [TokenKind.At]: SyntaxKind.AtKeyword,
  [TokenKind.Len]: SyntaxKind.LenKeyword,
  [TokenKind.Else]: SyntaxKind.ElseKeyword,
  [TokenKind.Otherwise]: SyntaxKind.OtherwiseKeyword,
  [TokenKind.Let]: SyntaxKind.LetKeyword,
  [TokenKind.If]: SyntaxKind.IfKeyword,
  [TokenKind.Not]: SyntaxKind.NotKeyword,
  [TokenKind.While]: SyntaxKind.WhileKeyword,
  [TokenKind.For]: SyntaxKind.ForKeyword,
  [TokenKind.In]: SyntaxKind.InKeyword,
  [TokenKind.Loop]: SyntaxKind.LoopKeyword,
  [TokenKind.Match]: SyntaxKind.MatchKeyword,
  [TokenKind.Case]: SyntaxKind.CaseKeyword,
  [TokenKind.Return]: SyntaxKind.ReturnKeyword,
  [TokenKind.Yield]: SyntaxKind.YieldKeyword,
  [TokenKind.Continue]: SyntaxKind.ContinueKeyword,
  [TokenKind.Take]: SyntaxKind.TakeKeyword,
  [TokenKind.As]: SyntaxKind.AsKeyword,
  [TokenKind.With]: SyntaxKind.WithKeyword,
  [TokenKind.LeftParen]: SyntaxKind.LeftParenToken,
  [TokenKind.RightParen]: SyntaxKind.RightParenToken,
  [TokenKind.LeftBrace]: SyntaxKind.LeftBraceToken,
  [TokenKind.RightBrace]: SyntaxKind.RightBraceToken,
  [TokenKind.LeftBracket]: SyntaxKind.LeftBracketToken,
  [TokenKind.RightBracket]: SyntaxKind.RightBracketToken,
  [TokenKind.Colon]: SyntaxKind.ColonToken,
  [TokenKind.Comma]: SyntaxKind.CommaToken,
  [TokenKind.Dot]: SyntaxKind.DotToken,
  [TokenKind.Equals]: SyntaxKind.EqualsToken,
  [TokenKind.Plus]: SyntaxKind.PlusToken,
  [TokenKind.Minus]: SyntaxKind.MinusToken,
  [TokenKind.Star]: SyntaxKind.StarToken,
  [TokenKind.Slash]: SyntaxKind.SlashToken,
  [TokenKind.Percent]: SyntaxKind.PercentToken,
  [TokenKind.Less]: SyntaxKind.LessToken,
  [TokenKind.Greater]: SyntaxKind.GreaterToken,
  [TokenKind.Question]: SyntaxKind.QuestionToken,
  [TokenKind.Arrow]: SyntaxKind.ArrowToken,
  [TokenKind.FatArrow]: SyntaxKind.FatArrowToken,
  [TokenKind.EqualsEquals]: SyntaxKind.EqualsEqualsToken,
  [TokenKind.BangEquals]: SyntaxKind.BangEqualsToken,
  [TokenKind.LessEquals]: SyntaxKind.LessEqualsToken,
  [TokenKind.GreaterEquals]: SyntaxKind.GreaterEqualsToken,
  [TokenKind.Newline]: SyntaxKind.NewlineToken,
  [TokenKind.Indent]: SyntaxKind.IndentToken,
  [TokenKind.Dedent]: SyntaxKind.DedentToken,
  [TokenKind.Eof]: SyntaxKind.EndOfFileToken,
} satisfies Record<TokenKind, SyntaxKind>;

export function syntaxKindFromTokenKind(kind: TokenKind): SyntaxKind {
  return TOKEN_KIND_TO_SYNTAX_KIND[kind];
}

const TOKEN_SYNTAX_KINDS: Set<SyntaxKind> = new Set(Object.values(TOKEN_KIND_TO_SYNTAX_KIND));

export function isTokenSyntaxKind(kind: SyntaxKind): boolean {
  return TOKEN_SYNTAX_KINDS.has(kind);
}

export function isNodeSyntaxKind(kind: SyntaxKind): boolean {
  return !isTokenSyntaxKind(kind);
}
