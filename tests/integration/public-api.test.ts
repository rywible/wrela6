import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
  SourceSpan,
  Token,
  TokenKind,
  TokenStream,
  Trivia,
  TriviaKind,
} from "../../src/frontend/lexer";
import { compileUefiAArch64Image, loadFrontendModuleGraph } from "../../src";
import { lowerTypedHir } from "../../src/hir";
import * as linker from "../../src/linker";
import * as peCoff from "../../src/pe-coff";
import * as proofMir from "../../src/proof-mir";
import * as uefiAarch64 from "../../src/target/uefi-aarch64";

describe("lexer public api", () => {
  test("lexes through the public barrel", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    const result = lexer.lex(SourceText.from("main.wr", "uefi image Main:\n"));

    expect(result.tokens.kinds()[0]).toBe(TokenKind.Uefi);
  });

  test("exports all expected public symbols", () => {
    expect(CollectingDiagnosticSink).toBeDefined();
    expect(DottedModuleResolver).toBeDefined();
    expect(KeywordTable).toBeDefined();
    expect(Lexer).toBeDefined();
    expect(ModulePath).toBeDefined();
    expect(SourceText).toBeDefined();
    expect(SourceSpan).toBeDefined();
    expect(Token).toBeDefined();
    expect(TokenKind).toBeDefined();
    expect(TokenStream).toBeDefined();
    expect(Trivia).toBeDefined();
    expect(TriviaKind).toBeDefined();
    expect(typeof loadFrontendModuleGraph).toBe("function");
    expect(typeof lowerTypedHir).toBe("function");
    expect(typeof linker.linkAArch64Image).toBe("function");
    expect(typeof linker.authenticateAArch64LinkerTargetSurface).toBe("function");
    expect(typeof peCoff.writeAArch64PeCoffEfiImage).toBe("function");
    expect(typeof peCoff.createPeCoffEfiFileSink).toBe("function");
    expect(typeof uefiAarch64.uefiAArch64TargetDiagnostic).toBe("function");
    expect(typeof compileUefiAArch64Image).toBe("function");
    expect(typeof uefiAarch64.compileUefiAArch64Image).toBe("function");
  });
});

describe("linker public api", () => {
  test("exports the AArch64 linker from the linker barrel", () => {
    expect(typeof linker.linkAArch64Image).toBe("function");
    expect(typeof linker.createAArch64LinkedImageLayout).toBe("function");
    expect(typeof linker.createAArch64UefiEntrySyntheticObjectProvider).toBe("function");
    expect(typeof linker.createAArch64UnwindSyntheticObjectProvider).toBe("function");
    expect(typeof linker.authenticateAArch64LinkerTargetSurface).toBe("function");
  });
});

describe("proof-mir public api", () => {
  test("exports proof-mir subpath with builder and diagnostics", () => {
    expect(typeof proofMir.buildProofMir).toBe("function");
    expect(typeof proofMir.proofMirDiagnostic).toBe("function");
    expect(typeof proofMir.proofMirDiagnosticCode).toBe("function");
    expect(typeof proofMir.sortProofMirDiagnostics).toBe("function");
    expect(typeof proofMir.proofMirBlockId).toBe("function");
  });
});
