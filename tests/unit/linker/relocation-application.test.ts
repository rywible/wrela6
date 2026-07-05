import { describe, expect, test } from "bun:test";

import {
  applyResolvedRelocations,
  planPairedRelocations,
  type ApplyResolvedRelocationsInput,
} from "../../../src/linker/relocation-application";
import { layoutImageSections } from "../../../src/linker/section-layout";
import { materializeResolvedImageSymbols } from "../../../src/linker/symbol-rva";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import type { LinkedImageSection } from "../../../src/linker/linked-image-layout";
import type { AArch64InternalRelocationFamily } from "../../../src/target/aarch64/backend/object/relocation-records";
import type { AArch64ObjectRelocation } from "../../../src/target/aarch64/backend/object/object-module";
import {
  dataSectionForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { normalizedGraphForTest } from "../../support/linker/aarch64-normalized-link-fixtures";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";

describe("resolved relocation application", () => {
  test.each([
    {
      family: "branch26" as const,
      bitRange: [0, 25] as const,
      expectedBytes: [1, 0, 0, 0],
    },
    {
      family: "branch19" as const,
      bitRange: [5, 23] as const,
      expectedBytes: [32, 0, 0, 0],
    },
    {
      family: "branch14" as const,
      bitRange: [5, 18] as const,
      expectedBytes: [32, 0, 0, 0],
    },
  ])("patches $family instruction relocations", ({ family, bitRange, expectedBytes }) => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: `reloc:${family}`,
        family,
        offsetBytes: 0,
        bitRange,
        target: { kind: "linkage-name", linkageName: "Target.main" },
        encodingOwner: instructionEncodingOwnerForTest(family),
      }),
    ]);

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation application");
    expect(Array.from(bytesAt(result.value.sections, ".text", 0, 4))).toEqual([...expectedBytes]);
    expect(result.value.appliedRelocations[0]).toEqual(
      expect.objectContaining({
        relocationKey: `module:test:reloc:reloc:reloc:${family}`,
        sourceModuleKey: "module:test:reloc",
        family,
        patchSectionKey: ".text",
        patchRva: 0x1000,
        targetSymbolKey: "module:test:reloc:symbol:target",
        targetRva: 0x1004,
        addend: 0n,
        expectedEncodedValue: 1n,
        patchedBytes: Uint8Array.from(expectedBytes),
      }),
    );
  });

  test("patches pagebase and low-12 paired instruction relocations", () => {
    const input = applicationInputForRelocations(
      [
        relocationForLinkTest({
          stableKey: "reloc:page",
          family: "pagebase-rel21",
          offsetBytes: 0,
          bitRange: [5, 30],
          target: { kind: "linkage-name", linkageName: "Target.main" },
          encodingOwner: instructionEncodingOwnerForTest("adrp"),
          pairedRelocationKey: "reloc:offset",
        }),
        relocationForLinkTest({
          stableKey: "reloc:offset",
          family: "pageoffset-12a",
          offsetBytes: 4,
          bitRange: [10, 21],
          target: { kind: "linkage-name", linkageName: "Target.main" },
          encodingOwner: instructionEncodingOwnerForTest("add"),
          pairedRelocationKey: "reloc:page",
        }),
      ],
      { textBytes: Array(12).fill(0), targetOffsetBytes: 8 },
    );

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation application");
    expect(Array.from(bytesAt(result.value.sections, ".text", 0, 8))).toEqual([
      0, 0, 0, 0, 0, 32, 0, 0,
    ]);
    expect(result.value.appliedRelocations.map((relocation) => relocation.family)).toEqual([
      "pageoffset-12a",
      "pagebase-rel21",
    ]);
  });

  test("patches scaled pageoffset-12l instruction relocations when covered by a planned pair", () => {
    const input = applicationInputForRelocations(
      [
        relocationForLinkTest({
          stableKey: "reloc:page",
          family: "pagebase-rel21",
          offsetBytes: 0,
          bitRange: [5, 30],
          target: { kind: "linkage-name", linkageName: "Target.main" },
          encodingOwner: instructionEncodingOwnerForTest("adrp"),
          pairedRelocationKey: "reloc:offset",
        }),
        relocationForLinkTest({
          stableKey: "reloc:offset",
          family: "pageoffset-12l",
          offsetBytes: 4,
          bitRange: [10, 21],
          target: { kind: "linkage-name", linkageName: "Target.main" },
          encodingOwner: instructionEncodingOwnerForTest("ldr", 8),
          pairedRelocationKey: "reloc:page",
        }),
      ],
      { textBytes: Array(12).fill(0), targetOffsetBytes: 8 },
    );

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation application");
    expect(Array.from(bytesAt(result.value.sections, ".text", 4, 4))).toEqual([0, 4, 0, 0]);
  });

  test("addr64 writes image-base address, records dir64 base relocation, and does not mutate inputs", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "absolute64",
        sectionKey: ".data",
        family: "addr64",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Target.main" },
        addend: 3n,
      }),
    ]);
    const originalDataSection = input.sections.find((section) => section.stableKey === ".data");
    const originalBytes = [...(originalDataSection?.bytes ?? [])];

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation application");
    expect(Array.from(originalDataSection?.bytes ?? [])).toEqual(originalBytes);
    expect(
      Array.from(
        result.value.sections.find((section) => section.stableKey === ".data")?.bytes ?? [],
      ),
    ).toEqual([7, 16, 0, 0, 0, 0, 0, 0]);
    expect(Object.isFrozen(result.value.sections[0])).toBe(true);
    expect(result.value.sections[0]?.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value.baseRelocations).toEqual([
      {
        stableKey: "base-reloc:dir64:.data:8192",
        kind: "dir64",
        sectionKey: ".data",
        rva: 0x2000,
        widthBytes: 8,
        sourceRelocationKey: "module:test:reloc:reloc:absolute64",
      },
    ]);
    expect(result.value.appliedRelocations[0]?.baseRelocationKey).toBe(
      "base-reloc:dir64:.data:8192",
    );
  });

  test("sorts addr64 base relocations by numeric rva", () => {
    const input = applicationInputForRelocations(
      [
        relocationForLinkTest({
          stableKey: "absolute64:high",
          sectionKey: ".data",
          offsetBytes: 1808,
          family: "addr64",
          widthBytes: 8,
          target: { kind: "linkage-name", linkageName: "Target.main" },
        }),
        relocationForLinkTest({
          stableKey: "absolute64:low",
          sectionKey: ".data",
          offsetBytes: 0,
          family: "addr64",
          widthBytes: 8,
          target: { kind: "linkage-name", linkageName: "Target.main" },
        }),
      ],
      { dataBytes: Array(1816).fill(0) },
    );

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected relocation application");
    expect(result.value.baseRelocations.map((relocation) => relocation.rva)).toEqual([8192, 10000]);
    expect(result.value.baseRelocations.map((relocation) => relocation.stableKey)).toEqual([
      "base-reloc:dir64:.data:8192",
      "base-reloc:dir64:.data:10000",
    ]);
  });

  test("rejects duplicate addr64 base relocation keys before linked-layout construction", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "absolute64:a",
        sectionKey: ".data",
        offsetBytes: 0,
        family: "addr64",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Target.main" },
      }),
      relocationForLinkTest({
        stableKey: "absolute64:b",
        sectionKey: ".data",
        offsetBytes: 0,
        family: "addr64",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Target.main" },
      }),
    ]);

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected duplicate base relocation error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:base-relocation-duplicate:base-reloc:dir64:.data:8192:module:test:reloc:reloc:absolute64:a:module:test:reloc:reloc:absolute64:b",
    ]);
  });

  test("production v1 rejects addr32 absolute patches at application layer", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "absolute32",
        sectionKey: ".data",
        family: "addr32",
        widthBytes: 4,
        target: { kind: "linkage-name", linkageName: "Target.main" },
      }),
    ]);

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:addr32-not-permitted:module:test:reloc:reloc:absolute32",
    ]);
  });

  test("rejects addr64 relocations whose patch width is not 8 bytes", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "absolute64:wrong-width",
        sectionKey: ".data",
        family: "addr64",
        widthBytes: 4,
        target: { kind: "linkage-name", linkageName: "Target.main" },
      }),
    ]);

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:width-invalid:module:test:reloc:.data:absolute64:wrong-width:addr64:module:test:reloc:symbol:target:patch-rva:8192:target-rva:4100:addend:0:width:4:expected:8",
    ]);
  });

  test("rejects 32-bit data relocations whose patch width is not 4 bytes", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "reloc:addr32nb:wrong-width",
        sectionKey: ".data",
        family: "addr32nb",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Target.main" },
      }),
    ]);

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:width-invalid:module:test:reloc:.data:reloc:addr32nb:wrong-width:addr32nb:module:test:reloc:symbol:target:patch-rva:8192:target-rva:4100:addend:0:width:8:expected:4",
    ]);
  });

  test.each([
    {
      family: "addr32nb" as const,
      widthBytes: 4,
      expectedDataBytes: [4, 16, 0, 0, 170, 187, 204, 221],
    },
    {
      family: "rel32" as const,
      widthBytes: 4,
      expectedDataBytes: [4, 240, 255, 255, 170, 187, 204, 221],
    },
    {
      family: "section-relative" as const,
      widthBytes: 4,
      expectedDataBytes: [4, 0, 0, 0, 170, 187, 204, 221],
    },
  ])(
    "patches $family data relocation without base relocation",
    ({ family, widthBytes, expectedDataBytes }) => {
      const input = applicationInputForRelocations([
        relocationForLinkTest({
          stableKey: `reloc:${family}`,
          sectionKey: ".data",
          family,
          widthBytes,
          target: { kind: "linkage-name", linkageName: "Target.main" },
        }),
      ]);

      const result = applyResolvedRelocations(input);

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("expected relocation application");
      expect(
        Array.from(
          result.value.sections.find((section) => section.stableKey === ".data")?.bytes ?? [],
        ),
      ).toEqual([...expectedDataBytes]);
      expect(result.value.baseRelocations).toEqual([]);
    },
  );

  test("diagnoses out-of-range failures with relocation context and allowed range", () => {
    const input = applicationInputForRelocations([
      relocationForLinkTest({
        stableKey: "reloc:branch19:far",
        family: "branch19",
        offsetBytes: 0,
        bitRange: [5, 23],
        target: { kind: "linkage-name", linkageName: "Target.main" },
        encodingOwner: instructionEncodingOwnerForTest("b.cond"),
      }),
    ]);
    const farInput = {
      ...input,
      symbols: input.symbols.map((symbol) =>
        symbol.symbolKey === "module:test:reloc:symbol:target"
          ? Object.freeze({ ...symbol, rva: 2_004_096 })
          : symbol,
      ),
    };

    const result = applyResolvedRelocations(farInput);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:out-of-range:module:test:reloc:.text:reloc:branch19:far:branch19:module:test:reloc:symbol:target:patch-rva:4096:target-rva:2004096:addend:0:allowed:-1048576..1048572",
    ]);
  });

  test("preserves encoder-specific failure details with relocation context", () => {
    const input = applicationInputForRelocations(
      [
        relocationForLinkTest({
          stableKey: "reloc:branch26:unaligned",
          family: "branch26",
          offsetBytes: 0,
          bitRange: [0, 25],
          target: { kind: "linkage-name", linkageName: "Target.main" },
          encodingOwner: instructionEncodingOwnerForTest("b"),
        }),
      ],
      { targetOffsetBytes: 2 },
    );

    const result = applyResolvedRelocations(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "relocation:encoding-failed:relocation:unaligned-branch-distance:module:test:reloc:reloc:reloc:branch26:unaligned:2:module:test:reloc:.text:reloc:branch26:unaligned:branch26:module:test:reloc:symbol:target:patch-rva:4096:target-rva:4098:addend:0:allowed:-134217728..134217724",
    ]);
  });
});

