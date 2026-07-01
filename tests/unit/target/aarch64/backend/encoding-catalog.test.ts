import { describe, expect, test } from "bun:test";

import {
  authenticateAArch64EncodingCatalog,
  type AArch64AuthoredEncodingCatalog,
  type AArch64AuthoredEncodingCatalogEntry,
} from "../../../../../src/target/aarch64/backend/object/encoding-catalog";
import type { AArch64InstructionWordPattern } from "../../../../../src/target/aarch64/backend/api/backend-catalog-interfaces";
import { RPI5_KNOWN_BYTE_FIXTURES } from "../../../../../src/target/aarch64/backend/catalogs/known-byte-fixtures";

describe("AArch64 encoding catalog authentication", () => {
  test("authenticates and normalizes catalog entries deterministically", () => {
    const first = authenticateAArch64EncodingCatalog(
      catalog({ entries: [entry("movz"), entry("ldr-unsigned-immediate")] }),
    );
    const second = authenticateAArch64EncodingCatalog(
      catalog({ entries: [entry("ldr-unsigned-immediate"), entry("movz")] }),
    );

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected catalog auth");
    expect(first.value.fingerprint).toBe(second.value.fingerprint);
    expect(first.value.entries.map((catalogEntry) => catalogEntry.stableKey)).toEqual([
      "encoding:ldr-unsigned-immediate",
      "encoding:movz",
    ]);
  });

  test("changes fingerprint when a normalized entry payload changes", () => {
    const baseline = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [
          {
            ...entry("movz"),
            instructionWordPatterns: [{ mask: 0xff800000, value: 0xd2800000, source: "decoder" }],
          },
        ],
      }),
    );
    const changedPayload = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [
          {
            ...entry("movz"),
            instructionWordPatterns: [{ mask: 0xff800000, value: 0x92800000, source: "decoder" }],
          },
        ],
      }),
    );

    expect(baseline.kind).toBe("ok");
    expect(changedPayload.kind).toBe("ok");
    if (baseline.kind !== "ok" || changedPayload.kind !== "ok") {
      throw new Error("expected catalog auth");
    }
    expect(baseline.value.entries.map((catalogEntry) => catalogEntry.stableKey)).toEqual(
      changedPayload.value.entries.map((catalogEntry) => catalogEntry.stableKey),
    );
    expect(baseline.value.fingerprint).not.toBe(changedPayload.value.fingerprint);
  });

  test("rejects duplicate encoding keys", () => {
    const result = authenticateAArch64EncodingCatalog(
      catalog({ entries: [entry("movz"), entry("movz")] }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding-catalog:duplicate-entry:encoding:movz",
    ]);
  });

  test("rejects duplicate opcode forms even with distinct stable keys", () => {
    const result = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [
          entry("movz"),
          {
            ...entry("movz"),
            stableKey: "encoding:movz:alias",
          },
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate opcode form");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding-catalog:duplicate-opcode-form:movz",
    ]);
  });

  test("rejects missing fixture IDs and SP/ZR ambiguity", () => {
    const result = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [
          {
            ...entry("movz"),
            knownByteFixtureIds: ["missing-fixture"],
            permitsSp: true,
            permitsZr: true,
          },
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected catalog errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding-catalog:missing-known-byte-fixture:movz:missing-fixture",
      "encoding-catalog:sp-zr-ambiguous:movz",
    ]);
  });

  test("rejects relocation hole without catalog owner", () => {
    const result = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [
          {
            ...entry("b-cond"),
            relocationHole: { family: "branch19", bitRange: [5, 23] },
          },
        ],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation hole error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding-catalog:relocation-hole-without-owner:b-cond:5-23",
    ]);
  });

  test("rejects emitted opcodes missing instruction word patterns", () => {
    const result = authenticateAArch64EncodingCatalog(
      catalog({
        entries: [{ ...entry("movz"), instructionWordPatterns: [] }],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing pattern error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding-catalog:missing-word-pattern:movz",
    ]);
  });
});

function catalog(
  overrides: Partial<AArch64AuthoredEncodingCatalog> = {},
): AArch64AuthoredEncodingCatalog {
  return {
    supportedFeatures: ["base"],
    fixtures: RPI5_KNOWN_BYTE_FIXTURES,
    entries: [entry("movz", ["movz-x0-0x1234"])],
    ...overrides,
  };
}

function entry(
  opcode: string,
  knownByteFixtureIds: readonly string[] = [],
): AArch64AuthoredEncodingCatalogEntry {
  return {
    opcode,
    stableKey: `encoding:${opcode}`,
    family: opcode,
    requiredFeatures: ["base"],
    knownByteFixtureIds,
    permitsSp: false,
    permitsZr: false,
    instructionWordPatterns: patternForTest(opcode),
  };
}

function patternForTest(opcode: string): readonly AArch64InstructionWordPattern[] {
  if (opcode === "b-cond") return [{ mask: 0xff000010, value: 0x54000000, source: "decoder" }];
  if (opcode === "ldr-unsigned-immediate")
    return [{ mask: 0xffc00000, value: 0xf9400000, source: "decoder" }];
  if (opcode === "movz") return [{ mask: 0xff800000, value: 0xd2800000, source: "decoder" }];
  return [];
}
