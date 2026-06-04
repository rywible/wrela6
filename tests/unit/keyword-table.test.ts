import { describe, expect, test } from "bun:test";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { TokenKind } from "../../src/lexer/token-kind";

describe("KeywordTable", () => {
  describe("default table maps all language keywords", () => {
    const keywords = KeywordTable.default();

    test("module keywords", () => {
      expect(keywords.lookup("use")).toBe(TokenKind.Use);
      expect(keywords.lookup("from")).toBe(TokenKind.From);
      expect(keywords.lookup("uefi")).toBe(TokenKind.Uefi);
      expect(keywords.lookup("image")).toBe(TokenKind.Image);
      expect(keywords.lookup("devices")).toBe(TokenKind.Devices);
      expect(keywords.lookup("unique")).toBe(TokenKind.Unique);
      expect(keywords.lookup("edge")).toBe(TokenKind.Edge);
    });

    test("type declaration keywords", () => {
      expect(keywords.lookup("class")).toBe(TokenKind.Class);
      expect(keywords.lookup("dataclass")).toBe(TokenKind.Dataclass);
      expect(keywords.lookup("validated")).toBe(TokenKind.Validated);
      expect(keywords.lookup("buffer")).toBe(TokenKind.Buffer);
      expect(keywords.lookup("stream")).toBe(TokenKind.Stream);
      expect(keywords.lookup("contains")).toBe(TokenKind.Contains);
      expect(keywords.lookup("bound")).toBe(TokenKind.Bound);
      expect(keywords.lookup("enum")).toBe(TokenKind.Enum);
      expect(keywords.lookup("interface")).toBe(TokenKind.Interface);
    });

    test("member and function keywords", () => {
      expect(keywords.lookup("constructor")).toBe(TokenKind.Constructor);
      expect(keywords.lookup("fn")).toBe(TokenKind.Fn);
      expect(keywords.lookup("private")).toBe(TokenKind.Private);
      expect(keywords.lookup("platform")).toBe(TokenKind.Platform);
      expect(keywords.lookup("terminal")).toBe(TokenKind.Terminal);
      expect(keywords.lookup("predicate")).toBe(TokenKind.Predicate);
      expect(keywords.lookup("requires")).toBe(TokenKind.Requires);
      expect(keywords.lookup("consume")).toBe(TokenKind.Consume);
    });

    test("layout and derivation keywords", () => {
      expect(keywords.lookup("params")).toBe(TokenKind.Params);
      expect(keywords.lookup("layout")).toBe(TokenKind.Layout);
      expect(keywords.lookup("derive")).toBe(TokenKind.Derive);
      expect(keywords.lookup("require")).toBe(TokenKind.Require);
      expect(keywords.lookup("at")).toBe(TokenKind.At);
      expect(keywords.lookup("len")).toBe(TokenKind.Len);
    });

    test("control flow keywords", () => {
      expect(keywords.lookup("else")).toBe(TokenKind.Else);
      expect(keywords.lookup("otherwise")).toBe(TokenKind.Otherwise);
    });

    test("expression and binding keywords", () => {
      expect(keywords.lookup("let")).toBe(TokenKind.Let);
      expect(keywords.lookup("if")).toBe(TokenKind.If);
      expect(keywords.lookup("not")).toBe(TokenKind.Not);
      expect(keywords.lookup("while")).toBe(TokenKind.While);
      expect(keywords.lookup("for")).toBe(TokenKind.For);
      expect(keywords.lookup("in")).toBe(TokenKind.In);
      expect(keywords.lookup("loop")).toBe(TokenKind.Loop);
    });

    test("pattern matching and return keywords", () => {
      expect(keywords.lookup("match")).toBe(TokenKind.Match);
      expect(keywords.lookup("case")).toBe(TokenKind.Case);
      expect(keywords.lookup("return")).toBe(TokenKind.Return);
      expect(keywords.lookup("yield")).toBe(TokenKind.Yield);
      expect(keywords.lookup("continue")).toBe(TokenKind.Continue);
      expect(keywords.lookup("take")).toBe(TokenKind.Take);
      expect(keywords.lookup("as")).toBe(TokenKind.As);
      expect(keywords.lookup("with")).toBe(TokenKind.With);
    });
  });

  describe("type names are not keywords", () => {
    const keywords = KeywordTable.default();

    test.each([
      "Ok",
      "Err",
      "Some",
      "None",
      "Result",
      "Option",
      "Never",
      "List",
      "Map",
      "MoveRing",
    ])("%s is not a keyword", (typeName) => {
      expect(keywords.lookup(typeName)).toBe(TokenKind.Identifier);
    });
  });

  describe("unknown identifiers", () => {
    const keywords = KeywordTable.default();

    test("returns Identifier for unknown lexemes", () => {
      expect(keywords.lookup("foo")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("myVariable")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("underscore_name")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("")).toBe(TokenKind.Identifier);
    });
  });

  describe("case sensitivity", () => {
    const keywords = KeywordTable.default();

    test("capitalized versions of keywords are not keywords", () => {
      expect(keywords.lookup("Image")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("Class")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("Use")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("Let")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("If")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("Match")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("Return")).toBe(TokenKind.Identifier);
    });

    test("uppercase versions of keywords are not keywords", () => {
      expect(keywords.lookup("IMAGE")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("CLASS")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("USE")).toBe(TokenKind.Identifier);
    });
  });

  describe("from factory", () => {
    test("creates a table from custom entries", () => {
      const keywords = KeywordTable.from([
        ["class", TokenKind.Class],
        ["image", TokenKind.Image],
      ]);

      expect(keywords.lookup("class")).toBe(TokenKind.Class);
      expect(keywords.lookup("image")).toBe(TokenKind.Image);
      expect(keywords.lookup("use")).toBe(TokenKind.Identifier);
    });

    test("empty table returns Identifier for everything", () => {
      const keywords = KeywordTable.from([]);

      expect(keywords.lookup("class")).toBe(TokenKind.Identifier);
      expect(keywords.lookup("image")).toBe(TokenKind.Identifier);
    });

    test("does not include default keywords", () => {
      const keywords = KeywordTable.from([["class", TokenKind.Class]]);

      expect(keywords.lookup("image")).toBe(TokenKind.Identifier);
    });
  });
});
