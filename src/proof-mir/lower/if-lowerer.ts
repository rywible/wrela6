import type {
  MonoExpression,
  MonoIfStatement,
  MonoLocal,
  MonoStatement,
} from "../../mono/mono-hir";
import { instantiatedHirIdKey } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import {
  proofMirSsaKeyString,
  proofMirSsaLocalKey,
  type ProofMirSsaKey,
} from "../domains/graph-ssa";
import { draftLocalKey } from "../draft/draft-keys";
import type { ProofMirComparisonOperator } from "../model/facts";
import { originForStatement } from "./lowering-origins";
import { operandValueKey } from "./lowering-operands";
import { blockHasExitTerminator } from "./control-flow-terminators";
import type { ProofMirLoweringIdAllocator } from "./expression-lowerer-helpers";
import { createLoweringIdAllocator } from "./expression-lowerer-helpers";
import { activeBlockKey } from "./active-block-key";
import {
  type ProofMirControlFlowLowerer,
  type ProofMirControlFlowLoweringInput,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTailReturnPolicy,
  type ProofMirTerminalLowerer,
} from "./lowering-context";
import {
  buildBooleanBranchFactKeys,
  buildComparisonBranchFactKeys,
  derivedFieldStandaloneReadFallback,
} from "./branch-fact-lowering";
import { lowerProofMirTailReturnStatement } from "./tail-return";

export { createLoweringIdAllocator } from "./expression-lowerer-helpers";
export type { ProofMirLoweringIdAllocator } from "./expression-lowerer-helpers";

export interface CreateProofMirControlFlowLowererInput {
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statement: ProofMirStatementLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly currentBlockRef?: { blockKey?: ProofMirCanonicalKey };
  readonly continuationBlockRef?: { blockKey?: ProofMirCanonicalKey };
}

export interface IfLoweringEdgeView {
  readonly edgeKey: ProofMirCanonicalKey;
  readonly kind: string;
  readonly factKeys: readonly ProofMirCanonicalKey[];
  readonly arguments: readonly ProofMirCanonicalKey[];
}

