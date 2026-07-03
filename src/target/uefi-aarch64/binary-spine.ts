import {
  createAArch64UefiEntrySyntheticObjectProvider,
  createAArch64UnwindSyntheticObjectProvider,
  linkAArch64Image,
  type AArch64LinkedImageLayout,
  type AArch64LinkInputModule,
} from "../../linker";
import { writeAArch64PeCoffEfiImage, type PeCoffEfiImageArtifact } from "../../pe-coff";
import {
  compileAArch64Object,
  lowerOptIrToAArch64,
  normalizeAArch64ClosedImageBackendPlan,
  type AArch64BackendTargetSurface,
  type AArch64MachineProgram,
} from "../aarch64";
import type { OptIrFunction } from "../../opt-ir/program";
import { optIrTypeStableKey } from "../../opt-ir/types";
import { createUefiAArch64EntryThunkObjectFactory, planUefiAArch64EntryThunk } from "./entry-thunk";
import { canonicalUefiAArch64ExitBootServicesPolicy } from "./exit-boot-services";
import { uefiAArch64FirmwarePlatformCallContext } from "./firmware-lowering";
import { validateUefiAArch64BootFunctionContract } from "./entry-contract";
import {
  type UefiAArch64PackageOptIrPipelineOutput,
  type UefiAArch64StageRecord,
} from "./package-pipeline";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  verificationSummaryFromRuns,
  type UefiAArch64TargetResult,
} from "./result";
import { materializeUefiAArch64RuntimeHelperObjects } from "./runtime-helper-objects";
import {
  authenticateUefiAArch64PeCoffWriterTargetForLinkedPolicy,
  productionUefiAArch64ResolvedTargetSurfaces,
  productionUefiAArch64TargetSurfaceFingerprints,
  type UefiAArch64ResolvedTargetSurfaces,
} from "./target-surfaces";
import { materializeUefiAArch64StaticChar16ObjectModule } from "./static-char16-objects";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";
import { materializeUefiAArch64ValidationFixturePacketObjectModule } from "./validation-fixture-packet-objects";

const SOURCE_MODULE_KEY = "wrela-source-object";
const BINARY_SPINE_VERIFIER_KEY = "uefi-aarch64-binary-spine";
const BINARY_SPINE_RUN_KEY = "opt-ir-to-pe";

export type UefiAArch64BinarySpineStageKey =
  | "aarch64-lowering"
  | "aarch64-backend"
  | "static-char16-objects"
  | "validation-fixture-objects"
  | "runtime-helper-objects"
  | "synthetic-entry-object"
  | "linker"
  | "pe-coff-writer";

export interface UefiAArch64BinarySpineOutput {
  readonly stages: readonly UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[];
  readonly backendObjects: readonly AArch64LinkInputModule[];
  readonly staticChar16Objects: readonly AArch64LinkInputModule[];
  readonly validationFixtureObjects: readonly AArch64LinkInputModule[];
  readonly helperObjects: readonly AArch64LinkInputModule[];
  readonly linkedLayout: AArch64LinkedImageLayout;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly entryThunkFingerprint: string;
}

export interface RunUefiAArch64BinarySpineInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly optIr: UefiAArch64PackageOptIrPipelineOutput;
  readonly artifactName?: string;
}

