import { describe, expect, test } from "bun:test";
import {
  aarch64FrameObjectId,
  aarch64MachineBlockId,
  aarch64MachineFunctionId,
  aarch64MachineProgramId,
  aarch64RelocationReferenceId,
  aarch64SymbolId,
} from "../../../../src/target/aarch64/machine-ir/ids";
import { aarch64AbiLocation } from "../../../../src/target/aarch64/machine-ir/abi-location";
import { aarch64FrameObject } from "../../../../src/target/aarch64/machine-ir/frame-object";
import { aarch64MachineBlock } from "../../../../src/target/aarch64/machine-ir/machine-block";
import { aarch64MachineFunction } from "../../../../src/target/aarch64/machine-ir/machine-function";
import { aarch64MachineProgram } from "../../../../src/target/aarch64/machine-ir/machine-program";
import { emptyAArch64ProvenanceMap } from "../../../../src/target/aarch64/machine-ir/provenance";
import { aarch64RelocationReference } from "../../../../src/target/aarch64/machine-ir/relocation-reference";
import { aarch64SymbolReference } from "../../../../src/target/aarch64/machine-ir/symbol-reference";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
} from "../../../../src/target/aarch64/machine-ir/fact-set";
import { aarch64MachineFactId } from "../../../../src/target/aarch64/machine-ir/ids";

describe("AArch64 machine IR program model", () => {
  test("machine function tables are deterministic and frozen", () => {
    const first = aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(2),
      symbol: aarch64SymbolId("later"),
      virtualRegisters: [],
      parameters: [],
      returns: [],
      frameObjects: [],
      blocks: [aarch64MachineBlock({ blockId: aarch64MachineBlockId(2), instructions: [] })],
    });
    const second = aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(1),
      symbol: aarch64SymbolId("earlier"),
      virtualRegisters: [],
      parameters: [],
      returns: [],
      frameObjects: [],
      blocks: [aarch64MachineBlock({ blockId: aarch64MachineBlockId(1), instructions: [] })],
    });

    const program = aarch64MachineProgram({
      programId: aarch64MachineProgramId(0),
      functions: [first, second],
      globalSymbols: [],
      entrySymbol: aarch64SymbolId("wrela.image.boot"),
      targetFingerprint: "target:fingerprint",
      consultedSubsurfaceFingerprints: [],
      provenance: emptyAArch64ProvenanceMap(),
    });

    expect(program.functions.entries().map((func) => Number(func.functionId))).toEqual([1, 2]);
    expect(Object.isFrozen(program.functions.entries()[0])).toBe(true);
  });

  test("machine function deep-freezes call-clobber records", () => {
    const callClobber = {
      callKey: "call:1",
      registers: { convention: "aapcs64" as const, gpr: ["x0"], vector: ["v0"] },
      memoryEffects: ["memory"],
    };

    const machineFunction = aarch64MachineFunction({
      functionId: aarch64MachineFunctionId(1),
      symbol: aarch64SymbolId("clobber.freeze"),
      virtualRegisters: [],
      parameters: [],
      returns: [],
      frameObjects: [],
      blocks: [aarch64MachineBlock({ blockId: aarch64MachineBlockId(1), instructions: [] })],
      callClobbers: [callClobber],
    });

    expect(Object.isFrozen(machineFunction.callClobbers[0])).toBe(true);
    expect(Object.isFrozen(machineFunction.callClobbers[0]?.registers)).toBe(true);
    expect(Object.isFrozen(machineFunction.callClobbers[0]?.registers.gpr)).toBe(true);
    expect(Object.isFrozen(machineFunction.callClobbers[0]?.registers.vector)).toBe(true);
    expect(Object.isFrozen(machineFunction.callClobbers[0]?.memoryEffects)).toBe(true);

    callClobber.registers.gpr.push("x1");
    callClobber.registers.vector.push("v1");
    callClobber.memoryEffects.push("io");

    expect(machineFunction.callClobbers[0]?.registers.gpr).toEqual(["x0"]);
    expect(machineFunction.callClobbers[0]?.registers.vector).toEqual(["v0"]);
    expect(machineFunction.callClobbers[0]?.memoryEffects).toEqual(["memory"]);
  });

  test("frame ABI symbol and relocation records remain symbolic", () => {
    const frameObject = aarch64FrameObject({
      frameObjectId: aarch64FrameObjectId(1),
      kind: "regionBacked",
      size: 32,
      alignment: 16,
      regionKey: "packet.payload",
      mutability: "mutable",
    });
    const location = aarch64AbiLocation({ kind: "intReg", index: 0 });
    const symbol = aarch64SymbolReference({
      symbol: aarch64SymbolId("helper.memcpy"),
      visibility: "external",
    });
    const relocation = aarch64RelocationReference({
      relocationId: aarch64RelocationReferenceId(2),
      kind: "CALL26",
      symbol: aarch64SymbolId("helper.memcpy"),
      addend: 0n,
      targetFingerprint: "reloc:fixture",
    });

    expect(frameObject.kind).toBe("regionBacked");
    expect(location).toEqual({ kind: "intReg", index: 0 });
    expect(symbol.symbol).toBe(aarch64SymbolId("helper.memcpy"));
    expect(relocation.kind).toBe("CALL26");
  });

  test("preserved machine facts use code-unit stable-key ordering", () => {
    const facts = aarch64PreservedFactSet({
      records: [
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(1),
          subject: { kind: "symbol", symbol: "a" },
        }),
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(2),
          subject: { kind: "symbol", symbol: "B" },
        }),
      ],
    });

    expect(facts.records.map((record) => record.subject)).toEqual([
      { kind: "symbol", symbol: "B" },
      { kind: "symbol", symbol: "a" },
    ]);
  });

  test("preserved machine facts reject stable-key conflicts with different payloads", () => {
    const first = aarch64MachineFactRecord({
      factId: aarch64MachineFactId(1),
      extensionKey: "security.no-spill",
      subject: { kind: "virtualRegister", vreg: 7 },
      payload: { label: "a" },
      targetDeclarationKeys: ["target.security"],
    });
    const second = aarch64MachineFactRecord({
      factId: aarch64MachineFactId(2),
      extensionKey: "security.wipe-on-spill",
      subject: { kind: "virtualRegister", vreg: 7 },
      payload: { label: "b" },
      targetDeclarationKeys: ["target.security"],
    });
    const forgedConflict = { ...second, stableKey: first.stableKey };

    expect(() => aarch64PreservedFactSet({ records: [first, forgedConflict] })).toThrow(
      "AArch64 preserved fact stable-key conflict",
    );
  });
});