export interface IfLoweringBlockParameterView {
  readonly parameterKind: { readonly kind: "copyScalar" | "proofFact" };
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function statementRolePrefix(statement: MonoStatement): string {
  return `stmt:${instantiatedHirIdKey(statement.statementId)}`;
}

function mapComparisonOperator(operator: string): ProofMirComparisonOperator | undefined {
  switch (operator.trim()) {
    case "==":
      return "eq";
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    default:
      return undefined;
  }
}

function copyScalarSsaKeysForLocals(
  context: ProofMirLoweringContext,
  locals: readonly MonoLocal[],
): readonly { readonly ssaKey: ProofMirSsaKey; readonly localKey: ProofMirCanonicalKey }[] {
  return locals
    .filter((local) => context.localClassifier.storageForLocal(local.localId) === "scalarSsa")
    .map((local) => ({
      ssaKey: proofMirSsaLocalKey(
        draftLocalKey({
          functionInstanceId: context.functionInstanceId,
          monoLocalId: local.localId,
        }),
      ),
      localKey: draftLocalKey({
        functionInstanceId: context.functionInstanceId,
        monoLocalId: local.localId,
      }),
    }));
}

function readScalarValuesAtBlock(
  context: ProofMirLoweringContext,
  blockKey: ProofMirCanonicalKey,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): Map<string, ProofMirCanonicalKey> {
  const values = new Map<string, ProofMirCanonicalKey>();
  for (const entry of scalarKeys) {
    const valueKey = context.ssa.readScalar({
      blockKey,
      ssaKey: entry.ssaKey,
    });
    if (valueKey !== undefined) {
      values.set(proofMirSsaKeyString(entry.ssaKey), valueKey);
    }
  }
  return values;
}

function scalarValuesDiffer(
  left: Map<string, ProofMirCanonicalKey>,
  right: Map<string, ProofMirCanonicalKey>,
): boolean {
  const keys = new Set([...left.keys(), ...right.keys()]);
  for (const key of keys) {
    if (left.get(key) !== right.get(key)) {
      return true;
    }
  }
  return false;
}

function buildBranchFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly conditionExpression: MonoExpression;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly blockKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
  readonly expression: ProofMirExpressionLowerer;
  readonly idAllocator: ProofMirLoweringIdAllocator;
}): ProofMirLoweringResult<readonly ProofMirCanonicalKey[]> {
  if (input.conditionExpression.kind.kind === "comparison") {
    const operator = mapComparisonOperator(input.conditionExpression.kind.operator);
    if (operator === undefined) {
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_STATEMENT_OPERATOR",
          message: "Proof MIR if lowering encountered an unknown comparison operator.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "comparison-operator",
          stableDetail: input.conditionExpression.kind.operator,
          sourceOrigin: input.conditionExpression.sourceOrigin,
        }),
      ]);
    }
    const leftLowered = input.expression.lowerExpression({
      context: input.context,
      expression: input.conditionExpression.kind.left,
      blockKey: input.blockKey,
    });
    if (leftLowered.kind === "error") {
      const fallback = derivedFieldStandaloneReadFallback({
        diagnostics: leftLowered.diagnostics,
        context: input.context,
        conditionValueKey: input.conditionValueKey,
        originKey: input.originKey,
        edge: input.edge,
      });
      if (fallback !== undefined) return fallback;
      return leftLowered;
    }
    const rightLowered = input.expression.lowerExpression({
      context: input.context,
      expression: input.conditionExpression.kind.right,
      blockKey: input.blockKey,
    });
    if (rightLowered.kind === "error") {
      const fallback = derivedFieldStandaloneReadFallback({
        diagnostics: rightLowered.diagnostics,
        context: input.context,
        conditionValueKey: input.conditionValueKey,
        originKey: input.originKey,
        edge: input.edge,
      });
      if (fallback !== undefined) return fallback;
      return rightLowered;
    }
    const leftValueKey = operandValueKey(leftLowered.value);
    const rightValueKey = operandValueKey(rightLowered.value);
    if (leftValueKey === undefined || rightValueKey === undefined) {
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
          message: "Proof MIR comparison branch facts require value operands.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "comparison-operands",
          stableDetail: "missing-value-operand",
        }),
      ]);
    }
    return loweringOk(
      buildComparisonBranchFactKeys({
        context: input.context,
        operator,
        leftValueKey,
        rightValueKey,
        conditionValueKey: input.conditionValueKey,
        originKey: input.originKey,
        edge: input.edge,
      }),
    );
  }

  return loweringOk(
    buildBooleanBranchFactKeys({
      context: input.context,
      conditionValueKey: input.conditionValueKey,
      originKey: input.originKey,
      edge: input.edge,
    }),
  );
}

function orderedEdgeArgumentKeys(
  argumentKeysBySsaKey: Readonly<Record<string, ProofMirCanonicalKey>>,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): readonly ProofMirCanonicalKey[] {
  return scalarKeys
    .map((entry) => argumentKeysBySsaKey[proofMirSsaKeyString(entry.ssaKey)])
    .filter((value): value is ProofMirCanonicalKey => value !== undefined);
}

function differingScalarKeys(
  left: Map<string, ProofMirCanonicalKey>,
  right: Map<string, ProofMirCanonicalKey>,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): readonly { readonly ssaKey: ProofMirSsaKey }[] {
  return scalarKeys.filter((entry) => {
    const key = proofMirSsaKeyString(entry.ssaKey);
    return left.get(key) !== right.get(key);
  });
}

function argumentMapForScalars(
  values: Map<string, ProofMirCanonicalKey>,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): Record<string, ProofMirCanonicalKey> {
  const argumentsBySsaKey: Record<string, ProofMirCanonicalKey> = {};
  for (const entry of scalarKeys) {
    const valueKey = values.get(proofMirSsaKeyString(entry.ssaKey));
    if (valueKey !== undefined) {
      argumentsBySsaKey[proofMirSsaKeyString(entry.ssaKey)] = valueKey;
    }
  }
  return argumentsBySsaKey;
}

