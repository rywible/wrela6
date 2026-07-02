import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { linkAArch64Image, type AArch64LinkInputModule } from "../../../src/linker";
import { applyResolvedRelocations } from "../../../src/linker/relocation-application";
import { layoutImageSections } from "../../../src/linker/section-layout";
import { materializeResolvedImageSymbols } from "../../../src/linker/symbol-rva";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import type { LinkedImageSection } from "../../../src/linker/linked-image-layout";
import {
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { normalizedGraphForTest } from "../../support/linker/aarch64-normalized-link-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../../support/linker/linker-fixtures";

const FAST_CHECK_OPTIONS = { numRuns: 25, seed: 2401 };

describe("linker properties", () => {
  test("random contribution and input module order produces identical layout fingerprints and labels", () => {
    fastCheck.assert(
      fastCheck.property(
        extraModuleIds(),
        fastCheck.shuffledSubarray([0, 1, 2, 3], { minLength: 4 }),
        (ids, order) => {
          const modules = [
            bootPropertyModuleForTest(),
            ...ids.map((id) => propertyModuleForTest(id)),
          ];
          const shuffledModules = order.map((index) => modules[index]!);
          const first = linkPropertyImage(modules);
          const second = linkPropertyImage(shuffledModules);

          expect(first.kind).toBe("ok");
          expect(second.kind).toBe("ok");
          if (first.kind !== "ok" || second.kind !== "ok")
            throw new Error("expected linked images");
          expect(second.layout.deterministicMetadata.layoutFingerprint).toBe(
            first.layout.deterministicMetadata.layoutFingerprint,
          );
          expect(layoutLabels(second.layout.sections)).toEqual(layoutLabels(first.layout.sections));
        },
      ),
      FAST_CHECK_OPTIONS,
    );
  });

  test("valid symbol tables resolve deterministically under input shuffling", () => {
    fastCheck.assert(
      fastCheck.property(
        uniqueModuleIds(),
        fastCheck.shuffledSubarray([0, 1, 2, 3], { minLength: 4 }),
        (ids, order) => {
          const modules = ids.map((id, index) =>
            referenceModuleForTest(id, ids[(index + 1) % ids.length]!),
          );
          const shuffledModules = order.map((index) => modules[index]!);
          const first = resolveLinkSymbols(normalizedGraphForTest({ objectModules: modules }));
          const second = resolveLinkSymbols(
            normalizedGraphForTest({ objectModules: shuffledModules }),
          );

          expect(first.kind).toBe("ok");
          expect(second.kind).toBe("ok");
          if (first.kind !== "ok" || second.kind !== "ok")
            throw new Error("expected symbol resolution");
          expect(second.value).toEqual(first.value);
        },
      ),
      FAST_CHECK_OPTIONS,
    );
  });

  test("generated relocation patches are confined to declared field slices", () => {
    fastCheck.assert(
      fastCheck.property(
        fastCheck.integer({ min: 0, max: 2 }),
        fastCheck.integer({ min: 0, max: 4 }),
        (familyIndex, targetWordOffset) => {
          const families = [
            { family: "branch26" as const, bitRange: [0, 25] as const },
            { family: "branch19" as const, bitRange: [5, 23] as const },
            { family: "branch14" as const, bitRange: [5, 18] as const },
          ];
          const selected = families[familyIndex] ?? families[0]!;
          const input = relocationApplicationInputForTest({
            family: selected.family,
            bitRange: selected.bitRange,
            targetOffsetBytes: 4 + targetWordOffset * 4,
          });

          const result = applyResolvedRelocations(input);

          expect(result.kind).toBe("ok");
          if (result.kind !== "ok") throw new Error("expected relocation application");
          const before = wordFromBytes(input.sections[0]?.bytes ?? []);
          const after = wordFromBytes(result.value.sections[0]?.bytes ?? []);
          const changedMask = (before ^ after) >>> 0;
          expect(changedMask & ~bitMask(selected.bitRange)).toBe(0);
        },
      ),
      FAST_CHECK_OPTIONS,
    );
  });

  test("byte provenance remains a partition of output section bytes", () => {
    fastCheck.assert(
      fastCheck.property(extraModuleIds(), (ids) => {
        const result = linkPropertyImage([
          bootPropertyModuleForTest(),
          ...ids.map((id) => propertyModuleForTest(id)),
        ]);

        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") throw new Error("expected linked image");
        for (const section of result.layout.sections) {
          const coverage = Array(section.bytes.length).fill(0);
          for (const record of result.layout.provenance.filter(
            (candidate) => candidate.sectionKey === section.stableKey,
          )) {
            const startOffset = record.rva - section.rva;
            for (let offset = startOffset; offset < startOffset + record.byteLength; offset += 1) {
              coverage[offset] += 1;
            }
          }
          expect(coverage).toEqual(Array(section.bytes.length).fill(1));
        }
      }),
      FAST_CHECK_OPTIONS,
    );
  });

  test("linker source keeps import boundaries dependency-free", async () => {
    const forbiddenImports: string[] = [];

    for (const path of linkerSourceFiles("src/linker")) {
      const source = readFileSync(path, "utf8");
      const imports = [
        ...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g),
      ];
      for (const [, specifier] of imports) {
        if (specifier !== undefined && isForbiddenImport(path, specifier)) {
          forbiddenImports.push(`${path}:${specifier}`);
        }
      }
    }

    expect(forbiddenImports.sort()).toEqual([]);
  });

  test("linker import-boundary helper catches relative subsystem imports", () => {
    const sourcePath = "src/linker/aarch64/example.ts";

    expect(isForbiddenImport(sourcePath, "../../frontend")).toBe(true);
    expect(isForbiddenImport(sourcePath, "../../opt-ir/passes/loop-vectorization")).toBe(true);
    expect(isForbiddenImport(sourcePath, "../../pe-writer")).toBe(true);
    expect(isForbiddenImport(sourcePath, "../section-layout")).toBe(false);
  });
});

