import type {
  OptIrCallId,
  OptIrFactId,
  OptIrFunctionId,
  OptIrOperationId,
  OptIrRegionId,
  OptIrValueId,
} from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";
import type { OptIrExtensionFactSubject } from "./fact-extension-registry";

export type OptIrSecurityLabel =
  | "secret"
  | "public"
  | "constantTimeRequired"
  | "noSpill"
  | "wipeOnSpill"
  | "zeroizationStore";

const SECURITY_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "security",
  packetKinds: ["security"],
  preservationRules: ["preserve-through-security-stable-clone"],
  invalidationRules: ["invalidate-on-security-rewrite"],
  upstreamVerifierKey: "security-facts",
  negativeFixtures: ["conflicting-spill-labels"],
});

export interface OptIrSecurityFactInput {
  readonly factId: OptIrFactId;
  readonly valueId?: OptIrValueId;
  readonly operationId?: OptIrOperationId;
  readonly regionId?: OptIrRegionId;
  readonly callId?: OptIrCallId;
  readonly functionId?: OptIrFunctionId;
  readonly frameObjectKey?: string;
  readonly labels: readonly OptIrSecurityLabel[];
  readonly domain?: string;
  readonly constantTime?: boolean;
  readonly authority?: string;
}

export function securityFactRecord(input: OptIrSecurityFactInput): OptIrFactRecord {
  const labels = [...new Set(input.labels)].sort();
  if (labels.includes("noSpill") && labels.includes("wipeOnSpill")) {
    throw new RangeError("security labels cannot require both noSpill and wipeOnSpill.");
  }
  if (input.domain !== undefined && input.domain.length === 0) {
    throw new RangeError("security domain must be non-empty.");
  }
  const subject = securitySubject(input);
  if (labels.includes("zeroizationStore") && subject.kind !== "operation") {
    throw new RangeError("zeroization facts require a live store operation subject.");
  }
  return optIrExtensionFactRecord({
    registry: SECURITY_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "security",
    packetKind: "security",
    subject,
    payload: {
      ...(input.constantTime === undefined ? {} : { constantTime: input.constantTime }),
      ...(input.domain === undefined ? {} : { domain: input.domain }),
      labels,
    },
    authority: requireAuthority(input.authority ?? "proof:security", "security"),
  });
}

function securitySubject(input: OptIrSecurityFactInput): OptIrExtensionFactSubject {
  const subjects: OptIrExtensionFactSubject[] = [];
  if (input.valueId !== undefined) subjects.push({ kind: "value", valueId: input.valueId });
  if (input.operationId !== undefined) {
    subjects.push({ kind: "operation", operationId: input.operationId });
  }
  if (input.regionId !== undefined)
    subjects.push({ kind: "optIrRegion", regionId: input.regionId });
  if (input.callId !== undefined) subjects.push({ kind: "optIrCall", callId: input.callId });
  if (input.functionId !== undefined) {
    subjects.push({ kind: "optIrFunction", functionId: input.functionId });
  }
  if (input.frameObjectKey !== undefined) {
    throw new RangeError("security frame object facts require a first-class frame object subject.");
  }
  if (subjects.length !== 1) {
    throw new RangeError("security facts require exactly one subject.");
  }
  const subject = subjects[0];
  if (subject === undefined) {
    throw new RangeError("security facts require exactly one subject.");
  }
  return subject;
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
