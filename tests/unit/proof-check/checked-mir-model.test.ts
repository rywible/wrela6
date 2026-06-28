import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  CHECKED_PACKET_FACT_KINDS,
  checkedFactKindId,
  emptyCheckedFactPacket,
  type CheckedFactPacket,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactSubject,
} from "../../../src/proof-check/model/fact-packet";
import type { CheckedFunctionSummary } from "../../../src/proof-check/model/function-summary";
import {
  checkedFunctionSummaryCertificateId,
  checkedTerminalClosureKey,
} from "../../../src/proof-check/model/certificates";
import { proofMirBlockId, proofMirOriginId, proofMirPlaceId } from "../../../src/proof-mir/ids";

const checkedFactPacketKeys = [
  "ownership",
  "noalias",
  "fieldDisjointness",
  "erasures",
  "validatedBuffers",
  "packetSources",
  "privateState",
  "platformEffects",
  "capabilityFlow",
  "terminalClosure",
  "exitClosure",
  "layoutAbi",
  "origins",
] as const;

function ownershipPacketEntryForTest(): CheckedFactPacketEntry<
  CheckedFactKindId,
  CheckedFactSubject
> {
  const certificate: ProofCheckCertificateId = {
    kind: "core",
    id: proofCheckCoreCertificateId(1),
  };

  return {
    factId: proofCheckPacketFactId(1),
    kind: checkedFactKindId("ownership"),
    subject: { kind: "place", placeId: proofMirPlaceId(3) },
    scope: { kind: "wholeImage" },
    dependencies: [{ kind: "proofMirPlace", placeId: proofMirPlaceId(3) }],
    invalidatedBy: [{ kind: "placeMove", placeId: proofMirPlaceId(3) }],
    certificate,
    origin: {
      originKey: "origin:ownership:1",
      proofMirOriginId: proofMirOriginId(4),
    },
  };
}

function checkedFunctionSummaryForTest(): CheckedFunctionSummary {
  return {
    functionInstanceId: monoInstanceId("1"),
    requiredFacts: [{ termKey: "requires:argument:0 <= 8" }],
    observedInputs: [{ kind: "observes", place: { kind: "argument", index: 0 } }],
    consumedInputs: [],
    mutatedInputs: [],
    producedPlaces: [],
    returnedFacts: [{ termKey: "ensures:result <= 8" }],
    invalidatedFacts: [{ kind: "placeMove", placeId: proofMirPlaceId(2) }],
    privateStateEffects: [],
    producedCapabilities: [],
    terminalEffects: [],
    divergence: [{ divergenceKey: "divergence:may-panic", behavior: "mayDiverge" }],
    certificateId: checkedFunctionSummaryCertificateId(9),
  };
}

describe("checked fact kind table", () => {
  test("checked fact packet kind table rejects unknown fact kind labels", () => {
    expect(() => checkedFactKindId("ownership")).not.toThrow();
    expect(() => checkedFactKindId("not-a-proof-check-fact")).toThrow(RangeError);
  });

  test("checked packet fact kinds are the closed Task 5 set", () => {
    expect([...CHECKED_PACKET_FACT_KINDS]).toEqual([
      "ownership",
      "noalias",
      "fieldDisjointness",
      "erasure",
      "validatedBuffer",
      "packetSource",
      "privateState",
      "platformEffect",
      "capabilityFlow",
      "terminalClosure",
      "exitClosure",
      "layoutAbi",
      "origin",
    ]);
  });

  test("every closed packet fact kind round-trips through checkedFactKindId", () => {
    for (const kind of CHECKED_PACKET_FACT_KINDS) {
      expect(checkedFactKindId(kind) as string).toBe(kind);
    }
  });
});

