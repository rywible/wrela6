import type { MonoMatchArm, MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirEdgeEffect } from "../domains/effects-resources";
import { blockHasExitTerminator } from "./control-flow-terminators";
import { lowerIfStatement } from "./if-lowerer";
import { monoPlaceForLocal, type ProofMirLoweringIdAllocator } from "./expression-lowerer-helpers";
import { originForStatement } from "./lowering-origins";
import type {
  ProofMirExpressionLowerer,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
  ProofMirStatementLowerer,
  ProofMirTerminalLowerer,
} from "./lowering-context";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export function bindingLocalEdgeEffects(input: {
  readonly context: ProofMirLoweringContext;
  readonly arm: MonoMatchArm;
  readonly originKey: ProofMirCanonicalKey;
}): readonly DraftProofMirEdgeEffect[] {
  return input.arm.bindingLocals.map((local) => {
    const monoPlace = monoPlaceForLocal({
      program: input.context.program,
      functionInstanceId: input.context.functionInstanceId,
      localId: local.localId,
      parameterId: local.parameterId,
      type: local.type,
      resourceKind: local.resourceKind,
      sourceOrigin: local.sourceOrigin,
    });
    const placeKey = input.context.effects.placeFromMono({
      monoPlace,
      originKey: input.originKey,
    });
    return { kind: "introducePlace", placeKey };
  });
}

export function lowerArmStatements(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statements: readonly MonoStatement[];
  readonly idAllocator: ProofMirLoweringIdAllocator;
}): ProofMirLoweringResult<{ readonly finalBlockKey: ProofMirCanonicalKey }> {
  let currentBlockKey = input.blockKey;
  input.context.ssa.registerBlock(currentBlockKey);
  for (const statement of input.statements) {
    if (blockHasExitTerminator(input.context, currentBlockKey)) {
      return loweringOk({ finalBlockKey: currentBlockKey });
    }
    if (statement.kind.kind === "return") {
      const lowered = input.terminalLowerer.lowerReturn({
        context: input.context,
        expression: statement.kind.expression,
        blockKey: currentBlockKey,
        terminal: false,
      });
      if (lowered.kind === "error") return lowered;
      continue;
    }
    if (statement.kind.kind === "if") {
      const originKey = originForStatement(input.context, statement);
      const continuationBlockKey = input.context.graph.createBlock({
        role: "match.arm.if.continuation",
        scope: input.context.graph.block(currentBlockKey).scopeKey,
        origin: originKey,
        sourceOrigin: `${statement.sourceOrigin}:continuation`,
      });
      input.context.ssa.registerBlock(continuationBlockKey);
      const lowered = lowerIfStatement({
        context: input.context,
        statement,
        ifStatement: statement.kind.statement,
        blockKey: currentBlockKey,
        expression: input.expression,
        statementLowerer: input.statementLowerer,
        terminalLowerer: input.terminalLowerer,
        continuationBlockKey,
        idAllocator: input.idAllocator,
        scalarLocals: [],
      });
      if (lowered.kind === "error") return lowered;
      currentBlockKey = lowered.value.afterBlockKey;
      continue;
    }
    const lowered = input.statementLowerer.lowerStatement({
      context: input.context,
      statement,
      blockKey: currentBlockKey,
    });
    if (lowered.kind === "error") return lowered;
  }
  return loweringOk({ finalBlockKey: currentBlockKey });
}
