import type { OptIrEdgeId, OptIrOperationId } from "./ids";

export type OptIrCfgEdit =
  | {
      readonly kind: "branchFold";
      readonly oldTerminator: OptIrOperationId;
      readonly survivingEdge: OptIrEdgeId;
      readonly removedEdges: readonly OptIrEdgeId[];
    }
  | {
      readonly kind: "redirectEdge";
      readonly edge: OptIrEdgeId;
      readonly oldTerminator: OptIrOperationId;
      readonly newTerminator: OptIrOperationId;
    };
