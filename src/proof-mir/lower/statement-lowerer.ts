import type {
  MonoBlock,
  MonoExpression,
  MonoLocal,
  MonoResourcePlace,
  MonoStatement,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { proofMirSsaLocalKey } from "../domains/graph-ssa";
import type { DraftProofMirStatementKind } from "../draft/draft-statement";
import { draftLocalKey } from "../draft/draft-keys";
import type { ProofMirConsumeReason } from "../model/graph";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { createLoweringIdAllocator, monoPlaceForLocal } from "./expression-lowerer-helpers";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import { originForStatement } from "./lowering-origins";
import { operandPlaceKey, operandValueKey } from "./lowering-operands";
import {
  type ProofMirCallLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirStatementLoweringInput,
} from "./lowering-context";

export type DraftRecordedProofMirStatement =
  | {
      readonly kind: "defineScalar";
      readonly localKey: ProofMirCanonicalKey;
      readonly valueKey: ProofMirCanonicalKey;
      readonly blockKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "store";
      readonly placeKey: ProofMirCanonicalKey;
      readonly valueKey: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "movePlace";
      readonly placeKey: ProofMirCanonicalKey;
      readonly targetPlaceKey: ProofMirCanonicalKey;
      readonly resultKey?: ProofMirCanonicalKey;
    }
  | {
      readonly kind: "consumePlace";
      readonly placeKey: ProofMirCanonicalKey;
      readonly reason: ProofMirConsumeReason;
    };

export interface ProofMirStatementBodyRecorder {
  readonly entries: readonly DraftRecordedProofMirStatement[];
  record(entry: DraftRecordedProofMirStatement): void;
}

export interface CreateProofMirStatementLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly recorder?: ProofMirStatementBodyRecorder;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function createStatementBodyRecorder(): ProofMirStatementBodyRecorder {
  const entries: DraftRecordedProofMirStatement[] = [];
  return {
    get entries() {
      return entries.slice();
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

function localStorageKind(
  context: ProofMirLoweringContext,
  local: MonoLocal,
): "scalarSsa" | "placeBacked" | undefined {
  return context.localClassifier.storageForLocal(local.localId);
}

function ensureLocalRegistered(
  context: ProofMirLoweringContext,
  local: MonoLocal,
  originKey: ProofMirCanonicalKey,
): ProofMirCanonicalKey {
  const localKey = draftLocalKey({
    functionInstanceId: context.functionInstanceId,
    monoLocalId: local.localId,
  });
  const storage = localStorageKind(context, local);
  let backingPlaceKey: ProofMirCanonicalKey | undefined;
  if (storage === "placeBacked") {
    const targetPlace = monoPlaceForStatementLocal(context, local);
    const placeKeyResult = lowerPlaceBackedTarget(context, targetPlace, originKey);
    if (placeKeyResult.kind === "ok") {
      backingPlaceKey = placeKeyResult.value;
    }
  }
  context.graph.createLocal({
    monoLocalId: local.localId,
    name: local.name,
    origin: originKey,
    type: local.type,
    resourceKind: local.resourceKind,
    ...(storage === undefined ? {} : { storage }),
    ...(backingPlaceKey === undefined ? {} : { backingPlaceKey }),
  });
  return localKey;
}

function lowerPlaceBackedTarget(
  context: ProofMirLoweringContext,
  monoPlace: MonoResourcePlace,
  originKey: ProofMirCanonicalKey,
): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const lowered = context.functionScopePlaceLowerer.lowerMonoPlace({
    monoPlace,
    originKey,
  });
  if (lowered.kind !== "ok") {
    return lowered;
  }
  return loweringOk(
    syncLoweredPlaceToFunctionDraft({
      context,
      lowered: lowered.value,
      monoPlace,
    }),
  );
}

function recordGraphStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly kind: DraftProofMirStatementKind;
}): void {
  const statementKey = input.context.graph.addStatement(input.blockKey, {
    origin: input.originKey,
  });
  input.context.graph.recordLoweredStatement(input.blockKey, {
    statementKey,
    originKey: input.originKey,
    kind: input.kind,
  });
}

function recordPlaceAssignment(input: {
  readonly context: ProofMirLoweringContext;
  readonly recorder: ProofMirStatementBodyRecorder;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly targetPlaceKey: ProofMirCanonicalKey;
  readonly valueOperand: ProofMirDraftOperand;
  readonly consumeReason: ProofMirConsumeReason;
}): ProofMirLoweringResult<void> {
  const sourcePlaceKey = operandPlaceKey(input.valueOperand);
  const valueKey = operandValueKey(input.valueOperand);

  if (input.valueOperand.kind === "valueAndPlace" && sourcePlaceKey !== undefined) {
    input.recorder.record({
      kind: "consumePlace",
      placeKey: sourcePlaceKey,
      reason: input.consumeReason,
    });
    recordGraphStatement({
      context: input.context,
      blockKey: input.blockKey,
      originKey: input.originKey,
      idAllocator: input.idAllocator,
      kind: {
        kind: "consumePlace",
        placeKey: sourcePlaceKey,
        reason: input.consumeReason,
      },
    });
  }

  if (sourcePlaceKey !== undefined && valueKey === undefined) {
    input.recorder.record({
      kind: "movePlace",
      placeKey: sourcePlaceKey,
      targetPlaceKey: input.targetPlaceKey,
    });
    recordGraphStatement({
      context: input.context,
      blockKey: input.blockKey,
      originKey: input.originKey,
      idAllocator: input.idAllocator,
      kind: {
        kind: "movePlace",
        placeKey: sourcePlaceKey,
      },
    });
    return loweringOk(undefined);
  }

  if (valueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR assignment requires a value or place operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "assignment",
        stableDetail: "missing-assignment-operand",
      }),
    ]);
  }

  input.recorder.record({
    kind: "store",
    placeKey: input.targetPlaceKey,
    valueKey,
  });
  recordGraphStatement({
    context: input.context,
    blockKey: input.blockKey,
    originKey: input.originKey,
    idAllocator: input.idAllocator,
    kind: {
      kind: "store",
      placeKey: input.targetPlaceKey,
      valueKey,
    },
  });
  return loweringOk(undefined);
}

function lowerLetStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirStatementBodyRecorder;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly local: MonoLocal;
  readonly value?: MonoExpression;
}): ProofMirLoweringResult<void> {
  const originKey = originForStatement(input.context, input.statement);
  const localKey = ensureLocalRegistered(input.context, input.local, originKey);
  const storage = localStorageKind(input.context, input.local);

  if (storage === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR let lowering could not resolve local storage.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "let",
        stableDetail: `local:${input.local.name}`,
      }),
    ]);
  }

  if (input.value === undefined) {
    return loweringOk(undefined);
  }

  const loweredValue = input.expression.lowerExpression({
    context: input.context,
    expression: input.value,
    blockKey: input.blockKey,
  });
  if (loweredValue.kind === "error") {
    return loweredValue;
  }

  const valueOperand = loweredValue.value;

  if (storage === "scalarSsa") {
    const valueKey = operandValueKey(valueOperand);
    if (valueKey === undefined) {
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
          message: "Proof MIR scalar let requires a value operand.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "let",
          stableDetail: `local:${input.local.name}`,
        }),
      ]);
    }
    const ssaKey = proofMirSsaLocalKey(localKey);
    input.context.ssa.defineScalar({
      blockKey: input.blockKey,
      ssaKey,
      valueKey,
    });
    input.recorder.record({
      kind: "defineScalar",
      localKey,
      valueKey,
      blockKey: input.blockKey,
    });
    return loweringOk(undefined);
  }

  const targetPlace = monoPlaceForStatementLocal(input.context, input.local);
  const targetPlaceKey = lowerPlaceBackedTarget(input.context, targetPlace, originKey);
  if (targetPlaceKey.kind !== "ok") {
    return targetPlaceKey;
  }

  return recordPlaceAssignment({
    context: input.context,
    recorder: input.recorder,
    idAllocator: input.idAllocator,
    blockKey: input.blockKey,
    originKey,
    targetPlaceKey: targetPlaceKey.value,
    valueOperand,
    consumeReason: "move",
  });
}

