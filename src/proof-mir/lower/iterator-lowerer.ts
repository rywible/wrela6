import { monoInstanceId } from "../../mono/ids";
import type {
  MonoCallExpression,
  MonoCheckedType,
  MonoForStatement,
  MonoLocal,
  MonoStatement,
} from "../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import { compareCodeUnitStrings } from "../../mono/deterministic-sort";
import { type ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic, sortProofMirDiagnostics } from "../diagnostics";
import type { ProofMirDiagnostic } from "../diagnostics";
import { proofMirRuntimeOperationId } from "../ids";
import type { ProofMirCallLoweringRecorder } from "./call-lowerer";
import { type ActiveLoopFrame, type LoopLoweringSharedInput } from "./loop-lowerer";
import { withLoopIfStatementLowering } from "./loop-if-statement-lowering";
import {
  type ProofMirCallLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirForLoweringInput,
  type ProofMirIteratorLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTakeLowerer,
  type ProofMirTerminalLowerer,
} from "./lowering-context";
import { allocateProofMirRuntimeCallId } from "./runtime-call-ids";
import {
  lowerOrdinaryForStatement,
  obligationIdsForIterator,
  type IteratorLoweringMetadata,
} from "./iterator-lowering/array-for-lowerer";
import { lowerStreamForStatement } from "./iterator-lowering/stream-for-lowerer";
import { allocateIteratorSyntheticExpressionIds } from "./iterator-lowering/synthetic-origin-ids";

export type {
  IteratorLoweringEdgeView,
  IteratorLoweringMetadata,
} from "./iterator-lowering/array-for-lowerer";
export {
  lowerOrdinaryForStatement,
  obligationIdsForIterator,
} from "./iterator-lowering/array-for-lowerer";

export interface CreateProofMirIteratorLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly call: ProofMirCallLowerer;
  readonly take: ProofMirTakeLowerer;
  readonly statement: ProofMirStatementLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
}

function resolveIteratorFinishRuntimeOperation(
  context: ProofMirLoweringContext,
): ReturnType<typeof proofMirRuntimeOperationId> | undefined {
  const operations = [...context.target.runtimeCatalog.entries()].sort((left, right) =>
    compareCodeUnitStrings(String(left.runtimeId), String(right.runtimeId)),
  );
  const pureOperation = operations.find((operation) =>
    operation.effectSchemas.some((effect) => effect.kind === "pure"),
  );
  return pureOperation?.runtimeId ?? operations[0]?.runtimeId;
}

const ITERATOR_NEXT_REQUIREMENT_PREFIX = "iterator-next:";

function resolveIteratorLoweringMetadataFromProofMetadata(input: {
  readonly context: ProofMirLoweringContext;
  readonly callRecorder: ProofMirCallLoweringRecorder;
}): IteratorLoweringMetadata | undefined {
  const functionInstanceId = input.context.functionInstanceId;
  const program = input.context.program;

  const iteratorObligation = program.proofMetadata.obligations
    .entries()
    .find(
      (obligation) =>
        obligation.obligationId.instanceId === functionInstanceId &&
        obligation.kind === "callRequirement",
    );
  if (iteratorObligation === undefined) {
    return undefined;
  }

  const nextRequirement = program.proofMetadata.callSiteRequirements
    .entries()
    .find((requirement) => {
      if (requirement.callSiteRequirementId.instanceId !== functionInstanceId) {
        return false;
      }
      const expression = requirement.requirement.expression;
      return (
        expression.kind === "opaque" && expression.text.startsWith(ITERATOR_NEXT_REQUIREMENT_PREFIX)
      );
    });
  if (nextRequirement === undefined) {
    return undefined;
  }

  const requirementExpression = nextRequirement.requirement.expression;
  if (requirementExpression.kind !== "opaque") {
    return undefined;
  }
  const nextFunctionInstanceId = monoInstanceId(
    requirementExpression.text.slice(ITERATOR_NEXT_REQUIREMENT_PREFIX.length),
  );
  const nextExpressionId = nextRequirement.callExpressionId;
  const finishRuntimeOperationId = resolveIteratorFinishRuntimeOperation(input.context);
  if (finishRuntimeOperationId === undefined) {
    return undefined;
  }
  const finishRuntimeCallId = allocateProofMirRuntimeCallId({
    context: input.context,
    recorder: input.callRecorder,
  });
  const syntheticExpressionIds = allocateIteratorSyntheticExpressionIds({
    program,
    functionInstanceId,
    callExpressionId: nextRequirement.callExpressionId,
  });

  return {
    nextCall: {
      callee: {
        expressionId: syntheticExpressionIds.nextCalleeExpressionId,
        kind: { kind: "name", name: "next" },
        type: scalarType(),
        resourceKind: "Copy",
        sourceOrigin: "source:iterator:next",
      },
      ownerTypeArguments: [],
      ownerTypeArgumentSource: "none",
      arguments: [],
      typeArguments: [],
      resolvedTarget: {
        kind: "sourceFunction",
        targetFunctionInstanceId: nextFunctionInstanceId,
      },
      sourceOrigin: "source:iterator:next",
    } satisfies MonoCallExpression,
    nextExpressionId,
    finishExpressionId: syntheticExpressionIds.finishExpressionId,
    nextResultType: scalarType(),
    nextResultResourceKind: "Copy" as ConcreteResourceKind,
    finishResultType: scalarType(),
    finishResultResourceKind: "Copy" as ConcreteResourceKind,
    iteratorObligationId: iteratorObligation.obligationId,
    finishRuntimeCallId,
    finishRuntimeOperationId,
  };
}

