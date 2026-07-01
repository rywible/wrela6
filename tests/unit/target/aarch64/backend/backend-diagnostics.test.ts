import { describe, expect, test } from "bun:test";

import {
  aarch64BackendDiagnostic,
  aarch64BackendFrameSlotId,
  aarch64BackendVerifierRunKey,
  aarch64BackendVerificationSummary,
  sortAArch64BackendDiagnostics,
} from "../../../../../src/target/aarch64/backend/api/diagnostics";

describe("AArch64 backend diagnostics and stable ids", () => {
  test("backend diagnostics sort by stable order key", () => {
    const diagnostics = [
      aarch64BackendDiagnostic({
        code: "AARCH64_BACKEND_FRAME_INVALID",
        ownerKey: "frame",
        rootCauseKey: "slot:2",
        stableDetail: "frame:slot-overlap:2:3",
      }),
      aarch64BackendDiagnostic({
        code: "AARCH64_BACKEND_ABI_INVALID",
        ownerKey: "abi",
        rootCauseKey: "call:main:0",
        stableDetail: "abi:public:x18-reserved",
      }),
    ];

    expect(
      sortAArch64BackendDiagnostics(diagnostics).map((diagnostic) => diagnostic.stableDetail),
    ).toEqual(["abi:public:x18-reserved", "frame:slot-overlap:2:3"]);
  });

  test("diagnostic construction rejects unknown codes", () => {
    expect(() =>
      aarch64BackendDiagnostic({
        code: "AARCH64_BACKEND_NOT_REAL",
        stableDetail: "bad",
      } as never),
    ).toThrow("unknown AArch64 backend diagnostic code");
  });

  test("stable ids reject empty keys", () => {
    expect(() => aarch64BackendFrameSlotId("")).toThrow("stable key must be non-empty");
    expect(String(aarch64BackendFrameSlotId("slot.secret"))).toBe("slot.secret");
  });

  test("verification summary normalizes run order", () => {
    const summary = aarch64BackendVerificationSummary({
      runs: [
        { verifierKey: "object", runKey: aarch64BackendVerifierRunKey("2"), status: "passed" },
        {
          verifierKey: "input-contract",
          runKey: aarch64BackendVerifierRunKey("1"),
          status: "passed",
        },
      ],
    });

    expect(summary.runs.map((run) => run.verifierKey)).toEqual(["input-contract", "object"]);
  });
});
