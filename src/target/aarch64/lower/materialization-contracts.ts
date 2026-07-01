import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../../../opt-ir/operations";
import type { AArch64AbiLocation } from "../machine-ir/abi-location";
import type { AArch64FrameObjectId } from "../machine-ir/ids";
import type { AArch64RegionMemoryType } from "../machine-ir/memory-order";
import type { AArch64SymbolReference } from "../machine-ir/symbol-reference";
import {
  aarch64ScheduleMetadata,
  defaultAArch64ScheduleMetadata,
  type AArch64IssueClass,
  type AArch64ScheduleMetadata,
} from "../machine-ir/schedule";
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
import type { OperationOf } from "./operation-materialization-helpers";

export interface AArch64MaterializedMemoryAddress {
  readonly base: AArch64MaterializedMemoryBase;
  readonly offset?: bigint;
  readonly mode: "base-unsigned-immediate" | "materialized-address";
}

export type AArch64MaterializedMemoryBase =
  | { readonly kind: "register"; readonly register: AArch64VirtualRegister }
  | { readonly kind: "frameObject"; readonly frameObject: AArch64FrameObjectId };

export type AArch64ResolvedMemoryAddressBasis =
  | {
      readonly kind: "base";
      readonly base: AArch64MaterializedMemoryBase;
      readonly byteOffset: bigint;
    }
  | {
      readonly kind: "symbol";
      readonly symbol: AArch64SymbolReference;
      readonly byteOffset: bigint;
    }
  | { readonly kind: "abstract"; readonly abstractBase: bigint; readonly byteOffset: bigint };

export type SemanticOptIrOperation = OperationOf<
  | "semanticAtomic"
  | "semanticFence"
  | "semanticChecksum"
  | "semanticPolynomial"
  | "semanticCryptoMix"
  | "semanticClassifier"
  | "semanticRegionMarker"
>;

export function scheduleMetadataForInstruction(
  opcode: string,
  issueClass: AArch64IssueClass,
): AArch64ScheduleMetadata {
  const base = defaultAArch64ScheduleMetadata(issueClass);
  if (opcode === "dmb" || opcode === "dsb") {
    return aarch64ScheduleMetadata({
      ...base,
      motion: { kind: "hardBoundary" },
    });
  }
  if (opcode !== "fmadd" && opcode !== "fmla") {
    if (opcode === "fcvt-fp16") {
      return aarch64ScheduleMetadata({
        ...base,
        errataConstraints: ["fp16-narrowing-authorized"],
      });
    }
    if (opcode === "sqrdmulh" || opcode === "sqrdmlah") {
      return aarch64ScheduleMetadata({
        ...base,
        errataConstraints: [
          "numeric-error-bound-authorized",
          "rdm-authorized",
          "saturation-authorized",
        ],
      });
    }
    if (opcode === "sqadd-saturating") {
      return aarch64ScheduleMetadata({
        ...base,
        errataConstraints: ["saturation-authorized"],
      });
    }
    if (opcode === "dotprod") {
      return aarch64ScheduleMetadata({
        ...base,
        errataConstraints: ["dotprod-authorized"],
      });
    }
    return base;
  }
  return aarch64ScheduleMetadata({
    ...base,
    errataConstraints: ["fp-contraction-authorized"],
  });
}

export function memoryAccessScheduleMetadata(
  opcode: string,
  issueClass: AArch64IssueClass,
  access: OptIrMemoryAccessDescriptor,
): AArch64ScheduleMetadata {
  return aarch64ScheduleMetadata({
    ...scheduleMetadataForInstruction(opcode, issueClass),
    pairability: [
      `memory-footprint:${String(access.region)}:${String(access.byteOffset)}:${access.byteWidth}`,
    ],
  });
}

export function unsupportedAggregateLowering(
  operation: OptIrOperation,
  detail: string,
): { readonly kind: "error"; readonly stableDetail: string } {
  return {
    kind: "error",
    stableDetail: `aggregate-lowering:unsupported-without-layout-facts:${String(operation.operationId)}:${detail}`,
  };
}

export function fieldPathStableKey(fieldPath: readonly string[]): string {
  return fieldPath.length === 0 ? "<root>" : fieldPath.join(".");
}

export function factBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return undefined;
  return BigInt(value);
}

export function validateTargetMemoryAlignment(input: {
  readonly operationId: number;
  readonly access: OptIrMemoryAccessDescriptor;
  readonly regionMemoryType: AArch64RegionMemoryType;
}): { readonly kind: "ok" } | { readonly kind: "error"; readonly stableDetail: string } {
  if (
    input.regionMemoryType !== "deviceMmio" &&
    input.regionMemoryType !== "firmwareTable" &&
    input.regionMemoryType !== "runtimeOwned"
  ) {
    return { kind: "ok" };
  }
  if (input.access.alignment < input.access.byteWidth) {
    return {
      kind: "error",
      stableDetail: `device-memory-unaligned-access:operation:${input.operationId}:${input.access.alignment}:${input.access.byteWidth}`,
    };
  }
  if (input.access.byteOffset % BigInt(input.access.byteWidth) !== 0n) {
    return {
      kind: "error",
      stableDetail: `device-memory-unaligned-offset:operation:${input.operationId}:${input.access.byteOffset}:${input.access.byteWidth}`,
    };
  }
  return { kind: "ok" };
}

