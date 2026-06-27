import type { MonoBlock, MonoLocal, MonoStatement, MonoWhileStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirResourceBoundarySet } from "../domains/effects-resources";
import type { ProofMirLoweringContext, ProofMirLoweringResult } from "./lowering-context";
import { originForStatement } from "./lowering-origins";
import { operandValueKey } from "./lowering-operands";
import {
  createLoweringIdAllocator,
  finalizeStructuredLoopBody,
  lowerBodyStatements,
} from "./loop-body-lowering";
import {
  argumentMapForScalars,
  blockHasTerminator,
  collectPlaceBackedBoundaryKeys,
  copyScalarSsaKeysForLocals,
  loweringError,
  loweringOk,
  loopRoleForStatement,
  predeclareLoopHeaderParameters,
  readScalarValuesAtBlock,
  setupStructuredLoopScaffold,
  wireGotoEdge,
  wireLoopBackEdge,
} from "./loop-scaffold";
import type { ActiveLoopFrame, LoopLoweringSharedInput } from "./loop-lowering-types";

export type {
  ActiveLoopFrame,
  LoopLoweringBlockParameterView,
  LoopLoweringBlockView,
  LoopLoweringEdgeView,
  LoopLoweringSharedInput,
  StructuredLoopScaffold,
} from "./loop-lowering-types";
export {
  finalizeStructuredLoopBody,
  lowerBreakStatement,
  lowerContinueStatement,
  lowerBodyStatements,
} from "./loop-body-lowering";
export { setupStructuredLoopScaffold, wireLoopBackEdge } from "./loop-scaffold";
export { extendProofMirControlFlowLowererWithLoops } from "./loop-control-flow-extension";

export function lowerWhileStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly whileStatement: MonoWhileStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly placeBackedLocals: readonly MonoLocal[];
}): ProofMirLoweringResult<{
  readonly afterBlockKey: ProofMirCanonicalKey;
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly exitBlockKey: ProofMirCanonicalKey;
  readonly backEdgeKey?: ProofMirCanonicalKey;
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
}> {
  const boundaryPlaces = collectPlaceBackedBoundaryKeys({
    context: input.context,
    body: input.whileStatement.body,
    placeBackedLocals: input.placeBackedLocals,
  });
  const scaffold = setupStructuredLoopScaffold({
    context: input.context,
    statement: input.statement,
    blockKey: input.blockKey,
    continuationBlockKey: input.continuationBlockKey,
    shared: input.shared,
    loopCarriedLocals: input.loopCarriedLocals,
    boundaryPlaceKeys: boundaryPlaces,
  });
  if (scaffold.kind === "error") {
    return scaffold;
  }

  const {
    originKey,
    loopScopeKey,
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    boundaryResources,
    frame,
  } = scaffold.value;

  const loweredCondition = input.shared.expression.lowerExpression({
    context: input.context,
    expression: input.whileStatement.condition,
    blockKey: headerBlockKey,
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
        message: "Proof MIR while condition must lower to a value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "while-condition",
        stableDetail: "missing-value-operand",
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }

  const trueEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchTrue",
    fromBlock: headerBlockKey,
    toBlock: bodyBlockKey,
    sourceScope: loopScopeKey,
    targetScope: loopScopeKey,
    origin: originKey,
  });
  const falseEdgeKey = input.context.graph.createBranchEdge({
    kind: "branchFalse",
    fromBlock: headerBlockKey,
    toBlock: exitBlockKey,
    sourceScope: loopScopeKey,
    targetScope: input.context.graph.block(exitBlockKey).scopeKey,
    origin: originKey,
  });
  const setBranchResult = input.context.graph.setTerminator(headerBlockKey, {
    kind: "branch",
    condition: conditionValueKey,
    whenTrue: { edge: trueEdgeKey, block: bodyBlockKey },
    whenFalse: { edge: falseEdgeKey, block: exitBlockKey },
    origin: originKey,
  });
  if (setBranchResult.kind === "error") {
    return setBranchResult;
  }

  const finalized = finalizeStructuredLoopBody({
    context: input.context,
    shared: input.shared,
    frame,
    originKey,
    bodyBlockKey,
    bodyStatements: input.whileStatement.body.statements,
    loopCarriedLocals: input.loopCarriedLocals,
    continuationBlockKey: exitBlockKey,
    statementLowerer: input.shared.statementLowerer,
  });
  if (finalized.kind === "error") {
    return finalized;
  }

  return loweringOk({
    afterBlockKey: exitBlockKey,
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    ...finalized.value,
    boundaryResources,
  });
}

