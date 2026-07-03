import { expect } from "bun:test";

import {
  compilerPackageInput,
  type CompileUefiAArch64ImageTrace,
  type CompilerPackageInput,
  type UefiAArch64ImageArtifact,
} from "../../../../src/target/uefi-aarch64";
import {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
} from "../../../../src/target/uefi-aarch64/target-driver-surface";
import {
  fixtureSpecForFullImageCase,
  type FullImageReferenceCheckerInput,
} from "../../../../src/validation/full-image";
import {
  linkedImageLayoutForPeCoffTest,
  serializedImageBytesForParserTest,
} from "../../../support/pe-coff/pe-coff-fixtures";
import {
  objectModuleForLinkTest,
  textSectionForLinkTest,
} from "../../../support/linker/aarch64-object-link-fixtures";

export function canonicalTrace(): NonNullable<FullImageReferenceCheckerInput["trace"]> {
  const target = authenticateUefiAArch64TargetDriverSurface(
    canonicalUefiAArch64TargetDriverSurfaceInput(),
  );
  if (target.kind === "error") {
    throw new Error(target.diagnostics.map((diagnostic) => diagnostic.stableDetail).join(","));
  }
  return {
    target: target.value,
    packagePipeline: {} as NonNullable<FullImageReferenceCheckerInput["trace"]>["packagePipeline"],
    binarySpine: {} as NonNullable<FullImageReferenceCheckerInput["trace"]>["binarySpine"],
  };
}

export function fakeInput(
  input: {
    readonly compileStatus?: FullImageReferenceCheckerInput["compileStatus"];
    readonly trace?: FullImageReferenceCheckerInput["trace"];
    readonly artifact?: FullImageReferenceCheckerInput["artifact"];
  } = {},
): FullImageReferenceCheckerInput {
  return {
    caseKey: "smoke-console/toolchain-stdlib",
    scenario: "smoke-console",
    stdlibMode: "toolchain-stdlib",
    fixtureSpec: {
      scenario: "smoke-console",
      stdlibMode: "toolchain-stdlib",
      fixtureProjectPath: "fixtures/smoke-console/toolchain-stdlib",
      packageKey: "full-image-validation:smoke-console:toolchain-stdlib",
      entryModuleName: "image",
      artifactName: "smoke-console-toolchain-stdlib.efi",
      packageStdlibMode: "toolchain",
      enabledTargetFeatures: [],
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    },
    packageInput: {
      packageKey: "full-image-validation:smoke-console/toolchain-stdlib",
      sourceRoots: [],
      sourceFiles: [],
      entryModuleName: "image",
      enabledTargetFeatures: [],
    },
    compileStatus: input.compileStatus ?? "passed",
    trace: input.trace,
    artifact: input.artifact,
  };
}

