import { describe, expect, test } from "bun:test";
import { writeAArch64PeCoffEfiImage } from "../../../../src/pe-coff";
import { fingerprintUefiAArch64ImageBytes } from "../../../../src/target/uefi-aarch64";
import { checkFullImageBinaryStructure } from "../../../../src/validation/full-image";
import {
  linkedImageLayoutForPeCoffTest,
  writerTargetForLinkedLayout,
} from "../../../support/pe-coff/pe-coff-fixtures";

describe("full image binary structure checker", () => {
  test("accepts production-like AArch64 PE32+ EFI bytes as byte authority", () => {
    const input = fullImageInputForTest();

    const reports = checkFullImageBinaryStructure(input);

    expect(reportByKey(reports, "binary.pe.parse")).toMatchObject({
      status: "passed",
      stableDetail: "binary:pe-parse:passed",
      inputAuthority: ["final-bytes"],
    });
    expect(reportByKey(reports, "binary.structure.headers")).toMatchObject({
      status: "passed",
      stableDetail: "binary:headers:aarch64-pe32plus-efi-application",
    });
    expect(reportByKey(reports, "binary.structure.entry")).toMatchObject({
      status: "passed",
      stableDetail: "binary:entry:executable-section:.text:4096",
    });
    expect(reportByKey(reports, "binary.metadata.fingerprint")).toMatchObject({
      status: "passed",
      stableDetail: "metadata:fingerprint:matched",
      inputAuthority: ["final-bytes", "compiler-trace"],
    });
  });

  test("fails when final bytes disagree with metadata fingerprint", () => {
    const input = fullImageInputForTest({
      finalImageFingerprint: "uefi-aarch64-image-bytes:not-the-bytes",
    });

    const reports = checkFullImageBinaryStructure(input);

    expect(reportByKey(reports, "binary.metadata.fingerprint")).toMatchObject({
      status: "failed",
      stableDetail: `metadata:fingerprint:mismatch:uefi-aarch64-image-bytes:not-the-bytes:${fingerprintUefiAArch64ImageBytes(
        input.artifact.peCoffArtifact.bytes,
      )}`,
    });
  });
});

function fullImageInputForTest(input: { readonly finalImageFingerprint?: string } = {}) {
  const layout = linkedImageLayoutForPeCoffTest();
  const artifactResult = writeAArch64PeCoffEfiImage({
    layout,
    target: writerTargetForLinkedLayout(layout),
    artifactName: "test.efi",
  });
  if (artifactResult.kind !== "ok") throw new Error("expected PE/COFF fixture");
  const finalImageFingerprint =
    input.finalImageFingerprint ?? fingerprintUefiAArch64ImageBytes(artifactResult.artifact.bytes);

  return {
    artifact: {
      artifactName: artifactResult.artifact.artifactName,
      peCoffArtifact: artifactResult.artifact,
      targetMetadata: {
        finalImageFingerprint,
        peCoffImageFingerprint: artifactResult.artifact.deterministicMetadata.imageFingerprint,
      },
    },
    trace: {
      binarySpine: {
        linkedLayout: layout,
        peCoffArtifact: artifactResult.artifact,
      },
    },
  } as Parameters<typeof checkFullImageBinaryStructure>[0];
}

function reportByKey(
  reports: ReturnType<typeof checkFullImageBinaryStructure>,
  checkerKey: string,
) {
  const report = reports.find((candidate) => candidate.checkerKey === checkerKey);
  if (report === undefined) throw new Error(`missing report ${checkerKey}`);
  expect(report.evidence.length).toBeGreaterThan(0);
  expect(report.inputAuthority.length).toBeGreaterThan(0);
  return report;
}
