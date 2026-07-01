import { describe, expect, test } from "bun:test";

import { compileAArch64Object } from "../../../../../src/target/aarch64/backend/api/compile-aarch64-object";
import {
  backendInputForTest,
  packetLoopBackendInputForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("AArch64 backend debug artifacts", () => {
  test("omits artifacts when none are requested", () => {
    const result = compileAArch64Object(backendInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected compile success");
    expect(result.debugArtifacts).toBeUndefined();
  });

  test("returns stable requested artifacts without host metadata", () => {
    const first = compileAArch64Object(packetLoopBackendInputForTestWithDebug());
    const second = compileAArch64Object(packetLoopBackendInputForTestWithDebug());

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected compile success");
    expect(first.debugArtifacts).toEqual(second.debugArtifacts);
    expect(first.debugArtifacts?.requested).toEqual([
      "allocationPlan",
      "byteProvenance",
      "factTransferGraph",
      "framePlan",
      "layoutTrace",
      "verifierTrace",
    ]);
    expect(JSON.stringify(first.debugArtifacts)).not.toContain(process.cwd());
    expect(first.debugArtifacts?.factTransferGraph).toEqual([
      "core-owner-and-transfer:vreg:1",
      "memory-order-and-region-type:memory:1:1",
      "terminal-exit-and-cleanup:block:0",
      "validated-region-shape:region:packet.field.ethertype",
    ]);
    expect(first.debugArtifacts?.allocationPlan).toEqual([
      "packet.loop:vreg:0:x0:0-2",
      "packet.loop:vreg:1:x1:0-1",
      "packet.loop:vreg:2:x1:1-2",
    ]);
    expect(first.debugArtifacts?.byteProvenance).toEqual([
      ".text:0:4:packet.field.ethertype",
      ".text:4:4:packet.field.ethertype.endian",
      ".text:8:4:packet.loop.barrier.dmb",
      ".text:12:4:packet.loop.barrier.dsb",
      ".text:16:4:packet.loop:return",
    ]);
    expect(first.debugArtifacts?.framePlan).toEqual(["packet.loop:frameless-leaf:size:0"]);
  });

  test("does not include verifier trace unless requested", () => {
    const result = compileAArch64Object({
      ...packetLoopBackendInputForTest(),
      debugArtifacts: { allocationPlan: true },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected compile success");
    expect(result.debugArtifacts?.requested).toEqual(["allocationPlan"]);
    expect(result.debugArtifacts?.allocationPlan).toBeDefined();
    expect(result.debugArtifacts?.verifierTrace).toBeUndefined();
  });
});

function packetLoopBackendInputForTestWithDebug() {
  return {
    ...packetLoopBackendInputForTest(),
    debugArtifacts: {
      allocationPlan: true,
      framePlan: true,
      verifierTrace: true,
      layoutTrace: true,
      factTransferGraph: true,
      byteProvenance: true,
    },
  };
}
