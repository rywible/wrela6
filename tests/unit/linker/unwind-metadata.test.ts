import { describe, expect, test } from "bun:test";

import { materializeLinkedUnwindRecords } from "../../../src/linker/aarch64/aarch64-linked-image";
import { layoutImageSections } from "../../../src/linker/section-layout";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import { materializeResolvedImageSymbols } from "../../../src/linker/symbol-rva";
import {
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
  aarch64ObjectUnwindRecord,
  type AArch64ObjectUnwindRecord,
  type AArch64ObjectSymbol,
} from "../../../src/target/aarch64/backend/object/object-module";
import {
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  localSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { sectionForTest } from "../../support/target/aarch64/backend/object-module-fixtures";
import {
  normalizedGraphForTest,
  unwindInDataSectionFixture,
} from "../../support/linker/aarch64-normalized-link-fixtures";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";
import type { AArch64LinkerTargetSurface } from "../../../src/linker/image-layout-policy";

describe("materializeLinkedUnwindRecords", () => {
  test("materializes linked unwind records and exception data directory source", () => {
    const input = unwindMetadataInput();

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked unwind metadata");
    expect(result.value.unwindRecords).toEqual([
      {
        stableKey: "unwind:main",
        functionSymbolKey: "module:test:unwind:symbol:main",
        functionStartRva: 0,
        functionEndRva: 4,
        unwindInfoSectionKey: ".xdata",
        unwindInfoRva: 0x2000,
      },
    ]);
    expect(result.value.dataDirectorySources).toEqual([
      {
        stableKey: "directory:exception",
        directoryKind: "exception",
        sectionKey: ".pdata",
        rva: 0x1000,
        sizeBytes: 12,
      },
    ]);
    expect(input.sections.find((section) => section.stableKey === ".pdata")?.bytes).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(input.sections.find((section) => section.stableKey === ".xdata")?.bytes).toEqual([
      13, 14, 15, 16,
    ]);
  });

  test("materializes synthetic unwind records that reference functions by external linkage name", () => {
    const input = linkedUnwindInputFromGraph(syntheticUnwindGraphForTest());

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked unwind metadata");
    expect(result.value.unwindRecords).toEqual([
      expect.objectContaining({
        stableKey: "unwind:extern:Boot.main",
        functionSymbolKey: "module:test:boot:symbol:main",
        functionStartRva: 0,
        functionEndRva: 4,
        unwindInfoSectionKey: ".xdata",
      }),
    ]);
  });

  test("rejects ambiguous synthetic unwind external linkage names", () => {
    const graph = ambiguousSyntheticUnwindGraphForTest();
    const layout = layoutImageSections({ target: targetSurfaceForTest(), graph });
    if (layout.kind !== "ok") throw new Error("expected layout");

    const result = materializeLinkedUnwindRecords({
      target: targetSurfaceForTest(),
      graph,
      sections: layout.value.sections,
      symbols: [
        {
          symbolKey: "module:test:boot:a:symbol:main",
          linkageName: "Boot.main",
          binding: "global",
          sourceModuleKey: "module:test:boot:a",
          sectionKey: ".text",
          contributionKey: "module:test:boot:a:section:.text",
          rva: 0,
          objectOffsetBytes: 0,
        },
        {
          symbolKey: "module:test:boot:b:symbol:main",
          linkageName: "Boot.main",
          binding: "global",
          sourceModuleKey: "module:test:boot:b",
          sectionKey: ".text",
          contributionKey: "module:test:boot:b:section:.text",
          rva: 4,
          objectOffsetBytes: 0,
        },
      ],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "image-layout:unwind-function-symbol-ambiguous:unwind:extern:Boot.main:Boot.main:module:test:boot:a:symbol:main:module:test:boot:b:symbol:main",
    ]);
  });

  test("uses the next function symbol in a contribution as the unwind range end", () => {
    const input = linkedUnwindInputFromGraph(twoFunctionContributionGraphForTest());

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked unwind metadata");
    expect(result.value.unwindRecords[0]).toEqual(
      expect.objectContaining({
        functionStartRva: 0,
        functionEndRva: 4,
      }),
    );
  });

  test("does not treat local labels as unwind function boundaries", () => {
    const input = linkedUnwindInputFromGraph(functionWithLocalLabelGraphForTest());

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked unwind metadata");
    expect(result.value.unwindRecords[0]).toEqual(
      expect.objectContaining({
        functionStartRva: 0,
        functionEndRva: 8,
      }),
    );
  });

  test("rejects missing function symbols", () => {
    const input = unwindMetadataInput({ unwindStableKey: "unwind:missing" });

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "image-layout:unwind-function-symbol-missing:unwind:missing:module:test:unwind:missing",
    ]);
  });

  test("rejects duplicate unwind records for the same function", () => {
    const graph = normalizedGraphForTest({
      objectModules: [
        moduleWithUnwindRecords({
          unwindRecords: [
            { stableKey: "unwind:main", sectionKey: ".xdata", frameShape: "leaf" },
            { stableKey: "unwind:main", sectionKey: ".xdata", frameShape: "leaf" },
          ],
        }),
      ],
    });
    const duplicateInput = linkedUnwindInputFromGraph(graph);

    const result = materializeLinkedUnwindRecords(duplicateInput);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "image-layout:duplicate-unwind-record:module:test:unwind:symbol:main:unwind:main",
    ]);
  });

  test("rejects unwind records whose function range is not executable", () => {
    const input = linkedUnwindInputFromGraph(normalizedGraphForTest(unwindInDataSectionFixture()));

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "image-layout:unwind-function-not-executable:unwind:main:.data",
    ]);
  });

  test("rejects unwind-info RVAs outside target unwind data sections", () => {
    const input = unwindMetadataInput({ unwindSectionKey: ".pdata" });

    const result = materializeLinkedUnwindRecords(input);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "image-layout:unwind-info-not-in-xdata:unwind:main:.pdata",
    ]);
  });

  test("derives exception data directory source from target unwind pdata mapping", () => {
    const input = unwindMetadataInput();
    const target = targetWithOutputSectionMapping(input.target, "unwind-pdata", ".pdata.alt");
    const sections = input.sections.map((section) =>
      section.stableKey === ".pdata"
        ? {
            ...section,
            stableKey: ".pdata.alt",
            contributions: section.contributions.map((contribution) => ({
              ...contribution,
              outputSectionKey: ".pdata.alt",
            })),
          }
        : section,
    );

    const result = materializeLinkedUnwindRecords({ ...input, target, sections });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected linked unwind metadata");
    expect(result.value.dataDirectorySources).toEqual([
      {
        stableKey: "directory:exception",
        directoryKind: "exception",
        sectionKey: ".pdata.alt",
        rva: 0x1000,
        sizeBytes: 12,
      },
    ]);
  });
});

