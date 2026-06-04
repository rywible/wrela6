import { TokenKind } from "./token-kind";

export class KeywordTable {
  private readonly table: ReadonlyMap<string, TokenKind>;

  private constructor(table: ReadonlyMap<string, TokenKind>) {
    this.table = table;
  }

  static default(): KeywordTable {
    return new KeywordTable(DEFAULT_KEYWORD_MAP);
  }

  static from(entries: readonly (readonly [string, TokenKind])[]): KeywordTable {
    return new KeywordTable(new Map(entries));
  }

  lookup(lexeme: string): TokenKind {
    return this.table.get(lexeme) ?? TokenKind.Identifier;
  }
}

const DEFAULT_KEYWORD_MAP: ReadonlyMap<string, TokenKind> = new Map([
  ["use", TokenKind.Use],
  ["from", TokenKind.From],
  ["uefi", TokenKind.Uefi],
  ["image", TokenKind.Image],
  ["devices", TokenKind.Devices],
  ["unique", TokenKind.Unique],
  ["edge", TokenKind.Edge],
  ["class", TokenKind.Class],
  ["dataclass", TokenKind.Dataclass],
  ["validated", TokenKind.Validated],
  ["buffer", TokenKind.Buffer],
  ["stream", TokenKind.Stream],
  ["contains", TokenKind.Contains],
  ["bound", TokenKind.Bound],
  ["enum", TokenKind.Enum],
  ["interface", TokenKind.Interface],
  ["constructor", TokenKind.Constructor],
  ["fn", TokenKind.Fn],
  ["private", TokenKind.Private],
  ["platform", TokenKind.Platform],
  ["terminal", TokenKind.Terminal],
  ["predicate", TokenKind.Predicate],
  ["requires", TokenKind.Requires],
  ["consume", TokenKind.Consume],
  ["params", TokenKind.Params],
  ["layout", TokenKind.Layout],
  ["derive", TokenKind.Derive],
  ["require", TokenKind.Require],
  ["at", TokenKind.At],
  ["len", TokenKind.Len],
  ["else", TokenKind.Else],
  ["otherwise", TokenKind.Otherwise],
  ["let", TokenKind.Let],
  ["if", TokenKind.If],
  ["not", TokenKind.Not],
  ["while", TokenKind.While],
  ["for", TokenKind.For],
  ["in", TokenKind.In],
  ["loop", TokenKind.Loop],
  ["match", TokenKind.Match],
  ["case", TokenKind.Case],
  ["return", TokenKind.Return],
  ["yield", TokenKind.Yield],
  ["take", TokenKind.Take],
  ["as", TokenKind.As],
  ["with", TokenKind.With],
]);
