import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirResourceBoundarySet } from "../domains/effects-resources";
import type { ProofMirSsaKey } from "../domains/graph-ssa";
import type {
  ProofMirExpressionLowerer,
  ProofMirStatementLowerer,
  ProofMirTerminalLowerer,
} from "./lowering-context";
import type { LowerIfStatementInBody } from "./loop-if-statement-lowering";

export interface LoopLoweringBlockParameterView {
  readonly parameterKind: { readonly kind: "copyScalar" | "proofFact" };
  readonly predeclared: boolean;
}

export interface LoopLoweringBlockView {
  readonly blockKey: ProofMirCanonicalKey;
  readonly kind: "loopHeader" | "loopBody" | "loopExit";
  readonly parameters: readonly LoopLoweringBlockParameterView[];
  readonly boundaryResources?: DraftProofMirResourceBoundarySet;
}

export interface LoopLoweringEdgeView {
  readonly edgeKey: ProofMirCanonicalKey;
  readonly kind: string;
  readonly arguments: readonly ProofMirCanonicalKey[];
  readonly crossedScopes: readonly string[];
}

export interface ActiveLoopFrame {
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly exitBlockKey: ProofMirCanonicalKey;
  readonly loopScopeKey: ProofMirCanonicalKey;
  readonly loopRole: string;
  readonly loopCarriedScalarKeys: readonly {
    readonly ssaKey: ProofMirSsaKey;
    readonly localKey: ProofMirCanonicalKey;
  }[];
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
}

export interface LoopLoweringSharedInput {
  readonly scopeRoleByKey: ReadonlyMap<string, string>;
  readonly expression: ProofMirExpressionLowerer & {};
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly activeLoopRef: { frame?: ActiveLoopFrame };
  readonly lowerIfStatementInBody: LowerIfStatementInBody;
}

export interface StructuredLoopScaffold {
  readonly originKey: ProofMirCanonicalKey;
  readonly loopScopeKey: ProofMirCanonicalKey;
  readonly loopRole: string;
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly exitBlockKey: ProofMirCanonicalKey;
  readonly loopCarriedScalarKeys: readonly {
    readonly ssaKey: ProofMirSsaKey;
    readonly localKey: ProofMirCanonicalKey;
  }[];
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
  readonly frame: ActiveLoopFrame;
}
