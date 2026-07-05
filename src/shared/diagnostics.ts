import type { SourceSpan } from "./source-span";
import type { SourceText } from "./source-text";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic<Code extends string = string> {
  readonly code: Code;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export interface DiagnosticSink<DiagnosticType extends Diagnostic = Diagnostic> {
  report(diagnostic: DiagnosticType): void;
}

export function stableDiagnosticDetail(input: {
  readonly code: string;
  readonly source: SourceText;
  readonly span: SourceSpan;
}): string {
  return `${input.code}:${input.source.name}:${input.span.start}:${input.span.end}`;
}

export function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  const bySpanStart = left.span.start - right.span.start;
  if (bySpanStart !== 0) return bySpanStart;
  const bySpanEnd = left.span.end - right.span.end;
  if (bySpanEnd !== 0) return bySpanEnd;
  return (
    compareCodeUnitStrings(left.ownerKey, right.ownerKey) ||
    compareCodeUnitStrings(left.code, right.code) ||
    compareCodeUnitStrings(left.stableDetail, right.stableDetail)
  );
}

function compareCodeUnitStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
