import { describe, expect, test } from "bun:test";

import {
  authenticatedBackendTargetSurfaceForTest,
  backendInputForTest,
  packetLoopBackendInputForTest,
  sectionForTest,
  symbolForTest,
} from "../../../../../tests/support/target/aarch64/backend/backend-fixtures";

describe("backend fixture contract", () => {
  test("default backend input is deterministic and production-valid", () => {
    const input = backendInputForTest();

    expect(input.target.backendSurfaceFingerprint).toBe(
      authenticatedBackendTargetSurfaceForTest().backendSurfaceFingerprint,
    );
    expect(input.machineProgram.functions.entries()).toEqual([]);
    expect(input.closedImagePlan.closureKind).toBe("closed-image");
    expect(input.debugArtifacts).toEqual({});
  });

  test("object fixture identity normalizes to stableKey", () => {
    expect(sectionForTest("text.z")).toEqual(sectionForTest({ stableKey: "text.z" }));
    expect(String(symbolForTest("main").stableKey)).toBe("main");
  });

  test("packet loop fixture carries proof-spending facts", () => {
    const input = packetLoopBackendInputForTest();

    expect(
      input.machineProgram.functions
        .entries()
        .map((machineFunction) => String(machineFunction.symbol)),
    ).toEqual(["packet.loop"]);
    expect(input.preservedFacts.records.map((record) => record.extensionKey)).toContain(
      "validated-region-shape",
    );
  });
});
