import { hirStatementId, type CallSiteRequirementId } from "../../hir/ids";
import { instantiatedHirId, instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  proofMirCallId,
  proofMirFactId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirValueId,
  type ProofMirCallId,
  type ProofMirFactId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirStatementId,
  type ProofMirValueId,
} from "../ids";
import type { ProofMirLoweringContext, ProofMirLoweringResult } from "./lowering-context";

export interface CallLoweringIdAllocator {
  callIdForKey(callKey: ProofMirCanonicalKey): ProofMirCallId;
  valueId(): ProofMirValueId;
  placeId(): ProofMirPlaceId;
  factId(): ProofMirFactId;
  originId(): ProofMirOriginId;
  callStatementOrigin(): ProofMirOriginId;
  nextStatementId(): ProofMirStatementId;
  nextMonoStatementId(): import("../../mono/mono-hir").MonoStatementId;
}

export function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export function loweringError(
  diagnostics: readonly ProofMirDiagnostic[],
): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

export function createCallLoweringIdAllocator(
  functionInstanceId: MonoInstanceId,
): CallLoweringIdAllocator {
  const callKeys = new Map<ProofMirCanonicalKey, ProofMirCallId>();
  let nextCall = 0;
  let nextValue = 0;
  let nextPlace = 0;
  let nextFact = 0;
  let nextOrigin = 1;
  let nextCallStatementOrigin = 1000;
  let nextStatement = 0;
  let nextMonoStatement = 1;

  return {
    callIdForKey(callKey) {
      const existing = callKeys.get(callKey);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirCallId(nextCall++);
      callKeys.set(callKey, id);
      return id;
    },
    valueId() {
      return proofMirValueId(nextValue++);
    },
    placeId() {
      return proofMirPlaceId(nextPlace++);
    },
    factId() {
      return proofMirFactId(nextFact++);
    },
    originId() {
      return proofMirOriginId(nextOrigin++);
    },
    callStatementOrigin() {
      return proofMirOriginId(nextCallStatementOrigin++);
    },
    nextStatementId() {
      return proofMirStatementId(nextStatement++);
    },
    nextMonoStatementId() {
      return instantiatedHirId(functionInstanceId, hirStatementId(nextMonoStatement++));
    },
  };
}

export function invalidConsumeOperandDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly stableDetail: string;
  readonly sourceOrigin?: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
    message: "Proof MIR call lowering requires a place-backed consume operand.",
    functionInstanceId: input.functionInstanceId,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "call-consume-operand",
    stableDetail: input.stableDetail,
  });
}

export function valueIdForGraphKey(input: {
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueKey: ProofMirCanonicalKey;
}): ProofMirValueId {
  if (input.valueIdForKey !== undefined) {
    return input.valueIdForKey(input.valueKey);
  }
  return input.idAllocator.valueId();
}

export function callSiteRequirementsForExpression(
  program: MonomorphizedHirProgram,
  monoExpressionId: MonoExpressionId,
): readonly MonoInstantiatedProofId<CallSiteRequirementId>[] {
  const expressionKey = instantiatedHirIdKey(monoExpressionId);
  return program.proofMetadata.callSiteRequirements
    .entries()
    .filter((requirement) => instantiatedHirIdKey(requirement.callExpressionId) === expressionKey)
    .map((requirement) => requirement.callSiteRequirementId);
}

export function originForCall(
  context: ProofMirLoweringContext,
  monoExpressionId: MonoExpressionId,
  sourceOrigin: string,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoExpression({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: sourceOrigin as never,
    monoExpressionId,
  });
}

export function callLoweringIdAllocatorForFunction(
  allocatorsByFunction: Map<MonoInstanceId, CallLoweringIdAllocator>,
  functionInstanceId: MonoInstanceId,
): CallLoweringIdAllocator {
  const existing = allocatorsByFunction.get(functionInstanceId);
  if (existing !== undefined) {
    return existing;
  }
  const allocator = createCallLoweringIdAllocator(functionInstanceId);
  allocatorsByFunction.set(functionInstanceId, allocator);
  return allocator;
}
