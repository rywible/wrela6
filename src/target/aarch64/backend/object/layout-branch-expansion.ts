import {
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
  aarch64BackendDiagnostic,
} from "../api/diagnostics";
import type { AArch64PhysicalRegisterModel } from "../api/backend-catalog-interfaces";
import type { AArch64LayoutPhysicalInstruction } from "./layout-encode-fixed-point";
import { writeU32Le } from "./encoding-core";

type ExpandedBranchEncoding = {
  readonly bytes: Uint8Array;
  readonly relocationHole: {
    readonly family: string;
    readonly patchOffsetBytes: number;
    readonly bitRange: readonly [number, number];
    readonly target: string;
  };
};

export function encodeExpandedInvertAndBranch(
  instruction: AArch64LayoutPhysicalInstruction,
  registerModel: AArch64PhysicalRegisterModel,
): AArch64BackendResult<ExpandedBranchEncoding> {
  const siteKey = instruction.siteKey ?? instruction.stableKey;
  if (instruction.branch?.kind === "b-cond") return encodeExpandedConditionalBranch(instruction);
  if (instruction.branch?.kind === "cbz" || instruction.branch?.kind === "cbnz") {
    return encodeExpandedCompareAndBranch(instruction, registerModel);
  }
  return backendError([
    diagnostic(
      `layout-fixed-point:unsupported-branch-expansion:${siteKey}:${instruction.branch?.kind ?? "missing"}`,
    ),
  ]);
}

export function encodeExpandedTestAndBranch(
  instruction: AArch64LayoutPhysicalInstruction,
  registerModel: AArch64PhysicalRegisterModel,
): AArch64BackendResult<ExpandedBranchEncoding> {
  const siteKey = instruction.siteKey ?? instruction.stableKey;
  const branch = instruction.branch;
  if (branch === undefined || (branch.kind !== "tbz" && branch.kind !== "tbnz")) {
    return backendError([
      diagnostic(
        `layout-fixed-point:unsupported-branch-expansion:${siteKey}:${branch?.kind ?? "missing"}`,
      ),
    ]);
  }
  const [register, bitIndex] = instruction.operands;
  if (register?.kind !== "register" || bitIndex?.kind !== "immediate") {
    return backendError([diagnostic(`layout-fixed-point:missing-test-branch-operands:${siteKey}`)]);
  }
  const word = testAndBranchWord({
    opcode: branch.kind === "tbz" ? "tbnz" : "tbz",
    register: register.register,
    bitIndex: bitIndex.value,
    registerModel,
    immediateInstructions: 2,
  });
  if (word.kind === "error") return backendError([diagnostic(word.stableDetail(siteKey))]);
  return backendOk(expandedBranchEncoding(word.value, branch.targetKey));
}

function encodeExpandedConditionalBranch(
  instruction: AArch64LayoutPhysicalInstruction,
): AArch64BackendResult<ExpandedBranchEncoding> {
  const siteKey = instruction.siteKey ?? instruction.stableKey;
  if (instruction.branch?.kind !== "b-cond") {
    return backendError([
      diagnostic(
        `layout-fixed-point:unsupported-branch-expansion:${siteKey}:${instruction.branch?.kind ?? "missing"}`,
      ),
    ]);
  }
  const condition = instruction.operands.find((operand) => operand.kind === "condition");
  if (condition?.kind !== "condition") {
    return backendError([diagnostic(`layout-fixed-point:missing-branch-condition:${siteKey}`)]);
  }
  const invertedCondition = invertedConditionCode(condition.condition);
  if (invertedCondition === undefined) {
    return backendError([
      diagnostic(
        `layout-fixed-point:unsupported-branch-condition:${siteKey}:${condition.condition}`,
      ),
    ]);
  }
  const target = instruction.branch.targetKey;
  return backendOk({
    bytes: concatBytes(
      writeU32Le(0x54000000 | (2 << 5) | invertedCondition),
      writeU32Le(0x14000000),
    ),
    relocationHole: {
      family: "branch26",
      patchOffsetBytes: 4,
      bitRange: [0, 25],
      target,
    },
  });
}

function encodeExpandedCompareAndBranch(
  instruction: AArch64LayoutPhysicalInstruction,
  registerModel: AArch64PhysicalRegisterModel,
): AArch64BackendResult<ExpandedBranchEncoding> {
  const siteKey = instruction.siteKey ?? instruction.stableKey;
  const branch = instruction.branch;
  if (branch === undefined || (branch.kind !== "cbz" && branch.kind !== "cbnz")) {
    return backendError([
      diagnostic(
        `layout-fixed-point:unsupported-branch-expansion:${siteKey}:${branch?.kind ?? "missing"}`,
      ),
    ]);
  }
  const register = instruction.operands[0];
  if (register?.kind !== "register") {
    return backendError([
      diagnostic(`layout-fixed-point:missing-compare-branch-register:${siteKey}`),
    ]);
  }
  const word = compareAndBranchWord({
    opcode: branch.kind === "cbz" ? "cbnz" : "cbz",
    register: register.register,
    registerModel,
    immediateInstructions: 2,
  });
  if (word.kind === "error") return backendError([diagnostic(word.stableDetail(siteKey))]);
  return backendOk(expandedBranchEncoding(word.value, branch.targetKey));
}

