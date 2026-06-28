import type { MonoInstanceId } from "../mono/ids";
import { compareCodeUnitStrings } from "../shared/deterministic-sort";

export const PROOF_CHECK_DIAGNOSTIC_CODES = [
  "PROOF_CHECK_INPUT_CONTRACT_INVALID",
  "PROOF_CHECK_TARGET_MISMATCH",
  "PROOF_CHECK_LAYOUT_AUTHORITY_MISMATCH",
  "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
  "PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT",
  "PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY",
  "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
  "PROOF_CHECK_TYPE_FACT_AUTHORITY_MISSING",
  "PROOF_CHECK_REACHABLE_CLOSURE_INVALID",
  "PROOF_CHECK_SOURCE_CALL_CYCLE",
  "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
  "PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE",
  "PROOF_CHECK_INVALID_STATE_PATCH",
  "PROOF_CHECK_DIVERGENT_JOIN",
  "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
  "PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED",
  "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
  "PROOF_CHECK_UNTRUSTED_FACT",
  "PROOF_CHECK_STALE_FACT",
  "PROOF_CHECK_CONTRADICTORY_FACT",
  "PROOF_CHECK_FORGED_TRUSTED_AXIOM",
  "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
  "PROOF_CHECK_USE_AFTER_MOVE",
  "PROOF_CHECK_USE_AFTER_CONSUME",
  "PROOF_CHECK_CONFLICTING_LOAN",
  "PROOF_CHECK_LEAKED_LOAN",
  "PROOF_CHECK_LEAKED_OBLIGATION",
  "PROOF_CHECK_LEAKED_SESSION_MEMBER",
  "PROOF_CHECK_LEAKED_VALIDATION",
  "PROOF_CHECK_LEAKED_PACKET",
  "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
  "PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH",
  "PROOF_CHECK_INVALID_VALIDATION_SPLIT",
  "PROOF_CHECK_INVALID_ATTEMPT_SPLIT",
  "PROOF_CHECK_PLATFORM_PRECONDITION_FAILED",
  "PROOF_CHECK_PLATFORM_CAPABILITY_FLOW_MISMATCH",
  "PROOF_CHECK_RUNTIME_PRECONDITION_FAILED",
  "PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH",
  "PROOF_CHECK_UNSUPPORTED_PROOF_OBLIGATION",
  "PROOF_CHECK_UNIQUE_ROOT_DUPLICATE",
  "PROOF_CHECK_WRAPPER_RESOURCE_LEAK",
  "PROOF_CHECK_INVALID_PACKET_SOURCE",
  "PROOF_CHECK_INVALID_ERASURE",
  "PROOF_CHECK_INVALID_PANIC_CLOSURE",
  "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
  "PROOF_CHECK_UNSAFE_EXTENSION",
  "PROOF_CHECK_INVALID_YIELD_BOUNDARY",
  "PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING",
  "PROOF_CHECK_LOOP_CONVERGENCE_FAILED",
  "PROOF_CHECK_INVALID_FACT_PACKET",
  "PROOF_CHECK_INVALID_ORIGIN_MAPPING",
] as const;

export type ProofCheckDiagnosticCode = (typeof PROOF_CHECK_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "ProofCheckDiagnosticCode";
};

const PROOF_CHECK_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(PROOF_CHECK_DIAGNOSTIC_CODES);

