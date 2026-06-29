import type { HirExpressionId, HirOriginId, HirStatementId } from "../hir/ids";
import type { MonoInstanceId } from "../mono/ids";
import type { LayoutFactKey, CheckedPacketFactId } from "../proof-check/model/fact-packet";
import type { ProofMirStatementId } from "../proof-mir/ids";
import type { OptIrOriginId, OptimizationPassId } from "./ids";

export interface OptIrSourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface OptIrSourceOrigin {
  readonly file: string;
  readonly span?: OptIrSourceSpan;
}

export type OptIrHirNodeOrigin =
  | { readonly kind: "origin"; readonly originId: HirOriginId }
  | { readonly kind: "statement"; readonly statementId: HirStatementId }
  | { readonly kind: "expression"; readonly expressionId: HirExpressionId };

export interface OptIrHirOrigin {
  readonly originId?: HirOriginId;
  readonly node?: OptIrHirNodeOrigin;
}

export interface OptIrMonoOrigin {
  readonly functionInstanceId: MonoInstanceId;
  readonly hirStatementId?: HirStatementId;
  readonly hirExpressionId?: HirExpressionId;
}

export type OptIrProofMirNodeOrigin =
  | { readonly kind: "statement"; readonly statementId: ProofMirStatementId }
  | { readonly kind: "node"; readonly nodeKey: string };

export interface OptIrCheckedMirOrigin {
  readonly functionInstanceId: MonoInstanceId;
  readonly nodeKey: string;
}

export interface OptIrSyntheticOrigin {
  readonly passId: OptimizationPassId;
  readonly contributors: readonly OptIrOriginId[];
}

export interface OptIrOrigin {
  readonly originId: OptIrOriginId;
  readonly source?: OptIrSourceOrigin;
  readonly hir?: OptIrHirOrigin;
  readonly mono?: OptIrMonoOrigin;
  readonly proofMirNode?: OptIrProofMirNodeOrigin;
  readonly checkedMir?: OptIrCheckedMirOrigin;
  readonly layoutFact?: LayoutFactKey;
  readonly checkedFact?: CheckedPacketFactId;
  readonly synthetic?: OptIrSyntheticOrigin;
}
