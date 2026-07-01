import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import {
  checkedFactKindId,
  emptyCheckedFactPacket,
  layoutFactKey,
  type CheckedFactDependency,
  type CheckedFactInvalidation,
  type CheckedExtensionFact,
  type CheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedPacketFactKind,
} from "../../../src/proof-check/model/fact-packet";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../../../src/proof-check/ids";
import {
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirFactId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirPrivateStateGenerationId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type { ProofAuthorityFingerprint } from "../../../src/shared/proof-authority-types";

export interface CheckedFactPacketEntryForOptIrTestOptions {
  readonly kind: CheckedPacketFactKind;
  readonly ordinal?: number;
  readonly subject?: CheckedFactSubject;
  readonly scope?: CheckedFactScope;
  readonly dependencies?: readonly CheckedFactDependency[];
  readonly invalidatedBy?: readonly CheckedFactInvalidation[];
}

function authorityFingerprintForTest(ordinal: number): ProofAuthorityFingerprint {
  return {
    authorityKind: "platform",
    targetId: targetId("opt-ir-fixture-target"),
    version: "v1",
    digestAlgorithm: "sha256",
    digestHex: `${ordinal.toString(16).padStart(2, "0")}`.repeat(32).slice(0, 64),
  };
}

function subjectForKind(kind: CheckedPacketFactKind, ordinal: number): CheckedFactSubject {
  const functionInstanceId = monoInstanceId("fixture::main");
  switch (kind) {
    case "ownership":
    case "fieldDisjointness":
    case "erasure":
      return { kind: "place", placeId: proofMirPlaceId(ordinal + 1) };
    case "noalias":
    case "validatedBuffer":
      return { kind: "value", valueId: proofMirValueId(ordinal + 1) };
    case "packetSource":
      return {
        kind: "packetSource",
        packet: proofMirPlaceId(ordinal + 1),
        source: proofMirPlaceId(ordinal + 2),
      };
    case "privateState":
      return {
        kind: "privateState",
        placeId: proofMirPlaceId(ordinal + 1),
        generation: proofMirPrivateStateGenerationId(ordinal + 1),
      };
    case "platformEffect":
      return {
        kind: "authority",
        fingerprint: authorityFingerprintForTest(ordinal),
        entryKey: "platform:get_memory_map",
      };
    case "capabilityFlow":
      return {
        kind: "call",
        functionInstanceId,
        callId: proofMirCallId(ordinal + 1),
      };
    case "terminalClosure":
      return { kind: "terminal", terminalKey: checkedTerminalClosureKey("terminal:fixture") };
    case "exitClosure":
      return {
        kind: "edge",
        functionInstanceId,
        edgeId: proofMirControlEdgeId(ordinal + 1),
      };
    case "layoutAbi":
      return { kind: "layout", layoutKey: layoutFactKey("layout:fixture") };
    case "origin":
      return { kind: "mirOrigin", proofMirOriginId: proofMirOriginId(ordinal + 1) };
    case "extension":
      return {
        kind: "factExtension",
        extensionKey: "fixture",
        subjectKey: `operation:${ordinal + 1}`,
      };
  }
}

function dependencyForKind(kind: CheckedPacketFactKind, ordinal: number): CheckedFactDependency {
  switch (kind) {
    case "ownership":
    case "fieldDisjointness":
    case "erasure":
      return { kind: "proofMirPlace", placeId: proofMirPlaceId(ordinal + 1) };
    case "noalias":
      return { kind: "proofMirValue", valueId: proofMirValueId(ordinal + 1) };
    case "validatedBuffer":
    case "exitClosure":
      return { kind: "proofMirEdge", edgeId: proofMirControlEdgeId(ordinal + 1) };
    case "packetSource":
      return {
        kind: "packetSource",
        packet: proofMirPlaceId(ordinal + 1),
        source: proofMirPlaceId(ordinal + 2),
      };
    case "privateState":
      return {
        kind: "privateGeneration",
        generation: proofMirPrivateStateGenerationId(ordinal + 1),
      };
    case "platformEffect":
    case "capabilityFlow":
      return {
        kind: "authorityEntry",
        fingerprint: authorityFingerprintForTest(ordinal),
        entryKey: "platform:get_memory_map",
      };
    case "terminalClosure":
      return { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(ordinal + 1) };
    case "layoutAbi":
      return { kind: "layoutFact", layoutKey: layoutFactKey("layout:fixture") };
    case "origin":
      return { kind: "proofMirFact", factId: proofMirFactId(ordinal + 1) };
    case "extension":
      return {
        kind: "authorityEntry",
        fingerprint: authorityFingerprintForTest(ordinal),
        entryKey: "extension:fixture",
      };
  }
}

function invalidationForKind(
  kind: CheckedPacketFactKind,
  ordinal: number,
): CheckedFactInvalidation {
  if (kind === "layoutAbi") {
    return { kind: "abiRewrite", layoutKey: layoutFactKey("layout:fixture") };
  }
  if (kind === "platformEffect") {
    return { kind: "authorityChange", fingerprint: authorityFingerprintForTest(ordinal) };
  }
  return { kind: "placeMutation", placeId: proofMirPlaceId(ordinal + 1) };
}

export function checkedFactPacketEntryForOptIrTest(
  options: CheckedFactPacketEntryForOptIrTestOptions,
): CheckedFactPacketEntry<ReturnType<typeof checkedFactKindId>, CheckedFactSubject> {
  const ordinal = options.ordinal ?? 0;
  return {
    factId: proofCheckPacketFactId(ordinal + 1),
    kind: checkedFactKindId(options.kind),
    subject: options.subject ?? subjectForKind(options.kind, ordinal),
    scope: options.scope ?? { kind: "wholeImage" },
    dependencies: options.dependencies ?? [dependencyForKind(options.kind, ordinal)],
    invalidatedBy: options.invalidatedBy ?? [invalidationForKind(options.kind, ordinal)],
    certificate: { kind: "core", id: proofCheckCoreCertificateId(ordinal + 1) },
    origin: {
      originKey: `opt-ir:${options.kind}:${ordinal}`,
      proofMirOriginId: proofMirOriginId(ordinal + 1),
    },
  };
}

export function checkedExtensionFactPacketEntryForOptIrTest(options: {
  readonly ordinal?: number;
  readonly subject?: Extract<CheckedFactSubject, { readonly kind: "factExtension" }>;
  readonly packetKind?: string;
  readonly authorityFingerprint?: ProofAuthorityFingerprint;
  readonly payload?: unknown;
}): CheckedExtensionFact {
  const ordinal = options.ordinal ?? 0;
  const subject = options.subject ?? {
    kind: "factExtension",
    extensionKey: "fixture",
    subjectKey: `operation:${ordinal + 1}`,
  };
  const authorityFingerprint = options.authorityFingerprint ?? authorityFingerprintForTest(ordinal);
  return {
    ...checkedFactPacketEntryForOptIrTest({
      kind: "extension",
      ordinal,
      subject,
      dependencies: [
        {
          kind: "authorityEntry",
          fingerprint: authorityFingerprint,
          entryKey: `extension:${subject.extensionKey}`,
        },
      ],
    }),
    extensionKey: subject.extensionKey,
    packetKind: options.packetKind ?? subject.extensionKey,
    authorityFingerprint,
    payload: options.payload ?? { fixture: true },
  };
}

export function checkedFactPacketWithEveryKindForOptIrTest(): CheckedFactPacket {
  return {
    ...emptyCheckedFactPacket(),
    ownership: [checkedFactPacketEntryForOptIrTest({ kind: "ownership", ordinal: 0 })],
    noalias: [checkedFactPacketEntryForOptIrTest({ kind: "noalias", ordinal: 1 })],
    fieldDisjointness: [
      checkedFactPacketEntryForOptIrTest({ kind: "fieldDisjointness", ordinal: 2 }),
    ],
    erasures: [checkedFactPacketEntryForOptIrTest({ kind: "erasure", ordinal: 3 })],
    validatedBuffers: [checkedFactPacketEntryForOptIrTest({ kind: "validatedBuffer", ordinal: 4 })],
    packetSources: [checkedFactPacketEntryForOptIrTest({ kind: "packetSource", ordinal: 5 })],
    privateState: [checkedFactPacketEntryForOptIrTest({ kind: "privateState", ordinal: 6 })],
    platformEffects: [checkedFactPacketEntryForOptIrTest({ kind: "platformEffect", ordinal: 7 })],
    capabilityFlow: [checkedFactPacketEntryForOptIrTest({ kind: "capabilityFlow", ordinal: 8 })],
    terminalClosure: [checkedFactPacketEntryForOptIrTest({ kind: "terminalClosure", ordinal: 9 })],
    exitClosure: [checkedFactPacketEntryForOptIrTest({ kind: "exitClosure", ordinal: 10 })],
    layoutAbi: [checkedFactPacketEntryForOptIrTest({ kind: "layoutAbi", ordinal: 11 })],
    origins: [checkedFactPacketEntryForOptIrTest({ kind: "origin", ordinal: 12 })],
    extensions: [checkedExtensionFactPacketEntryForOptIrTest({ ordinal: 13 })],
  };
}
