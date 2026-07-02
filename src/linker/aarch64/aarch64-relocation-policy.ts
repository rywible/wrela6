import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { type AArch64InternalRelocationFamily } from "../../target/aarch64/backend/object/relocation-records";

export {
  expectedAArch64RelocationWidthBytes,
  isAArch64InstructionRelocationFamily,
} from "../../target/aarch64/backend/object/relocation-records";

export interface AArch64RelocationFieldSlice {
  readonly encodedValueStartBit: number;
  readonly instructionStartBit: number;
  readonly bitCount: number;
}

export interface AArch64LinkRelocationBounds {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly unit:
    | "bytes"
    | "pages"
    | "low12"
    | "encoded-low12"
    | "unsigned-absolute"
    | "unsigned-rva"
    | "section-offset";
  readonly scaleBytes?: number;
  readonly requiresDivisibleBy?: number;
  readonly rejectedInV1?: boolean;
}

export const AARCH64_RELOCATION_FIELD_SLICES = Object.freeze({
  branch26: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 0, bitCount: 26 }),
  ]),
  branch19: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 19 }),
  ]),
  branch14: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 14 }),
  ]),
  "pagebase-rel21": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 29, bitCount: 2 }),
    Object.freeze({ encodedValueStartBit: 2, instructionStartBit: 5, bitCount: 19 }),
  ]),
  "pageoffset-12a": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }),
  ]),
  "pageoffset-12l": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }),
  ]),
} satisfies Partial<
  Record<AArch64InternalRelocationFamily, readonly AArch64RelocationFieldSlice[]>
>);

export const AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED = false;

export const AARCH64_LINK_RELOCATION_BOUNDS = Object.freeze({
  branch26: Object.freeze({
    minimum: -134217728n,
    maximum: 134217724n,
    unit: "bytes",
    requiresDivisibleBy: 4,
  }),
  branch19: Object.freeze({
    minimum: -1048576n,
    maximum: 1048572n,
    unit: "bytes",
    requiresDivisibleBy: 4,
  }),
  branch14: Object.freeze({
    minimum: -32768n,
    maximum: 32764n,
    unit: "bytes",
    requiresDivisibleBy: 4,
  }),
  "pagebase-rel21": Object.freeze({
    minimum: -1048576n,
    maximum: 1048575n,
    unit: "pages",
    scaleBytes: 4096,
  }),
  "pageoffset-12a": Object.freeze({
    minimum: 0n,
    maximum: 4095n,
    unit: "low12",
  }),
  "pageoffset-12l": Object.freeze({
    minimum: 0n,
    maximum: 4095n,
    unit: "encoded-low12",
  }),
  addr64: Object.freeze({
    minimum: 0n,
    maximum: 18446744073709551615n,
    unit: "unsigned-absolute",
  }),
  addr32: Object.freeze({
    minimum: 0n,
    maximum: 4294967295n,
    unit: "unsigned-absolute",
    rejectedInV1: true,
  }),
  addr32nb: Object.freeze({
    minimum: 0n,
    maximum: 4294967295n,
    unit: "unsigned-rva",
  }),
  rel32: Object.freeze({
    minimum: -2147483648n,
    maximum: 2147483647n,
    unit: "bytes",
  }),
  "section-relative": Object.freeze({
    minimum: 0n,
    maximum: 4294967295n,
    unit: "section-offset",
  }),
} satisfies Record<AArch64InternalRelocationFamily, AArch64LinkRelocationBounds>);

export const AARCH64_REQUIRED_LINK_RELOCATION_FAMILIES = Object.freeze(
  (Object.keys(AARCH64_LINK_RELOCATION_BOUNDS) as AArch64InternalRelocationFamily[]).sort(
    compareCodeUnitStrings,
  ),
);

export const AARCH64_PRODUCTION_RELOCATION_FAMILIES = Object.freeze([
  Object.freeze({ family: "branch26", bounds: AARCH64_LINK_RELOCATION_BOUNDS.branch26 }),
  Object.freeze({ family: "branch19", bounds: AARCH64_LINK_RELOCATION_BOUNDS.branch19 }),
  Object.freeze({ family: "branch14", bounds: AARCH64_LINK_RELOCATION_BOUNDS.branch14 }),
  Object.freeze({
    family: "pagebase-rel21",
    bounds: AARCH64_LINK_RELOCATION_BOUNDS["pagebase-rel21"],
    fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pagebase-rel21"],
  }),
  Object.freeze({
    family: "pageoffset-12a",
    bounds: AARCH64_LINK_RELOCATION_BOUNDS["pageoffset-12a"],
    fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pageoffset-12a"],
  }),
  Object.freeze({
    family: "pageoffset-12l",
    bounds: AARCH64_LINK_RELOCATION_BOUNDS["pageoffset-12l"],
    fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pageoffset-12l"],
  }),
  Object.freeze({ family: "addr64", bounds: AARCH64_LINK_RELOCATION_BOUNDS.addr64 }),
  Object.freeze({
    family: "addr32",
    bounds: AARCH64_LINK_RELOCATION_BOUNDS.addr32,
    allowAbsoluteForV1: AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED,
  }),
  Object.freeze({ family: "addr32nb", bounds: AARCH64_LINK_RELOCATION_BOUNDS.addr32nb }),
  Object.freeze({ family: "rel32", bounds: AARCH64_LINK_RELOCATION_BOUNDS.rel32 }),
  Object.freeze({
    family: "section-relative",
    bounds: AARCH64_LINK_RELOCATION_BOUNDS["section-relative"],
  }),
]);
