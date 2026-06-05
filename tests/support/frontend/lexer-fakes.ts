import type { FileReadResult, FileRepository } from "../../../src/frontend/lexer/file-repository";
import { ModulePath } from "../../../src/frontend/lexer/module-path";
import type { ModuleImportRequest } from "../../../src/frontend/lexer/module-import-request";
import type {
  ModuleResolveResult,
  ModuleResolver,
} from "../../../src/frontend/lexer/module-resolver";
import { SourceText } from "../../../src/frontend/lexer/source-text";
import { CollectingDiagnosticSink } from "../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../src/frontend/lexer/lexer";

export class FakeFileRepository implements FileRepository {
  constructor(private readonly files: ReadonlyMap<string, string>) {}

  async read(path: ModulePath): Promise<FileReadResult> {
    const text = this.files.get(path.key);
    if (text === undefined) {
      return { kind: "missing", path };
    }
    return {
      kind: "found",
      path,
      source: SourceText.from(path.display, text),
    };
  }
}

export class FakeModuleResolver implements ModuleResolver {
  constructor(private readonly mappings: ReadonlyMap<string, string>) {}

  resolve(request: ModuleImportRequest): ModuleResolveResult {
    const path = this.mappings.get(request.moduleName);
    if (path === undefined) {
      return { kind: "unresolved", reason: `Unknown module: ${request.moduleName}` };
    }
    return { kind: "resolved", path: ModulePath.from(path) };
  }
}

export function makeLexerHarness(
  sourceName: string,
  sourceText: string,
): { lexer: Lexer; diagnostics: CollectingDiagnosticSink; source: SourceText } {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from(sourceName, sourceText);
  return { lexer, diagnostics, source };
}
