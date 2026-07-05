import type { Token } from "../lexer/token";
import { GreenTrivia } from "./green-trivia";
import { SyntaxKind } from "./syntax-kind";
import { syntaxKindFromTokenKind } from "./syntax-kind-map";

const INTERNABLE_TOKEN_SYNTAX_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.UseKeyword,
  SyntaxKind.FromKeyword,
  SyntaxKind.UefiKeyword,
  SyntaxKind.ImageKeyword,
  SyntaxKind.DevicesKeyword,
  SyntaxKind.UniqueKeyword,
  SyntaxKind.EdgeKeyword,
  SyntaxKind.ClassKeyword,
  SyntaxKind.DataclassKeyword,
  SyntaxKind.ValidatedKeyword,
  SyntaxKind.BufferKeyword,
  SyntaxKind.StreamKeyword,
  SyntaxKind.ContainsKeyword,
  SyntaxKind.BoundKeyword,
  SyntaxKind.EnumKeyword,
  SyntaxKind.InterfaceKeyword,
  SyntaxKind.ConstructorKeyword,
  SyntaxKind.FnKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.PlatformKeyword,
  SyntaxKind.TerminalKeyword,
  SyntaxKind.PredicateKeyword,
  SyntaxKind.RequiresKeyword,
  SyntaxKind.ConsumeKeyword,
  SyntaxKind.ParamsKeyword,
  SyntaxKind.LayoutKeyword,
  SyntaxKind.DeriveKeyword,
  SyntaxKind.RequireKeyword,
  SyntaxKind.AtKeyword,
  SyntaxKind.LenKeyword,
  SyntaxKind.LeMarkerToken,
  SyntaxKind.BeMarkerToken,
  SyntaxKind.ElseKeyword,
  SyntaxKind.OtherwiseKeyword,
  SyntaxKind.LetKeyword,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.IfKeyword,
  SyntaxKind.NotKeyword,
  SyntaxKind.AndKeyword,
  SyntaxKind.OrKeyword,
  SyntaxKind.WhileKeyword,
  SyntaxKind.ForKeyword,
  SyntaxKind.InKeyword,
  SyntaxKind.LoopKeyword,
  SyntaxKind.MatchKeyword,
  SyntaxKind.CaseKeyword,
  SyntaxKind.ReturnKeyword,
  SyntaxKind.YieldKeyword,
  SyntaxKind.ContinueKeyword,
  SyntaxKind.BreakKeyword,
  SyntaxKind.EnsureKeyword,
  SyntaxKind.TakeKeyword,
  SyntaxKind.AsKeyword,
  SyntaxKind.WithKeyword,
  SyntaxKind.LeftParenToken,
  SyntaxKind.RightParenToken,
  SyntaxKind.LeftBraceToken,
  SyntaxKind.RightBraceToken,
  SyntaxKind.LeftBracketToken,
  SyntaxKind.RightBracketToken,
  SyntaxKind.ColonToken,
  SyntaxKind.CommaToken,
  SyntaxKind.DotToken,
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.StarToken,
  SyntaxKind.SlashToken,
  SyntaxKind.PercentToken,
  SyntaxKind.AmpersandToken,
  SyntaxKind.PipeToken,
  SyntaxKind.CaretToken,
  SyntaxKind.TildeToken,
  SyntaxKind.LeftShiftToken,
  SyntaxKind.RightShiftToken,
  SyntaxKind.LessToken,
  SyntaxKind.GreaterToken,
  SyntaxKind.QuestionToken,
  SyntaxKind.ArrowToken,
  SyntaxKind.FatArrowToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.BangEqualsToken,
  SyntaxKind.LessEqualsToken,
  SyntaxKind.GreaterEqualsToken,
]);

const INTERNED_FIXED_TOKENS = new Map<string, GreenToken>();

function fixedTokenCacheKey(kind: SyntaxKind, lexeme: string): string {
  return `${kind}\u0000${lexeme}`;
}

export class GreenToken {
  readonly kind: SyntaxKind;
  readonly lexeme: string;
  readonly width: number;
  readonly leadingTrivia: readonly GreenTrivia[];
  readonly trailingTrivia: readonly GreenTrivia[];
  readonly isMissing: boolean;
  readonly cookedValue: string | undefined;

  constructor(
    kind: SyntaxKind,
    lexeme: string,
    leadingTrivia: GreenTrivia[],
    trailingTrivia: GreenTrivia[],
    isMissing: boolean,
    cookedValue?: string,
  ) {
    this.kind = kind;
    this.lexeme = lexeme;
    let totalWidth = lexeme.length;
    for (const trivia of leadingTrivia) totalWidth += trivia.width;
    for (const trivia of trailingTrivia) totalWidth += trivia.width;
    this.width = totalWidth;
    this.leadingTrivia = [...leadingTrivia];
    this.trailingTrivia = [...trailingTrivia];
    this.isMissing = isMissing;
    this.cookedValue = cookedValue;
    Object.freeze(this);
  }

  static fromToken(token: Token): GreenToken {
    const kind = syntaxKindFromTokenKind(token.kind);
    if (
      token.leadingTrivia.length === 0 &&
      token.trailingTrivia.length === 0 &&
      token.cookedValue === undefined &&
      INTERNABLE_TOKEN_SYNTAX_KINDS.has(kind)
    ) {
      const cacheKey = fixedTokenCacheKey(kind, token.lexeme);
      const cachedToken = INTERNED_FIXED_TOKENS.get(cacheKey);
      if (cachedToken !== undefined) return cachedToken;

      const greenToken = new GreenToken(kind, token.lexeme, [], [], false);
      INTERNED_FIXED_TOKENS.set(cacheKey, greenToken);
      return greenToken;
    }

    const leadingTrivia = token.leadingTrivia.map(
      (trivia) => new GreenTrivia(trivia.kind, trivia.lexeme),
    );
    const trailingTrivia = token.trailingTrivia.map(
      (trivia) => new GreenTrivia(trivia.kind, trivia.lexeme),
    );
    return new GreenToken(
      kind,
      token.lexeme,
      leadingTrivia,
      trailingTrivia,
      false,
      token.cookedValue,
    );
  }

  static missing(expectedKind: SyntaxKind): GreenToken {
    return new GreenToken(expectedKind, "", [], [], true);
  }

  reconstruct(): string {
    const leadingText = this.leadingTrivia.map((trivia) => trivia.reconstruct()).join("");
    const trailingText = this.trailingTrivia.map((trivia) => trivia.reconstruct()).join("");
    return leadingText + this.lexeme + trailingText;
  }
}
