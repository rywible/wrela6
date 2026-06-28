import { createHash } from "node:crypto";

import type { TargetId } from "../../semantic/ids";
import type { ProofAuthorityFingerprint } from "./authority-types";

export interface ProofAuthorityField {
  readonly name: string;
  readonly value: ProofAuthorityValue;
}

export type ProofAuthorityValue =
  | { readonly kind: "absent" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "bytes"; readonly value: Uint8Array }
  | { readonly kind: "id"; readonly idKind: string; readonly stableId: string }
  | {
      readonly kind: "array";
      readonly items: readonly ProofAuthorityValue[];
      readonly sortKey?: (item: ProofAuthorityValue) => ProofAuthorityValue;
    }
  | {
      readonly kind: "map";
      readonly entries: readonly {
        readonly key: ProofAuthorityValue;
        readonly value: ProofAuthorityValue;
      }[];
    }
  | {
      readonly kind: "record";
      readonly recordKind: string;
      readonly fields: readonly ProofAuthorityField[];
    }
  | {
      readonly kind: "union";
      readonly variant: string;
      readonly value: ProofAuthorityValue;
    };

export class ProofAuthoritySerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofAuthoritySerializationError";
  }
}

const CANONICAL_TEXT_ENCODER = new TextEncoder();

function decorateSortUndecorate<Value>(
  values: readonly Value[],
  sortKey: (value: Value) => Uint8Array,
): Value[] {
  return values
    .map((value, index) => ({ index, value, sortKey: sortKey(value) }))
    .sort((left, right) => compareSerializedBytes(left.sortKey, right.sortKey))
    .map((entry) => entry.value);
}

class CanonicalByteWriter {
  private readonly chunks: Uint8Array[] = [];

  appendAscii(text: string): void {
    this.chunks.push(CANONICAL_TEXT_ENCODER.encode(text));
  }

  appendBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
  }

  toUint8Array(): Uint8Array {
    const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}

function compareSerializedBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }
  return left.length - right.length;
}

function assertValidAuthorityString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        index += 1;
        continue;
      }
      throw new ProofAuthoritySerializationError(
        "Proof authority strings reject unpaired surrogate input.",
      );
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new ProofAuthoritySerializationError(
        "Proof authority strings reject unpaired surrogate input.",
      );
    }
  }
}

function appendLengthDelimitedUtf8(writer: CanonicalByteWriter, bytes: Uint8Array): void {
  writer.appendAscii(String(bytes.length));
  writer.appendAscii(":");
  writer.appendBytes(bytes);
}

function appendAuthorityString(writer: CanonicalByteWriter, value: string): void {
  assertValidAuthorityString(value);
  const bytes = CANONICAL_TEXT_ENCODER.encode(value);
  appendLengthDelimitedUtf8(writer, bytes);
}

function appendSignedInteger(writer: CanonicalByteWriter, value: bigint): void {
  let sign: "+" | "-";
  let digits: string;
  if (value === 0n) {
    sign = "+";
    digits = "0";
  } else if (value < 0n) {
    sign = "-";
    digits = (-value).toString(10);
  } else {
    sign = "+";
    digits = value.toString(10);
  }

  if (digits.length > 1 && digits.startsWith("0")) {
    throw new ProofAuthoritySerializationError(
      "Proof authority integers reject leading zero digits.",
    );
  }

  writer.appendAscii("I");
  writer.appendAscii(sign);
  writer.appendAscii(String(digits.length));
  writer.appendAscii(":");
  writer.appendAscii(digits);
}

function appendProofAuthorityValue(writer: CanonicalByteWriter, value: ProofAuthorityValue): void {
  switch (value.kind) {
    case "absent":
      writer.appendAscii("N");
      return;
    case "bool":
      writer.appendAscii(value.value ? "B1" : "B0");
      return;
    case "int":
      appendSignedInteger(writer, value.value);
      return;
    case "string":
      writer.appendAscii("S");
      appendAuthorityString(writer, value.value);
      return;
    case "bytes":
      writer.appendAscii("Y");
      appendLengthDelimitedUtf8(writer, value.value);
      return;
    case "id":
      assertValidAuthorityString(value.idKind);
      assertValidAuthorityString(value.stableId);
      writer.appendAscii("D");
      writer.appendAscii(value.idKind);
      writer.appendAscii(":");
      appendAuthorityString(writer, value.stableId);
      return;
    case "array": {
      const items =
        value.sortKey === undefined
          ? value.items.slice()
          : decorateSortUndecorate(value.items, (item) =>
              serializeProofAuthorityValue(value.sortKey!(item)),
            );
      writer.appendAscii("A");
      writer.appendAscii(String(items.length));
      writer.appendAscii(":");
      for (const item of items) {
        appendProofAuthorityValue(writer, item);
      }
      return;
    }
    case "map": {
      const sortedEntries = decorateSortUndecorate(value.entries, (entry) =>
        serializeProofAuthorityValue(entry.key),
      );
      writer.appendAscii("M");
      writer.appendAscii(String(sortedEntries.length));
      writer.appendAscii(":");
      for (const entry of sortedEntries) {
        appendProofAuthorityValue(writer, entry.key);
        appendProofAuthorityValue(writer, entry.value);
      }
      return;
    }
    case "record":
      writer.appendAscii("R");
      writer.appendAscii(value.recordKind);
      writer.appendAscii(":");
      writer.appendAscii(String(value.fields.length));
      writer.appendAscii(":");
      for (const field of value.fields) {
        writer.appendAscii("F");
        appendAuthorityString(writer, field.name);
        appendProofAuthorityValue(writer, field.value);
      }
      return;
    case "union":
      writer.appendAscii("U");
      appendAuthorityString(writer, value.variant);
      appendProofAuthorityValue(writer, value.value);
      return;
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

export function serializeProofAuthorityValue(value: ProofAuthorityValue): Uint8Array {
  const writer = new CanonicalByteWriter();
  appendProofAuthorityValue(writer, value);
  return writer.toUint8Array();
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function proofAuthorityFingerprintFromValue(input: {
  readonly authorityKind: ProofAuthorityFingerprint["authorityKind"];
  readonly targetId: TargetId;
  readonly version: string;
  readonly value: ProofAuthorityValue;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: input.authorityKind,
    targetId: input.targetId,
    version: input.version,
    digestAlgorithm: "sha256",
    digestHex: sha256Hex(serializeProofAuthorityValue(input.value)),
  };
}
