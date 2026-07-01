import { describe, expect, test } from "bun:test";
import { optIrCallId, optIrFactId, optIrOperationId } from "../../../src/opt-ir/ids";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { callClobberFactRecord } from "../../../src/opt-ir/facts/call-clobber-facts";
import { vectorStateFactRecord } from "../../../src/opt-ir/facts/vector-state-facts";
import { createAArch64FactQuery } from "../../../src/target/aarch64/facts/aarch64-fact-adapter";

describe("AArch64 vector-state and call-clobber facts", () => {
  test("vector state facts carry lane and predicate metadata", () => {
    const record = vectorStateFactRecord({
      factId: optIrFactId(31),
      operationId: optIrOperationId(12),
      vectorWidthBits: 128,
      laneWidthBits: 32,
      predicate: "allActive",
      preservesInactiveLanes: true,
    });

    expect(record).toMatchObject({
      extensionKey: "vector-state",
      extensionPacketKind: "vector-state",
      subjectKey: "operation:12",
      extensionPayload: {
        laneCount: 4,
        laneWidthBits: 32,
        predicate: "allActive",
        preservesInactiveLanes: true,
        vectorWidthBits: 128,
      },
      extensionAuthority: "proof:vector-state",
    });
  });

  test("call clobber facts sort register names deterministically", () => {
    const record = callClobberFactRecord({
      factId: optIrFactId(32),
      callId: optIrCallId(6),
      clobberedRegisters: ["v1", "x0", "v0"],
      preservesNZCV: false,
      clobbersMemory: true,
    });

    expect(record).toMatchObject({
      extensionKey: "call-clobber",
      extensionPacketKind: "call-clobber",
      subjectKey: "call:6",
      extensionPayload: {
        clobberedRegisters: ["v0", "v1", "x0"],
        clobbersMemory: true,
        preservesNZCV: false,
      },
      extensionAuthority: "proof:call-clobber",
    });
  });

  test("AArch64 query exposes vector state and call clobber facts", () => {
    const query = createAArch64FactQuery(
      optIrFactSetFromRecords([
        vectorStateFactRecord({
          factId: optIrFactId(33),
          operationId: optIrOperationId(13),
          vectorWidthBits: 256,
          laneWidthBits: 64,
          predicate: "masked",
        }),
        callClobberFactRecord({
          factId: optIrFactId(34),
          callId: optIrCallId(7),
          clobberedRegisters: ["x0"],
          preservesNZCV: true,
          clobbersMemory: false,
        }),
      ]),
    );

    expect(query.vectorStateForOperation(optIrOperationId(13))).toMatchObject({
      kind: "yes",
      laneCount: 4,
      predicate: "masked",
      factsUsed: [optIrFactId(33)],
    });
    expect(query.callClobberForCall(optIrCallId(7))).toMatchObject({
      kind: "yes",
      clobberedRegisters: ["x0"],
      preservesNZCV: true,
      clobbersMemory: false,
      factsUsed: [optIrFactId(34)],
    });
  });

  test("fact builders reject non-divisible vector lanes and empty clobber registers", () => {
    expect(() =>
      vectorStateFactRecord({
        factId: optIrFactId(35),
        operationId: optIrOperationId(14),
        vectorWidthBits: 192,
        laneWidthBits: 128,
        predicate: "allActive",
      }),
    ).toThrow("vector width must be evenly divisible by lane width.");
    expect(() =>
      callClobberFactRecord({
        factId: optIrFactId(36),
        callId: optIrCallId(8),
        clobberedRegisters: ["x0", ""],
        preservesNZCV: true,
        clobbersMemory: false,
      }),
    ).toThrow("call clobber register names must be non-empty.");
  });
});