function applicationInputForRelocations(
  relocations: readonly AArch64ObjectRelocation[],
  options: {
    readonly textBytes?: readonly number[];
    readonly dataBytes?: readonly number[];
    readonly targetOffsetBytes?: number;
  } = {},
): ApplyResolvedRelocationsInput {
  const target = targetSurfaceForTest();
  const graph = normalizedGraphForTest({
    target,
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:reloc",
        sections: [
          textSectionForLinkTest({
            stableKey: ".text",
            bytes: options.textBytes ?? Array(8).fill(0),
            alignmentBytes: 4,
          }),
          dataSectionForLinkTest({
            stableKey: ".data",
            bytes: options.dataBytes ?? [0, 0, 0, 0, 170, 187, 204, 221],
            alignmentBytes: 4,
          }),
        ],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "entry",
            linkageName: "Entry.main",
            sectionKey: ".text",
          }),
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Target.main",
            sectionKey: ".text",
            offsetBytes: options.targetOffsetBytes ?? 4,
          }),
        ],
        relocations,
      }),
    ],
  });
  const resolved = resolveLinkSymbols(graph);
  if (resolved.kind !== "ok") throw new Error("expected symbol resolution");
  const layout = layoutImageSections({ target, graph });
  if (layout.kind !== "ok") throw new Error("expected section layout");
  const imageSymbols = materializeResolvedImageSymbols({
    resolvedSymbols: resolved.value,
    layout: layout.value,
  });
  if (imageSymbols.kind !== "ok") throw new Error("expected image symbols");
  const rvaAdjusted = withImageRvas(layout.value.sections, imageSymbols.value.symbols);
  const plannedPairs = planPairedRelocations({
    graph,
    relocationTargets: resolved.value.relocationTargets,
  });
  if (plannedPairs.kind !== "ok") {
    throw new Error(
      `expected pair planning: ${plannedPairs.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(",")}`,
    );
  }

  return {
    target,
    graph,
    sections: rvaAdjusted.sections,
    symbols: rvaAdjusted.symbols,
    relocationTargets: resolved.value.relocationTargets,
    plannedPairs: plannedPairs.value,
  };
}

