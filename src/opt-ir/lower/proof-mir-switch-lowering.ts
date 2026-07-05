import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofMirBlock } from "../../proof-mir/model/graph";
import type { ProofMirValueId } from "../../proof-mir/ids";
import type { OptIrOperationId, OptIrOriginId } from "../ids";
import type { OptIrTerminator } from "../terminators";
import type { ProofMirLoweringContext } from "./lower-checked-mir";
import { proofMirValueIdFor } from "./proof-mir-lowering-helpers";

type ProofMirSwitchTerminatorKind = Extract<
  ProofMirBlock["terminator"]["kind"],
  { readonly kind: "switch" }
>;

function lowerProofMirSwitchCaseLabel(input: {
  readonly function_: ProofMirFunction;
  readonly context: ProofMirLoweringContext;
  readonly scrutinee: ProofMirValueId;
  readonly label: string;
}): string {
  const type = input.function_.values.get(input.scrutinee)?.type;
  if (type === undefined) return input.label;
  return (
    input.context.target.sourceTypeAbi?.lowerSwitchCaseLabel?.({
      type,
      label: input.label,
    }) ?? input.label
  );
}

export function lowerProofMirSwitchTerminator(input: {
  readonly function_: ProofMirFunction;
  readonly switchKind: ProofMirSwitchTerminatorKind;
  readonly context: ProofMirLoweringContext;
  readonly operationId: OptIrOperationId;
  readonly originId: OptIrOriginId;
}): OptIrTerminator {
  const defaultTarget = input.switchKind.fallback ?? input.switchKind.cases.at(-1)?.target;
  if (defaultTarget === undefined) {
    input.context.diagnostics.push(
      `terminator:${String(input.operationId)}:unsupported-switch:empty`,
    );
    return { kind: "unreachable", operationId: input.operationId, originId: input.originId };
  }
  const explicitCases =
    input.switchKind.fallback === undefined
      ? input.switchKind.cases.slice(0, -1)
      : input.switchKind.cases;
  return {
    kind: "switch",
    operationId: input.operationId,
    scrutinee: proofMirValueIdFor(input.function_, input.switchKind.scrutinee, input.context),
    cases: Object.freeze(
      explicitCases.map((switchCase) =>
        Object.freeze({
          label: lowerProofMirSwitchCaseLabel({
            function_: input.function_,
            context: input.context,
            scrutinee: input.switchKind.scrutinee,
            label: switchCase.label,
          }),
          edge: input.context.allocator.edgeIdFor(
            input.function_.functionInstanceId,
            String(switchCase.target.edgeId),
          ),
        }),
      ),
    ),
    defaultEdge: input.context.allocator.edgeIdFor(
      input.function_.functionInstanceId,
      String(defaultTarget.edgeId),
    ),
    originId: input.originId,
  };
}
