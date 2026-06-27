import {
  layoutFunctionKeyString,
  layoutPlatformEdgeKeyString,
  layoutValidatedBufferKeyString,
} from "../../layout/layout-fact-builder-support";
import type {
  LayoutFactProgram,
  LayoutReadRequirement,
  LayoutTerm,
  LayoutTermUnit,
  LayoutValidatedBufferFact,
  LayoutValidatedBufferFieldFact,
} from "../../layout/layout-program";
import {
  layoutFieldKeyString,
  layoutImageDeviceKeyString,
  layoutTypeKeyString,
} from "../../layout/type-key";
import type { MonoInstanceId } from "../../mono/ids";
import type { FieldId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirLengthDelimitedField } from "../canonicalization/canonical-order";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { draftLayoutTermKey } from "../draft/draft-keys";
import type { DraftProofMirLayoutTermRecord } from "../draft/draft-program";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermChild,
  ProofMirLayoutTermRoot,
} from "../model/layout-bindings";

export type ProofMirLayoutBindingResolveResult =
  | { readonly kind: "ok"; readonly layoutReferenceKey: string }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export type ProofMirLayoutTermResolveResult =
  | {
      readonly kind: "ok";
      readonly key: ProofMirCanonicalKey;
      readonly layoutReferenceKey: string;
      readonly termPath: string;
      readonly unit: LayoutTermUnit;
      readonly term: LayoutTerm;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface ProofMirLayoutBindingIndex {
  resolveReference(reference: ProofMirLayoutReference): ProofMirLayoutBindingResolveResult;
  resolveTerm(input: {
    readonly root: ProofMirLayoutTermRoot;
    readonly childPath: readonly ProofMirLayoutTermChild[];
    readonly expectedUnit: LayoutTermUnit;
  }): ProofMirLayoutTermResolveResult;
  layoutTermRecords(): readonly DraftProofMirLayoutTermRecord[];
  diagnostics(): readonly ProofMirDiagnostic[];
}

export interface CreateProofMirLayoutBindingIndexInput {
  readonly layout: LayoutFactProgram;
}

function imageEntryLayoutReferenceKey(imageInstanceId: MonoInstanceId): string {
  return proofMirLengthDelimitedField("image-entry", String(imageInstanceId));
}

export function proofMirLayoutReferenceKey(reference: ProofMirLayoutReference): string {
  switch (reference.kind) {
    case "type":
      return layoutTypeKeyString(reference.key);
    case "field":
      return layoutFieldKeyString(reference.key);
    case "validatedBuffer":
      return layoutValidatedBufferKeyString(reference.instanceId);
    case "validatedBufferField":
      return proofMirLengthDelimitedField(
        "validated-buffer-field",
        `${String(reference.instanceId)}:${String(reference.fieldId)}`,
      );
    case "imageDevice":
      return layoutImageDeviceKeyString(reference.key);
    case "platformAbi":
      return layoutPlatformEdgeKeyString(reference.edgeId);
    case "functionAbi":
      return layoutFunctionKeyString(reference.functionInstanceId);
    case "imageEntryAbi":
      return imageEntryLayoutReferenceKey(reference.imageInstanceId);
    default: {
      const unreachable: never = reference;
      return unreachable;
    }
  }
}

function layoutTermRootSegment(root: ProofMirLayoutTermRoot): string {
  switch (root.kind) {
    case "validatedBufferSourceLength":
      return [
        proofMirLengthDelimitedField("root", "validatedBufferSourceLength"),
        proofMirLengthDelimitedField("instanceId", String(root.instanceId)),
      ].join("/");
    case "validatedBufferFieldTerm":
      return [
        proofMirLengthDelimitedField("root", "validatedBufferFieldTerm"),
        proofMirLengthDelimitedField("instanceId", String(root.instanceId)),
        proofMirLengthDelimitedField("fieldId", String(root.fieldId)),
        proofMirLengthDelimitedField("slot", root.slot),
      ].join("/");
    case "validatedBufferReadRequirement":
      return [
        proofMirLengthDelimitedField("root", "validatedBufferReadRequirement"),
        proofMirLengthDelimitedField("instanceId", String(root.instanceId)),
        proofMirLengthDelimitedField("fieldId", String(root.fieldId)),
        proofMirLengthDelimitedField("requirementIndex", String(root.requirementIndex)),
        proofMirLengthDelimitedField("slot", root.slot),
      ].join("/");
    case "validatedBufferDerivedSource":
      return [
        proofMirLengthDelimitedField("root", "validatedBufferDerivedSource"),
        proofMirLengthDelimitedField("instanceId", String(root.instanceId)),
        proofMirLengthDelimitedField("fieldId", String(root.fieldId)),
      ].join("/");
    case "validatedBufferDerivedCase":
      return [
        proofMirLengthDelimitedField("root", "validatedBufferDerivedCase"),
        proofMirLengthDelimitedField("instanceId", String(root.instanceId)),
        proofMirLengthDelimitedField("fieldId", String(root.fieldId)),
        proofMirLengthDelimitedField("caseIndex", String(root.caseIndex)),
        proofMirLengthDelimitedField("slot", root.slot),
      ].join("/");
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

export function proofMirLayoutTermPathString(input: {
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
}): string {
  const segments = [layoutTermRootSegment(input.root)];
  for (const child of input.childPath) {
    segments.push(proofMirLengthDelimitedField("child", child));
  }
  return segments.join("/");
}

function validatedBufferLayoutReferenceKey(instanceId: MonoInstanceId): string {
  return layoutValidatedBufferKeyString(instanceId);
}

function layoutTermPathOwnerKey(root: ProofMirLayoutTermRoot): string {
  switch (root.kind) {
    case "validatedBufferSourceLength":
    case "validatedBufferFieldTerm":
    case "validatedBufferReadRequirement":
    case "validatedBufferDerivedSource":
    case "validatedBufferDerivedCase":
      return validatedBufferLayoutReferenceKey(root.instanceId);
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

function layoutTermPathDiagnostic(input: {
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  const ownerKey = layoutTermPathOwnerKey(input.root);
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_LAYOUT_TERM_PATH",
    message: "Layout term path does not resolve to a term with the expected unit.",
    ownerKey,
    rootCauseKey: "layout-term-path",
    stableDetail: `${proofMirLayoutTermPathString(input)}:${input.stableDetail}`,
  });
}

function findValidatedBufferField(
  buffer: LayoutValidatedBufferFact,
  fieldId: FieldId,
): LayoutValidatedBufferFieldFact | undefined {
  return buffer.layoutFields.find((field) => field.fieldId === fieldId);
}

function readRequirementTerm(
  requirement: LayoutReadRequirement,
  slot: "end" | "left" | "right" | "expression",
): LayoutTerm | undefined {
  switch (requirement.kind) {
    case "layoutFits":
    case "payloadEnd":
      return slot === "end" ? requirement.end : undefined;
    case "rangeConstraint":
      if (slot === "left") {
        return requirement.left;
      }
      if (slot === "right") {
        return requirement.right;
      }
      return undefined;
    case "noUnsignedOverflow":
      return slot === "expression" ? requirement.expression : undefined;
    case "fieldAvailable":
      return undefined;
    default: {
      const unreachable: never = requirement;
      return unreachable;
    }
  }
}

function resolveLayoutTermRoot(
  layout: LayoutFactProgram,
  root: ProofMirLayoutTermRoot,
): LayoutTerm | undefined {
  switch (root.kind) {
    case "validatedBufferSourceLength": {
      const buffer = layout.validatedBuffers.get(root.instanceId);
      return buffer?.sourceLengthTerm;
    }
    case "validatedBufferFieldTerm": {
      const buffer = layout.validatedBuffers.get(root.instanceId);
      const field =
        buffer === undefined ? undefined : findValidatedBufferField(buffer, root.fieldId);
      if (field === undefined) {
        return undefined;
      }
      switch (root.slot) {
        case "offset":
          return field.offset;
        case "byteLength":
          return field.byteLength;
        case "elementCount":
          return field.elementCount;
        case "end":
          return field.end;
        case "derivedValue":
          return undefined;
      }
    }
    case "validatedBufferReadRequirement": {
      const buffer = layout.validatedBuffers.get(root.instanceId);
      const field =
        buffer === undefined ? undefined : findValidatedBufferField(buffer, root.fieldId);
      const requirement = field?.readRequires[root.requirementIndex];
      if (requirement === undefined) {
        return undefined;
      }
      return readRequirementTerm(requirement, root.slot);
    }
    case "validatedBufferDerivedSource": {
      const buffer = layout.validatedBuffers.get(root.instanceId);
      const derived = buffer?.derivedFields.find((field) => field.fieldId === root.fieldId);
      return derived?.source;
    }
    case "validatedBufferDerivedCase": {
      const buffer = layout.validatedBuffers.get(root.instanceId);
      const derived = buffer?.derivedFields.find((field) => field.fieldId === root.fieldId);
      const derivedCase = derived?.cases[root.caseIndex];
      if (derivedCase === undefined) {
        return undefined;
      }
      switch (root.slot) {
        case "conditionValue":
          return derivedCase.condition.kind === "equals" ? derivedCase.condition.value : undefined;
        case "result":
          return derivedCase.result;
      }
    }
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

function descendLayoutTerm(
  term: LayoutTerm,
  childPath: readonly ProofMirLayoutTermChild[],
): LayoutTerm | undefined {
  let current: LayoutTerm = term;
  for (const child of childPath) {
    switch (current.kind) {
      case "add":
      case "subtract":
      case "multiply":
        current = child === "left" ? current.left : current.right;
        break;
      case "constant":
      case "sourceLength":
      case "fieldValue":
      case "derivedValue":
        return undefined;
      default: {
        const unreachable: never = current;
        return unreachable;
      }
    }
  }
  return current;
}

function missingLayoutReferenceDiagnostic(input: {
  readonly code:
    | "PROOF_MIR_MISSING_LAYOUT_TYPE_FACT"
    | "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT"
    | "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT"
    | "PROOF_MIR_MISSING_PLATFORM_ABI_FACT"
    | "PROOF_MIR_MISSING_FUNCTION_ABI_FACT"
    | "PROOF_MIR_MISSING_IMAGE_ENTRY";
  readonly layoutReferenceKey: string;
  readonly message: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.layoutReferenceKey,
    rootCauseKey: "layout-reference",
    stableDetail: input.layoutReferenceKey,
  });
}

export function createProofMirLayoutBindingIndex(
  input: CreateProofMirLayoutBindingIndexInput,
): ProofMirLayoutBindingIndex {
  const diagnostics: ProofMirDiagnostic[] = [];
  const layoutTermRecordsByKey = new Map<ProofMirCanonicalKey, DraftProofMirLayoutTermRecord>();

  function resolveReference(
    reference: ProofMirLayoutReference,
  ): ProofMirLayoutBindingResolveResult {
    const layoutReferenceKey = proofMirLayoutReferenceKey(reference);
    switch (reference.kind) {
      case "type":
        if (!input.layout.types.has(reference.key)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_LAYOUT_TYPE_FACT",
            layoutReferenceKey,
            message: "Required layout type fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "field":
        if (!input.layout.fields.has(reference.key)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT",
            layoutReferenceKey,
            message: "Required layout field fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "validatedBuffer":
        if (!input.layout.validatedBuffers.has(reference.instanceId)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
            layoutReferenceKey,
            message: "Required validated-buffer layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "validatedBufferField": {
        const buffer = input.layout.validatedBuffers.get(reference.instanceId);
        const field =
          buffer === undefined ? undefined : findValidatedBufferField(buffer, reference.fieldId);
        if (buffer === undefined || field === undefined) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
            layoutReferenceKey,
            message:
              "Required validated-buffer field layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      }
      case "imageDevice":
        if (!input.layout.imageDevices.has(reference.key)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_LAYOUT_FIELD_FACT",
            layoutReferenceKey,
            message: "Required image-device layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "platformAbi":
        if (!input.layout.platformEdges.has(reference.edgeId)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_PLATFORM_ABI_FACT",
            layoutReferenceKey,
            message: "Required platform ABI layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "functionAbi":
        if (!input.layout.functions.has(reference.functionInstanceId)) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_FUNCTION_ABI_FACT",
            layoutReferenceKey,
            message: "Required function ABI layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      case "imageEntryAbi":
        if (input.layout.imageEntry.imageInstanceId !== reference.imageInstanceId) {
          const diagnostic = missingLayoutReferenceDiagnostic({
            code: "PROOF_MIR_MISSING_IMAGE_ENTRY",
            layoutReferenceKey,
            message: "Required image-entry ABI layout fact is missing from LayoutFactProgram.",
          });
          diagnostics.push(diagnostic);
          return { kind: "error", diagnostics: [diagnostic] };
        }
        return { kind: "ok", layoutReferenceKey };
      default: {
        const unreachable: never = reference;
        return unreachable;
      }
    }
  }

  function resolveTerm(resolveInput: {
    readonly root: ProofMirLayoutTermRoot;
    readonly childPath: readonly ProofMirLayoutTermChild[];
    readonly expectedUnit: LayoutTermUnit;
  }): ProofMirLayoutTermResolveResult {
    const termPath = proofMirLayoutTermPathString(resolveInput);
    const layoutReferenceKey = layoutTermPathOwnerKey(resolveInput.root);
    const rootTerm = resolveLayoutTermRoot(input.layout, resolveInput.root);
    if (rootTerm === undefined) {
      const diagnostic = layoutTermPathDiagnostic({
        root: resolveInput.root,
        childPath: resolveInput.childPath,
        stableDetail: "missing-root",
      });
      diagnostics.push(diagnostic);
      return { kind: "error", diagnostics: [diagnostic] };
    }

    const resolvedTerm = descendLayoutTerm(rootTerm, resolveInput.childPath);
    if (resolvedTerm === undefined) {
      const diagnostic = layoutTermPathDiagnostic({
        root: resolveInput.root,
        childPath: resolveInput.childPath,
        stableDetail: "unsupported-child-path",
      });
      diagnostics.push(diagnostic);
      return { kind: "error", diagnostics: [diagnostic] };
    }

    if (resolvedTerm.unit !== resolveInput.expectedUnit) {
      const diagnostic = layoutTermPathDiagnostic({
        root: resolveInput.root,
        childPath: resolveInput.childPath,
        stableDetail: `unit:${resolvedTerm.unit}`,
      });
      diagnostics.push(diagnostic);
      return { kind: "error", diagnostics: [diagnostic] };
    }

    const key = draftLayoutTermKey({ layoutReferenceKey, termPath });
    if (!layoutTermRecordsByKey.has(key)) {
      layoutTermRecordsByKey.set(key, {
        key,
        layoutReferenceKey,
        termPath,
        root: resolveInput.root,
        childPath: [...resolveInput.childPath],
        unit: resolvedTerm.unit,
      });
    }

    return {
      kind: "ok",
      key,
      layoutReferenceKey,
      termPath,
      unit: resolvedTerm.unit,
      term: resolvedTerm,
    };
  }

  return {
    resolveReference,
    resolveTerm,
    layoutTermRecords() {
      return [...layoutTermRecordsByKey.values()].sort((left, right) =>
        String(left.key).localeCompare(String(right.key)),
      );
    },
    diagnostics() {
      return sortProofMirDiagnostics(diagnostics);
    },
  };
}