function unwindMetadataInput(
  input: {
    readonly unwindStableKey?: string;
    readonly unwindStableKeys?: readonly string[];
    readonly unwindSectionKey?: string;
  } = {},
): Parameters<typeof materializeLinkedUnwindRecords>[0] {
  return linkedUnwindInputFromGraph(
    normalizedGraphForTest({
      objectModules: [
        moduleWithUnwindRecords({
          unwindRecords: (input.unwindStableKeys ?? [input.unwindStableKey ?? "unwind:main"]).map(
            (stableKey) => ({
              stableKey,
              sectionKey: input.unwindSectionKey ?? ".xdata",
              frameShape: "leaf",
            }),
          ),
        }),
      ],
    }),
  );
}

function linkedUnwindInputFromGraph(
  graph: ReturnType<typeof normalizedGraphForTest>,
): Parameters<typeof materializeLinkedUnwindRecords>[0] {
  const target = targetSurfaceForTest();
  const resolvedSymbols = resolveLinkSymbols(graph);
  const layout = layoutImageSections({ target, graph });

  if (resolvedSymbols.kind !== "ok") throw new Error("expected resolved symbols");
  if (layout.kind !== "ok") throw new Error("expected laid out sections");

  const symbols = materializeResolvedImageSymbols({
    resolvedSymbols: resolvedSymbols.value,
    layout: layout.value,
  });
  if (symbols.kind !== "ok") throw new Error("expected materialized symbols");

  return {
    target,
    graph,
    sections: layout.value.sections,
    symbols: symbols.value.symbols,
  };
}

