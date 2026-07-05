import type { OptIrOperation } from "../../../opt-ir/operations";
import type { AArch64OperationMaterializationContext } from "./operation-materialization";
import { isCallOperation, platformCallTargetKey } from "./materialization-contracts";
import type { OperationOf } from "./operation-materialization-helpers";

export function operationMayMaterializeAArch64MachineCall(
  operation: OptIrOperation | undefined,
  materializationContext: AArch64OperationMaterializationContext | undefined,
): operation is OperationOf<"sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall"> {
  if (operation === undefined || !isCallOperation(operation)) {
    return false;
  }
  if (operation.kind === "platformCall") {
    const lowering = materializationContext?.firmware?.platformCalls?.loweringFor(
      platformCallTargetKey(operation.target),
    );
    if (lowering !== undefined) {
      return lowering.kind === "compiler-runtime-helper" || lowering.kind === "firmware-call";
    }
  }
  return true;
}
