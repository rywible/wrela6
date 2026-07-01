import type { OptIrEdgeId, OptIrFactId, OptIrOperationId, OptIrRegionId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

export type OptIrBranchFrequency = "entry" | "hot" | "warm" | "cold" | "terminalCold" | "normal";
export type OptIrBranchFactSource = "static" | "profile" | "proof";

const BRANCH_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "branch",
  packetKinds: ["branch", "switch-density", "block-frequency"],
  preservationRules: ["preserve-through-cfg-stable-clone"],
  invalidationRules: ["invalidate-on-cfg-rewrite"],
  upstreamVerifierKey: "branch-facts",
  negativeFixtures: ["missing-edge"],
});

export interface OptIrBranchFactInput {
  readonly factId: OptIrFactId;
  readonly edgeId: OptIrEdgeId;
  readonly probability: number;
  readonly denominator?: number;
  readonly frequency?: OptIrBranchFrequency;
  readonly source: OptIrBranchFactSource;
  readonly authority?: string;
}

export function branchFactRecord(input: OptIrBranchFactInput): OptIrFactRecord {
  if (!Number.isFinite(input.probability) || input.probability < 0 || input.probability > 1) {
    throw new RangeError("branch probability must be between 0 and 1.");
  }
  if (
    input.denominator !== undefined &&
    (!Number.isInteger(input.denominator) || input.denominator <= 0)
  ) {
    throw new RangeError("branch probability denominator must be a positive integer.");
  }
  const numerator =
    input.denominator === undefined ? undefined : Math.round(input.probability * input.denominator);
  return optIrExtensionFactRecord({
    registry: BRANCH_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "branch",
    packetKind: "branch",
    subject: { kind: "optIrEdge", edgeId: input.edgeId },
    payload: {
      ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
      ...(input.denominator === undefined ? {} : { denominator: input.denominator, numerator }),
      probability: input.probability,
      source: input.source,
    },
    authority: requireAuthority(input.authority ?? "proof:branch", "branch"),
  });
}

export interface OptIrSwitchDensityFactInput {
  readonly factId: OptIrFactId;
  readonly switchOperation: OptIrOperationId;
  readonly caseCount: number;
  readonly valueSpan: bigint;
  readonly densityPermille: number;
  readonly hotCases?: readonly string[];
  readonly coldTerminalCases?: readonly string[];
  readonly valueRangeAuthority: string;
}

export function switchDensityFactRecord(input: OptIrSwitchDensityFactInput): OptIrFactRecord {
  if (!Number.isInteger(input.caseCount) || input.caseCount < 0) {
    throw new RangeError("switch case count must be a non-negative integer.");
  }
  if (input.valueSpan <= 0n) {
    throw new RangeError("switch value span must be positive.");
  }
  if (
    !Number.isInteger(input.densityPermille) ||
    input.densityPermille < 0 ||
    input.densityPermille > 1000
  ) {
    throw new RangeError("switch density permille must be between 0 and 1000.");
  }
  return optIrExtensionFactRecord({
    registry: BRANCH_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "branch",
    packetKind: "switch-density",
    subject: { kind: "operation", operationId: input.switchOperation },
    payload: {
      caseCount: input.caseCount,
      coldTerminalCases: Object.freeze([...(input.coldTerminalCases ?? [])].sort()),
      densityPermille: input.densityPermille,
      hotCases: Object.freeze([...(input.hotCases ?? [])].sort()),
      valueRangeAuthority: requireAuthority(input.valueRangeAuthority, "switch-density"),
      valueSpan: input.valueSpan.toString(),
    },
    authority: "proof:branch",
  });
}

export interface OptIrBlockFrequencyFactInput {
  readonly factId: OptIrFactId;
  readonly regionId: OptIrRegionId;
  readonly frequency: OptIrBranchFrequency;
}

export function blockFrequencyFactRecord(input: OptIrBlockFrequencyFactInput): OptIrFactRecord {
  return optIrExtensionFactRecord({
    registry: BRANCH_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "branch",
    packetKind: "block-frequency",
    subject: { kind: "optIrRegion", regionId: input.regionId },
    payload: { frequency: input.frequency },
    authority: "proof:branch",
  });
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
