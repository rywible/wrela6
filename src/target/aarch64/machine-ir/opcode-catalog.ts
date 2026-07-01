import { aarch64PatternId, type AArch64PatternId } from "./ids";
import type { AArch64RegisterClass } from "./machine-types";
import type { AArch64InstructionOperandRole } from "./operands";
import type { AArch64MachineResource } from "./resources";

export type AArch64OpcodeFormId = string & { readonly __brand: "AArch64OpcodeFormId" };

export type AArch64ProfileFeature =
  | "BASE_A64"
  | "FEAT_LSE"
  | "FEAT_CRC32"
  | "FEAT_AdvSIMD"
  | "FEAT_FP"
  | "FEAT_AES"
  | "FEAT_SHA"
  | "FEAT_PMULL"
  | "FEAT_FP16"
  | "FEAT_RDM"
  | "FEAT_DotProd";

export type AArch64ImmediateKind =
  | "condition"
  | "nzcvImmediate"
  | "bitIndex64"
  | "shift6"
  | "moveWideShift"
  | "pageOffset12"
  | "unsignedMemoryOffset12"
  | "signedPairOffset7";

export interface AArch64OpcodeOperandSchema {
  readonly role: AArch64InstructionOperandRole;
  readonly operandKind?: "vreg" | "resource" | "immediate" | "frameObject" | "symbol" | "block";
  readonly registerClass?: AArch64RegisterClass;
  readonly registerClasses?: readonly AArch64RegisterClass[];
  readonly immediateKind?: AArch64ImmediateKind;
  readonly optional?: boolean;
}

export interface AArch64OpcodeForm {
  readonly id: AArch64OpcodeFormId;
  readonly mnemonic: string;
  readonly operandSchema: readonly AArch64OpcodeOperandSchema[];
  readonly implicitResources: readonly {
    readonly role: Extract<AArch64InstructionOperandRole, "implicitDef" | "implicitUse">;
    readonly resource: AArch64MachineResource;
  }[];
  readonly immediateBits?: number;
  readonly memoryShape?: "none" | "unsignedImmediate" | "signedPair" | "barrier" | "atomic";
  readonly requiredFeatures: readonly AArch64ProfileFeature[];
  readonly excludedErrata: readonly string[];
  readonly interpreterSemanticKey: string;
  readonly patternId: AArch64PatternId;
}

const VREG_DEF = Object.freeze({ role: "def" as const, operandKind: "vreg" as const });
const VREG_USE = Object.freeze({ role: "use" as const, operandKind: "vreg" as const });
const GPR_DEF = Object.freeze({
  role: "def" as const,
  operandKind: "vreg" as const,
  registerClasses: ["gpr32", "gpr64"] as const,
});
const GPR_USE = Object.freeze({
  role: "use" as const,
  operandKind: "vreg" as const,
  registerClasses: ["gpr32", "gpr64"] as const,
});
const GPR_TIED_DEF_USE = Object.freeze({
  role: "tiedDefUse" as const,
  operandKind: "vreg" as const,
  registerClasses: ["gpr32", "gpr64"] as const,
});
const GPR_MEMORY_BASE = Object.freeze({
  role: "memoryBase" as const,
  registerClass: "gpr64" as const,
});
const GPR_MEMORY_INDEX = Object.freeze({
  role: "memoryIndex" as const,
  registerClass: "gpr64" as const,
});
const BRANCH_TARGET = Object.freeze({
  role: "branchTarget" as const,
  operandKind: "block" as const,
});
const VECTOR128_DEF = Object.freeze({
  role: "def" as const,
  operandKind: "vreg" as const,
  registerClass: "vector128" as const,
});
const VECTOR128_USE = Object.freeze({
  role: "use" as const,
  operandKind: "vreg" as const,
  registerClass: "vector128" as const,
});
const FP_SCALAR_DEF = Object.freeze({
  role: "def" as const,
  operandKind: "vreg" as const,
  registerClass: "fpScalar" as const,
});
const FP_SCALAR_USE = Object.freeze({
  role: "use" as const,
  operandKind: "vreg" as const,
  registerClass: "fpScalar" as const,
});
const VECTOR_DEF = Object.freeze({
  role: "def" as const,
  operandKind: "vreg" as const,
  registerClasses: ["vector64", "vector128"] as const,
});
const VECTOR_USE = Object.freeze({
  role: "use" as const,
  operandKind: "vreg" as const,
  registerClasses: ["vector64", "vector128"] as const,
});
const CALL_ARG_USES = [
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
  { role: "use", operandKind: "vreg", optional: true },
] as const;
const CALL_CLOBBER_IMPLICIT_DEFS = [
  { role: "implicitDef", resource: { kind: "NZCV" as const } },
  { role: "implicitDef", resource: { kind: "FPCR" as const } },
  { role: "implicitDef", resource: { kind: "FPSR" as const } },
  { role: "implicitDef", resource: { kind: "vectorState" as const } },
] as const;

