import type { OptIrCallTarget } from "../../../opt-ir/calls";
import type { OptIrValueId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import type { OptIrType } from "../../../opt-ir/types";
import { aarch64SymbolId, aarch64VirtualRegisterId } from "../machine-ir/ids";
import type { AArch64MemoryOrder } from "../machine-ir/memory-order";
import {
  aarch64IntMachineType,
  aarch64PointerMachineType,
  aarch64VectorMachineType,
  type AArch64MachineType,
  type AArch64RegisterClass,
} from "../machine-ir/machine-types";
import type { AArch64IssueClass } from "../machine-ir/schedule";
import {
  aarch64VirtualRegister,
  type AArch64VirtualRegister,
} from "../machine-ir/virtual-register";
import { opcodeForAArch64IntegerBinary } from "../select/scalar-opcode-policy";
import type { AArch64LoweringSelectionRecord } from "./pipeline-stages";

export type OperationOf<Kind extends OptIrOperation["kind"]> = OptIrOperation & {
  readonly kind: Kind;
};
export type SourceValueOperation = OptIrOperation & {
  readonly sourceValueIds: readonly OptIrValueId[];
};

export const GPR64 = aarch64IntMachineType(64);
export const POINTER = aarch64PointerMachineType("aarch64.opt-ir");

export function machineTypeForOptIrType(type: OptIrType): AArch64MachineType {
  switch (type.kind) {
    case "boolean":
      return aarch64IntMachineType(1);
    case "integer":
      return aarch64IntMachineType(machineIntegerWidth(type.width));
    case "pointer":
      return aarch64PointerMachineType(type.addressSpace);
    case "address":
      return POINTER;
    case "vector":
      return aarch64VectorMachineType({
        laneType: scalarMachineTypeForOptIrType(type.laneType),
        laneCount: type.laneCount,
      });
    case "vectorMask":
      return aarch64VectorMachineType({
        laneType: aarch64IntMachineType(1),
        laneCount: type.laneCount,
      });
    case "never":
    case "unit":
    case "zeroSized":
      return GPR64;
  }
}

export function registerClassForMachineType(type: AArch64MachineType): AArch64RegisterClass {
  switch (type.kind) {
    case "float":
      return "fpScalar";
    case "vector":
      return type.laneCount * laneWidthForRegisterClass(type.laneType) <= 64
        ? "vector64"
        : "vector128";
    case "integer":
      return type.width <= 32 ? "gpr32" : "gpr64";
    case "pointer":
      return "gpr64";
    case "token":
    case "resourceToken":
      return "gpr64";
  }
}

export function virtualRegisterForOptIrValue(input: {
  readonly valueId: OptIrValueId;
  readonly type: AArch64MachineType;
}): AArch64VirtualRegister {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(Number(input.valueId)),
    registerClass: registerClassForMachineType(input.type),
    type: input.type,
    origin: { kind: "optIrValue", valueId: input.valueId },
  });
}

export function endianDecodeWidthBits(type: AArch64MachineType): 16 | 32 | 64 | 128 {
  if (type.kind === "integer") {
    if (type.width <= 16) return 16;
    if (type.width <= 32) return 32;
    return 64;
  }
  if (type.kind === "vector") return 128;
  return 64;
}

export function asAArch64MemoryOrder(value: unknown): AArch64MemoryOrder | undefined {
  return typeof value === "string" && AARCH64_MEMORY_ORDERS.has(value)
    ? (value as AArch64MemoryOrder)
    : undefined;
}

export function vectorOperationKind(
  kind: OperationOf<"vectorShuffle" | "vectorCompare" | "vectorSelect">["kind"],
): "shuffle" | "compare" | "select" {
  switch (kind) {
    case "vectorShuffle":
      return "shuffle";
    case "vectorCompare":
      return "compare";
    case "vectorSelect":
      return "select";
  }
}

