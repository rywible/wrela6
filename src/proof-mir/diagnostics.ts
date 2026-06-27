import type { MonoInstanceId } from "../mono/ids";
import { compareCodeUnitStrings } from "../semantic/surface/deterministic-sort";

export const PROOF_MIR_DIAGNOSTIC_CODES = [
  "PROOF_MIR_REACHABLE_MONO_ERROR",
  "PROOF_MIR_MISSING_FUNCTION_BODY",
  "PROOF_MIR_CERTIFIED_PLATFORM_HAS_BODY",
  "PROOF_MIR_MISSING_CONCRETE_CALL_TARGET",
  "PROOF_MIR_UNRESOLVED_CALL_TARGET",
  "PROOF_MIR_CALL_TARGET_KIND_MISMATCH",
  "PROOF_MIR_MISSING_LAYOUT_TYPE_FACT",
  "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT",
  "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
  "PROOF_MIR_MISSING_PLATFORM_ABI_FACT",
  "PROOF_MIR_MISSING_FUNCTION_ABI_FACT",
  "PROOF_MIR_MISSING_PROOF_METADATA",
  "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
  "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
  "PROOF_MIR_MISSING_LOWERER",
  "PROOF_MIR_INVALID_CFG",
  "PROOF_MIR_INVALID_SSA",
  "PROOF_MIR_ORIGIN_MISSING",
  "PROOF_MIR_INPUT_LAYOUT_MISMATCH",
  "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
  "PROOF_MIR_MISSING_CONTROL_EDGE",
  "PROOF_MIR_DISCONNECTED_CONTROL_EDGE",
  "PROOF_MIR_INVALID_EDGE_METADATA",
  "PROOF_MIR_INVALID_YIELD_RESUME",
  "PROOF_MIR_MISSING_CALL_ID",
  "PROOF_MIR_MISSING_STATEMENT_ID",
  "PROOF_MIR_MISSING_TERMINATOR_ID",
  "PROOF_MIR_MISSING_LAYOUT_TERM_BINDING",
  "PROOF_MIR_INVALID_FACT_ROLE",
  "PROOF_MIR_MISSING_SESSION_MEMBER",
  "PROOF_MIR_MISSING_ATTEMPT_START",
  "PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS",
  "PROOF_MIR_INVALID_VALIDATION_BINDING",
  "PROOF_MIR_INVALID_LOAN_IDENTITY",
  "PROOF_MIR_MISSING_RUNTIME_CALL_CONTRACT",
  "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
  "PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT",
  "PROOF_MIR_RUNTIME_TARGET_UNAVAILABLE",
  "PROOF_MIR_MISSING_SEMANTICS_GATE",
  "PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD",
  "PROOF_MIR_MISSING_PRIVATE_STATE_GENERATION",
  "PROOF_MIR_MISSING_CONCURRENCY_METADATA",
  "PROOF_MIR_MISSING_IMAGE_ENTRY",
  "PROOF_MIR_MISSING_EXTERNAL_ROOTS",
  "PROOF_MIR_INVALID_JOIN_ARGUMENTS",
  "PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS",
  "PROOF_MIR_INVALID_LAYOUT_TERM_PATH",
  "PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY",
  "PROOF_MIR_INVALID_SCOPE_TREE",
  "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
  "PROOF_MIR_INVALID_CONCRETE_CALL_TARGET",
  "PROOF_MIR_INVALID_CALL_OPERAND",
  "PROOF_MIR_INVALID_ATTEMPT_OPERAND",
  "PROOF_MIR_INVALID_ITERATOR_PROTOCOL",
  "PROOF_MIR_INVALID_LOOP_BOUNDARY_SET",
  "PROOF_MIR_INVALID_YIELD_FRAME_BOUNDARY",
  "PROOF_MIR_INVALID_FACT_OPERAND",
  "PROOF_MIR_INVALID_FACT_AUTHORITY",
  "PROOF_MIR_INVALID_FACT_TABLE_REFERENCE",
  "PROOF_MIR_INVALID_STATEMENT_OPERATOR",
  "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
  "PROOF_MIR_TYPE_RESOURCE_KIND_MISMATCH",
  "PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT",
  "PROOF_MIR_INVALID_EXTERNAL_ROOT",
] as const;

export type ProofMirDiagnosticCode = (typeof PROOF_MIR_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "ProofMirDiagnosticCode";
};

const PROOF_MIR_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(PROOF_MIR_DIAGNOSTIC_CODES);

export function proofMirDiagnosticCode(code: string): ProofMirDiagnosticCode {
  if (!PROOF_MIR_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown Proof MIR diagnostic code: ${code}.`);
  }
  return code as ProofMirDiagnosticCode;
}

export type ProofMirDiagnosticSeverity = "error" | "warning" | "note";

export interface ProofMirDiagnosticOrder {
  readonly sourceOrigin: string;
  readonly functionInstanceId: string;
  readonly nodeDetail: string;
  readonly code: ProofMirDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export interface ProofMirDiagnostic {
  readonly severity: ProofMirDiagnosticSeverity;
  readonly code: ProofMirDiagnosticCode;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly nodeDetail?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly order: ProofMirDiagnosticOrder;
}

export interface ProofMirDiagnosticInput {
  readonly severity: ProofMirDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly nodeDetail?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

function diagnosticSortKey(value: string | undefined): string {
  return value ?? "";
}

export function proofMirDiagnostic(input: ProofMirDiagnosticInput): ProofMirDiagnostic {
  const validatedCode = proofMirDiagnosticCode(input.code);
  const order: ProofMirDiagnosticOrder = {
    sourceOrigin: diagnosticSortKey(input.sourceOrigin),
    functionInstanceId: diagnosticSortKey(input.functionInstanceId),
    nodeDetail: diagnosticSortKey(input.nodeDetail),
    code: validatedCode,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  };
  return {
    severity: input.severity,
    code: validatedCode,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    order,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
    ...(input.functionInstanceId !== undefined
      ? { functionInstanceId: input.functionInstanceId }
      : {}),
    ...(input.nodeDetail !== undefined ? { nodeDetail: input.nodeDetail } : {}),
  };
}

export function sortProofMirDiagnostics(
  diagnostics: readonly ProofMirDiagnostic[],
): ProofMirDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const sourceOriginCmp = compareCodeUnitStrings(
      left.order.sourceOrigin,
      right.order.sourceOrigin,
    );
    if (sourceOriginCmp !== 0) return sourceOriginCmp;

    const functionInstanceCmp = compareCodeUnitStrings(
      left.order.functionInstanceId,
      right.order.functionInstanceId,
    );
    if (functionInstanceCmp !== 0) return functionInstanceCmp;

    const nodeDetailCmp = compareCodeUnitStrings(left.order.nodeDetail, right.order.nodeDetail);
    if (nodeDetailCmp !== 0) return nodeDetailCmp;

    const codeCmp = compareCodeUnitStrings(left.order.code, right.order.code);
    if (codeCmp !== 0) return codeCmp;

    const ownerCmp = compareCodeUnitStrings(left.order.ownerKey, right.order.ownerKey);
    if (ownerCmp !== 0) return ownerCmp;

    const rootCauseCmp = compareCodeUnitStrings(left.order.rootCauseKey, right.order.rootCauseKey);
    if (rootCauseCmp !== 0) return rootCauseCmp;

    return compareCodeUnitStrings(left.order.stableDetail, right.order.stableDetail);
  });
}