function isPlaceBackedNameExpression(
  context: ProofMirLoweringContext,
  expression: MonoExpression,
): boolean {
  if (expression.kind.kind !== "name" || expression.kind.localId === undefined) {
    return false;
  }
  const storage = context.localClassifier.storageForLocal(expression.kind.localId);
  return storage !== undefined && storage !== "scalarSsa";
}

function lowerAssignmentValueOperand(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly value: MonoExpression;
  readonly blockKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  if (isPlaceBackedNameExpression(input.context, input.value)) {
    const asPlace = input.expression.lowerExpressionAsPlace({
      context: input.context,
      expression: input.value,
      blockKey: input.blockKey,
    });
    if (asPlace.kind === "ok") {
      return loweringOk(asPlace.value);
    }
  }

  return input.expression.lowerExpression({
    context: input.context,
    expression: input.value,
    blockKey: input.blockKey,
  });
}

function lowerAssignmentStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirStatementBodyRecorder;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly targetPlace?: MonoResourcePlace;
  readonly value: MonoExpression;
}): ProofMirLoweringResult<void> {
  const originKey = originForStatement(input.context, input.statement);
  const assignmentTarget =
    input.statement.kind.kind === "assignment" ? input.statement.kind.statement.target : undefined;
  if (
    assignmentTarget?.kind.kind === "name" &&
    assignmentTarget.kind.localId !== undefined &&
    input.targetPlace === undefined
  ) {
    const storage = input.context.localClassifier.storageForLocal(assignmentTarget.kind.localId);
    if (storage === "scalarSsa") {
      const loweredValue = input.expression.lowerExpression({
        context: input.context,
        expression: input.value,
        blockKey: input.blockKey,
      });
      if (loweredValue.kind === "error") {
        return loweredValue;
      }
      const valueKey = operandValueKey(loweredValue.value);
      if (valueKey === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
            message: "Proof MIR scalar assignment requires a value operand.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "assignment",
            stableDetail: assignmentTarget.kind.name,
          }),
        ]);
      }
      const localKey = draftLocalKey({
        functionInstanceId: input.context.functionInstanceId,
        monoLocalId: assignmentTarget.kind.localId,
      });
      const ssaKey = proofMirSsaLocalKey(localKey);
      input.context.ssa.defineScalar({
        blockKey: input.blockKey,
        ssaKey,
        valueKey,
      });
      input.recorder.record({
        kind: "defineScalar",
        localKey,
        valueKey,
        blockKey: input.blockKey,
      });
      return loweringOk(undefined);
    }
  }

  const targetPlace =
    input.targetPlace ??
    (() => {
      const target =
        input.statement.kind.kind === "assignment"
          ? input.statement.kind.statement.target
          : undefined;
      if (target?.kind.kind !== "name" || target.kind.localId === undefined) {
        return undefined;
      }
      return monoPlaceForStatementLocal(input.context, {
        localId: target.kind.localId,
        name: target.kind.name,
        type: target.type,
        resourceKind: target.resourceKind,
        mode: "ordinary",
        introducedBy: "sourceLet",
        sourceOrigin: target.sourceOrigin,
      });
    })();
  if (targetPlace === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR assignment requires a place-backed target.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "assignment",
        stableDetail: "missing-target-place",
      }),
    ]);
  }

  const targetPlaceKey = lowerPlaceBackedTarget(input.context, targetPlace, originKey);
  if (targetPlaceKey.kind !== "ok") {
    return targetPlaceKey;
  }

  const loweredValue = lowerAssignmentValueOperand({
    context: input.context,
    expression: input.expression,
    value: input.value,
    blockKey: input.blockKey,
  });
  if (loweredValue.kind === "error") {
    return loweredValue;
  }

  return recordPlaceAssignment({
    context: input.context,
    recorder: input.recorder,
    idAllocator: input.idAllocator,
    blockKey: input.blockKey,
    originKey,
    targetPlaceKey: targetPlaceKey.value,
    valueOperand: loweredValue.value,
    consumeReason: "move",
  });
}

function lowerBlockStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirStatementBodyRecorder;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly block: MonoBlock;
  readonly lowerStatement: ProofMirStatementLowerer["lowerStatement"];
}): ProofMirLoweringResult<void> {
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.createScope({
    role: `block:${String(originKey)}`,
    parentScopeKey: input.context.graph.block(input.blockKey).scopeKey,
    origin: originKey,
  });

  for (const nestedStatement of input.block.statements) {
    const lowered = input.lowerStatement({
      context: input.context,
      statement: nestedStatement,
      blockKey: input.blockKey,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
  }

  return loweringOk(undefined);
}

function monoPlaceForStatementLocal(
  context: ProofMirLoweringContext,
  local: MonoLocal,
): MonoResourcePlace {
  return monoPlaceForLocal({
    program: context.program,
    functionInstanceId: context.functionInstanceId,
    localId: local.localId,
    parameterId: local.parameterId,
    type: local.type,
    resourceKind: local.resourceKind,
    sourceOrigin: local.sourceOrigin,
  });
}

interface StatementLowererState {
  readonly recorder: ProofMirStatementBodyRecorder;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
}

function createStatementLowererImpl(state: StatementLowererState): ProofMirStatementLowerer {
  const lowerStatement = (input: ProofMirStatementLoweringInput): ProofMirLoweringResult<void> => {
    switch (input.statement.kind.kind) {
      case "let":
        return lowerLetStatement({
          context: input.context,
          expression: state.expression,
          recorder: state.recorder,
          idAllocator: state.idAllocator,
          statement: input.statement,
          blockKey: input.blockKey,
          local: input.statement.kind.statement.local,
          value: input.statement.kind.statement.value,
        });
      case "assignment":
        return lowerAssignmentStatement({
          context: input.context,
          expression: state.expression,
          recorder: state.recorder,
          idAllocator: state.idAllocator,
          statement: input.statement,
          blockKey: input.blockKey,
          targetPlace: input.statement.kind.statement.targetPlace,
          value: input.statement.kind.statement.value,
        });
      case "expression": {
        const expression = input.statement.kind.expression;
        if (expression.kind.kind === "call" && state.call !== undefined) {
          const lowered = state.call.lowerCall({
            context: input.context,
            call: expression.kind.call,
            monoExpressionId: expression.expressionId,
            blockKey: input.blockKey,
            resultType: expression.type,
            resultResourceKind: expression.resourceKind,
          });
          if (lowered.kind === "error") {
            return lowered;
          }
          return loweringOk(undefined);
        }
        const lowered = state.expression.lowerExpression({
          context: input.context,
          expression,
          blockKey: input.blockKey,
        });
        if (lowered.kind === "error") {
          return lowered;
        }
        return loweringOk(undefined);
      }
      case "block":
        return lowerBlockStatement({
          context: input.context,
          expression: state.expression,
          recorder: state.recorder,
          statement: input.statement,
          blockKey: input.blockKey,
          block: input.statement.kind.block,
          lowerStatement,
        });
      default:
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Proof MIR statement lowerer does not handle this mono statement kind.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "mono-statement",
            stableDetail: input.statement.kind.kind,
            sourceOrigin: input.statement.sourceOrigin,
          }),
        ]);
    }
  };

  return { lowerStatement };
}

export function createProofMirStatementLowerer(
  input: CreateProofMirStatementLowererInput,
): ProofMirStatementLowerer {
  const recorder = input.recorder ?? createStatementBodyRecorder();
  return createStatementLowererImpl({
    recorder,
    idAllocator: createLoweringIdAllocator(),
    expression: input.expression,
    ...(input.call !== undefined ? { call: input.call } : {}),
  });
}