function moduleWithUnwindRecords(input: {
  readonly unwindRecords: readonly {
    readonly stableKey: string;
    readonly sectionKey: string;
    readonly frameShape: string;
  }[];
  readonly symbols?: readonly AArch64ObjectSymbol[];
  readonly textBytes?: readonly number[];
}) {
  const base = objectModuleForLinkTest({
    moduleKey: "module:test:unwind",
    sections: [
      textSectionForLinkTest({
        stableKey: ".text",
        bytes: input.textBytes ?? [0xc0, 0x03, 0x5f, 0xd6],
      }),
      sectionForTest({
        stableKey: ".pdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
        alignmentBytes: 4,
        bytes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      }),
      sectionForTest({
        stableKey: ".xdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
        alignmentBytes: 4,
        bytes: [13, 14, 15, 16],
      }),
    ],
    symbols: input.symbols ?? [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text",
      }),
    ],
  });

  return {
    ...base,
    objectModule: Object.freeze({
      ...base.objectModule,
      unwindRecords: Object.freeze(
        input.unwindRecords.map((record) =>
          aarch64ObjectUnwindRecord({
            stableKey: record.stableKey,
            sectionKey: record.sectionKey,
            frameShape: record.frameShape,
          }),
        ),
      ) as readonly AArch64ObjectUnwindRecord[],
    }),
  };
}

function syntheticUnwindGraphForTest(): ReturnType<typeof normalizedGraphForTest> {
  return normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:boot",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
          }),
        ],
      }),
      moduleWithSyntheticUnwindRecordForTest(),
    ],
  });
}

function ambiguousSyntheticUnwindGraphForTest(): ReturnType<typeof normalizedGraphForTest> {
  return normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:boot:a",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
          }),
        ],
      }),
      objectModuleForLinkTest({
        moduleKey: "module:test:boot:b",
        sections: [textSectionForLinkTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
          }),
        ],
      }),
      moduleWithSyntheticUnwindRecordForTest(),
    ],
  });
}

function moduleWithSyntheticUnwindRecordForTest() {
  const base = objectModuleForLinkTest({
    moduleKey: "module:synthetic:aarch64-unwind:unwind",
    sections: [
      sectionForTest({
        stableKey: ".pdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
        alignmentBytes: 4,
        bytes: [1, 2, 3, 4],
      }),
      sectionForTest({
        stableKey: ".xdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
        alignmentBytes: 4,
        bytes: [5, 6, 7, 8],
      }),
    ],
    symbols: [
      externalSymbolForLinkTest({
        stableKey: "extern:Boot.main",
        linkageName: "Boot.main",
      }),
    ],
  });

  return {
    ...base,
    objectModule: Object.freeze({
      ...base.objectModule,
      unwindRecords: Object.freeze([
        aarch64ObjectUnwindRecord({
          stableKey: "unwind:extern:Boot.main",
          sectionKey: ".xdata",
          frameShape: "leaf",
        }),
      ]) as readonly AArch64ObjectUnwindRecord[],
    }),
  };
}

function targetWithOutputSectionMapping(
  target: AArch64LinkerTargetSurface,
  objectSectionClass: string,
  outputSectionKey: string,
): AArch64LinkerTargetSurface {
  return {
    ...target,
    outputSectionByObjectClass: {
      get(key: string) {
        return key === objectSectionClass
          ? outputSectionKey
          : target.outputSectionByObjectClass.get(key);
      },
      has(key: string) {
        return key === objectSectionClass || target.outputSectionByObjectClass.has(key);
      },
      entries() {
        return target.outputSectionByObjectClass.entries();
      },
    },
  };
}

function twoFunctionContributionGraphForTest(): ReturnType<typeof normalizedGraphForTest> {
  return normalizedGraphForTest({
    objectModules: [
      moduleWithUnwindRecords({
        unwindRecords: [{ stableKey: "unwind:main", sectionKey: ".xdata", frameShape: "leaf" }],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
            offsetBytes: 0,
          }),
          globalSymbolForLinkTest({
            stableKey: "next",
            linkageName: "Boot.next",
            sectionKey: ".text",
            offsetBytes: 4,
          }),
        ],
        textBytes: [0, 0, 0, 0, 1, 1, 1, 1],
      }),
    ],
  });
}

function functionWithLocalLabelGraphForTest(): ReturnType<typeof normalizedGraphForTest> {
  return normalizedGraphForTest({
    objectModules: [
      moduleWithUnwindRecords({
        unwindRecords: [{ stableKey: "unwind:main", sectionKey: ".xdata", frameShape: "leaf" }],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "Boot.main",
            sectionKey: ".text",
            offsetBytes: 0,
          }),
          localSymbolForLinkTest({
            stableKey: "main:loop",
            sectionKey: ".text",
            offsetBytes: 4,
          }),
        ],
        textBytes: [0, 0, 0, 0, 1, 1, 1, 1],
      }),
    ],
  });
}