function expandedBranchEncoding(skipBranchWord: number, target: string): ExpandedBranchEncoding {
  return {
    bytes: concatBytes(writeU32Le(skipBranchWord), writeU32Le(0x14000000)),
    relocationHole: {
      family: "branch26",
      patchOffsetBytes: 4,
      bitRange: [0, 25],
      target,
    },
  };
}

function compareAndBranchWord(input: {
  readonly opcode: "cbz" | "cbnz";
  readonly register: string;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly immediateInstructions: number;
}):
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "error"; readonly stableDetail: (siteKey: string) => string } {
  const width = branchRegisterWidth(input.register);
  const registerNumber = input.registerModel.encodingNumberOf(input.register);
  if (width === undefined || registerNumber < 0 || registerNumber > 30) {
    return {
      kind: "error",
      stableDetail: (siteKey) =>
        `layout-fixed-point:illegal-branch-register:${siteKey}:${input.register}`,
    };
  }
  const baseWord =
    (input.opcode === "cbnz" ? 0x35000000 : 0x34000000) | (width === 64 ? 0x80000000 : 0);
  return {
    kind: "ok",
    value: baseWord | (input.immediateInstructions << 5) | registerNumber,
  };
}

function testAndBranchWord(input: {
  readonly opcode: "tbz" | "tbnz";
  readonly register: string;
  readonly bitIndex: bigint;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly immediateInstructions: number;
}):
  | { readonly kind: "ok"; readonly value: number }
  | { readonly kind: "error"; readonly stableDetail: (siteKey: string) => string } {
  const width = branchRegisterWidth(input.register);
  const registerNumber = input.registerModel.encodingNumberOf(input.register);
  if (width === undefined || registerNumber < 0 || registerNumber > 30) {
    return {
      kind: "error",
      stableDetail: (siteKey) =>
        `layout-fixed-point:illegal-branch-register:${siteKey}:${input.register}`,
    };
  }
  if (input.bitIndex < 0n || input.bitIndex > 63n) {
    return {
      kind: "error",
      stableDetail: (siteKey) =>
        `layout-fixed-point:test-branch-bit-out-of-range:${siteKey}:${input.bitIndex.toString()}`,
    };
  }
  if (width === 32 && input.bitIndex > 31n) {
    return {
      kind: "error",
      stableDetail: (siteKey) =>
        `layout-fixed-point:test-branch-bit-width-mismatch:${siteKey}:${input.register}:${input.bitIndex.toString()}`,
    };
  }
  const bit = Number(input.bitIndex);
  const baseWord = input.opcode === "tbnz" ? 0x37000000 : 0x36000000;
  return {
    kind: "ok",
    value:
      baseWord |
      ((bit >> 5) << 31) |
      ((bit & 31) << 19) |
      (input.immediateInstructions << 5) |
      registerNumber,
  };
}

function branchRegisterWidth(register: string): 32 | 64 | undefined {
  if (/^w(?:[0-9]|[12][0-9]|30|zr)$/.test(register)) return 32;
  if (/^x(?:[0-9]|[12][0-9]|30|zr)$/.test(register)) return 64;
  return undefined;
}

function invertedConditionCode(condition: string): number | undefined {
  const code = conditionCode(condition);
  if (code === undefined || code >= 14) return undefined;
  return code ^ 1;
}

function conditionCode(condition: string): number | undefined {
  const codes = new Map<string, number>([
    ["eq", 0],
    ["ne", 1],
    ["cs", 2],
    ["hs", 2],
    ["cc", 3],
    ["lo", 3],
    ["mi", 4],
    ["pl", 5],
    ["vs", 6],
    ["vc", 7],
    ["hi", 8],
    ["ls", 9],
    ["ge", 10],
    ["lt", 11],
    ["gt", 12],
    ["le", 13],
    ["al", 14],
    ["nv", 15],
  ]);
  return codes.get(condition);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const output = new Uint8Array(left.length + right.length);
  output.set(left, 0);
  output.set(right, left.length);
  return output;
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
    stableDetail,
    ownerKey: "layout-fixed-point",
    rootCauseKey: stableDetail,
  });
}
