import {
  AARCH64_LINK_RELOCATION_BOUNDS,
  AARCH64_RELOCATION_FIELD_SLICES,
  AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED,
  type AArch64RelocationFieldSlice,
} from "./aarch64-relocation-policy";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
} from "../diagnostics";
import type { AArch64InternalRelocationFamily } from "../../target/aarch64/backend/object/relocation-records";
import { wordToU32Le, writeU32Le } from "../../target/aarch64/backend/object/encoding-core";

export interface AArch64RelocationValueInput {
  readonly family: AArch64InternalRelocationFamily;
  readonly relocationKey: string;
  readonly symbolRva: bigint;
  readonly patchRva: bigint;
  readonly addend: bigint;
  readonly preferredImageBase: bigint;
  readonly containingSectionRva?: bigint;
  readonly accessScaleBytes?: number;
  readonly allowAddr32AbsoluteForTest?: boolean;
}

export interface AArch64RelocationValueResult {
  readonly encodedValue: bigint;
  readonly unscaledValue: bigint;
}

export interface AArch64InstructionRelocationPatchInput extends AArch64RelocationValueInput {
  readonly originalBytes: readonly number[];
  readonly bitRange: readonly [number, number];
  readonly fieldSlices?: readonly AArch64RelocationFieldSlice[];
}

export interface AArch64InstructionRelocationPatchResult extends AArch64RelocationValueResult {
  readonly patchedBytes: readonly number[];
}

const OK_VERIFICATION = Object.freeze({ runs: Object.freeze([]) });
const PAGE_SIZE_BYTES = 4096n;

export function encodeAArch64RelocationValue(
  input: AArch64RelocationValueInput,
): LinkerResult<AArch64RelocationValueResult> {
  const value = unscaledRelocationValue(input);
  if (value.kind === "error") return value;

  const encoded = encodedRelocationValue(input, value.value);
  if (encoded.kind === "error") return encoded;

  return linkerOk({
    value: Object.freeze({
      encodedValue: encoded.value,
      unscaledValue: value.value,
    }),
    verification: OK_VERIFICATION,
  });
}

export function patchAArch64InstructionRelocation(
  input: AArch64InstructionRelocationPatchInput,
): LinkerResult<AArch64InstructionRelocationPatchResult> {
  if (input.originalBytes.length !== 4) {
    return relocationError(`relocation:invalid-instruction-byte-width:${input.relocationKey}`);
  }

  const value = encodeAArch64RelocationValue(input);
  if (value.kind === "error") return value;

  const fieldSlices =
    input.fieldSlices ??
    (
      AARCH64_RELOCATION_FIELD_SLICES as Partial<
        Record<AArch64InternalRelocationFamily, readonly AArch64RelocationFieldSlice[]>
      >
    )[input.family];
  if (fieldSlices === undefined || fieldSlices.length === 0) {
    return relocationError(
      `relocation:missing-field-slices:${input.relocationKey}:${input.family}`,
    );
  }

  const sliceDiagnostic = validateFieldSlices(input, fieldSlices);
  if (sliceDiagnostic !== undefined) {
    return linkerError({ diagnostics: [sliceDiagnostic], verification: OK_VERIFICATION });
  }

  const originalWord = wordToU32Le(input.originalBytes);
  let patchedWord = originalWord;
  for (const slice of fieldSlices) {
    const mask =
      Number(((1n << BigInt(slice.bitCount)) - 1n) << BigInt(slice.instructionStartBit)) >>> 0;
    const fieldValue = Number(
      (value.value.encodedValue >> BigInt(slice.encodedValueStartBit)) &
        ((1n << BigInt(slice.bitCount)) - 1n),
    );
    patchedWord = ((patchedWord & ~mask) | (fieldValue << slice.instructionStartBit)) >>> 0;
  }

  return linkerOk({
    value: Object.freeze({
      encodedValue: value.value.encodedValue,
      unscaledValue: value.value.unscaledValue,
      patchedBytes: Object.freeze([...writeU32Le(patchedWord)]),
    }),
    diagnostics: value.diagnostics,
    verification: OK_VERIFICATION,
  });
}

function unscaledRelocationValue(input: AArch64RelocationValueInput): LinkerResult<bigint> {
  const targetRva = input.symbolRva + input.addend;
  switch (input.family) {
    case "branch26":
    case "branch19":
    case "branch14":
    case "rel32":
      return linkerOk({ value: targetRva - input.patchRva, verification: OK_VERIFICATION });
    case "pagebase-rel21":
      if (targetRva < 0n || input.patchRva < 0n) {
        return relocationError(`relocation:negative-page-address:${input.relocationKey}`);
      }
      return linkerOk({
        value: page(targetRva) - page(input.patchRva),
        verification: OK_VERIFICATION,
      });
    case "pageoffset-12a":
    case "pageoffset-12l":
      return linkerOk({ value: targetRva & 0xfffn, verification: OK_VERIFICATION });
    case "addr64":
    case "addr32":
      return linkerOk({
        value: input.preferredImageBase + targetRva,
        verification: OK_VERIFICATION,
      });
    case "addr32nb":
      return linkerOk({ value: targetRva, verification: OK_VERIFICATION });
    case "section-relative":
      if (input.containingSectionRva === undefined) {
        return relocationError(`relocation:missing-containing-section-rva:${input.relocationKey}`);
      }
      return linkerOk({
        value: targetRva - input.containingSectionRva,
        verification: OK_VERIFICATION,
      });
  }
}

