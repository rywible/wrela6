import type { LowerTypedHirResult } from "../../hir";
import type { HirCompilerIntrinsicCallMetadata } from "../../hir/hir";
import type { OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  fingerprintUefiAArch64StaticChar16String,
  materializeUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
  type UefiAArch64StaticChar16String,
  type UefiAArch64StaticChar16StringPointer,
} from "./firmware-strings";
import type { CompilerPackageInput } from "./package-input";
import type {
  PackageOptimizedOptIrAdapter,
  UefiAArch64OptimizedOptIrArtifact,
  UefiAArch64PackagePipelineStageKey,
  UefiAArch64PackageStageResult,
  UefiAArch64StaticChar16IntrinsicMetadata,
  UefiAArch64StaticChar16PointerRecord,
} from "./package-pipeline";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  uefiAArch64Error,
  uefiAArch64Ok,
  verificationSummaryFromRuns,
  type UefiAArch64TargetResult,
} from "./result";

const PACKAGE_PIPELINE_VERIFIER_KEY = "uefi-aarch64-package-pipeline";

export function extractUefiAArch64StaticChar16MetadataFromCompilerIntrinsics(
  calls: readonly HirCompilerIntrinsicCallMetadata[],
): UefiAArch64TargetResult<UefiAArch64StaticChar16IntrinsicMetadata> {
  const strings: UefiAArch64StaticChar16String[] = [];
  const pointers: UefiAArch64StaticChar16PointerRecord[] = [];
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const sortedCalls = [...calls].sort((left, right) =>
    compareCodeUnitStrings(left.sourceValueKey, right.sourceValueKey),
  );

  for (const call of sortedCalls) {
    if (call.intrinsicKey !== "uefi.utf16_static" || call.returnTypeKey !== "uefi.Utf16Static") {
      continue;
    }
    const stableKey = `utf16-static-${call.sourceValueKey}`;
    const materialized = materializeUefiAArch64StaticChar16String({
      stableKey,
      value: call.literalValue,
    });
    if (materialized.kind === "error") {
      diagnostics.push(...materialized.diagnostics);
      continue;
    }
    strings.push(materialized.value);
    pointers.push(
      Object.freeze({
        valueKey: call.sourceValueKey,
        pointer: uefiAArch64StaticChar16StringPointer(materialized.value),
      }),
    );
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: verificationSummaryFromRuns([
        { verifierKey: PACKAGE_PIPELINE_VERIFIER_KEY, runKey: "static-char16", status: "failed" },
      ]),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      staticChar16Strings: Object.freeze(strings),
      staticChar16Pointers: Object.freeze(pointers),
    }),
    verification: verificationSummaryFromRuns([
      { verifierKey: PACKAGE_PIPELINE_VERIFIER_KEY, runKey: "static-char16", status: "passed" },
    ]),
  });
}

export function compilerIntrinsicCallsFromTypedHir(
  lowerTypedHirResult: LowerTypedHirResult,
): readonly HirCompilerIntrinsicCallMetadata[] {
  const calls: HirCompilerIntrinsicCallMetadata[] = [];
  for (const function_ of lowerTypedHirResult.program.functions.entries()) {
    const expressions = function_.bodyIndex?.expressions.entries() ?? [];
    for (const expression of expressions) {
      if (expression.kind.kind === "call" && expression.kind.call.compilerIntrinsic !== undefined) {
        calls.push(expression.kind.call.compilerIntrinsic);
      }
    }
  }
  return Object.freeze(
    calls.sort((left, right) => compareCodeUnitStrings(left.sourceValueKey, right.sourceValueKey)),
  );
}

export function optimizedOptIrArtifact(
  adapter: PackageOptimizedOptIrAdapter,
  packageInput: CompilerPackageInput,
): UefiAArch64PackageStageResult<UefiAArch64OptimizedOptIrArtifact> {
  if (!isOptimizedOptIrArtifact(adapter)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }
  const staticMetadata = normalizeStaticChar16Metadata(adapter);
  if (staticMetadata.kind === "error") {
    return { kind: "error", diagnostics: staticMetadata.diagnostics };
  }
  return {
    kind: "ok",
    value: Object.freeze({
      program: adapter.program,
      operations: Object.freeze([...adapter.operations]),
      unoptimizedOperations: Object.freeze([...adapter.unoptimizedOperations]),
      facts: adapter.facts,
      staticChar16Strings: staticMetadata.staticChar16Strings,
      staticChar16Pointers: staticMetadata.staticChar16Pointers,
      validationFixturePacketSources:
        packageInput.validationFixturePacketSource === undefined
          ? Object.freeze([])
          : Object.freeze([packageInput.validationFixturePacketSource]),
    }),
    diagnostics: [],
  };
}

