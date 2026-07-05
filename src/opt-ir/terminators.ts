import type { OptIrCfgEdgeTable } from "./cfg";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "./diagnostics";
import type {
  OptIrBlockId,
  OptIrEdgeId,
  OptIrFunctionId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrValueId,
} from "./ids";

export interface OptIrJumpTerminator {
  readonly kind: "jump";
  readonly operationId: OptIrOperationId;
  readonly edge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}

export interface OptIrBranchTerminator {
  readonly kind: "branch";
  readonly operationId: OptIrOperationId;
  readonly condition: OptIrValueId;
  readonly trueEdge: OptIrEdgeId;
  readonly falseEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}

export interface OptIrSwitchTerminator {
  readonly kind: "switch";
  readonly operationId: OptIrOperationId;
  readonly scrutinee: OptIrValueId;
  readonly cases: readonly OptIrSwitchTerminatorCase[];
  readonly defaultEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}

export interface OptIrSwitchTerminatorCase {
  readonly label: string;
  readonly edge: OptIrEdgeId;
}

export interface OptIrReturnTerminator {
  readonly kind: "return";
  readonly operationId: OptIrOperationId;
  readonly values: readonly OptIrValueId[];
  readonly originId: OptIrOriginId;
}

export interface OptIrUnreachableTerminator {
  readonly kind: "unreachable";
  readonly operationId: OptIrOperationId;
  readonly originId: OptIrOriginId;
}

export type OptIrTerminator =
  | OptIrJumpTerminator
  | OptIrBranchTerminator
  | OptIrSwitchTerminator
  | OptIrReturnTerminator
  | OptIrUnreachableTerminator;

export function optIrBranchTerminator(input: {
  readonly operationId: OptIrOperationId;
  readonly condition: OptIrValueId;
  readonly trueEdge: OptIrEdgeId;
  readonly falseEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}): OptIrBranchTerminator {
  return { kind: "branch", ...input };
}

export function optIrSwitchTerminator(input: {
  readonly operationId: OptIrOperationId;
  readonly scrutinee: OptIrValueId;
  readonly cases: readonly OptIrSwitchTerminatorCase[];
  readonly defaultEdge: OptIrEdgeId;
  readonly originId: OptIrOriginId;
}): OptIrSwitchTerminator {
  return { kind: "switch", ...input };
}

export interface OptIrTerminatorEdgeVerificationResult {
  readonly diagnostics: readonly OptIrDiagnostic[];
}

export function optIrTerminatorSuccessorEdges(terminator: OptIrTerminator): readonly OptIrEdgeId[] {
  switch (terminator.kind) {
    case "jump":
      return [terminator.edge];
    case "branch":
      return [terminator.trueEdge, terminator.falseEdge];
    case "switch":
      return [...terminator.cases.map((switchCase) => switchCase.edge), terminator.defaultEdge];
    case "return":
    case "unreachable":
      return [];
  }
}

export function verifyOptIrTerminatorEdges(input: {
  readonly edges: OptIrCfgEdgeTable;
  readonly terminator: OptIrTerminator;
  readonly ownerBlockId?: OptIrBlockId;
  readonly functionId?: OptIrFunctionId;
}): OptIrTerminatorEdgeVerificationResult {
  const diagnostics: OptIrDiagnostic[] = [];
  for (const edgeId of optIrTerminatorSuccessorEdges(input.terminator)) {
    const edge = input.edges.get(edgeId);
    if (edge === undefined) {
      diagnostics.push(missingEdgeDiagnostic(input.terminator, edgeId));
      continue;
    }
    if (input.ownerBlockId !== undefined && edge.from !== input.ownerBlockId) {
      diagnostics.push(ownerMismatchDiagnostic(input.terminator, edgeId, edge.from, input));
    }
  }
  return { diagnostics: sortOptIrDiagnostics(diagnostics) };
}

function missingEdgeDiagnostic(terminator: OptIrTerminator, edgeId: OptIrEdgeId): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_CFG_EDGE_MISSING");
  const stableDetail = `missing-edge:${edgeId}`;
  return {
    severity: "error",
    code,
    messageTemplate: "Terminator references a CFG edge that is not present in the edge table.",
    arguments: { edgeId },
    ownerKey: `terminator:${terminator.operationId}`,
    rootCauseKey: `edge:${edgeId}`,
    stableDetail,
    originId: terminator.originId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(terminator.originId),
      functionKey: "unknown",
      code,
      ownerKey: `terminator:${terminator.operationId}`,
      rootCauseKey: `edge:${edgeId}`,
      stableDetail,
    }),
  };
}

function ownerMismatchDiagnostic(
  terminator: OptIrTerminator,
  edgeId: OptIrEdgeId,
  actualOwner: OptIrBlockId,
  context: { readonly ownerBlockId?: OptIrBlockId; readonly functionId?: OptIrFunctionId },
): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const stableDetail = `terminator-edge-owner-mismatch:${edgeId}:${actualOwner}`;
  return {
    severity: "error",
    code,
    messageTemplate: "Terminator references a CFG edge owned by a different block.",
    arguments: {
      edgeId,
      expectedBlockId: Number(context.ownerBlockId),
      actualBlockId: Number(actualOwner),
    },
    ownerKey: `terminator:${terminator.operationId}`,
    rootCauseKey: `edge:${edgeId}:from:${actualOwner}`,
    stableDetail,
    originId: terminator.originId,
    functionId: context.functionId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(terminator.originId),
      functionKey: String(context.functionId ?? "unknown"),
      code,
      ownerKey: `terminator:${terminator.operationId}`,
      rootCauseKey: `edge:${edgeId}:from:${actualOwner}`,
      stableDetail,
    }),
  };
}
