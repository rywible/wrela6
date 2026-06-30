import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "./operations";

export type OptIrMemoryAccessOperation = Extract<
  OptIrOperation,
  { readonly memoryAccess: OptIrMemoryAccessDescriptor }
>;

export function hasMemoryAccess(
  operation: OptIrOperation,
): operation is OptIrMemoryAccessOperation {
  return "memoryAccess" in operation;
}

export function optIrOperationRuntimeKey(operation: OptIrOperation): string {
  if (
    (operation.kind === "runtimeCall" ||
      operation.kind === "sourceCall" ||
      operation.kind === "platformCall" ||
      operation.kind === "intrinsicCall") &&
    operation.target.kind === "runtime"
  ) {
    return operation.target.runtimeKey;
  }
  return "";
}
