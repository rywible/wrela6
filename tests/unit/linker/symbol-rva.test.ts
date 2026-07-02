import { describe, expect, test } from "bun:test";

import { layoutImageSections } from "../../../src/linker/section-layout";
import {
  materializeResolvedImageSymbols,
  type MaterializeResolvedImageSymbolsInput,
} from "../../../src/linker/symbol-rva";
import { resolveLinkSymbols } from "../../../src/linker/symbol-resolution";
import {
  dataSectionForLinkTest,
  externalSymbolForLinkTest,
  globalSymbolForLinkTest,
  localSymbolForLinkTest,
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../support/linker/aarch64-object-link-fixtures";
import { normalizedGraphForTest } from "../../support/linker/aarch64-normalized-link-fixtures";
import { targetSurfaceForTest } from "../../support/linker/linker-fixtures";

describe("materializeResolvedImageSymbols", () => {
  test("materializes symbol rva from contribution rva and object offset", () => {
    const input = symbolRvaFixtureForTest();

    const result = materializeResolvedImageSymbols(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbols");
    expect(result.value.symbols).toContainEqual({
      symbolKey: "module:test:symbol-rva:symbol:main",
      linkageName: "SymbolRva.main",
      binding: "global",
      sourceModuleKey: "module:test:symbol-rva",
      sectionKey: ".text",
      contributionKey: "module:test:symbol-rva:section:.text",
      rva: 12,
      objectOffsetBytes: 8,
    });
  });

  test("materializes every defined local and global symbol once while skipping externals", () => {
    const input = symbolRvaFixtureForTest();

    const result = materializeResolvedImageSymbols(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbols");
    expect(result.value.symbols.map((symbol) => symbol.symbolKey)).toEqual([
      "module:test:external-provider:symbol:external-main",
      "module:test:symbol-rva:symbol:local:loop",
      "module:test:symbol-rva:symbol:main",
    ]);
    expect(
      result.value.symbols.some(
        (symbol) => symbol.symbolKey === "module:test:symbol-rva:symbol:extern:External.main",
      ),
    ).toBe(false);
  });

  test("rejects symbols outside their contribution", () => {
    const input = symbolRvaFixtureForTest();
    const symbols = input.resolvedSymbols.symbols.map((symbol) =>
      symbol.symbolKey === "module:test:symbol-rva:symbol:main"
        ? { ...symbol, objectOffsetBytes: 16 }
        : symbol,
    );

    const result = materializeResolvedImageSymbols({
      ...input,
      resolvedSymbols: { ...input.resolvedSymbols, symbols },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "symbol-rva:symbol-offset-outside-contribution:module:test:symbol-rva:symbol:main:16:module:test:symbol-rva:section:.text:12",
    ]);
  });

  test("allows symbols at the end of their contribution", () => {
    const input = symbolRvaFixtureForTest();
    const symbols = input.resolvedSymbols.symbols.map((symbol) =>
      symbol.symbolKey === "module:test:symbol-rva:symbol:main"
        ? { ...symbol, objectOffsetBytes: 12 }
        : symbol,
    );

    const result = materializeResolvedImageSymbols({
      ...input,
      resolvedSymbols: { ...input.resolvedSymbols, symbols },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected symbols");
    expect(result.value.symbols).toContainEqual({
      symbolKey: "module:test:symbol-rva:symbol:main",
      linkageName: "SymbolRva.main",
      binding: "global",
      sourceModuleKey: "module:test:symbol-rva",
      sectionKey: ".text",
      contributionKey: "module:test:symbol-rva:section:.text",
      rva: 16,
      objectOffsetBytes: 12,
    });
  });

  test("rejects symbols in sections that did not contribute to layout", () => {
    const input = symbolRvaFixtureForTest();
    const symbols = input.resolvedSymbols.symbols.map((symbol) =>
      symbol.symbolKey === "module:test:symbol-rva:symbol:main"
        ? { ...symbol, objectSectionKey: ".debug$wrela", objectOffsetBytes: 0 }
        : symbol,
    );

    const result = materializeResolvedImageSymbols({
      ...input,
      resolvedSymbols: { ...input.resolvedSymbols, symbols },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "symbol-rva:missing-layout-contribution:module:test:symbol-rva:symbol:main:module:test:symbol-rva:.debug$wrela",
    ]);
  });
});

function symbolRvaFixtureForTest(): MaterializeResolvedImageSymbolsInput {
  const graph = normalizedGraphForTest({
    objectModules: [
      objectModuleForLinkTest({
        moduleKey: "module:test:symbol-rva",
        sections: [
          textSectionForLinkTest({
            stableKey: ".text",
            bytes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          }),
          dataSectionForLinkTest({ stableKey: ".data", bytes: [12, 13, 14, 15] }),
        ],
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "main",
            linkageName: "SymbolRva.main",
            sectionKey: ".text",
            offsetBytes: 8,
          }),
          localSymbolForLinkTest({
            stableKey: "local:loop",
            sectionKey: ".text",
            offsetBytes: 4,
          }),
          externalSymbolForLinkTest({
            stableKey: "extern:External.main",
            linkageName: "External.main",
          }),
        ],
      }),
      objectModuleForLinkTest({
        moduleKey: "module:test:external-provider",
        symbols: [
          globalSymbolForLinkTest({
            stableKey: "external-main",
            linkageName: "External.main",
            sectionKey: ".text",
          }),
        ],
      }),
    ],
  });
  const resolvedSymbols = resolveLinkSymbols(graph);
  const layout = layoutImageSections({ target: targetSurfaceForTest(), graph });

  if (resolvedSymbols.kind !== "ok") throw new Error("expected symbol resolution fixture");
  if (layout.kind !== "ok") throw new Error("expected section layout fixture");

  return {
    resolvedSymbols: resolvedSymbols.value,
    layout: layout.value,
  };
}
