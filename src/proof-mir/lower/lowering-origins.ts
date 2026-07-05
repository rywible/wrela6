import type { MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirLoweringContext } from "./lowering-context";

export function originForStatement(
  context: ProofMirLoweringContext,
  statement: MonoStatement,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: statement.sourceOrigin,
    monoStatementId: statement.statementId,
  });
}
