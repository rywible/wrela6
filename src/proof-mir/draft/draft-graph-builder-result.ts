import { sortProofMirDiagnostics, type ProofMirDiagnostic } from "../diagnostics";

export type DraftGraphBuilderResult =
  | { readonly kind: "ok" }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofMirDiagnostic[];
    };

export function okResult(): DraftGraphBuilderResult {
  return { kind: "ok" };
}

export function errorResult(diagnostics: readonly ProofMirDiagnostic[]): DraftGraphBuilderResult {
  return { kind: "error", diagnostics: sortProofMirDiagnostics(diagnostics) };
}
