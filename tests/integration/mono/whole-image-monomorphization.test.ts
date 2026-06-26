import { expect, test } from "bun:test";
import { buildLayoutTypeResolutionTable } from "../../../src/layout/layout-type-resolution";
import {
  monomorphizeWholeImage,
  seedMonoRootWork,
  selectMonoImageRoot,
} from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { functionId } from "../../../src/semantic/ids";
import {
  genericPacketProgramForMonoTest,
  minimalClosedProgramForMonoTest,
  minimalSelectedImageProgramForMonoTest,
  packageModuleReachabilityProgramForMonoTest,
  replacementStdlibReachabilityProgramForMonoTest,
  vendoredStdlibReachabilityProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

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
