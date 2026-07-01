import { describe, expect, test } from "bun:test";
import { aarch64MachineInstructionId } from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64MemoryFootprint,
  aarch64MemoryOrderingMetadata,
} from "../../../../src/target/aarch64/machine-ir/memory-order";
import { aarch64RematerializationRecord } from "../../../../src/target/aarch64/machine-ir/rematerialization";
import { aarch64ScheduleMetadata } from "../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64SecurityMetadata } from "../../../../src/target/aarch64/machine-ir/security";

describe("AArch64 machine metadata records", () => {
  test("schedule metadata builders freeze nested records", () => {
    const metadata = aarch64ScheduleMetadata({
      issueClass: "integer",
      latencyClass: "singleCycle",
      motion: { kind: "insideEffectIsland" },
      pairability: ["loadPairCandidate"],
      pressure: { gpr: 1, vector: 0 },
      errataConstraints: [],
    });

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.pairability)).toBe(true);
  });

  test("memory ordering and footprint records validate impossible values", () => {
    expect(
      aarch64MemoryOrderingMetadata({
        order: "release",
        regionMemoryType: "deviceMmio",
        barrierDomain: { domain: "innerShareable", access: "stores" },
        atomicity: "singleCopyAtomic",
      }).regionMemoryType,
    ).toBe("deviceMmio");

    expect(() =>
      aarch64MemoryFootprint({
        regionKey: "packet",
        start: 8n,
        widthBytes: 0,
        alignment: 8,
      }),
    ).toThrow(RangeError);
  });

  test("rematerialization and security metadata freeze authorities", () => {
    const rematerialization = aarch64RematerializationRecord({
      producer: aarch64MachineInstructionId(7),
      kind: "symbolPageBase",
      cost: 1,
      requiredFacts: ["machineFact:1"],
      requiredSymbols: ["global.config"],
      relocationReferences: ["reloc:1"],
      implicitResources: [{ kind: "NZCV" }],
    });
    const security = aarch64SecurityMetadata({
      labels: [{ kind: "secret", key: "session-key" }],
      constantTime: true,
      spillPolicy: "noSpill",
      zeroization: { required: true, reason: "key lifetime ended" },
    });

    expect(Object.isFrozen(rematerialization.requiredFacts)).toBe(true);
    expect(security.spillPolicy).toBe("noSpill");
    expect(() =>
      aarch64SecurityMetadata({
        labels: [{ kind: "secret", key: "" }],
        constantTime: false,
        spillPolicy: "ordinary",
      }),
    ).toThrow(RangeError);
  });
});