export function runUefiAArch64BinarySpine(
  input: RunUefiAArch64BinarySpineInput,
): UefiAArch64TargetResult<UefiAArch64BinarySpineOutput> {
  const stages = createBinarySpineStageRecorder();
  const surfaces = selectUefiAArch64BinarySpineSurfaces(input.target);
  if (surfaces.kind === "error") {
    return binarySpineError(
      "aarch64-lowering",
      stages.failed("aarch64-lowering"),
      surfaces.diagnostics,
    );
  }

  const bootContract = validateBinarySpineBootFunctionContract(input.optIr.optIr.program);
  if (bootContract.kind === "error") {
    return binarySpineError(
      "aarch64-lowering",
      stages.failed("aarch64-lowering"),
      bootContract.diagnostics,
    );
  }

  const lowered = lowerOptIrToAArch64({
    program: input.optIr.optIr.program,
    operations: input.optIr.optIr.operations,
    facts: input.optIr.optIr.facts,
    target: surfaces.value.aarch64Target,
    options: {
      firmware: {
        platformCalls: uefiAArch64FirmwarePlatformCallContext({
          firmwareTables: input.target.firmwareTables,
          platformLowerings: input.target.platformLowerings,
          validationFixturePacketSources: input.optIr.optIr.validationFixturePacketSources,
        }),
        staticChar16Pointers: new Map(
          input.optIr.optIr.staticChar16Pointers.map((record) => [record.valueKey, record.pointer]),
        ),
      },
    },
  });
  if (lowered.kind === "error") {
    return binarySpineError(
      "aarch64-lowering",
      stages.failed("aarch64-lowering"),
      lowered.diagnostics,
    );
  }
  stages.passed("aarch64-lowering");

  const object = compileAArch64Object({
    machineProgram: machineProgramForBackendHandoff(
      lowered.machineProgram,
      surfaces.value.backendTarget,
    ),
    preservedFacts: lowered.preservedFacts,
    provenance: lowered.provenance,
    target: surfaces.value.backendTarget,
    closedImagePlan: closedImagePlanForUefiTarget(input.target),
  });
  if (object.kind === "error") {
    return binarySpineError(
      "aarch64-backend",
      stages.failed("aarch64-backend"),
      object.diagnostics,
    );
  }
  stages.passed("aarch64-backend");

  const staticChar16Objects = materializeUefiAArch64StaticChar16ObjectModule({
    backendTarget: surfaces.value.backendTarget,
    staticChar16Strings: input.optIr.optIr.staticChar16Strings,
    staticChar16Pointers: input.optIr.optIr.staticChar16Pointers,
  });
  if (staticChar16Objects.kind === "error") {
    return binarySpineError(
      "static-char16-objects",
      stages.failed("static-char16-objects"),
      staticChar16Objects.diagnostics,
    );
  }
  stages.passed("static-char16-objects");

  const validationFixtureObjects = materializeUefiAArch64ValidationFixturePacketObjectModule({
    backendTarget: surfaces.value.backendTarget,
    validationFixturePacketSources: input.optIr.optIr.validationFixturePacketSources ?? [],
  });
  if (validationFixtureObjects.kind === "error") {
    return binarySpineError(
      "validation-fixture-objects",
      stages.failed("validation-fixture-objects"),
      validationFixtureObjects.diagnostics,
    );
  }
  stages.passed("validation-fixture-objects");

  const helperObjects = materializeUefiAArch64RuntimeHelperObjects({
    backendTarget: surfaces.value.backendTarget,
    firmwareTables: input.target.firmwareTables,
    statusPolicy: input.target.statusPolicy,
    watchdogPolicy: input.target.watchdogPolicy,
    exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy(),
  });
  if (helperObjects.kind === "error") {
    return binarySpineError(
      "runtime-helper-objects",
      stages.failed("runtime-helper-objects"),
      helperObjects.diagnostics,
    );
  }
  stages.passed("runtime-helper-objects");

  const syntheticFactory = createUefiAArch64EntryThunkObjectFactory({
    entryProfile: input.target.entryProfile,
    backendTarget: surfaces.value.backendTarget,
  });
  const entryThunkPlan = planUefiAArch64EntryThunk({
    entryProfile: input.target.entryProfile,
    backendTarget: surfaces.value.backendTarget,
  });
  if (entryThunkPlan.kind === "error") {
    return binarySpineError(
      "synthetic-entry-object",
      stages.failed("synthetic-entry-object"),
      entryThunkPlan.diagnostics,
    );
  }
  const entryProvider = createAArch64UefiEntrySyntheticObjectProvider({
    factory: syntheticFactory,
    backendTarget: surfaces.value.backendTarget,
  });
  const unwindProvider = createAArch64UnwindSyntheticObjectProvider({
    factory: syntheticFactory,
    backendTarget: surfaces.value.backendTarget,
  });
  stages.passed("synthetic-entry-object");

  const backendObjects = Object.freeze([
    Object.freeze({ moduleKey: SOURCE_MODULE_KEY, objectModule: object.objectModule }),
  ]);
  const linked = linkAArch64Image({
    target: surfaces.value.linkerTarget,
    objectModules: Object.freeze([
      ...backendObjects,
      ...staticChar16Objects.value.modules,
      ...validationFixtureObjects.value.modules,
      ...helperObjects.value.modules,
    ]),
    entry: { wrelaBootLinkageName: input.target.entryProfile.bootFunctionSymbol },
    syntheticObjects: [entryProvider, unwindProvider],
  });
  if (linked.kind === "error") {
    return binarySpineError("linker", stages.failed("linker"), linked.diagnostics);
  }
  stages.passed("linker");

  const peTarget = selectUefiAArch64PeCoffWriterTarget(input.target, linked.layout);
  if (peTarget.kind === "error") {
    return binarySpineError(
      "pe-coff-writer",
      stages.failed("pe-coff-writer"),
      peTarget.diagnostics,
    );
  }
  const peCoffArtifact = writeAArch64PeCoffEfiImage({
    artifactName: input.artifactName,
    layout: linked.layout,
    target: peTarget.value,
  });
  if (peCoffArtifact.kind === "error") {
    return binarySpineError(
      "pe-coff-writer",
      stages.failed("pe-coff-writer"),
      peCoffArtifact.diagnostics,
    );
  }
  stages.passed("pe-coff-writer");

  return uefiAArch64Ok({
    value: Object.freeze({
      stages: stages.records(),
      backendObjects,
      staticChar16Objects: staticChar16Objects.value.modules,
      validationFixtureObjects: validationFixtureObjects.value.modules,
      helperObjects: helperObjects.value.modules,
      linkedLayout: linked.layout,
      peCoffArtifact: peCoffArtifact.artifact,
      entryThunkFingerprint: entryThunkPlan.value.fingerprint,
    }),
    verification: passedVerification(BINARY_SPINE_VERIFIER_KEY, BINARY_SPINE_RUN_KEY),
  });
}

