import type {
  MonoExpression,
  MonoIfStatement,
  MonoLocal,
  MonoStatement,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { complementProofMirComparisonOperator } from "../domains/fact-recording";
import {
  proofMirSsaKeyString,
  proofMirSsaLocalKey,
  type ProofMirSsaKey,
} from "../domains/graph-ssa";
import { draftLocalKey } from "../draft/draft-keys";
import type { ProofMirComparisonOperator } from "../model/facts";
import type {
  DraftProofMirFactDependency,
  DraftProofMirFactOperand,
} from "../draft/draft-fact-operands";
import { originForStatement } from "./lowering-origins";
import { operandValueKey } from "./lowering-operands";
import { blockHasExitTerminator } from "./control-flow-terminators";
import type { ProofMirLoweringIdAllocator } from "./expression-lowerer-helpers";
import { createLoweringIdAllocator } from "./expression-lowerer-helpers";
import {
  type ProofMirControlFlowLowerer,
  type ProofMirControlFlowLoweringInput,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
} from "./lowering-context";

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

function mapComparisonOperator(operator: string): ProofMirComparisonOperator | undefined {
  switch (operator) {
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

function draftValueOperand(valueKey: ProofMirCanonicalKey): DraftProofMirFactOperand {
  return { kind: "value", valueKey };
}

function draftValueDependency(valueKey: ProofMirCanonicalKey): DraftProofMirFactDependency {
  return { kind: "value", valueKey };
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

function buildBooleanBranchFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
  readonly idAllocator: ProofMirLoweringIdAllocator;
}): readonly ProofMirCanonicalKey[] {
  const factKey = input.context.factRecorder.recordComparisonFact({
    role: "candidate",
    left: draftValueOperand(input.conditionValueKey),
    operator: "eq",
    right: { kind: "bool", value: input.edge === "true" },
    dependsOn: [draftValueDependency(input.conditionValueKey)],
    origin: input.originKey,
  });
  return factKey === undefined ? [] : [factKey];
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

function buildComparisonBranchFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly operator: ProofMirComparisonOperator;
  readonly leftValueKey: ProofMirCanonicalKey;
  readonly rightValueKey: ProofMirCanonicalKey;
  readonly conditionValueKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly edge: "true" | "false";
  readonly idAllocator: ProofMirLoweringIdAllocator;
}): readonly ProofMirCanonicalKey[] {
  const operator =
    input.edge === "true" ? input.operator : complementProofMirComparisonOperator(input.operator);
  const factKey = input.context.factRecorder.recordComparisonFact({
    role: "candidate",
    left: draftValueOperand(input.leftValueKey),
    operator,
    right: draftValueOperand(input.rightValueKey),
    dependsOn: [
      draftValueDependency(input.conditionValueKey),
      draftValueDependency(input.leftValueKey),
      draftValueDependency(input.rightValueKey),
    ],
    origin: input.originKey,
  });
  return factKey === undefined ? [] : [factKey];
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
      return leftLowered;
    }
    const rightLowered = input.expression.lowerExpression({
      context: input.context,
      expression: input.conditionExpression.kind.right,
      blockKey: input.blockKey,
    });
    if (rightLowered.kind === "error") {
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
        idAllocator: input.idAllocator,
      }),
    );
  }

  return loweringOk(
    buildBooleanBranchFactKeys({
      context: input.context,
      conditionValueKey: input.conditionValueKey,
      originKey: input.originKey,
      edge: input.edge,
      idAllocator: input.idAllocator,
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
}): ProofMirLoweringResult<void> {
  input.context.ssa.registerBlock(input.blockKey);
  for (const statement of input.statements) {
    if (blockHasExitTerminator(input.context, input.blockKey)) {
      return loweringOk(undefined);
    }
    if (statement.kind.kind === "return") {
      const lowered = input.terminalLowerer.lowerReturn({
        context: input.context,
        expression: statement.kind.expression,
        blockKey: input.blockKey,
        terminal: false,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      continue;
    }
    const lowered = input.statementLowerer.lowerStatement({
      context: input.context,
      statement,
      blockKey: input.blockKey,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
  }
  return loweringOk(undefined);
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

  const trueFacts = buildBranchFactKeys({
    context: input.context,
    conditionExpression: input.ifStatement.condition,
    conditionValueKey,
    originKey,
    blockKey: input.blockKey,
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
    blockKey: input.blockKey,
    edge: "false",
    expression: input.expression,
    idAllocator: input.idAllocator,
  });
  if (falseFacts.kind === "error") {
    return falseFacts;
  }

  const currentScope = input.context.graph.block(input.blockKey).scopeKey;
  const thenBlockKey = input.context.graph.createBlock({
    role: "if.then",
    scope: currentScope,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:then`,
  });
  const elseBlockKey =
    input.ifStatement.elseBlock === undefined
      ? undefined
      : input.context.graph.createBlock({
          role: "if.else",
          scope: currentScope,
          origin: originKey,
          sourceOrigin: `${input.statement.sourceOrigin}:else`,
        });

  const scalarKeys = copyScalarSsaKeysForLocals(input.context, input.scalarLocals);
  const branchPointScalars = readScalarValuesAtBlock(input.context, input.blockKey, scalarKeys);

  const trueEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchTrue",
    fromBlock: input.blockKey,
    toBlock: thenBlockKey,
    sourceScope: currentScope,
    targetScope: currentScope,
    origin: originKey,
    factKeys: trueFacts.value,
  });
  const falseTargetBlockKey = elseBlockKey ?? input.continuationBlockKey;
  const falseEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchFalse",
    fromBlock: input.blockKey,
    toBlock: falseTargetBlockKey,
    sourceScope: currentScope,
    targetScope: input.context.graph.block(falseTargetBlockKey).scopeKey,
    origin: originKey,
    factKeys: falseFacts.value,
  });

  const setBranchResult = input.context.graph.setTerminator(input.blockKey, {
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
  });
  if (loweredThen.kind === "error") {
    return loweredThen;
  }
  const thenExits = blockHasExitTerminator(input.context, thenBlockKey);

  let elseExits = false;
  if (elseBlockKey !== undefined && input.ifStatement.elseBlock !== undefined) {
    const loweredElse = lowerArmStatements({
      context: input.context,
      expression: input.expression,
      statementLowerer: input.statementLowerer,
      terminalLowerer: input.terminalLowerer,
      blockKey: elseBlockKey,
      statements: input.ifStatement.elseBlock.statements,
    });
    if (loweredElse.kind === "error") {
      return loweredElse;
    }
    elseExits = blockHasExitTerminator(input.context, elseBlockKey);
  }

  let afterBlockKey = input.continuationBlockKey;
  let joinBlockKey: ProofMirCanonicalKey | undefined;

  if (!thenExits && !elseExits) {
    const thenScalars = readScalarValuesAtBlock(input.context, thenBlockKey, scalarKeys);
    const falseBranchScalars =
      elseBlockKey === undefined
        ? branchPointScalars
        : readScalarValuesAtBlock(input.context, elseBlockKey, scalarKeys);

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
        fromBlockKey: thenBlockKey,
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
          fromBlockKey: input.blockKey,
          argumentKeysBySsaKey: falseArguments,
        });
        input.context.ssa.setEdgeArguments({
          edgeKey: falseEdgeKey,
          argumentKeys: orderedEdgeArgumentKeys(falseArguments, joinScalarKeys),
        });
      } else {
        const wiredElse = wireFallThroughEdge({
          context: input.context,
          fromBlockKey: elseBlockKey,
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
        fromBlockKey: thenBlockKey,
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
          fromBlockKey: elseBlockKey,
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
          fromBlockKey: input.blockKey,
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
      fromBlockKey: thenBlockKey,
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
    if (elseBlockKey !== undefined) {
      const wiredElse = wireFallThroughEdge({
        context: input.context,
        fromBlockKey: elseBlockKey,
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
