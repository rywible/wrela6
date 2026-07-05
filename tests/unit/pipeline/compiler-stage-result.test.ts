import { describe, expect, test } from "bun:test";

import {
  compilerMetadataEntries,
  compilerMetadataValue,
  createCompilerStageMetadata,
  createCompilerStageResult,
  frontendModuleGraphMetadata,
  optIrPassesMetadata,
  releaseEvidenceMetadata,
  scalarReplacementMetadata,
  type CompilerStage,
  type CompilerStageMetadata,
} from "../../../src/pipeline";

const runCompileTimeMetadataAssertions = undefined as unknown as boolean;

describe("compiler stage result contracts", () => {
  test("exposes the documented compiler stage union", () => {
    const stages: readonly CompilerStage[] = [
      "frontend",
      "semantic",
      "hir",
      "opt-ir",
      "target",
      "package",
      "validation",
    ];

    expect(stages).toEqual([
      "frontend",
      "semantic",
      "hir",
      "opt-ir",
      "target",
      "package",
      "validation",
    ]);
  });

  test("stores metadata immutably with deterministic key ordering", () => {
    const metadata = createCompilerStageMetadata([
      optIrPassesMetadata({ passIds: ["scalar-replacement", "dce"] }),
      scalarReplacementMetadata({ replacedRegionIds: ["r2", "r1"], rejectedCandidates: [] }),
      releaseEvidenceMetadata({ evidenceIds: ["release:2", "release:1"] }),
    ]);

    expect(Object.isFrozen(metadata)).toBe(true);
    expect(compilerMetadataEntries(metadata).map((entry) => entry.key)).toEqual([
      "optIrPasses",
      "releaseEvidence",
      "scalarReplacement",
    ]);
    expect(compilerMetadataValue(metadata, "scalarReplacement")).toEqual({
      replacedRegionIds: ["r2", "r1"],
      rejectedCandidates: [],
    });
  });

  test("freezes stage results and diagnostics snapshots", () => {
    const result = createCompilerStageResult({
      stage: "frontend",
      value: { graph: "parsed" },
      diagnostics: ["diagnostic"],
      metadata: createCompilerStageMetadata([
        frontendModuleGraphMetadata({ moduleKeys: ["main.wr"], edgeCount: 0 }),
      ]),
    });

    expect(result.kind).toBe("ok");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(compilerMetadataValue(result.metadata, "frontendModuleGraph")).toEqual({
      moduleKeys: ["main.wr"],
      edgeCount: 0,
    });
  });

  test("metadata helpers reject payloads for the wrong key at compile time", () => {
    const metadata: CompilerStageMetadata = createCompilerStageMetadata([
      scalarReplacementMetadata({ replacedRegionIds: [], rejectedCandidates: [] }),
    ]);

    expect(compilerMetadataValue(metadata, "scalarReplacement")).toEqual({
      replacedRegionIds: [],
      rejectedCandidates: [],
    });

    if (runCompileTimeMetadataAssertions) {
      // @ts-expect-error optIrPasses metadata requires passIds.
      optIrPassesMetadata({ replacedRegionIds: [] });

      // @ts-expect-error frontendModuleGraph metadata is not scalarReplacement metadata.
      scalarReplacementMetadata({ moduleKeys: [], edgeCount: 0 });
    }
  });
});
