import { optIrDataConstantFingerprint, type OptIrDataConstant } from "../../opt-ir/constants";
import type { OptIrConstantId } from "../../opt-ir/ids";
import { optIrConstAddrOperation, type OptIrOperation } from "../../opt-ir/operations";
import type { OptIrProgram } from "../../opt-ir/program";
import { optIrConstantTable } from "../../opt-ir/program";
import { optIrConstantId } from "../../opt-ir/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableDigestHex } from "../../shared/stable-json";
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
  UefiAArch64PackageStageResult,
  UefiAArch64StaticChar16IntrinsicMetadata,
  UefiAArch64StaticChar16PointerRecord,
} from "./package-pipeline";
import type { UefiAArch64TargetDiagnostic } from "./diagnostics";
import { packagePipelineDiagnostic } from "./package-pipeline-records";

export interface UefiAArch64ConstantPoolReadonlyPointer {
  readonly symbolName: string;
  readonly stableKey: string;
  readonly fingerprint: string;
  readonly label: string;
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
      optimizationRegions: Object.freeze([...adapter.optimizationRegions]),
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

export type UefiAArch64StaticChar16ConstantPoolMaterializationResult =
  | {
      readonly kind: "ok";
      readonly program: OptIrProgram;
      readonly operations: readonly OptIrOperation[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] };

export function materializeStaticChar16ConstantPoolReferences(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
}): UefiAArch64StaticChar16ConstantPoolMaterializationResult {
  let nextConstantId =
    input.program.constants
      .entries()
      .reduce((maximum, constant) => Math.max(maximum, Number(constant.constantId)), 0) + 1;
  const dataConstantsByFingerprint = new Map(
    input.program.constants
      .entries()
      .filter(isStaticChar16DataConstant)
      .map((constant) => [staticChar16StringFromDataConstant(constant).fingerprint, constant]),
  );
  const operations: OptIrOperation[] = [];
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];

  for (const operation of input.operations) {
    if (
      operation.kind !== "intrinsicCall" ||
      operation.target.kind !== "intrinsic" ||
      operation.resultIds.length !== 1
    ) {
      operations.push(operation);
      continue;
    }
    if (operation.target.intrinsicKey !== "uefi.utf16_static") {
      operations.push(operation);
      continue;
    }
    if (operation.target.literalValue === undefined) {
      diagnostics.push(
        packagePipelineDiagnostic(
          "opt-ir",
          `static-char16:missing-literal:${String(operation.operationId)}`,
        ),
      );
      operations.push(operation);
      continue;
    }
    const materializedString = staticChar16StringFromLiteralValue(operation.target.literalValue);
    if (materializedString.kind === "error") {
      diagnostics.push(...materializedString.diagnostics);
      continue;
    }
    const string = materializedString.value;
    const resultId = operation.resultIds[0];
    const resultType = operation.resultTypes[0];
    if (resultId === undefined || resultType === undefined) {
      operations.push(operation);
      continue;
    }
    let constant = dataConstantsByFingerprint.get(string.fingerprint);
    if (constant === undefined) {
      constant = Object.freeze({
        kind: "data" as const,
        constantId: optIrConstantId(nextConstantId++),
        type: Object.freeze({ kind: "address" as const }),
        normalizedValue: 0n,
        bytes: Object.freeze([...string.bytes]),
        alignment: 2,
        section: ".rodata",
        stableKey: string.stableKey,
        fingerprint: optIrDataConstantFingerprint({
          bytes: string.bytes,
          alignment: 2,
          section: ".rodata",
          stableKey: string.stableKey,
        }),
      });
      dataConstantsByFingerprint.set(string.fingerprint, constant);
    }
    operations.push(
      optIrConstAddrOperation({
        operationId: operation.operationId,
        resultId,
        resultType,
        constantId: constant.constantId,
        originId: operation.originId,
        displayName: operation.displayName,
      }),
    );
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: Object.freeze(diagnostics) };
  }

  const existingStaticConstantIds = new Set(
    [...dataConstantsByFingerprint.values()].map((constant) => constant.constantId),
  );
  const constants = [
    ...input.program.constants
      .entries()
      .filter(
        (constant) =>
          constant.kind !== "data" || !existingStaticConstantIds.has(constant.constantId),
      ),
    ...dataConstantsByFingerprint.values(),
  ];

  const program = Object.freeze({
    ...input.program,
    constants: optIrConstantTable(constants),
  });
  return Object.freeze({
    kind: "ok" as const,
    program,
    operations: Object.freeze(operations),
  });
}

function staticChar16StringFromLiteralValue(
  literalValue: string,
):
  | { readonly kind: "ok"; readonly value: UefiAArch64StaticChar16String }
  | { readonly kind: "error"; readonly diagnostics: readonly UefiAArch64TargetDiagnostic[] } {
  const stableKey = `utf16-static-${stableDigestHex({
    kind: "uefi.utf16_static",
    literalValue,
  })}`;
  const materialized = materializeUefiAArch64StaticChar16String({
    stableKey,
    value: literalValue,
  });
  return materialized.kind === "ok"
    ? { kind: "ok", value: materialized.value }
    : { kind: "error", diagnostics: materialized.diagnostics };
}