function encodedRelocationValue(
  input: AArch64RelocationValueInput,
  unscaledValue: bigint,
): LinkerResult<bigint> {
  const bounds = AARCH64_LINK_RELOCATION_BOUNDS[input.family];
  if (
    input.family === "addr32" &&
    !AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED &&
    input.allowAddr32AbsoluteForTest !== true
  ) {
    return relocationError(`relocation:addr32-absolute-rejected:${input.relocationKey}`);
  }

  if (isBranchFamily(input.family) && unscaledValue % 4n !== 0n) {
    return relocationError(
      `relocation:unaligned-branch-distance:${input.relocationKey}:${unscaledValue}`,
    );
  }

  if (unscaledValue < bounds.minimum || unscaledValue > bounds.maximum) {
    return relocationError(
      `relocation:out-of-range:${input.relocationKey}:${input.family}:${unscaledValue}`,
    );
  }

  if (isBranchFamily(input.family)) {
    return linkerOk({
      value: encodeSignedBits(unscaledValue / 4n, bitWidthForFamily(input.family)),
      verification: OK_VERIFICATION,
    });
  }

  if (input.family === "pagebase-rel21") {
    return linkerOk({
      value: encodeSignedBits(unscaledValue, bitWidthForFamily(input.family)),
      verification: OK_VERIFICATION,
    });
  }

  if (input.family === "pageoffset-12l") {
    const accessScaleBytes = input.accessScaleBytes;
    if (
      accessScaleBytes === undefined ||
      accessScaleBytes <= 0 ||
      !Number.isInteger(accessScaleBytes)
    ) {
      return relocationError(`relocation:invalid-access-scale:${input.relocationKey}`);
    }
    const scale = BigInt(accessScaleBytes);
    if (unscaledValue % scale !== 0n) {
      return relocationError(
        `relocation:unaligned-low12:${input.relocationKey}:${unscaledValue}:${accessScaleBytes}`,
      );
    }
    const scaledLow12 = unscaledValue / scale;
    if (
      scaledLow12 < AARCH64_LINK_RELOCATION_BOUNDS["pageoffset-12l"].minimum ||
      scaledLow12 > AARCH64_LINK_RELOCATION_BOUNDS["pageoffset-12l"].maximum
    ) {
      return relocationError(
        `relocation:out-of-range:${input.relocationKey}:${input.family}:${scaledLow12}`,
      );
    }
    return linkerOk({ value: scaledLow12, verification: OK_VERIFICATION });
  }

  return linkerOk({ value: unscaledValue, verification: OK_VERIFICATION });
}

function validateFieldSlices(
  input: AArch64InstructionRelocationPatchInput,
  fieldSlices: readonly AArch64RelocationFieldSlice[],
): LinkerDiagnostic | undefined {
  const [rangeStart, rangeEnd] = input.bitRange;
  if (rangeStart < 0 || rangeEnd > 31 || rangeStart > rangeEnd) {
    return relocationDiagnostic(`relocation:invalid-bit-range:${input.relocationKey}`);
  }

  for (const slice of fieldSlices) {
    if (
      !Number.isInteger(slice.encodedValueStartBit) ||
      !Number.isInteger(slice.instructionStartBit) ||
      !Number.isInteger(slice.bitCount) ||
      slice.encodedValueStartBit < 0 ||
      slice.instructionStartBit < 0 ||
      slice.bitCount <= 0
    ) {
      return relocationDiagnostic(`relocation:invalid-field-slice:${input.relocationKey}`);
    }
    const sliceEnd = slice.instructionStartBit + slice.bitCount - 1;
    if (slice.instructionStartBit < rangeStart || sliceEnd > rangeEnd || sliceEnd > 31) {
      return relocationDiagnostic(
        `relocation:field-slice-outside-bit-range:${input.relocationKey}:${slice.instructionStartBit}:${sliceEnd}`,
      );
    }
  }
  return undefined;
}

function page(rva: bigint): bigint {
  return rva / PAGE_SIZE_BYTES;
}

function isBranchFamily(family: AArch64InternalRelocationFamily): boolean {
  return family === "branch26" || family === "branch19" || family === "branch14";
}

function bitWidthForFamily(family: AArch64InternalRelocationFamily): number {
  switch (family) {
    case "branch26":
      return 26;
    case "branch19":
      return 19;
    case "branch14":
      return 14;
    case "pagebase-rel21":
      return 21;
    default:
      return 0;
  }
}

function encodeSignedBits(value: bigint, bitWidth: number): bigint {
  const modulo = 1n << BigInt(bitWidth);
  return value < 0n ? modulo + value : value;
}

function relocationError<Value = never>(stableDetail: string): LinkerResult<Value> {
  return linkerError({
    diagnostics: [relocationDiagnostic(stableDetail)],
    verification: OK_VERIFICATION,
  });
}

function relocationDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_RELOCATION_FAILED",
    stableDetail,
    ownerKey: "relocation",
    rootCauseKey: stableDetail,
  });
}