function validateBinarySpineBootFunctionContract(
  program: RunUefiAArch64BinarySpineInput["optIr"]["optIr"]["program"],
) {
  const entryFunction = program.functions
    .entries()
    .find((func) => func.externalRoot?.reason === "imageEntry");
  if (entryFunction === undefined) {
    return uefiAArch64Ok({
      value: undefined,
      verification: passedVerification(BINARY_SPINE_VERIFIER_KEY, "boot-contract"),
    });
  }
  const entryBlock = entryFunction.blocks.find(
    (block) => block.blockId === entryFunction.entryBlock,
  );
  const sourceVisibleParameters =
    entryBlock?.parameters.map((parameter) =>
      Object.freeze({
        name: `optir.value:${String(parameter.valueId)}`,
        typeKey: optIrTypeStableKey(parameter.type),
      }),
    ) ?? [];
  return validateUefiAArch64BootFunctionContract({
    sourceVisibleParameters,
    resultShape: bootResultShapeForOptIrFunction(entryFunction),
  });
}

function bootResultShapeForOptIrFunction(func: OptIrFunction) {
  const returnValueCount = Math.max(
    0,
    ...func.blocks
      .map((block) => block.terminator)
      .filter((terminator) => terminator?.kind === "return")
      .map((terminator) => terminator.values.length),
  );
  if (returnValueCount === 0) return { kind: "unit-success" as const };
  if (returnValueCount === 1) {
    return Object.freeze({
      kind: "target-certified-result" as const,
      errorTypeKey: "uefi.Status",
    });
  }
  return Object.freeze({ kind: `unsupported-return-count:${returnValueCount}` });
}

function selectUefiAArch64BinarySpineSurfaces(
  target: UefiAArch64TargetDriverSurface,
): UefiAArch64TargetResult<
  Pick<UefiAArch64ResolvedTargetSurfaces, "aarch64Target" | "backendTarget" | "linkerTarget">
> {
  const surfaces = productionUefiAArch64ResolvedTargetSurfaces();
  if (surfaces.kind === "error") return surfaces;

  const fingerprints = productionUefiAArch64TargetSurfaceFingerprints();
  if (fingerprints.kind === "error") return fingerprints;

  const aarch64Mismatch = fingerprintMismatchDiagnostic(
    "aarch64-target",
    target.aarch64TargetFingerprint,
    fingerprints.value.aarch64TargetFingerprint,
  );
  if (aarch64Mismatch !== undefined) {
    return uefiAArch64Error({
      diagnostics: [aarch64Mismatch],
      verification: failedVerification(BINARY_SPINE_VERIFIER_KEY, "select-aarch64-target"),
    });
  }
  const backendMismatch = fingerprintMismatchDiagnostic(
    "aarch64-backend",
    target.backendTargetFingerprint,
    fingerprints.value.backendTargetFingerprint,
  );
  if (backendMismatch !== undefined) {
    return uefiAArch64Error({
      diagnostics: [backendMismatch],
      verification: failedVerification(BINARY_SPINE_VERIFIER_KEY, "select-backend-target"),
    });
  }

  const linkerMismatch = fingerprintMismatchDiagnostic(
    "aarch64-linker",
    target.linkerTargetFingerprint,
    fingerprints.value.linkerTargetFingerprint,
  );
  if (linkerMismatch !== undefined) {
    return uefiAArch64Error({
      diagnostics: [linkerMismatch],
      verification: failedVerification(BINARY_SPINE_VERIFIER_KEY, "select-linker-target"),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      aarch64Target: surfaces.value.aarch64Target,
      backendTarget: surfaces.value.backendTarget,
      linkerTarget: surfaces.value.linkerTarget,
    }),
    verification: passedVerification(BINARY_SPINE_VERIFIER_KEY, "select-surfaces"),
  });
}

