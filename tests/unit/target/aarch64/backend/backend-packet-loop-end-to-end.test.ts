import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import { packetLoopBackendInputForTest } from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend packet loop end-to-end compile", () => {
  test("packet loop provenance explains direct endian field load", () => {
    const result = compileAArch64Object({
      ...packetLoopBackendInputForTest(),
      debugArtifacts: { allocationPlan: true },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected packet loop object");
    expect(result.objectModule.sections[0]?.bytes).toEqual([
      0x20, 0x08, 0x40, 0xf9, 0x01, 0x04, 0xc0, 0xda, 0xbf, 0x3b, 0x03, 0xd5, 0x9f, 0x3b, 0x03,
      0xd5, 0xc0, 0x03, 0x5f, 0xd6,
    ]);
    expect(result.debugArtifacts?.allocationPlan).toContain("packet.loop:vreg:1:x1:0-1");
    expect(result.objectModule.factSpending.map((record) => record.authority)).toEqual([
      "core-owner-and-transfer",
      "memory-order-and-region-type",
      "terminal-exit-and-cleanup",
      "validated-region-shape",
    ]);
    const endianByte = result.objectModule.byteProvenance.find(
      (record) =>
        record.factFamilies.includes("validated-region-shape") &&
        record.machineSubjectKey === "region:packet.field.ethertype",
    );
    expect(endianByte).toBeDefined();
  });
});