export function emptyStaticChar16Metadata(): UefiAArch64StaticChar16IntrinsicMetadata {
  return Object.freeze({
    staticChar16Strings: Object.freeze([]),
    staticChar16Pointers: Object.freeze([]),
  });
}

export function remapStaticChar16MetadataToOptIrValues(input: {
  readonly metadata?: UefiAArch64StaticChar16IntrinsicMetadata;
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
}): UefiAArch64StaticChar16IntrinsicMetadata {
  if (input.metadata === undefined) {
    return emptyStaticChar16Metadata();
  }
  const optIrValueKeysBySourceValueKey = new Map<string, string[]>();
  for (const operation of input.operations) {
    if (
      operation.kind !== "intrinsicCall" ||
      operation.target.kind !== "intrinsic" ||
      operation.target.sourceValueKey === undefined ||
      operation.resultIds.length !== 1
    ) {
      continue;
    }
    appendStaticValueKey(
      optIrValueKeysBySourceValueKey,
      operation.target.sourceValueKey,
      `optir.value:${String(operation.resultIds[0])}`,
    );
  }

  const pointersByValueKey = new Map<string, UefiAArch64StaticChar16StringPointer>();
  const staticChar16Pointers: UefiAArch64StaticChar16PointerRecord[] = [];
  for (const record of input.metadata.staticChar16Pointers) {
    const optIrValueKeys = optIrValueKeysBySourceValueKey.get(record.valueKey);
    if (optIrValueKeys === undefined || optIrValueKeys.length === 0) {
      continue;
    }
    for (const valueKey of optIrValueKeys) {
      appendStaticChar16PointerRecord(staticChar16Pointers, pointersByValueKey, {
        valueKey,
        pointer: record.pointer,
      });
    }
  }
  propagateStaticChar16PointersThroughSourceCallParameters({
    program: input.program,
    operations: input.operations,
    staticChar16Pointers,
    pointersByValueKey,
  });

  return Object.freeze({
    staticChar16Strings: referencedStaticChar16Strings(input.metadata, staticChar16Pointers),
    staticChar16Pointers: Object.freeze(
      staticChar16Pointers.sort((left, right) =>
        compareCodeUnitStrings(left.valueKey, right.valueKey),
      ),
    ),
  });
}

function isOptimizedOptIrArtifact(candidate: unknown): candidate is PackageOptimizedOptIrAdapter & {
  readonly program: UefiAArch64OptimizedOptIrArtifact["program"];
  readonly operations: UefiAArch64OptimizedOptIrArtifact["operations"];
  readonly unoptimizedOperations: UefiAArch64OptimizedOptIrArtifact["unoptimizedOperations"];
  readonly facts: UefiAArch64OptimizedOptIrArtifact["facts"];
} {
  if (typeof candidate !== "object" || candidate === null) return false;
  const adapter = candidate as PackageOptimizedOptIrAdapter;
  return (
    typeof adapter.program === "object" &&
    adapter.program !== null &&
    Array.isArray(adapter.operations) &&
    Array.isArray(adapter.unoptimizedOperations) &&
    typeof adapter.facts === "object" &&
    adapter.facts !== null
  );
}