function selectUefiAArch64PeCoffWriterTarget(
  target: UefiAArch64TargetDriverSurface,
  linkedLayout: AArch64LinkedImageLayout,
): UefiAArch64TargetResult<UefiAArch64ResolvedTargetSurfaces["peCoffWriterTarget"]> {
  const peTarget = authenticateUefiAArch64PeCoffWriterTargetForLinkedPolicy({
    linkedTargetPolicyFingerprint: linkedLayout.targetPolicyFingerprint,
  });
  if (peTarget.kind === "error") return peTarget;
  const mismatch = fingerprintMismatchDiagnostic(
    "aarch64-pe-coff",
    target.peCoffWriterTargetFingerprint,
    peTarget.value.targetPolicyFingerprint,
  );
  if (mismatch !== undefined) {
    return uefiAArch64Error({
      diagnostics: [mismatch],
      verification: failedVerification(BINARY_SPINE_VERIFIER_KEY, "select-pe-coff-target"),
    });
  }
  return uefiAArch64Ok({
    value: peTarget.value,
    verification: passedVerification(BINARY_SPINE_VERIFIER_KEY, "select-pe-coff-target"),
  });
}

function closedImagePlanForUefiTarget(target: UefiAArch64TargetDriverSurface) {
  return normalizeAArch64ClosedImageBackendPlan({
    closureKind: "closed-image",
    participatingModules: Object.freeze([SOURCE_MODULE_KEY]),
    symbolVisibility: Object.freeze({
      records: Object.freeze([
        Object.freeze({
          symbol: target.entryProfile.bootFunctionSymbol,
          visibility: "public" as const,
        }),
      ]),
    }),
    addressTaken: Object.freeze({
      records: Object.freeze([
        Object.freeze({ symbol: target.entryProfile.bootFunctionSymbol, addressTaken: false }),
      ]),
    }),
    replacementBoundaries: Object.freeze({ records: Object.freeze([]) }),
    publicAbiBoundaries: Object.freeze({ records: Object.freeze([]) }),
    privateConventions: Object.freeze([]),
    authorityFingerprint: "pre-normalization-input",
  });
}

function machineProgramForBackendHandoff(
  machineProgram: AArch64MachineProgram,
  backendTarget: AArch64BackendTargetSurface,
): AArch64MachineProgram {
  const functionSymbols = new Set(
    machineProgram.functions.entries().map((machineFunction) => String(machineFunction.symbol)),
  );
  return Object.freeze({
    ...machineProgram,
    globalSymbols: Object.freeze(
      machineProgram.globalSymbols.filter((symbol) => !functionSymbols.has(String(symbol.symbol))),
    ),
    consultedSubsurfaceFingerprints: Object.freeze([
      ...new Set([
        ...machineProgram.consultedSubsurfaceFingerprints,
        backendTarget.sourceSurfaceFingerprint,
      ]),
    ]),
  });
}

function binarySpineError<Value = never>(
  stageKey: UefiAArch64BinarySpineStageKey,
  stages: readonly UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[],
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): UefiAArch64TargetResult<Value> {
  return uefiAArch64Error({
    diagnostics: mapDiagnostics(stageKey, diagnostics),
    verification: verificationSummaryFromRuns(
      stages.map((stage) => ({
        verifierKey: BINARY_SPINE_VERIFIER_KEY,
        runKey: stage.stageKey,
        status: stage.status,
      })),
    ),
  });
}

function createBinarySpineStageRecorder() {
  const records: UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[] = [];
  return {
    passed(stageKey: UefiAArch64BinarySpineStageKey): void {
      records.push(Object.freeze({ stageKey, status: "passed" as const }));
    },
    failed(
      stageKey: UefiAArch64BinarySpineStageKey,
    ): readonly UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[] {
      records.push(Object.freeze({ stageKey, status: "failed" as const }));
      return Object.freeze([...records]);
    },
    records(): readonly UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[] {
      return Object.freeze([...records]);
    },
  };
}

function mapDiagnostics(
  ownerKey: string,
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): readonly UefiAArch64TargetDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey,
        stableDetail:
          diagnostic.code === undefined
            ? diagnostic.stableDetail
            : `${diagnostic.code}:${diagnostic.stableDetail}`,
      }),
    ),
  );
}

function fingerprintMismatchDiagnostic(
  componentKey: string,
  expected: string,
  actual: string,
): UefiAArch64TargetDiagnostic | undefined {
  if (expected === actual) return undefined;
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_PIPELINE_FAILED",
    ownerKey: "binary-spine",
    stableDetail: `target-surface-fingerprint-mismatch:${componentKey}:expected:${expected}:actual:${actual}`,
  });
}
