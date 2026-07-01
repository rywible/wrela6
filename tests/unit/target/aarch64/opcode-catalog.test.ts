import { describe, expect, test } from "bun:test";
import {
  aarch64OpcodeFormById,
  aarch64OpcodeFormId,
} from "../../../../src/target/aarch64/machine-ir/opcode-catalog";

describe("AArch64 opcode catalog", () => {
  test("cmp shifted register form declares NZCV as an implicit def", () => {
    const form = aarch64OpcodeFormById(aarch64OpcodeFormId("cmp-shifted-register"));

    expect(form.implicitResources).toEqual([{ role: "implicitDef", resource: { kind: "NZCV" } }]);
    expect(form.requiredFeatures).toEqual(["BASE_A64"]);
  });

  test("call forms declare clobbered singleton resources", () => {
    for (const formId of ["bl", "blr"] as const) {
      const form = aarch64OpcodeFormById(aarch64OpcodeFormId(formId));

      expect(form.implicitResources).toEqual([
        { role: "implicitDef", resource: { kind: "NZCV" } },
        { role: "implicitDef", resource: { kind: "FPCR" } },
        { role: "implicitDef", resource: { kind: "FPSR" } },
        { role: "implicitDef", resource: { kind: "vectorState" } },
      ]);
    }
  });

  test("production catalog contains required baseline forms", () => {
    const requiredForms = [
      "movz",
      "movk",
      "ldp-signed-offset",
      "stp-signed-offset",
      "rev16",
      "dmb",
      "ldar",
      "stlr",
      "ldadd",
      "ldadda",
      "ldaddl",
      "ldaddal",
    ] as const;

    expect(
      requiredForms.map((formId) => String(aarch64OpcodeFormById(aarch64OpcodeFormId(formId)).id)),
    ).toEqual([...requiredForms]);
  });

  test("conditional data-processing forms declare explicit condition immediates", () => {
    expect(aarch64OpcodeFormById(aarch64OpcodeFormId("b-cond")).operandSchema.at(-1)).toMatchObject(
      {
        operandKind: "immediate",
        immediateKind: "condition",
      },
    );
    expect(aarch64OpcodeFormById(aarch64OpcodeFormId("cset")).operandSchema.at(-1)).toMatchObject({
      operandKind: "immediate",
      immediateKind: "condition",
    });
    expect(aarch64OpcodeFormById(aarch64OpcodeFormId("csel")).operandSchema.at(-1)).toMatchObject({
      operandKind: "immediate",
      immediateKind: "condition",
    });
    expect(aarch64OpcodeFormById(aarch64OpcodeFormId("ccmp")).operandSchema).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operandKind: "immediate", immediateKind: "nzcvImmediate" }),
        expect.objectContaining({ operandKind: "immediate", immediateKind: "condition" }),
      ]),
    );
  });
});
