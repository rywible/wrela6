import type { MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type {
  ProofMirLoweringContext,
  ProofMirLoweringResult,
  ProofMirTailReturnPolicy,
  ProofMirTerminalLowerer,
} from "./lowering-context";

export function proofMirTailReturnPolicy(input: {
  readonly returnKind: ProofMirTailReturnPolicy["returnKind"];
  readonly terminal: boolean;
  readonly lastStatement: boolean;
}): ProofMirTailReturnPolicy | undefined {
  if (!input.lastStatement || input.returnKind === "Never") {
    return undefined;
  }
  return {
    returnKind: input.returnKind,
    terminal: input.terminal,
  };
}

export type ProofMirTailReturnStatementResult =
  | { readonly kind: "not-tail-return" }
  | {
      readonly kind: "lowered";
      readonly result: ProofMirLoweringResult<void>;
    };

export function lowerProofMirTailReturnStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly lastStatement: boolean;
  readonly tailReturn?: ProofMirTailReturnPolicy;
}): ProofMirTailReturnStatementResult {
  if (
    input.tailReturn === undefined ||
    !input.lastStatement ||
    input.tailReturn.returnKind === "Never" ||
    input.statement.kind.kind !== "expression" ||
    input.statement.kind.expression.kind.kind === "attempt"
  ) {
    return { kind: "not-tail-return" };
  }
  return {
    kind: "lowered",
    result: input.terminalLowerer.lowerReturn({
      context: input.context,
      expression: input.statement.kind.expression,
      blockKey: input.blockKey,
      terminal: input.tailReturn.terminal,
    }),
  };
}
