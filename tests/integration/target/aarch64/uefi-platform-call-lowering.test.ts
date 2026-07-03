import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../../src/mono/ids";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import {
  optIrConstantId,
  optIrCallId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { optIrIntegerConstant } from "../../../../src/opt-ir/constants";
import {
  optIrConstantOperation,
  optIrPlatformCallOperation,
  optIrSourceCallOperation,
} from "../../../../src/opt-ir/operations";
import { optIrBlockForTest, optIrFunctionForTest } from "../../../support/opt-ir/cfg-fakes";
import { optIrFunctionTable, optIrRegionTable } from "../../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import { optIrProgramForTest } from "../../../support/opt-ir/cfg-fakes";
import { aarch64SymbolId } from "../../../../src/target/aarch64";
import { materializeAArch64OptIrOperation } from "../../../../src/target/aarch64/lower/operation-materialization";
import { emptyAArch64PreservedFactSet } from "../../../../src/target/aarch64/machine-ir/fact-set";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import { createAArch64LoweringState } from "../../../../src/target/aarch64/lower/lowering-context";
import { lowerAArch64Call } from "../../../../src/target/aarch64/lower/call-lowering";
import {
  lowerAArch64UefiImageContext,
  lowerAArch64UefiImageStageState,
} from "../../../../src/target/aarch64/lower/uefi-image-lowering";
import { optimizedOptIrProgramWithOneFunctionForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  materializeUefiAArch64StaticChar16String,
  uefiAArch64FirmwarePlatformCallContext,
  uefiAArch64StaticChar16StringPointer,
} from "../../../../src/target/uefi-aarch64";