export function directCallSymbol(
  target: OptIrCallTarget,
): ReturnType<typeof aarch64SymbolId> | undefined {
  switch (target.kind) {
    case "source":
      return aarch64SymbolId(`optir.source.${String(target.functionInstanceId)}`);
    case "runtime":
      return aarch64SymbolId(`runtime.${target.runtimeKey}`);
    case "intrinsic":
      return aarch64SymbolId(`intrinsic.${target.intrinsicKey}`);
    case "externalUnknown":
      return aarch64SymbolId(target.symbol);
    case "platform":
      return undefined;
  }
}

export function opcodeForIntegerBinary(operation: OperationOf<"integerBinary">): string {
  return opcodeForAArch64IntegerBinary(operation.operator, operation.resultTypes[0]);
}

export function conditionForCompareOperator(
  operator: OperationOf<"integerCompare">["operator"],
): bigint {
  switch (operator) {
    case "equal":
      return 0n;
    case "notEqual":
      return 1n;
    case "unsignedLessThan":
      return 3n;
    case "unsignedLessThanOrEqual":
      return 8n;
    case "signedLessThan":
      return 5n;
    case "signedLessThanOrEqual":
      return 6n;
  }
}

export function patternIdForOperation(operation: OptIrOperation): string {
  return `optir.${operation.kind}.aarch64-materialized`;
}

export function selectionTierForOperation(
  operation: OptIrOperation,
): AArch64LoweringSelectionRecord["tier"] {
  if (operation.kind.startsWith("semantic")) return "semantic";
  if (operation.kind.startsWith("vector") || operation.kind === "fpNumeric") return "helper";
  return "local";
}

export function issueClassForOpcode(opcode: string): AArch64IssueClass {
  if (opcode.startsWith("ldr") || opcode === "ldar" || opcode === "ld1") return "load";
  if (opcode.startsWith("ldadd")) return "load";
  if (opcode.startsWith("str") || opcode === "stlr" || opcode === "st1") return "store";
  if (opcode === "dmb" || opcode === "dsb") return "barrier";
  if (opcode === "blr" || opcode === "bl" || opcode === "b" || opcode === "ret") return "branch";
  if (opcode === "fmadd" || opcode === "fcvt-fp16") return "fp";
  if (
    opcode === "tbl" ||
    opcode === "tbx" ||
    opcode === "cmeq" ||
    opcode === "bsl" ||
    opcode === "fmla" ||
    opcode === "sqrdmulh" ||
    opcode === "sqrdmlah" ||
    opcode === "sqadd-saturating" ||
    opcode === "movi" ||
    opcode === "mov-vector" ||
    opcode === "vector-rev" ||
    opcode === "pmull" ||
    opcode === "aes-sha-round" ||
    opcode === "dotprod"
  ) {
    return "vector";
  }
  return "integer";
}

const AARCH64_MEMORY_ORDERS = new Set<string>([
  "relaxed",
  "acquire",
  "release",
  "acquireRelease",
  "sequentiallyConsistent",
  "deviceOrdered",
  "compilerOnlyOrdered",
]);

function machineIntegerWidth(width: number): 1 | 8 | 16 | 32 | 64 {
  if (width <= 1) return 1;
  if (width <= 8) return 8;
  if (width <= 16) return 16;
  if (width <= 32) return 32;
  return 64;
}

function scalarMachineTypeForOptIrType(
  type: Exclude<OptIrType, { readonly kind: "vector" } | { readonly kind: "vectorMask" }>,
): Exclude<AArch64MachineType, { readonly kind: "vector" }> {
  const machineType = machineTypeForOptIrType(type);
  return machineType.kind === "vector" ? GPR64 : machineType;
}

function laneWidthForRegisterClass(
  type: Exclude<AArch64MachineType, { readonly kind: "vector" }>,
): number {
  switch (type.kind) {
    case "integer":
    case "float":
      return type.width;
    case "pointer":
      return 64;
    case "token":
    case "resourceToken":
      return 1;
  }
}
