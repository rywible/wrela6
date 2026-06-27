import type { LayoutReadRequirement, LayoutValidatedBufferFact } from "../../layout/layout-program";
import type { FieldId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirFactKey, ProofMirFactRecorder } from "../domains/fact-recording";
import type { ProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import { findLayoutField } from "../domains/validated-buffer-read-detection";
import type { DraftProofMirOriginKey } from "../domains/origin-map";
import { loweringError, loweringOk } from "./call-lowering-shared";
import type {
  ProofMirLoweringResult,
  ProofMirValidatedBufferReadLoweringInput,
} from "./lowering-context";
import { resolveRequirementEndTerm } from "./validated-buffer-read-layout-terms";

function recordReadRequirementFact(input: {
  readonly factRecorder: ProofMirFactRecorder;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly layoutBuffer: LayoutValidatedBufferFact;
  readonly fieldId: FieldId;
  readonly requirementIndex: number;
  readonly requirement: LayoutReadRequirement;
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly originKey: DraftProofMirOriginKey;
}): DraftProofMirFactKey | undefined {
  const layoutReference = {
    kind: "validatedBufferField" as const,
    instanceId: input.layoutBuffer.instanceId,
    fieldId: input.fieldId,
  };
  const dependsOn = [{ kind: "layout" as const, layout: layoutReference }];

  switch (input.requirement.kind) {
    case "layoutFits": {
      const endTerm = resolveRequirementEndTerm({
        layoutBindingIndex: input.layoutBindingIndex,
        layoutBuffer: input.layoutBuffer,
        fieldId: input.fieldId,
        requirementIndex: input.requirementIndex,
        term: input.requirement.end,
      });
      if (endTerm === undefined) {
        return undefined;
      }
      return input.factRecorder.recordLayoutFitsFact({
        role: "requirement",
        sourcePlaceKey: input.sourcePlaceKey,
        end: endTerm,
        dependsOn,
        origin: input.originKey,
      });
    }
    case "payloadEnd": {
      const endTerm = resolveRequirementEndTerm({
        layoutBindingIndex: input.layoutBindingIndex,
        layoutBuffer: input.layoutBuffer,
        fieldId: input.fieldId,
        requirementIndex: input.requirementIndex,
        term: input.requirement.end,
      });
      if (endTerm === undefined) {
        return undefined;
      }
      return input.factRecorder.recordPayloadEndFact({
        role: "requirement",
        sourcePlaceKey: input.sourcePlaceKey,
        end: endTerm,
        dependsOn,
        origin: input.originKey,
      });
    }
    case "fieldAvailable":
    case "rangeConstraint":
    case "noUnsignedOverflow":
      return undefined;
    default: {
      const unreachable: never = input.requirement;
      return unreachable;
    }
  }
}

export function recordReadRequirementFacts(input: {
  readonly context: ProofMirValidatedBufferReadLoweringInput["context"];
  readonly layoutBuffer: LayoutValidatedBufferFact;
  readonly fieldId: FieldId;
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly originKey: DraftProofMirOriginKey;
}): ProofMirLoweringResult<readonly DraftProofMirFactKey[]> {
  const layoutField = findLayoutField(input.layoutBuffer, input.fieldId);
  if (layoutField === undefined) {
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

  const factKeys: DraftProofMirFactKey[] = [];
  for (const [requirementIndex, requirement] of layoutField.readRequires.entries()) {
    const factKey = recordReadRequirementFact({
      factRecorder: input.context.factRecorder,
      layoutBindingIndex: input.context.layoutBindingIndex,
      layoutBuffer: input.layoutBuffer,
      fieldId: input.fieldId,
      requirementIndex,
      requirement,
      sourcePlaceKey: input.sourcePlaceKey,
      originKey: input.originKey,
    });
    if (factKey === undefined) {
      continue;
    }
    factKeys.push(factKey);
  }
  return loweringOk(factKeys);
}
