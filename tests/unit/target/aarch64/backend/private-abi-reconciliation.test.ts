import { describe, expect, test } from "bun:test";

import {
  reconcileAArch64CallBoundaries,
  verifyVeneerScratchPolicy,
} from "../../../../../src/target/aarch64/backend/abi/call-boundary-reconciliation";
import { authenticatedBackendTargetSurfaceForTest } from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";

const surface = authenticatedBackendTargetSurfaceForTest();

describe("AArch64 private ABI reconciliation", () => {
  test("uses private convention only for exact authorized closed-image pair", () => {
    const result = reconcileAArch64CallBoundaries({
      targetSurface: surface,
      callerKey: "main",
      callSites: [
        {
          callKey: "call:main:helper",
          callerKey: "main",
          calleeKey: "helper",
          boundaryKind: "closed-image",
          parameters: [],
          returns: [],
        },
      ],
      privateConventions: [
        {
          callerKey: "main",
          calleeKey: "helper",
          clobberedGprs: ["x9", "x10"],
          pinnedLiveThroughGprs: ["x19"],
          resultLocations: [{ valueKey: "a", location: { kind: "gpr", register: "x9" } }],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected reconciliation");
    expect(result.value.boundaries[0]?.boundaryKind).toBe("private");
    expect(result.value.boundaries[0]?.clobberedGprs).toEqual(["x10", "x9"]);
    expect(result.value.boundaries[0]?.pinnedLiveThroughGprs).toEqual(["x19"]);
  });

  test("falls back to public for exported/address-taken/replacement and rejects mismatched private plan", () => {
    const result = reconcileAArch64CallBoundaries({
      targetSurface: surface,
      callerKey: "main",
      callSites: [
        {
          callKey: "call:export",
          callerKey: "main",
          calleeKey: "api",
          boundaryKind: "exported",
          parameters: [],
          returns: [],
        },
        {
          callKey: "call:mismatch",
          callerKey: "main",
          calleeKey: "wrong",
          boundaryKind: "closed-image",
          parameters: [],
          returns: [],
        },
      ],
      privateConventions: [{ callerKey: "other", calleeKey: "wrong" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected mismatch");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "call-boundary:private-caller-callee-mismatch:call:mismatch:main:wrong",
    ]);
  });

  test("verifies declared veneer scratch policy", () => {
    const diagnostic = verifyVeneerScratchPolicy({
      boundary: { callKey: "call:main:helper", potentialVeneerClobberGprs: [] },
      requestedVeneer: { scratchGprs: ["x16"] },
    });

    expect(diagnostic?.stableDetail).toBe(
      "call-boundary:undeclared-veneer-scratch:call:main:helper:x16",
    );
  });
});
