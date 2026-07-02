import type { AArch64EncodingCatalog } from "../api/backend-catalog-interfaces";
import type { AArch64ObjectRelocationEncodingOwner } from "./object-module";

interface AArch64RelocationOwnerInstruction {
  readonly opcode: string;
  readonly relocation?: {
    readonly family: string;
  };
  readonly accessWidthBytes?: number;
}

export function relocationEncodingOwnerForInstruction(
  instruction: AArch64RelocationOwnerInstruction,
  encodingCatalog: AArch64EncodingCatalog,
): AArch64ObjectRelocationEncodingOwner | undefined {
  return relocationEncodingOwnerForOpcode(
    instruction.opcode,
    instruction.relocation?.family,
    instruction.accessWidthBytes,
    encodingCatalog,
  );
}

export function relocationEncodingOwnerForOpcode(
  opcode: string,
  relocationFamily: string | undefined,
  accessWidthBytes: number | undefined,
  encodingCatalog: AArch64EncodingCatalog,
): AArch64ObjectRelocationEncodingOwner | undefined {
  const catalogEntry = encodingCatalog.entryForOpcode(opcode);
  if (catalogEntry?.relocationHole === undefined) return undefined;
  return {
    opcode: catalogEntry.opcode,
    catalogEntryKey: catalogEntry.relocationHole.owner ?? catalogEntry.opcode,
    ...(relocationFamily === "pageoffset-12l" && accessWidthBytes !== undefined
      ? { accessScaleBytes: accessWidthBytes }
      : {}),
  };
}
