import type { LayoutTermUnit } from "../../layout/layout-program";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirCanonicalKeyLookup } from "../canonicalization/id-assignment";
import type { ProofMirLayoutTermId } from "../ids";
import type { ProofMirLayoutTermPath, ProofMirLayoutTermReference } from "../model/layout-bindings";

export interface DraftProofMirLayoutTermReference {
  readonly termKey: ProofMirCanonicalKey;
  readonly path: ProofMirLayoutTermPath;
  readonly unit: LayoutTermUnit;
}

export function draftLayoutTermPathKey(
  term: Pick<DraftProofMirLayoutTermReference, "path">,
): string {
  const root = term.path.root;
  switch (root.kind) {
    case "validatedBufferSourceLength":
      return `sourceLength:${String(root.instanceId)}`;
    case "validatedBufferFieldTerm":
      return `fieldTerm:${String(root.instanceId)}:${String(root.fieldId)}:${root.slot}`;
    case "validatedBufferReadRequirement":
      return `readRequirement:${String(root.instanceId)}:${String(root.fieldId)}:${root.requirementIndex}:${root.slot}`;
    case "validatedBufferDerivedSource":
      return `derivedSource:${String(root.instanceId)}:${String(root.fieldId)}`;
    case "validatedBufferDerivedCase":
      return `derivedCase:${String(root.instanceId)}:${String(root.fieldId)}:${root.caseIndex}:${root.slot}`;
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

export function freezeDraftLayoutTermReference(
  term: DraftProofMirLayoutTermReference,
  layoutTermKeyLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>,
): ProofMirLayoutTermReference | undefined {
  const termId = layoutTermKeyLookup.resolve(term.termKey);
  if (termId === undefined) {
    return undefined;
  }
  return {
    termId,
    path: term.path,
    unit: term.unit,
  };
}
