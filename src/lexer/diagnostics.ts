import type { SourceSpan } from "./source-span";
import type { SourceText } from "./source-text";

export type DiagnosticSeverity = "error" | "warning";

export type LexDiagnosticCode =
  | "LEX_INVALID_CHARACTER"
  | "LEX_UNTERMINATED_STRING"
  | "LEX_INCONSISTENT_INDENT"
  | "LEX_IMPORT_MALFORMED"
  | "LEX_MODULE_MISSING"
  | "LEX_MODULE_UNREADABLE"
  | "LEX_MODULE_UNRESOLVED"
  | "LEX_IMPORT_CYCLE";

export interface LexDiagnostic {
  readonly code: LexDiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
}

export interface DiagnosticSink {
  report(diagnostic: LexDiagnostic): void;
}

export class CollectingDiagnosticSink implements DiagnosticSink {
  readonly #collected: LexDiagnostic[] = [];

  report(diagnostic: LexDiagnostic): void {
    this.#collected.push(diagnostic);
  }

  get diagnostics(): readonly LexDiagnostic[] {
    return this.#collected;
  }
}