function form(input: {
  readonly id: string;
  readonly operandSchema?: readonly AArch64OpcodeOperandSchema[];
  readonly implicitResources?: AArch64OpcodeForm["implicitResources"];
  readonly immediateBits?: number;
  readonly memoryShape?: AArch64OpcodeForm["memoryShape"];
  readonly requiredFeatures?: readonly AArch64ProfileFeature[];
  readonly excludedErrata?: readonly string[];
  readonly interpreterSemanticKey?: string;
}): AArch64OpcodeForm {
  const id = aarch64OpcodeFormId(input.id);
  return Object.freeze({
    id,
    mnemonic: input.id,
    operandSchema: Object.freeze(
      (input.operandSchema ?? []).map((entry) =>
        Object.freeze({
          ...entry,
          ...(entry.registerClasses === undefined
            ? {}
            : { registerClasses: Object.freeze([...entry.registerClasses]) }),
        }),
      ),
    ),
    implicitResources: Object.freeze(
      (input.implicitResources ?? []).map((entry) =>
        Object.freeze({ ...entry, resource: Object.freeze({ ...entry.resource }) }),
      ),
    ),
    ...(input.immediateBits === undefined ? {} : { immediateBits: input.immediateBits }),
    ...(input.memoryShape === undefined ? {} : { memoryShape: input.memoryShape }),
    requiredFeatures: Object.freeze([...(input.requiredFeatures ?? ["BASE_A64"])]),
    excludedErrata: Object.freeze([...(input.excludedErrata ?? [])]),
    interpreterSemanticKey: input.interpreterSemanticKey ?? input.id,
    patternId: aarch64PatternId(`opcode.${input.id}`),
  });
}

