import type { OptIrOriginId, OptIrValueId } from "./ids";
import type { OptIrType } from "./types";

export type OptIrBlockParameterIncomingRole =
  | "entry"
  | "branchArgument"
  | "loopCarried"
  | "exception"
  | "phi";

export interface OptIrBlockParameter {
  readonly kind: "blockParameter";
  readonly valueId: OptIrValueId;
  readonly type: OptIrType;
  readonly incomingRole: OptIrBlockParameterIncomingRole;
  readonly originId: OptIrOriginId;
}

export function optIrBlockParameter(input: {
  readonly valueId: OptIrValueId;
  readonly type: OptIrType;
  readonly incomingRole: OptIrBlockParameterIncomingRole;
  readonly originId: OptIrOriginId;
}): OptIrBlockParameter {
  return {
    kind: "blockParameter",
    valueId: input.valueId,
    type: input.type,
    incomingRole: input.incomingRole,
    originId: input.originId,
  };
}
