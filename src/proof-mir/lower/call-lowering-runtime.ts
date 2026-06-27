import { instantiatedHirIdKey } from "../../mono/ids";
import type {
  MonoCallArgument,
  MonoCallExpression,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
} from "../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirCallArgument,
  DraftProofMirCallReceiver,
} from "../draft/draft-call-operands";
import type { DraftProofMirRuntimeEffect } from "../draft/draft-runtime-call";
import {
  type ProofMirOwnedCallId,
  type ProofMirPlaceId,
  type ProofMirRuntimeCallId,
  type ProofMirRuntimeOperationId,
  type ProofMirValueId,
} from "../ids";
import type {
  ProofMirRuntimeOperation,
  ProofMirRuntimePlaceSchema,
} from "../../runtime/runtime-catalog-types";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { operandPlaceKey } from "./lowering-operands";
import { recordCallArtifacts } from "./call-lowering-artifacts";
import {
  type CallLoweringIdAllocator,
  loweringError,
  loweringOk,
  originForCall,
} from "./call-lowering-shared";
import { lowerMonoCallArguments } from "./call-lowering-operands";
import {
  type DraftRecordedProofMirRuntimeCallContract,
  type ProofMirCallLoweringRecorder,
} from "./call-lowering-recorder";
import type {
  ProofMirExpressionLowerer,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
} from "./lowering-context";

function runtimeOperationNeedsResultPlace(operation: ProofMirRuntimeOperation): boolean {
  for (const effect of operation.effectSchemas) {
    if (
      (effect.kind === "readsMemory" ||
        effect.kind === "writesMemory" ||
        effect.kind === "advancesPrivateState") &&
      effect.place.kind === "result"
    ) {
      return true;
    }
  }
  for (const schema of operation.producedCapabilitySchemas) {
    if (schema.kind === "result") {
      return true;
    }
  }
  for (const schema of operation.consumedCapabilitySchemas) {
    if (schema.kind === "result") {
      return true;
    }
  }
  return false;
}

function placeKeyFromDraftOperand(operand: ProofMirDraftOperand): ProofMirCanonicalKey | undefined {
  return operandPlaceKey(operand);
}

function resolveRuntimePlaceSchema(input: {
  readonly schema: ProofMirRuntimePlaceSchema;
  readonly context: ProofMirLoweringContext;
  readonly originKey: ProofMirCanonicalKey;
  readonly receiver?: DraftProofMirCallReceiver;
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly resultPlaceKey?: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  switch (input.schema.kind) {
    case "receiver": {
      if (input.receiver === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog references a receiver place that is not present on the call.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "runtime-catalog",
            stableDetail: "missing-receiver-place",
          }),
        ]);
      }
      const placeKey = placeKeyFromDraftOperand(input.receiver.operand);
      if (placeKey === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog receiver place is not place-backed.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "runtime-catalog",
            stableDetail: "receiver-not-place-backed",
          }),
        ]);
      }
      return loweringOk(placeKey);
    }
    case "argument": {
      const schema = input.schema;
      const argument =
        schema.parameterId === undefined
          ? input.arguments[schema.index]
          : input.arguments.find((entry) => entry.parameterId === schema.parameterId);
      if (argument === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog references a call argument place that is not present.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "runtime-catalog",
            stableDetail: `missing-argument-place:${input.schema.index}`,
          }),
        ]);
      }
      const placeKey = placeKeyFromDraftOperand(argument.operand);
      if (placeKey === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog argument place is not place-backed.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "runtime-catalog",
            stableDetail: `argument-not-place-backed:${input.schema.index}`,
          }),
        ]);
      }
      return loweringOk(placeKey);
    }
    case "result": {
      if (input.resultPlaceKey === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
            message: "Runtime catalog references a result place that is not present on the call.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "runtime-catalog",
            stableDetail: "missing-result-place",
          }),
        ]);
      }
      return loweringOk(input.resultPlaceKey);
    }
    case "synthetic": {
      const placeKey = input.context.graph.createPlace({
        monoPlaceCanonicalKey: `runtime:synthetic:${input.schema.name}`,
        origin: input.originKey,
      });
      return loweringOk(placeKey);
    }
    default: {
      const unreachable: never = input.schema;
      return unreachable;
    }
  }
}

