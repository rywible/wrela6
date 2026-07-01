import type { LayoutFactProgram } from "../../layout/layout-program";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import type { CheckProofAndResourcesInput } from "../input-contract";
import {
  layoutFactKey,
  type CheckedFactDependency,
  type CheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactSubject,
} from "../model/fact-packet";
import type { ValidateCheckedFactPacketInput } from "./packet-validator";

function mergeKeySets(...keySets: readonly ReadonlySet<string>[]): ReadonlySet<string> {
  const merged = new Set<string>();
  for (const keySet of keySets) {
    for (const key of keySet) {
      merged.add(key);
    }
  }
  return merged;
}

export function authorityFingerprintsForProofCheckInput(
  input: CheckProofAndResourcesInput,
): readonly ProofAuthorityFingerprint[] {
  const fingerprints: ProofAuthorityFingerprint[] = [
    input.platformContracts.fingerprint,
    input.runtimeCatalog.fingerprint,
    input.typeFacts.fingerprint,
    input.semantics.fingerprint,
  ];
  if (input.mir.runtimeCatalog.fingerprint !== undefined) {
    fingerprints.push(input.mir.runtimeCatalog.fingerprint);
  }
  return fingerprints;
}

export function buildProofMirNodeKeysFromProgram(mir: ProofMirProgram): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const fact of mir.facts.entries()) {
    keys.add(`proofMirFact:${String(fact.factId)}`);
  }
  for (const functionGraph of mir.functions.entries()) {
    for (const place of functionGraph.places.entries()) {
      keys.add(`proofMirPlace:${String(place.placeId)}`);
    }
    for (const value of functionGraph.values.entries()) {
      keys.add(`proofMirValue:${String(value.valueId)}`);
    }
    for (const edge of functionGraph.edges.entries()) {
      keys.add(`proofMirEdge:${String(edge.edgeId)}`);
    }
  }
  for (const callEdge of mir.callGraph.entries()) {
    keys.add(`proofMirCall:${String(callEdge.callId.callId)}`);
  }
  return keys;
}

export function buildLayoutFactKeysFromLayoutProgram(
  layout: LayoutFactProgram,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const validatedBuffer of layout.validatedBuffers.entries()) {
    keys.add(String(layoutFactKey(String(validatedBuffer.instanceId))));
  }
  for (const typeFact of layout.types.entries()) {
    keys.add(String(layoutFactKey(layout.types.keyString(typeFact.key))));
  }
  for (const functionAbi of layout.functions.entries()) {
    keys.add(String(layoutFactKey(String(functionAbi.functionInstanceId))));
  }
  for (const platformEdge of layout.platformEdges.entries()) {
    keys.add(String(layoutFactKey(String(platformEdge.edgeId))));
  }
  for (const imageDevice of layout.imageDevices.entries()) {
    keys.add(String(layoutFactKey(layout.imageDevices.keyString(imageDevice.key))));
  }
  return keys;
}

export function buildPrivateGenerationKeysFromProgram(mir: ProofMirProgram): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const generation of mir.privateStateGenerations.entries()) {
    keys.add(String(generation.generationId));
  }
  return keys;
}

export function buildPacketSourceKeysFromPacket(packet: CheckedFactPacket): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of packet.packetSources) {
    if (entry.subject.kind !== "packetSource") {
      continue;
    }
    keys.add(`${String(entry.subject.packet)}:${String(entry.subject.source)}`);
  }
  return keys;
}

export function buildPrivateGenerationKeysFromPacket(
  packet: CheckedFactPacket,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of packet.privateState) {
    if (entry.subject.kind !== "privateState") {
      continue;
    }
    keys.add(String(entry.subject.generation));
  }
  return keys;
}

function dependencyReferencesAuthorizedNode(
  dependency: CheckedFactDependency,
  authority: {
    readonly proofMirNodeKeys: ReadonlySet<string>;
    readonly layoutFactKeys: ReadonlySet<string>;
    readonly packetSourceKeys: ReadonlySet<string>;
    readonly privateGenerationKeys: ReadonlySet<string>;
  },
): boolean {
  switch (dependency.kind) {
    case "proofMirFact":
      return authority.proofMirNodeKeys.has(`proofMirFact:${String(dependency.factId)}`);
    case "proofMirPlace":
      return authority.proofMirNodeKeys.has(`proofMirPlace:${String(dependency.placeId)}`);
    case "proofMirValue":
      return authority.proofMirNodeKeys.has(`proofMirValue:${String(dependency.valueId)}`);
    case "proofMirEdge":
      return authority.proofMirNodeKeys.has(`proofMirEdge:${String(dependency.edgeId)}`);
    case "proofMirCall":
      return authority.proofMirNodeKeys.has(`proofMirCall:${String(dependency.callId)}`);
    case "layoutFact":
      return authority.layoutFactKeys.has(String(dependency.layoutKey));
    case "packetSource":
      return authority.packetSourceKeys.has(
        `${String(dependency.packet)}:${String(dependency.source)}`,
      );
    case "privateGeneration":
      return authority.privateGenerationKeys.has(String(dependency.generation));
    case "authorityEntry":
    case "coreCertificate":
    case "semanticsCertificate":
    case "summaryInstantiation":
      return true;
    default: {
      const unreachable: never = dependency;
      return unreachable;
    }
  }
}