export function abstractAddressBaseForKey(key: string): bigint {
  const compactRegion = /^(?:frame|region):(\d+)$/.exec(key);
  if (compactRegion?.[1] !== undefined) {
    return BigInt(compactRegion[1]) << 12n;
  }
  let hash = 0xcbf29ce484222325n;
  for (const char of key) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return (hash & 0x0000ffffffffffffn) << 16n;
}

export function semanticAtomicContract(operation: SemanticOptIrOperation):
  | {
      readonly kind: "ok";
      readonly addressSourceIndex: number;
      readonly valueSourceIndex: number;
      readonly regionMemoryType: AArch64RegionMemoryType;
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const addressSourceIndex = nonNegativeIntegerFromContract(
    operation.semanticContract.addressSourceIndex,
  );
  const valueSourceIndex = nonNegativeIntegerFromContract(
    operation.semanticContract.valueSourceIndex,
  );
  const regionMemoryType = asAArch64RegionMemoryType(operation.semanticContract.regionMemoryType);
  if (addressSourceIndex === undefined) {
    return {
      kind: "error",
      stableDetail: `semantic-atomic:missing-address-source:${String(operation.operationId)}`,
    };
  }
  if (valueSourceIndex === undefined) {
    return {
      kind: "error",
      stableDetail: `semantic-atomic:missing-value-source:${String(operation.operationId)}`,
    };
  }
  if (regionMemoryType === undefined) {
    return {
      kind: "error",
      stableDetail: `semantic-atomic:missing-region-memory-type:${String(operation.operationId)}`,
    };
  }
  return { kind: "ok", addressSourceIndex, valueSourceIndex, regionMemoryType };
}

export function classifierOpcodeForContract(value: unknown): "dotprod" | "tbl" | "tbx" | undefined {
  if (value === undefined) return "dotprod";
  return value === "dotprod" || value === "tbl" || value === "tbx" ? value : undefined;
}

export function isBaseOnlyMemoryOpcode(opcode: string): boolean {
  return opcode === "ldar" || opcode === "stlr";
}

export function addResolvedMemoryAddressBasisOffset(
  basis: AArch64ResolvedMemoryAddressBasis,
  offset: bigint,
): AArch64ResolvedMemoryAddressBasis {
  return { ...basis, byteOffset: basis.byteOffset + offset };
}

export function validateThreeRegisterOpcodeClasses(
  opcode: "tbl" | "tbx" | "cmeq" | "crc32" | "pmull" | "aes-sha-round" | "dotprod",
  registers: readonly AArch64VirtualRegister[],
):
  | { readonly kind: "ok" }
  | {
      readonly kind: "error";
      readonly operandIndex: number;
      readonly expected: string;
      readonly actual: string;
    } {
  const expected = opcode === "crc32" ? "gpr32|gpr64" : "vector128";
  for (let index = 0; index < registers.length; index += 1) {
    const register = registers[index];
    if (register === undefined) continue;
    const matches =
      expected === "vector128"
        ? register.registerClass === "vector128"
        : register.registerClass === "gpr32" || register.registerClass === "gpr64";
    if (!matches) {
      return {
        kind: "error",
        operandIndex: index,
        expected,
        actual: register.registerClass,
      };
    }
  }
  return { kind: "ok" };
}

export function nonNegativeIntegerFromContract(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function asAArch64RegionMemoryType(value: unknown): AArch64RegionMemoryType | undefined {
  return typeof value === "string" && AARCH64_REGION_MEMORY_TYPE_SET.has(value)
    ? (value as AArch64RegionMemoryType)
    : undefined;
}

const AARCH64_REGION_MEMORY_TYPE_SET = new Set<string>([
  "normalCacheable",
  "deviceMmio",
  "firmwareTable",
  "runtimeOwned",
  "externalConservative",
  "packetSource",
  "validatedPayload",
]);

export function isCallOperation(
  operation: OptIrOperation,
): operation is OperationOf<"sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall"> {
  return (
    operation.kind === "sourceCall" ||
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  );
}

export function isAggregateOperation(
  operation: OptIrOperation,
): operation is OperationOf<"aggregateConstruct" | "aggregateExtract" | "aggregateInsert"> {
  return (
    operation.kind === "aggregateConstruct" ||
    operation.kind === "aggregateExtract" ||
    operation.kind === "aggregateInsert"
  );
}

export function isVectorMemoryOperation(
  operation: OptIrOperation,
): operation is OperationOf<
  "vectorLoad" | "vectorMaskedLoad" | "vectorStore" | "vectorMaskedStore"
> {
  return (
    operation.kind === "vectorLoad" ||
    operation.kind === "vectorMaskedLoad" ||
    operation.kind === "vectorStore" ||
    operation.kind === "vectorMaskedStore"
  );
}

export function isScalarOrderedMemoryOpcode(opcode: string): boolean {
  return opcode === "ldar" || opcode === "stlr";
}

export function platformCallTargetKey(
  target: OperationOf<"sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall">["target"],
): string {
  if (target.kind === "platform") {
    return target.platformKey;
  }
  return `unsupported.${target.kind}`;
}

export function abiLocationKey(location: AArch64AbiLocation): string {
  switch (location.kind) {
    case "intReg":
    case "vectorReg":
    case "indirectResultPointer":
      return `${location.kind}:${location.index}`;
    case "stackArg":
      return `${location.kind}:${location.ordinal}:${location.offsetBytes}:${location.size}:${location.alignment}`;
  }
}
