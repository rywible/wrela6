import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_SIGNATURE_BYTES,
  PE32_PLUS_CHECKSUM_OPTIONAL_HEADER_OFFSET_BYTES,
} from "./headers";

const PE_CHECKSUM_FIELD_WIDTH_BYTES = 4;

export const PE_CHECKSUM_PLACEHOLDER_UNTIL_SERIALIZATION = 0;

export function pe32PlusChecksumFileOffset(peHeaderOffsetBytes: number): number {
  return (
    peHeaderOffsetBytes +
    PE_SIGNATURE_BYTES.length +
    PE_COFF_FILE_HEADER_SIZE_BYTES +
    PE32_PLUS_CHECKSUM_OPTIONAL_HEADER_OFFSET_BYTES
  );
}

export function computePeImageChecksum(
  bytes: ArrayLike<number>,
  checksumFieldOffsetBytes: number,
): number {
  let checksum = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    if (wordOverlapsChecksumField(offset, checksumFieldOffsetBytes)) continue;
    const word = bytes[offset]! | ((offset + 1 < bytes.length ? bytes[offset + 1]! : 0) << 8);
    checksum = foldChecksumCarry(checksum + word);
  }
  checksum = foldChecksumCarry(checksum);
  return (checksum + bytes.length) >>> 0;
}

function wordOverlapsChecksumField(
  wordOffsetBytes: number,
  checksumFieldOffsetBytes: number,
): boolean {
  return (
    wordOffsetBytes < checksumFieldOffsetBytes + PE_CHECKSUM_FIELD_WIDTH_BYTES &&
    wordOffsetBytes + 2 > checksumFieldOffsetBytes
  );
}

function foldChecksumCarry(value: number): number {
  return ((value & 0xffff) + (value >>> 16)) >>> 0;
}
