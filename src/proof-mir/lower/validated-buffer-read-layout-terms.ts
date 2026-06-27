import type {
  LayoutTerm,
  LayoutTermUnit,
  LayoutValidatedBufferFact,
} from "../../layout/layout-program";
import type { FieldId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirOriginKey } from "../domains/origin-map";
import type { ProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import { findLayoutField } from "../domains/validated-buffer-read-detection";
import type { DraftProofMirLayoutTermReference } from "../draft/draft-layout-term-reference";
import type { DraftProofMirLayoutTermBinding } from "../draft/draft-statement";
import type { ProofMirLayoutTermChild, ProofMirLayoutTermRoot } from "../model/layout-bindings";
import { loweringError, loweringOk } from "./call-lowering-shared";
import type {
  ProofMirLoweringResult,
  ProofMirValidatedBufferReadLoweringInput,
} from "./lowering-context";
import {
  type RecordedProofMirStatement,
  recordValidatedBufferReadStatement,
} from "./validated-buffer-read-statement-recorder";

export function resolveLayoutTermReference(input: {
  readonly context: ProofMirValidatedBufferReadLoweringInput["context"];
  readonly root: ProofMirLayoutTermRoot;
  readonly childPath: readonly ProofMirLayoutTermChild[];
  readonly expectedUnit: LayoutTermUnit;
}): ProofMirLoweringResult<DraftProofMirLayoutTermReference> {
  const resolved = input.context.layoutBindingIndex.resolveTerm({
    root: input.root,
    childPath: input.childPath,
    expectedUnit: input.expectedUnit,
  });
  if (resolved.kind === "error") {
    return resolved;
  }
  return loweringOk({
    termKey: resolved.key,
    unit: resolved.unit,
    path: {
      root: input.root,
      childPath: input.childPath,
    },
  });
}

function layoutTermNeedsBinding(term: LayoutTerm): boolean {
  switch (term.kind) {
    case "sourceLength":
    case "fieldValue":
    case "derivedValue":
      return true;
    case "constant":
      return false;
    case "add":
    case "subtract":
    case "multiply":
      return layoutTermNeedsBinding(term.left) || layoutTermNeedsBinding(term.right);
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function fieldTermUnit(
  buffer: LayoutValidatedBufferFact,
  fieldIdValue: FieldId,
  slot: "offset" | "end",
): LayoutTermUnit | undefined {
  const field = findLayoutField(buffer, fieldIdValue);
  if (field === undefined) {
    return undefined;
  }
  switch (slot) {
    case "offset":
      return field.offset.unit;
    case "end":
      return field.end.unit;
  }
}

export function collectDynamicLayoutTermBindings(input: {
  readonly context: ProofMirValidatedBufferReadLoweringInput["context"];
  readonly layoutBuffer: LayoutValidatedBufferFact;
  readonly fieldId: FieldId;
  readonly slot: "offset" | "end";
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly originKey: DraftProofMirOriginKey;
  readonly blockKey: ProofMirCanonicalKey;
  readonly recorded: RecordedProofMirStatement[];
}): ProofMirLoweringResult<readonly ProofMirCanonicalKey[]> {
  const expectedUnit = fieldTermUnit(input.layoutBuffer, input.fieldId, input.slot);
  if (expectedUnit === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Required validated-buffer field layout fact is missing from LayoutFactProgram.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: String(input.layoutBuffer.instanceId),
        rootCauseKey: "layout-field",
        stableDetail: String(input.fieldId),
      }),
    ]);
  }
  const resolved = input.context.layoutBindingIndex.resolveTerm({
    root: {
      kind: "validatedBufferFieldTerm",
      instanceId: input.layoutBuffer.instanceId,
      fieldId: input.fieldId,
      slot: input.slot,
    },
    childPath: [],
    expectedUnit,
  });
  if (resolved.kind === "error") {
    return resolved;
  }
  if (!layoutTermNeedsBinding(resolved.term)) {
    return loweringOk([]);
  }

  const termReference: DraftProofMirLayoutTermReference = {
    termKey: resolved.key,
    unit: resolved.unit,
    path: {
      root: {
        kind: "validatedBufferFieldTerm",
        instanceId: input.layoutBuffer.instanceId,
        fieldId: input.fieldId,
        slot: input.slot,
      },
      childPath: [],
    },
  };
  const valueKey = input.context.graph.createValue({
    role: `layoutTerm:${input.slot}`,
    origin: input.originKey,
  });
  const bindingKey = input.context.graph.allocateRequirementFactKey(
    `bindLayoutTerm:${String(resolved.key)}:${String(valueKey)}`,
  );
  const binding: DraftProofMirLayoutTermBinding = {
    key: bindingKey,
    term: termReference,
    valueKey,
    sourcePlaceKey: input.sourcePlaceKey,
    originKey: input.originKey,
  };
  recordValidatedBufferReadStatement({
    recorded: input.recorded,
    context: input.context,
    blockKey: input.blockKey,
    originKey: input.originKey,
    kind: { kind: "bindLayoutTerm", binding },
  });
  return loweringOk([bindingKey]);
}

export function resolveRequirementEndTerm(input: {
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly layoutBuffer: LayoutValidatedBufferFact;
  readonly fieldId: FieldId;
  readonly requirementIndex: number;
  readonly term: LayoutTerm;
}): DraftProofMirLayoutTermReference | undefined {
  const resolved = input.layoutBindingIndex.resolveTerm({
    root: {
      kind: "validatedBufferReadRequirement",
      instanceId: input.layoutBuffer.instanceId,
      fieldId: input.fieldId,
      requirementIndex: input.requirementIndex,
      slot: "end",
    },
    childPath: [],
    expectedUnit: input.term.unit,
  });
  if (resolved.kind !== "ok") {
    return undefined;
  }
  return {
    termKey: resolved.key,
    unit: resolved.unit,
    path: {
      root: {
        kind: "validatedBufferReadRequirement",
        instanceId: input.layoutBuffer.instanceId,
        fieldId: input.fieldId,
        requirementIndex: input.requirementIndex,
        slot: "end",
      },
      childPath: [],
    },
  };
}
