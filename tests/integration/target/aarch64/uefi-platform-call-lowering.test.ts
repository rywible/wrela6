import { describe, expect, test } from "bun:test";
import { emptyOptIrFactSet } from "../../../../src/opt-ir/facts/fact-index";
import { optIrProgramForTest } from "../../../support/opt-ir/cfg-fakes";
import { aarch64SymbolId } from "../../../../src/target/aarch64";
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
});
