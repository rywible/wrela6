import { resourcePlaceId } from "../../../hir/ids";
import type {
  MonoForStatement,
  MonoLocal,
  MonoResourcePlace,
  MonoStatement,
  MonoTakeOperand,
} from "../../../mono/mono-hir";
import { proofMirDiagnostic, sortProofMirDiagnostics } from "../../diagnostics";
import { rejectUnsupportedProofMirExtensionConstruct } from "../../extensions/extension-gates";
import type { ProofMirCanonicalKey } from "../../canonicalization/canonical-keys";
import { proofMetadataIdKey } from "../../../mono/proof-metadata-tables";
import type {
  ProofMirCallLowerer,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
  ProofMirTakeLowerer,
} from "../lowering-context";
import type { ProofMirCallLoweringRecorder } from "../call-lowerer";
import type { LoopLoweringSharedInput } from "../loop-lowerer";
import {
  lowerOrdinaryForStatement,
  obligationIdsForIterator,
  type IteratorLoweringMetadata,
} from "./array-for-lowerer";
import { syntheticStreamLoopGateOriginId } from "./synthetic-origin-ids";

export interface LowerStreamForStatementInput {
  readonly context: ProofMirLoweringContext;
  readonly forStatement: MonoForStatement;
  readonly monoStatement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly call: ProofMirCallLowerer;
  readonly take: ProofMirTakeLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly iteratorMetadata?: IteratorLoweringMetadata;
  readonly continuationBlockKey: ProofMirCanonicalKey;
}

function loweringError(diagnostics: readonly ReturnType<typeof proofMirDiagnostic>[]) {
  return { kind: "error" as const, diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

export function lowerStreamForStatement(
  input: LowerStreamForStatementInput,
): ProofMirLoweringResult<void> {
  const origin = syntheticStreamLoopGateOriginId();
  const gate = rejectUnsupportedProofMirExtensionConstruct({
    construct: "streamLoop",
    targetFeatures: input.context.target.features,
    origin,
    sourceOrigin: input.monoStatement.sourceOrigin,
    functionInstanceId: input.context.functionInstanceId,
  });
  if (gate.kind === "error") {
    return gate;
  }
  if (input.forStatement.iteration.kind !== "stream") {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Proof MIR stream for-loop lowering requires stream iteration metadata.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "stream-iteration",
        stableDetail: input.forStatement.iteration.kind,
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }
  if (input.iteratorMetadata === undefined) {
    return lowerTakeModeStreamForStatement(input);
  }
  const boundaryOrigin = input.context.graph.allocateSyntheticOrigin("stream.loop.boundary");

  const lowered = lowerOrdinaryForStatement({
    context: input.context,
    monoStatement: input.monoStatement,
    forStatement: input.forStatement,
    blockKey: input.blockKey,
    continuationBlockKey: input.continuationBlockKey,
    shared: input.shared,
    call: input.call,
    callRecorder: input.callRecorder,
    loopCarriedLocals: input.loopCarriedLocals,
    iteratorMetadata: input.iteratorMetadata,
    obligationIds: obligationIdsForIterator({
      program: input.context.program,
      iteratorMetadata: input.iteratorMetadata,
    }),
    boundarySessionMembers: [
      {
        sessionProofKey: proofMetadataIdKey(input.forStatement.iteration.sessionId),
        brandProofKey: proofMetadataIdKey(input.forStatement.iteration.itemBrandId),
        obligationProofKey: proofMetadataIdKey(input.forStatement.iteration.closureObligationId),
        ...(input.forStatement.iterable.place === undefined
          ? {}
          : {
              placeKey: input.context.effects.placeFromMono({
                monoPlace: input.forStatement.iterable.place,
                originKey: boundaryOrigin,
              }),
            }),
        originKey: boundaryOrigin,
      },
    ],
  });
  if (lowered.kind === "error") {
    return lowered;
  }
  return { kind: "ok", value: undefined };
}

function lowerTakeModeStreamForStatement(
  input: LowerStreamForStatementInput,
): ProofMirLoweringResult<void> {
  if (input.forStatement.iteration.kind !== "stream") {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Proof MIR stream for-loop lowering requires stream iteration metadata.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "stream-iteration",
        stableDetail: input.forStatement.iteration.kind,
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }
  const operand = streamTakeOperandForIterable(input);
  if (operand.kind === "error") {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Proof MIR stream for-loop lowering requires a place-backed stream operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "stream-operand",
        stableDetail: "missing",
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }
  return input.take.lowerTake({
    context: input.context,
    blockKey: input.blockKey,
    statement: {
      operand,
      takeKind: input.forStatement.iteration,
      ...(input.forStatement.binding === undefined
        ? {}
        : { aliasLocal: input.forStatement.binding }),
      body: input.forStatement.body,
      sourceOrigin: input.monoStatement.sourceOrigin,
    },
  });
}

function streamTakeOperandForIterable(input: LowerStreamForStatementInput): MonoTakeOperand {
  const iterable = input.forStatement.iterable;
  if (iterable.kind.kind === "call") {
    return {
      kind: "takeOnlyCall",
      call: iterable.kind.call,
      callExpressionId: iterable.expressionId,
      resultType: iterable.type,
      resultResourceKind: iterable.resourceKind,
      resultPlace: streamCallResultPlace(input),
    };
  }
  if (iterable.place !== undefined) {
    return { kind: "place", place: iterable.place, expression: iterable };
  }
  return { kind: "error", expression: iterable };
}

function streamCallResultPlace(input: LowerStreamForStatementInput): MonoResourcePlace {
  const iterable = input.forStatement.iterable;
  const expressionOrdinal = Number(iterable.expressionId.hirId);
  const ordinal = Number.isFinite(expressionOrdinal) ? expressionOrdinal + 100_000 : 100_000;
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.context.functionInstanceId },
      hirId: resourcePlaceId(ordinal),
      instanceId: input.context.functionInstanceId,
    },
    canonicalKey: `function:${String(input.context.functionInstanceId)}/stream-for-call:${String(
      iterable.expressionId.hirId,
    )}`,
    root: { kind: "temporary", ordinal },
    projection: [],
    type: iterable.type,
    resourceKind: iterable.resourceKind,
    sourceOrigin: iterable.sourceOrigin,
    kind: "temporary",
  };
}
