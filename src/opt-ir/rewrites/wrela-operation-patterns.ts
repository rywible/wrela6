import { optIrOperationRuntimeKey } from "../operation-access";
import type { OptIrOperation } from "../operations";
import {
  optIrWrelaRuntimeKeyMatchesFamily,
  optIrWrelaRuntimeKeys,
  type OptIrWrelaRuntimeKey,
  type OptIrWrelaRuntimeKeyFamily,
} from "./wrela-runtime-keys";

export type MoveCopyWrapperKind = "copy" | "wrapper";

export function runtimeCatalogKeyForOperation(operation: OptIrOperation): string {
  return optIrOperationRuntimeKey(operation);
}

export function operationMatchesRuntimeCatalogKey(
  operation: OptIrOperation,
  key: OptIrWrelaRuntimeKey,
): boolean {
  return runtimeCatalogKeyForOperation(operation) === key;
}

export function operationMatchesRuntimeCatalogFamily(
  operation: OptIrOperation,
  family: OptIrWrelaRuntimeKeyFamily,
): boolean {
  return optIrWrelaRuntimeKeyMatchesFamily(runtimeCatalogKeyForOperation(operation), family);
}

export function classifyMoveCopyWrapper(
  operation: OptIrOperation,
): MoveCopyWrapperKind | undefined {
  if (!isRemovableMoveCopyWrapper(operation)) {
    return undefined;
  }
  return operationMatchesRuntimeCatalogKey(operation, optIrWrelaRuntimeKeys.copy)
    ? "copy"
    : "wrapper";
}

export function isRemovableMoveCopyWrapper(operation: OptIrOperation): boolean {
  return operationMatchesRuntimeCatalogFamily(operation, "moveCopyWrapper");
}

export function isCollapsiblePlatformWrapper(operation: OptIrOperation): boolean {
  if (
    operation.kind !== "sourceCall" &&
    operation.kind !== "platformCall" &&
    operation.kind !== "runtimeCall"
  ) {
    return false;
  }
  return operationMatchesRuntimeCatalogFamily(operation, "platformWrapper");
}

export type PacketParserRuntimeScope = "state" | "related";

export function operationMatchesPacketParserRuntimeKey(
  operation: OptIrOperation,
  scope: PacketParserRuntimeScope,
): boolean {
  return operationMatchesRuntimeCatalogFamily(
    operation,
    scope === "state" ? "packetParserState" : "packetParserRelated",
  );
}

export function operationMatchesRejectRuntimeKey(operation: OptIrOperation): boolean {
  return operationMatchesRuntimeCatalogFamily(operation, "rejectDiagnostic");
}

export function operationHasRejectDisplayName(operation: OptIrOperation): boolean {
  return operation.displayName?.includes("reject") === true;
}

export function isBoundsCheckRuntimeOperation(operation: OptIrOperation): boolean {
  return operationMatchesRuntimeCatalogKey(operation, optIrWrelaRuntimeKeys.boundsCheck);
}

export function isTerminalCleanupRuntimeOperation(operation: OptIrOperation): boolean {
  return operationMatchesRuntimeCatalogKey(operation, optIrWrelaRuntimeKeys.terminalCleanup);
}

export function isExternalRootRuntimeOperation(operation: OptIrOperation): boolean {
  return operationMatchesRuntimeCatalogKey(operation, optIrWrelaRuntimeKeys.externalRoot);
}
