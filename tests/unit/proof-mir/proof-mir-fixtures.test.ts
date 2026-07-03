import { describe, expect, test } from "bun:test";
import { proofMirDiagnostic, proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import { targetId } from "../../../src/semantic/ids";
import {
  closedProofMirFixture,
  monoAndLayoutForTypedHirProgram,
  platformCallProofMirFixture,
  proofMirBuildInputForSource,
  proofMirImageDeviceBuildInput,
  proofMirPlatformPrimitiveBuildInput,
  proofMirSummary,
  readTagWorkedExampleFixture,
  validatedBufferProofMirLayoutFixture,
  validatedBufferReadProofMirFixture,
} from "../../support/proof-mir/proof-mir-fixtures";
import { minimalClosedProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

describe("closedProofMirFixture", () => {
  test("creates matching mono and layout inputs", () => {
    const fixture = closedProofMirFixture();

    expect(fixture.layout.imageEntry.imageInstanceId).toBe(fixture.program.image.instanceId);
    expect(fixture.target.runtimeCatalog.targetId).toBe(fixture.target.targetId);
    expect(fixture.target.targetId).toBe(fixture.layout.target.targetId);
    expect(fixture.program.externalRoots.map((root) => root.reason)).toContain("imageEntry");
  });
});

describe("proofMirBuildInputForSource", () => {
  test("lowers minimal closed source through mono and layout", () => {
    const source = ["uefi image Boot:", "    fn main() -> Never:", "        return"].join("\n");
    const input = proofMirBuildInputForSource(source);

    expect(input.program.functions.entries().length).toBeGreaterThan(0);
    expect(input.layout.imageEntry.imageInstanceId).toBe(input.program.image.instanceId);
    expect(input.target.runtimeCatalog.targetId).toBe(input.target.targetId);
  });

  test("supports platform primitive reachability", () => {
    const input = proofMirPlatformPrimitiveBuildInput();

    expect(input.program.reachablePlatformPrimitiveIds.length).toBeGreaterThan(0);
    expect(input.layout.platformEdges.entries().length).toBeGreaterThan(0);
  });

  test("supports image devices", () => {
    const input = proofMirImageDeviceBuildInput();

    expect(input.program.image.devices.length).toBeGreaterThan(0);
    expect(input.layout.imageDevices.entries().length).toBeGreaterThan(0);
  });

  test("supports branches and loops", () => {
    const source = [
      "fn branchy(value: u32) -> Never:",
      "    if value > 0:",
      "        return",
      "    else:",
      "        return",
      "fn loopy() -> Never:",
      "    loop:",
      "        break",
      "    return",
      "uefi image Boot:",
      "    fn main() -> Never:",
      "        branchy(0)",
      "        return",
    ].join("\n");
    const input = proofMirBuildInputForSource(source);

    expect(input.program.functions.entries().length).toBeGreaterThan(1);
  });

  test("builds nested call arguments through the wired expression lowerer", () => {
    const source = [
      "fn value() -> u32:",
      "    return 1",
      "fn sink(input: u32) -> u32:",
      "    return input",
      "uefi image Boot:",
      "    fn main() -> Never:",
      "        sink(value())",
      "        return",
    ].join("\n");
    const result = buildProofMir(proofMirBuildInputForSource(source));

    expect(result.kind).toBe("ok");
  });
});

describe("proofMirSummary", () => {
  test("normalizes BigInt values into stable JSON", () => {
    const summary = proofMirSummary({ size: 8n, nested: [{ offset: 0n }] });

    expect(summary).toBe('{"nested":[{"offset":"0n"}],"size":"8n"}');
  });

  test("normalizes deterministic table entries and diagnostics", () => {
    const fixture = closedProofMirFixture();
    const summary = proofMirSummary({
      kind: "ok",
      input: fixture,
      diagnostics: [
        proofMirDiagnostic({
          severity: "note",
          code: proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
          message: "later",
          ownerKey: "b",
          rootCauseKey: "root",
          stableDetail: "detail-b",
        }),
        proofMirDiagnostic({
          severity: "error",
          code: proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
          message: "earlier",
          ownerKey: "a",
          rootCauseKey: "root",
          stableDetail: "detail-a",
        }),
      ],
      program: {
        image: fixture.program.image,
        functions: fixture.program.functions.entries(),
        layout: {
          targetId: fixture.layout.target.targetId,
          typeCount: fixture.layout.types.entries().length,
        },
        origins: fixture.program.origins.originRecords(),
      },
    });

    expect(summary).toContain('"8n"');
    expect(summary.indexOf('"ownerKey":"a"')).toBeLessThan(summary.indexOf('"ownerKey":"b"'));
    expect(() => JSON.parse(summary)).not.toThrow();
  });

  test("produces identical summaries for equivalent fixture inputs", () => {
    const first = proofMirSummary(closedProofMirFixture());
    const second = proofMirSummary(closedProofMirFixture());

    expect(first).toBe(second);
  });
});

describe("validatedBufferProofMirLayoutFixture", () => {
  test("returns mono program and layout facts for validated-buffer reads", () => {
    const fixture = validatedBufferProofMirLayoutFixture({
      layoutSource: ["tag: u8 @ 0", "payload: u8 @ tag + 1"],
    });

    expect(fixture.layout.validatedBuffers.entries().length).toBe(1);
    expect(fixture.program.validatedBuffers.entries().length).toBe(1);
    expect(fixture.tagFieldId).toBeDefined();
    expect(fixture.payloadFieldId).toBeDefined();
  });
});

describe("platformCallProofMirFixture", () => {
  test("returns closed mono, layout, and runtime target context", () => {
    const fixture = platformCallProofMirFixture();

    expect(fixture.program.reachablePlatformPrimitiveIds.length).toBeGreaterThan(0);
    expect(fixture.layout.platformEdges.entries().length).toBeGreaterThan(0);
    expect(fixture.target.runtimeCatalog.targetId).toBe(fixture.target.targetId);
  });
});

describe("validatedBufferReadProofMirFixture", () => {
  test("includes validated-buffer layout read requirements", () => {
    const fixture = validatedBufferReadProofMirFixture();
    const buffer = fixture.layout.validatedBuffers.entries()[0];

    expect(buffer).toBeDefined();
    if (buffer === undefined) {
      return;
    }

    const tagField = buffer.layoutFields.find((field) => field.name === "tag");
    expect(tagField).toBeDefined();
    if (tagField === undefined) {
      return;
    }

    expect(tagField.readRequires.length).toBeGreaterThan(0);
  });
});

describe("readTagWorkedExampleFixture", () => {
  test("returns a closed build input with validated-buffer layout facts", () => {
    const fixture = readTagWorkedExampleFixture();

    expect(fixture.layout.validatedBuffers.entries().length).toBe(1);
    expect(
      fixture.program.functions.entries().some((func) => func.signature.parameters.length === 1),
    ).toBe(true);
    expect(fixture.target.runtimeCatalog.targetId).toBe(fixture.target.targetId);
    expect(fixture.program.functions.entries().length).toBeGreaterThan(1);
  });
});

describe("monoAndLayoutForTypedHirProgram", () => {
  test("reuses existing mono and layout fixture helpers", () => {
    const monoResult = monomorphizeWholeImage({ program: minimalClosedProgramForMonoTest() });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") {
      return;
    }

    const result = monoAndLayoutForTypedHirProgram(minimalClosedProgramForMonoTest());

    expect(result.program.image.instanceId).toBe(monoResult.program.image.instanceId);
    expect(result.layout.imageEntry.imageInstanceId).toBe(result.program.image.instanceId);
    expect(result.layout.target.targetId).toBe(targetId("uefi-aarch64"));
  });
});
