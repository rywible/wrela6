import {
  CollectingDiagnosticSink as SharedCollectingDiagnosticSink,
  type Diagnostic,
  type DiagnosticSeverity,
  type DiagnosticSink as SharedDiagnosticSink,
} from "../../shared/diagnostics";

export type LexDiagnosticCode =
  | "LEX_INVALID_CHARACTER"
  | "LEX_UNTERMINATED_STRING"
  | "LEX_INCONSISTENT_INDENT"
  | "LEX_IMPORT_MALFORMED"
  | "LEX_MODULE_MISSING"
  | "LEX_MODULE_UNREADABLE"
  | "LEX_MODULE_UNRESOLVED"
  | "LEX_IMPORT_CYCLE";

export type LexDiagnostic = Diagnostic<LexDiagnosticCode>;

export type DiagnosticSink = SharedDiagnosticSink<LexDiagnostic>;

export class CollectingDiagnosticSink extends SharedCollectingDiagnosticSink<LexDiagnostic> {}

export type { DiagnosticSeverity };
