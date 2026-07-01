import { targetId } from "../../../src/semantic/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  checkedFactKindId,
  layoutFactKey,
  type CheckedFactDependency,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedPacketFactKind,
} from "../../../src/proof-check/model/fact-packet";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import {
  proofCheckCoreCertificateId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import { proofCheckPathCertificateId } from "../../../src/proof-check/ids";
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
import {
  type CheckedFactImportValidationInput,
  validateCheckedFactImportSchema,
} from "../../../src/opt-ir/facts/fact-import-schema";
import {
  checkedFactPacketEntryForOptIrTest,
  checkedFactPacketWithEveryKindForOptIrTest,
} from "./fact-packet-fixtures";
import { checkedOptIrHandoffForTest } from "./opt-ir-handoff-fixtures";

export function factImportAuthorityFingerprintForTest(ordinal = 1): ProofAuthorityFingerprint {
  return {
    authorityKind: "platform",
    targetId: targetId("opt-ir-fixture-target"),
    version: "v1",
    digestAlgorithm: "sha256",
    digestHex: `${ordinal.toString(16).padStart(2, "0")}`.repeat(32).slice(0, 64),
  };
}

export function checkedFactPacketEntryForTest(options: {
  readonly kind: CheckedPacketFactKind;
  readonly ordinal?: number;
  readonly subject?: CheckedFactSubject;
  readonly scope?: CheckedFactScope;
  readonly dependencies?: readonly CheckedFactDependency[];
  readonly certificate?: CheckedFactPacketEntry<
    ReturnType<typeof checkedFactKindId>,
    CheckedFactSubject
  >["certificate"];
}): CheckedFactPacketEntry<ReturnType<typeof checkedFactKindId>, CheckedFactSubject> {
  const ordinal = options.ordinal ?? 0;
  const base = checkedFactPacketEntryForOptIrTest({
    kind: options.kind,
    ordinal,
    subject: options.subject ?? subjectForImportKind(options.kind),
    scope: options.scope,
    dependencies: options.dependencies ?? dependenciesForImportKind(options.kind),
  });
  return {
    ...base,
    certificate:
      options.certificate ??
      (options.kind === "terminalClosure"
        ? { kind: "semantics", id: proofSemanticsCertificateId(1) }
        : base.certificate),
  };
}

export function completeFactImportValidationInputForTest(options: {
  readonly kind: CheckedPacketFactKind;
  readonly entry?: CheckedFactPacketEntry<ReturnType<typeof checkedFactKindId>, CheckedFactSubject>;
}): CheckedFactImportValidationInput {
  const handoff = checkedOptIrHandoffForTest({ includePathCertificates: true });
  const entry = options.entry ?? checkedFactPacketEntryForTest({ kind: options.kind });
  return {
    entry,
    handoff: {
      ...handoff,
      packetValidation: {
        ...handoff.packetValidation,
        terminalGraphCertificateId: proofSemanticsCertificateId(1),
        authorityFingerprints: [factImportAuthorityFingerprintForTest()],
      },
    },
    packet: checkedFactPacketWithEveryKindForOptIrTest(),
    proofMirLookups: {
      places: [proofMirPlaceId(1), proofMirPlaceId(2)],
      values: [proofMirValueId(1), proofMirValueId(2)],
      edges: [proofMirControlEdgeId(1), proofMirControlEdgeId(5), proofMirControlEdgeId(11)],
      callSubjects: [
        { functionInstanceId: monoInstanceId("fixture::main"), callId: proofMirCallId(1) },
      ],
      facts: [proofMirFactId(1)],
      origins: [proofMirOriginId(1)],
      privateGenerations: [proofMirPrivateStateGenerationId(1)],
    },
    layoutFacts: {
      keys: ["layout:fixture"],
      fingerprint: factImportAuthorityFingerprintForTest(),
    },
  };
}

export function validateCheckedFactImportSchemaForTest(
  options: Partial<CheckedFactImportValidationInput> & {
    readonly entry: CheckedFactImportValidationInput["entry"];
  },
) {
  const input = completeFactImportValidationInputForTest({
    kind: String(options.entry.kind) as CheckedPacketFactKind,
    entry: options.entry,
  });
  return validateCheckedFactImportSchema({ ...input, ...options });
}

export function wrongSubjectForFactImportTest(kind: CheckedPacketFactKind): CheckedFactSubject {
  if (kind === "terminalClosure") {
    return { kind: "place", placeId: proofMirPlaceId(1) };
  }
  return { kind: "terminal", terminalKey: checkedTerminalClosureKey("terminal:wrong") };
}

export const wrongCoreCertificateForFactImportTest = {
  kind: "core" as const,
  id: proofCheckCoreCertificateId(999),
};

export const semanticsCertificateForFactImportTest = {
  kind: "semantics" as const,
  id: proofSemanticsCertificateId(999),
};

export const missingPathScopeForFactImportTest = {
  kind: "path" as const,
  certificateId: proofCheckPathCertificateId(999),
};

function subjectForImportKind(kind: CheckedPacketFactKind): CheckedFactSubject {
  switch (kind) {
    case "ownership":
    case "fieldDisjointness":
    case "erasure":
      return { kind: "place", placeId: proofMirPlaceId(1) };
    case "noalias":
    case "validatedBuffer":
      return { kind: "value", valueId: proofMirValueId(1) };
    case "packetSource":
      return { kind: "packetSource", packet: proofMirPlaceId(1), source: proofMirPlaceId(2) };
    case "privateState":
      return {
        kind: "privateState",
        placeId: proofMirPlaceId(1),
        generation: proofMirPrivateStateGenerationId(1),
      };
    case "platformEffect":
      return {
        kind: "authority",
        fingerprint: factImportAuthorityFingerprintForTest(),
        entryKey: "platform:get_memory_map",
      };
    case "capabilityFlow":
      return {
        kind: "call",
        functionInstanceId: monoInstanceId("fixture::main"),
        callId: proofMirCallId(1),
      };
    case "terminalClosure":
      return { kind: "terminal", terminalKey: checkedTerminalClosureKey("terminal:fixture") };
    case "exitClosure":
      return {
        kind: "edge",
        functionInstanceId: monoInstanceId("fixture::main"),
        edgeId: proofMirControlEdgeId(1),
      };
    case "layoutAbi":
      return { kind: "layout", layoutKey: layoutFactKey("layout:fixture") };
    case "origin":
      return { kind: "mirOrigin", proofMirOriginId: proofMirOriginId(1) };
    case "extension":
      return { kind: "factExtension", extensionKey: "fixture", subjectKey: "operation:1" };
  }
}

function dependenciesForImportKind(kind: CheckedPacketFactKind): readonly CheckedFactDependency[] {
  const core = { kind: "coreCertificate" as const, certificateId: proofCheckCoreCertificateId(1) };
  switch (kind) {
    case "ownership":
      return [
        { kind: "proofMirPlace", placeId: proofMirPlaceId(1) },
        { kind: "proofMirValue", valueId: proofMirValueId(1) },
        core,
      ];
    case "noalias":
      return [
        { kind: "proofMirPlace", placeId: proofMirPlaceId(1) },
        { kind: "proofMirValue", valueId: proofMirValueId(1) },
        { kind: "proofMirEdge", edgeId: proofMirControlEdgeId(1) },
        core,
      ];
    case "fieldDisjointness":
      return [
        { kind: "layoutFact", layoutKey: layoutFactKey("layout:fixture") },
        { kind: "proofMirPlace", placeId: proofMirPlaceId(1) },
      ];
    case "erasure":
      return [{ kind: "proofMirPlace", placeId: proofMirPlaceId(1) }, core];
    case "validatedBuffer":
      return [
        { kind: "proofMirEdge", edgeId: proofMirControlEdgeId(1) },
        { kind: "layoutFact", layoutKey: layoutFactKey("layout:fixture") },
        core,
      ];
    case "packetSource":
      return [
        { kind: "proofMirPlace", placeId: proofMirPlaceId(1) },
        { kind: "packetSource", packet: proofMirPlaceId(1), source: proofMirPlaceId(2) },
        core,
      ];
    case "privateState":
      return [{ kind: "privateGeneration", generation: proofMirPrivateStateGenerationId(1) }, core];
    case "platformEffect":
      return [
        {
          kind: "authorityEntry",
          fingerprint: factImportAuthorityFingerprintForTest(),
          entryKey: "platform:get_memory_map",
        },
        core,
      ];
    case "capabilityFlow":
      return [
        {
          kind: "authorityEntry",
          fingerprint: factImportAuthorityFingerprintForTest(),
          entryKey: "platform:get_memory_map",
        },
        { kind: "proofMirCall", callId: proofMirCallId(1) },
      ];
    case "terminalClosure":
      return [{ kind: "semanticsCertificate", certificateId: proofSemanticsCertificateId(1) }];
    case "exitClosure":
      return [core, { kind: "proofMirEdge", edgeId: proofMirControlEdgeId(1) }];
    case "layoutAbi":
      return [{ kind: "layoutFact", layoutKey: layoutFactKey("layout:fixture") }];
    case "origin":
      return [{ kind: "proofMirFact", factId: proofMirFactId(1) }];
    case "extension":
      return [
        {
          kind: "authorityEntry",
          fingerprint: factImportAuthorityFingerprintForTest(),
          entryKey: "extension:fixture",
        },
      ];
  }
}
