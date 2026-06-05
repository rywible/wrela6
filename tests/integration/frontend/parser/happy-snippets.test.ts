import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { kindsInTree } from "../../../support/frontend/syntax-tree-queries";
import { expectValidSyntaxTree } from "../../../support/frontend/syntax-invariants";

const SNIPPETS = [
  {
    name: "imports-and-enums",
    source: [
      "use Logger from core.log",
      "",
      "enum PacketError:",
      "    TooShort",
      "    InvalidCrc",
      "",
    ].join("\n"),
    kinds: [SyntaxKind.ImportDeclaration, SyntaxKind.EnumDeclaration, SyntaxKind.EnumCase],
  },
  {
    name: "class-and-functions",
    source: [
      "dataclass PacketLimits:",
      "    max_frame_bytes: usize",
      "",
      "class RxBatch:",
      "    packets: u64",
      "",
      "interface Runnable:",
      "    fn run(self)",
      "",
      "fn process(packet: u8) -> bool:",
      "    if packet > 0:",
      "        return true",
      "    return false",
      "",
    ].join("\n"),
    kinds: [
      SyntaxKind.DataclassDeclaration,
      SyntaxKind.ClassDeclaration,
      SyntaxKind.InterfaceDeclaration,
      SyntaxKind.FunctionDeclaration,
    ],
  },
  {
    name: "edge-stream-and-generics",
    source: [
      "edge class NetworkRx:",
      "    loop:",
      "        return",
      "",
      "stream RxBatch contains ReadableBuffer bound 64:",
      "",
      "interface Runnable:",
      "    fn run(self) -> Option[Never]",
      "",
      "class MoveRing[T: CoreMovableOwned]:",
      "    items: T",
      "",
    ].join("\n"),
    kinds: [
      SyntaxKind.EdgeClassDeclaration,
      SyntaxKind.StreamDeclaration,
      SyntaxKind.TypeParameterList,
      SyntaxKind.TypeArgumentList,
    ],
  },
  {
    name: "validated-buffer-sections",
    source: [
      "validated buffer Packet:",
      "    params:",
      "        kind: U8",
      "    layout:",
      "        kind: U8 @ 0",
      "    derive:",
      "        checksum: U16 from 0:",
      "            0 => PacketKind.ping",
      "            otherwise => 1",
      "    require:",
      "        x < 10",
      "        y > 0 else 0",
    ].join("\n"),
    kinds: [
      SyntaxKind.ValidatedBufferDeclaration,
      SyntaxKind.ParamsSection,
      SyntaxKind.LayoutSection,
      SyntaxKind.DeriveSection,
      SyntaxKind.RequireSection,
    ],
  },
  {
    name: "image-devices-and-boot",
    source: [
      "uefi image PacketCounterImage:",
      "    devices:",
      "        net0: NetworkDevice",
      "",
      "fn boot():",
      "    loop:",
      "        return",
      "",
    ].join("\n"),
    kinds: [
      SyntaxKind.ImageDeclaration,
      SyntaxKind.DevicesSection,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.LoopStatement,
    ],
  },
  {
    name: "control-flow-match",
    source: [
      "fn handle(self):",
      "    match x:",
      "        case a:",
      "            return",
      "        case b:",
      "            return",
      "",
      "fn process(self):",
      "    for item in items:",
      "        take item:",
      "            return",
      "",
    ].join("\n"),
    kinds: [
      SyntaxKind.MatchStatement,
      SyntaxKind.MatchCase,
      SyntaxKind.TakeStatement,
      SyntaxKind.ForStatement,
    ],
  },
];

describe("parser happy snippets", () => {
  for (const snippet of SNIPPETS) {
    test(snippet.name, () => {
      const diagnostics = new CollectingDiagnosticSink();
      const lexer = new Lexer({
        keywords: KeywordTable.default(),
        diagnostics,
      });
      const parser = new Parser();
      const source = SourceText.from("test.wr", snippet.source);
      const lexResult = lexer.lex(source);
      const result = parser.parseLexResult({
        lexResult,
        lexerDiagnostics: diagnostics.diagnostics,
      });

      expectValidSyntaxTree({
        source,
        tree: result.tree,
        allowDiagnostics: false,
      });

      const kinds = kindsInTree(result.tree);
      for (const kind of snippet.kinds) {
        expect(kinds).toContain(kind);
      }

      expect(result.tree.reconstruct()).toBe(source.text);
    });
  }
});
