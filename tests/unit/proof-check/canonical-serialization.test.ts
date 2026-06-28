import { describe, expect, test } from "bun:test";

import {
  ProofAuthoritySerializationError,
  proofAuthorityFingerprintFromValue,
  serializeProofAuthorityValue,
} from "../../../src/proof-check/authority/canonical-serialization";
import { targetId } from "../../../src/semantic/ids";

function decodeCanonicalBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("serializeProofAuthorityValue", () => {
  test("canonical serialization length-delimits strings and includes field tags", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "record",
      recordKind: "Example",
      fields: [
        { name: "name", value: { kind: "string", value: "ab:c" } },
        { name: "count", value: { kind: "int", value: 12n } },
      ],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("RExample:2:F4:nameS4:ab:cF5:countI+2:12");
  });

  test("serializes an empty record", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "record",
      recordKind: "Empty",
      fields: [],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("REmpty:0:");
  });

  test("serializes a nested record", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "record",
      recordKind: "Outer",
      fields: [
        {
          name: "inner",
          value: {
            kind: "record",
            recordKind: "Inner",
            fields: [{ name: "x", value: { kind: "int", value: 1n } }],
          },
        },
      ],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("ROuter:1:F5:innerRInner:1:F1:xI+1:1");
  });

  test("serializes a union variant", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "union",
      variant: "ok",
      value: { kind: "bool", value: true },
    });

    expect(decodeCanonicalBytes(bytes)).toBe("U2:okB1");
  });

  test("serializes absent optional fields", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "record",
      recordKind: "Optional",
      fields: [
        { name: "present", value: { kind: "string", value: "x" } },
        { name: "missing", value: { kind: "absent" } },
      ],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("ROptional:2:F7:presentS1:xF7:missingN");
  });

  test("excludes non-ASCII display labels from authority payload", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "record",
      recordKind: "Labeled",
      fields: [{ name: "key", value: { kind: "string", value: "authority-only" } }],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("RLabeled:1:F3:keyS14:authority-only");
  });

  test("serializes integers as signed base-10 strings without leading zeroes except +0", () => {
    expect(decodeCanonicalBytes(serializeProofAuthorityValue({ kind: "int", value: 0n }))).toBe(
      "I+1:0",
    );
    expect(decodeCanonicalBytes(serializeProofAuthorityValue({ kind: "int", value: -7n }))).toBe(
      "I-1:7",
    );
    expect(decodeCanonicalBytes(serializeProofAuthorityValue({ kind: "int", value: 100n }))).toBe(
      "I+3:100",
    );
  });

  test("serializes ids, bytes, bools, and arrays", () => {
    expect(
      decodeCanonicalBytes(
        serializeProofAuthorityValue({
          kind: "id",
          idKind: "target",
          stableId: "uefi-aarch64",
        }),
      ),
    ).toBe("Dtarget:12:uefi-aarch64");

    const bytesPayload = serializeProofAuthorityValue({
      kind: "bytes",
      value: new Uint8Array([0x00, 0xff, 0x3a]),
    });
    expect(Array.from(bytesPayload)).toEqual([
      ...new TextEncoder().encode("Y3:"),
      0x00,
      0xff,
      0x3a,
    ]);

    expect(
      decodeCanonicalBytes(
        serializeProofAuthorityValue({
          kind: "array",
          items: [
            { kind: "bool", value: false },
            { kind: "bool", value: true },
          ],
        }),
      ),
    ).toBe("A2:B0B1");
  });

  test("sorts map entries by serialized key", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "map",
      entries: [
        {
          key: { kind: "string", value: "b" },
          value: { kind: "int", value: 2n },
        },
        {
          key: { kind: "string", value: "a" },
          value: { kind: "int", value: 1n },
        },
      ],
    });

    expect(decodeCanonicalBytes(bytes)).toBe("M2:S1:aI+1:1S1:bI+1:2");
  });

  test("sorts arrays by a declared key when requested", () => {
    const bytes = serializeProofAuthorityValue({
      kind: "array",
      sortKey: (item) => {
        if (item.kind !== "record") {
          throw new Error("expected record item");
        }
        const keyField = item.fields.find((field) => field.name === "key");
        if (keyField === undefined) {
          throw new Error("expected key field");
        }
        return keyField.value;
      },
      items: [
        {
          kind: "record",
          recordKind: "Entry",
          fields: [
            { name: "key", value: { kind: "string", value: "b" } },
            { name: "value", value: { kind: "int", value: 2n } },
          ],
        },
        {
          kind: "record",
          recordKind: "Entry",
          fields: [
            { name: "key", value: { kind: "string", value: "a" } },
            { name: "value", value: { kind: "int", value: 1n } },
          ],
        },
      ],
    });

    expect(decodeCanonicalBytes(bytes)).toBe(
      "A2:REntry:2:F3:keyS1:aF5:valueI+1:1REntry:2:F3:keyS1:bF5:valueI+1:2",
    );
  });

  test("rejects unpaired surrogate input in strings", () => {
    expect(() =>
      serializeProofAuthorityValue({
        kind: "string",
        value: "\u{d800}",
      }),
    ).toThrow(ProofAuthoritySerializationError);
  });
});

describe("proofAuthorityFingerprintFromValue", () => {
  test("produces a sha256 ProofAuthorityFingerprint with target metadata", () => {
    const fingerprint = proofAuthorityFingerprintFromValue({
      authorityKind: "runtime",
      targetId: targetId("uefi-aarch64"),
      version: "runtime-v1",
      value: {
        kind: "record",
        recordKind: "Empty",
        fields: [],
      },
    });

    expect(fingerprint).toEqual({
      authorityKind: "runtime",
      targetId: targetId("uefi-aarch64"),
      version: "runtime-v1",
      digestAlgorithm: "sha256",
      digestHex: "1f38aed8c6cda8d847195fba4ef9fbbc11681187a7bf5877c1b5f18cd303e89e",
    });
  });
});
