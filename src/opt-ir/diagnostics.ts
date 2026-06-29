import { compareCodeUnitStrings } from "./deterministic-sort";
import type { OptIrFunctionId, OptIrOriginId } from "./ids";

export const OPT_IR_DIAGNOSTIC_CODES = [
  "OPT_IR_CONSTRUCTION_TRACE",
  "OPT_IR_INPUT_CONTRACT_INVALID",
  "OPT_IR_TARGET_MISMATCH",
  "OPT_IR_LAYOUT_AUTHORITY_MISMATCH",
  "OPT_IR_MISSING_PATH_CERTIFICATE",
  "OPT_IR_MISSING_SEMANTIC_INLINE_POLICY",
  "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
  "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY",
  "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY",
  "OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH",
  "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION",
  "OPT_IR_CFG_EDGE_MISSING",
  "OPT_IR_BLOCK_ARGUMENT_MISMATCH",
  "OPT_IR_DUPLICATE_VALUE_DEFINITION",
  "OPT_IR_DOMINANCE_VIOLATION",
  "OPT_IR_MISSING_BOUNDS_AUTHORITY",
  "OPT_IR_STALE_RUNTIME_GUARD",
  "OPT_IR_EFFECT_TOKEN_INCOMPLETE",
  "OPT_IR_OPERATION_METADATA_MISMATCH",
  "OPT_IR_FACT_PRESERVATION_INVALID",
  "OPT_IR_REWRITE_LEGALITY_INVALID",
] as const;

export type OptIrDiagnosticCode = (typeof OPT_IR_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "OptIrDiagnosticCode";
};

export type OptIrDiagnosticSeverity = "error" | "warning" | "info";

export type OptIrDiagnosticArgument = string | number | boolean;

export interface OptIrDiagnostic {
  readonly severity: OptIrDiagnosticSeverity;
  readonly code: OptIrDiagnosticCode;
  readonly messageTemplate: string;
  readonly arguments: Readonly<Record<string, OptIrDiagnosticArgument>>;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly originId?: OptIrOriginId;
  readonly functionId?: OptIrFunctionId;
  readonly orderKey: string;
}

const OPT_IR_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(OPT_IR_DIAGNOSTIC_CODES);

export function optIrDiagnosticCode(code: string): OptIrDiagnosticCode {
  if (!OPT_IR_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown OptIR diagnostic code: ${code}.`);
  }
  return code as OptIrDiagnosticCode;
}

export function optIrDiagnosticOrderKey(input: {
  readonly originKey: string;
  readonly functionKey: string;
  readonly code: OptIrDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): string {
  return [
    `origin:${input.originKey}`,
    `function:${input.functionKey}`,
    `code:${input.code}`,
    `owner:${input.ownerKey}`,
    `root:${input.rootCauseKey}`,
    `detail:${input.stableDetail}`,
  ].join("/");
}

export function sortOptIrDiagnostics(diagnostics: readonly OptIrDiagnostic[]): OptIrDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    compareCodeUnitStrings(left.orderKey, right.orderKey),
  );
}

export class OptIrDiagnosticSink {
  private readonly collected: OptIrDiagnostic[] = [];

  report(diagnostic: OptIrDiagnostic): void {
    this.collected.push(diagnostic);
  }

  entries(): readonly OptIrDiagnostic[] {
    return this.collected.slice();
  }

  sorted(): OptIrDiagnostic[] {
    return sortOptIrDiagnostics(this.collected);
  }
}
