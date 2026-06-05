import type { DiagnosticSeverity } from "../../shared/diagnostics";

export interface GreenDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  relativeStart: number;
  relativeEnd: number;
}
