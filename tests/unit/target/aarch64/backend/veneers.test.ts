import { describe, expect, test } from "bun:test";

import { planAArch64Veneers } from "../../../../../src/target/aarch64/backend/object/veneers";

describe("AArch64 veneer planning", () => {
  test("records backend-owned veneer requests with declared scratch registers", () => {
    const result = planAArch64Veneers({
      sites: [
        {
          stableKey: "call:main:far",
          sectionKey: ".text",
          targetKey: "far",
          relocationFamily: "branch26",
          policy: "backend-owned",
          predeclaredScratchGprs: ["x16", "x17"],
          requestedScratchGprs: ["x16"],
          rangeProof: "out-of-range",
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected veneer plan");
    expect(result.value.map((veneer) => veneer.ownership)).toEqual(["backend-owned"]);
  });

  test("rejects scratch register not predeclared before allocation", () => {
    const result = planAArch64Veneers({
      sites: [
        {
          stableKey: "call:main:far",
          sectionKey: ".text",
          targetKey: "far",
          relocationFamily: "branch26",
          policy: "backend-owned",
          predeclaredScratchGprs: [],
          requestedScratchGprs: ["x16"],
          rangeProof: "out-of-range",
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer scratch error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "veneer:undeclared-scratch:call:main:far:x16",
    ]);
  });
});
