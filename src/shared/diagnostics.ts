import type { SourceSpan } from "./source-span";
import type { SourceText } from "./source-text";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic<Code extends string = string> {
  readonly code: Code;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
}

export interface DiagnosticSink<DiagnosticType extends Diagnostic = Diagnostic> {
  report(diagnostic: DiagnosticType): void;
}

export class CollectingDiagnosticSink<
  DiagnosticType extends Diagnostic = Diagnostic,
> implements DiagnosticSink<DiagnosticType> {
  private readonly collected: DiagnosticType[] = [];

  report(diagnostic: DiagnosticType): void {
    this.collected.push(diagnostic);
  }

  get diagnostics(): readonly DiagnosticType[] {
    return [...this.collected];
  }
}