function linkerSourceFiles(directoryPath: string): readonly string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) return [...linkerSourceFiles(entryPath)];
    return entry.isFile() && entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

function linkPropertyImage(objectModules: readonly AArch64LinkInputModule[]) {
  return linkAArch64Image({
    objectModules,
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });
}

function uniqueModuleIds() {
  return fastCheck.uniqueArray(fastCheck.integer({ min: 0, max: 20 }), {
    minLength: 4,
    maxLength: 4,
  });
}

function extraModuleIds() {
  return fastCheck.uniqueArray(fastCheck.integer({ min: 1, max: 20 }), {
    minLength: 3,
    maxLength: 3,
  });
}

function bootPropertyModuleForTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:property:boot",
    sections: [textSectionForLinkTest({ stableKey: ".text.property.boot" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "entry",
        linkageName: "Boot.main",
        sectionKey: ".text.property.boot",
      }),
    ],
  });
}

function propertyModuleForTest(id: number): AArch64LinkInputModule {
  const sectionKey = `.text.property.${id}`;
  return objectModuleForLinkTest({
    moduleKey: `module:test:property:${id}`,
    sections: [textSectionForLinkTest({ stableKey: sectionKey, bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "entry",
        linkageName: `Property.${id}`,
        sectionKey,
      }),
    ],
  });
}

function referenceModuleForTest(id: number, targetId: number): AArch64LinkInputModule {
  const sectionKey = `.text.symbol.${id}`;
  return objectModuleForLinkTest({
    moduleKey: `module:test:symbol:${id}`,
    sections: [textSectionForLinkTest({ stableKey: sectionKey })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "entry",
        linkageName: `Symbol.${id}`,
        sectionKey,
      }),
      externalSymbolForLinkTest({
        stableKey: `extern:Symbol.${targetId}`,
        linkageName: `Symbol.${targetId}`,
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "call-next",
        sectionKey,
        target: { kind: "linkage-name", linkageName: `Symbol.${targetId}` },
        encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
      }),
    ],
  });
}