function syncJoinBlockParameters(input: {
  readonly context: ProofMirLoweringContext;
  readonly joinBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<void> {
  for (const parameter of input.context.ssa.blockParameters(input.joinBlockKey)) {
    const addResult = input.context.graph.addBlockParameter(input.joinBlockKey, {
      valueKey: parameter.valueKey,
      role: parameter.parameterKind,
      origin: input.originKey,
    });
    if (addResult.kind === "error") {
      return addResult;
    }
  }
  return loweringOk(undefined);
}

function wireFallThroughEdge(input: {
  readonly context: ProofMirLoweringContext;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly argumentKeysBySsaKey: Readonly<Record<string, ProofMirCanonicalKey>>;
  readonly scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[];
  readonly role: string;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const fromScope = input.context.graph.block(input.fromBlockKey).scopeKey;
  const toScope = input.context.graph.block(input.toBlockKey).scopeKey;
  const orderedArguments = orderedEdgeArgumentKeys(input.argumentKeysBySsaKey, input.scalarKeys);
  const edgeKey = input.context.graph.createNormalEdge({
    role: input.role,
    fromBlock: input.fromBlockKey,
    toBlock: input.toBlockKey,
    sourceScope: fromScope,
    targetScope: toScope,
    origin: input.originKey,
    argumentKeys: orderedArguments,
  });
  input.context.ssa.registerPredecessorEdge({
    blockKey: input.toBlockKey,
    edgeKey,
    fromBlockKey: input.fromBlockKey,
    argumentKeysBySsaKey: input.argumentKeysBySsaKey,
  });
  input.context.ssa.setEdgeArguments({
    edgeKey,
    argumentKeys: orderedArguments,
  });
  const setTerminatorResult = input.context.graph.setTerminator(input.fromBlockKey, {
    kind: "goto",
    target: { edge: edgeKey, block: input.toBlockKey },
    origin: input.originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  return loweringOk(edgeKey);
}

function lowerArmStatements(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statements: readonly MonoStatement[];
  readonly tailReturn?: ProofMirTailReturnPolicy;
}): ProofMirLoweringResult<{ readonly afterBlockKey: ProofMirCanonicalKey }> {
  input.context.ssa.registerBlock(input.blockKey);
  if (input.context.blockTracking !== undefined) {
    input.context.blockTracking.currentBlockRef.blockKey = input.blockKey;
  }
  let currentBlockKey = input.blockKey;
  for (const [statementIndex, statement] of input.statements.entries()) {
    if (blockHasExitTerminator(input.context, currentBlockKey)) {
      return loweringOk({ afterBlockKey: currentBlockKey });
    }
    const tailReturn = lowerProofMirTailReturnStatement({
      context: input.context,
      terminalLowerer: input.terminalLowerer,
      statement,
      blockKey: currentBlockKey,
      lastStatement: statementIndex === input.statements.length - 1,
      tailReturn: input.tailReturn,
    });
    if (tailReturn.kind === "lowered") {
      if (tailReturn.result.kind === "error") {
        return tailReturn.result;
      }
      currentBlockKey = activeBlockKey(input.context, currentBlockKey);
      continue;
    }
    if (statement.kind.kind === "return") {
      const lowered = input.terminalLowerer.lowerReturn({
        context: input.context,
        expression: statement.kind.expression,
        blockKey: currentBlockKey,
        terminal: false,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      currentBlockKey = activeBlockKey(input.context, currentBlockKey);
      continue;
    }
    const lowered = input.statementLowerer.lowerStatement({
      context: input.context,
      statement,
      blockKey: currentBlockKey,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
    currentBlockKey = activeBlockKey(input.context, currentBlockKey);
  }
  return loweringOk({ afterBlockKey: currentBlockKey });
}

export function lowerIfStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly ifStatement: MonoIfStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirLoweringIdAllocator;
  readonly scalarLocals: readonly MonoLocal[];
  readonly tailReturn?: ProofMirTailReturnPolicy;
}): ProofMirLoweringResult<{
  readonly afterBlockKey: ProofMirCanonicalKey;
  readonly thenBlockKey: ProofMirCanonicalKey;
  readonly elseBlockKey?: ProofMirCanonicalKey;
  readonly joinBlockKey?: ProofMirCanonicalKey;
  readonly trueEdgeKey: ProofMirCanonicalKey;
  readonly falseEdgeKey: ProofMirCanonicalKey;
}> {
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });

  const loweredCondition = input.expression.lowerExpression({
    context: input.context,
    expression: input.ifStatement.condition,
    blockKey: input.blockKey,
  });
  if (loweredCondition.kind === "error") {
    return loweredCondition;
  }
  const conditionValueKey = operandValueKey(loweredCondition.value);
  if (conditionValueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR if condition must lower to a value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "if-condition",
        stableDetail: "missing-value-operand",
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }
  const branchBlockKey = activeBlockKey(input.context, input.blockKey);

  const trueFacts = buildBranchFactKeys({
    context: input.context,
    conditionExpression: input.ifStatement.condition,
    conditionValueKey,
    originKey,
    blockKey: branchBlockKey,
    edge: "true",
    expression: input.expression,
    idAllocator: input.idAllocator,
  });
  if (trueFacts.kind === "error") {
    return trueFacts;
  }
  const falseFacts = buildBranchFactKeys({
    context: input.context,
    conditionExpression: input.ifStatement.condition,
    conditionValueKey,
    originKey,
    blockKey: branchBlockKey,
    edge: "false",
    expression: input.expression,
    idAllocator: input.idAllocator,
  });
  if (falseFacts.kind === "error") {
    return falseFacts;
  }

  const currentScope = input.context.graph.block(branchBlockKey).scopeKey;
  const rolePrefix = statementRolePrefix(input.statement);
  const thenScope = input.context.graph.createScope({
    role: `block:${rolePrefix}:then`,
    parentScopeKey: currentScope,
    origin: originKey,
  });
  const thenBlockKey = input.context.graph.createBlock({
    role: "if.then",
    scope: thenScope,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:then`,
  });
  const elseScope =
    input.ifStatement.elseBlock === undefined
      ? undefined
      : input.context.graph.createScope({
          role: `block:${rolePrefix}:else`,
          parentScopeKey: currentScope,
          origin: originKey,
        });
  const elseBlockKey =
    elseScope === undefined
      ? undefined
      : input.context.graph.createBlock({
          role: "if.else",
          scope: elseScope,
          origin: originKey,
          sourceOrigin: `${input.statement.sourceOrigin}:else`,
        });

  const scalarKeys = copyScalarSsaKeysForLocals(input.context, input.scalarLocals);
  const branchPointScalars = readScalarValuesAtBlock(input.context, branchBlockKey, scalarKeys);

  const trueEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchTrue",
    fromBlock: branchBlockKey,
    toBlock: thenBlockKey,
    sourceScope: currentScope,
    targetScope: thenScope,
    origin: originKey,
    factKeys: trueFacts.value,
  });
  const falseTargetBlockKey = elseBlockKey ?? input.continuationBlockKey;
  const falseEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchFalse",
    fromBlock: branchBlockKey,
    toBlock: falseTargetBlockKey,
    sourceScope: currentScope,
    targetScope: elseScope ?? input.context.graph.block(falseTargetBlockKey).scopeKey,
    origin: originKey,
    factKeys: falseFacts.value,
  });

  const setBranchResult = input.context.graph.setTerminator(branchBlockKey, {
    kind: "branch",
    condition: conditionValueKey,
    whenTrue: { edge: trueEdgeKey, block: thenBlockKey },
    whenFalse: { edge: falseEdgeKey, block: falseTargetBlockKey },
    origin: originKey,
  });
  if (setBranchResult.kind === "error") {
    return setBranchResult;
  }

  const loweredThen = lowerArmStatements({
    context: input.context,
    expression: input.expression,
    statementLowerer: input.statementLowerer,
    terminalLowerer: input.terminalLowerer,
    blockKey: thenBlockKey,
    statements: input.ifStatement.thenBlock.statements,
    ...(input.tailReturn === undefined ? {} : { tailReturn: input.tailReturn }),
  });
  if (loweredThen.kind === "error") {
    return loweredThen;
  }
  const thenExitBlockKey = loweredThen.value.afterBlockKey;
  const thenExits = blockHasExitTerminator(input.context, thenExitBlockKey);

  let elseExits = false;
  let elseExitBlockKey = elseBlockKey;
  if (elseBlockKey !== undefined && input.ifStatement.elseBlock !== undefined) {
    const loweredElse = lowerArmStatements({
      context: input.context,
      expression: input.expression,
      statementLowerer: input.statementLowerer,
      terminalLowerer: input.terminalLowerer,
      blockKey: elseBlockKey,
      statements: input.ifStatement.elseBlock.statements,
      ...(input.tailReturn === undefined ? {} : { tailReturn: input.tailReturn }),
    });
    if (loweredElse.kind === "error") {
      return loweredElse;
    }
    elseExitBlockKey = loweredElse.value.afterBlockKey;
    elseExits = blockHasExitTerminator(input.context, elseExitBlockKey);
  }

  let afterBlockKey = input.continuationBlockKey;
  let joinBlockKey: ProofMirCanonicalKey | undefined;

  if (!thenExits && !elseExits) {
    const thenScalars = readScalarValuesAtBlock(input.context, thenExitBlockKey, scalarKeys);
    const falseBranchScalars =
      elseExitBlockKey === undefined
        ? branchPointScalars
        : readScalarValuesAtBlock(input.context, elseExitBlockKey, scalarKeys);

    if (scalarValuesDiffer(thenScalars, falseBranchScalars)) {
      const joinScalarKeys = differingScalarKeys(thenScalars, falseBranchScalars, scalarKeys);
      joinBlockKey = input.context.graph.createBlock({
        role: "if.join",
        scope: currentScope,
        origin: originKey,
        sourceOrigin: `${input.statement.sourceOrigin}:join`,
      });
      input.context.ssa.registerBlock(joinBlockKey);
      afterBlockKey = joinBlockKey;

      const thenArguments = argumentMapForScalars(thenScalars, joinScalarKeys);
      const wiredThen = wireFallThroughEdge({
        context: input.context,
        fromBlockKey: thenExitBlockKey,
        toBlockKey: joinBlockKey,
        originKey,
        argumentKeysBySsaKey: thenArguments,
        scalarKeys: joinScalarKeys,
        role: "if.join:then",
      });
      if (wiredThen.kind === "error") {
        return wiredThen;
      }

      const falseArguments = argumentMapForScalars(falseBranchScalars, joinScalarKeys);
      if (elseBlockKey === undefined) {
        input.context.ssa.registerPredecessorEdge({
          blockKey: joinBlockKey,
          edgeKey: falseEdgeKey,
          fromBlockKey: branchBlockKey,
          argumentKeysBySsaKey: falseArguments,
        });
        input.context.ssa.setEdgeArguments({
          edgeKey: falseEdgeKey,
          argumentKeys: orderedEdgeArgumentKeys(falseArguments, joinScalarKeys),
        });
      } else {
        const wiredElse = wireFallThroughEdge({
          context: input.context,
          fromBlockKey: elseExitBlockKey ?? elseBlockKey,
          toBlockKey: joinBlockKey,
          originKey,
          argumentKeysBySsaKey: falseArguments,
          scalarKeys: joinScalarKeys,
          role: "if.join:else",
        });
        if (wiredElse.kind === "error") {
          return wiredElse;
        }
      }

      input.context.ssa.sealBlock(joinBlockKey);
      for (const entry of joinScalarKeys) {
        input.context.ssa.readScalar({
          blockKey: joinBlockKey,
          ssaKey: entry.ssaKey,
        });
      }
      const syncJoin = syncJoinBlockParameters({
        context: input.context,
        joinBlockKey,
        originKey,
      });
      if (syncJoin.kind === "error") {
        return syncJoin;
      }
    } else {
      const wiredThen = wireFallThroughEdge({
        context: input.context,
        fromBlockKey: thenExitBlockKey,
        toBlockKey: input.continuationBlockKey,
        originKey,
        argumentKeysBySsaKey: Object.fromEntries(thenScalars.entries()),
        scalarKeys,
        role: "if.continuation:then",
      });
      if (wiredThen.kind === "error") {
        return wiredThen;
      }
      if (elseBlockKey !== undefined) {
        const wiredElse = wireFallThroughEdge({
          context: input.context,
          fromBlockKey: elseExitBlockKey ?? elseBlockKey,
          toBlockKey: input.continuationBlockKey,
          originKey,
          argumentKeysBySsaKey: Object.fromEntries(falseBranchScalars.entries()),
          scalarKeys,
          role: "if.continuation:else",
        });
        if (wiredElse.kind === "error") {
          return wiredElse;
        }
      } else {
        input.context.ssa.registerPredecessorEdge({
          blockKey: input.continuationBlockKey,
          edgeKey: falseEdgeKey,
          fromBlockKey: branchBlockKey,
          argumentKeysBySsaKey: Object.fromEntries(falseBranchScalars.entries()),
        });
        input.context.ssa.setEdgeArguments({
          edgeKey: falseEdgeKey,
          argumentKeys: orderedEdgeArgumentKeys(
            Object.fromEntries(falseBranchScalars.entries()),
            scalarKeys,
          ),
        });
      }
    }
  } else if (!thenExits) {
    const wiredThen = wireFallThroughEdge({
      context: input.context,
      fromBlockKey: thenExitBlockKey,
      toBlockKey: input.continuationBlockKey,
      originKey,
      argumentKeysBySsaKey: {},
      scalarKeys: [],
      role: "if.continuation:then",
    });
    if (wiredThen.kind === "error") {
      return wiredThen;
    }
  } else if (!elseExits) {
    if (elseExitBlockKey !== undefined) {
      const wiredElse = wireFallThroughEdge({
        context: input.context,
        fromBlockKey: elseExitBlockKey,
        toBlockKey: input.continuationBlockKey,
        originKey,
        argumentKeysBySsaKey: {},
        scalarKeys: [],
        role: "if.continuation:else",
      });
      if (wiredElse.kind === "error") {
        return wiredElse;
      }
    }
  }

  return loweringOk({
    afterBlockKey,
    thenBlockKey,
    ...(elseBlockKey === undefined ? {} : { elseBlockKey }),
    ...(joinBlockKey === undefined ? {} : { joinBlockKey }),
    trueEdgeKey,
    falseEdgeKey,
  });
}

export function createProofMirControlFlowLowerer(
  input: CreateProofMirControlFlowLowererInput,
): ProofMirControlFlowLowerer {
  const idAllocator = createLoweringIdAllocator();
  return {
    lowerControlFlowStatement(
      loweringInput: ProofMirControlFlowLoweringInput,
    ): ProofMirLoweringResult<void> {
      if (loweringInput.statement.kind.kind !== "if") {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Proof MIR control-flow lowerer does not handle this mono statement kind.",
            functionInstanceId: loweringInput.context.functionInstanceId,
            ownerKey: `function:${String(loweringInput.context.functionInstanceId)}`,
            rootCauseKey: "mono-statement",
            stableDetail: loweringInput.statement.kind.kind,
            sourceOrigin: loweringInput.statement.sourceOrigin,
          }),
        ]);
      }

      const continuationBlockKey =
        input.continuationBlockRef?.blockKey ??
        loweringInput.context.graph.createBlock({
          role: "continuation",
          scope: loweringInput.context.graph.block(loweringInput.blockKey).scopeKey,
          origin: originForStatement(loweringInput.context, loweringInput.statement),
        });
      loweringInput.context.ssa.registerBlock(continuationBlockKey);
      if (input.continuationBlockRef !== undefined) {
        input.continuationBlockRef.blockKey = continuationBlockKey;
      }

      const lowered = lowerIfStatement({
        context: loweringInput.context,
        statement: loweringInput.statement,
        ifStatement: loweringInput.statement.kind.statement,
        blockKey: loweringInput.blockKey,
        expression: input.expression,
        statementLowerer: input.statement,
        terminalLowerer: input.terminal,
        continuationBlockKey,
        idAllocator,
        scalarLocals: [],
        ...(loweringInput.tailReturn === undefined ? {} : { tailReturn: loweringInput.tailReturn }),
      });
      if (lowered.kind === "error") {
        return lowered;
      }

      if (input.currentBlockRef !== undefined) {
        input.currentBlockRef.blockKey = lowered.value.afterBlockKey;
      }
      return loweringOk(undefined);
    },
  };
}
