import {
  layoutFunctionKeyString,
  layoutPlatformEdgeKeyString,
  layoutValidatedBufferKeyString,
} from "../../layout/layout-fact-builder-support";
import type {
  LayoutFactProgram,
  LayoutFieldKey,
  LayoutImageDeviceKey,
  LayoutTypeKey,
} from "../../layout/layout-program";
import {
  layoutFieldKeyString,
  layoutImageDeviceKeyString,
  layoutTypeKeyString,
} from "../../layout/type-key";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoExternalRoot,
  MonoTypeInstance,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import { runtimeCatalogFeaturesEqual } from "../../runtime/runtime-catalog";
import { compareCodeUnitStrings } from "../../semantic/surface/deterministic-sort";
import type { FieldId } from "../../semantic/ids";
import type { DraftProofMirBuildTargetContext } from "../draft/draft-builder-context";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";

export interface ValidateProofMirBuildInputCompatibilityInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
}

function inputCompatibilityDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: "input-compatibility",
    stableDetail: input.stableDetail,
    ...(input.functionInstanceId === undefined
      ? {}
      : { functionInstanceId: input.functionInstanceId }),
  });
}

function sortKeyStrings(keys: Iterable<string>): string[] {
  return [...keys].sort(compareCodeUnitStrings);
}

function sourceTypeKeyForInstance(
  instanceId: MonoInstanceId,
): LayoutTypeKey & { readonly kind: "source" } {
  return { kind: "source", instanceId };
}

function fieldKeyForMonoType(input: {
  readonly instanceId: MonoInstanceId;
  readonly fieldId: LayoutFieldKey["fieldId"];
}): LayoutFieldKey {
  return {
    owner: sourceTypeKeyForInstance(input.instanceId),
    fieldId: input.fieldId,
  };
}

function imageDeviceKeyForMonoDevice(input: {
  readonly imageInstanceId: MonoInstanceId;
  readonly fieldId: LayoutImageDeviceKey["fieldId"];
}): LayoutImageDeviceKey {
  return {
    imageInstanceId: input.imageInstanceId,
    fieldId: input.fieldId,
  };
}

function validateTargetCompatibility(input: {
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  if (input.target.targetId !== input.layout.target.targetId) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_INPUT_LAYOUT_MISMATCH",
        message: "Proof MIR build target does not match layout target facts.",
        ownerKey: "target",
        stableDetail: `target:${String(input.target.targetId)}:layout:${String(input.layout.target.targetId)}`,
      }),
    );
  }
}

function validateRuntimeCatalogCompatibility(input: {
  readonly target: DraftProofMirBuildTargetContext;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  if (input.target.runtimeCatalog.targetId !== input.target.targetId) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
        message: "Runtime catalog target does not match selected build target.",
        ownerKey: "runtimeCatalog",
        stableDetail: `target:${String(input.target.runtimeCatalog.targetId)}:selected:${String(input.target.targetId)}`,
      }),
    );
  }

  if (!runtimeCatalogFeaturesEqual(input.target.runtimeCatalog.features, input.target.features)) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
        message: "Runtime catalog features do not match selected build features.",
        ownerKey: "runtimeCatalog",
        stableDetail: "features-mismatch",
      }),
    );
  }
}

function validateImageEntryCompatibility(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  if (input.layout.imageEntry.imageInstanceId !== input.program.image.instanceId) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_MISSING_IMAGE_ENTRY",
        message: "Layout image-entry ABI does not match monomorphized image instance.",
        ownerKey: "image-entry",
        stableDetail: `image:${String(input.program.image.instanceId)}:layout:${String(input.layout.imageEntry.imageInstanceId)}`,
      }),
    );
  }

  const entryFunctionInstanceId = input.program.image.entryFunctionInstanceId;
  if (entryFunctionInstanceId === undefined) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_MISSING_IMAGE_ENTRY",
        message: "Executable image build requires a monomorphized entry function instance.",
        ownerKey: "image-entry",
        stableDetail: "missing-entry-function",
      }),
    );
    return;
  }

  if (input.layout.imageEntry.entryFunctionInstanceId !== entryFunctionInstanceId) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_MISSING_IMAGE_ENTRY",
        message: "Layout image-entry ABI does not match monomorphized entry function instance.",
        ownerKey: "image-entry",
        stableDetail: `entry:${String(entryFunctionInstanceId)}:layout:${String(input.layout.imageEntry.entryFunctionInstanceId ?? "missing")}`,
      }),
    );
  }
}

