import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";

export interface AArch64SelectionCandidate {
  readonly patternId: string;
  readonly covers: readonly number[];
  readonly replacesBaselinePatternIds?: readonly string[];
  readonly tier: "local" | "window" | "semantic" | "helper";
  readonly cost: number;
  readonly factsUsed?: readonly number[];
  readonly emittedOpcodes?: readonly string[];
  readonly requiresWindowDp?: boolean;
}

export interface AArch64TilingResult {
  readonly selected: readonly AArch64SelectionCandidate[];
  readonly diagnostics: readonly string[];
}

export function tileAArch64SelectionCandidates(input: {
  readonly baselineCover: readonly AArch64SelectionCandidate[];
  readonly replacementCandidates: readonly AArch64SelectionCandidate[];
  readonly budget?: { readonly maxCandidates: number };
}): AArch64TilingResult {
  const selected = [...input.baselineCover];
  const diagnostics: string[] = [];
  const maxCandidates = input.budget?.maxCandidates ?? 64;
  const replacements = input.replacementCandidates
    .filter((candidate) => candidate.covers.length > 0)
    .filter((candidate) => candidate.covers.length <= maxCandidates)
    .sort(compareCandidate);
  for (const candidate of replacements) {
    const baselineWindow = selected.filter((selectedCandidate) =>
      selectedCandidate.covers.every((operationId) => candidate.covers.includes(operationId)),
    );
    const exactlyCoversWindow =
      baselineWindow.length > 0 &&
      baselineWindow
        .flatMap((windowCandidate) => windowCandidate.covers)
        .sort((left, right) => left - right)
        .join(",") === [...candidate.covers].sort((left, right) => left - right).join(",");
    if (!exactlyCoversWindow) {
      diagnostics.push(`replacement-rejected:non-contiguous:${candidate.patternId}`);
      continue;
    }
    for (const windowCandidate of baselineWindow)
      selected.splice(selected.indexOf(windowCandidate), 1);
    selected.push(candidate);
  }
  return Object.freeze({
    selected: Object.freeze(selected.sort(compareCandidate)),
    diagnostics: Object.freeze(diagnostics.sort()),
  });
}

export function tileAArch64SelectionCandidatesStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  return appendAArch64SelectionRecord(state, {
    stageKey: "tile-selection-candidates",
    subjectKey: "program",
    patternId: "tiling.baseline-and-replacements",
    tier: "window",
    factsUsed: [],
    emittedOpcodes: [],
    explanation: ["tile-selection-candidates:baseline-and-replacements-verified"],
  });
}

function compareCandidate(
  left: AArch64SelectionCandidate,
  right: AArch64SelectionCandidate,
): number {
  return (
    left.cost - right.cost ||
    left.tier.localeCompare(right.tier) ||
    left.patternId.localeCompare(right.patternId)
  );
}