describe("AArch64 UEFI platform call lowering", () => {
  test("UEFI image context binds firmware entry arguments in ABI order and sorts table keys", () => {
    const result = lowerAArch64UefiImageContext({
      imageProfile: {
        entryShimSymbol: "__wrela_uefi_entry",
        bootFunctionSymbol: "Boot.main",
        imageHandleLocation: { kind: "intReg", index: 0 },
        systemTableLocation: { kind: "intReg", index: 1 },
        firmwareTableKeys: ["system-table", "boot-services"],
      },
    });

    expect(result).toEqual({
      kind: "ok",
      entryShimSymbol: aarch64SymbolId("__wrela_uefi_entry"),
      entrySymbol: aarch64SymbolId("Boot.main"),
      contextBindings: [
        { source: "uefi.imageHandle", location: { kind: "intReg", index: 0 } },
        { source: "uefi.systemTable", location: { kind: "intReg", index: 1 } },
      ],
      firmwareTableKeys: ["boot-services", "system-table"],
    });
  });

  test("terminal platform calls lower as indirect branch-and-link followed by trap", () => {
    const result = lowerAArch64Call({ targetKind: "platform", terminal: true });

    expect(result).toEqual({
      kind: "ok",
      instructions: ["blr", "trap"],
      relocations: [],
      terminal: true,
    });
  });

  test("UEFI stage-state helper does not swallow missing machine-program errors", () => {
    const state = createAArch64LoweringState({
      program: optIrProgramForTest(),
      operations: [],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: {},
      preservedFacts: emptyAArch64PreservedFactSet(),
    });

    expect(() => lowerAArch64UefiImageStageState(state)).toThrow(
      "uefi-image:missing-machine-program",
    );
  });

  test("public pipeline installs UEFI context bindings on the boot function", () => {
    const fixture = optimizedOptIrProgramWithOneFunctionForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected UEFI lowering success");
    const bootFunction = result.machineProgram.functions
      .entries()
      .find((machineFunction) => String(machineFunction.symbol) === "wrela.image.boot");
    expect(bootFunction?.parameters.slice(0, 2)).toEqual([
      { valueKey: "uefi.imageHandle", location: { kind: "intReg", index: 0 } },
      { valueKey: "uefi.systemTable", location: { kind: "intReg", index: 1 } },
    ]);
    expect(result.machineProgram.globalSymbols.map((symbol) => String(symbol.symbol))).toEqual([
      "wrela.image.boot",
      "wrela.image.entry_shim",
    ]);
  });

  test("public pipeline returns a deterministic unit-success status code from no-value image entries", () => {
    const originId = optIrOriginId(91);
    const block = optIrBlockForTest({
      parameters: [],
      operations: [],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [],
        originId,
      },
      originId,
    });
    const sourceFunction = optIrFunctionForTest({
      blocks: [block],
      entryBlock: block.blockId,
      externalRoot: { reason: "imageEntry", originId },
      originId,
    });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([sourceFunction]),
      regions: optIrRegionTable([]),
    });
    const result = lowerOptIrToAArch64({
      program,
      operations: [],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected UEFI lowering success");
    const bootFunction = result.machineProgram.functions
      .entries()
      .find((machineFunction) => String(machineFunction.symbol) === "wrela.image.boot");
    const returnSetup = bootFunction?.blocks
      .flatMap((block) => block.instructions)
      .find(
        (instruction) =>
          instruction.origin.kind === "syntheticLowering" &&
          instruction.origin.stableKey.includes("abi-return:intReg:0:unit-success"),
      );

    expect(String(returnSetup?.opcode)).toBe("movz");
    expect(bootFunction?.blocks[0]?.terminator?.operands).toHaveLength(1);
  });

  test("firmware context lowers console output platform calls without unresolved platform symbol", () => {
    const operation = optIrPlatformCallOperation({
      operationId: optIrOperationId(1),
      callId: optIrCallId(1),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(100)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId: optIrOriginId(1),
    });

    const result = materializeAArch64OptIrOperation({
      operation,
      valueRegisters: new Map(),
      context: {
        firmware: {
          platformCalls: uefiAArch64FirmwarePlatformCallContext({
            firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
            platformLowerings: canonicalUefiAArch64PlatformLowerings(),
          }),
          staticChar16Pointers: staticChar16PointersForTest(["optir.value:1"]),
          contextRegisters: new Map(),
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.instructions.map((instruction) => String(instruction.opcode))).toContain("blr");
      expect(
        result.relocationReferences.map((relocation) => String(relocation.symbol)),
      ).not.toContain("platform.uefi.console.outputString");
    }
  });

  test("public pipeline defines UEFI firmware context registers for console output", () => {
    const originId = optIrOriginId(90);
    const pointer = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(1),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 0x1000n,
      }),
      originId,
    });
    const call = optIrPlatformCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(2),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(100)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId,
    });
    const block = optIrBlockForTest({
      parameters: [],
      operations: [pointer.operationId, call.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [optIrValueId(100)],
        originId,
      },
      originId,
    });
    const sourceFunction = optIrFunctionForTest({
      blocks: [block],
      entryBlock: block.blockId,
      externalRoot: { reason: "imageEntry", originId },
      originId,
    });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([sourceFunction]),
      regions: optIrRegionTable([]),
    });

    const result = lowerOptIrToAArch64({
      program,
      operations: [pointer, call],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: {
        firmware: {
          platformCalls: uefiAArch64FirmwarePlatformCallContext({
            firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
            platformLowerings: canonicalUefiAArch64PlatformLowerings(),
          }),
          staticChar16Pointers: staticChar16PointersForTest(["optir.value:1"]),
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected firmware call lowering success");
    const functionBody = result.machineProgram.functions.entries()[0];
    expect(functionBody?.parameters.map((parameter) => parameter.valueKey)).toEqual([
      "uefi.imageHandle",
      "uefi.systemTable",
    ]);
    expect(
      functionBody?.virtualRegisters.some(
        (register) =>
          register.origin?.kind === "synthetic" && register.origin.stableKey === "uefi.systemTable",
      ),
    ).toBe(true);
  });

  test("public pipeline reuses one UEFI system table register across multiple firmware calls", () => {
    const originId = optIrOriginId(92);
    const firstPointer = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(1),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 0x1000n,
      }),
      originId,
    });
    const firstCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(2),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(100)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId,
    });
    const secondPointer = optIrConstantOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(2),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(2),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 0x2000n,
      }),
      originId,
    });
    const secondCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(4),
      callId: optIrCallId(4),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(2)],
      resultIds: [optIrValueId(101)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId,
    });
    const block = optIrBlockForTest({
      parameters: [],
      operations: [
        firstPointer.operationId,
        firstCall.operationId,
        secondPointer.operationId,
        secondCall.operationId,
      ],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [optIrValueId(101)],
        originId,
      },
      originId,
    });
    const sourceFunction = optIrFunctionForTest({
      blocks: [block],
      entryBlock: block.blockId,
      externalRoot: { reason: "imageEntry", originId },
      originId,
    });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([sourceFunction]),
      regions: optIrRegionTable([]),
    });

    const result = lowerOptIrToAArch64({
      program,
      operations: [firstPointer, firstCall, secondPointer, secondCall],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: {
        firmware: {
          platformCalls: uefiAArch64FirmwarePlatformCallContext({
            firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
            platformLowerings: canonicalUefiAArch64PlatformLowerings(),
          }),
          staticChar16Pointers: staticChar16PointersForTest(["optir.value:1", "optir.value:2"]),
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected firmware call lowering success");
    const functionBody = result.machineProgram.functions.entries()[0];
    const systemTableRegisters =
      functionBody?.virtualRegisters.filter(
        (register) =>
          register.origin?.kind === "synthetic" && register.origin.stableKey === "uefi.systemTable",
      ) ?? [];
    expect(systemTableRegisters).toHaveLength(1);
  });

  test("public pipeline forwards UEFI context through source calls to nested firmware calls", () => {
    const originId = optIrOriginId(94);
    const helperInstance = monoInstanceId("nested-console-helper");
    const bootCall = optIrSourceCallOperation({
      operationId: optIrOperationId(1),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: helperInstance },
      argumentIds: [],
      resultIds: [optIrValueId(100)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId,
    });
    const bootBlock = optIrBlockForTest({
      parameters: [],
      operations: [bootCall.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(99),
        values: [optIrValueId(100)],
        originId,
      },
      originId,
    });
    const bootFunction = optIrFunctionForTest({
      functionId: optIrFunctionId(10),
      blocks: [bootBlock],
      entryBlock: bootBlock.blockId,
      externalRoot: { reason: "imageEntry", originId },
      originId,
    });
    const pointer = optIrConstantOperation({
      operationId: optIrOperationId(3),
      resultId: optIrValueId(2),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(3),
        type: optIrUnsignedIntegerType(64),
        normalizedValue: 0n,
      }),
      originId,
    });
    const nestedCall = optIrPlatformCallOperation({
      operationId: optIrOperationId(4),
      callId: optIrCallId(4),
      target: { kind: "platform", platformKey: "uefi.console.outputString" },
      argumentIds: [optIrValueId(2)],
      resultIds: [optIrValueId(200)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId,
    });
    const helperBlock = optIrBlockForTest({
      parameters: [],
      operations: [pointer.operationId, nestedCall.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(100),
        values: [optIrValueId(200)],
        originId,
      },
      originId,
    });
    const helperFunction = optIrFunctionForTest({
      functionId: optIrFunctionId(11),
      monoInstanceId: helperInstance,
      blocks: [helperBlock],
      entryBlock: helperBlock.blockId,
      originId,
    });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([bootFunction, helperFunction]),
      regions: optIrRegionTable([]),
    });

    const result = lowerOptIrToAArch64({
      program,
      operations: [bootCall, pointer, nestedCall],
      facts: emptyOptIrFactSet(),
      target: fakeAArch64TargetSurface(),
      options: {
        firmware: {
          platformCalls: uefiAArch64FirmwarePlatformCallContext({
            firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
            platformLowerings: canonicalUefiAArch64PlatformLowerings(),
          }),
          staticChar16Pointers: staticChar16PointersForTest(["optir.value:2"]),
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected nested firmware call lowering success");
    const boot = result.machineProgram.functions.entries()[0];
    const helper = result.machineProgram.functions.entries()[1];
    const sourceCall = boot?.blocks
      .flatMap((block) => block.instructions)
      .find((instruction) => String(instruction.opcode) === "bl");
    expect(sourceCall?.operands.filter((operand) => operand.operand.kind === "vreg")).toHaveLength(
      2,
    );
    expect(helper?.parameters.map((parameter) => parameter.valueKey)).toEqual([
      "uefi.imageHandle",
      "uefi.systemTable",
    ]);
    expect(String(helper?.symbol)).toBe("optir.source.nested-console-helper");
  });

  test("firmware context lowers exit boot services through the authenticated runtime helper", () => {
    const operation = optIrPlatformCallOperation({
      operationId: optIrOperationId(1),
      callId: optIrCallId(1),
      target: { kind: "platform", platformKey: "uefi.boot.exitBootServices" },
      argumentIds: [optIrValueId(1)],
      resultIds: [optIrValueId(100)],
      resultTypes: [optIrUnsignedIntegerType(64)],
      originId: optIrOriginId(1),
    });

    const result = materializeAArch64OptIrOperation({
      operation,
      valueRegisters: new Map(),
      context: {
        firmware: {
          platformCalls: uefiAArch64FirmwarePlatformCallContext({
            firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
            platformLowerings: canonicalUefiAArch64PlatformLowerings(),
          }),
          contextRegisters: new Map(),
        },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.instructions.map((instruction) => String(instruction.opcode))).toContain("bl");
      expect(result.relocationReferences.map((relocation) => String(relocation.symbol))).toContain(
        "__wrela_uefi_exit_boot_services_with_fresh_map",
      );
    }
  });
});

function staticChar16PointersForTest(keys: readonly string[]) {
  return new Map(
    keys.map((key, index) => {
      const string = materializeUefiAArch64StaticChar16String({
        stableKey: `integration-console-marker-${index}`,
        value: `OK${index}\r\n`,
      });
      expect(string.kind).toBe("ok");
      if (string.kind !== "ok") throw new Error("expected static firmware string");
      return [key, uefiAArch64StaticChar16StringPointer(string.value)] as const;
    }),
  );
}
