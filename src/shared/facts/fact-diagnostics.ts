import { compareCodeUnitStrings } from "../deterministic-sort";

export type FactDiagnosticCode =
  | "FACT_EXTENSION_DUPLICATE_KEY"
  | "FACT_EXTENSION_UNKNOWN_KEY"
  | "FACT_EXTENSION_MALFORMED_PAYLOAD"
  | "FACT_TRANSFER_MISSING_RULE"
  | "FACT_TRANSFER_REJECTED";

export interface FactDiagnostic {
  readonly code: FactDiagnosticCode;
  readonly stableDetail: string;
}

export type FactResult<ResultValue> =
  | {
      readonly kind: "ok";
      readonly value: ResultValue;
      readonly diagnostics: readonly FactDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly FactDiagnostic[] };

export type CompilerFactImportResult<Payload> =
  | {
      readonly kind: "ok";
      readonly payload: Payload;
      readonly diagnostics?: readonly FactDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly FactDiagnostic[] };

export function factDiagnostic(input: FactDiagnostic): FactDiagnostic {
  return Object.freeze({ code: input.code, stableDetail: input.stableDetail });
}

export function sortFactDiagnostics(
  diagnostics: readonly FactDiagnostic[],
): readonly FactDiagnostic[] {
  return Object.freeze(
    [...diagnostics].sort((left, right) => {
      const code = compareCodeUnitStrings(left.code, right.code);
      if (code !== 0) return code;
      return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
    }),
  );
}

export function factOk<ResultValue>(
  value: ResultValue,
  diagnostics: readonly FactDiagnostic[] = [],
): FactResult<ResultValue> {
  return Object.freeze({
    kind: "ok",
    value,
    diagnostics: sortFactDiagnostics(diagnostics),
  });
}

export function factError(diagnostics: readonly FactDiagnostic[]): FactResult<never> {
  return Object.freeze({ kind: "error", diagnostics: sortFactDiagnostics(diagnostics) });
}
