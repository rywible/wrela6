import type { TargetId } from "../../../src/semantic/ids";
import { targetId } from "../../../src/semantic/ids";
import { createHash } from "node:crypto";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  runtimeCatalog,
  type ProofMirRuntimeAbiReference,
  type ProofMirRuntimeCatalog,
  type ProofMirRuntimeEffectSchema,
  type ProofMirRuntimeFactSchema,
  type ProofMirRuntimeLoweringOwner,
  type ProofMirRuntimeOperation,
  type ProofMirRuntimeOperationId,
  type ProofMirRuntimePlaceSchema,
  type ProofMirRuntimeTargetAvailability,
} from "../../../src/runtime/runtime-catalog";
import {
  proofMirOriginId,
  proofMirRuntimeCallId,
  type ProofMirFactId,
  type ProofMirOriginId,
  type ProofMirOwnedCallId,
  type ProofMirOwnedPlaceId,
  type ProofMirRuntimeCallId,
} from "../../../src/proof-mir/ids";

export type ProofMirRuntimeCallContractEffect =
  | { readonly kind: "pure" }
  | { readonly kind: "readsMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "writesMemory"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "advancesPrivateState"; readonly place: ProofMirOwnedPlaceId }
  | { readonly kind: "mayPanic" }
  | { readonly kind: "doesNotReturn" };

export interface ProofMirRuntimeCallContract {
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFacts: readonly ProofMirFactId[];
  readonly consumedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly producedCapabilities: readonly ProofMirOwnedPlaceId[];
  readonly effects: readonly ProofMirRuntimeCallContractEffect[];
  readonly origin: ProofMirOriginId;
}

export interface ProofMirRuntimeOperationFakeInput {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly authorityKey?: string;
  readonly targetAvailability?: ProofMirRuntimeTargetAvailability;
  readonly loweringOwner?: ProofMirRuntimeLoweringOwner;
  readonly abi?: ProofMirRuntimeAbiReference;
  readonly requiredFactSchemas?: readonly ProofMirRuntimeFactSchema[];
  readonly consumedCapabilitySchemas?: readonly ProofMirRuntimePlaceSchema[];
  readonly producedCapabilitySchemas?: readonly ProofMirRuntimePlaceSchema[];
  readonly effectSchemas?: readonly ProofMirRuntimeEffectSchema[];
}

export interface ProofMirRuntimeCatalogFakeInput {
  readonly targetId?: TargetId;
  readonly features?: readonly string[];
  readonly operations: readonly ProofMirRuntimeOperation[];
  readonly fingerprintName?: string;
  readonly targetName?: string;
  readonly version?: string;
}

export interface ProofMirRuntimeCallContractFakeInput {
  readonly runtimeCallId?: ProofMirRuntimeCallId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly callId: ProofMirOwnedCallId;
  readonly requiredFacts?: readonly ProofMirFactId[];
  readonly consumedCapabilities?: readonly ProofMirOwnedPlaceId[];
  readonly producedCapabilities?: readonly ProofMirOwnedPlaceId[];
  readonly effects?: readonly ProofMirRuntimeCallContractEffect[];
  readonly origin: ProofMirOriginId;
}

const DEFAULT_RUNTIME_CATALOG_TARGET_ID = targetId("x64-test");

function runtimeCatalogFingerprintForFake(input: {
  readonly fingerprintName: string;
  readonly targetName?: string;
  readonly version?: string;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: "runtime",
    targetId: targetId(input.targetName ?? "x64-test"),
    version: input.version ?? "runtime-v1",
    digestAlgorithm: "sha256",
    digestHex: createHash("sha256")
      .update(`proof-check-authority-test:${input.fingerprintName}`)
      .digest("hex"),
  };
}

function stableTestOriginValue(note: string): number {
  let hash = 0;
  for (let index = 0; index < note.length; index += 1) {
    hash = (hash * 31 + note.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function defaultEffectSchemasForLoweringOwner(
  loweringOwner: ProofMirRuntimeLoweringOwner,
): readonly ProofMirRuntimeEffectSchema[] {
  switch (loweringOwner) {
    case "panicAbort":
      return [{ kind: "doesNotReturn" }];
    case "validatedBufferHelper":
    case "coroutineFrame":
    case "moveRingCoreTransfer":
    case "targetMemoryHelper":
      return [];
    default: {
      const unreachable: never = loweringOwner;
      return unreachable;
    }
  }
}

export function proofMirOriginForTest(note: string): ProofMirOriginId {
  return proofMirOriginId(stableTestOriginValue(`proof-mir-origin:${note}`));
}

export function proofMirRuntimeOperationFake(
  input: ProofMirRuntimeOperationFakeInput,
): ProofMirRuntimeOperation {
  const loweringOwner = input.loweringOwner ?? "panicAbort";
  return {
    runtimeId: input.runtimeId,
    name: input.name,
    ...(input.authorityKey === undefined ? {} : { authorityKey: input.authorityKey }),
    targetAvailability: input.targetAvailability ?? { kind: "allTargets" },
    loweringOwner,
    abi: input.abi ?? { kind: "compilerRuntime", symbol: `__wr_${input.name}` },
    requiredFactSchemas: input.requiredFactSchemas ?? [],
    consumedCapabilitySchemas: input.consumedCapabilitySchemas ?? [],
    producedCapabilitySchemas: input.producedCapabilitySchemas ?? [],
    effectSchemas: input.effectSchemas ?? defaultEffectSchemasForLoweringOwner(loweringOwner),
  };
}

export function proofMirRuntimeCatalogFake(
  input: ProofMirRuntimeCatalogFakeInput,
): ProofMirRuntimeCatalog {
  const catalogTargetId = input.targetId ?? DEFAULT_RUNTIME_CATALOG_TARGET_ID;
  const fingerprint =
    input.fingerprintName === undefined
      ? undefined
      : runtimeCatalogFingerprintForFake({
          fingerprintName: input.fingerprintName,
          targetName: input.targetName,
          version: input.version,
        });
  const result = runtimeCatalog({
    targetId: catalogTargetId,
    features: input.features ?? [],
    ...(fingerprint === undefined ? {} : { fingerprint }),
    entries: input.operations,
  });
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirRuntimeCatalogFake failed: ${result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
    );
  }
  return result.catalog;
}

export function proofMirRuntimeCallContractFake(
  input: ProofMirRuntimeCallContractFakeInput,
): ProofMirRuntimeCallContract {
  return {
    runtimeCallId: input.runtimeCallId ?? proofMirRuntimeCallId(Number(input.runtimeId)),
    runtimeId: input.runtimeId,
    callId: input.callId,
    requiredFacts: input.requiredFacts ?? [],
    consumedCapabilities: input.consumedCapabilities ?? [],
    producedCapabilities: input.producedCapabilities ?? [],
    effects: input.effects ?? [],
    origin: input.origin,
  };
}