function validateExternalRoots(input: {
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const externalRoots = input.program.externalRoots;
  if (externalRoots.length === 0) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_MISSING_EXTERNAL_ROOTS",
        message: "Monomorphized program is missing instantiated external entry roots.",
        ownerKey: "external-roots",
        stableDetail: "missing-external-roots",
      }),
    );
    return;
  }

  for (const root of externalRoots) {
    validateExternalRoot({
      program: input.program,
      root,
      diagnostics: input.diagnostics,
    });
  }

  validateImageEntryExternalRoot({
    program: input.program,
    externalRoots,
    diagnostics: input.diagnostics,
  });
}

function validateImageEntryExternalRoot(input: {
  readonly program: MonomorphizedHirProgram;
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const entryFunctionInstanceId = input.program.image.entryFunctionInstanceId;
  if (entryFunctionInstanceId === undefined) {
    return;
  }

  const hasMatchingImageEntry = input.externalRoots.some(
    (root) => root.reason === "imageEntry" && root.functionInstanceId === entryFunctionInstanceId,
  );
  if (hasMatchingImageEntry) {
    return;
  }

  const hasImageEntryRoot = input.externalRoots.some((root) => root.reason === "imageEntry");
  input.diagnostics.push(
    inputCompatibilityDiagnostic({
      code: hasImageEntryRoot ? "PROOF_MIR_INVALID_EXTERNAL_ROOT" : "PROOF_MIR_MISSING_IMAGE_ENTRY",
      message: hasImageEntryRoot
        ? "External entry roots do not include an image entry root matching the monomorphized entry function instance."
        : "Monomorphized program is missing an image entry external root.",
      ownerKey: "external-roots",
      stableDetail: hasImageEntryRoot
        ? `entry:${String(entryFunctionInstanceId)}`
        : "missing-image-entry-root",
    }),
  );
}

function validateExternalRoot(input: {
  readonly program: MonomorphizedHirProgram;
  readonly root: MonoExternalRoot;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  if (input.program.functions.get(input.root.functionInstanceId) === undefined) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_INVALID_EXTERNAL_ROOT",
        message: "External entry root references a missing monomorphized function instance.",
        ownerKey: `external-root:${input.root.reason}`,
        stableDetail: `function:${String(input.root.functionInstanceId)}`,
        functionInstanceId: input.root.functionInstanceId,
      }),
    );
    return;
  }

  if (
    input.root.reason === "imageEntry" &&
    input.root.functionInstanceId !== input.program.image.entryFunctionInstanceId
  ) {
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_INVALID_EXTERNAL_ROOT",
        message: "Image entry external root does not match monomorphized entry function instance.",
        ownerKey: `external-root:${input.root.reason}`,
        stableDetail: `function:${String(input.root.functionInstanceId)}`,
        functionInstanceId: input.root.functionInstanceId,
      }),
    );
  }
}

function validateMonoSourceTypeFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  for (const typeInstance of input.program.types.entries()) {
    const typeKey = sourceTypeKeyForInstance(typeInstance.instanceId);
    const layoutReferenceKey = layoutTypeKeyString(typeKey);
    if (!input.layout.types.has(typeKey)) {
      input.diagnostics.push(
        inputCompatibilityDiagnostic({
          code: "PROOF_MIR_MISSING_LAYOUT_TYPE_FACT",
          message: "Required layout type fact is missing from LayoutFactProgram.",
          ownerKey: layoutReferenceKey,
          stableDetail: layoutReferenceKey,
        }),
      );
    }
  }

  for (const typeFact of input.layout.types.entries()) {
    if (typeFact.key.kind !== "source") {
      continue;
    }
    if (input.program.types.get(typeFact.key.instanceId) === undefined) {
      input.diagnostics.push(
        inputCompatibilityDiagnostic({
          code: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
          message: "Layout type fact references a missing monomorphized type instance.",
          ownerKey: layoutTypeKeyString(typeFact.key),
          stableDetail: `extra-layout-type:${layoutTypeKeyString(typeFact.key)}`,
        }),
      );
    }
  }
}

