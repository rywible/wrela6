import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseModuleGraph } from "../../src/frontend/module-graph-parser";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
} from "../../src/frontend/lexer";
import * as frontend from "../../src/frontend";
import * as hir from "../../src/hir";
import * as peCoff from "../../src/pe-coff";
import * as uefiAarch64 from "../../src/target/uefi-aarch64";
import { parsePeCoffImage } from "../../src/pe-coff";
import { validatePatchObligationAction } from "../../src/proof-check/kernel/patch-permission-policy";
import { serializedImageBytesForParserTest } from "../support/pe-coff/pe-coff-fixtures";

const optionalHeaderOffset = 0x80 + 4 + 20;
const sectionTableOffset = optionalHeaderOffset + 240;

describe("safety-critical negative corpus", () => {
  test("unsupported index syntax and invalid index usage do not pass silently", () => {
    const diagnostics = parseDiagnostics("fn boot():\n    let first = packet[]\n");

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["PARSE_EXPECTED_EXPRESSION"]),
    );
  });

  test("HIR lowering source stays free of neutral fallback regressions", async () => {
    const hirSources = await Promise.all([
      readFile("src/hir/expression-lowerer.ts", "utf8"),
      readFile("src/hir/lowering-context.ts", "utf8"),
      readFile("src/hir/statement-lowerer.ts", "utf8"),
    ]);
    const combinedSource = hirSources.join("\n");

    expect(combinedSource).not.toContain("?? 0n");
    expect(combinedSource).not.toContain('?? ""');
    expect(combinedSource).not.toContain("ownerFunctionId ?? 0");
    expect(combinedSource).not.toContain("0 as never");
  });

  test("proof companion patch cannot close an unrelated stream obligation", () => {
    const violation = validatePatchObligationAction("streamLoop", "close", "member:other", {
      namedYieldedMemberKey: "member:yielded",
    });

    expect(violation?.stableDetail).toBe(
      "patch-kind:streamLoop:obligation:member:other:not-named-member",
    );
  });

  test("strict PE/COFF validation rejects malformed section flags and directories", () => {
    expect(
      stableDetails(
        patchedU32Le(serializedImageBytesForParserTest(), sectionTableOffset + 36, 0x40000040),
      ),
    ).toContain("section-flags:text-not-executable:.text");
    expect(
      stableDetails(
        patchedU32Le(serializedImageBytesForParserTest(), optionalHeaderOffset + 108, 15),
      ),
    ).toContain("optional-header:directory-count:15");
  });

  test("public package API does not expose selected implementation internals", () => {
    expect("createExpressionLowerer" in hir).toBe(false);
    expect("ParserContext" in frontend).toBe(false);
    expect("serializePlannedPeCoffImage" in peCoff).toBe(true);
    expect("runUefiAArch64PackagePipelineToOptIr" in uefiAarch64).toBe(true);
    expect("packageInputFromFixtureProject" in uefiAarch64).toBe(true);
  });
});

function parseDiagnostics(text: string) {
  const source = SourceText.from("safety-negative.wr", text);
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const lexResult = lexer.lex(source);
  const parseResult = parseModuleGraph({
    graph: {
      entry: ModulePath.from("safety-negative.wr"),
      modules: [
        {
          path: ModulePath.from("safety-negative.wr"),
          source,
          tokens: lexResult.tokens,
          imports: [],
        },
      ],
    },
    lexerDiagnostics: diagnostics.diagnostics,
  });
  return parseResult.diagnostics;
}

function stableDetails(bytes: ArrayLike<number>): readonly string[] {
  const result = parsePeCoffImage(bytes);
  expect(result.kind).toBe("error");
  return result.kind === "error"
    ? result.diagnostics.map((diagnostic) => diagnostic.stableDetail)
    : [];
}

function patchedU32Le(source: ArrayLike<number>, offset: number, value: number): readonly number[] {
  const result = Array.from(source);
  result[offset] = value & 0xff;
  result[offset + 1] = (value >> 8) & 0xff;
  result[offset + 2] = (value >> 16) & 0xff;
  result[offset + 3] = Math.floor(value / 2 ** 24) & 0xff;
  return result;
}
