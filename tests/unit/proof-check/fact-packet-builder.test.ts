import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../../../src/proof-check/ids";
import type { CheckedMirFunction } from "../../../src/proof-check/model/checked-mir";
import type { ProofCheckCoreCertificate } from "../../../src/proof-check/model/certificates";
import { checkedFunctionSummaryCertificateId } from "../../../src/proof-check/model/certificates";
import {
  checkedFactKindId,
  layoutFactKey,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactSubject,
} from "../../../src/proof-check/model/fact-packet";
import { buildCheckedFactPacket } from "../../../src/proof-check/validation/fact-packet-builder";
import {
  checkedFactScopeKey,
  checkedFactSubjectKey,
} from "../../../src/proof-check/validation/packet-validator";
import { proofMirOriginId, proofMirPlaceId } from "../../../src/proof-mir/ids";
import { checkedPacketEnvelopeForTest } from "./packet-envelope-validator.test";
import { ownershipFactForTest } from "./packet-validator.test";

function coreCertificateForTest(
  certificateId = proofCheckCoreCertificateId(1),
  subjectKey = "arg:0",
  overrides: Partial<ProofCheckCoreCertificate> = {},
): ProofCheckCoreCertificate {
  return {
    certificateId,
    rule: "ownershipTransfer",
    subjectKey,
    dependencyKeys: [],
    ...overrides,
  };
}

function originEntryCertificatesForStagedEntries(
  stagedEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[],
  startingId = 100,
): ProofCheckCoreCertificate[] {
  const originKeys = new Set<string>();
  for (const entry of stagedEntries) {
    if (entry.origin.originKey.length > 0) {
      originKeys.add(entry.origin.originKey);
    }
  }
  let nextId = startingId;
  return [...originKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((originKey) =>
      coreCertificateForTest(proofCheckCoreCertificateId(nextId++), `origin-entry:${originKey}`, {
        rule: "initialState",
      }),
    );
}

function checkedFunctionForTest(
  functionInstanceId = monoInstanceId("fn:main"),
): CheckedMirFunction {
  return {
    functionInstanceId,
    entryStateCertificate: { kind: "core", id: proofCheckCoreCertificateId(10) },
    exitCertificates: [],
    summaryCertificate: checkedFunctionSummaryCertificateId(1),
    acceptedBlockStates: [],
  };
}

function stagedEntryForKind(
  kind: CheckedFactKindId,
  overrides: Partial<CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>> = {},
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const certificateId = proofCheckCoreCertificateId(
    kind === checkedFactKindId("ownership") ? 1 : stableSeed(String(kind)),
  );

  return checkedPacketEnvelopeForTest({
    factId: proofCheckPacketFactId(
      stableSeed(`${String(kind)}:${String(overrides.origin?.originKey ?? "x")}`),
    ),
    kind,
    certificate: { kind: "core", id: certificateId },
    scope: { kind: "wholeImage" },
    ...overrides,
  });
}

function stableSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % 900_000) + 1_000;
}

