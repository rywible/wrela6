import { aarch64MemoryOrderingMetadata } from "../../../../../src/target/aarch64/machine-ir/memory-order";
import { aarch64ScheduleMetadata } from "../../../../../src/target/aarch64/machine-ir/schedule";
import { aarch64SecurityMetadata } from "../../../../../src/target/aarch64/machine-ir/security";

export function releaseDeviceOrderingForTest() {
  return aarch64MemoryOrderingMetadata({
    order: "release",
    regionMemoryType: "deviceMmio",
    barrierDomain: { domain: "innerShareable", access: "stores" },
    atomicity: "singleCopyAtomic",
  });
}

export function fpScheduleForTest() {
  return aarch64ScheduleMetadata({
    issueClass: "fp",
    latencyClass: "multiCycle",
    motion: { kind: "insideEffectIsland" },
    pairability: [],
    pressure: { gpr: 0, vector: 1 },
    errataConstraints: [],
  });
}

export function secretSecurityForTest() {
  return aarch64SecurityMetadata({
    labels: [{ kind: "secret", key: "fixture.secret" }],
    constantTime: true,
    spillPolicy: "noSpill",
  });
}
