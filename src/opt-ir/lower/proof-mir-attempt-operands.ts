import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ProofMirValueId } from "../../proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirFunction,
  ProofMirStatement,
} from "../../proof-mir/model/graph";

type MatchAttemptTerminator = Extract<
  ProofMirBlock["terminator"]["kind"],
  { readonly kind: "matchAttempt" }
>;

export function attemptStartInBlock(
  block: ProofMirBlock,
  attemptId: MatchAttemptTerminator["match"]["attemptId"],
): Extract<ProofMirStatement["kind"], { readonly kind: "attempt" }>["attempt"] | undefined {
  const attemptKey = proofMetadataIdKey(attemptId);
  for (const statement of block.statements) {
    if (statement.kind.kind !== "attempt") {
      continue;
    }
    if (proofMetadataIdKey(statement.kind.attempt.attemptId) === attemptKey) {
      return statement.kind.attempt;
    }
  }
  return undefined;
}

export function runtimeValueForAttemptOperand(
  function_: ProofMirFunction,
  attempt: Extract<ProofMirStatement["kind"], { readonly kind: "attempt" }>["attempt"],
): ProofMirValueId | undefined {
  const result = attempt.fallible.result;
  if (result === undefined) {
    return undefined;
  }
  switch (result.kind) {
    case "value":
    case "valueAndPlace":
      return result.value;
    case "place": {
      const place = function_.places.get(result.place);
      if (
        place !== undefined &&
        place.projection.length === 0 &&
        (place.root.kind === "runtimeTemporary" || place.root.kind === "blockParameter")
      ) {
        return place.root.valueId;
      }
      return undefined;
    }
  }
}