function normalizeStaticChar16Metadata(adapter: PackageOptimizedOptIrAdapter):
  | {
      readonly kind: "ok";
      readonly staticChar16Strings: readonly UefiAArch64StaticChar16String[];
      readonly staticChar16Pointers: readonly UefiAArch64StaticChar16PointerRecord[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] } {
  if (!Array.isArray(adapter.staticChar16Strings)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }
  if (!Array.isArray(adapter.staticChar16Pointers)) {
    return {
      kind: "error",
      diagnostics: [packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed")],
    };
  }

  const strings = Object.freeze([...adapter.staticChar16Strings]);
  const pointers = Object.freeze([...adapter.staticChar16Pointers]);
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const stringsByFingerprint = new Map<string, UefiAArch64StaticChar16String>();
  const stableKeyFingerprints = new Map<string, string>();

  for (const value of strings) {
    if (!isStaticChar16StringRecord(value)) {
      diagnostics.push(packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed"));
      continue;
    }
    const expectedFingerprint = fingerprintUefiAArch64StaticChar16String({
      stableKey: value.stableKey,
      codeUnits: value.codeUnits,
      nulTerminated: true,
    });
    if (value.fingerprint !== expectedFingerprint) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:stale-static-char16-string:${value.stableKey}`,
        ),
      );
      continue;
    }
    const previousStableKeyFingerprint = stableKeyFingerprints.get(value.stableKey);
    if (
      previousStableKeyFingerprint !== undefined &&
      previousStableKeyFingerprint !== value.fingerprint
    ) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-string:${value.stableKey}`,
        ),
      );
    }
    stableKeyFingerprints.set(value.stableKey, value.fingerprint);
    stringsByFingerprint.set(value.fingerprint, value);
  }

  const valueKeys = new Set<string>();
  const symbolFingerprints = new Map<string, string>();
  for (const record of pointers) {
    if (!isStaticChar16PointerRecord(record)) {
      diagnostics.push(packagePipelineDiagnostic("opt-ir", "opt-ir-artifact:malformed"));
      continue;
    }
    if (valueKeys.has(record.valueKey)) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-pointer:${record.valueKey}`,
        ),
      );
      continue;
    }
    valueKeys.add(record.valueKey);
    const string = stringsByFingerprint.get(record.pointer.fingerprint);
    if (string === undefined) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:malformed-static-char16-pointer:${record.valueKey}`,
        ),
      );
      continue;
    }
    const expectedPointer = uefiAArch64StaticChar16StringPointer(string);
    if (!staticChar16PointersEqual(record.pointer, expectedPointer)) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:malformed-static-char16-pointer:${record.valueKey}`,
        ),
      );
    }
    const previousSymbolFingerprint = symbolFingerprints.get(record.pointer.symbolName);
    if (
      previousSymbolFingerprint !== undefined &&
      previousSymbolFingerprint !== record.pointer.fingerprint
    ) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `opt-ir-artifact:duplicate-static-char16-symbol:${record.pointer.symbolName}`,
        ),
      );
    }
    symbolFingerprints.set(record.pointer.symbolName, record.pointer.fingerprint);
  }

  return diagnostics.length > 0
    ? { kind: "error", diagnostics }
    : { kind: "ok", staticChar16Strings: strings, staticChar16Pointers: pointers };
}

function isStaticChar16StringRecord(value: unknown): value is UefiAArch64StaticChar16String {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<UefiAArch64StaticChar16String>;
  return (
    typeof record.stableKey === "string" &&
    record.stableKey.length > 0 &&
    Array.isArray(record.codeUnits) &&
    record.codeUnits.every((codeUnit) => Number.isInteger(codeUnit) && codeUnit >= 0) &&
    Array.isArray(record.bytes) &&
    record.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff) &&
    record.nulTerminated === true &&
    typeof record.fingerprint === "string" &&
    record.fingerprint.length > 0
  );
}

function isStaticChar16PointerRecord(
  value: unknown,
): value is UefiAArch64StaticChar16PointerRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<UefiAArch64StaticChar16PointerRecord>;
  return (
    typeof record.valueKey === "string" &&
    record.valueKey.length > 0 &&
    typeof record.pointer === "object" &&
    record.pointer !== null &&
    isStaticChar16Pointer(record.pointer)
  );
}

function isStaticChar16Pointer(value: unknown): value is UefiAArch64StaticChar16StringPointer {
  if (typeof value !== "object" || value === null) return false;
  const pointer = value as Partial<UefiAArch64StaticChar16StringPointer>;
  return (
    pointer.kind === "static-char16-pointer" &&
    typeof pointer.stableKey === "string" &&
    pointer.stableKey.length > 0 &&
    typeof pointer.symbolName === "string" &&
    pointer.symbolName.length > 0 &&
    typeof pointer.fingerprint === "string" &&
    pointer.fingerprint.length > 0 &&
    pointer.lifetime === "image-readonly" &&
    pointer.nulTerminated === true
  );
}

function staticChar16PointersEqual(
  left: UefiAArch64StaticChar16StringPointer,
  right: UefiAArch64StaticChar16StringPointer,
): boolean {
  return (
    left.kind === right.kind &&
    left.stableKey === right.stableKey &&
    left.symbolName === right.symbolName &&
    left.fingerprint === right.fingerprint &&
    left.lifetime === right.lifetime &&
    left.nulTerminated === right.nulTerminated
  );
}

function referencedStaticChar16Strings(
  metadata: UefiAArch64StaticChar16IntrinsicMetadata,
  pointers: readonly UefiAArch64StaticChar16PointerRecord[],
): readonly UefiAArch64StaticChar16String[] {
  const referencedFingerprints = new Set(pointers.map((record) => record.pointer.fingerprint));
  const strings = metadata.staticChar16Strings.filter((string) =>
    referencedFingerprints.has(string.fingerprint),
  );
  return Object.freeze(strings);
}

function appendStaticValueKey(
  index: Map<string, string[]>,
  sourceValueKey: string,
  optIrValueKey: string,
): void {
  const existing = index.get(sourceValueKey);
  if (existing === undefined) {
    index.set(sourceValueKey, [optIrValueKey]);
    return;
  }
  if (!existing.includes(optIrValueKey)) {
    existing.push(optIrValueKey);
    existing.sort(compareCodeUnitStrings);
  }
}

function appendStaticChar16PointerRecord(
  records: UefiAArch64StaticChar16PointerRecord[],
  pointersByValueKey: Map<string, UefiAArch64StaticChar16StringPointer>,
  record: UefiAArch64StaticChar16PointerRecord,
): boolean {
  const existing = pointersByValueKey.get(record.valueKey);
  if (existing !== undefined && staticChar16PointersEqual(existing, record.pointer)) {
    return false;
  }
  records.push(Object.freeze({ valueKey: record.valueKey, pointer: record.pointer }));
  if (existing === undefined) {
    pointersByValueKey.set(record.valueKey, record.pointer);
    return true;
  }
  return false;
}

function propagateStaticChar16PointersThroughSourceCallParameters(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly staticChar16Pointers: UefiAArch64StaticChar16PointerRecord[];
  readonly pointersByValueKey: Map<string, UefiAArch64StaticChar16StringPointer>;
}): void {
  const entryParametersByFunction = sourceEntryParametersByFunction(input.program);
  const pointersByValueKey = pointerSetsByValueKey(input.pointersByValueKey);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of input.operations) {
      if (operation.kind !== "sourceCall" || operation.target.kind !== "source") {
        continue;
      }
      const entryParameters = entryParametersByFunction.get(
        String(operation.target.functionInstanceId),
      );
      if (entryParameters === undefined) {
        continue;
      }
      for (let index = 0; index < operation.argumentIds.length; index += 1) {
        const argumentId = operation.argumentIds[index];
        const parameterId = entryParameters[index];
        if (argumentId === undefined || parameterId === undefined) {
          continue;
        }
        const argumentPointers = pointersByValueKey.get(`optir.value:${String(argumentId)}`);
        if (argumentPointers === undefined || argumentPointers.size === 0) {
          continue;
        }
        changed =
          unionPointerSet(
            pointersByValueKey,
            `optir.value:${String(parameterId)}`,
            argumentPointers,
          ) || changed;
      }
    }
  }

  for (const [valueKey, pointers] of [...pointersByValueKey.entries()].sort((left, right) =>
    compareCodeUnitStrings(left[0], right[0]),
  )) {
    if (pointers.size !== 1) {
      continue;
    }
    const pointer = [...pointers.values()][0];
    if (pointer === undefined) {
      continue;
    }
    const existing = input.pointersByValueKey.get(valueKey);
    if (existing !== undefined && !staticChar16PointersEqual(existing, pointer)) {
      continue;
    }
    appendStaticChar16PointerRecord(input.staticChar16Pointers, input.pointersByValueKey, {
      valueKey,
      pointer,
    });
  }
}

function pointerSetsByValueKey(
  pointersByValueKey: ReadonlyMap<string, UefiAArch64StaticChar16StringPointer>,
): Map<string, Map<string, UefiAArch64StaticChar16StringPointer>> {
  const output = new Map<string, Map<string, UefiAArch64StaticChar16StringPointer>>();
  for (const [valueKey, pointer] of pointersByValueKey.entries()) {
    output.set(valueKey, new Map([[staticChar16PointerStableKey(pointer), pointer]]));
  }
  return output;
}

function unionPointerSet(
  pointersByValueKey: Map<string, Map<string, UefiAArch64StaticChar16StringPointer>>,
  valueKey: string,
  incomingPointers: ReadonlyMap<string, UefiAArch64StaticChar16StringPointer>,
): boolean {
  let pointerSet = pointersByValueKey.get(valueKey);
  if (pointerSet === undefined) {
    pointerSet = new Map<string, UefiAArch64StaticChar16StringPointer>();
    pointersByValueKey.set(valueKey, pointerSet);
  }

  let changed = false;
  for (const [pointerKey, pointer] of incomingPointers.entries()) {
    if (pointerSet.has(pointerKey)) {
      continue;
    }
    pointerSet.set(pointerKey, pointer);
    changed = true;
  }
  return changed;
}

function staticChar16PointerStableKey(pointer: UefiAArch64StaticChar16StringPointer): string {
  return `${pointer.stableKey}:${pointer.fingerprint}:${pointer.symbolName}`;
}

function sourceEntryParametersByFunction(
  program: OptIrProgram,
): ReadonlyMap<string, readonly number[]> {
  const parametersByFunction = new Map<string, readonly number[]>();
  for (const function_ of program.functions.entries()) {
    const entryBlock = function_.blocks.find((block) => block.blockId === function_.entryBlock);
    if (entryBlock === undefined) {
      continue;
    }
    parametersByFunction.set(
      String(function_.monoInstanceId),
      Object.freeze(
        entryBlock.parameters
          .filter((parameter) => parameter.incomingRole === "entry")
          .map((parameter) => Number(parameter.valueId)),
      ),
    );
  }
  return parametersByFunction;
}

function packagePipelineDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: `uefi-aarch64-package-pipeline:${stageKey}`,
    stableDetail,
  });
}
