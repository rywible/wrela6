import { describe, expect, test } from "bun:test";

import * as compilerApi from "../../../src/compiler-api";
import * as packageRoot from "../../../src";

const documentedFacadeNames = [
  "buildOptimizedOptIr",
  "compileUefiAArch64Image",
  "compileUefiAArch64ImageAsync",
  "compileUefiAArch64ImageWithTraceAsync",
  "compilerMetadataEntries",
  "compilerMetadataValue",
  "constructOptIr",
  "createCompilerStageMetadata",
  "createCompilerStageResult",
  "createUefiAArch64TargetMetadata",
  "fingerprintUefiAArch64ImageBytes",
  "frontendModuleGraphMetadata",
  "loadFrontendModuleGraph",
  "optIrPassesMetadata",
  "releaseEvidenceMetadata",
  "scalarReplacementMetadata",
] as const;

describe("public compiler API facade", () => {
  test("compiler-api exposes only documented runtime facade names", () => {
    expect(Object.keys(compilerApi).sort()).toEqual([...documentedFacadeNames].sort());
  });

  test("root package exports match the compiler-api facade", () => {
    expect(Object.keys(packageRoot).sort()).toEqual([...documentedFacadeNames].sort());
  });
});
