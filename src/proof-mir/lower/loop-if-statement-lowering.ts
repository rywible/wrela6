import type { MonoIfStatement, MonoLocal, MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirLoweringResult, ProofMirStatementLowerer } from "./lowering-context";
import { createLoweringIdAllocator, lowerIfStatement } from "./if-lowerer";
import type { LoopLoweringSharedInput } from "./loop-lowering-types";
import type { ProofMirLoweringContext } from "./lowering-context";

export type LowerIfStatementInBodyResult = ProofMirLoweringResult<{
  readonly afterBlockKey: ProofMirCanonicalKey;
  readonly thenBlockKey: ProofMirCanonicalKey;
  readonly elseBlockKey?: ProofMirCanonicalKey;
  readonly joinBlockKey?: ProofMirCanonicalKey;
  readonly trueEdgeKey: ProofMirCanonicalKey;
  readonly falseEdgeKey: ProofMirCanonicalKey;
}>;

export type LowerIfStatementInBody = (input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly ifStatement: MonoIfStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly idAllocator: ReturnType<typeof createLoweringIdAllocator>;
  readonly scalarLocals: readonly MonoLocal[];
}) => LowerIfStatementInBodyResult;

export function createLoopIfStatementInBodyLowering(
  shared: Pick<LoopLoweringSharedInput, "expression" | "terminalLowerer">,
): LowerIfStatementInBody {
  const defaultIdAllocator = createLoweringIdAllocator();
  return (ifInput) =>
    lowerIfStatement({
      context: ifInput.context,
      statement: ifInput.statement,
      ifStatement: ifInput.ifStatement,
      blockKey: ifInput.blockKey,
      expression: shared.expression,
      statementLowerer: ifInput.statementLowerer,
      terminalLowerer: shared.terminalLowerer,
      continuationBlockKey: ifInput.continuationBlockKey,
      idAllocator: ifInput.idAllocator ?? defaultIdAllocator,
      scalarLocals: ifInput.scalarLocals,
    });
}

export function withLoopIfStatementLowering(
  shared: Omit<LoopLoweringSharedInput, "lowerIfStatementInBody">,
): LoopLoweringSharedInput {
  return {
    ...shared,
    lowerIfStatementInBody: createLoopIfStatementInBodyLowering(shared),
  };
}
