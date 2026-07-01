import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { optIrRuntimeCallOperation } from "../../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import { abiLocationKey } from "../../../../src/target/aarch64/lower/materialization-contracts";
import {
  aarch64AbiLocationForRegister,
  classifyAArch64AbiSignature,
  createAArch64Aapcs64AbiTargetSurface,
} from "../../../../src/target/aarch64/lower/abi-lowering";
import { materializeAArch64OptIrOperation } from "../../../../src/target/aarch64/lower/operation-materialization";
import { virtualRegisterForOptIrValue } from "../../../../src/target/aarch64/lower/operation-materialization-helpers";
import type { AArch64MachineInstruction } from "../../../../src/target/aarch64/machine-ir/machine-instruction";
import type {
  AArch64AbiSignatureClassificationInput,
  AArch64AbiTargetSurface,
} from "../../../../src/target/aarch64/target-surface/target-surface";
import { aarch64TargetFingerprint } from "../../../../src/target/aarch64/target-surface/target-surface";
import { optimizedOptIrProgramWithEntryParameterForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 ABI lowering", () => {
  test("public lowering uses target-surface ABI locations for UEFI and OptIR parameters", () => {
    const fixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface({ abi: mappedAbiSurface() }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected fake ABI lowering success");
    const machineFunction = result.machineProgram.functions.entries()[0];
    expect(machineFunction?.parameters).toEqual([
      { valueKey: "uefi.imageHandle", location: { kind: "intReg", index: 4 } },
      { valueKey: "uefi.systemTable", location: { kind: "intReg", index: 5 } },
      { valueKey: "optir.value:10", location: { kind: "intReg", index: 6 } },
    ]);
    expect(machineFunction?.returns).toEqual([{ kind: "intReg", index: 7 }]);
    expect(
      machineFunction?.blocks
        .flatMap((block) => [
          ...block.instructions,
          ...(block.terminator === undefined ? [] : [block.terminator]),
        ])
        .some((instruction) => originStableKey(instruction).includes("abi-return:intReg:7:0")),
    ).toBe(true);
  });

  test("call materialization uses target-surface ABI argument and result locations", () => {
    const u64 = optIrUnsignedIntegerType(64);
    const machineU64 = { kind: "integer" as const, width: 64 as const };
    const operation = optIrRuntimeCallOperation({
      operationId: optIrOperationId(22),
      callId: optIrCallId(22),
      target: { kind: "runtime", runtimeKey: "clock" },
      argumentIds: [optIrValueId(1), optIrValueId(2)],
      resultIds: [optIrValueId(3)],
      resultTypes: [u64],
      originId: optIrOriginId(22),
    });
    const registers = new Map([
      [
        optIrValueId(1),
        virtualRegisterForOptIrValue({ valueId: optIrValueId(1), type: machineU64 }),
      ],
      [
        optIrValueId(2),
        virtualRegisterForOptIrValue({ valueId: optIrValueId(2), type: machineU64 }),
      ],
      [
        optIrValueId(3),
        virtualRegisterForOptIrValue({ valueId: optIrValueId(3), type: machineU64 }),
      ],
    ]);

    const result = materializeAArch64OptIrOperation({
      operation,
      valueRegisters: registers,
      context: { abi: mappedAbiSurface() },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected call materialization success");
    const originKeys = result.instructions.map(originStableKey);
    expect(originKeys).toContain("opt-ir:22:call-arg:intReg:5:0:0");
    expect(originKeys).toContain("opt-ir:22:call-arg:intReg:6:1:1");
    expect(originKeys).toContain("opt-ir:22:call-result:intReg:7:0:3");
  });

  test("stale ABI classifier authority is rejected", () => {
    const base = createAArch64Aapcs64AbiTargetSurface();
    const staleAbi: AArch64AbiTargetSurface = {
      ...base,
      classifySignature(input) {
        return {
          ...base.classifySignature(input),
          authorityFingerprint: aarch64TargetFingerprint("aarch64-target:abi:stale"),
        };
      },
    };

    const result = classifyAArch64AbiSignature({
      abi: staleAbi,
      role: "parameters",
      registerClasses: ["gpr64"],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected stale ABI authority rejection");
    expect(result.stableDetail).toContain("abi-classification:authority-mismatch:parameters");
  });

  test("malformed ABI classifier locations are rejected before public binding construction", () => {
    const fixture = optimizedOptIrProgramWithEntryParameterForAArch64Test();
    const base = createAArch64Aapcs64AbiTargetSurface();
    const malformedAbi: AArch64AbiTargetSurface = {
      ...base,
      classifySignature(input) {
        return {
          authorityFingerprint: base.abiFingerprint,
          convention: input.convention ?? "aapcs64",
          locations: input.values.map(() => ({ kind: "intReg" as const, index: -1 })),
          stackArgumentAreaSizeBytes: 0,
        };
      },
    };

    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface({ abi: malformedAbi }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("expected malformed ABI classification to be rejected");
    }
    expect(result.diagnostics[0]?.stableDetail).toContain(
      "abi-classification:invalid-location:parameters:0:int-reg-out-of-range:x-1",
    );
  });

  test("exported ABI register helper uses class-sized stack overflow slots", () => {
    expect(aarch64AbiLocationForRegister("vector128", 8)).toEqual({
      kind: "stackArg",
      ordinal: 0,
      offsetBytes: 0,
      size: 16,
      alignment: 16,
    });
    expect(aarch64AbiLocationForRegister("vector128", 9)).toEqual({
      kind: "stackArg",
      ordinal: 1,
      offsetBytes: 16,
      size: 16,
      alignment: 16,
    });
    expect(aarch64AbiLocationForRegister("gpr64", 9)).toEqual({
      kind: "stackArg",
      ordinal: 1,
      offsetBytes: 8,
      size: 8,
      alignment: 8,
    });
  });

  test("ABI location stable keys distinguish stack offsets", () => {
    expect(
      abiLocationKey({
        kind: "stackArg",
        ordinal: 1,
        offsetBytes: 8,
        size: 8,
        alignment: 8,
      }),
    ).toBe("stackArg:1:8:8:8");
    expect(
      abiLocationKey({
        kind: "stackArg",
        ordinal: 1,
        offsetBytes: 16,
        size: 8,
        alignment: 8,
      }),
    ).toBe("stackArg:1:16:8:8");
  });
});

function mappedAbiSurface(): AArch64AbiTargetSurface {
  const base = createAArch64Aapcs64AbiTargetSurface();
  return {
    ...base,
    classifySignature(input) {
      return {
        authorityFingerprint: base.abiFingerprint,
        convention: input.convention ?? "aapcs64",
        locations: input.values.map((_value, index) => locationForValue(input, index)),
        stackArgumentAreaSizeBytes: 0,
      };
    },
  };
}

function locationForValue(input: AArch64AbiSignatureClassificationInput, index: number) {
  const valueKey = input.values[index]?.valueKey;
  if (valueKey === "uefi.imageHandle") return { kind: "intReg" as const, index: 4 };
  if (valueKey === "uefi.systemTable") return { kind: "intReg" as const, index: 5 };
  if (valueKey === "optir.value:10") return { kind: "intReg" as const, index: 6 };
  if (valueKey === "optir.value:1") return { kind: "intReg" as const, index: 5 };
  if (valueKey === "optir.value:2") return { kind: "intReg" as const, index: 6 };
  if (valueKey === "optir.value:3" || valueKey === "optir.value:12") {
    return { kind: "intReg" as const, index: 7 };
  }
  return { kind: "intReg" as const, index };
}

function originStableKey(instruction: AArch64MachineInstruction): string {
  return instruction.origin.kind === "syntheticLowering" ? instruction.origin.stableKey : "";
}
