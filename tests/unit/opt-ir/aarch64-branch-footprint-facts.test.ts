import { describe, expect, test } from "bun:test";
import { optIrEdgeId, optIrFactId, optIrRegionId } from "../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { branchFactRecord } from "../../../src/opt-ir/facts/branch-facts";
import { footprintFactRecord } from "../../../src/opt-ir/facts/footprint-facts";
import { createAArch64FactQuery } from "../../../src/target/aarch64/facts/aarch64-fact-adapter";

describe("AArch64 branch and footprint facts", () => {
  test("branch fact records keep probability payloads stable", () => {
    const record = branchFactRecord({
      factId: optIrFactId(11),
      edgeId: optIrEdgeId(4),
      probability: 0.875,
      frequency: "hot",
      source: "profile",
    });

    expect(record).toMatchObject({
      extensionKey: "branch",
      extensionPacketKind: "branch",
      subjectKey: "edge:4",
      extensionPayload: { frequency: "hot", probability: 0.875, source: "profile" },
      extensionAuthority: "proof:branch",
    });
  });

  test("AArch64 query exposes edge branch probability", () => {
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        branchFactRecord({
          factId: optIrFactId(12),
          edgeId: optIrEdgeId(5),
          probability: 0.25,
          frequency: "cold",
          source: "static",
        }),
      ]),
    );

    expect(query.branchProbabilityForEdge(optIrEdgeId(5))).toEqual({
      kind: "yes",
      frequency: "cold",
      probability: 0.25,
      source: "static",
      factsUsed: [optIrFactId(12)],
      explanation: ["Fact 12 supplies branch for edge:5."],
    });
  });

  test("footprint query proves covered ranges and rejects gaps", () => {
    const region = optIrRegionId(3);
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        footprintFactRecord({
          factId: optIrFactId(13),
          regionId: region,
          start: 16n,
          endExclusive: 48n,
          access: "readWrite",
          alignment: 16,
        }),
      ]),
    );

    expect(
      query.provesDereferenceableFootprint({ region, start: 24n, endExclusive: 40n }),
    ).toMatchObject({
      kind: "yes",
      dereferenceable: true,
      access: "readWrite",
      alignment: 16,
      factsUsed: [optIrFactId(13)],
    });
    expect(query.provesDereferenceableFootprint({ region, start: 8n, endExclusive: 40n })).toEqual({
      kind: "no",
      reason: "missingCompleteFootprint",
      factsUsed: [optIrFactId(13)],
    });
  });

  test("footprint query treats malformed ranges as missing evidence", () => {
    const region = optIrRegionId(3);
    const record = footprintFactRecord({
      factId: optIrFactId(16),
      regionId: region,
      start: 16n,
      endExclusive: 48n,
      access: "read",
    });
    if (record.extensionPayload === undefined || typeof record.extensionPayload !== "object") {
      throw new Error("Expected footprint payload object.");
    }
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        {
          ...record,
          extensionPayload: {
            ...record.extensionPayload,
            start: "not-a-number",
          },
        },
      ]),
    );

    expect(query.provesDereferenceableFootprint({ region, start: 24n, endExclusive: 40n })).toEqual(
      {
        kind: "no",
        reason: "missingCompleteFootprint",
        factsUsed: [optIrFactId(16)],
      },
    );
  });

  test("fact builders reject invalid probability and footprint ranges", () => {
    expect(() =>
      branchFactRecord({
        factId: optIrFactId(14),
        edgeId: optIrEdgeId(6),
        probability: 1.5,
        source: "profile",
      }),
    ).toThrow("branch probability must be between 0 and 1.");
    expect(() =>
      footprintFactRecord({
        factId: optIrFactId(15),
        regionId: optIrRegionId(4),
        start: 10n,
        endExclusive: 10n,
        access: "read",
      }),
    ).toThrow("footprint endExclusive must be greater than start.");
  });
});
