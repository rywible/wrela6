import { describe, expect, test } from "bun:test";
import { coreTypeId, targetId, functionId, itemId } from "../../../../src/semantic/ids";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { SourceSpan } from "../../../../src/shared/source-span";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrCallId,
  optIrConstantId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import {
  optIrConstAddrOperation,
  optIrSourceCallOperation,
} from "../../../../src/opt-ir/operations";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
} from "../../../../src/opt-ir/program";
import { optIrBlockParameter } from "../../../../src/opt-ir/values";
import { optIrDataConstantFingerprint } from "../../../../src/opt-ir/constants";
import { optIrAddressType } from "../../../../src/opt-ir/types";
import { monoInstanceId } from "../../../../src/mono/ids";
import type { MonoCheckedType, MonoFunctionSignature } from "../../../../src/mono/mono-hir";
import { staticChar16MetadataFromOptIrConstantPool } from "../../../../src/target/uefi-aarch64/package-pipeline-static-char16";
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
    const pointerValueKeys = result.value.optIr.staticChar16Pointers.map(
      (record) => record.valueKey,
    );
    const constAddrValueKeys = constAddrPointerValueKeys(result.value.optIr.operations);
    expect(new Set(pointerValueKeys).size).toBe(pointerValueKeys.length);
    expect(result.value.optIr.staticChar16Pointers.length).toBeGreaterThanOrEqual(1);
    expect(pointerValueKeys.every((valueKey) => constAddrValueKeys.has(valueKey))).toBe(true);
    expect(
      result.value.optIr.staticChar16Pointers.every(
        (record) =>
          record.pointer.stableKey === result.value.optIr.staticChar16Strings[0]?.stableKey,
      ),
    ).toBe(true);
    expect(
      result.value.optIr.staticChar16Pointers.some((record) =>
        record.valueKey.startsWith("optir.value:"),
      ),
    ).toBe(true);
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
    const constAddrValueKeys = constAddrPointerValueKeys(result.value.optIr.operations);
    expect(new Set(staticStringStableKeys).size).toBe(staticStringStableKeys.length);
    expect(new Set(staticPointerValueKeys).size).toBe(staticPointerValueKeys.length);
    expect(staticPointerValueKeys.every((valueKey) => constAddrValueKeys.has(valueKey))).toBe(true);
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

  test("constant-pool metadata does not propagate pointers through source-call parameters", () => {
    const constantId = optIrConstantId(1);
    const constAddr = optIrConstAddrOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(1),
      resultType: optIrAddressType(),
      constantId,
      originId: optIrOriginId(1),
    });
    const sourceCall = optIrSourceCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(1),
      target: { kind: "source", functionInstanceId: monoInstanceId("callee") },
      argumentIds: [optIrValueId(1)],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });
    const dataConstant = {
      kind: "data" as const,
      constantId,
      type: optIrAddressType(),
      normalizedValue: 0n,
      bytes: Object.freeze([104, 0, 105, 0, 0, 0]),
      alignment: 2,
      section: ".rodata",
      stableKey: "utf16-static-direct-only",
      fingerprint: optIrDataConstantFingerprint({
        bytes: [104, 0, 105, 0, 0, 0],
        alignment: 2,
        section: ".rodata",
        stableKey: "utf16-static-direct-only",
      }),
    };

    const metadata = staticChar16MetadataFromOptIrConstantPool({
      program: optIrProgram({
        programId: optIrProgramId(1),
        targetId: targetId("uefi-aarch64-test"),
        functions: optIrFunctionTable([
          optIrFunctionForMetadataTest({
            functionIdValue: 1,
            instance: "caller",
            operations: [constAddr.operationId, sourceCall.operationId],
          }),
          optIrFunctionForMetadataTest({
            functionIdValue: 2,
            instance: "callee",
            parameters: [optIrValueId(2)],
            operations: [],
          }),
        ]),
        regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId: optIrOriginId(1) }]),
        constants: optIrConstantTable([dataConstant]),
        callGraph: { calls: [] },
        provenance: { originIds: [optIrOriginId(1)] },
      }),
      operations: [constAddr, sourceCall],
    });

    expect(metadata.staticChar16Pointers.map((record) => record.valueKey)).toEqual([
      "optir.value:1",
    ]);
  });

  test("packet-counter derived validated-buffer enum comparison lowers through a validated field read", () => {
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
    expect(
      result.value.optIr.unoptimizedOperations.some(
        (operation) =>
          operation.kind === "memoryLoad" &&
          operation.memoryAccess.validatedBuffer?.fieldName === "3",
      ),
    ).toBe(true);
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

function constAddrPointerValueKeys(
  operations: readonly { readonly kind: string; readonly resultIds?: readonly unknown[] }[],
): ReadonlySet<string> {
  return new Set(
    operations
      .filter((operation) => operation.kind === "constAddr")
      .flatMap((operation) => operation.resultIds ?? [])
      .map((valueId) => `optir.value:${String(valueId)}`),
  );
}

function optIrFunctionForMetadataTest(input: {
  readonly functionIdValue: number;
  readonly instance: string;
  readonly parameters?: readonly ReturnType<typeof optIrValueId>[];
  readonly operations: readonly ReturnType<typeof optIrOperationId>[];
}): OptIrFunction {
  const block: OptIrBlock = {
    blockId: optIrBlockId(input.functionIdValue),
    parameters: (input.parameters ?? []).map((valueId) =>
      optIrBlockParameter({
        valueId,
        type: optIrAddressType(),
        incomingRole: "entry",
        originId: optIrOriginId(input.functionIdValue),
      }),
    ),
    operations: input.operations,
    originId: optIrOriginId(input.functionIdValue),
  };
  return {
    functionId: optIrFunctionId(input.functionIdValue),
    monoInstanceId: monoInstanceId(input.instance),
    signature: signatureForMetadataTest(input.functionIdValue),
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId: optIrOriginId(input.functionIdValue),
  };
}

const monoAddressType = coreCheckedType(coreTypeId("Address")) as MonoCheckedType;

function signatureForMetadataTest(identifier: number): MonoFunctionSignature {
  return {
    functionId: functionId(identifier),
    itemId: itemId(identifier),
    parameters: [],
    returnType: monoAddressType,
    returnKind: "Copy",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}
