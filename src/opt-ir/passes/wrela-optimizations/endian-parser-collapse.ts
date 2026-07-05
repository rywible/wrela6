import type { OptIrOperationId, OptIrOriginId } from "../../ids";
import type { OptIrEndian, OptIrOperation } from "../../operations";

export interface WrelaEndianFoldCandidate {
  readonly operationId: OptIrOperationId;
  readonly endian: OptIrEndian;
  readonly regionKind: "normal" | "firmware";
  readonly volatility: "nonVolatile" | "volatile";
  readonly factChain: readonly string[];
}

export interface WrelaParserCollapseCandidate {
  readonly parserStateOperationIds: readonly OptIrOperationId[];
  readonly directLoadOperationIds: readonly OptIrOperationId[];
  readonly coldRejectionOrigins: readonly OptIrOriginId[];
  readonly diagnosticOrigins: readonly OptIrOriginId[];
  readonly factChain: readonly string[];
}

export interface WrelaEndianParserInput {
  readonly operations: readonly OptIrOperation[];
  readonly endianFoldCandidates?: readonly WrelaEndianFoldCandidate[];
  readonly parserCollapseCandidates?: readonly WrelaParserCollapseCandidate[];
  readonly targetContract?: {
    readonly permitsVolatileEndianFold?: boolean;
    readonly permitsFirmwareEndianFold?: boolean;
  };
}

export interface WrelaEndianParserResult {
  readonly operations: readonly OptIrOperation[];
  readonly foldedEndianOperationIds: readonly OptIrOperationId[];
  readonly removedParserStateOperationIds: readonly OptIrOperationId[];
  readonly directPacketLoadOperationIds: readonly OptIrOperationId[];
  readonly rejectedEndianFolds: readonly {
    readonly operationId: OptIrOperationId;
    readonly reason: "implicitEndian" | "volatileFoldNotPermitted" | "firmwareFoldNotPermitted";
  }[];
  readonly explanations: readonly {
    readonly kind: "endianFolded" | "parserStateCollapsed";
    readonly operationId?: OptIrOperationId;
    readonly parserStateOperationIds?: readonly OptIrOperationId[];
    readonly coldRejectionOrigins?: readonly OptIrOriginId[];
    readonly diagnosticOrigins?: readonly OptIrOriginId[];
    readonly factChain: readonly string[];
    readonly consumedFactFamilies: readonly string[];
  }[];
}

export function runWrelaEndianParserCollapseForTest(
  input: WrelaEndianParserInput,
): WrelaEndianParserResult {
  return runWrelaEndianParserCollapse(input);
}

export function runWrelaEndianParserCollapse(
  input: WrelaEndianParserInput,
): WrelaEndianParserResult {
  const folded: OptIrOperationId[] = [];
  const rejectedEndianFolds: WrelaEndianParserResult["rejectedEndianFolds"][number][] = [];
  const explanations: WrelaEndianParserResult["explanations"][number][] = [];

  for (const candidate of input.endianFoldCandidates ?? []) {
    const rejection = endianRejection(candidate, input.targetContract);
    if (rejection !== undefined) {
      rejectedEndianFolds.push({ operationId: candidate.operationId, reason: rejection });
      continue;
    }
    folded.push(candidate.operationId);
    explanations.push({
      kind: "endianFolded",
      operationId: candidate.operationId,
      factChain: candidate.factChain,
      consumedFactFamilies: ["layoutAbi"],
    });
  }

  const removedParserStateOperationIds: OptIrOperationId[] = [];
  const directPacketLoadOperationIds: OptIrOperationId[] = [];
  for (const candidate of input.parserCollapseCandidates ?? []) {
    removedParserStateOperationIds.push(...candidate.parserStateOperationIds);
    directPacketLoadOperationIds.push(...candidate.directLoadOperationIds);
    explanations.push({
      kind: "parserStateCollapsed",
      parserStateOperationIds: candidate.parserStateOperationIds,
      coldRejectionOrigins: candidate.coldRejectionOrigins,
      diagnosticOrigins: candidate.diagnosticOrigins,
      factChain: candidate.factChain,
      consumedFactFamilies: ["privateState", "validatedBuffer", "terminalClosure"],
    });
  }

  const removed = new Set(removedParserStateOperationIds);
  return {
    operations: input.operations.filter((operation) => !removed.has(operation.operationId)),
    foldedEndianOperationIds: folded.sort((left, right) => Number(left) - Number(right)),
    removedParserStateOperationIds: removedParserStateOperationIds.sort(
      (left, right) => Number(left) - Number(right),
    ),
    directPacketLoadOperationIds: directPacketLoadOperationIds.sort(
      (left, right) => Number(left) - Number(right),
    ),
    rejectedEndianFolds,
    explanations,
  };
}

function endianRejection(
  candidate: WrelaEndianFoldCandidate,
  targetContract: WrelaEndianParserInput["targetContract"],
): WrelaEndianParserResult["rejectedEndianFolds"][number]["reason"] | undefined {
  if (candidate.endian === "native") {
    return "implicitEndian";
  }
  if (candidate.volatility === "volatile" && targetContract?.permitsVolatileEndianFold !== true) {
    return "volatileFoldNotPermitted";
  }
  if (candidate.regionKind === "firmware" && targetContract?.permitsFirmwareEndianFold !== true) {
    return "firmwareFoldNotPermitted";
  }
  return undefined;
}
