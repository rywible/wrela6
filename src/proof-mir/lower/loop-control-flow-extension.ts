import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoBlock, MonoLocal, MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  ProofMirControlFlowLowerer,
  ProofMirControlFlowLoweringInput,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
} from "./lowering-context";
import { originForStatement } from "./lowering-origins";
import { lowerBreakStatement, lowerContinueStatement } from "./loop-body-lowering";
import { lowerInfiniteLoopStatement, lowerWhileStatement } from "./loop-lowerer";
import type { LoopLoweringSharedInput } from "./loop-lowering-types";
import { loweringOk } from "./loop-scaffold";

function loopBodyForStatement(statement: MonoStatement): MonoBlock | undefined {
  switch (statement.kind.kind) {
    case "while":
      return statement.kind.statement.body;
    case "loop":
      return statement.kind.body;
    default:
      return undefined;
  }
}

function resolveLoopCarriedLocalsForLowering(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly loopCarriedLocalsByStatementId: ReadonlyMap<string, readonly MonoLocal[]>;
}): readonly MonoLocal[] {
  const statementKey = instantiatedHirIdKey(input.statement.statementId);
  const fromMap = input.loopCarriedLocalsByStatementId.get(statementKey);
  if (fromMap !== undefined && fromMap.length > 0) {
    return fromMap;
  }
  const loopBody = loopBodyForStatement(input.statement);
  if (loopBody === undefined) {
    return [];
  }
  return input.context.localClassifier.collectLoopCarriedLocalsForLoop(loopBody);
}

function resolvePlaceBackedLocalsForLowering(input: {
  readonly context: ProofMirLoweringContext;
  readonly placeBackedLocals: readonly MonoLocal[];
}): readonly MonoLocal[] {
  if (input.placeBackedLocals.length > 0) {
    return input.placeBackedLocals;
  }
  return input.context.localClassifier.placeBackedLocals();
}

export function extendProofMirControlFlowLowererWithLoops(input: {
  readonly inner: ProofMirControlFlowLowerer;
  readonly shared: LoopLoweringSharedInput;
  readonly loopCarriedLocalsByStatementId: ReadonlyMap<string, readonly MonoLocal[]>;
  readonly placeBackedLocals: readonly MonoLocal[];
  readonly continuationBlockRef?: { blockKey?: ProofMirCanonicalKey };
  readonly currentBlockRef?: { blockKey?: ProofMirCanonicalKey };
}): ProofMirControlFlowLowerer {
  return {
    lowerControlFlowStatement(
      loweringInput: ProofMirControlFlowLoweringInput,
    ): ProofMirLoweringResult<void> {
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

      switch (loweringInput.statement.kind.kind) {
        case "while": {
          const loopCarriedLocals = resolveLoopCarriedLocalsForLowering({
            context: loweringInput.context,
            statement: loweringInput.statement,
            loopCarriedLocalsByStatementId: input.loopCarriedLocalsByStatementId,
          });
          const placeBackedLocals = resolvePlaceBackedLocalsForLowering({
            context: loweringInput.context,
            placeBackedLocals: input.placeBackedLocals,
          });
          const lowered = lowerWhileStatement({
            context: loweringInput.context,
            statement: loweringInput.statement,
            whileStatement: loweringInput.statement.kind.statement,
            blockKey: loweringInput.blockKey,
            continuationBlockKey,
            shared: input.shared,
            loopCarriedLocals,
            placeBackedLocals,
          });
          if (lowered.kind === "error") {
            return lowered;
          }
          if (input.currentBlockRef !== undefined) {
            input.currentBlockRef.blockKey = lowered.value.afterBlockKey;
          }
          return loweringOk(undefined);
        }
        case "loop": {
          const loopCarriedLocals = resolveLoopCarriedLocalsForLowering({
            context: loweringInput.context,
            statement: loweringInput.statement,
            loopCarriedLocalsByStatementId: input.loopCarriedLocalsByStatementId,
          });
          const placeBackedLocals = resolvePlaceBackedLocalsForLowering({
            context: loweringInput.context,
            placeBackedLocals: input.placeBackedLocals,
          });
          const lowered = lowerInfiniteLoopStatement({
            context: loweringInput.context,
            statement: loweringInput.statement,
            body: loweringInput.statement.kind.body,
            blockKey: loweringInput.blockKey,
            continuationBlockKey,
            shared: input.shared,
            loopCarriedLocals,
            placeBackedLocals,
          });
          if (lowered.kind === "error") {
            return lowered;
          }
          if (input.currentBlockRef !== undefined) {
            input.currentBlockRef.blockKey = lowered.value.afterBlockKey;
          }
          return loweringOk(undefined);
        }
        case "break":
          return lowerBreakStatement({
            context: loweringInput.context,
            statement: loweringInput.statement,
            blockKey: loweringInput.blockKey,
            shared: input.shared,
          });
        case "continue":
          return lowerContinueStatement({
            context: loweringInput.context,
            statement: loweringInput.statement,
            blockKey: loweringInput.blockKey,
            shared: input.shared,
          });
        default:
          return input.inner.lowerControlFlowStatement(loweringInput);
      }
    },
  };
}
