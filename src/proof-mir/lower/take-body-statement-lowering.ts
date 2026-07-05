import type { MonoStatement, MonoTakeStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { blockHasExitTerminator } from "./control-flow-terminators";
import type {
  ProofMirControlFlowLowerer,
  ProofMirLoweringContext,
  ProofMirLoweringResult,
  ProofMirStatementLowerer,
  ProofMirTerminalLowerer,
  ProofMirValidationLowerer,
} from "./lowering-context";

export interface LowerProofMirTakeBodyStatementsInput {
  readonly context: ProofMirLoweringContext;
  readonly takeStatement: MonoTakeStatement;
  readonly takeBodyBlockKey: ProofMirCanonicalKey;
  readonly statement?: ProofMirStatementLowerer;
  readonly controlFlow?: ProofMirControlFlowLowerer;
  readonly terminal?: ProofMirTerminalLowerer;
  readonly validation?: ProofMirValidationLowerer;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export function lowerProofMirTakeBodyStatements(
  input: LowerProofMirTakeBodyStatementsInput,
): ProofMirLoweringResult<ProofMirCanonicalKey> {
  if (input.statement === undefined) {
    return loweringOk(input.takeBodyBlockKey);
  }

  const tracking = input.context.blockTracking;
  const previousCurrentBlock = tracking?.currentBlockRef.blockKey;
  const previousContinuationBlock = tracking?.continuationBlockRef.blockKey;
  if (tracking !== undefined) {
    tracking.currentBlockRef.blockKey = input.takeBodyBlockKey;
    tracking.continuationBlockRef.blockKey = undefined;
  }
  const restoreTracking = (): void => {
    if (tracking === undefined) {
      return;
    }
    tracking.currentBlockRef.blockKey = previousCurrentBlock;
    tracking.continuationBlockRef.blockKey = previousContinuationBlock;
  };

  let finalTakeBodyBlockKey = input.takeBodyBlockKey;
  for (const bodyStatement of input.takeStatement.body.statements) {
    if (blockHasExitTerminator(input.context, finalTakeBodyBlockKey)) {
      break;
    }
    const loweredBody = lowerTakeBodyStatement({
      ...input,
      statement: input.statement,
      bodyStatement,
      blockKey: finalTakeBodyBlockKey,
    });
    if (loweredBody.kind === "error") {
      restoreTracking();
      return loweredBody;
    }
    if (tracking?.currentBlockRef.blockKey !== undefined) {
      finalTakeBodyBlockKey = tracking.currentBlockRef.blockKey;
    }
  }
  restoreTracking();
  return loweringOk(finalTakeBodyBlockKey);
}

function lowerTakeBodyStatement(
  input: Omit<LowerProofMirTakeBodyStatementsInput, "statement"> & {
    readonly statement: ProofMirStatementLowerer;
    readonly bodyStatement: MonoStatement;
    readonly blockKey: ProofMirCanonicalKey;
  },
): ProofMirLoweringResult<void> {
  if (input.bodyStatement.kind.kind === "validationMatch" && input.validation !== undefined) {
    return input.validation.lowerValidation({
      context: input.context,
      statement: input.bodyStatement.kind.statement,
      blockKey: input.blockKey,
    });
  }
  if (input.controlFlow !== undefined && isControlFlowStatement(input.bodyStatement)) {
    return input.controlFlow.lowerControlFlowStatement({
      context: input.context,
      statement: input.bodyStatement,
      blockKey: input.blockKey,
    });
  }
  if (input.bodyStatement.kind.kind === "return" && input.terminal !== undefined) {
    return input.terminal.lowerReturn({
      context: input.context,
      expression: input.bodyStatement.kind.expression,
      blockKey: input.blockKey,
      terminal: false,
    });
  }
  return input.statement.lowerStatement({
    context: input.context,
    statement: input.bodyStatement,
    blockKey: input.blockKey,
  });
}

function isControlFlowStatement(statement: MonoStatement): boolean {
  switch (statement.kind.kind) {
    case "if":
    case "while":
    case "loop":
    case "match":
    case "break":
    case "continue":
      return true;
    default:
      return false;
  }
}
