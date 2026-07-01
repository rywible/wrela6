import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64BackendTargetSurface } from "../api/backend-target-surface";
import {
  classifyAArch64PublicAbiBoundary,
  type AArch64AbiLocationAssignment,
  type AArch64MachineAbiValue,
} from "./abi-classification";
import type { AArch64PrivateConventionRecord } from "./private-convention-plan";

export type AArch64CallSiteBoundaryKind =
  | "closed-image"
  | "public"
  | "firmware"
  | "exported"
  | "address-taken"
  | "replacement"
  | "uncertain";

export interface AArch64CallSiteBoundaryInput {
  readonly callKey: string;
  readonly callerKey: string;
  readonly calleeKey: string;
  readonly boundaryKind: AArch64CallSiteBoundaryKind;
  readonly parameters: readonly AArch64MachineAbiValue[];
  readonly returns: readonly AArch64MachineAbiValue[];
}

export interface AArch64ReconciledCallBoundary {
  readonly callKey: string;
  readonly callerKey: string;
  readonly calleeKey: string;
  readonly boundaryKind: "private" | "public";
  readonly argumentLocations: readonly AArch64AbiLocationAssignment[];
  readonly resultLocations: readonly AArch64AbiLocationAssignment[];
  readonly clobberedGprs: readonly string[];
  readonly clobberedVectorRegisters: readonly string[];
  readonly pinnedLiveThroughGprs: readonly string[];
  readonly potentialVeneerClobberGprs: readonly string[];
  readonly tailCallEligible: boolean;
}

export function reconcileAArch64CallBoundaries(input: {
  readonly targetSurface: AArch64BackendTargetSurface;
  readonly callerKey: string;
  readonly callSites: readonly AArch64CallSiteBoundaryInput[];
  readonly privateConventions?: readonly AArch64PrivateConventionRecord[];
}): AArch64BackendResult<{ readonly boundaries: readonly AArch64ReconciledCallBoundary[] }> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const boundaries: AArch64ReconciledCallBoundary[] = [];
  for (const callSite of [...input.callSites].sort((left, right) =>
    compareCodeUnitStrings(left.callKey, right.callKey),
  )) {
    const convention = input.privateConventions?.find(
      (record) =>
        record.callerKey === callSite.callerKey && record.calleeKey === callSite.calleeKey,
    );
    if (callSite.boundaryKind === "closed-image") {
      if (convention === undefined) {
        diagnostics.push(
          diagnostic(
            `call-boundary:private-caller-callee-mismatch:${callSite.callKey}:${callSite.callerKey}:${callSite.calleeKey}`,
          ),
        );
        continue;
      }
      boundaries.push(
        Object.freeze({
          callKey: callSite.callKey,
          callerKey: callSite.callerKey,
          calleeKey: callSite.calleeKey,
          boundaryKind: "private",
          argumentLocations: Object.freeze([...(convention.argumentLocations ?? [])]),
          resultLocations: Object.freeze([...(convention.resultLocations ?? [])]),
          clobberedGprs: sorted(convention.clobberedGprs ?? []),
          clobberedVectorRegisters: Object.freeze([]),
          pinnedLiveThroughGprs: sorted(convention.pinnedLiveThroughGprs ?? []),
          potentialVeneerClobberGprs: sorted(
            convention.potentialVeneerClobberGprs ??
              input.targetSurface.registerModel.veneerScratchGprs,
          ),
          tailCallEligible: convention.tailCallEligible ?? true,
        }),
      );
      continue;
    }
    const publicResult = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: callSite.callKey,
        boundaryKind: publicBoundaryKind(callSite.boundaryKind),
        parameters: callSite.parameters,
        returns: callSite.returns,
      },
      input.targetSurface,
    );
    if (publicResult.kind === "error") {
      diagnostics.push(...publicResult.diagnostics);
      continue;
    }
    boundaries.push(
      Object.freeze({
        callKey: callSite.callKey,
        callerKey: callSite.callerKey,
        calleeKey: callSite.calleeKey,
        boundaryKind: "public",
        argumentLocations: publicResult.value.parameterLocations,
        resultLocations: publicResult.value.returnLocations,
        clobberedGprs: publicResult.value.clobberedGprs,
        clobberedVectorRegisters: publicResult.value.clobberedVectorRegisters,
        pinnedLiveThroughGprs: Object.freeze([]),
        potentialVeneerClobberGprs: sorted(input.targetSurface.registerModel.veneerScratchGprs),
        tailCallEligible: false,
      }),
    );
  }
  if (diagnostics.length > 0) return backendError(diagnostics);
  return backendOk({ boundaries: Object.freeze(boundaries) });
}

export function verifyVeneerScratchPolicy(input: {
  readonly boundary: {
    readonly callKey: string;
    readonly potentialVeneerClobberGprs: readonly string[];
  };
  readonly requestedVeneer: { readonly scratchGprs: readonly string[] };
}): AArch64BackendDiagnostic | undefined {
  const declared = new Set(input.boundary.potentialVeneerClobberGprs);
  const missing = [...input.requestedVeneer.scratchGprs]
    .sort(compareCodeUnitStrings)
    .find((register) => !declared.has(register));
  return missing === undefined
    ? undefined
    : diagnostic(`call-boundary:undeclared-veneer-scratch:${input.boundary.callKey}:${missing}`);
}

function publicBoundaryKind(kind: AArch64CallSiteBoundaryKind) {
  if (kind === "firmware") return "firmware-call";
  if (kind === "exported") return "exported-function";
  if (kind === "address-taken") return "address-taken-function";
  if (kind === "replacement") return "replacement-boundary";
  return "public-call";
}

function sorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareCodeUnitStrings));
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_ABI_INVALID",
    ownerKey: "call-boundary",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
