import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "../report";
import type { FullImageReferenceCheckerKey } from "./types";

export function referenceCheckReport(input: {
  readonly checkerKey: FullImageReferenceCheckerKey;
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly inputAuthority: readonly FullImageValidationEvidenceAuthority[];
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return Object.freeze({
    checkerKey: input.checkerKey,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: Object.freeze([...input.inputAuthority]),
    evidence: Object.freeze([...input.evidence]),
  });
}

export function referenceEvidence(input: {
  readonly authority: FullImageValidationEvidenceAuthority;
  readonly evidenceKey: string;
  readonly stableDetail: string;
}): FullImageValidationEvidenceRecord {
  return Object.freeze({
    authority: input.authority,
    evidenceKey: input.evidenceKey,
    stableDetail: input.stableDetail,
  });
}
