import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { Trivia } from "../../../../src/frontend/lexer/trivia";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import {
  parseImageDeclaration,
  parseDevicesSection,
} from "../../../../src/frontend/parser/image-declaration-parser";

function makeToken(
  kind: TokenKind,
  lexeme: string,
  start: number,
  end: number,
  trailing?: string,
  leading?: string,
): Token {
  const leadingTrivia: Trivia[] = leading
    ? [
        new Trivia({
          kind: TriviaKind.Whitespace,
          lexeme: leading,
          span: SourceSpan.from(start - leading.length, start),
        }),
      ]
    : [];
  const trailingTrivia: Trivia[] = trailing
    ? [
        new Trivia({
          kind: TriviaKind.Whitespace,
          lexeme: trailing,
          span: SourceSpan.from(end, end + trailing.length),
        }),
      ]
    : [];
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia,
    trailingTrivia,
  });
}

function makeContext(tokens: Token[]): ParserContext {
  return new ParserContext({ tokens: TokenStream.from(tokens), factory: new SyntaxFactory() });
}

describe("parseImageDeclaration", () => {
  test("parses image declaration with empty body", () => {
    const tokens = [
      makeToken(TokenKind.Uefi, "uefi", 0, 4, " "),
      makeToken(TokenKind.Image, "image", 5, 10, " "),
      makeToken(TokenKind.Identifier, "PacketCounterImage", 11, 29),
      makeToken(TokenKind.Colon, ":", 29, 30),
      makeToken(TokenKind.Newline, "\n", 30, 31),
      makeToken(TokenKind.Indent, "    ", 31, 35),
      makeToken(TokenKind.Dedent, "", 35, 35),
      makeToken(TokenKind.Eof, "", 35, 35),
    ];
    const context = makeContext(tokens);
    const node = parseImageDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(node.children).toHaveLength(5);
    expect(node.children[0]!.kind).toBe(SyntaxKind.UefiKeyword);
    expect((node.children[0] as GreenToken).lexeme).toBe("uefi");
    expect(node.children[1]!.kind).toBe(SyntaxKind.ImageKeyword);
    expect((node.children[1] as GreenToken).lexeme).toBe("image");
    expect(node.children[2]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect((node.children[2] as GreenToken).lexeme).toBe("PacketCounterImage");
    expect(node.children[3]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[4] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);
    expect(block.children[0]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(block.children[1]!.kind).toBe(SyntaxKind.IndentToken);

    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);
    expect(stmtList.children).toHaveLength(0);

    expect(block.children[3]!.kind).toBe(SyntaxKind.DedentToken);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses image with field in body", () => {
    const tokens = [
      makeToken(TokenKind.Uefi, "uefi", 0, 4, " "),
      makeToken(TokenKind.Image, "image", 5, 10, " "),
      makeToken(TokenKind.Identifier, "MyImage", 11, 18),
      makeToken(TokenKind.Colon, ":", 18, 19),
      makeToken(TokenKind.Newline, "\n", 19, 20),
      makeToken(TokenKind.Indent, "    ", 20, 24),
      makeToken(TokenKind.Identifier, "vendor_id", 24, 33),
      makeToken(TokenKind.Colon, ":", 33, 34, " "),
      makeToken(TokenKind.Identifier, "u16", 35, 38),
      makeToken(TokenKind.Newline, "\n", 38, 39),
      makeToken(TokenKind.Dedent, "", 39, 39),
      makeToken(TokenKind.Eof, "", 39, 39),
    ];
    const context = makeContext(tokens);
    const node = parseImageDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(node.reconstruct()).toBe("uefi image MyImage:\n    vendor_id: u16\n");

    const block = node.children[4] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(1);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.FieldDeclaration);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("parses image with devices section", () => {
    const tokens = [
      makeToken(TokenKind.Uefi, "uefi", 0, 4, " "),
      makeToken(TokenKind.Image, "image", 5, 10, " "),
      makeToken(TokenKind.Identifier, "PciImage", 11, 19),
      makeToken(TokenKind.Colon, ":", 19, 20),
      makeToken(TokenKind.Newline, "\n", 20, 21),
      makeToken(TokenKind.Indent, "    ", 21, 25),
      makeToken(TokenKind.Devices, "devices", 25, 32),
      makeToken(TokenKind.Colon, ":", 32, 33),
      makeToken(TokenKind.Newline, "\n", 33, 34),
      makeToken(TokenKind.Indent, "        ", 34, 42),
      makeToken(TokenKind.Identifier, "vendor", 42, 48),
      makeToken(TokenKind.Colon, ":", 48, 49, " "),
      makeToken(TokenKind.Identifier, "u16", 50, 53),
      makeToken(TokenKind.Newline, "\n", 53, 54),
      makeToken(TokenKind.Identifier, "device", 62, 68, undefined, "        "),
      makeToken(TokenKind.Colon, ":", 68, 69, " "),
      makeToken(TokenKind.Identifier, "u16", 70, 73),
      makeToken(TokenKind.Newline, "\n", 73, 74),
      makeToken(TokenKind.Dedent, "", 74, 74),
      makeToken(TokenKind.Dedent, "", 74, 74),
      makeToken(TokenKind.Eof, "", 74, 74),
    ];
    const context = makeContext(tokens);
    const node = parseImageDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImageDeclaration);
    expect(node.reconstruct()).toBe(
      "uefi image PciImage:\n    devices:\n        vendor: u16\n        device: u16\n",
    );

    const block = node.children[4] as GreenNode;
    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(1);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.DevicesSection);

    const devicesSection = stmtList.children[0] as GreenNode;
    expect(devicesSection.kind).toBe(SyntaxKind.DevicesSection);
    expect(devicesSection.children).toHaveLength(3);
    expect(devicesSection.children[0]!.kind).toBe(SyntaxKind.DevicesKeyword);
    expect(devicesSection.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const devicesBlock = devicesSection.children[2] as GreenNode;
    expect(devicesBlock.kind).toBe(SyntaxKind.Block);

    const devicesStmtList = devicesBlock.children[2] as GreenNode;
    expect(devicesStmtList.kind).toBe(SyntaxKind.StatementList);
    expect(devicesStmtList.children).toHaveLength(2);
    expect(devicesStmtList.children[0]!.kind).toBe(SyntaxKind.FieldDeclaration);
    expect(devicesStmtList.children[1]!.kind).toBe(SyntaxKind.FieldDeclaration);

    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction equals source text for full image", () => {
    const source =
      "uefi image PacketCounterImage:\n    vendor_id: u16\n    device_id: u16\n    devices:\n        vendor: u16\n        device: u16\n";
    const tokens = [
      makeToken(TokenKind.Uefi, "uefi", 0, 4, " "),
      makeToken(TokenKind.Image, "image", 5, 10, " "),
      makeToken(TokenKind.Identifier, "PacketCounterImage", 11, 29),
      makeToken(TokenKind.Colon, ":", 29, 30),
      makeToken(TokenKind.Newline, "\n", 30, 31),
      makeToken(TokenKind.Indent, "    ", 31, 35),
      makeToken(TokenKind.Identifier, "vendor_id", 35, 44),
      makeToken(TokenKind.Colon, ":", 44, 45, " "),
      makeToken(TokenKind.Identifier, "u16", 46, 49),
      makeToken(TokenKind.Newline, "\n", 49, 50),
      makeToken(TokenKind.Identifier, "device_id", 54, 63, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 63, 64, " "),
      makeToken(TokenKind.Identifier, "u16", 65, 68),
      makeToken(TokenKind.Newline, "\n", 68, 69),
      makeToken(TokenKind.Devices, "devices", 73, 80, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 80, 81),
      makeToken(TokenKind.Newline, "\n", 81, 82),
      makeToken(TokenKind.Indent, "        ", 82, 90),
      makeToken(TokenKind.Identifier, "vendor", 90, 96),
      makeToken(TokenKind.Colon, ":", 96, 97, " "),
      makeToken(TokenKind.Identifier, "u16", 98, 101),
      makeToken(TokenKind.Newline, "\n", 101, 102),
      makeToken(TokenKind.Identifier, "device", 110, 116, undefined, "        "),
      makeToken(TokenKind.Colon, ":", 116, 117, " "),
      makeToken(TokenKind.Identifier, "u16", 118, 121),
      makeToken(TokenKind.Newline, "\n", 121, 122),
      makeToken(TokenKind.Dedent, "", 122, 122),
      makeToken(TokenKind.Dedent, "", 122, 122),
      makeToken(TokenKind.Eof, "", 122, 122),
    ];
    const context = makeContext(tokens);
    const node = parseImageDeclaration(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("emits diagnostic for missing colon after name", () => {
    const tokens = [
      makeToken(TokenKind.Uefi, "uefi", 0, 4, " "),
      makeToken(TokenKind.Image, "image", 5, 10, " "),
      makeToken(TokenKind.Identifier, "Foo", 11, 14),
      makeToken(TokenKind.Newline, "\n", 14, 15),
      makeToken(TokenKind.Eof, "", 15, 15),
    ];
    const context = makeContext(tokens);
    const node = parseImageDeclaration(context);

    expect(node.kind).toBe(SyntaxKind.ImageDeclaration);
    const diagnostics = context.draftDiagnostics();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

describe("parseDevicesSection", () => {
  test("parses devices section with device rows", () => {
    const tokens = [
      makeToken(TokenKind.Devices, "devices", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.Identifier, "vendor", 13, 19),
      makeToken(TokenKind.Colon, ":", 19, 20, " "),
      makeToken(TokenKind.Identifier, "u16", 21, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Identifier, "device", 29, 35, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 35, 36, " "),
      makeToken(TokenKind.Identifier, "u16", 37, 40),
      makeToken(TokenKind.Newline, "\n", 40, 41),
      makeToken(TokenKind.Dedent, "", 41, 41),
      makeToken(TokenKind.Eof, "", 41, 41),
    ];
    const context = makeContext(tokens);
    const node = parseDevicesSection(context);

    expect(node.kind).toBe(SyntaxKind.DevicesSection);
    expect(node.children[0]!.kind).toBe(SyntaxKind.DevicesKeyword);
    expect(node.children[1]!.kind).toBe(SyntaxKind.ColonToken);

    const block = node.children[2] as GreenNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    const stmtList = block.children[2] as GreenNode;
    expect(stmtList.children).toHaveLength(2);
    expect(stmtList.children[0]!.kind).toBe(SyntaxKind.FieldDeclaration);
    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.FieldDeclaration);

    expect(node.reconstruct()).toBe("devices:\n    vendor: u16\n    device: u16\n");
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("recovers from malformed device row at newline", () => {
    const tokens = [
      makeToken(TokenKind.Devices, "devices", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.IntegerLiteral, "42", 13, 15),
      makeToken(TokenKind.Newline, "\n", 15, 16),
      makeToken(TokenKind.Identifier, "vendor", 16, 22),
      makeToken(TokenKind.Colon, ":", 22, 23, " "),
      makeToken(TokenKind.Identifier, "u16", 24, 27),
      makeToken(TokenKind.Newline, "\n", 27, 28),
      makeToken(TokenKind.Dedent, "", 28, 28),
      makeToken(TokenKind.Eof, "", 28, 28),
    ];
    const context = makeContext(tokens);
    const node = parseDevicesSection(context);

    expect(node.kind).toBe(SyntaxKind.DevicesSection);

    const block = node.children[2] as GreenNode;
    const stmtList = block.children[2] as GreenNode;

    expect(stmtList.children.length).toBeGreaterThanOrEqual(3);
    const skipped = stmtList.children[0] as GreenNode;
    expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);
    expect(skipped.children[0]!.reconstruct()).toBe("42");

    expect(stmtList.children[1]!.kind).toBe(SyntaxKind.NewlineToken);
    expect(stmtList.children[2]!.kind).toBe(SyntaxKind.FieldDeclaration);
    expect(context.draftDiagnostics().length).toBeGreaterThan(0);
  });

  test("empty devices section", () => {
    const tokens = [
      makeToken(TokenKind.Devices, "devices", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.Dedent, "", 13, 13),
      makeToken(TokenKind.Eof, "", 13, 13),
    ];
    const context = makeContext(tokens);
    const node = parseDevicesSection(context);

    expect(node.kind).toBe(SyntaxKind.DevicesSection);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });

  test("reconstruction exactness for devices section", () => {
    const source = "devices:\n    vendor: u16\n    device: u16\n";
    const tokens = [
      makeToken(TokenKind.Devices, "devices", 0, 7),
      makeToken(TokenKind.Colon, ":", 7, 8),
      makeToken(TokenKind.Newline, "\n", 8, 9),
      makeToken(TokenKind.Indent, "    ", 9, 13),
      makeToken(TokenKind.Identifier, "vendor", 13, 19),
      makeToken(TokenKind.Colon, ":", 19, 20, " "),
      makeToken(TokenKind.Identifier, "u16", 21, 24),
      makeToken(TokenKind.Newline, "\n", 24, 25),
      makeToken(TokenKind.Identifier, "device", 29, 35, undefined, "    "),
      makeToken(TokenKind.Colon, ":", 35, 36, " "),
      makeToken(TokenKind.Identifier, "u16", 37, 40),
      makeToken(TokenKind.Newline, "\n", 40, 41),
      makeToken(TokenKind.Dedent, "", 41, 41),
      makeToken(TokenKind.Eof, "", 41, 41),
    ];
    const context = makeContext(tokens);
    const node = parseDevicesSection(context);

    expect(node.reconstruct()).toBe(source);
    expect(context.draftDiagnostics()).toHaveLength(0);
  });
});
