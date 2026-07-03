import { describe, expect, test } from "bun:test";
import { writeAArch64PeCoffEfiImage } from "../../../../src/pe-coff";
import { checkFullImageSelfContained } from "../../../../src/validation/full-image";
import {
  linkedImageLayoutForPeCoffTest,
  writerTargetForLinkedLayout,
} from "../../../support/pe-coff/pe-coff-fixtures";

describe("full image self-contained checker", () => {
  test("accepts linked layout with compiler-owned modules and matching PE sections", () => {
    const input = selfContainedInputForTest();

    const reports = checkFullImageSelfContained(input);

    expect(reportByKey(reports, "self-contained.object-modules")).toMatchObject({
      status: "passed",
      stableDetail: "self-contained:object-modules:compiler-owned",
    });
    expect(reportByKey(reports, "self-contained.entry")).toMatchObject({
      status: "passed",
      stableDetail: "self-contained:entry:EfiMain:wrela_boot",
    });
    expect(reportByKey(reports, "self-contained.unresolved-externals")).toMatchObject({
      status: "passed",
      stableDetail: "self-contained:unresolved-externals:none",
    });
    expect(reportByKey(reports, "self-contained.host-references")).toMatchObject({
      status: "passed",
      stableDetail: "self-contained:host-references:none",
    });
    expect(reportByKey(reports, "self-contained.section-ranges")).toMatchObject({
      status: "passed",
      stableDetail: "self-contained:section-ranges:matched:4",
    });
  });

  test("reports forbidden source roots and missing compiler-owned module groups", () => {
    const input = selfContainedInputForTest({
      helperObjects: [],
      symbolName: "/tmp/build/stdlib/wrela-std/lib.wrela",
    });

    const reports = checkFullImageSelfContained(input);

    expect(reportByKey(reports, "self-contained.object-modules")).toMatchObject({
      status: "failed",
      stableDetail: "self-contained:object-modules:missing:helperObjects",
    });
    expect(reportByKey(reports, "self-contained.host-references")).toMatchObject({
      status: "failed",
      stableDetail:
        "self-contained:host-references:forbidden:/tmp/build/stdlib/wrela-std/lib.wrela",
    });
  });

  test("reports structurally unresolved external symbols with ordinary linkage names", () => {
    const input = selfContainedInputForTest({
      extraSymbols: [
        {
          symbolKey: "symbol:printf",
          linkageName: "printf",
          binding: "global",
          sourceModuleKey: "wrela-source-object",
          sectionKey: "<external>",
          contributionKey: "<external>",
          rva: 0,
          objectOffsetBytes: 0,
        },
      ],
    });

    const reports = checkFullImageSelfContained(input);

    expect(reportByKey(reports, "self-contained.unresolved-externals")).toMatchObject({
      status: "failed",
      stableDetail: "self-contained:unresolved-externals:present:printf",
    });
  });
});

function selfContainedInputForTest(
  input: {
    readonly helperObjects?: readonly unknown[];
    readonly symbolName?: string;
    readonly extraSymbols?: readonly unknown[];
  } = {},
) {
  const symbolName = input.symbolName ?? "wrela_boot";
  const layout = linkedImageLayoutForPeCoffTest({
    sections: undefined,
  });
  const linkedLayout = {
    ...layout,
    inputModules: [
      { moduleKey: "wrela-source-object", moduleFingerprint: "stable-hash:source" },
      { moduleKey: "static-char16:test", moduleFingerprint: "stable-hash:char16" },
      { moduleKey: "runtime-helper:test", moduleFingerprint: "stable-hash:helper" },
      {
        moduleKey: "synthetic-entry:test",
        moduleFingerprint: "stable-hash:entry",
        syntheticProviderKey: "aarch64-uefi-entry",
      },
      {
        moduleKey: "synthetic-unwind:test",
        moduleFingerprint: "stable-hash:unwind",
        syntheticProviderKey: "aarch64-unwind",
      },
    ],
    symbols: [
      {
        symbolKey: "symbol:entry",
        linkageName: "EfiMain",
        binding: "global",
        sourceModuleKey: "synthetic-entry:test",
        sectionKey: ".text",
        contributionKey: "contribution:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
      {
        symbolKey: "symbol:boot",
        linkageName: symbolName,
        binding: "global",
        sourceModuleKey: "wrela-source-object",
        sectionKey: ".text",
        contributionKey: "contribution:.text",
        rva: 0x1000,
        objectOffsetBytes: 0,
      },
      ...(input.extraSymbols ?? []),
    ],
  };
  const artifactResult = writeAArch64PeCoffEfiImage({
    layout,
    target: writerTargetForLinkedLayout(layout),
    artifactName: "test.efi",
  });
  if (artifactResult.kind !== "ok") throw new Error("expected PE/COFF fixture");
  return {
    artifact: {
      peCoffArtifact: artifactResult.artifact,
    },
    trace: {
      target: {
        entryProfile: {
          bootFunctionSymbol: "wrela_boot",
        },
      },
      packagePipeline: {
        optIr: {
          staticChar16Strings: [{}],
          staticChar16Pointers: [{}],
        },
      },
      binarySpine: {
        backendObjects: [{ moduleKey: "wrela-source-object" }],
        staticChar16Objects: [{ moduleKey: "static-char16:test" }],
        validationFixtureObjects: [{ moduleKey: "validation-fixture:test" }],
        helperObjects: input.helperObjects ?? [{ moduleKey: "runtime-helper:test" }],
        linkedLayout,
      },
    },
  } as unknown as Parameters<typeof checkFullImageSelfContained>[0];
}

function reportByKey(reports: ReturnType<typeof checkFullImageSelfContained>, checkerKey: string) {
  const report = reports.find((candidate) => candidate.checkerKey === checkerKey);
  if (report === undefined) throw new Error(`missing report ${checkerKey}`);
  expect(report.evidence.length).toBeGreaterThan(0);
  expect(report.inputAuthority.length).toBeGreaterThan(0);
  return report;
}
