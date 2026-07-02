import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";

const BYTE_WRITER_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-byte-writer",
      runKey: "range-check",
      status: "passed" as const,
    }),
  ]),
});

export interface PeByteWriter {
  readonly offset: () => number;
  readonly bytes: () => readonly number[];
  readonly writeU8: (value: number) => PeCoffWriterResult<number>;
  readonly writeU16Le: (value: number) => PeCoffWriterResult<number>;
  readonly writeU32Le: (value: number) => PeCoffWriterResult<number>;
  readonly writeU64Le: (value: bigint) => PeCoffWriterResult<number>;
  readonly writeBytes: (bytes: readonly number[]) => PeCoffWriterResult<number>;
  readonly writeZeroes: (count: number) => PeCoffWriterResult<number>;
  readonly patchU32Le: (offset: number, value: number) => PeCoffWriterResult<number>;
}

function byteWriterError(stableDetail: string): PeCoffWriterResult<number> {
  return peCoffError({
    diagnostics: [
      peCoffWriterDiagnostic({
        code: "PE_COFF_SERIALIZATION_FAILED",
        ownerKey: "pe-byte-writer",
        stableDetail,
      }),
    ],
    verification: BYTE_WRITER_VERIFICATION,
  });
}

function byteWriterOk(offset: number): PeCoffWriterResult<number> {
  return peCoffOk({
    value: offset,
    verification: BYTE_WRITER_VERIFICATION,
  });
}

function validateUnsignedNumber(widthName: string, value: number, max: number): string | undefined {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    return `byte-writer:range:${widthName}:${value}`;
  }
  return undefined;
}

function validateUnsignedBigInt(widthName: string, value: bigint, max: bigint): string | undefined {
  if (typeof value !== "bigint") {
    return `byte-writer:range:${widthName}:${String(value)}`;
  }
  if (value < 0n || value > max) {
    return `byte-writer:range:${widthName}:${value.toString()}`;
  }
  return undefined;
}

function writeLittleEndianNumber(buffer: number[], value: number, widthBytes: number): void {
  for (let index = 0; index < widthBytes; index += 1) {
    buffer.push(Math.floor(value / 2 ** (8 * index)) & 0xff);
  }
}

function writeLittleEndianBigInt(buffer: number[], value: bigint, widthBytes: number): void {
  for (let index = 0; index < widthBytes; index += 1) {
    buffer.push(Number((value >> BigInt(8 * index)) & 0xffn));
  }
}

function patchLittleEndianNumber(
  buffer: number[],
  patchOffset: number,
  value: number,
  widthBytes: number,
): void {
  for (let index = 0; index < widthBytes; index += 1) {
    buffer[patchOffset + index] = Math.floor(value / 2 ** (8 * index)) & 0xff;
  }
}

export function createPeByteWriter(): PeByteWriter {
  const buffer: number[] = [];

  return Object.freeze({
    offset: () => buffer.length,
    bytes: () => Object.freeze(buffer.slice()),
    writeU8: (value: number): PeCoffWriterResult<number> => {
      const error = validateUnsignedNumber("u8", value, 0xff);
      if (error !== undefined) return byteWriterError(error);
      buffer.push(value);
      return byteWriterOk(buffer.length);
    },
    writeU16Le: (value: number): PeCoffWriterResult<number> => {
      const error = validateUnsignedNumber("u16", value, 0xffff);
      if (error !== undefined) return byteWriterError(error);
      writeLittleEndianNumber(buffer, value, 2);
      return byteWriterOk(buffer.length);
    },
    writeU32Le: (value: number): PeCoffWriterResult<number> => {
      const error = validateUnsignedNumber("u32", value, 0xffff_ffff);
      if (error !== undefined) return byteWriterError(error);
      writeLittleEndianNumber(buffer, value, 4);
      return byteWriterOk(buffer.length);
    },
    writeU64Le: (value: bigint): PeCoffWriterResult<number> => {
      const error = validateUnsignedBigInt("u64", value, 0xffff_ffff_ffff_ffffn);
      if (error !== undefined) return byteWriterError(error);
      writeLittleEndianBigInt(buffer, value, 8);
      return byteWriterOk(buffer.length);
    },
    writeBytes: (bytes: readonly number[]): PeCoffWriterResult<number> => {
      for (const byte of bytes) {
        const error = validateUnsignedNumber("byte", byte, 0xff);
        if (error !== undefined) return byteWriterError(error);
      }
      for (const byte of bytes) {
        buffer.push(byte);
      }
      return byteWriterOk(buffer.length);
    },
    writeZeroes: (count: number): PeCoffWriterResult<number> => {
      if (!Number.isInteger(count) || count < 0) {
        return byteWriterError(`byte-writer:range:zero-count:${count}`);
      }
      for (let index = 0; index < count; index += 1) {
        buffer.push(0);
      }
      return byteWriterOk(buffer.length);
    },
    patchU32Le: (offset: number, value: number): PeCoffWriterResult<number> => {
      if (!Number.isInteger(offset) || offset < 0 || offset + 4 > buffer.length) {
        return byteWriterError(`byte-writer:range:patch-u32-offset:${offset}`);
      }
      const error = validateUnsignedNumber("u32", value, 0xffff_ffff);
      if (error !== undefined) return byteWriterError(error);
      patchLittleEndianNumber(buffer, offset, value, 4);
      return byteWriterOk(buffer.length);
    },
  });
}
