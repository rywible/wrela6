import { describe, expect, test } from "bun:test";

import {
  addr32FixtureForTest,
  addr64Fixture,
  compileTinyAArch64ObjectForLinkTest,
  farBranchModulesForTest,
  farBranchWithoutProviderFixture,
  moduleWithLocalTarget,
  moduleWithTextSection,
  nonExecutableEntryFixture,
  normalizedGraphForTest,
  paddingFixtureForTest,
  pairTargetMismatchFixture,
  symbolRvaFixtureForTest,
  twoModuleCallFixture,
  unresolvedExternalLinkInput,
  unwindInDataSectionFixture,
} from "../../support/linker/aarch64-normalized-link-fixtures";

describe("AArch64 normalized linker fixture helpers", () => {
  test("normalizes default and module helper inputs through production normalization", () => {
    const graph = normalizedGraphForTest();
    const localModule = moduleWithLocalTarget("module:test:local", "local-target");
    const textModule = moduleWithTextSection("module:test:text-helper");
    const helperGraph = normalizedGraphForTest({ objectModules: [textModule, localModule] });

    expect(graph.modules.map((module) => module.moduleKey)).toEqual(["module:test:boot"]);
    expect(graph.modules[0]?.moduleFingerprint).toBeString();
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.modules[0])).toBe(true);
    expect(helperGraph.modules.map((module) => module.moduleKey)).toEqual([
      "module:test:local",
      "module:test:text-helper",
    ]);
    expect(
      helperGraph.modules[0]?.objectModule.symbols.map((symbol) => String(symbol.stableKey)),
    ).toContain("local-target");
    expect(helperGraph.modules[0]?.objectModule.relocations[0]?.target).toEqual({
      kind: "symbol-stable-key",
      stableKey: "local-target",
    });
  });

  test("normalizes call, address, pair, padding, symbol, entry, unwind, and far-branch fixtures", () => {
    const twoModule = normalizedGraphForTest(twoModuleCallFixture());
    const addr64 = addr64Fixture();
    const addr32 = addr32FixtureForTest();
    const pair = pairTargetMismatchFixture();
    const padding = paddingFixtureForTest();
    const symbolRva = symbolRvaFixtureForTest();
    const nonExecutableEntry = normalizedGraphForTest(nonExecutableEntryFixture());
    const unwindInData = normalizedGraphForTest(unwindInDataSectionFixture());
    const farBranchModules = farBranchModulesForTest();
    const farBranch = farBranchWithoutProviderFixture();

    expect(twoModule.modules.map((module) => module.moduleKey)).toEqual([
      "module:test:callee",
      "module:test:caller",
    ]);
    expect(relocationKeys(twoModule)).toEqual(["reloc:caller:callee"]);
    expect(addr64.relocationKey).toBe("reloc:data:addr64");
    expect(relocationFamilies(addr64.graph)).toEqual(["addr64"]);
    expect(addr32.relocationKey).toBe("reloc:data:addr32");
    expect(relocationFamilies(addr32.graph)).toEqual(["addr32"]);
    expect(relocationKeys(pair.graph)).toEqual(["reloc:pair:offset", "reloc:pair:page"]);
    expect(pair.targetSymbolKey).toBe("page");
    expect(padding.orderedModuleKeys).toEqual(["module:test:padding:a", "module:test:padding:b"]);
    expect(padding.graph.modules.map((module) => module.moduleKey)).toEqual([
      "module:test:padding:a",
      "module:test:padding:b",
    ]);
    expect(symbolRva.symbolKey).toBe("main");
    expect(symbolRva.contributionKey).toBe("module:test:symbol-rva:section:.text");
    expect(String(nonExecutableEntry.modules[0]?.objectModule.sections[0]?.stableKey)).toBe(
      ".data",
    );
    expect(unwindInData.modules[0]?.objectModule.unwindRecords[0]).toMatchObject({
      stableKey: "unwind:main",
      sectionKey: ".data",
    });
    expect(farBranchModules.map((module) => module.moduleKey)).toEqual([
      "module:test:far-branch:caller",
      "module:test:far-branch:target",
    ]);
    expect(farBranch.relocationKey).toBe("reloc:far-branch");
    expect(relocationFamilies(farBranch.graph)).toEqual(["branch26"]);
  });

  test("builds unresolved link input and compiles a real tiny backend object", () => {
    const unresolved = unresolvedExternalLinkInput();
    const compiled = compileTinyAArch64ObjectForLinkTest();

    expect(unresolved.entry.wrelaBootLinkageName).toBe("Missing.main");
    expect(unresolved.objectModules[0]?.moduleKey).toBe("module:test:unresolved-external");
    expect(
      normalizedGraphForTest({ objectModules: unresolved.objectModules }).modules,
    ).toHaveLength(1);
    expect(compiled.kind).toBe("ok");
    expect(compiled.objectModule.deterministicMetadata.moduleFingerprint).toBeString();
    expect(compiled.objectModule.deterministicMetadata.recordCounts.sections).toBeNumber();
  });
});

function relocationKeys(graph: ReturnType<typeof normalizedGraphForTest>): readonly string[] {
  return graph.modules.flatMap((module) =>
    module.objectModule.relocations.map((relocation) => String(relocation.stableKey)),
  );
}

function relocationFamilies(graph: ReturnType<typeof normalizedGraphForTest>): readonly string[] {
  return graph.modules.flatMap((module) =>
    module.objectModule.relocations.map((relocation) => relocation.family),
  );
}
