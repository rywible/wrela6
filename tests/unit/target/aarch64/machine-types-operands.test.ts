import { describe, expect, test } from "bun:test";
import { optIrValueId } from "../../../../src/opt-ir/ids";
import { aarch64VirtualRegisterId } from "../../../../src/target/aarch64/machine-ir/ids";
import {
  aarch64FloatMachineType,
  aarch64IntMachineType,
  aarch64PointerMachineType,
  aarch64TokenMachineType,
  aarch64VectorMachineType,
} from "../../../../src/target/aarch64/machine-ir/machine-types";
import { aarch64Resource } from "../../../../src/target/aarch64/machine-ir/resources";
import {
  aarch64InstructionOperand,
  implicitDefResource,
  useVreg,
} from "../../../../src/target/aarch64/machine-ir/operands";
import { aarch64VirtualRegister } from "../../../../src/target/aarch64/machine-ir/virtual-register";

describe("AArch64 machine types resources virtual registers and operands", () => {
  test("models required register classes machine types and resources", () => {
    expect(aarch64VectorMachineType({ laneType: aarch64IntMachineType(8), laneCount: 16 })).toEqual(
      {
        kind: "vector",
        laneType: { kind: "integer", width: 8 },
        laneCount: 16,
      },
    );
    expect(aarch64FloatMachineType(64)).toEqual({ kind: "float", width: 64 });
    expect(aarch64Resource("NZCV")).toEqual({ kind: "NZCV" });
    expect(aarch64Resource({ kind: "platform", key: "uefi.systemTable" })).toEqual({
      kind: "platform",
      key: "uefi.systemTable",
    });
    expect(() =>
      aarch64VectorMachineType({ laneType: aarch64IntMachineType(8), laneCount: 0 }),
    ).toThrow(RangeError);
  });

  test("virtual registers carry class type security labels and origin", () => {
    const packetPointer = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(1),
      registerClass: "gpr64",
      type: aarch64PointerMachineType("packet-source"),
      securityLabels: [{ kind: "secret", key: "packet-key" }],
      origin: { kind: "optIrValue", valueId: optIrValueId(7) },
    });

    expect(packetPointer.registerClass).toBe("gpr64");
    expect(packetPointer.origin).toEqual({ kind: "optIrValue", valueId: optIrValueId(7) });
    expect(Object.isFrozen(packetPointer.securityLabels)).toBe(true);
  });

  test("NZCV is modeled as an implicit resource operand", () => {
    const operand = aarch64InstructionOperand({
      role: "implicitDef",
      operand: { kind: "resource", resource: { kind: "NZCV" } },
      type: aarch64TokenMachineType("nzcv"),
    });

    expect(operand).toMatchObject({
      role: "implicitDef",
      operand: { kind: "resource", resource: { kind: "NZCV" } },
      type: { kind: "token", token: "nzcv" },
    });
    expect(implicitDefResource({ kind: "NZCV" })).toEqual(operand);
  });

  test("operand builders reject mismatched register class and machine type combinations", () => {
    const pointerRegister = aarch64VirtualRegister({
      vreg: aarch64VirtualRegisterId(2),
      registerClass: "gpr64",
      type: aarch64PointerMachineType("packet-source"),
    });

    expect(useVreg(pointerRegister, aarch64PointerMachineType("packet-source")).role).toBe("use");
    expect(() =>
      aarch64VirtualRegister({
        vreg: aarch64VirtualRegisterId(3),
        registerClass: "gpr32",
        type: aarch64PointerMachineType("packet-source"),
      }),
    ).toThrow(RangeError);
  });
});
