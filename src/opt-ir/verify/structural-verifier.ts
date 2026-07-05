import type { OptIrCfgEdit } from "../cfg-edits";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type { OptIrBlock, OptIrEdge } from "../cfg";
import type {
  OptIrBlockId,
  OptIrFunctionId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrValueId,
} from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction, OptIrProgram } from "../program";
import { verifyOptIrTerminatorEdges } from "../terminators";
import { verifyOptIrCfgEdits, type OptIrCfgSnapshotReferenceSet } from "./cfg-edit-verifier";
import { verifyOptIrConstantPool } from "./constant-pool-verifier";
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
          ...verifyOptIrTerminatorEdges({
            edges: func.edges,
            terminator: block.terminator,
            ownerBlockId: block.blockId,
            functionId: func.functionId,
          }).diagnostics,
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
    diagnostics.push(...verifyEnumPayloadLoads({ func, operations: input.operations, context }));
  }

  const programContext: OptIrVerifierContext = {
    options,
    originId: input.program.provenance.originIds[0],
  };
  diagnostics.push(
    ...verifyOptIrConstantPool({
      program: input.program,
      context: programContext,
    }),
  );
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
  diagnostics.push(
    ...verifyNoUnloweredAggregates({
      operations: referencedOperations(input.operations, operationIdsReferencedByBlocks),
    }),
  );

  const sorted = sortOptIrDiagnostics(diagnostics);
  return sorted.length === 0
    ? { kind: "ok", diagnostics: [] }
    : { kind: "error", diagnostics: sorted };
}

function verifyEnumPayloadLoads(input: {
  readonly func: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly context: OptIrVerifierContext;
}): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const operationByResult = operationResultIndex(input.operations);
  const incomingEdges = incomingEdgesByBlock(input.func.edges.entries());
  const blocksById = new Map(input.func.blocks.map((block) => [block.blockId, block]));
  const guardsByBlock = enumCaseGuardsByBlock({
    func: input.func,
    incomingEdges,
    blocksById,
    operationByResult,
  });

  for (const block of input.func.blocks) {
    for (const operationId of block.operations) {
      const operation = input.operations.get(operationId);
      if (operation?.kind !== "enumPayloadLoad") continue;
      const incoming = incomingEdges.get(block.blockId) ?? [];
      const guardKey = enumPayloadGuardKey({
        enumValue: operation.enumValue,
        enumTypeKey: operation.enumCase.enumTypeKey,
        tagValue: operation.enumCase.tagValue,
      });
      if (incoming.length === 0 || !(guardsByBlock.get(block.blockId) ?? new Set()).has(guardKey)) {
        diagnostics.push(enumPayloadLoadDiagnostic(operation, input.context, incoming[0]));
      }
    }
  }

  return diagnostics;
}

function enumCaseGuardsByBlock(input: {
  readonly func: OptIrFunction;
  readonly incomingEdges: ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]>;
  readonly blocksById: ReadonlyMap<OptIrBlockId, OptIrBlock>;
  readonly operationByResult: ReadonlyMap<OptIrValueId, OptIrOperation>;
}): ReadonlyMap<OptIrBlockId, ReadonlySet<string>> {
  const guardsByBlock = new Map<OptIrBlockId, Set<string>>();
  for (const block of input.func.blocks) guardsByBlock.set(block.blockId, new Set());

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of input.func.blocks) {
      const nextGuards =
        block.blockId === input.func.entryBlock
          ? new Set<string>()
          : incomingEnumCaseGuards({
              blockId: block.blockId,
              incomingEdges: input.incomingEdges,
              guardsByBlock,
              blocksById: input.blocksById,
              operationByResult: input.operationByResult,
            });
      const current = guardsByBlock.get(block.blockId) ?? new Set();
      if (!setEquals(current, nextGuards)) {
        guardsByBlock.set(block.blockId, nextGuards);
        changed = true;
      }
    }
  }

  return guardsByBlock;
}

function incomingEnumCaseGuards(input: {
  readonly blockId: OptIrBlockId;
  readonly incomingEdges: ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]>;
  readonly guardsByBlock: ReadonlyMap<OptIrBlockId, ReadonlySet<string>>;
  readonly blocksById: ReadonlyMap<OptIrBlockId, OptIrBlock>;
  readonly operationByResult: ReadonlyMap<OptIrValueId, OptIrOperation>;
}): Set<string> {
  const incoming = input.incomingEdges.get(input.blockId) ?? [];
  let guaranteed: Set<string> | undefined;
  for (const edge of incoming) {
    const edgeGuards = new Set(input.guardsByBlock.get(edge.from) ?? []);
    const establishedGuard = enumCaseGuardEstablishedByEdge({
      edge,
      blocksById: input.blocksById,
      operationByResult: input.operationByResult,
    });
    if (establishedGuard !== undefined) edgeGuards.add(establishedGuard);
    guaranteed = guaranteed === undefined ? edgeGuards : intersectSets(guaranteed, edgeGuards);
  }
  return guaranteed ?? new Set();
}

