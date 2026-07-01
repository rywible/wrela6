import { describe, expect, test } from "bun:test";

import { runAArch64LayoutEncodeFixedPoint } from "../../../../../src/target/aarch64/backend/object/layout-encode-fixed-point";

describe("AArch64 layout and encode fixed point", () => {
  test("stable one-pass layout emits encoded bytes and provenance", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [movz("movz:main", 7n)],
        },
      ],
      symbols: [{ stableKey: "main", sectionKey: ".text" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.iterations).toBe(1);
    expect(result.value.sections[0]!.bytes).toEqual([0xe0, 0x00, 0x80, 0xd2]);
    expect(result.value.byteProvenance.map((record) => record.stableKey)).toEqual([
      "byte:.text:movz:main",
    ]);
  });

  test("branch widening updates following relocation patch offsets", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "branch:far",
              siteKey: "b.eq:far",
              opcode: "b-cond",
              operands: [
                { kind: "condition", condition: "eq" },
                { kind: "relocation-target", target: "far_target" },
              ],
              relocation: { family: "branch19", target: "far_target" },
              branch: { kind: "b-cond", targetKey: "far_target", distanceBytes: 2_000_000 },
            },
            {
              stableKey: "call:near",
              siteKey: "call:near",
              opcode: "bl",
              operands: [{ kind: "relocation-target", target: "helper" }],
              relocation: { family: "branch26", target: "helper" },
            },
          ],
        },
      ],
      symbols: [{ stableKey: "helper", sectionKey: ".text" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.iterations).toBe(2);
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "call:near")
        ?.patchOffsetBytes,
    ).toBe(8);
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "b.eq:far"),
    ).toMatchObject({
      family: "branch26",
      patchOffsetBytes: 4,
      bitRange: [0, 25],
      targetSymbol: "far_target",
    });
    expect(result.value.sections[0]?.bytes.slice(0, 8)).toEqual([
      0x41, 0x00, 0x00, 0x54, 0x00, 0x00, 0x00, 0x14,
    ]);
  });

  test("branch relaxation initial offsets treat labels as zero-byte instructions", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "label:entry",
              opcode: "label",
              operands: [],
              definedSymbol: { stableKey: "entry", isGlobal: false },
            },
            {
              stableKey: "branch:limit",
              siteKey: "b.eq:limit",
              opcode: "b-cond",
              operands: [
                { kind: "condition", condition: "eq" },
                { kind: "relocation-target", target: "limit_target" },
              ],
              relocation: { family: "branch19", target: "limit_target" },
              branch: {
                kind: "b-cond",
                targetKey: "limit_target",
                distanceBytes: 1_048_572,
              },
            },
          ],
        },
      ],
      symbols: [{ stableKey: "limit_target", sectionKey: ".text" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected branch at limit without widening");
    expect(result.value.branchDecisions).toEqual([{ siteKey: "b.eq:limit", state: "unchanged" }]);
    expect(result.value.objectRelocations).toEqual([
      expect.objectContaining({
        stableKey: "reloc:b.eq:limit",
        family: "branch19",
        patchOffsetBytes: 0,
      }),
    ]);
  });

  test("widens compare-and-branch sites through an inverted skip branch", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "branch:cbz",
              siteKey: "cbz:far",
              opcode: "cbz",
              operands: [
                { kind: "register", register: "x3" },
                { kind: "relocation-target", target: "zero_target" },
              ],
              relocation: { family: "branch19", target: "zero_target" },
              branch: { kind: "cbz", targetKey: "zero_target", distanceBytes: 2_000_000 },
            },
            {
              stableKey: "branch:cbnz",
              siteKey: "cbnz:far",
              opcode: "cbnz",
              operands: [
                { kind: "register", register: "w4" },
                { kind: "relocation-target", target: "nonzero_target" },
              ],
              relocation: { family: "branch19", target: "nonzero_target" },
              branch: {
                kind: "cbnz",
                targetKey: "nonzero_target",
                distanceBytes: 2_000_000,
              },
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected widened compare branches");
    expect(result.value.branchDecisions).toEqual([
      { siteKey: "cbnz:far", state: "expanded-invert-and-b" },
      { siteKey: "cbz:far", state: "expanded-invert-and-b" },
    ]);
    expect(result.value.sections[0]?.bytes).toEqual([
      0x43, 0x00, 0x00, 0xb5, 0x00, 0x00, 0x00, 0x14, 0x44, 0x00, 0x00, 0x34, 0x00, 0x00, 0x00,
      0x14,
    ]);
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "cbz:far"),
    ).toMatchObject({
      family: "branch26",
      patchOffsetBytes: 4,
      bitRange: [0, 25],
      targetSymbol: "zero_target",
    });
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "cbnz:far"),
    ).toMatchObject({
      family: "branch26",
      patchOffsetBytes: 12,
      bitRange: [0, 25],
      targetSymbol: "nonzero_target",
    });
  });

  test("widens test-and-branch sites through an inverted skip branch", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "branch:tbz",
              siteKey: "tbz:far",
              opcode: "tbz",
              operands: [
                { kind: "register", register: "x5" },
                { kind: "immediate", value: 40n },
                { kind: "relocation-target", target: "bit_zero_target" },
              ],
              relocation: { family: "branch14", target: "bit_zero_target" },
              branch: { kind: "tbz", targetKey: "bit_zero_target", distanceBytes: 80_000 },
            },
            {
              stableKey: "branch:tbnz",
              siteKey: "tbnz:far",
              opcode: "tbnz",
              operands: [
                { kind: "register", register: "w6" },
                { kind: "immediate", value: 7n },
                { kind: "relocation-target", target: "bit_one_target" },
              ],
              relocation: { family: "branch14", target: "bit_one_target" },
              branch: { kind: "tbnz", targetKey: "bit_one_target", distanceBytes: 80_000 },
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected widened test branches");
    expect(result.value.branchDecisions).toEqual([
      { siteKey: "tbnz:far", state: "expanded-test-branch-and-b" },
      { siteKey: "tbz:far", state: "expanded-test-branch-and-b" },
    ]);
    expect(result.value.sections[0]?.bytes).toEqual([
      0x45, 0x00, 0x40, 0xb7, 0x00, 0x00, 0x00, 0x14, 0x46, 0x00, 0x38, 0x36, 0x00, 0x00, 0x00,
      0x14,
    ]);
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "tbz:far"),
    ).toMatchObject({
      family: "branch26",
      patchOffsetBytes: 4,
      bitRange: [0, 25],
      targetSymbol: "bit_zero_target",
    });
    expect(
      result.value.objectRelocations.find((relocation) => relocation.siteKey === "tbnz:far"),
    ).toMatchObject({
      family: "branch26",
      patchOffsetBytes: 12,
      bitRange: [0, 25],
      targetSymbol: "bit_one_target",
    });
  });

  test("encoding diagnostics are returned without constructing invalid zero-byte fragments", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.bad",
          sectionKey: ".text",
          instructions: [{ stableKey: "bad", opcode: "not-real", operands: [] }],
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected layout encoding error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "encoding:unsupported-opcode:not-real",
    ]);
  });

  test("label-only fragments return diagnostics instead of throwing object construction errors", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.labels",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "label:entry",
              opcode: "label",
              operands: [],
              definedSymbol: { stableKey: "entry", isGlobal: false },
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected zero-byte fragment diagnostic");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "layout-fixed-point:zero-byte-fragment:text.labels",
    ]);
  });

  test("records provenance for alignment padding between fragments", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.first",
          sectionKey: ".text",
          instructions: [movz("movz:first", 1n)],
        },
        {
          stableKey: "text.second",
          sectionKey: ".text",
          alignmentBytes: 8,
          instructions: [movz("movz:second", 2n)],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected aligned layout");
    expect(result.value.sections[0]?.bytes).toEqual([
      0x20, 0x00, 0x80, 0xd2, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x80, 0xd2,
    ]);
    expect(result.value.byteProvenance.map((record) => record.stableKey)).toEqual([
      "byte:.text:movz:first",
      "byte:.text:align:text.second:offset:4",
      "byte:.text:movz:second",
    ]);
  });

  test("literal pools honor rendered section end and declared reach", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              ...movz("literal:user", 1n),
              literalUser: {
                literalClass: "default",
                valueKey: "constant:one",
                valueBytes: [1, 0, 0, 0, 0, 0, 0, 0],
                alignmentBytes: 8,
                maxReachBytes: 64,
              },
            },
            movz("movz:after:1", 2n),
            movz("movz:after:2", 3n),
          ],
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected reachable literal pool");
    expect(result.value.literalPools[0]).toMatchObject({
      stableKey: "literal:.text:constant:one",
      sectionKey: ".text",
      offsetBytes: 16,
      data: [1, 0, 0, 0, 0, 0, 0, 0],
      users: [{ stableKey: "literal:user", useOffsetBytes: 0, maxReachBytes: 64 }],
    });
    expect(result.value.sections[0]?.bytes.slice(12, 24)).toEqual([
      0x00, 0x00, 0x00, 0x00, 1, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  test("literal pool reach failures stop layout before object construction", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              ...movz("literal:user", 1n),
              literalUser: {
                literalClass: "default",
                valueKey: "constant:one",
                valueBytes: [1, 0, 0, 0, 0, 0, 0, 0],
                alignmentBytes: 8,
                maxReachBytes: 4,
              },
            },
            movz("movz:after", 2n),
          ],
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal reach error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "literal-pool:reach-exhausted:literal:user:distance:8:limit:4",
    ]);
  });

  test("repeats branch relaxation when one widening pushes a later target out of range", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "branch:cascade",
              siteKey: "b.eq:cascade",
              opcode: "b-cond",
              operands: [
                { kind: "condition", condition: "eq" },
                { kind: "relocation-target", target: "cascade_target" },
              ],
              relocation: { family: "branch19", target: "cascade_target" },
              branch: {
                kind: "b-cond",
                targetKey: "cascade_target",
                distanceBytes: 1_048_572,
              },
            },
            {
              stableKey: "branch:inner",
              siteKey: "b.eq:inner",
              opcode: "b-cond",
              operands: [
                { kind: "condition", condition: "eq" },
                { kind: "relocation-target", target: "inner_target" },
              ],
              relocation: { family: "branch19", target: "inner_target" },
              branch: {
                kind: "b-cond",
                targetKey: "inner_target",
                distanceBytes: 2_000_000,
              },
            },
          ],
        },
      ],
      symbols: [
        { stableKey: "cascade_target", sectionKey: ".text" },
        { stableKey: "inner_target", sectionKey: ".text" },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected layout");
    expect(result.value.iterations).toBe(3);
    expect(result.value.branchDecisions).toEqual([
      { siteKey: "b.eq:cascade", state: "expanded-invert-and-b" },
      { siteKey: "b.eq:inner", state: "expanded-invert-and-b" },
    ]);
  });

  test("backend-owned veneer retargets branch site and relocates veneer to original target", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              ...movz("literal:user", 1n),
              literalUser: {
                literalClass: "default",
                valueKey: "constant:one",
                valueBytes: [1, 0, 0, 0, 0, 0, 0, 0],
                alignmentBytes: 8,
                maxReachBytes: 4096,
              },
            },
            {
              stableKey: "call:far",
              siteKey: "call:far",
              opcode: "bl",
              operands: [{ kind: "relocation-target", target: "far" }],
              relocation: { family: "branch26", target: "far" },
              branch: {
                kind: "bl",
                targetKey: "far",
                distanceBytes: 200_000_000,
                veneerPolicy: "backend-owned",
              },
              veneerSite: {
                targetKey: "far",
                relocationFamily: "branch26",
                policy: "backend-owned",
                predeclaredScratchGprs: ["x16"],
                requestedScratchGprs: ["x16"],
                rangeProof: "out-of-range",
              },
            },
          ],
        },
      ],
      symbols: [{ stableKey: "far", sectionKey: ".text" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected growth");
    expect(result.value.branchDecisions).toEqual([
      { siteKey: "call:far", state: "veneer-requested" },
    ]);
    expect(result.value.literalPools.map((entry) => String(entry.stableKey))).toEqual([
      "literal:.text:constant:one",
    ]);
    expect(result.value.veneers.map((veneer) => String(veneer.stableKey))).toEqual([
      "veneer:call:far",
    ]);
    expect(
      result.value.symbols.find((symbol) => String(symbol.stableKey) === "veneer:call:far"),
    ).toMatchObject({
      sectionKey: ".text",
      offsetBytes: 16,
      isGlobal: false,
    });
    expect(result.value.objectRelocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stableKey: "reloc:call:far",
          siteKey: "call:far",
          offsetBytes: 4,
          family: "branch26",
          targetSymbol: "veneer:call:far",
          bitRange: [0, 25],
        }),
        expect.objectContaining({
          stableKey: "reloc:veneer:call:far",
          siteKey: "veneer:call:far",
          offsetBytes: 16,
          family: "branch26",
          targetSymbol: "far",
          bitRange: [0, 25],
        }),
      ]),
    );
  });

  test("rejects backend-owned veneer requests without declared veneer site metadata", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "call:far",
              siteKey: "call:far",
              opcode: "bl",
              operands: [{ kind: "relocation-target", target: "far" }],
              relocation: { family: "branch26", target: "far" },
              branch: {
                kind: "bl",
                targetKey: "far",
                distanceBytes: 200_000_000,
                veneerPolicy: "backend-owned",
              },
            },
          ],
        },
      ],
      symbols: [{ stableKey: "far", sectionKey: ".text" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing veneer metadata error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "layout-fixed-point:backend-owned-veneer-site-missing:call:far",
    ]);
  });

  test("range exhaustion uses layout owner diagnostic", () => {
    const result = runAArch64LayoutEncodeFixedPoint({
      fragments: [
        {
          stableKey: "text.main",
          sectionKey: ".text",
          instructions: [
            {
              stableKey: "branch:too_far",
              siteKey: "b:too_far",
              opcode: "b",
              operands: [{ kind: "relocation-target", target: "far_target" }],
              relocation: { family: "branch26", target: "far_target" },
              branch: {
                kind: "b",
                targetKey: "far_target",
                distanceBytes: 200_000_000,
                veneerPolicy: "none",
              },
            },
          ],
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected range exhaustion");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "layout-fixed-point:range-exhausted:branch:b:too_far:section:.text:target:far_target",
    ]);
  });
});

function movz(stableKey: string, value: bigint) {
  return {
    stableKey,
    opcode: "movz",
    operands: [
      { kind: "register" as const, register: "x0" },
      { kind: "immediate" as const, value },
    ],
  };
}