export const AARCH64_OPCODE_FORMS = Object.freeze([
  form({
    id: "movz",
    operandSchema: [
      GPR_DEF,
      { role: "use", operandKind: "immediate" },
      { role: "use", operandKind: "immediate", immediateKind: "moveWideShift", optional: true },
    ],
    immediateBits: 16,
  }),
  form({
    id: "movk",
    operandSchema: [
      GPR_TIED_DEF_USE,
      { role: "use", operandKind: "immediate" },
      { role: "use", operandKind: "immediate", immediateKind: "moveWideShift", optional: true },
    ],
    immediateBits: 16,
  }),
  form({
    id: "movn",
    operandSchema: [
      GPR_DEF,
      { role: "use", operandKind: "immediate" },
      { role: "use", operandKind: "immediate", immediateKind: "moveWideShift", optional: true },
    ],
    immediateBits: 16,
  }),
  form({
    id: "movi",
    operandSchema: [VECTOR_DEF, { role: "use", operandKind: "immediate" }],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "mov-vector",
    operandSchema: [VECTOR_DEF, VECTOR_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "add-immediate",
    operandSchema: [GPR_DEF, GPR_USE, { role: "use", operandKind: "immediate" }],
    immediateBits: 12,
  }),
  form({
    id: "frame-address",
    operandSchema: [GPR_DEF, GPR_MEMORY_BASE, { role: "use", operandKind: "immediate" }],
  }),
  form({ id: "add-shifted-register", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "sub-shifted-register", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({
    id: "sub-immediate",
    operandSchema: [GPR_DEF, GPR_USE, { role: "use", operandKind: "immediate" }],
    immediateBits: 12,
  }),
  form({
    id: "and-logical-immediate",
    operandSchema: [GPR_DEF, GPR_USE, { role: "use", operandKind: "immediate" }],
  }),
  form({ id: "and-shifted-register", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({
    id: "orr-logical-immediate",
    operandSchema: [GPR_DEF, GPR_USE, { role: "use", operandKind: "immediate" }],
  }),
  form({ id: "orr-shifted-register", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({
    id: "eor-logical-immediate",
    operandSchema: [GPR_DEF, GPR_USE, { role: "use", operandKind: "immediate" }],
  }),
  form({ id: "eor-shifted-register", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "mul", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "udiv", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "sdiv", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "lsl", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({
    id: "lsl-immediate",
    operandSchema: [
      GPR_DEF,
      GPR_USE,
      { role: "use", operandKind: "immediate", immediateKind: "shift6" },
    ],
  }),
  form({ id: "lsr", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({ id: "asr", operandSchema: [GPR_DEF, GPR_USE, GPR_USE] }),
  form({
    id: "cmp-shifted-register",
    operandSchema: [GPR_USE, GPR_USE, { role: "implicitDef" }],
    implicitResources: [{ role: "implicitDef", resource: { kind: "NZCV" } }],
  }),
  form({
    id: "cset",
    operandSchema: [
      GPR_DEF,
      { role: "implicitUse" },
      { role: "use", operandKind: "immediate", immediateKind: "condition" },
    ],
    implicitResources: [{ role: "implicitUse", resource: { kind: "NZCV" } }],
  }),
  form({
    id: "csel",
    operandSchema: [
      GPR_DEF,
      GPR_USE,
      GPR_USE,
      { role: "implicitUse" },
      { role: "use", operandKind: "immediate", immediateKind: "condition" },
    ],
    implicitResources: [{ role: "implicitUse", resource: { kind: "NZCV" } }],
  }),
  form({
    id: "ccmp",
    operandSchema: [
      GPR_USE,
      GPR_USE,
      { role: "use", operandKind: "immediate", immediateKind: "nzcvImmediate" },
      { role: "implicitDef" },
      { role: "implicitUse" },
      { role: "use", operandKind: "immediate", immediateKind: "condition" },
    ],
    implicitResources: [
      { role: "implicitDef", resource: { kind: "NZCV" } },
      { role: "implicitUse", resource: { kind: "NZCV" } },
    ],
  }),
  form({ id: "cbz", operandSchema: [GPR_USE, BRANCH_TARGET] }),
  form({ id: "cbnz", operandSchema: [GPR_USE, BRANCH_TARGET] }),
  form({
    id: "tbz",
    operandSchema: [
      GPR_USE,
      { role: "use", operandKind: "immediate", immediateKind: "bitIndex64" },
      BRANCH_TARGET,
    ],
  }),
  form({
    id: "ldr-unsigned-immediate",
    operandSchema: [
      GPR_DEF,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "unsignedMemoryOffset12",
        optional: true,
      },
    ],
    memoryShape: "unsignedImmediate",
  }),
  form({
    id: "ldr-register-offset",
    operandSchema: [GPR_DEF, GPR_MEMORY_BASE, GPR_MEMORY_INDEX],
    memoryShape: "unsignedImmediate",
  }),
  form({
    id: "str-unsigned-immediate",
    operandSchema: [
      GPR_USE,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "unsignedMemoryOffset12",
        optional: true,
      },
    ],
    memoryShape: "unsignedImmediate",
  }),
  form({
    id: "ldp-signed-offset",
    operandSchema: [
      GPR_DEF,
      GPR_DEF,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "signedPairOffset7",
        optional: true,
      },
    ],
    memoryShape: "signedPair",
  }),
  form({
    id: "stp-signed-offset",
    operandSchema: [
      GPR_USE,
      GPR_USE,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "signedPairOffset7",
        optional: true,
      },
    ],
    memoryShape: "signedPair",
  }),
  form({ id: "rev", operandSchema: [VREG_DEF, VREG_USE] }),
  form({ id: "rev16", operandSchema: [VREG_DEF, VREG_USE] }),
  form({ id: "rev32", operandSchema: [VREG_DEF, VREG_USE] }),
  form({
    id: "vector-rev",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({ id: "adrp", operandSchema: [GPR_DEF, { role: "use", operandKind: "symbol" }] }),
  form({
    id: "add-pageoff",
    operandSchema: [
      GPR_DEF,
      GPR_USE,
      { role: "use", operandKind: "immediate", immediateKind: "pageOffset12" },
      { role: "use", operandKind: "symbol" },
    ],
  }),
  form({
    id: "bl",
    operandSchema: [
      { role: "use", operandKind: "symbol" },
      ...CALL_CLOBBER_IMPLICIT_DEFS,
      ...CALL_ARG_USES,
    ],
    implicitResources: CALL_CLOBBER_IMPLICIT_DEFS,
  }),
  form({
    id: "blr",
    operandSchema: [GPR_USE, ...CALL_CLOBBER_IMPLICIT_DEFS, ...CALL_ARG_USES],
    implicitResources: CALL_CLOBBER_IMPLICIT_DEFS,
  }),
  form({ id: "b", operandSchema: [BRANCH_TARGET] }),
  form({
    id: "b-cond",
    operandSchema: [
      { role: "implicitUse" },
      BRANCH_TARGET,
      { role: "use", operandKind: "immediate", immediateKind: "condition" },
    ],
    implicitResources: [{ role: "implicitUse", resource: { kind: "NZCV" } }],
  }),
  form({ id: "ret", operandSchema: [{ role: "use", operandKind: "vreg", optional: true }] }),
  form({ id: "br", operandSchema: [GPR_USE] }),
  form({ id: "trap", operandSchema: [] }),
  form({ id: "dmb", operandSchema: [], memoryShape: "barrier" }),
  form({ id: "dsb", operandSchema: [], memoryShape: "barrier" }),
  form({
    id: "ldar",
    operandSchema: [GPR_DEF, GPR_MEMORY_BASE],
    memoryShape: "atomic",
  }),
  form({
    id: "stlr",
    operandSchema: [GPR_USE, GPR_MEMORY_BASE],
    memoryShape: "atomic",
  }),
  form({
    id: "ldadd",
    operandSchema: [GPR_USE, GPR_DEF, GPR_MEMORY_BASE],
    memoryShape: "atomic",
    requiredFeatures: ["BASE_A64", "FEAT_LSE"],
  }),
  form({
    id: "ldadda",
    operandSchema: [GPR_USE, GPR_DEF, GPR_MEMORY_BASE],
    memoryShape: "atomic",
    requiredFeatures: ["BASE_A64", "FEAT_LSE"],
  }),
  form({
    id: "ldaddl",
    operandSchema: [GPR_USE, GPR_DEF, GPR_MEMORY_BASE],
    memoryShape: "atomic",
    requiredFeatures: ["BASE_A64", "FEAT_LSE"],
  }),
  form({
    id: "ldaddal",
    operandSchema: [GPR_USE, GPR_DEF, GPR_MEMORY_BASE],
    memoryShape: "atomic",
    requiredFeatures: ["BASE_A64", "FEAT_LSE"],
  }),
  form({
    id: "prfm",
    operandSchema: [
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "unsignedMemoryOffset12",
        optional: true,
      },
    ],
    memoryShape: "unsignedImmediate",
  }),
  form({
    id: "ld1",
    operandSchema: [
      VECTOR128_DEF,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "unsignedMemoryOffset12",
        optional: true,
      },
    ],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "st1",
    operandSchema: [
      VECTOR128_USE,
      GPR_MEMORY_BASE,
      {
        role: "use",
        operandKind: "immediate",
        immediateKind: "unsignedMemoryOffset12",
        optional: true,
      },
    ],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "tbl",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "tbx",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "cmeq",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "bsl",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "crc32",
    operandSchema: [GPR_DEF, GPR_USE, GPR_USE],
    requiredFeatures: ["BASE_A64", "FEAT_CRC32"],
  }),
  form({
    id: "pmull",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_PMULL"],
  }),
  form({
    id: "aes-sha-round",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AES", "FEAT_SHA"],
  }),
  form({
    id: "fmadd",
    operandSchema: [
      FP_SCALAR_DEF,
      FP_SCALAR_USE,
      FP_SCALAR_USE,
      FP_SCALAR_USE,
      { role: "implicitUse" },
      { role: "implicitDef" },
    ],
    implicitResources: [
      { role: "implicitUse", resource: { kind: "FPCR" } },
      { role: "implicitDef", resource: { kind: "FPSR" } },
    ],
    requiredFeatures: ["BASE_A64", "FEAT_FP"],
  }),
  form({
    id: "fmla",
    operandSchema: [
      VECTOR_DEF,
      VECTOR_USE,
      VECTOR_USE,
      VECTOR_USE,
      { role: "implicitUse" },
      { role: "implicitDef" },
    ],
    implicitResources: [
      { role: "implicitUse", resource: { kind: "FPCR" } },
      { role: "implicitDef", resource: { kind: "FPSR" } },
    ],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD", "FEAT_FP"],
  }),
  form({
    id: "fcvt-fp16",
    operandSchema: [FP_SCALAR_DEF, FP_SCALAR_USE, { role: "implicitUse" }, { role: "implicitDef" }],
    implicitResources: [
      { role: "implicitUse", resource: { kind: "FPCR" } },
      { role: "implicitDef", resource: { kind: "FPSR" } },
    ],
    requiredFeatures: ["BASE_A64", "FEAT_FP", "FEAT_FP16"],
  }),
  form({
    id: "sqrdmulh",
    operandSchema: [VECTOR_DEF, VECTOR_USE, VECTOR_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD", "FEAT_RDM"],
  }),
  form({
    id: "sqrdmlah",
    operandSchema: [VECTOR_DEF, VECTOR_USE, VECTOR_USE, VECTOR_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD", "FEAT_RDM"],
  }),
  form({
    id: "sqadd-saturating",
    operandSchema: [VECTOR_DEF, VECTOR_USE, VECTOR_USE],
    requiredFeatures: ["BASE_A64", "FEAT_AdvSIMD"],
  }),
  form({
    id: "dotprod",
    operandSchema: [VECTOR128_DEF, VECTOR128_USE, VECTOR128_USE],
    requiredFeatures: ["BASE_A64", "FEAT_DotProd"],
  }),
] satisfies readonly AArch64OpcodeForm[]);

const AARCH64_OPCODE_BY_ID = new Map<AArch64OpcodeFormId, AArch64OpcodeForm>(
  AARCH64_OPCODE_FORMS.map((entry) => [entry.id, entry]),
);

export function aarch64OpcodeFormId(value: string): AArch64OpcodeFormId {
  if (value.length === 0) {
    throw new RangeError("AArch64OpcodeFormId must be non-empty.");
  }
  return value as AArch64OpcodeFormId;
}

export function aarch64OpcodeFormById(id: AArch64OpcodeFormId): AArch64OpcodeForm {
  const formRecord = AARCH64_OPCODE_BY_ID.get(id);
  if (formRecord === undefined) {
    throw new RangeError(`Unknown AArch64 opcode form: ${id}.`);
  }
  return formRecord;
}

export function aarch64ImmediateValueMatchesKind(
  kind: AArch64ImmediateKind,
  value: bigint,
): boolean {
  switch (kind) {
    case "condition":
    case "nzcvImmediate":
      return value >= 0n && value <= 15n;
    case "bitIndex64":
    case "shift6":
      return value >= 0n && value <= 63n;
    case "moveWideShift":
      return value === 0n || value === 16n || value === 32n || value === 48n;
    case "pageOffset12":
      return value >= 0n && value <= 4095n;
    case "unsignedMemoryOffset12":
      return value >= 0n && value <= 4095n * 16n;
    case "signedPairOffset7":
      return value >= -512n && value <= 504n && value % 8n === 0n;
  }
}
