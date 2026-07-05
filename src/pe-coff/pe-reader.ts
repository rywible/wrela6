export interface Reader {
  readonly bytes: Uint8Array;
}

export type ParsedSectionName =
  | {
      readonly kind: "ok";
      readonly name: string;
    }
  | {
      readonly kind: "error";
      readonly stableDetail: string;
    };

export function readU8(reader: Reader, offset: number): number {
  return reader.bytes[offset] ?? 0;
}

export function readU16Le(reader: Reader, offset: number): number {
  return readU8(reader, offset) | (readU8(reader, offset + 1) << 8);
}

export function readU32Le(reader: Reader, offset: number): number {
  return (
    (readU8(reader, offset) |
      (readU8(reader, offset + 1) << 8) |
      (readU8(reader, offset + 2) << 16) |
      (readU8(reader, offset + 3) * 2 ** 24)) >>>
    0
  );
}

export function readU64Le(reader: Reader, offset: number): bigint {
  let result = 0n;
  for (let index = 0; index < 8; index += 1) {
    result |= BigInt(readU8(reader, offset + index)) << BigInt(index * 8);
  }
  return result;
}

export function readNullPaddedAscii(
  reader: Reader,
  offset: number,
  width: number,
): ParsedSectionName {
  const characters: string[] = [];
  let foundPadding = false;
  for (let index = 0; index < width; index += 1) {
    const byte = readU8(reader, offset + index);
    if (byte === 0) {
      foundPadding = true;
      continue;
    }
    if (foundPadding) {
      return Object.freeze({
        kind: "error" as const,
        stableDetail: `section-name:padding-nonzero:${characters.join("")}:${offset + index}`,
      });
    }
    if (byte > 0x7f) {
      return Object.freeze({
        kind: "error" as const,
        stableDetail: `section-name:non-ascii:${offset + index}:${byte}`,
      });
    }
    characters.push(String.fromCharCode(byte));
  }
  return Object.freeze({ kind: "ok" as const, name: characters.join("") });
}

export function firstNonZeroOffset(
  reader: Reader,
  startOffset: number,
  endOffset: number,
): number | undefined {
  for (let offset = startOffset; offset < endOffset; offset += 1) {
    if (readU8(reader, offset) !== 0) return offset;
  }
  return undefined;
}

export function bytesEqual(
  bytes: ArrayLike<number>,
  offset: number,
  expected: readonly number[],
): boolean {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}