export function lowerInfiniteLoopStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly body: MonoBlock;
  readonly blockKey: ProofMirCanonicalKey;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly placeBackedLocals: readonly MonoLocal[];
}): ProofMirLoweringResult<{
  readonly afterBlockKey: ProofMirCanonicalKey;
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly exitBlockKey: ProofMirCanonicalKey;
  readonly backEdgeKey?: ProofMirCanonicalKey;
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
}> {
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });

  const parentScopeKey = input.context.graph.block(input.blockKey).scopeKey;
  const loopRole = loopRoleForStatement(input.statement);
  const loopScopeKey = input.context.graph.createScope({
    role: loopRole,
    parentScopeKey,
    origin: originKey,
  });
  const postLoopBlockKey = input.context.graph.createBlock({
    role: "continuation",
    scope: input.context.graph.block(input.blockKey).scopeKey,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:after`,
  });
  input.context.ssa.registerBlock(postLoopBlockKey);
  const exitBlockKey = postLoopBlockKey;
  const headerBlockKey = input.context.graph.createBlock({
    role: "loop.header",
    scope: loopScopeKey,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:header`,
  });
  const bodyBlockKey = input.context.graph.createBlock({
    role: "loop.body",
    scope: loopScopeKey,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:body`,
  });
  input.context.ssa.registerBlock(bodyBlockKey);

  const loopCarriedScalarKeys = copyScalarSsaKeysForLocals(input.context, input.loopCarriedLocals);
  const boundaryPlaces = collectPlaceBackedBoundaryKeys({
    context: input.context,
    body: input.body,
    placeBackedLocals: input.placeBackedLocals,
  });
  const boundaryResources = input.context.functionScopePlaceLowerer.collectLoopBoundarySet({
    loopRole,
    places: boundaryPlaces,
  });

  const predeclared = predeclareLoopHeaderParameters({
    context: input.context,
    headerBlockKey,
    originKey,
    entryBlockKey: input.blockKey,
    loopCarriedScalarKeys,
  });
  if (predeclared.kind === "error") {
    return predeclared;
  }

  const entryScalars = readScalarValuesAtBlock(
    input.context,
    input.blockKey,
    loopCarriedScalarKeys,
  );
  const entryToHeader = wireGotoEdge({
    context: input.context,
    fromBlockKey: input.blockKey,
    toBlockKey: headerBlockKey,
    originKey,
    argumentKeysBySsaKey: argumentMapForScalars(entryScalars, loopCarriedScalarKeys),
    scalarKeys: loopCarriedScalarKeys,
    role: "loop.entry",
    createEdge: (edgeInput) =>
      input.context.graph.createNormalEdge({
        role: edgeInput.role ?? "loop.entry",
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
        argumentKeys: edgeInput.argumentKeys,
      }),
  });
  if (entryToHeader.kind === "error") {
    return entryToHeader;
  }

  const headerToBody = wireGotoEdge({
    context: input.context,
    fromBlockKey: headerBlockKey,
    toBlockKey: bodyBlockKey,
    originKey,
    role: "loop.header-to-body",
    createEdge: (edgeInput) =>
      input.context.graph.createNormalEdge({
        role: edgeInput.role ?? "loop.header-to-body",
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
      }),
    registerTarget: false,
  });
  if (headerToBody.kind === "error") {
    return headerToBody;
  }

  const frame: ActiveLoopFrame = {
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    loopScopeKey,
    loopRole,
    loopCarriedScalarKeys,
    boundaryResources,
  };
  input.shared.activeLoopRef.frame = frame;

  const loweredBody = lowerBodyStatements({
    context: input.context,
    shared: input.shared,
    blockKey: bodyBlockKey,
    statements: input.body.statements,
    scalarLocals: input.loopCarriedLocals,
    continuationBlockKey: exitBlockKey,
    statementLowerer: input.shared.statementLowerer,
    ifIdAllocator: createLoweringIdAllocator(),
  });
  input.shared.activeLoopRef.frame = undefined;
  if (loweredBody.kind === "error") {
    return loweredBody;
  }

  let backEdgeKey: ProofMirCanonicalKey | undefined;
  if (!blockHasTerminator(input.context, loweredBody.value.tailBlockKey)) {
    const wiredBack = wireLoopBackEdge({
      context: input.context,
      frame,
      bodyBlockKey: loweredBody.value.tailBlockKey,
      originKey,
    });
    if (wiredBack.kind === "error") {
      return wiredBack;
    }
    backEdgeKey = wiredBack.value;
  }

  input.context.ssa.sealBlock(headerBlockKey);

  return loweringOk({
    afterBlockKey: exitBlockKey,
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    ...(backEdgeKey === undefined ? {} : { backEdgeKey }),
    boundaryResources,
  });
}