export function staticChar16MetadataFromOptIrConstantPool(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
}): UefiAArch64StaticChar16IntrinsicMetadata {
  const stringsByConstantId = new Map(
    input.program.constants
      .entries()
      .filter(isStaticChar16DataConstant)
      .map((constant) => [constant.constantId, staticChar16StringFromDataConstant(constant)]),
  );
  const stringsByFingerprint = new Map<string, UefiAArch64StaticChar16String>();
  const pointers: UefiAArch64StaticChar16PointerRecord[] = [];
  const pointersByValueKey = new Map<string, UefiAArch64StaticChar16StringPointer>();

  for (const operation of input.operations) {
    if (operation.kind !== "constAddr") continue;
    const resultId = operation.resultIds[0];
    if (resultId === undefined) continue;
    const string = stringsByConstantId.get(operation.constantId);
    if (string === undefined) continue;
    stringsByFingerprint.set(string.fingerprint, string);
    appendStaticChar16PointerRecord(pointers, pointersByValueKey, {
      valueKey: `optir.value:${String(resultId)}`,
      pointer: uefiAArch64StaticChar16StringPointer(string),
    });
  }

  return Object.freeze({
    staticChar16Strings: Object.freeze(
      [...stringsByFingerprint.values()].sort((left, right) =>
        compareCodeUnitStrings(left.stableKey, right.stableKey),
      ),
    ),
    staticChar16Pointers: Object.freeze(
      pointers.sort((left, right) => compareCodeUnitStrings(left.valueKey, right.valueKey)),
    ),
  });
}

export function readonlyPointersFromOptIrConstantPool(
  program: OptIrProgram,
): ReadonlyMap<OptIrConstantId, UefiAArch64ConstantPoolReadonlyPointer> {
  const pointers = new Map<OptIrConstantId, UefiAArch64ConstantPoolReadonlyPointer>();
  for (const constant of program.constants.entries()) {
    if (constant.kind !== "data" || constant.section !== ".rodata") continue;
    const pointer = isStaticChar16DataConstant(constant)
      ? uefiAArch64StaticChar16StringPointer(staticChar16StringFromDataConstant(constant))
      : readonlyPointerFromDataConstant(constant);
    pointers.set(
      constant.constantId,
      Object.freeze({
        symbolName: pointer.symbolName,
        stableKey: pointer.stableKey,
        fingerprint: pointer.fingerprint,
        label: "constant-pool-readonly",
      }),
    );
  }
  return pointers;
}

function isOptimizedOptIrArtifact(candidate: unknown): candidate is PackageOptimizedOptIrAdapter & {
  readonly program: UefiAArch64OptimizedOptIrArtifact["program"];
  readonly operations: UefiAArch64OptimizedOptIrArtifact["operations"];
  readonly optimizationRegions: UefiAArch64OptimizedOptIrArtifact["optimizationRegions"];
  readonly unoptimizedOperations: UefiAArch64OptimizedOptIrArtifact["unoptimizedOperations"];
  readonly facts: UefiAArch64OptimizedOptIrArtifact["facts"];
} {
  if (typeof candidate !== "object" || candidate === null) return false;
  const adapter = candidate as PackageOptimizedOptIrAdapter;
  return (
    typeof adapter.program === "object" &&
    adapter.program !== null &&
    Array.isArray(adapter.operations) &&
    Array.isArray(adapter.optimizationRegions) &&
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

function isStaticChar16DataConstant(constant: unknown): constant is OptIrDataConstant {
  if (typeof constant !== "object" || constant === null) return false;
  const record = constant as Partial<OptIrDataConstant>;
  if (record.kind !== "data") return false;
  if (record.section !== ".rodata") return false;
  if (typeof record.stableKey !== "string" || record.stableKey.length === 0) return false;
  if (typeof record.fingerprint !== "string" || record.fingerprint.length === 0) {
    return false;
  }
  if (typeof record.stableKey !== "string" || !record.stableKey.startsWith("utf16-static-")) {
    return false;
  }
  if (!Array.isArray(record.bytes) || record.bytes.length < 2 || record.bytes.length % 2 !== 0) {
    return false;
  }
  if (!record.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff)) {
    return false;
  }
  const codeUnits = codeUnitsFromUtf16LeBytes(record.bytes);
  return codeUnits[codeUnits.length - 1] === 0;
}

function staticChar16StringFromDataConstant(
  constant: OptIrDataConstant,
): UefiAArch64StaticChar16String {
  const codeUnits = codeUnitsFromUtf16LeBytes(constant.bytes);
  return Object.freeze({
    stableKey: constant.stableKey,
    codeUnits: Object.freeze([...codeUnits]),
    bytes: Object.freeze([...constant.bytes]),
    nulTerminated: true as const,
    fingerprint: fingerprintUefiAArch64StaticChar16String({
      stableKey: constant.stableKey,
      codeUnits,
      nulTerminated: true,
    }),
  });
}

function readonlyPointerFromDataConstant(
  constant: OptIrDataConstant,
): UefiAArch64ConstantPoolReadonlyPointer {
  return Object.freeze({
    symbolName: `__wrela_rodata_${sanitizeSymbolComponent(constant.fingerprint)}`,
    stableKey: constant.stableKey,
    fingerprint: constant.fingerprint,
    label: "constant-pool-readonly",
  });
}

function sanitizeSymbolComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function codeUnitsFromUtf16LeBytes(bytes: readonly number[]): readonly number[] {
  const codeUnits: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    codeUnits.push(bytes[index]! | (bytes[index + 1]! << 8));
  }
  return Object.freeze(codeUnits);
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