function monoFieldRecordExists(input: {
  readonly program: MonomorphizedHirProgram;
  readonly typeInstance: MonoTypeInstance;
  readonly fieldId: FieldId;
}): boolean {
  if (input.typeInstance.fields.some((field) => field.fieldId === input.fieldId)) {
    return true;
  }
  if (input.typeInstance.sourceKind !== "validatedBuffer") {
    return false;
  }
  const buffer = input.program.validatedBuffers.get(input.typeInstance.instanceId);
  return buffer?.parameterFields.some((field) => field.fieldId === input.fieldId) ?? false;
}

function validateMonoFieldFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  for (const typeInstance of input.program.types.entries()) {
    for (const field of typeInstance.fields) {
      const fieldKey = fieldKeyForMonoType({
        instanceId: typeInstance.instanceId,
        fieldId: field.fieldId,
      });
      const layoutReferenceKey = layoutFieldKeyString(fieldKey);
      if (!input.layout.fields.has(fieldKey)) {
        input.diagnostics.push(
          inputCompatibilityDiagnostic({
            code: "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT",
            message: "Required layout field fact is missing from LayoutFactProgram.",
            ownerKey: layoutReferenceKey,
            stableDetail: layoutReferenceKey,
          }),
        );
      }
    }
  }

  for (const fieldFact of input.layout.fields.entries()) {
    const typeInstance = input.program.types.get(fieldFact.owner.instanceId);
    if (typeInstance === undefined) {
      input.diagnostics.push(
        inputCompatibilityDiagnostic({
          code: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
          message: "Layout field fact references a missing monomorphized type instance.",
          ownerKey: layoutFieldKeyString({
            owner: fieldFact.owner,
            fieldId: fieldFact.fieldId,
          }),
          stableDetail: `extra-layout-field:${layoutFieldKeyString({
            owner: fieldFact.owner,
            fieldId: fieldFact.fieldId,
          })}`,
        }),
      );
      continue;
    }
    if (
      !monoFieldRecordExists({ program: input.program, typeInstance, fieldId: fieldFact.fieldId })
    ) {
      input.diagnostics.push(
        inputCompatibilityDiagnostic({
          code: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
          message: "Layout field fact references a missing monomorphized field record.",
          ownerKey: layoutFieldKeyString({
            owner: fieldFact.owner,
            fieldId: fieldFact.fieldId,
          }),
          stableDetail: `extra-layout-field:${layoutFieldKeyString({
            owner: fieldFact.owner,
            fieldId: fieldFact.fieldId,
          })}`,
        }),
      );
    }
  }
}

function validateInstanceIdKeySet(input: {
  readonly ownerKeyPrefix: string;
  readonly monoKeys: readonly string[];
  readonly layoutKeys: readonly string[];
  readonly missingCode: string;
  readonly missingMessage: string;
  readonly extraCode: string;
  readonly extraMessage: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const monoKeySet = new Set(input.monoKeys);
  const layoutKeySet = new Set(input.layoutKeys);

  for (const key of sortKeyStrings(monoKeySet)) {
    if (layoutKeySet.has(key)) {
      continue;
    }
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: input.missingCode,
        message: input.missingMessage,
        ownerKey: `${input.ownerKeyPrefix}:${key}`,
        stableDetail: key,
      }),
    );
  }

  for (const key of sortKeyStrings(layoutKeySet)) {
    if (monoKeySet.has(key)) {
      continue;
    }
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: input.extraCode,
        message: input.extraMessage,
        ownerKey: `${input.ownerKeyPrefix}:${key}`,
        stableDetail: `extra-layout:${key}`,
      }),
    );
  }
}

function validateValidatedBufferFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  validateInstanceIdKeySet({
    ownerKeyPrefix: "validated-buffer",
    monoKeys: input.program.validatedBuffers
      .entries()
      .map((buffer) => layoutValidatedBufferKeyString(buffer.instanceId)),
    layoutKeys: input.layout.validatedBuffers
      .entries()
      .map((buffer) => layoutValidatedBufferKeyString(buffer.instanceId)),
    missingCode: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
    missingMessage: "Required validated-buffer layout fact is missing from LayoutFactProgram.",
    extraCode: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
    extraMessage: "Layout validated-buffer fact references a missing monomorphized instance.",
    diagnostics: input.diagnostics,
  });
}

function validateFunctionAbiFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  validateInstanceIdKeySet({
    ownerKeyPrefix: "function-abi",
    monoKeys: input.program.functions
      .entries()
      .map((functionInstance) => layoutFunctionKeyString(functionInstance.instanceId)),
    layoutKeys: input.layout.functions
      .entries()
      .map((functionFact) => layoutFunctionKeyString(functionFact.functionInstanceId)),
    missingCode: "PROOF_MIR_MISSING_FUNCTION_ABI_FACT",
    missingMessage: "Required function ABI layout fact is missing from LayoutFactProgram.",
    extraCode: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
    extraMessage: "Layout function ABI fact references a missing monomorphized function instance.",
    diagnostics: input.diagnostics,
  });
}

function validatePlatformEdgeFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  validateInstanceIdKeySet({
    ownerKeyPrefix: "platform-edge",
    monoKeys: input.program.proofMetadata.platformContractEdges
      .entries()
      .map((edge) => layoutPlatformEdgeKeyString(edge.edgeId)),
    layoutKeys: input.layout.platformEdges
      .entries()
      .map((edge) => layoutPlatformEdgeKeyString(edge.edgeId)),
    missingCode: "PROOF_MIR_MISSING_PLATFORM_ABI_FACT",
    missingMessage: "Required platform ABI layout fact is missing from LayoutFactProgram.",
    extraCode: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
    extraMessage: "Layout platform ABI fact references a missing monomorphized platform edge.",
    diagnostics: input.diagnostics,
  });
}

function validateImageDeviceFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  validateInstanceIdKeySet({
    ownerKeyPrefix: "image-device",
    monoKeys: input.program.image.devices.map((device) =>
      layoutImageDeviceKeyString(
        imageDeviceKeyForMonoDevice({
          imageInstanceId: input.program.image.instanceId,
          fieldId: device.fieldId,
        }),
      ),
    ),
    layoutKeys: input.layout.imageDevices
      .entries()
      .map((device) => layoutImageDeviceKeyString(device.key)),
    missingCode: "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT",
    missingMessage: "Required image-device layout fact is missing from LayoutFactProgram.",
    extraCode: "PROOF_MIR_LAYOUT_KEY_SET_MISMATCH",
    extraMessage: "Layout image-device fact references a missing monomorphized image device.",
    diagnostics: input.diagnostics,
  });
}

function validateReachableBodylessRecoveryFunctions(input: {
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  for (const functionInstance of input.program.functions.entries()) {
    if (functionInstance.bodyStatus !== "bodylessRecovery") {
      continue;
    }
    input.diagnostics.push(
      inputCompatibilityDiagnostic({
        code: "PROOF_MIR_MISSING_FUNCTION_BODY",
        message: "Reachable bodyless recovery functions cannot be lowered to Proof MIR.",
        ownerKey: `function:${String(functionInstance.instanceId)}`,
        stableDetail: `function:${String(functionInstance.instanceId)}`,
        functionInstanceId: functionInstance.instanceId,
      }),
    );
  }
}

export function validateProofMirBuildInputCompatibility(
  input: ValidateProofMirBuildInputCompatibilityInput,
): readonly ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];

  validateTargetCompatibility({
    layout: input.layout,
    target: input.target,
    diagnostics,
  });
  validateRuntimeCatalogCompatibility({
    target: input.target,
    diagnostics,
  });
  validateImageEntryCompatibility({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateExternalRoots({
    program: input.program,
    diagnostics,
  });
  validateMonoSourceTypeFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateMonoFieldFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateValidatedBufferFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateFunctionAbiFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validatePlatformEdgeFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateImageDeviceFacts({
    program: input.program,
    layout: input.layout,
    diagnostics,
  });
  validateReachableBodylessRecoveryFunctions({
    program: input.program,
    diagnostics,
  });

  return sortProofMirDiagnostics(diagnostics);
}
