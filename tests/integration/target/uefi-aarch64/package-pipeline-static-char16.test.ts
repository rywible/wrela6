import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64TargetDriverSurface,
  runUefiAArch64PackagePipelineToOptIr,
  type UefiAArch64TargetDriverSurface,
} from "../../../../src/target/uefi-aarch64";
import {
  fixtureSpecForFullImageCase,
  packageInputForFullImageFixture,
} from "../../../../src/validation/full-image/fixture-catalog";
import {
  nodeFixtureProjectFilesystem,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline static CHAR16 metadata", () => {
  test("production OptIR adapter deduplicates nested utf16_static metadata", () => {
    const spec = fixtureSpecForFullImageCase({
      scenario: "smoke-console",
      stdlibMode: "toolchain-stdlib",
    });
    const packageInputResult = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = runUefiAArch64PackagePipelineToOptIr({
      packageInput: packageInputResult.value,
      target: targetSurfaceWithUefiImageProfileForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.value.optIr.program.functions
        .entries()
        .filter((function_) => function_.externalRoot?.reason === "imageEntry"),
    ).toHaveLength(1);
    expect(result.value.optIr.staticChar16Strings).toHaveLength(1);
    expect(result.value.optIr.staticChar16Pointers.map((record) => record.valueKey)).toEqual([
      "optir.value:3",
      "optir.value:5",
    ]);
  });

  test("production OptIR adapter scopes utf16_static metadata across loaded source functions", () => {
    const spec = fixtureSpecForFullImageCase({
      scenario: "packet-counter",
      stdlibMode: "toolchain-stdlib",
    });
    const packageInputResult = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = runUefiAArch64PackagePipelineToOptIr({
      packageInput: packageInputResult.value,
      target: targetSurfaceWithUefiImageProfileForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const staticStringStableKeys = result.value.optIr.staticChar16Strings.map(
      (value) => value.stableKey,
    );
    const staticPointerValueKeys = result.value.optIr.staticChar16Pointers.map(
      (record) => record.valueKey,
    );
    expect(new Set(staticStringStableKeys).size).toBe(staticStringStableKeys.length);
    expect(new Set(staticPointerValueKeys).size).toBe(staticPointerValueKeys.length);
    const packetCounterCodeUnits = [
      87, 82, 69, 76, 65, 95, 80, 65, 67, 75, 69, 84, 95, 67, 79, 85, 78, 84, 69, 82, 95, 79, 75,
      13, 10, 0,
    ];
    const packetCounterString = result.value.optIr.staticChar16Strings.find(
      (value) =>
        value.codeUnits.length === packetCounterCodeUnits.length &&
        value.codeUnits.every((unit, index) => unit === packetCounterCodeUnits[index]),
    );
    expect(packetCounterString).toBeDefined();
    if (packetCounterString === undefined) return;
    expect(
      result.value.optIr.staticChar16Pointers.some(
        (record) => record.pointer.stableKey === packetCounterString.stableKey,
      ),
    ).toBe(true);
    expect(
      result.value.optIr.staticChar16Pointers.every((record) =>
        staticStringStableKeys.includes(record.pointer.stableKey),
      ),
    ).toBe(true);
    expect(
      result.value.optIr.operations.filter(
        (operation) =>
          operation.kind === "aggregateConstruct" || operation.kind === "aggregateExtract",
      ),
    ).toEqual([]);
    expect(
      result.value.optIr.operations.filter(
        (operation) =>
          operation.kind === "memoryLoad" &&
          operation.resultTypes.some((type) => type.kind === "zeroSized"),
      ),
    ).toEqual([]);
  });

  test("production OptIR adapter drops unreachable utf16_static metadata", () => {
    const spec = fixtureSpecForFullImageCase({
      scenario: "status-error",
      stdlibMode: "toolchain-stdlib",
    });
    const packageInputResult = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = runUefiAArch64PackagePipelineToOptIr({
      packageInput: packageInputResult.value,
      target: targetSurfaceWithUefiImageProfileForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.optIr.staticChar16Strings).toEqual([]);
    expect(result.value.optIr.staticChar16Pointers).toEqual([]);
  });
});

function targetSurfaceWithUefiImageProfileForTest(): UefiAArch64TargetDriverSurface {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  expect(targetResult.kind).toBe("ok");
  if (targetResult.kind !== "ok") throw new Error("expected authenticated UEFI target");
  return targetResult.value;
}
