import type { OptIrOperationId, OptIrRegionId, OptIrRewriteRegionId } from "../ids";

export type OptIrEGraphRegionKind =
  | "parserValidationReadDispatchSlice"
  | "vectorizableLoop"
  | "singleEntrySingleExitMemorySlice"
  | "pureScalarDag";

export type OptIrEGraphBoundaryKind =
  | "volatile"
  | "terminal"
  | "callback"
  | "unknownCall"
  | "externalRoot"
  | "effectBoundary";

export interface OptIrEGraphTokenWindow {
  readonly operationIds: readonly OptIrOperationId[];
  readonly tokenInputKeys: readonly string[];
  readonly tokenOutputKeys: readonly string[];
}

export interface OptIrEGraphRegionCandidate {
  readonly regionId: OptIrRewriteRegionId;
  readonly containingRegionId: OptIrRegionId;
  readonly kind: OptIrEGraphRegionKind;
  readonly operationIds: readonly OptIrOperationId[];
  readonly containingOperationIds?: readonly OptIrOperationId[];
  readonly rootOperationId: OptIrOperationId;
  readonly boundary?: OptIrEGraphBoundaryKind;
  readonly catalogPermitsBoundaryImport?: boolean;
  readonly tokenWindow?: OptIrEGraphTokenWindow;
}

export interface OptIrEGraphSelectionInput {
  readonly candidates: readonly OptIrEGraphRegionCandidate[];
}

export function selectEGraphRegionsForTest(
  input: OptIrEGraphSelectionInput,
): readonly OptIrEGraphRegionCandidate[] {
  return selectEGraphRegions(input);
}

export function selectEGraphRegions(
  input: OptIrEGraphSelectionInput,
): readonly OptIrEGraphRegionCandidate[] {
  const accepted = input.candidates
    .filter((candidate) => boundaryAllowsImport(candidate))
    .filter((candidate) => tokenWindowIsComplete(candidate))
    .map(freezeCandidate)
    .sort(compareCandidates);

  const selected: OptIrEGraphRegionCandidate[] = [];
  for (const candidate of accepted) {
    if (selected.some((entry) => regionsOverlap(entry, candidate))) {
      continue;
    }
    selected.push(candidate);
  }
  return Object.freeze(selected);
}

function boundaryAllowsImport(candidate: OptIrEGraphRegionCandidate): boolean {
  return candidate.boundary === undefined || candidate.catalogPermitsBoundaryImport === true;
}

function tokenWindowIsComplete(candidate: OptIrEGraphRegionCandidate): boolean {
  if (candidate.tokenWindow === undefined) {
    return true;
  }
  if (!sameTokenKeys(candidate.tokenWindow.tokenInputKeys, candidate.tokenWindow.tokenOutputKeys)) {
    return false;
  }
  return candidate.tokenWindow.operationIds.every((operationId) =>
    candidate.operationIds.includes(operationId),
  );
}

function sameTokenKeys(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...new Set(left)].sort(compareStrings);
  const sortedRight = [...new Set(right)].sort(compareStrings);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function compareCandidates(
  left: OptIrEGraphRegionCandidate,
  right: OptIrEGraphRegionCandidate,
): number {
  return (
    priorityForKind(left.kind) - priorityForKind(right.kind) ||
    containingSize(left) - containingSize(right) ||
    Number(left.rootOperationId) - Number(right.rootOperationId) ||
    Number(left.regionId) - Number(right.regionId)
  );
}

function priorityForKind(kind: OptIrEGraphRegionKind): number {
  switch (kind) {
    case "parserValidationReadDispatchSlice":
      return 0;
    case "vectorizableLoop":
      return 1;
    case "singleEntrySingleExitMemorySlice":
      return 2;
    case "pureScalarDag":
      return 3;
  }
}

function containingSize(candidate: OptIrEGraphRegionCandidate): number {
  return candidate.containingOperationIds?.length ?? candidate.operationIds.length;
}

function regionsOverlap(
  left: OptIrEGraphRegionCandidate,
  right: OptIrEGraphRegionCandidate,
): boolean {
  return left.operationIds.some((operationId) => right.operationIds.includes(operationId));
}

function freezeCandidate(candidate: OptIrEGraphRegionCandidate): OptIrEGraphRegionCandidate {
  return Object.freeze({
    ...candidate,
    operationIds: Object.freeze(sortIds(candidate.operationIds)),
    ...(candidate.containingOperationIds === undefined
      ? {}
      : { containingOperationIds: Object.freeze(sortIds(candidate.containingOperationIds)) }),
    ...(candidate.tokenWindow === undefined
      ? {}
      : {
          tokenWindow: Object.freeze({
            operationIds: Object.freeze(sortIds(candidate.tokenWindow.operationIds)),
            tokenInputKeys: Object.freeze(
              [...candidate.tokenWindow.tokenInputKeys].sort(compareStrings),
            ),
            tokenOutputKeys: Object.freeze(
              [...candidate.tokenWindow.tokenOutputKeys].sort(compareStrings),
            ),
          }),
        }),
  });
}

function sortIds<Identifier extends number>(
  identifiers: readonly Identifier[],
): readonly Identifier[] {
  return [...identifiers].sort((left, right) => Number(left) - Number(right));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