describe("CheckedFactPacket", () => {
  test("checked fact packet exposes exactly the required packet arrays", () => {
    const packet = emptyCheckedFactPacket();

    expect(Object.keys(packet).sort()).toEqual([...checkedFactPacketKeys].sort());
    for (const key of checkedFactPacketKeys) {
      expect(Array.isArray(packet[key])).toBe(true);
    }
  });

  test("packet entry envelopes carry fact identity, scope, dependencies, invalidations, certificate, and origin", () => {
    const entry = ownershipPacketEntryForTest();

    expect(entry.factId).toBe(proofCheckPacketFactId(1));
    expect(entry.kind).toBe(checkedFactKindId("ownership"));
    expect(entry.subject).toEqual({ kind: "place", placeId: proofMirPlaceId(3) });
    expect(entry.scope).toEqual({ kind: "wholeImage" });
    expect(entry.dependencies).toHaveLength(1);
    expect(entry.invalidatedBy).toHaveLength(1);
    expect(entry.certificate).toEqual({ kind: "core", id: proofCheckCoreCertificateId(1) });
    expect(entry.origin.originKey).toBe("origin:ownership:1");
  });

  test("checked fact packet categories accept typed packet entries", () => {
    const entry = ownershipPacketEntryForTest();
    const packet: CheckedFactPacket = {
      ...emptyCheckedFactPacket(),
      ownership: [entry],
    };

    expect(packet.ownership[0]?.kind).toBe(checkedFactKindId("ownership"));
  });
});

describe("ProofCheckCertificateId", () => {
  test("certificate id union supports core, semantics, and summary-instantiation certificates", () => {
    const certificates: ProofCheckCertificateId[] = [
      { kind: "core", id: proofCheckCoreCertificateId(1) },
      { kind: "semantics", id: proofSemanticsCertificateId(2) },
      {
        kind: "summaryInstantiation",
        id: checkedSummaryInstantiationCertificateId(3),
      },
    ];

    expect(certificates.map((certificate) => certificate.kind)).toEqual([
      "core",
      "semantics",
      "summaryInstantiation",
    ]);
  });
});

describe("CheckedMirProgram", () => {
  test("checked mir program preserves the accepted proof mir program reference", () => {
    const mir = { marker: "proof-mir-program" } as unknown as CheckedMirProgram["mir"];
    const checked: CheckedMirProgram = {
      mir,
      checkedFunctions: new Map(),
      summaries: new Map(),
      facts: emptyCheckedFactPacket(),
      terminalGraph: {
        certificateId: proofSemanticsCertificateId(5),
        terminalKey: checkedTerminalClosureKey("terminal:main"),
        closurePath: ["terminal:main"],
        platformEffectKey: "platform:terminal",
      },
      originMap: new Map(),
    };

    expect(checked.mir).toBe(mir);
  });
});

describe("CheckedFunctionSummary", () => {
  test("checked function summary includes the required export fields", () => {
    const summary = checkedFunctionSummaryForTest();

    expect(summary.functionInstanceId).toBe(monoInstanceId("1"));
    expect(summary.requiredFacts).toEqual([{ termKey: "requires:argument:0 <= 8" }]);
    expect(summary.observedInputs).toEqual([
      { kind: "observes", place: { kind: "argument", index: 0 } },
    ]);
    expect(summary.consumedInputs).toEqual([]);
    expect(summary.mutatedInputs).toEqual([]);
    expect(summary.producedPlaces).toEqual([]);
    expect(summary.returnedFacts).toEqual([{ termKey: "ensures:result <= 8" }]);
    expect(summary.invalidatedFacts).toEqual([{ kind: "placeMove", placeId: proofMirPlaceId(2) }]);
    expect(summary.privateStateEffects).toEqual([]);
    expect(summary.producedCapabilities).toEqual([]);
    expect(summary.terminalEffects).toEqual([]);
    expect(summary.divergence).toEqual([
      { divergenceKey: "divergence:may-panic", behavior: "mayDiverge" },
    ]);
    expect(summary.certificateId).toBe(checkedFunctionSummaryCertificateId(9));
  });
});

describe("CheckedMirFunction acceptance metadata", () => {
  test("checked mir function records acceptance certificates without duplicating cfg shape", () => {
    const checkedFunction = {
      functionInstanceId: monoInstanceId("1"),
      entryStateCertificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
      exitCertificates: [{ kind: "core", id: proofCheckCoreCertificateId(2) }],
      summaryCertificate: checkedFunctionSummaryCertificateId(3),
      acceptedBlockStates: [
        {
          certificateId: { kind: "core", id: proofCheckCoreCertificateId(4) },
          functionInstanceId: monoInstanceId("1"),
          blockId: proofMirBlockId(0),
          stateKey: "state:block:0",
        },
      ],
    };

    expect(checkedFunction.acceptedBlockStates[0]?.blockId).toBe(proofMirBlockId(0));
    expect(checkedFunction.summaryCertificate).toBe(checkedFunctionSummaryCertificateId(3));
  });
});
