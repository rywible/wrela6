import { describe, expect, test } from "bun:test";
import { createAArch64FactQuery } from "../../../../src/target/aarch64/facts/aarch64-fact-adapter";
import {
  aarch64AddForTest,
  aarch64MachineFunctionForTest,
  aarch64MovzForTest,
} from "../../../support/target/aarch64/machine-ir/builders";
import {
  releaseDeviceOrderingForTest,
  secretSecurityForTest,
} from "../../../support/target/aarch64/machine-ir/metadata-builders";
import {
  aarch64PacketFactSetForTest,
  aarch64SecretValueFactSetForTest,
} from "../../../support/target/aarch64/facts/opt-ir-facts";

describe("shared AArch64 test fixture foundation", () => {
  test("machine IR builders create valid deterministic records", () => {
    const machineFunction = aarch64MachineFunctionForTest({
      instructions: [aarch64MovzForTest({ value: 7n }), aarch64AddForTest({ instructionId: 2 })],
    });

    expect(
      machineFunction.blocks[0]?.instructions.map((instruction) => String(instruction.opcode)),
    ).toEqual(["movz", "add-shifted-register"]);
  });

  test("metadata builders expose ordering and security records", () => {
    expect(releaseDeviceOrderingForTest().order).toBe("release");
    expect(secretSecurityForTest().spillPolicy).toBe("noSpill");
  });

  test("fact fixtures are queryable through the AArch64 adapter", () => {
    expect(
      createAArch64FactQuery(aarch64PacketFactSetForTest()).provesDereferenceableFootprint({
        region: 1,
        start: 0n,
        endExclusive: 16n,
      }),
    ).toMatchObject({ kind: "yes" });
    expect(
      createAArch64FactQuery(aarch64SecretValueFactSetForTest()).securityForValue(5 as never),
    ).toMatchObject({
      kind: "yes",
      secret: true,
    });
  });
});
