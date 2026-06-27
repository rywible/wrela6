import type { MonoLocal, MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type {
  ProofMirLoweringContext,
  ProofMirLoweringResult,
  ProofMirStatementLowerer,
} from "./lowering-context";
import { originForStatement } from "./lowering-origins";
import {
  createLoweringIdAllocator,
  type ProofMirLoweringIdAllocator,
} from "./expression-lowerer-helpers";
import {
  argumentMapForScalars,
  loweringError,
  loweringOk,
  readScalarValuesAtBlock,
  wireGotoEdge,
  wireLoopBackEdge,
} from "./loop-scaffold";
import { blockHasTerminator } from "./control-flow-terminators";
import type { ActiveLoopFrame, LoopLoweringSharedInput } from "./loop-lowering-types";

export { createLoweringIdAllocator };

function createLoopAwareStatementLowerer(input: {
  readonly shared: LoopLoweringSharedInput;
  readonly inner: ProofMirStatementLowerer;
}): ProofMirStatementLowerer {
  return {
    lowerStatement(statementInput): ProofMirLoweringResult<void> {
      switch (statementInput.statement.kind.kind) {
        case "break":
          return lowerBreakStatement({
            context: statementInput.context,
            statement: statementInput.statement,
            blockKey: statementInput.blockKey,
            shared: input.shared,
          });
        case "continue":
          return lowerContinueStatement({
            context: statementInput.context,
            statement: statementInput.statement,
            blockKey: statementInput.blockKey,
            shared: input.shared,
          });
        default:
          return input.inner.lowerStatement(statementInput);
      }
    },
  };
}

export function lowerBodyStatements(input: {
  readonly context: ProofMirLoweringContext;
  readonly shared: LoopLoweringSharedInput;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statements: readonly MonoStatement[];
  readonly scalarLocals: readonly MonoLocal[];
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly ifIdAllocator: ProofMirLoweringIdAllocator;
}): ProofMirLoweringResult<{ readonly tailBlockKey: ProofMirCanonicalKey }> {
  let currentBlockKey = input.blockKey;
  const loopAwareStatementLowerer = createLoopAwareStatementLowerer({
    shared: input.shared,
    inner: input.statementLowerer,
  });
  for (const statement of input.statements) {
    if (statement.kind.kind === "if") {
      const afterIfBlockKey = input.context.graph.createBlock({
        role: "loop.body.after-if",
        scope: input.context.graph.block(currentBlockKey).scopeKey,
        origin: input.context.graph.allocateSyntheticOrigin("loop:after-if"),
        sourceOrigin: `${statement.sourceOrigin}:after`,
      });
      input.context.ssa.registerBlock(afterIfBlockKey);
      const lowered = input.shared.lowerIfStatementInBody({
        context: input.context,
        statement,
        ifStatement: statement.kind.statement,
        blockKey: currentBlockKey,
        statementLowerer: loopAwareStatementLowerer,
        continuationBlockKey: afterIfBlockKey,
        idAllocator: input.ifIdAllocator,
        scalarLocals: input.scalarLocals,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      currentBlockKey = lowered.value.afterBlockKey;
      continue;
    }
    const lowered = dispatchLoopBodyStatement({
      context: input.context,
      shared: input.shared,
      statement,
      blockKey: currentBlockKey,
      scalarLocals: input.scalarLocals,
      continuationBlockKey: input.continuationBlockKey,
      statementLowerer: input.statementLowerer,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
    currentBlockKey = lowered.value.blockKey;
  }
  return loweringOk({ tailBlockKey: currentBlockKey });
}

export function lowerBreakStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
}): ProofMirLoweringResult<void> {
  const frame = input.shared.activeLoopRef.frame;
  if (frame === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Proof MIR break is only valid inside a structured loop.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "break-outside-loop",
        stableDetail: "break",
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });
  const wired = wireGotoEdge({
    context: input.context,
    fromBlockKey: input.blockKey,
    toBlockKey: frame.exitBlockKey,
    originKey,
    role: "loop.break",
    createEdge: (edgeInput) =>
      input.context.graph.createScopeBreakEdge({
        role: edgeInput.role,
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
        argumentKeys: edgeInput.argumentKeys,
      }),
    registerTarget: false,
  });
  if (wired.kind === "error") {
    return wired;
  }
  return loweringOk(undefined);
}

export function lowerContinueStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
}): ProofMirLoweringResult<void> {
  const frame = input.shared.activeLoopRef.frame;
  if (frame === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
        message: "Proof MIR continue is only valid inside a structured loop.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "continue-outside-loop",
        stableDetail: "continue",
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }
  const originKey = originForStatement(input.context, input.statement);
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });
  const bodyScalars = readScalarValuesAtBlock(
    input.context,
    input.blockKey,
    frame.loopCarriedScalarKeys,
  );
  const wired = wireGotoEdge({
    context: input.context,
    fromBlockKey: input.blockKey,
    toBlockKey: frame.headerBlockKey,
    originKey,
    argumentKeysBySsaKey: argumentMapForScalars(bodyScalars, frame.loopCarriedScalarKeys),
    scalarKeys: frame.loopCarriedScalarKeys,
    role: "loop.continue",
    createEdge: (edgeInput) =>
      input.context.graph.createScopeContinueEdge({
        role: edgeInput.role,
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
        argumentKeys: edgeInput.argumentKeys,
      }),
  });
  if (wired.kind === "error") {
    return wired;
  }
  return loweringOk(undefined);
}

export function finalizeStructuredLoopBody(input: {
  readonly context: ProofMirLoweringContext;
  readonly shared: LoopLoweringSharedInput;
  readonly frame: ActiveLoopFrame;
  readonly originKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly bodyStatements: readonly MonoStatement[];
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly statementLowerer: ProofMirStatementLowerer;
}): ProofMirLoweringResult<{ readonly backEdgeKey?: ProofMirCanonicalKey }> {
  input.shared.activeLoopRef.frame = input.frame;

  const loweredBody = lowerBodyStatements({
    context: input.context,
    shared: input.shared,
    blockKey: input.bodyBlockKey,
    statements: input.bodyStatements,
    scalarLocals: input.loopCarriedLocals,
    continuationBlockKey: input.continuationBlockKey,
    statementLowerer: input.statementLowerer,
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
      frame: input.frame,
      bodyBlockKey: loweredBody.value.tailBlockKey,
      originKey: input.originKey,
    });
    if (wiredBack.kind === "error") {
      return wiredBack;
    }
    backEdgeKey = wiredBack.value;
  }

  input.context.ssa.sealBlock(input.frame.headerBlockKey);
  return loweringOk(backEdgeKey === undefined ? {} : { backEdgeKey });
}

function dispatchLoopBodyStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly shared: LoopLoweringSharedInput;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly scalarLocals: readonly MonoLocal[];
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly statementLowerer: ProofMirStatementLowerer;
}): ProofMirLoweringResult<{ readonly blockKey: ProofMirCanonicalKey }> {
  switch (input.statement.kind.kind) {
    case "break": {
      const lowered = lowerBreakStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
        shared: input.shared,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
    case "continue": {
      const lowered = lowerContinueStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
        shared: input.shared,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
    case "return": {
      const lowered = input.shared.terminalLowerer.lowerReturn({
        context: input.context,
        expression: input.statement.kind.expression,
        blockKey: input.blockKey,
        terminal: false,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
    default: {
      const lowered = input.statementLowerer.lowerStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
  }
}
