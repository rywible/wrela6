import type { OptIrCallTarget } from "../calls";
import type { OptIrBlock } from "../cfg";
import type { OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";

export type SourceCallOperation = OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: Extract<OptIrCallTarget, { readonly kind: "source" }>;
  readonly argumentIds: readonly OptIrValueId[];
};

export function buildOperandSubstitution(
  callOperation: SourceCallOperation,
  entryBlock: OptIrBlock,
): ReadonlyMap<OptIrValueId, OptIrValueId> {
  const substitution = new Map<OptIrValueId, OptIrValueId>();
  entryBlock.parameters.forEach((parameter, index) => {
    const argumentId = callOperation.argumentIds[index];
    if (argumentId !== undefined) {
      substitution.set(parameter.valueId, argumentId);
    }
  });
  return substitution;
}

export function rewriteTerminatorValues(
  terminator: NonNullable<OptIrBlock["terminator"]>,
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
): NonNullable<OptIrBlock["terminator"]> {
  switch (terminator.kind) {
    case "return":
      return Object.freeze({
        ...terminator,
        values: Object.freeze(
          terminator.values.map((valueId) => valueForSubstitution(substitution, valueId)),
        ),
      });
    case "branch":
      return Object.freeze({
        ...terminator,
        condition: valueForSubstitution(substitution, terminator.condition),
      });
    case "switch":
      return Object.freeze({
        ...terminator,
        scrutinee: valueForSubstitution(substitution, terminator.scrutinee),
      });
    case "jump":
    case "unreachable":
      return terminator;
  }
}

export function valueForSubstitution(
  substitution: ReadonlyMap<OptIrValueId, OptIrValueId>,
  valueId: OptIrValueId,
): OptIrValueId {
  return substitution.get(valueId) ?? valueId;
}
