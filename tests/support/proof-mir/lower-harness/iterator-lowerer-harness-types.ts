import type { MonoInstanceId } from "../../../../src/mono/ids";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import type { ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import type { DraftGraphTerminator } from "../../../../src/proof-mir/draft/draft-graph-builder";
import type { DraftRecordedProofMirCall } from "../../../../src/proof-mir/lower/call-lowerer";
import type { IteratorLoweringEdgeView } from "../../../../src/proof-mir/lower/iterator-lowerer";
import type { LoopLoweringBlockView } from "../../../../src/proof-mir/lower/loop-lowerer";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";

export interface IteratorLoweringTestSuccess {
  readonly kind: "ok";
  readonly header: LoopLoweringBlockView;
  readonly body: LoopLoweringBlockView;
  readonly exit: LoopLoweringBlockView;
  readonly nextCall: DraftRecordedProofMirCall;
  readonly itemEdge: IteratorLoweringEdgeView;
  readonly finishedEdge: IteratorLoweringEdgeView;
  readonly errorEdge?: IteratorLoweringEdgeView;
  readonly iteratorPlaceKey: ProofMirCanonicalKey;
  blockTerminator(blockKey: ProofMirCanonicalKey): DraftGraphTerminator | undefined;
}

export type IteratorLoweringTestResult =
  | IteratorLoweringTestSuccess
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface LowerProofMirOrdinaryForForTestInput {
  readonly functionInstanceId?: MonoInstanceId;
  readonly source: readonly string[];
  readonly iteratorProtocol: "checkedIterator" | "stream";
  readonly scalarLocals?: readonly string[];
  readonly loopCarriedLocals?: readonly string[];
  readonly placeBackedLocals?: readonly string[];
  readonly fallible?: boolean;
}

export interface OrdinaryIteratorProtocolProofMirBuildInputParts {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
}
