import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoExpression } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirDraftOperand } from "./lowering-operands";
import type { ProofMirExpressionLoweringInput, ProofMirLoweringResult } from "./lowering-context";
import {
  invalidValueResourceKindDiagnostic,
  loweringError,
  loweringOk,
  originForExpression,
  type ProofMirExpressionLowererBlockKeyRef,
  requireBlockKey,
  unlowerableExpressionDiagnostic,
} from "./expression-lowerer-helpers";

export type LowerProofMirExpressionValue = (input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
}) => ProofMirLoweringResult<ProofMirDraftOperand>;

export function isShortCircuitLogicalExpression(expression: MonoExpression): boolean {
  return (
    expression.kind.kind === "binary" &&
    (expression.kind.operator.trim() === "and" || expression.kind.operator.trim() === "or")
  );
}

function valueOperand(valueKey: ProofMirCanonicalKey): ProofMirDraftOperand {
  return { kind: "value", value: valueKey };
}

export function lowerShortCircuitLogical(input: {
  readonly loweringInput: ProofMirExpressionLoweringInput;
  readonly expression: MonoExpression;
  readonly currentBlockRef?: ProofMirExpressionLowererBlockKeyRef;
  readonly lowerExpressionValue: LowerProofMirExpressionValue;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const { loweringInput, expression, currentBlockRef } = input;
  if (expression.kind.kind !== "binary") {
    return loweringError([
      unlowerableExpressionDiagnostic({
        functionInstanceId: loweringInput.context.functionInstanceId,
        stableDetail: "logical:shape",
        sourceOrigin: expression.sourceOrigin,
      }),
    ]);
  }

  const operator = expression.kind.operator.trim();
  const branchBlockKey = requireBlockKey(currentBlockRef, loweringInput.context.functionInstanceId);
  if (branchBlockKey.kind === "error") {
    return branchBlockKey;
  }

  const left = input.lowerExpressionValue({
    loweringInput: { ...loweringInput, blockKey: branchBlockKey.value },
    expression: expression.kind.left,
  });
  if (left.kind !== "ok" || left.value.kind !== "value") {
    return left.kind === "error"
      ? left
      : loweringError([
          invalidValueResourceKindDiagnostic({
            functionInstanceId: loweringInput.context.functionInstanceId,
            stableDetail: "logical:left",
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
  }

  const actualBranchBlockKey = requireBlockKey(
    currentBlockRef,
    loweringInput.context.functionInstanceId,
  );
  if (actualBranchBlockKey.kind === "error") {
    return actualBranchBlockKey;
  }

  const originKey = originForExpression(loweringInput.context, expression);
  const sourceScope = loweringInput.context.graph.block(actualBranchBlockKey.value).scopeKey;
  const rightBlockKey = loweringInput.context.graph.createBlock({
    role: `logical.${operator}.right`,
    scope: sourceScope,
    origin: originKey,
    sourceOrigin: `${expression.sourceOrigin}:logical-${operator}-right`,
  });
  const joinBlockKey = loweringInput.context.graph.createBlock({
    role: `logical.${operator}.join`,
    scope: sourceScope,
    origin: originKey,
    sourceOrigin: `${expression.sourceOrigin}:logical-${operator}-join`,
  });
  loweringInput.context.ssa.registerBlock(rightBlockKey);
  loweringInput.context.ssa.registerBlock(joinBlockKey);

  const resultKey = loweringInput.context.graph.createValue({
    role: `logical:${operator}:${instantiatedHirIdKey(expression.expressionId)}`,
    origin: originKey,
    type: expression.type,
    resourceKind: expression.resourceKind,
  });
  const addParameterResult = loweringInput.context.graph.addBlockParameter(joinBlockKey, {
    valueKey: resultKey,
    role: `logical:${operator}:result`,
    origin: originKey,
  });
  if (addParameterResult.kind === "error") {
    return loweringError(addParameterResult.diagnostics);
  }

  const evaluateRightOnTrue = operator === "and";
  const trueTargetBlockKey = evaluateRightOnTrue ? rightBlockKey : joinBlockKey;
  const falseTargetBlockKey = evaluateRightOnTrue ? joinBlockKey : rightBlockKey;
  const trueEdgeKey = loweringInput.context.graph.createBranchEdge({
    kind: "branchTrue",
    fromBlock: actualBranchBlockKey.value,
    toBlock: trueTargetBlockKey,
    sourceScope,
    targetScope: loweringInput.context.graph.block(trueTargetBlockKey).scopeKey,
    origin: originKey,
    argumentKeys: trueTargetBlockKey === joinBlockKey ? [left.value.value] : [],
  });
  const falseEdgeKey = loweringInput.context.graph.createBranchEdge({
    kind: "branchFalse",
    fromBlock: actualBranchBlockKey.value,
    toBlock: falseTargetBlockKey,
    sourceScope,
    targetScope: loweringInput.context.graph.block(falseTargetBlockKey).scopeKey,
    origin: originKey,
    argumentKeys: falseTargetBlockKey === joinBlockKey ? [left.value.value] : [],
  });
  const rightEntryEdgeKey = evaluateRightOnTrue ? trueEdgeKey : falseEdgeKey;
  const directJoinEdgeKey = evaluateRightOnTrue ? falseEdgeKey : trueEdgeKey;
  loweringInput.context.ssa.registerPredecessorEdge({
    blockKey: rightBlockKey,
    edgeKey: rightEntryEdgeKey,
    fromBlockKey: actualBranchBlockKey.value,
  });
  loweringInput.context.ssa.sealBlock(rightBlockKey);
  loweringInput.context.ssa.registerPredecessorEdge({
    blockKey: joinBlockKey,
    edgeKey: directJoinEdgeKey,
    fromBlockKey: actualBranchBlockKey.value,
  });

  const setBranchResult = loweringInput.context.graph.setTerminator(actualBranchBlockKey.value, {
    kind: "branch",
    condition: left.value.value,
    whenTrue: { edge: trueEdgeKey, block: trueTargetBlockKey },
    whenFalse: { edge: falseEdgeKey, block: falseTargetBlockKey },
    origin: originKey,
  });
  if (setBranchResult.kind === "error") {
    return loweringError(setBranchResult.diagnostics);
  }

  currentBlockRef!.blockKey = rightBlockKey;
  const right = input.lowerExpressionValue({
    loweringInput: { ...loweringInput, blockKey: rightBlockKey },
    expression: expression.kind.right,
  });
  if (right.kind !== "ok" || right.value.kind !== "value") {
    return right.kind === "error"
      ? right
      : loweringError([
          invalidValueResourceKindDiagnostic({
            functionInstanceId: loweringInput.context.functionInstanceId,
            stableDetail: "logical:right",
            sourceOrigin: expression.sourceOrigin,
          }),
        ]);
  }

  const actualRightBlockKey = requireBlockKey(
    currentBlockRef,
    loweringInput.context.functionInstanceId,
  );
  if (actualRightBlockKey.kind === "error") {
    return actualRightBlockKey;
  }
  const rightScope = loweringInput.context.graph.block(actualRightBlockKey.value).scopeKey;
  const rightJoinEdgeKey = loweringInput.context.graph.createNormalEdge({
    role: `logical.${operator}.join:right`,
    fromBlock: actualRightBlockKey.value,
    toBlock: joinBlockKey,
    sourceScope: rightScope,
    targetScope: loweringInput.context.graph.block(joinBlockKey).scopeKey,
    origin: originKey,
    argumentKeys: [right.value.value],
  });
  loweringInput.context.ssa.registerPredecessorEdge({
    blockKey: joinBlockKey,
    edgeKey: rightJoinEdgeKey,
    fromBlockKey: actualRightBlockKey.value,
  });
  const setRightTerminatorResult = loweringInput.context.graph.setTerminator(
    actualRightBlockKey.value,
    {
      kind: "goto",
      target: { edge: rightJoinEdgeKey, block: joinBlockKey },
      origin: originKey,
    },
  );
  if (setRightTerminatorResult.kind === "error") {
    return loweringError(setRightTerminatorResult.diagnostics);
  }
  loweringInput.context.ssa.sealBlock(joinBlockKey);
  currentBlockRef!.blockKey = joinBlockKey;
  return loweringOk(valueOperand(resultKey));
}