function sanitizePacketEntryDependencies<
  Kind extends CheckedFactKindId,
  Subject extends CheckedFactSubject,
>(
  entry: CheckedFactPacketEntry<Kind, Subject>,
  authority: {
    readonly proofMirNodeKeys: ReadonlySet<string>;
    readonly layoutFactKeys: ReadonlySet<string>;
    readonly packetSourceKeys: ReadonlySet<string>;
    readonly privateGenerationKeys: ReadonlySet<string>;
  },
): CheckedFactPacketEntry<Kind, Subject> {
  const dependencies = entry.dependencies.filter((dependency) =>
    dependencyReferencesAuthorizedNode(dependency, authority),
  );
  if (dependencies.length === entry.dependencies.length) {
    return entry;
  }
  return {
    ...entry,
    dependencies,
  };
}

function sanitizePacketSection<Kind extends CheckedFactKindId, Subject extends CheckedFactSubject>(
  entries: readonly CheckedFactPacketEntry<Kind, Subject>[],
  authority: {
    readonly proofMirNodeKeys: ReadonlySet<string>;
    readonly layoutFactKeys: ReadonlySet<string>;
    readonly packetSourceKeys: ReadonlySet<string>;
    readonly privateGenerationKeys: ReadonlySet<string>;
  },
): readonly CheckedFactPacketEntry<Kind, Subject>[] {
  return entries.map((entry) => sanitizePacketEntryDependencies(entry, authority));
}

export function sanitizeCheckedFactPacketDependencies(input: {
  readonly packet: CheckedFactPacket;
  readonly checkInput: CheckProofAndResourcesInput;
}): CheckedFactPacket {
  const proofMirNodeKeys = buildProofMirNodeKeysFromProgram(input.checkInput.mir);
  const layoutFactKeys = buildLayoutFactKeysFromLayoutProgram(input.checkInput.layout);
  const packetSourceKeys = buildPacketSourceKeysFromPacket(input.packet);
  const privateGenerationKeys = mergeKeySets(
    buildPrivateGenerationKeysFromProgram(input.checkInput.mir),
    buildPrivateGenerationKeysFromPacket(input.packet),
  );
  const authority = {
    proofMirNodeKeys,
    layoutFactKeys,
    packetSourceKeys,
    privateGenerationKeys,
  };
  return {
    ownership: sanitizePacketSection(input.packet.ownership, authority),
    noalias: sanitizePacketSection(input.packet.noalias, authority),
    fieldDisjointness: sanitizePacketSection(input.packet.fieldDisjointness, authority),
    erasures: sanitizePacketSection(input.packet.erasures, authority),
    validatedBuffers: sanitizePacketSection(input.packet.validatedBuffers, authority),
    packetSources: sanitizePacketSection(input.packet.packetSources, authority),
    privateState: sanitizePacketSection(input.packet.privateState, authority),
    platformEffects: sanitizePacketSection(input.packet.platformEffects, authority),
    capabilityFlow: sanitizePacketSection(input.packet.capabilityFlow, authority),
    terminalClosure: sanitizePacketSection(input.packet.terminalClosure, authority),
    exitClosure: sanitizePacketSection(input.packet.exitClosure, authority),
    layoutAbi: sanitizePacketSection(input.packet.layoutAbi, authority),
    origins: input.packet.origins,
    extensions: input.packet.extensions,
  };
}

export function validateCheckedFactPacketInputForProofCheck(input: {
  readonly checkInput: CheckProofAndResourcesInput;
  readonly packet: CheckedFactPacket;
  readonly certificates: ValidateCheckedFactPacketInput["certificates"];
}): ValidateCheckedFactPacketInput {
  return {
    packet: input.packet,
    certificates: input.certificates,
    authorityFingerprints: authorityFingerprintsForProofCheckInput(input.checkInput),
    proofMirNodeKeys: buildProofMirNodeKeysFromProgram(input.checkInput.mir),
    layoutFactKeys: buildLayoutFactKeysFromLayoutProgram(input.checkInput.layout),
    packetSourceKeys: buildPacketSourceKeysFromPacket(input.packet),
    privateGenerationKeys: mergeKeySets(
      buildPrivateGenerationKeysFromProgram(input.checkInput.mir),
      buildPrivateGenerationKeysFromPacket(input.packet),
    ),
  };
}