export function proofCheckDiagnosticCode(code: string): ProofCheckDiagnosticCode {
  if (!PROOF_CHECK_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown proof-check diagnostic code: ${code}.`);
  }
  return code as ProofCheckDiagnosticCode;
}

export type ProofCheckDiagnosticTemplateId = string & {
  readonly __brand: "ProofCheckDiagnosticTemplateId";
};

export function proofCheckDiagnosticTemplateId(value: string): ProofCheckDiagnosticTemplateId {
  if (value.length === 0) {
    throw new RangeError("ProofCheckDiagnosticTemplateId must be a non-empty string.");
  }
  return value as ProofCheckDiagnosticTemplateId;
}

export type ProofCheckDiagnosticArgument = {
  readonly kind: "text";
  readonly value: string;
};

export type ProofCheckDiagnosticSeverity = "error" | "warning" | "note";

export interface ProofCheckStateSnapshot {
  readonly stateKey: string;
  readonly livePlaces: readonly string[];
  readonly movedOrConsumedPlaces: readonly string[];
  readonly loans: readonly string[];
  readonly obligations: readonly string[];
  readonly sessions: readonly string[];
  readonly validations: readonly string[];
  readonly attempts: readonly string[];
  readonly facts: readonly string[];
  readonly privateStateGenerations: readonly string[];
  readonly capabilities: readonly string[];
}

export interface ProofCounterexampleFrame {
  readonly pathFrameKey: string;
  readonly functionInstanceId: string;
  readonly blockKey: string;
  readonly programPointKey: string;
  readonly originKey: string;
  readonly beforeState: ProofCheckStateSnapshot;
  readonly afterState: ProofCheckStateSnapshot;
  readonly failedComponentKeys: readonly string[];
}

export interface ProofCounterexamplePath {
  readonly pathKey: string;
  readonly frames: readonly ProofCounterexampleFrame[];
}

export interface ProofCheckDiagnosticOrder {
  readonly sourceOrigin: string;
  readonly functionInstanceId: string;
  readonly pathFrameKey: string;
  readonly code: ProofCheckDiagnosticCode;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

export interface ProofCheckDiagnostic {
  readonly severity: ProofCheckDiagnosticSeverity;
  readonly code: ProofCheckDiagnosticCode;
  readonly messageTemplateId: ProofCheckDiagnosticTemplateId;
  readonly messageArguments: readonly ProofCheckDiagnosticArgument[];
  readonly message: string;
  readonly counterexample?: ProofCounterexamplePath;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly order: ProofCheckDiagnosticOrder;
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly pathFrameKey?: string;
}

export type ProofCheckNonErrorDiagnostic = ProofCheckDiagnostic & {
  readonly severity: Exclude<ProofCheckDiagnosticSeverity, "error">;
};

export interface ProofCheckDiagnosticInput {
  readonly severity: ProofCheckDiagnosticSeverity;
  readonly code: string;
  readonly messageTemplateId: string;
  readonly messageArguments: readonly ProofCheckDiagnosticArgument[];
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly pathFrameKey?: string;
  readonly counterexample?: ProofCounterexamplePath;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}

function diagnosticSortKey(value: string | undefined): string {
  return value ?? "";
}

export function proofCheckDiagnostic(input: ProofCheckDiagnosticInput): ProofCheckDiagnostic {
  const validatedCode = proofCheckDiagnosticCode(input.code);
  const validatedTemplateId = proofCheckDiagnosticTemplateId(input.messageTemplateId);
  const order: ProofCheckDiagnosticOrder = {
    sourceOrigin: diagnosticSortKey(input.sourceOrigin),
    functionInstanceId: diagnosticSortKey(input.functionInstanceId),
    pathFrameKey: diagnosticSortKey(input.pathFrameKey),
    code: validatedCode,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  };
  return {
    severity: input.severity,
    code: validatedCode,
    messageTemplateId: validatedTemplateId,
    messageArguments: input.messageArguments,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    order,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
    ...(input.functionInstanceId !== undefined
      ? { functionInstanceId: input.functionInstanceId }
      : {}),
    ...(input.pathFrameKey !== undefined ? { pathFrameKey: input.pathFrameKey } : {}),
    ...(input.counterexample !== undefined ? { counterexample: input.counterexample } : {}),
  };
}

export function sortProofCheckDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
): ProofCheckDiagnostic[] {
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

    const pathFrameCmp = compareCodeUnitStrings(left.order.pathFrameKey, right.order.pathFrameKey);
    if (pathFrameCmp !== 0) return pathFrameCmp;

    const codeCmp = compareCodeUnitStrings(left.order.code, right.order.code);
    if (codeCmp !== 0) return codeCmp;

    const ownerCmp = compareCodeUnitStrings(left.order.ownerKey, right.order.ownerKey);
    if (ownerCmp !== 0) return ownerCmp;

    const rootCauseCmp = compareCodeUnitStrings(left.order.rootCauseKey, right.order.rootCauseKey);
    if (rootCauseCmp !== 0) return rootCauseCmp;

    return compareCodeUnitStrings(left.order.stableDetail, right.order.stableDetail);
  });
}