export function lowerForImpl(input: {
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
}): ProofMirLoweringResult<void> {
  switch (input.forStatement.iteration.kind) {
    case "stream": {
      const iteratorMetadata =
        input.iteratorMetadata ??
        resolveIteratorLoweringMetadataFromProofMetadata({
          context: input.context,
          callRecorder: input.callRecorder,
        });
      return lowerStreamForStatement({ ...input, take: input.take, iteratorMetadata });
    }
    case "error":
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
          message: "Proof MIR cannot lower a recovered for-loop iteration.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "for-iteration",
          stableDetail: "error",
          sourceOrigin: input.monoStatement.sourceOrigin,
        }),
      ]);
    case "ordinary": {
      const iteratorMetadata =
        input.iteratorMetadata ??
        resolveIteratorLoweringMetadataFromProofMetadata({
          context: input.context,
          callRecorder: input.callRecorder,
        });
      if (iteratorMetadata === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Proof MIR iterator lowering requires iterator metadata.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "iterator-metadata",
            stableDetail: "missing",
            sourceOrigin: input.monoStatement.sourceOrigin,
          }),
        ]);
      }
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
        iteratorMetadata,
        obligationIds: obligationIdsForIterator({
          program: input.context.program,
          iteratorMetadata,
        }),
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk(undefined);
    }
    default: {
      const unreachable: never = input.forStatement.iteration;
      return unreachable;
    }
  }
}

export function createProofMirIteratorLowerer(
  input: CreateProofMirIteratorLowererInput,
): ProofMirIteratorLowerer {
  return {
    lowerFor(forInput: ProofMirForLoweringInput): ProofMirLoweringResult<void> {
      const continuationBlockKey = forInput.context.graph.createBlock({
        role: "continuation",
        scope: forInput.context.graph.block(forInput.blockKey).scopeKey,
        origin: forInput.context.graph.allocateSyntheticOrigin("continuation"),
      });
      forInput.context.ssa.registerBlock(continuationBlockKey);

      const activeLoopRef: { frame?: ActiveLoopFrame } = {};
      const shared = withLoopIfStatementLowering({
        scopeRoleByKey: new Map(),
        expression: input.expression,
        statementLowerer: input.statement,
        terminalLowerer: input.terminal,
        activeLoopRef,
      });

      return lowerForImpl({
        context: forInput.context,
        forStatement: forInput.statement,
        monoStatement: {
          statementId: forInput.sourceStatement.statementId,
          kind: { kind: "for", statement: forInput.statement },
          sourceOrigin: forInput.sourceStatement.sourceOrigin,
        },
        blockKey: forInput.blockKey,
        shared,
        call: input.call,
        take: input.take,
        callRecorder: input.callRecorder,
        loopCarriedLocals: [],
        continuationBlockKey,
      });
    },
  };
}