function relocationApplicationInputForTest(input: {
  readonly family: "branch26" | "branch19" | "branch14";
  readonly bitRange: readonly [number, number];
  readonly targetOffsetBytes: number;
}) {
  const graph = normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:patch-confinement",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: Array(28).fill(0) })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "source",
            linkageName: "Patch.source",
            sectionKey: ".text",
          }),
          globalSymbolForLinkTest({
            stableKey: "target",
            linkageName: "Patch.target",
            sectionKey: ".text",
            offsetBytes: input.targetOffsetBytes,
          }),
        ],
        relocations: [
          relocationForLinkTest({
            stableKey: "reloc:field",
            sectionKey: ".text",
            family: input.family,
            target: { kind: "linkage-name", linkageName: "Patch.target" },
            bitRange: input.bitRange,
            encodingOwner: {
              opcode: input.family === "branch26" ? "bl" : "b.cond",
              catalogEntryKey: `encoding:${input.family}`,
            },
          }),
        ],
      }),
    ],
  });
  const symbols = resolveLinkSymbols(graph);
  if (symbols.kind !== "ok") throw new Error("expected symbol resolution");
  const sections = layoutImageSections({ graph, target: targetSurfaceForTest() });
  if (sections.kind !== "ok") throw new Error("expected section layout");
  const resolvedSymbols = materializeResolvedImageSymbols({
    resolvedSymbols: symbols.value,
    layout: sections.value,
  });
  if (resolvedSymbols.kind !== "ok") throw new Error("expected symbol rvas");

  return {
    graph,
    sections: sections.value.sections,
    symbols: resolvedSymbols.value.symbols,
    relocationTargets: symbols.value.relocationTargets,
    target: targetSurfaceForTest(),
    plannedPairs: [],
  };
}

function layoutLabels(sections: readonly LinkedImageSection[]) {
  return sections.map((section) => ({
    stableKey: section.stableKey,
    rva: section.rva,
    virtualSizeBytes: section.virtualSizeBytes,
    contributions: section.contributions.map((contribution) => ({
      stableKey: contribution.stableKey,
      offsetBytes: contribution.offsetBytes,
      sizeBytes: contribution.sizeBytes,
    })),
  }));
}

function wordFromBytes(bytes: readonly number[]): number {
  return (
    (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8) | ((bytes[2] ?? 0) << 16) | ((bytes[3] ?? 0) << 24)
  );
}

function bitMask(bitRange: readonly [number, number]): number {
  let mask = 0;
  for (let bit = bitRange[0]; bit <= bitRange[1]; bit += 1) {
    mask |= 1 << bit;
  }
  return mask >>> 0;
}

function isForbiddenImport(sourcePath: string, specifier: string): boolean {
  const normalizedSpecifier = normalizedImportSpecifier(sourcePath, specifier);
  const segments = normalizedSpecifier.split("/").filter((segment) => segment.length > 0);

  return (
    specifier === "bun" ||
    specifier.startsWith("bun:") ||
    specifier === "fs" ||
    specifier.startsWith("fs/") ||
    specifier === "node:fs" ||
    specifier.startsWith("node:fs/") ||
    specifier === "path" ||
    specifier === "node:path" ||
    specifier === "process" ||
    specifier === "node:process" ||
    specifier === "os" ||
    specifier === "node:os" ||
    segments.includes("frontend") ||
    segments.includes("parser") ||
    segments.includes("proof-check") ||
    segments.includes("proof-checker") ||
    includesSegmentSequence(segments, ["opt-ir", "passes"]) ||
    segments.includes("pe-writer") ||
    includesSegmentSequence(segments, ["writer", "pe"])
  );
}

function normalizedImportSpecifier(sourcePath: string, specifier: string): string {
  const importPath = specifier.startsWith(".") ? join(dirname(sourcePath), specifier) : specifier;
  return normalize(importPath).replaceAll("\\", "/");
}

function includesSegmentSequence(
  segments: readonly string[],
  sequence: readonly string[],
): boolean {
  return segments.some((segment, index) =>
    sequence.every((expected, offset) => segments[index + offset] === expected),
  );
}
