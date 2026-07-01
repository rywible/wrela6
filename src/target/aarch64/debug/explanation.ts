export interface AArch64SelectionExplanationInput {
  readonly patternId: string;
  readonly sourceLabel?: string;
  readonly factsUsed: readonly number[];
  readonly emittedOpcodes: readonly string[];
  readonly rejectedAlternatives?: readonly {
    readonly patternId: string;
    readonly reason: string;
  }[];
}

export interface AArch64Explanation {
  readonly lines: readonly string[];
}

export function explainAArch64Selection(
  input: AArch64SelectionExplanationInput,
): AArch64Explanation {
  const location = input.sourceLabel === undefined ? "" : ` at ${input.sourceLabel}`;
  const lines = [
    `selected ${input.patternId}${location}`,
    `emitted: ${input.emittedOpcodes.join(", ")}`,
    `facts: ${input.factsUsed.join(", ")}`,
    ...(input.rejectedAlternatives ?? []).map(
      (alternative) => `rejected ${alternative.patternId}: ${alternative.reason}`,
    ),
  ];
  return Object.freeze({ lines: Object.freeze(lines) });
}

export function explainAArch64Planning(input: {
  readonly action: string;
  readonly subjectKey: string;
  readonly reason: string;
}): AArch64Explanation {
  return Object.freeze({
    lines: Object.freeze([
      `planned ${input.action} for ${input.subjectKey}`,
      `reason: ${input.reason}`,
    ]),
  });
}