export function traceWithBinarySpine(
  input: {
    readonly backendObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["backendObjects"];
    readonly staticChar16Objects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["staticChar16Objects"];
    readonly validationFixtureObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["validationFixtureObjects"];
    readonly helperObjects?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["helperObjects"];
    readonly linkedLayout?: NonNullable<
      FullImageReferenceCheckerInput["trace"]
    >["binarySpine"]["linkedLayout"];
  } = {},
): FullImageReferenceCheckerInput["trace"] {
  return {
    ...canonicalTrace(),
    binarySpine: {
      stages: [],
      backendObjects: input.backendObjects ?? [
        objectModuleForLinkTest({ moduleKey: "wrela-source-object" }),
      ],
      staticChar16Objects: input.staticChar16Objects ?? [
        objectModuleForLinkTest({
          moduleKey: "static-char16:smoke",
          sections: [textSectionForLinkTest({ stableKey: ".rdata.char16", bytes: [0, 0] })],
        }),
      ],
      validationFixtureObjects: input.validationFixtureObjects ?? [],
      helperObjects: input.helperObjects ?? [
        objectModuleForLinkTest({ moduleKey: "helper:runtime" }),
      ],
      linkedLayout: input.linkedLayout ?? linkedImageLayoutForPeCoffTest(),
      peCoffArtifact: {
        artifactName: "smoke-console-toolchain-stdlib.efi",
        mediaType: "application/vnd.microsoft.portable-executable",
        fileExtension: ".efi",
        bytes: serializedImageBytesForParserTest(),
        deterministicMetadata: peCoffMetadataForReferenceTest(),
        verification: { runs: [] },
      },
      entryThunkFingerprint: "fixture:entry-thunk",
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

export function artifactWithBytes(bytes: readonly number[]): UefiAArch64ImageArtifact {
  return {
    artifactName: "smoke-console-toolchain-stdlib.efi",
    peCoffArtifact: {
      artifactName: "smoke-console-toolchain-stdlib.efi",
      mediaType: "application/vnd.microsoft.portable-executable",
      fileExtension: ".efi",
      bytes,
      deterministicMetadata: peCoffMetadataForReferenceTest(),
      verification: { runs: [] },
    },
    targetMetadata: {
      schema: "wrela.uefi-aarch64-image",
      schemaVersion: 1,
      targetDriverFingerprint: "fixture:target-driver",
      aarch64TargetFingerprint: "fixture:aarch64",
      backendTargetFingerprint: "fixture:backend",
      linkerTargetFingerprint: "fixture:linker",
      peCoffWriterTargetFingerprint: "fixture:pe",
      semanticPlatformCatalogFingerprint: "fixture:semantic",
      proofMirRuntimeCatalogFingerprint: "fixture:proof",
      entryThunkFingerprint: "fixture:entry",
      firmwareAbiFingerprint: "fixture:firmware",
      statusPolicyFingerprint: "fixture:status",
      watchdogPolicyFingerprint: "fixture:watchdog",
      peCoffImageFingerprint: "fixture:image",
      finalImageFingerprint: "fixture:final",
    },
    smoke: {
      status: "disabled",
      stableDetail: "qemu-smoke:disabled",
      observedMarkers: [],
      targetDriverFingerprint: "fixture:target-driver",
    },
  };
}

function peCoffMetadataForReferenceTest(): UefiAArch64ImageArtifact["peCoffArtifact"]["deterministicMetadata"] {
  return {
    schema: "wrela.pe-coff-efi-image",
    schemaVersion: 1,
    linkedLayoutFingerprint: "fixture:layout",
    writerTargetFingerprint: "fixture:writer",
    sectionTableFingerprint: "fixture:sections",
    dataDirectoryFingerprint: "fixture:directories",
    baseRelocationTableFingerprint: "fixture:relocations",
    headerFingerprint: "fixture:headers",
    imageFingerprint: "fixture:image",
  };
}

export function linkedSectionForReferenceTest(
  stableKey: string,
  rva: number,
  virtualSizeBytes: number,
  flags: number,
  bytes: readonly number[],
): ReturnType<typeof linkedImageLayoutForPeCoffTest>["sections"][number] {
  return {
    stableKey,
    classKey: stableKey,
    flags,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes,
    bytes,
    contributions: [
      {
        stableKey: `contribution:${stableKey}`,
        sourceModuleKey: "module:test",
        sourceObjectSectionKey: stableKey,
        sourceObjectSectionClass: stableKey,
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: virtualSizeBytes,
        alignmentBytes: 1,
      },
    ],
  };
}

export function task20ReferenceInput(input: {
  readonly scenario?: FullImageReferenceCheckerInput["scenario"];
  readonly stdlibMode: FullImageReferenceCheckerInput["stdlibMode"];
  readonly packageInput: CompilerPackageInput;
  readonly reachablePlatformPrimitiveIds?: readonly string[];
  readonly trace?: CompileUefiAArch64ImageTrace;
}): FullImageReferenceCheckerInput {
  const scenario = input.scenario ?? "smoke-console";
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario,
    stdlibMode: input.stdlibMode,
  });
  return {
    caseKey: `${scenario}/${input.stdlibMode}`,
    scenario,
    stdlibMode: input.stdlibMode,
    fixtureSpec,
    packageInput: input.packageInput,
    compileStatus: "passed",
    trace:
      input.trace ??
      ({
        packagePipeline: {
          reachablePlatformPrimitiveIds: input.reachablePlatformPrimitiveIds ?? [],
        },
      } as CompileUefiAArch64ImageTrace),
  };
}

export function task20PackageInput(input: {
  readonly sourceRoots: CompilerPackageInput["sourceRoots"];
  readonly sourceFiles: CompilerPackageInput["sourceFiles"];
}): CompilerPackageInput {
  const result = compilerPackageInput({
    packageKey: "full-image-validation:test",
    entryModuleName: "image",
    enabledTargetFeatures: [],
    sourceRoots: input.sourceRoots,
    sourceFiles: input.sourceFiles,
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("test package input failed");
  return result.value;
}

export function packetCounterInput(input: {
  readonly trace?: FullImageReferenceCheckerInput["trace"];
}): FullImageReferenceCheckerInput {
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario: "packet-counter",
    stdlibMode: "toolchain-stdlib",
  });
  return {
    ...fakeInput(input),
    caseKey: "packet-counter/toolchain-stdlib",
    scenario: "packet-counter",
    fixtureSpec,
  };
}

export function scenarioInput(
  scenario: FullImageReferenceCheckerInput["scenario"],
  input: {
    readonly trace?: FullImageReferenceCheckerInput["trace"];
    readonly compileStatus?: FullImageReferenceCheckerInput["compileStatus"];
  },
): FullImageReferenceCheckerInput {
  const fixtureSpec = fixtureSpecForFullImageCase({
    scenario,
    stdlibMode: "toolchain-stdlib",
  });
  return {
    ...fakeInput(input),
    caseKey: `${scenario}/toolchain-stdlib`,
    scenario,
    fixtureSpec,
  };
}

export function traceWithProofFacts(
  facts: readonly unknown[],
): FullImageReferenceCheckerInput["trace"] {
  return {
    packagePipeline: {
      proofCheck: {
        checkProofAndResourcesResult: {
          kind: "ok",
          factPacket: { facts },
        },
      },
      proofMir: {
        buildProofMirResult: {
          kind: "ok",
          layoutReferences: facts,
        },
      },
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

export function proofFact(family: string, subject: string, detail = ""): unknown {
  return { family, subject, detail };
}

export function traceWithOptIr(input: {
  readonly operations: readonly unknown[];
  readonly staticChar16Strings: readonly unknown[];
  readonly diagnostics?: readonly unknown[];
}): FullImageReferenceCheckerInput["trace"] {
  return {
    packagePipeline: {
      optIr: {
        operations: input.operations,
        program: { diagnostics: input.diagnostics ?? [] },
        facts: { records: [] },
        staticChar16Strings: input.staticChar16Strings,
      },
    },
  } as unknown as FullImageReferenceCheckerInput["trace"];
}

export function optIrOperation(
  kind: string,
  fields: Readonly<Record<string, unknown>> = {},
): unknown {
  return { kind, ...fields };
}
