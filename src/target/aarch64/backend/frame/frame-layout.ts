import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";

const MAX_AARCH64_FRAME_SIZE_BYTES = 16 * 1024 * 1024;

export interface AArch64FrameSlotRequest {
  readonly slotKey: string;
  readonly sizeBytes: number;
  readonly alignmentBytes: number;
  readonly role?: "callee-save" | "spill" | "local" | "wipe" | "outgoing";
  readonly securityLabel?: string;
  readonly wipeOnExit?: boolean;
  readonly generationKey?: string;
}

export interface AArch64FrameSlot {
  readonly slotKey: string;
  readonly offsetBytes: number;
  readonly sizeBytes: number;
  readonly alignmentBytes: number;
  readonly role: "callee-save" | "spill" | "local" | "wipe" | "outgoing";
  readonly securityLabel?: string;
}

export interface AArch64StackFrameLayout {
  readonly functionKey: string;
  readonly totalSizeBytes: number;
  readonly slots: readonly AArch64FrameSlot[];
  readonly wipeSlots: readonly AArch64FrameSlot[];
  readonly savedRegisters: readonly string[];
  readonly outgoingArgSizeBytes: number;
  readonly requiresFrameRecord: boolean;
}

export function layoutAArch64StackFrame(input: {
  readonly functionKey: string;
  readonly spillSlots?: readonly AArch64FrameSlotRequest[];
  readonly localSlots?: readonly AArch64FrameSlotRequest[];
  readonly savedRegisters?: readonly string[];
  readonly outgoingArgBytes?: number;
  readonly requiresFrameRecord?: boolean;
}): AArch64BackendResult<AArch64StackFrameLayout> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  let cursor = 0;
  const slots: AArch64FrameSlot[] = [];
  const requests: FramePlacementRequest[] = [
    ...[...(input.savedRegisters ?? [])].sort(compareCodeUnitStrings).map(
      (register: string): FramePlacementRequest => ({
        slotKey: `save:${register}`,
        sizeBytes: 8,
        alignmentBytes: 8,
        role: "callee-save",
      }),
    ),
    ...[...(input.spillSlots ?? [])]
      .filter((slot: AArch64FrameSlotRequest) => slot.wipeOnExit === true)
      .sort(bySlotKey)
      .map((slot: AArch64FrameSlotRequest) => ({ ...slot, role: "wipe" as const })),
    ...[...(input.spillSlots ?? [])]
      .filter((slot: AArch64FrameSlotRequest) => slot.wipeOnExit !== true)
      .sort(bySlotKey)
      .map((slot: AArch64FrameSlotRequest) => ({ ...slot, role: "spill" as const })),
    ...[...(input.localSlots ?? [])]
      .sort(bySlotKey)
      .map((slot: AArch64FrameSlotRequest) => ({ ...slot, role: "local" as const })),
  ];
  for (const request of requests) {
    cursor = align(cursor, request.alignmentBytes);
    if (cursor > 4095)
      diagnostics.push(
        diagnostic(
          `frame-layout:unencodable-offset:${input.functionKey}:${request.slotKey}:${-cursor}`,
        ),
      );
    slots.push({
      slotKey: request.slotKey,
      offsetBytes: -(cursor + request.sizeBytes),
      sizeBytes: request.sizeBytes,
      alignmentBytes: request.alignmentBytes,
      role: request.role,
      ...(request.securityLabel === undefined ? {} : { securityLabel: request.securityLabel }),
    });
    cursor += request.sizeBytes;
  }
  const outgoingArgSizeBytes = align(input.outgoingArgBytes ?? 0, 16);
  cursor += outgoingArgSizeBytes;
  const totalSizeBytes = align(cursor + (input.requiresFrameRecord === true ? 16 : 0), 16);
  if (totalSizeBytes > MAX_AARCH64_FRAME_SIZE_BYTES) {
    diagnostics.push(
      aarch64BackendDiagnostic({
        code: "AARCH64_FRAME_TOO_LARGE",
        ownerKey: "frame-layout",
        rootCauseKey: `frame-layout:frame-too-large:${input.functionKey}:${totalSizeBytes}`,
        stableDetail: `frame-layout:frame-too-large:${input.functionKey}:${totalSizeBytes}`,
      }),
    );
  }
  if (diagnostics.length > 0) return backendError(diagnostics);
  return backendOk(
    Object.freeze({
      functionKey: input.functionKey,
      totalSizeBytes,
      slots: Object.freeze(slots),
      wipeSlots: Object.freeze(slots.filter((slot) => slot.role === "wipe")),
      savedRegisters: Object.freeze([...(input.savedRegisters ?? [])].sort(compareCodeUnitStrings)),
      outgoingArgSizeBytes,
      requiresFrameRecord: input.requiresFrameRecord ?? false,
    }),
  );
}

function bySlotKey(left: AArch64FrameSlotRequest, right: AArch64FrameSlotRequest): number {
  return compareCodeUnitStrings(left.slotKey, right.slotKey);
}

type FramePlacementRequest = AArch64FrameSlotRequest & {
  readonly role: "callee-save" | "spill" | "local" | "wipe";
};

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FRAME_INVALID",
    ownerKey: "frame-layout",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
