import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  KeywordTable,
  Lexer,
  ModuleGraphLexer,
  ModulePath,
  SourceText,
  SourceSpan,
  Token,
  TokenKind,
  TokenStream,
  Trivia,
  TriviaKind,
} from "../../src/frontend/lexer";
import * as wrela from "../../src";

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
    expect(ModuleGraphLexer).toBeDefined();
    expect(ModulePath).toBeDefined();
    expect(SourceText).toBeDefined();
    expect(SourceSpan).toBeDefined();
    expect(Token).toBeDefined();
    expect(TokenKind).toBeDefined();
    expect(TokenStream).toBeDefined();
    expect(Trivia).toBeDefined();
    expect(TriviaKind).toBeDefined();
    expect(wrela.hir).toBeDefined();
    expect(typeof wrela.hir.lowerTypedHir).toBe("function");
    expect(wrela.linker).toBeDefined();
    expect(typeof wrela.linkAArch64Image).toBe("function");
    expect(typeof wrela.linker.linkAArch64Image).toBe("function");
    expect(typeof wrela.linker.authenticateAArch64LinkerTargetSurface).toBe("function");
    expect(wrela.peCoff).toBeDefined();
    expect(typeof wrela.writeAArch64PeCoffEfiImage).toBe("function");
    expect(typeof wrela.authenticateAArch64PeCoffEfiWriterTargetSurface).toBe("function");
    expect(typeof wrela.peCoff.writeAArch64PeCoffEfiImage).toBe("function");
    expect(typeof wrela.peCoff.createPeCoffEfiFileSink).toBe("function");
    expect(wrela.target.uefiAarch64).toBeDefined();
    expect(typeof wrela.target.uefiAarch64.uefiAArch64TargetDiagnostic).toBe("function");
    expect(typeof wrela.compileUefiAArch64Image).toBe("function");
    expect(typeof wrela.target.uefiAarch64.compileUefiAArch64Image).toBe("function");
  });
});

describe("linker public api", () => {
  test("exports the AArch64 linker from root and linker barrels", () => {
    expect(typeof wrela.linkAArch64Image).toBe("function");
    expect(typeof wrela.linker.createAArch64LinkedImageLayout).toBe("function");
    expect(typeof wrela.linker.createAArch64UefiEntrySyntheticObjectProvider).toBe("function");
    expect(typeof wrela.linker.createAArch64UnwindSyntheticObjectProvider).toBe("function");
    expect(typeof wrela.linker.authenticateAArch64LinkerTargetSurface).toBe("function");
  });
});

describe("proof-mir public api", () => {
  test("exports proof-mir namespace with builder and diagnostics", () => {
    expect(wrela.proofMir).toBeDefined();
    expect(typeof wrela.proofMir.buildProofMir).toBe("function");
    expect(typeof wrela.proofMir.proofMirDiagnostic).toBe("function");
    expect(typeof wrela.proofMir.proofMirDiagnosticCode).toBe("function");
    expect(typeof wrela.proofMir.sortProofMirDiagnostics).toBe("function");
    expect(typeof wrela.proofMir.proofMirBlockId).toBe("function");
  });
});
