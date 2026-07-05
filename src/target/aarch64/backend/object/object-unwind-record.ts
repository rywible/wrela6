import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { aarch64ObjectSectionId, type AArch64ObjectSectionId } from "../api/ids";

export interface AArch64ObjectUnwindRecord {
  readonly stableKey: string;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly frameShape: string;
  readonly frameSizeBytes?: number;
  readonly savedRegisters: readonly string[];
}

export function aarch64ObjectUnwindRecord(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly frameShape: string;
  readonly frameSizeBytes?: number;
  readonly savedRegisters?: readonly string[];
}): AArch64ObjectUnwindRecord {
  return Object.freeze({
    stableKey: String(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    frameShape: input.frameShape,
    ...(input.frameSizeBytes === undefined ? {} : { frameSizeBytes: input.frameSizeBytes }),
    savedRegisters: Object.freeze([...(input.savedRegisters ?? [])].sort(compareCodeUnitStrings)),
  });
}