function withImageRvas(
  sections: readonly LinkedImageSection[],
  symbols: ApplyResolvedRelocationsInput["symbols"],
): Pick<ApplyResolvedRelocationsInput, "sections" | "symbols"> {
  const rvaBySectionKey = new Map([
    [".text", 0x1000],
    [".data", 0x2000],
  ]);
  const originalRvaBySectionKey = new Map(
    sections.map((section) => [section.stableKey, section.rva]),
  );
  return {
    sections: sections.map((section) =>
      Object.freeze({
        ...section,
        rva: rvaBySectionKey.get(section.stableKey) ?? section.rva,
      }),
    ),
    symbols: symbols.map((symbol) => {
      const originalSectionRva = originalRvaBySectionKey.get(symbol.sectionKey) ?? 0;
      const adjustedSectionRva = rvaBySectionKey.get(symbol.sectionKey) ?? originalSectionRva;
      return Object.freeze({
        ...symbol,
        rva: symbol.rva - originalSectionRva + adjustedSectionRva,
      });
    }),
  };
}

function bytesAt(
  sections: readonly LinkedImageSection[],
  sectionKey: string,
  offset: number,
  length: number,
): Uint8Array {
  return (
    sections
      .find((section) => section.stableKey === sectionKey)
      ?.bytes.slice(offset, offset + length) ?? new Uint8Array()
  );
}

function instructionEncodingOwnerForTest(
  opcode: string | AArch64InternalRelocationFamily,
  accessScaleBytes?: number,
) {
  return Object.freeze({
    opcode: String(opcode),
    catalogEntryKey: `encoding:${String(opcode)}`,
    ...(accessScaleBytes === undefined ? {} : { accessScaleBytes }),
  });
}
