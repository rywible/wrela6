import type { Diagnostic } from "../../shared/diagnostics";
import type { LexDiagnostic } from "../lexer/diagnostics";
import { compareCodeUnitStrings } from "../../semantic/surface/deterministic-sort";

export type ParseDiagnosticCode =
  | "PARSE_EXPECTED_TOKEN"
  | "PARSE_EXPECTED_DECLARATION"
  | "PARSE_EXPECTED_EXPRESSION"
  | "PARSE_UNEXPECTED_TOKEN"
  | "PARSE_UNTERMINATED_BLOCK"
  | "PARSE_RECOVERY_SKIPPED_TOKENS"
  | "PARSE_NESTING_LIMIT_EXCEEDED";

export type ParseDiagnostic = Diagnostic<ParseDiagnosticCode>;

const PARSE_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set<ParseDiagnosticCode>([
  "PARSE_EXPECTED_TOKEN",
  "PARSE_EXPECTED_DECLARATION",
  "PARSE_EXPECTED_EXPRESSION",
  "PARSE_UNEXPECTED_TOKEN",
  "PARSE_UNTERMINATED_BLOCK",
  "PARSE_RECOVERY_SKIPPED_TOKENS",
  "PARSE_NESTING_LIMIT_EXCEEDED",
]);

function isParseDiagnosticCode(code: string): code is ParseDiagnosticCode {
  return PARSE_DIAGNOSTIC_CODES.has(code);
}

export function toParseDiagnostics(diagnostics: readonly Diagnostic[]): readonly ParseDiagnostic[] {
  return diagnostics.map((diagnostic) => {
    if (!isParseDiagnosticCode(diagnostic.code)) {
      throw new Error(`Unexpected parser diagnostic code: ${diagnostic.code}`);
    }

    return {
      ...diagnostic,
      code: diagnostic.code,
    };
  });
}

export function combineDiagnostics(
  lexerDiagnostics: readonly LexDiagnostic[],
  parserDiagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  const all: Diagnostic[] = [...lexerDiagnostics, ...parserDiagnostics];
  all.sort((left, right) => {
    if (left.span.start !== right.span.start) return left.span.start - right.span.start;
    if (left.span.end !== right.span.end) return left.span.end - right.span.end;
    return compareCodeUnitStrings(left.code, right.code);
  });
  return all;
}
