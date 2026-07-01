import type { OptIrFactId, OptIrOperationId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

export type OptIrSemanticOperationFamily =
  | "atomic"
  | "fence"
  | "checksum"
  | "polynomial"
  | "cryptoMix"
  | "classifier"
  | "regionMarker";

const SEMANTIC_OPERATION_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "semantic-operation",
  packetKinds: ["semantic-operation"],
  preservationRules: ["preserve-through-semantic-stable-clone"],
  invalidationRules: ["invalidate-on-semantic-rewrite"],
  upstreamVerifierKey: "semantic-operation-facts",
  negativeFixtures: ["missing-contract-key"],
});

export interface OptIrSemanticOperationFactInput {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly family: OptIrSemanticOperationFamily;
  readonly contractKey: string;
  readonly securityBehavior?: "public" | "constantTime" | "preserveLabels";
  readonly requiredProfileFeatures?: readonly string[];
  readonly authority?: string;
}

export function semanticOperationFactRecord(
  input: OptIrSemanticOperationFactInput,
): OptIrFactRecord {
  if (input.contractKey.length === 0) {
    throw new RangeError("semantic operation facts require a non-empty contract key.");
  }
  return optIrExtensionFactRecord({
    registry: SEMANTIC_OPERATION_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "semantic-operation",
    packetKind: "semantic-operation",
    subject: { kind: "operation", operationId: input.operationId },
    payload: {
      contractKey: input.contractKey,
      family: input.family,
      requiredProfileFeatures: Object.freeze([...(input.requiredProfileFeatures ?? [])].sort()),
      securityBehavior: input.securityBehavior ?? "preserveLabels",
    },
    authority: requireAuthority(input.authority ?? "proof:semantic-operation"),
  });
}

export function semanticRegionMarkerFactRecord(input: {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly regionKey: string;
  readonly authority?: string;
}): OptIrFactRecord {
  if (input.regionKey.length === 0) {
    throw new RangeError("semantic region marker facts require a non-empty region key.");
  }
  return semanticOperationFactRecord({
    factId: input.factId,
    operationId: input.operationId,
    family: "regionMarker",
    contractKey: input.regionKey,
    securityBehavior: "preserveLabels",
    authority: input.authority,
  });
}

function requireAuthority(authority: string): string {
  if (authority.length === 0) {
    throw new RangeError("semantic operation facts require non-empty authority.");
  }
  return authority;
}