function instantiateRuntimeCallContract(input: {
  readonly context: ProofMirLoweringContext;
  readonly originKey: ProofMirCanonicalKey;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly ownedCallId: ProofMirOwnedCallId;
  readonly requiredFactKeys: readonly ProofMirCanonicalKey[];
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly resultPlaceKey?: ProofMirCanonicalKey;
}): ProofMirLoweringResult<DraftRecordedProofMirRuntimeCallContract> {
  const operation = input.context.target.runtimeCatalog.get(input.runtimeId);
  if (operation === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
        message: "Runtime catalog does not define the requested operation.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "runtime-catalog",
        stableDetail: `missing-runtime-operation:${String(input.runtimeId)}`,
      }),
    ]);
  }

  const effects: DraftProofMirRuntimeEffect[] = [];
  for (const effect of operation.effectSchemas) {
    switch (effect.kind) {
      case "pure":
      case "mayPanic":
      case "doesNotReturn":
        effects.push({ kind: effect.kind });
        break;
      case "readsMemory":
      case "writesMemory":
      case "advancesPrivateState": {
        const placeResult = resolveRuntimePlaceSchema({
          schema: effect.place,
          context: input.context,
          originKey: input.originKey,
          arguments: input.arguments,
          resultPlaceKey: input.resultPlaceKey,
        });
        if (placeResult.kind === "error") {
          return placeResult;
        }
        effects.push({ kind: effect.kind, placeKey: placeResult.value });
        break;
      }
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }

  const consumedCapabilityPlaceKeys: ProofMirCanonicalKey[] = [];
  for (const schema of operation.consumedCapabilitySchemas) {
    const placeResult = resolveRuntimePlaceSchema({
      schema,
      context: input.context,
      originKey: input.originKey,
      arguments: input.arguments,
      resultPlaceKey: input.resultPlaceKey,
    });
    if (placeResult.kind === "error") {
      return placeResult;
    }
    consumedCapabilityPlaceKeys.push(placeResult.value);
  }

  const producedCapabilityPlaceKeys: ProofMirCanonicalKey[] = [];
  for (const schema of operation.producedCapabilitySchemas) {
    const placeResult = resolveRuntimePlaceSchema({
      schema,
      context: input.context,
      originKey: input.originKey,
      arguments: input.arguments,
      resultPlaceKey: input.resultPlaceKey,
    });
    if (placeResult.kind === "error") {
      return placeResult;
    }
    producedCapabilityPlaceKeys.push(placeResult.value);
  }

  return loweringOk({
    runtimeCallId: input.runtimeCallId,
    runtimeId: input.runtimeId,
    callId: input.ownedCallId,
    requiredFactKeys: input.requiredFactKeys,
    consumedCapabilityPlaceKeys,
    producedCapabilityPlaceKeys,
    effects,
  });
}

function createRuntimeCallResultOperand(input: {
  readonly context: ProofMirLoweringContext;
  readonly originKey: ProofMirCanonicalKey;
  readonly monoExpressionId: MonoExpressionId;
  readonly operation: ProofMirRuntimeOperation;
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
}): ProofMirDraftOperand {
  const resultValueKey = input.context.graph.createValue({
    role: `runtime-call:result:${instantiatedHirIdKey(input.monoExpressionId)}`,
    origin: input.originKey,
    type: input.resultType,
    resourceKind: input.resultResourceKind,
  });
  if (!runtimeOperationNeedsResultPlace(input.operation)) {
    return { kind: "value", value: resultValueKey };
  }
  const resultPlaceKey = input.context.graph.createPlace({
    monoPlaceCanonicalKey: `runtime-call:result-place:${instantiatedHirIdKey(input.monoExpressionId)}`,
    origin: input.originKey,
  });
  return {
    kind: "valueAndPlace",
    value: resultValueKey,
    place: resultPlaceKey,
  };
}

export function lowerCompilerRuntimeCallImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirCallLoweringRecorder;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly arguments: readonly MonoCallArgument[];
  readonly blockKey: ProofMirCanonicalKey;
  readonly monoExpressionId: MonoExpressionId;
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const operation = input.context.target.runtimeCatalog.get(input.runtimeId);
  if (operation === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
        message: "Runtime catalog does not define the requested operation.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "runtime-catalog",
        stableDetail: `missing-runtime-operation:${String(input.runtimeId)}`,
      }),
    ]);
  }

  const targetResult = input.context.callTargetIndex.resolveCompilerRuntime({
    runtimeId: input.runtimeId,
    runtimeCallId: input.runtimeCallId,
    callerFunctionInstanceId: input.context.functionInstanceId,
  });
  if (targetResult.kind === "error") {
    return targetResult;
  }

  const loweredArgumentsResult = lowerMonoCallArguments({
    context: input.context,
    expression: input.expression,
    arguments: input.arguments,
    blockKey: input.blockKey,
    idAllocator: input.idAllocator,
    valueIdForKey: input.valueIdForKey,
    placeIdForKey: input.placeIdForKey,
  });
  if (loweredArgumentsResult.kind === "error") {
    return loweredArgumentsResult;
  }

  const originKey = originForCall(input.context, input.monoExpressionId, "source:compiler-runtime");
  const resultDraftOperand = createRuntimeCallResultOperand({
    context: input.context,
    originKey,
    monoExpressionId: input.monoExpressionId,
    operation,
    resultType: input.resultType,
    resultResourceKind: input.resultResourceKind,
  });

  const runtimeCallee: MonoExpression =
    input.arguments[0]?.expression ??
    ({
      expressionId: input.monoExpressionId,
      kind: { kind: "name", name: "runtime" },
      type: input.arguments[0]?.expression.type,
      resourceKind: "Copy",
      sourceOrigin: "source:compiler-runtime",
    } as MonoExpression);
  const runtimeCallExpression: MonoCallExpression = {
    callee: runtimeCallee,
    ownerTypeArguments: [],
    ownerTypeArgumentSource: "none",
    arguments: input.arguments,
    typeArguments: [],
    sourceOrigin: "source:compiler-runtime",
  };

  const callRecord = recordCallArtifacts({
    context: input.context,
    recorder: input.recorder,
    idAllocator: input.idAllocator,
    callInput: {
      context: input.context,
      call: runtimeCallExpression,
      blockKey: input.blockKey,
      monoExpressionId: input.monoExpressionId,
      resultType: input.resultType,
      resultResourceKind: input.resultResourceKind,
    },
    target: targetResult.target,
    arguments: loweredArgumentsResult.value,
    requirements: [],
    result: resultDraftOperand,
    originSource: "source:compiler-runtime",
  });

  const resultPlaceKey = placeKeyFromDraftOperand(resultDraftOperand);

  const requiredFactKeys: ProofMirCanonicalKey[] = [];
  for (const factSchema of operation.requiredFactSchemas) {
    if (factSchema.role !== "trustedAxiom") {
      continue;
    }
    const factKey = input.context.factRecorder.recordRuntimeEnsuredFact({
      role: "trustedAxiom",
      runtimeCallId: input.runtimeCallId,
      dependsOn: [{ kind: "runtimeCall", runtimeCallId: input.runtimeCallId }],
      origin: originKey,
    });
    if (factKey !== undefined) {
      requiredFactKeys.push(factKey);
      input.recorder.recordEnsuredFact(input.context.factRecorder.draftFact(factKey));
    }
  }

  const contractResult = instantiateRuntimeCallContract({
    context: input.context,
    originKey,
    runtimeId: input.runtimeId,
    runtimeCallId: input.runtimeCallId,
    ownedCallId: callRecord.callId,
    requiredFactKeys,
    arguments: loweredArgumentsResult.value,
    ...(resultPlaceKey === undefined ? {} : { resultPlaceKey }),
  });
  if (contractResult.kind === "error") {
    return contractResult;
  }

  input.recorder.recordRuntimeCall(contractResult.value);

  return loweringOk(resultDraftOperand);
}
