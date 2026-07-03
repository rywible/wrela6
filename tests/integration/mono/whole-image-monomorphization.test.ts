import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic/item-index";
import { CoreTypeCatalog, resolveNames } from "../../../src/semantic/names";
import { checkSemanticSurface } from "../../../src/semantic/surface";
import { buildLayoutTypeResolutionTable } from "../../../src/layout/layout-type-resolution";
import type { HirImage } from "../../../src/hir/hir";
import { lowerTypedHir } from "../../../src/hir";
import { hirOriginId } from "../../../src/hir/ids";
import {
  monomorphizeWholeImage,
  seedMonoRootWork,
  selectMonoImageRoot,
} from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { functionId, imageId, itemId, targetTypeId } from "../../../src/semantic/ids";
import { uefiAArch64CompilerIntrinsicNameCatalog } from "../../../src/target/uefi-aarch64";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";
import { platformPrimitiveNameCatalogFake } from "../../support/semantic/name-resolution-fakes";
import { semanticTargetSurfaceFake } from "../../support/semantic/semantic-surface-fakes";
import {
  genericPacketProgramForMonoTest,
  minimalClosedProgramForMonoTest,
  minimalSelectedImageProgramForMonoTest,
  packageModuleReachabilityProgramForMonoTest,
  replacementStdlibReachabilityProgramForMonoTest,
  vendoredStdlibReachabilityProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

function imageWithoutEntry(): HirImage {
  return {
    imageId: imageId(1),
    itemId: itemId(0),
    devices: [],
    sourceOrigin: hirOriginId(0),
  };
}

function programWithReachableUefiCompilerIntrinsic() {
  const graph = parseModuleGraphForTest([
    [
      "main.wr",
      [
        "fn marker() -> Utf16Static:",
        '    utf16_static("OK\\r\\n")',
        "uefi image Boot:",
        "    fn main() -> Never:",
        "        marker()",
        "        return",
      ].join("\n"),
    ],
  ]);
  const index = buildItemIndex({ graph }).index;
  const coreTypes = CoreTypeCatalog.default();
  const targetSurface = semanticTargetSurfaceFake({
    targetTypeKinds: [{ targetTypeId: targetTypeId("uefi.Utf16Static"), kind: "Copy" }],
  });
  const names = resolveNames({
    graph,
    index,
    coreTypes,
    platformPrimitiveNames: platformPrimitiveNameCatalogFake([]),
    compilerIntrinsics: uefiAArch64CompilerIntrinsicNameCatalog(),
    targetTypes: targetSurface.targetTypeKinds,
  });
  const surface = checkSemanticSurface({
    graph,
    index,
    references: names.references,
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface,
  });
  const typedHir = lowerTypedHir({
    graph,
    index,
    references: names.references,
    coreTypes,
    program: surface.program,
    image: surface.image,
  });
  expect(typedHir.diagnostics).toEqual([]);
  return typedHir.program;
}

test("monomorphizer reports missing selected image before graph work", () => {
  const program = minimalSelectedImageProgramForMonoTest({ images: [] });
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    monoDiagnosticCode("MONO_MISSING_SELECTED_IMAGE"),
  ]);
});

test("root seeding returns deterministic initial work items", () => {
  const program = minimalSelectedImageProgramForMonoTest();
  const selected = selectMonoImageRoot({ program });

  expect(selected.kind).toBe("ok");
  if (selected.kind === "ok") {
    expect(seedMonoRootWork({ program, image: selected.image }).map((item) => item.kind)).toEqual([
      "imageProofMetadata",
      "function",
    ]);
  }
});

test("minimal non-generic selected image closes to an ok monomorphized program", () => {
  const result = monomorphizeWholeImage({ program: minimalClosedProgramForMonoTest() });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().length).toBeGreaterThan(0);
    expect(result.program.types.entries()).toEqual([]);
    expect(result.program.proofMetadata.obligations.entries()).toEqual([]);
    expect(result.reachablePlatformPrimitiveIds).toEqual([]);
  }
});

test("reachable compiler intrinsic calls close without fake call targets", () => {
  const result = monomorphizeWholeImage({ program: programWithReachableUefiCompilerIntrinsic() });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  const intrinsicCalls = result.program.functions
    .entries()
    .flatMap((func) => func.bodyIndex?.expressions.entries() ?? [])
    .filter((expression) => expression.kind.kind === "call")
    .map((expression) => (expression.kind.kind === "call" ? expression.kind.call : undefined))
    .filter((call) => call?.compilerIntrinsic !== undefined);

  expect(intrinsicCalls).toHaveLength(1);
  expect(intrinsicCalls[0]?.resolvedTarget).toBeUndefined();
  expect(intrinsicCalls[0]?.compilerIntrinsic?.intrinsicKey).toBe("uefi.utf16_static");
});

test("project function reaches vendored stdlib declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: vendoredStdlibReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(700),
    );
  }
});

test("project function reaches replacement stdlib declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: replacementStdlibReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(710),
    );
  }
});

test("project function reaches package module declaration through ordinary HIR graph", () => {
  const result = monomorphizeWholeImage({
    program: packageModuleReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.program.functions.entries().map((entry) => entry.sourceFunctionId)).toContain(
      functionId(720),
    );
  }
});

test("monomorphization preserves instantiated external roots", () => {
  const program = genericPacketProgramForMonoTest();
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(result.program.externalRoots.map((root) => root.reason)).toEqual([
    "imageEntry",
    "targetRequired",
  ]);
  expect(result.program.externalRoots.every((root) => root.functionInstanceId.length > 0)).toBe(
    true,
  );
  expect(
    result.program.externalRoots.find((root) => root.reason === "imageEntry")?.functionInstanceId,
  ).toBe(result.program.image.entryFunctionInstanceId);
});

test("missing selected image entry is diagnosed before producing external roots", () => {
  const program = minimalSelectedImageProgramForMonoTest({
    images: [imageWithoutEntry()],
  });
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      monoDiagnosticCode("MONO_SELECTED_IMAGE_ENTRY_MISSING"),
    ]);
  }
});

test("layout computes type resolutions for reachable source and core types", () => {
  const program = genericPacketProgramForMonoTest();
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const entries = buildLayoutTypeResolutionTable(result.program).table.entries();
  expect(entries.some((entry) => entry.key.kind === "source")).toBe(true);
  expect(entries.some((entry) => entry.key.kind === "core")).toBe(true);
  for (const entry of entries) {
    expect(
      buildLayoutTypeResolutionTable(result.program).table.getByFingerprint(
        entry.checkedTypeFingerprint,
      ),
    ).toEqual(entry);
  }
});
