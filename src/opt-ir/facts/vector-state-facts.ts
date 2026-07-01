import type { OptIrCallId, OptIrFactId, OptIrFunctionId, OptIrOperationId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";
import type { OptIrExtensionFactSubject } from "./fact-extension-registry";

export type OptIrVectorPredicate = "allActive" | "masked" | "unknown";
export type OptIrVectorStatePolicyMode = "scalarOnly" | "ownsVectorState" | "callsVectorHelper";

const VECTOR_STATE_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "vector-state",
  packetKinds: ["vector-state", "vector-state-policy"],
  preservationRules: ["preserve-through-vector-stable-clone"],
  invalidationRules: ["invalidate-on-vector-rewrite"],
  upstreamVerifierKey: "vector-state-facts",
  negativeFixtures: ["invalid-vector-width"],
});

export interface OptIrVectorStateFactInput {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly vectorWidthBits: number;
  readonly laneWidthBits: number;
  readonly predicate: OptIrVectorPredicate;
  readonly preservesInactiveLanes?: boolean;
  readonly authority?: string;
}

export function vectorStateFactRecord(input: OptIrVectorStateFactInput): OptIrFactRecord {
  if (!Number.isInteger(input.vectorWidthBits) || input.vectorWidthBits <= 0) {
    throw new RangeError("vector width must be a positive integer.");
  }
  if (!Number.isInteger(input.laneWidthBits) || input.laneWidthBits <= 0) {
    throw new RangeError("vector lane width must be a positive integer.");
  }
  if (input.vectorWidthBits % input.laneWidthBits !== 0) {
    throw new RangeError("vector width must be evenly divisible by lane width.");
  }
  return optIrExtensionFactRecord({
    registry: VECTOR_STATE_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "vector-state",
    packetKind: "vector-state",
    subject: { kind: "operation", operationId: input.operationId },
    payload: {
      laneCount: input.vectorWidthBits / input.laneWidthBits,
      laneWidthBits: input.laneWidthBits,
      predicate: input.predicate,
      ...(input.preservesInactiveLanes === undefined
        ? {}
        : { preservesInactiveLanes: input.preservesInactiveLanes }),
      vectorWidthBits: input.vectorWidthBits,
    },
    authority: requireAuthority(input.authority ?? "proof:vector-state", "vector-state"),
  });
}

export interface OptIrVectorStatePolicyFactInput {
  readonly factId: OptIrFactId;
  readonly functionId?: OptIrFunctionId;
  readonly callId?: OptIrCallId;
  readonly mode: OptIrVectorStatePolicyMode;
  readonly reason?: string;
  readonly savePolicy?: string;
  readonly helperKey?: string;
  readonly zeroizeOnExit?: boolean;
  readonly authority?: string;
}

export function vectorStatePolicyFactRecord(
  input: OptIrVectorStatePolicyFactInput,
): OptIrFactRecord {
  if (input.mode === "scalarOnly" && (input.reason ?? "").length === 0) {
    throw new RangeError("scalarOnly vector policy requires a reason.");
  }
  if (input.mode === "ownsVectorState" && (input.savePolicy ?? "").length === 0) {
    throw new RangeError("ownsVectorState vector policy requires a save policy.");
  }
  if (input.mode === "callsVectorHelper" && (input.helperKey ?? "").length === 0) {
    throw new RangeError("callsVectorHelper vector policy requires a helper key.");
  }
  return optIrExtensionFactRecord({
    registry: VECTOR_STATE_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "vector-state",
    packetKind: "vector-state-policy",
    subject: vectorPolicySubject(input),
    payload: {
      mode: input.mode,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      ...(input.savePolicy === undefined ? {} : { savePolicy: input.savePolicy }),
      ...(input.helperKey === undefined ? {} : { helperKey: input.helperKey }),
      zeroizeOnExit: input.zeroizeOnExit ?? false,
    },
    authority: requireAuthority(input.authority ?? "proof:vector-state", "vector-state"),
  });
}

function vectorPolicySubject(input: OptIrVectorStatePolicyFactInput): OptIrExtensionFactSubject {
  if (input.functionId !== undefined && input.callId !== undefined) {
    throw new RangeError("vector policy facts require exactly one function or call subject.");
  }
  if (input.functionId !== undefined) {
    return { kind: "optIrFunction", functionId: input.functionId };
  }
  if (input.callId !== undefined) {
    return { kind: "optIrCall", callId: input.callId };
  }
  throw new RangeError("vector policy facts require exactly one function or call subject.");
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
