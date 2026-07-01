import { describe, expect, test } from "bun:test";

import { createAArch64Rpi5PhysicalRegisterModel } from "../../../../../src/target/aarch64/backend/api/physical-register-model";

describe("AArch64 physical register model", () => {
  const model = createAArch64Rpi5PhysicalRegisterModel();

  test("SP and ZR share encoding number but are not storage aliases", () => {
    expect(model.encodingNumberOf("sp")).toBe(31);
    expect(model.encodingNumberOf("xzr")).toBe(31);
    expect(model.canAllocate("sp")).toBe(false);
    expect(model.canAllocate("xzr")).toBe(false);
    expect(model.aliasSetOf("sp")).not.toBe(model.aliasSetOf("xzr"));
  });

  test("rpi5 model reserves x18 for allocation and private convention queries", () => {
    expect(model.canAllocate("x18")).toBe(false);
    expect(model.privateConventionCandidateGprs).not.toContain("x18");
    expect(model.publicCallerSavedGprs).not.toContain("x18");
  });

  test("public caller-saved and callee-saved GPR sets are disjoint", () => {
    const calleeSaved = new Set(model.publicCalleeSavedGprs);
    expect(model.publicCallerSavedGprs.filter((register) => calleeSaved.has(register))).toEqual([]);
    expect(model.publicCallerSavedGprs).toContain("x0");
    expect(model.publicCallerSavedGprs).toContain("x17");
    expect(model.publicCallerSavedGprs).toContain("x30");
    expect(model.publicCallerSavedGprs).not.toContain("x19");
    expect(model.publicCallerSavedGprs).not.toContain("x28");
    expect(model.publicCalleeSavedGprs).toContain("x19");
    expect(model.publicCalleeSavedGprs).toContain("x28");
  });

  test("aliases x and w views while preserving deterministic register ordering", () => {
    expect(model.aliasSetOf("x0")).toBe(model.aliasSetOf("w0"));
    expect(model.encodingNumberOf("w30")).toBe(30);
    expect(model.registers.map((register) => register.stableKey)).toEqual(
      model.registers.map((register) => register.stableKey).sort(),
    );
  });

  test("aliases SIMD lane views within the same vector storage", () => {
    expect(model.aliasSetOf("v8")).toBe(model.aliasSetOf("d8"));
    expect(model.aliasSetOf("q15")).toBe(model.aliasSetOf("b15"));
  });

  test("exposes IP0 and IP1 as veneer scratch registers", () => {
    expect(model.veneerScratchGprs).toEqual(["x16", "x17"]);
  });

  test("permits SP and ZR only in their operand slots", () => {
    expect(model.permitsOperand({ registerKey: "sp", context: "stack-access" })).toBe(true);
    expect(model.permitsOperand({ registerKey: "sp", context: "general" })).toBe(false);
    expect(
      model.permitsOperand({
        registerKey: "xzr",
        context: "general",
        operationKind: "zero-register",
      }),
    ).toBe(true);
    expect(model.permitsOperand({ registerKey: "xzr", context: "stack-access" })).toBe(false);
  });
});
