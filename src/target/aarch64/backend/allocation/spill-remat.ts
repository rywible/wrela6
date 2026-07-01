import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";

export interface AArch64AllocationRepairWorkItem {
  readonly requestKey: string;
  readonly vreg: number;
  readonly kind: "spill" | "reload" | "rematerialize";
  readonly useSiteKey: string;
  readonly widthBytes: number;
  readonly alignmentBytes?: number;
  readonly noSpill?: boolean;
  readonly wipeOnExit?: boolean;
  readonly frameOffsetBytes?: number;
}

export interface AArch64RematerializationAuthority {
  readonly vreg: number;
  readonly kind: "constant" | "page-base" | "literal" | "movz-movk";
  readonly legalAtUseSiteKeys: readonly string[];
  readonly constantValue?: bigint;
  readonly relocationPairKey?: string;
  readonly securityLabel?: string;
}

export type AArch64RematerializationRecipe = {
  readonly kind: "constant";
  readonly value: bigint;
};

export interface AArch64SpillSlotRequest {
  readonly slotKey: string;
  readonly vreg: number;
  readonly sizeBytes: number;
  readonly alignmentBytes: number;
  readonly wipeOnExit: boolean;
}

export interface AArch64RepairDraft {
  readonly stableKey: string;
  readonly kind: "spill" | "reload" | "remat";
  readonly vreg: number;
  readonly slotKey?: string;
  readonly useSiteKey: string;
  readonly rematerialization?: AArch64RematerializationRecipe;
}

export function repairAllocationWithSpillsAndRemats(input: {
  readonly requests: readonly AArch64AllocationRepairWorkItem[];
  readonly rematerialization?: readonly AArch64RematerializationAuthority[];
}): AArch64BackendResult<{
  readonly drafts: readonly AArch64RepairDraft[];
  readonly spillSlots: readonly AArch64SpillSlotRequest[];
  readonly wipeObligations: readonly { readonly vreg: number; readonly slotKey: string }[];
  readonly provenance: readonly string[];
}> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const drafts: AArch64RepairDraft[] = [];
  const slots: AArch64SpillSlotRequest[] = [];
  for (const request of [...input.requests].sort((left, right) =>
    compareCodeUnitStrings(left.requestKey, right.requestKey),
  )) {
    if (request.frameOffsetBytes !== undefined && Math.abs(request.frameOffsetBytes) > 4095) {
      diagnostics.push(
        diagnostic(
          `spill-remat:unencodable-frame-offset:${request.requestKey}:${request.frameOffsetBytes}`,
        ),
      );
      continue;
    }
    const authority = input.rematerialization?.find(
      (candidate) =>
        candidate.vreg === request.vreg &&
        candidate.legalAtUseSiteKeys.includes(request.useSiteKey),
    );
    if (authority !== undefined) {
      if (authority.relocationPairKey !== undefined) {
        diagnostics.push(
          diagnostic(
            `spill-remat:relocation-pair-remat-rejected:vreg:${request.vreg}:${authority.relocationPairKey}`,
          ),
        );
        continue;
      }
      if (authority.kind !== "constant") {
        diagnostics.push(
          diagnostic(
            `spill-remat:unsupported-rematerialization-kind:vreg:${request.vreg}:${authority.kind}`,
          ),
        );
        continue;
      }
      if (authority.constantValue === undefined) {
        diagnostics.push(
          diagnostic(`spill-remat:missing-constant-remat-value:vreg:${request.vreg}`),
        );
        continue;
      }
      if (!isMoveWideImmediate(authority.constantValue)) {
        diagnostics.push(
          diagnostic(
            `spill-remat:unencodable-constant-remat:vreg:${request.vreg}:${authority.constantValue.toString()}`,
          ),
        );
        continue;
      }
      drafts.push({
        stableKey: `draft:remat:${request.requestKey}`,
        kind: "remat",
        vreg: request.vreg,
        useSiteKey: request.useSiteKey,
        rematerialization: Object.freeze({
          kind: "constant",
          value: authority.constantValue,
        }),
      });
      continue;
    }
    if (request.noSpill === true) {
      diagnostics.push(diagnostic(`spill-remat:no-spill-memory-placement:vreg:${request.vreg}`));
      continue;
    }
    const slotKey = `spill-slot:vreg:${request.vreg}`;
    slots.push({
      slotKey,
      vreg: request.vreg,
      sizeBytes: request.widthBytes,
      alignmentBytes: request.alignmentBytes ?? request.widthBytes,
      wipeOnExit: request.wipeOnExit ?? false,
    });
    drafts.push({
      stableKey: `draft:spill:${request.requestKey}`,
      kind: request.kind === "reload" ? "reload" : "spill",
      vreg: request.vreg,
      slotKey,
      useSiteKey: request.useSiteKey,
    });
  }
  if (diagnostics.length > 0) return backendError(diagnostics);
  const sortedDrafts = Object.freeze(
    drafts.sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
  );
  return backendOk({
    drafts: sortedDrafts,
    spillSlots: Object.freeze(
      slots.sort((left, right) => compareCodeUnitStrings(left.slotKey, right.slotKey)),
    ),
    wipeObligations: Object.freeze(
      slots
        .filter((slot) => slot.wipeOnExit)
        .map((slot) => ({ vreg: slot.vreg, slotKey: slot.slotKey })),
    ),
    provenance: Object.freeze(
      sortedDrafts.map(
        (draft) =>
          `rewrite:${draft.kind === "remat" ? "rematerialization" : "spill-insertion"}:${draft.stableKey.replace(/^draft:[^:]+:/, "")}`,
      ),
    ),
  });
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_ALLOCATION_FAILED",
    ownerKey: "spill-remat",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}

function isMoveWideImmediate(value: bigint): boolean {
  return value >= 0n && value <= 0xffffn;
}