describe("buildCheckedFactPacket", () => {
  test("builds an empty packet from no staged entries", () => {
    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest()],
      stagedEntries: [],
      certificates: [],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packet.ownership).toEqual([]);
    expect(result.packet.origins).toEqual([]);
  });

  test("partitions staged entries into packet category arrays", () => {
    const ownership = ownershipFactForTest();
    const noalias = stagedEntryForKind(checkedFactKindId("noalias"), {
      subject: { kind: "place", placeId: proofMirPlaceId(2) },
      certificate: { kind: "core", id: proofCheckCoreCertificateId(2) },
    });
    const layoutAbi = stagedEntryForKind(checkedFactKindId("layoutAbi"), {
      subject: { kind: "layout", layoutKey: layoutFactKey("layout:abi") },
      certificate: { kind: "core", id: proofCheckCoreCertificateId(3) },
    });

    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest()],
      stagedEntries: [layoutAbi, noalias, ownership],
      certificates: [
        coreCertificateForTest(proofCheckCoreCertificateId(1)),
        coreCertificateForTest(proofCheckCoreCertificateId(2), "place:2"),
        coreCertificateForTest(proofCheckCoreCertificateId(3), "layout:abi"),
        ...originEntryCertificatesForStagedEntries([layoutAbi, noalias, ownership]),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packet.ownership).toHaveLength(1);
    expect(result.packet.noalias).toHaveLength(1);
    expect(result.packet.layoutAbi).toHaveLength(1);
    expect(result.packet.fieldDisjointness).toEqual([]);
  });

  test("sorts packet entries by fact kind, subject key, validity scope, and origin", () => {
    const laterOrigin = {
      originKey: "origin:z",
      proofMirOriginId: proofMirOriginId(9),
    };
    const earlierOrigin = {
      originKey: "origin:a",
      proofMirOriginId: proofMirOriginId(1),
    };
    const entries = [
      ownershipFactForTest({
        subject: { kind: "place", placeId: proofMirPlaceId(2) },
        scope: { kind: "function", functionInstanceId: monoInstanceId("fn:b") },
        origin: laterOrigin,
        certificate: { kind: "core", id: proofCheckCoreCertificateId(2) },
      }),
      ownershipFactForTest({
        subject: { kind: "place", placeId: proofMirPlaceId(1) },
        scope: { kind: "function", functionInstanceId: monoInstanceId("fn:a") },
        origin: earlierOrigin,
        certificate: { kind: "core", id: proofCheckCoreCertificateId(3) },
      }),
    ];

    const result = buildCheckedFactPacket({
      acceptedFunctions: [
        checkedFunctionForTest(monoInstanceId("fn:a")),
        checkedFunctionForTest(monoInstanceId("fn:b")),
      ],
      stagedEntries: entries,
      certificates: [
        coreCertificateForTest(proofCheckCoreCertificateId(1)),
        coreCertificateForTest(proofCheckCoreCertificateId(2), "place:2"),
        coreCertificateForTest(proofCheckCoreCertificateId(3), "place:1"),
        ...originEntryCertificatesForStagedEntries(entries),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packet.ownership.map((entry) => entry.origin.originKey)).toEqual([
      "origin:a",
      "origin:z",
    ]);
    expect(
      result.packet.ownership.map((entry) =>
        [
          checkedFactSubjectKey(entry.subject),
          checkedFactScopeKey(entry.scope),
          entry.origin.originKey,
        ].join("|"),
      ),
    ).toEqual([
      ["place:1", "function:fn:a", "origin:a"].join("|"),
      ["place:2", "function:fn:b", "origin:z"].join("|"),
    ]);
  });

  test("collects origin facts from staged entries and explicit origins", () => {
    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest()],
      stagedEntries: [
        ownershipFactForTest({
          origin: { originKey: "origin:ownership", proofMirOriginId: proofMirOriginId(1) },
        }),
      ],
      explicitOrigins: [{ originKey: "origin:summary", proofMirOriginId: proofMirOriginId(2) }],
      certificates: [
        coreCertificateForTest(proofCheckCoreCertificateId(1)),
        coreCertificateForTest(proofCheckCoreCertificateId(10), "origin-entry:origin:ownership", {
          rule: "initialState",
        }),
        coreCertificateForTest(proofCheckCoreCertificateId(11), "origin-entry:origin:summary", {
          rule: "initialState",
        }),
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packet.origins.map((entry) => entry.origin.originKey)).toEqual([
      "origin:ownership",
      "origin:summary",
    ]);
    expect(result.packet.origins.every((entry) => entry.kind === checkedFactKindId("origin"))).toBe(
      true,
    );
    expect(result.packet.origins.every((entry) => entry.factId !== undefined)).toBe(true);
  });

  test("rejects staged entries whose certificates are missing from the builder input", () => {
    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest()],
      stagedEntries: [ownershipFactForTest()],
      certificates: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stableDetail).toContain("staged-entry-missing-certificate");
  });

  test("rejects unknown staged fact kinds", () => {
    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest()],
      stagedEntries: [
        ownershipFactForTest({
          kind: "forged" as CheckedFactKindId,
        }),
      ],
      certificates: [coreCertificateForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stableDetail).toContain("staged-entry-unknown-fact-kind:forged");
  });

  test("rejects staged entries outside accepted functions", () => {
    const result = buildCheckedFactPacket({
      acceptedFunctions: [checkedFunctionForTest(monoInstanceId("fn:accepted"))],
      stagedEntries: [
        ownershipFactForTest({
          scope: { kind: "function", functionInstanceId: monoInstanceId("fn:other") },
        }),
      ],
      certificates: [coreCertificateForTest()],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.stableDetail).toContain("staged-entry-outside-accepted-function");
  });
});