function enumCaseGuardEstablishedByEdge(input: {
  readonly edge: OptIrEdge;
  readonly blocksById: ReadonlyMap<OptIrBlockId, OptIrBlock>;
  readonly operationByResult: ReadonlyMap<OptIrValueId, OptIrOperation>;
}): string | undefined {
  const predecessor = input.blocksById.get(input.edge.from);
  const terminator = predecessor?.terminator;
  if (terminator?.kind !== "switch") return undefined;
  const matchingCase = terminator.cases.find((switchCase) => switchCase.edge === input.edge.edgeId);
  if (matchingCase === undefined) return undefined;
  const tagLoad = input.operationByResult.get(terminator.scrutinee);
  if (tagLoad?.kind !== "enumTagLoad") return undefined;
  return enumPayloadGuardKey({
    enumValue: tagLoad.enumValue,
    enumTypeKey: tagLoad.enumCase.enumTypeKey,
    tagValue: matchingCase.label,
  });
}

function enumPayloadGuardKey(input: {
  readonly enumValue: OptIrValueId;
  readonly enumTypeKey: string;
  readonly tagValue: string;
}): string {
  return `${String(input.enumValue)}:${input.enumTypeKey}:${input.tagValue}`;
}

function intersectSets(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const result = new Set<string>();
  for (const value of left) {
    if (right.has(value)) result.add(value);
  }
  return result;
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function operationResultIndex(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReadonlyMap<OptIrValueId, OptIrOperation> {
  const byResult = new Map<OptIrValueId, OptIrOperation>();
  for (const operation of operations.values()) {
    for (const resultId of operation.resultIds) byResult.set(resultId, operation);
  }
  return byResult;
}

function incomingEdgesByBlock(
  edges: readonly OptIrEdge[],
): ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]> {
  const byBlock = new Map<OptIrBlockId, OptIrEdge[]>();
  for (const edge of edges) {
    if (edge.toBlock === undefined) continue;
    const existing = byBlock.get(edge.toBlock) ?? [];
    existing.push(edge);
    byBlock.set(edge.toBlock, existing);
  }
  return byBlock;
}

function enumPayloadLoadDiagnostic(
  operation: Extract<OptIrOperation, { readonly kind: "enumPayloadLoad" }>,
  context: OptIrVerifierContext,
  nearestEdge: OptIrEdge | undefined,
): OptIrDiagnostic {
  return makeOptIrVerifierDiagnostic({
    code: "OPT_IR_INPUT_CONTRACT_INVALID",
    messageTemplate:
      "Enum payload load is not dominated by a compatible tag-discriminating switch edge.",
    ownerKey: `operation:${operation.operationId}`,
    rootCauseKey: `enum-payload:${operation.enumCase.enumTypeKey}:${operation.enumCase.caseName}`,
    stableDetail:
      `enum-payload-load-not-dominated:operation:${operation.operationId}` +
      `:enum:${operation.enumCase.enumTypeKey}` +
      `:case:${operation.enumCase.caseName}` +
      `:field:${operation.enumCase.payloadFieldName ?? "payload"}` +
      `:nearest-edge:${nearestEdge?.edgeId ?? "none"}`,
    originId: operation.originId,
    functionId: context.functionId,
  });
}

function verifyNoUnloweredAggregates(input: {
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}): readonly OptIrDiagnostic[] {
  return [...input.operations.values()].flatMap((operation) => {
    if (
      operation.kind !== "aggregateConstruct" &&
      operation.kind !== "aggregateExtract" &&
      operation.kind !== "aggregateInsert"
    ) {
      return [];
    }
    return [
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_UNLOWERED_AGGREGATE",
        messageTemplate:
          "Aggregate operation remains after final OptIR verification and must be lowered before backend materialization.",
        ownerKey: `operation:${operation.operationId}`,
        rootCauseKey: `aggregate:${operation.kind}`,
        stableDetail: `unlowered-aggregate:${operation.kind}:${operation.operationId}`,
        originId: operation.originId,
      }),
    ];
  });
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
