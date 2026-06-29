import type { OptIrCfgEdit } from "../cfg-edits";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type { OptIrBlockId, OptIrFunctionId, OptIrOperationId, OptIrOriginId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import { verifyOptIrTerminatorEdges } from "../terminators";
import { verifyOptIrCfgEdits, type OptIrCfgSnapshotReferenceSet } from "./cfg-edit-verifier";
import { verifyOptIrOperationMetadata } from "./operation-metadata-verifier";
import { verifyOptIrOperationSchema } from "./operation-schema-verifier";
import { verifyOptIrRegions } from "./region-verifier";
import { verifyOptIrSsa } from "./ssa-verifier";

export interface VerifyOptIrProgramOptions {
  readonly checkDominance?: boolean;
  readonly recomputeOperationMetadata?: boolean;
}

export interface VerifyOptIrProgramInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly cfgEdits?: readonly OptIrCfgEdit[];
  readonly oldCfg?: OptIrCfgSnapshotReferenceSet;
  readonly newCfg?: OptIrCfgSnapshotReferenceSet;
  readonly options?: VerifyOptIrProgramOptions;
}

export interface OptIrVerifierContext {
  readonly functionId?: OptIrFunctionId;
  readonly originId?: OptIrOriginId;
  readonly options: VerifyOptIrProgramOptions;
}

export type VerifyOptIrProgramResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly [] }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export function verifyOptIrProgram(input: VerifyOptIrProgramInput): VerifyOptIrProgramResult {
  const options = input.options ?? {};
  const diagnostics: OptIrDiagnostic[] = [];
  const operationIdsReferencedByBlocks = new Set<OptIrOperationId>();

  for (const func of input.program.functions.entries()) {
    const context: OptIrVerifierContext = {
      functionId: func.functionId,
      originId: func.originId,
      options,
    };
    const blockIds = new Set(func.blocks.map((block) => block.blockId));
    if (!blockIds.has(func.entryBlock)) {
      diagnostics.push(
        makeOptIrVerifierDiagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          messageTemplate: "Function entry block is missing from the block list.",
          ownerKey: `function:${func.functionId}`,
          rootCauseKey: `block:${func.entryBlock}`,
          stableDetail: `missing-entry-block:${func.entryBlock}`,
          originId: func.originId,
          functionId: func.functionId,
        }),
      );
    }

    for (const block of func.blocks) {
      for (const operationId of block.operations) {
        operationIdsReferencedByBlocks.add(operationId);
        const operation = input.operations.get(operationId);
        if (operation !== undefined) {
          diagnostics.push(...verifyOptIrOperationSchema({ operation, context }));
          if (options.recomputeOperationMetadata !== false) {
            diagnostics.push(...verifyOptIrOperationMetadata({ operation, context }));
          }
        }
      }
      if (block.terminator !== undefined) {
        diagnostics.push(
          ...verifyOptIrTerminatorEdges({ edges: func.edges, terminator: block.terminator })
            .diagnostics,
        );
      }
    }

    for (const edge of func.edges.entries()) {
      if (!blockIds.has(edge.from)) {
        diagnostics.push(
          missingBlockDiagnostic(context, `edge:${edge.edgeId}:from`, edge.from, edge.originId),
        );
      }
      if (edge.toBlock !== undefined && !blockIds.has(edge.toBlock)) {
        diagnostics.push(
          missingBlockDiagnostic(context, `edge:${edge.edgeId}:to`, edge.toBlock, edge.originId),
        );
      }
    }

    const ssaResult = verifyOptIrSsa({ func, operations: input.operations, context });
    diagnostics.push(...ssaResult.diagnostics);
  }

  const programContext: OptIrVerifierContext = {
    options,
    originId: input.program.provenance.originIds[0],
  };
  diagnostics.push(
    ...verifyOptIrRegions({
      program: input.program,
      operations: referencedOperations(input.operations, operationIdsReferencedByBlocks),
      context: programContext,
    }),
  );
  diagnostics.push(
    ...verifyOptIrCfgEdits({
      cfgEdits: input.cfgEdits ?? [],
      oldCfg: input.oldCfg,
      newCfg: input.newCfg,
      operations: input.operations,
      context: programContext,
    }),
  );

  const sorted = sortOptIrDiagnostics(diagnostics);
  return sorted.length === 0
    ? { kind: "ok", diagnostics: [] }
    : { kind: "error", diagnostics: sorted };
}

export function makeOptIrVerifierDiagnostic(input: {
  readonly code: Parameters<typeof optIrDiagnosticCode>[0];
  readonly messageTemplate: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly originId?: OptIrOriginId;
  readonly functionId?: OptIrFunctionId;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode(input.code);
  return {
    severity: "error",
    code,
    messageTemplate: input.messageTemplate,
    arguments: {},
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    originId: input.originId,
    functionId: input.functionId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(input.originId ?? ""),
      functionKey: String(input.functionId ?? ""),
      code,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}

function missingBlockDiagnostic(
  context: OptIrVerifierContext,
  ownerKey: string,
  blockId: OptIrBlockId,
  originId: OptIrOriginId,
): OptIrDiagnostic {
  return makeOptIrVerifierDiagnostic({
    code: "OPT_IR_INPUT_CONTRACT_INVALID",
    messageTemplate: "CFG edge references a block that is missing from the function block list.",
    ownerKey,
    rootCauseKey: `block:${blockId}`,
    stableDetail: `missing-block:${blockId}`,
    originId,
    functionId: context.functionId,
  });
}

function referencedOperations(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  operationIds: ReadonlySet<OptIrOperationId>,
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(
    [...operationIds]
      .map((operationId) => [operationId, operations.get(operationId)] as const)
      .filter(
        (entry): entry is readonly [OptIrOperationId, OptIrOperation] => entry[1] !== undefined,
      ),
  );
}
