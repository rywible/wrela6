import { aarch64PatternId, type AArch64PatternId } from "../machine-ir/ids";

export interface AArch64SelectionPatternRecord {
  readonly patternId: AArch64PatternId;
  readonly tier: "local" | "window" | "semantic" | "helper";
  readonly dispatcher: "operationPattern" | "semanticPlugin" | "runtimeHelper";
  readonly coveredOperationKinds: readonly string[];
  readonly requiredFacts: readonly string[];
  readonly requiredProfileFeatures: readonly string[];
  readonly declaredLiveOuts: readonly string[];
  readonly declaredEffects: readonly string[];
  readonly mayTrap: boolean;
  readonly securityBehavior: { readonly kind: "preserveLabels" | "constantTime" | "publicOnly" };
}

export const AARCH64_SELECTION_PATTERN_CATALOG = Object.freeze([
  pattern(
    "scalar.local-baseline-cover",
    "local",
    "operationPattern",
    ["constant", "integerBinary", "integerCompare"],
    [],
  ),
  pattern(
    "memory.pair-load-store",
    "window",
    "operationPattern",
    ["memoryLoad", "memoryStore"],
    ["footprint", "noalias"],
  ),
  pattern(
    "semantic.packet-zero-copy-view",
    "semantic",
    "semanticPlugin",
    ["semanticRegionMarker"],
    ["footprint"],
    ["packet-field"],
  ),
  pattern(
    "semantic.virtio-ring-publish",
    "semantic",
    "semanticPlugin",
    ["semanticFence"],
    ["memory-order"],
    [],
    ["availIndexPublication", "descriptorWrites", "mmioNotify"],
  ),
  pattern(
    "semantic.checksum-crc32",
    "semantic",
    "semanticPlugin",
    ["semanticChecksum"],
    ["semantic-contract"],
    ["crc"],
  ),
  pattern(
    "semantic.polynomial-pmull",
    "semantic",
    "semanticPlugin",
    ["semanticPolynomial"],
    ["semantic-contract", "vector-state", "footprint"],
    ["pmull-result"],
  ),
  pattern(
    "semantic.aes-sha-mix",
    "semantic",
    "semanticPlugin",
    ["semanticCryptoMix"],
    ["semantic-contract", "vector-state", "security"],
    ["crypto-state"],
  ),
  pattern(
    "semantic.classifier-table-dotprod",
    "semantic",
    "semanticPlugin",
    ["semanticClassifier"],
    ["fp-numeric"],
    ["classifier-score"],
  ),
  pattern(
    "semantic.vector-tail-free",
    "semantic",
    "semanticPlugin",
    ["vectorLoad"],
    ["footprint"],
    ["vector-body"],
  ),
]);

export function aarch64SelectionPatternById(
  patternId: string,
): AArch64SelectionPatternRecord | undefined {
  return AARCH64_SELECTION_PATTERN_CATALOG.find(
    (patternRecord) => String(patternRecord.patternId) === patternId,
  );
}

function pattern(
  patternId: string,
  tier: AArch64SelectionPatternRecord["tier"],
  dispatcher: AArch64SelectionPatternRecord["dispatcher"],
  coveredOperationKinds: readonly string[],
  requiredFacts: readonly string[],
  declaredLiveOuts: readonly string[] = [],
  declaredEffects: readonly string[] = [],
): AArch64SelectionPatternRecord {
  return Object.freeze({
    patternId: aarch64PatternId(patternId),
    tier,
    dispatcher,
    coveredOperationKinds: Object.freeze([...coveredOperationKinds]),
    requiredFacts: Object.freeze([...requiredFacts].sort()),
    requiredProfileFeatures: Object.freeze(["BASE_A64"]),
    declaredLiveOuts: Object.freeze([...declaredLiveOuts].sort()),
    declaredEffects: Object.freeze([...declaredEffects].sort()),
    mayTrap: coveredOperationKinds.some(
      (operationKind) => operationKind.includes("memory") || operationKind.includes("Load"),
    ),
    securityBehavior: Object.freeze({ kind: "preserveLabels" }),
  });
}

export function manifestPatternIds(): readonly AArch64PatternId[] {
  return Object.freeze(
    AARCH64_SELECTION_PATTERN_CATALOG.map((patternRecord) => patternRecord.patternId),
  );
}
