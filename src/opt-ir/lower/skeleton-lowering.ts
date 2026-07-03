import { optIrConstructionIdAllocator, optIrCfgEdgeTable, type OptIrEdge } from "../cfg";
import { optIrConstantTable, optIrFunctionTable, optIrProgram, optIrRegionTable } from "../program";
import type { OptIrBlock } from "../cfg";
import type { OptIrFunction } from "../program";
import type { OptIrTerminator } from "../terminators";
import type { OptIrType } from "../types";
import type { OptIrOrigin } from "../provenance";
import type { MonoFunctionSignature } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { TargetId } from "../../semantic/ids";
import type { HirOriginId } from "../../hir/ids";
import type { ProofMirOriginId } from "../../proof-mir/ids";
import { optIrOperationId, optIrProgramId, type OptIrValueId } from "../ids";
import { optIrBlockArgumentBuilder } from "./block-argument-builder";
import { optIrProvenanceBuilder } from "./provenance-builder";
import type { OptIrSkeletonLoweringResult } from "./lowering-types";

export interface OptIrSkeletonForTestInput {
  readonly targetId: TargetId;
  readonly functions: readonly OptIrSkeletonFunctionForTest[];
}

export interface OptIrSkeletonOriginForTest {
  readonly source?: OptIrOrigin["source"];
  readonly hir?: { readonly originId?: HirOriginId };
  readonly proofMirOriginId?: ProofMirOriginId;
}

export interface OptIrSkeletonFunctionForTest {
  readonly functionInstanceId: MonoInstanceId;
  readonly signature: MonoFunctionSignature;
  readonly entryBlockKey?: string;
  readonly origin: OptIrSkeletonOriginForTest;
  readonly blocks: readonly OptIrSkeletonBlockForTest[];
}

export interface OptIrSkeletonBlockForTest {
  readonly blockKey: string;
  readonly origin: OptIrSkeletonOriginForTest;
  readonly merge?: "loopHeader" | "join";
  readonly parameters: readonly OptIrSkeletonParameterForTest[];
  readonly edges: readonly OptIrSkeletonEdgeForTest[];
  readonly terminator?: OptIrSkeletonTerminatorForTest;
}

export type OptIrSkeletonTerminatorForTest =
  | {
      readonly kind: "jump";
      readonly edgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "branch";
      readonly conditionValueKey: string;
      readonly trueEdgeKey: string;
      readonly falseEdgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "switch";
      readonly scrutineeValueKey: string;
      readonly cases: readonly OptIrSkeletonSwitchCaseForTest[];
      readonly defaultEdgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "return";
      readonly valueKeys: readonly string[];
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "unreachable";
      readonly origin: OptIrSkeletonOriginForTest;
    };

export interface OptIrSkeletonSwitchCaseForTest {
  readonly label: string;
  readonly edgeKey: string;
}

export interface OptIrSkeletonParameterForTest {
  readonly valueKey: string;
  readonly type: OptIrType;
  readonly role: "entry" | "branchArgument" | "loopCarried" | "exception" | "phi";
  readonly runtime: boolean;
  readonly proofOnlyReason?: string;
  readonly origin: OptIrSkeletonOriginForTest;
}

export interface OptIrSkeletonEdgeForTest {
  readonly edgeKey: string;
  readonly toBlockKey?: string;
  readonly kind: OptIrEdge["kind"];
  readonly argumentValueKeys: readonly string[];
  readonly origin: OptIrSkeletonOriginForTest;
}

export function lowerCheckedMirSkeletonForTest(
  input: OptIrSkeletonForTestInput,
): OptIrSkeletonLoweringResult {
  const diagnostics = validateSkeleton(input);
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }

  const allocator = optIrConstructionIdAllocator<string, string>({
    functionsInTraversalOrder: input.functions.map((function_) => function_.functionInstanceId),
    blocksInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        function_.blocks.map((block) => block.blockKey),
      ]),
    ),
    edgesInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        function_.blocks.flatMap((block) => block.edges.map((edge) => edge.edgeKey)),
      ]),
    ),
  });

  const provenance = optIrProvenanceBuilder();
  const blockArguments = optIrBlockArgumentBuilder();
  const loweredFunctions: OptIrFunction[] = [];

  for (const function_ of input.functions) {
    const blocks = lowerBlocks(function_, allocator, provenance, blockArguments);
    const edges = lowerEdges(function_, allocator, provenance, blockArguments);
    const blockIdByKey = blockIdsByKey(function_, allocator);
    const entryBlock =
      function_.entryBlockKey === undefined
        ? blocks[0]
        : blocks.find((block) => block.blockId === blockIdByKey.get(function_.entryBlockKey ?? ""));
    if (entryBlock === undefined) {
      return {
        kind: "error",
        diagnostics: [`function:${String(function_.functionInstanceId)}:missing-block`],
      };
    }
    loweredFunctions.push({
      functionId: allocator.functionIdFor(function_.functionInstanceId),
      monoInstanceId: function_.functionInstanceId,
      signature: function_.signature,
      blocks,
      edges: optIrCfgEdgeTable(edges),
      entryBlock: entryBlock.blockId,
      originId: provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `function:${String(function_.functionInstanceId)}`,
        source: function_.origin.source,
        hirOriginId: function_.origin.hir?.originId,
        proofMirOriginId: function_.origin.proofMirOriginId,
      }),
    });
  }

  const originEntries = provenance.entries();
  return {
    kind: "ok",
    program: optIrProgram({
      programId: optIrProgramId(0),
      targetId: input.targetId,
      functions: optIrFunctionTable(loweredFunctions),
      regions: optIrRegionTable([]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: originEntries.map((origin) => origin.originId) },
    }),
    origins: new Map(originEntries.map((origin) => [origin.originId, origin])),
    regions: [],
    operations: [],
    generatedFacts: [],
    valueIdsByKey: new Map(blockArguments.valueEntries()),
    executableValueIds: blockArguments.executableValueIds(),
    proofOnlyValueIds: blockArguments.proofOnlyValueIds(),
    valuesMarkedForErasure: blockArguments.valuesMarkedForErasure(),
  };
}

function lowerBlocks(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): readonly OptIrBlock[] {
  return function_.blocks.map((block) => ({
    blockId: allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
    parameters: block.parameters.map((parameter) =>
      blockArguments.parameterFor({
        valueKey: scopedValueKey(function_.functionInstanceId, parameter.valueKey),
        type: parameter.type,
        incomingRole: parameter.role,
        runtime: parameter.runtime,
        proofOnlyReason: parameter.proofOnlyReason,
        originId: provenance.originFor({
          functionInstanceId: function_.functionInstanceId,
          checkedMirNodeKey: `parameter:${block.blockKey}:${parameter.valueKey}`,
          source: parameter.origin.source,
          hirOriginId: parameter.origin.hir?.originId,
          proofMirOriginId: parameter.origin.proofMirOriginId,
        }),
      }),
    ),
    operations: [],
    ...(block.terminator === undefined
      ? {}
      : { terminator: lowerTerminator(function_, block, allocator, provenance, blockArguments) }),
    originId: provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `block:${block.blockKey}`,
      source: block.origin.source,
      hirOriginId: block.origin.hir?.originId,
      proofMirOriginId: block.origin.proofMirOriginId,
    }),
  }));
}

function lowerTerminator(
  function_: OptIrSkeletonFunctionForTest,
  block: OptIrSkeletonBlockForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): OptIrTerminator {
  const terminator = block.terminator;
  if (terminator === undefined) {
    throw new RangeError(`No OptIR skeleton terminator for block ${block.blockKey}.`);
  }
  const originId = provenance.originFor({
    functionInstanceId: function_.functionInstanceId,
    checkedMirNodeKey: `terminator:${block.blockKey}`,
    source: terminator.origin.source,
    hirOriginId: terminator.origin.hir?.originId,
    proofMirOriginId: terminator.origin.proofMirOriginId,
  });
  const operationId = terminatorOperationId(function_, block, allocator);
  switch (terminator.kind) {
    case "jump":
      return {
        kind: "jump",
        operationId,
        edge: allocator.edgeIdFor(function_.functionInstanceId, terminator.edgeKey),
        originId,
      };
    case "branch":
      return {
        kind: "branch",
        operationId,
        condition: requireValueId(
          blockArguments,
          scopedValueKey(function_.functionInstanceId, terminator.conditionValueKey),
        ),
        trueEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.trueEdgeKey),
        falseEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.falseEdgeKey),
        originId,
      };
    case "switch":
      return {
        kind: "switch",
        operationId,
        scrutinee: requireValueId(
          blockArguments,
          scopedValueKey(function_.functionInstanceId, terminator.scrutineeValueKey),
        ),
        cases: Object.freeze(
          terminator.cases.map((switchCase) =>
            Object.freeze({
              label: switchCase.label,
              edge: allocator.edgeIdFor(function_.functionInstanceId, switchCase.edgeKey),
            }),
          ),
        ),
        defaultEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.defaultEdgeKey),
        originId,
      };
    case "return":
      return {
        kind: "return",
        operationId,
        values: Object.freeze(
          terminator.valueKeys.map((valueKey) =>
            requireValueId(blockArguments, scopedValueKey(function_.functionInstanceId, valueKey)),
          ),
        ),
        originId,
      };
    case "unreachable":
      return { kind: "unreachable", operationId, originId };
  }
}

function terminatorOperationId(
  function_: OptIrSkeletonFunctionForTest,
  block: OptIrSkeletonBlockForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
) {
  const blockId = allocator.blockIdFor(function_.functionInstanceId, block.blockKey);
  return optIrOperationId(1_000_000_000 + Number(blockId));
}

function blockIdsByKey(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
): ReadonlyMap<string, OptIrBlock["blockId"]> {
  return new Map(
    function_.blocks.map((block) => [
      block.blockKey,
      allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
    ]),
  );
}

function lowerEdges(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): readonly OptIrEdge[] {
  return function_.blocks.flatMap((block) =>
    block.edges.map((edge, ordinal) => ({
      edgeId: allocator.edgeIdFor(function_.functionInstanceId, edge.edgeKey),
      from: allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
      ...(edge.toBlockKey === undefined
        ? {}
        : { toBlock: allocator.blockIdFor(function_.functionInstanceId, edge.toBlockKey) }),
      ordinal,
      kind: edge.kind,
      arguments: edge.argumentValueKeys.map((valueKey) =>
        requireValueId(blockArguments, scopedValueKey(function_.functionInstanceId, valueKey)),
      ),
      originId: provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `edge:${edge.edgeKey}`,
        source: edge.origin.source,
        hirOriginId: edge.origin.hir?.originId,
        proofMirOriginId: edge.origin.proofMirOriginId,
      }),
    })),
  );
}

function requireValueId(
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
  valueKey: string,
): OptIrValueId {
  const valueId = blockArguments.valueIdFor(valueKey);
  if (valueId === undefined) {
    throw new RangeError(`No OptIR value allocated for edge argument ${valueKey}.`);
  }
  return valueId;
}

function validateSkeleton(input: OptIrSkeletonForTestInput): string[] {
  const diagnostics: string[] = [];

  for (const function_ of input.functions) {
    if (function_.blocks.length === 0) {
      diagnostics.push(`function:${String(function_.functionInstanceId)}:missing-block`);
      continue;
    }

    const blocksByKey = new Map(function_.blocks.map((block) => [block.blockKey, block]));
    const edgeKeys = new Set(
      function_.blocks.flatMap((block) => block.edges.map((edge) => edge.edgeKey)),
    );
    const parametersByKey = new Map(
      function_.blocks.flatMap((block) =>
        block.parameters.map((parameter) => [parameter.valueKey, parameter] as const),
      ),
    );
    for (const block of function_.blocks) {
      for (const edge of block.edges) {
        for (const argumentKey of edge.argumentValueKeys) {
          const parameter = parametersByKey.get(argumentKey);
          if (parameter === undefined) {
            diagnostics.push(`edge:${edge.edgeKey}:unknown-argument:${argumentKey}`);
            continue;
          }
          if (!parameter.runtime) {
            diagnostics.push(`edge:${edge.edgeKey}:proof-only-argument:${argumentKey}`);
          }
        }
        if (edge.toBlockKey === undefined) {
          continue;
        }
        const successor = blocksByKey.get(edge.toBlockKey);
        if (successor === undefined) {
          diagnostics.push(`edge:${edge.edgeKey}:unknown-successor:${edge.toBlockKey}`);
          continue;
        }
        if (edge.argumentValueKeys.length !== successor.parameters.length) {
          diagnostics.push(
            `edge:${edge.edgeKey}:argument-count:${edge.argumentValueKeys.length}:parameter-count:${successor.parameters.length}`,
          );
        }
      }
      validateSkeletonTerminator(block, edgeKeys, parametersByKey, diagnostics);
    }
  }

  return diagnostics;
}

function validateSkeletonTerminator(
  block: OptIrSkeletonBlockForTest,
  edgeKeys: ReadonlySet<string>,
  parametersByKey: ReadonlyMap<string, OptIrSkeletonParameterForTest>,
  diagnostics: string[],
): void {
  const terminator = block.terminator;
  if (terminator === undefined) {
    return;
  }
  for (const edgeKey of terminatorEdgeKeys(terminator)) {
    if (!edgeKeys.has(edgeKey)) {
      diagnostics.push(`terminator:${block.blockKey}:unknown-edge:${edgeKey}`);
    }
  }
  for (const valueKey of terminatorValueKeys(terminator)) {
    const parameter = parametersByKey.get(valueKey);
    if (parameter === undefined) {
      diagnostics.push(`terminator:${block.blockKey}:unknown-value:${valueKey}`);
      continue;
    }
    if (!parameter.runtime) {
      diagnostics.push(`terminator:${block.blockKey}:proof-only-value:${valueKey}`);
    }
  }
}

function terminatorEdgeKeys(terminator: OptIrSkeletonTerminatorForTest): readonly string[] {
  switch (terminator.kind) {
    case "jump":
      return [terminator.edgeKey];
    case "branch":
      return [terminator.trueEdgeKey, terminator.falseEdgeKey];
    case "switch":
      return [
        ...terminator.cases.map((switchCase) => switchCase.edgeKey),
        terminator.defaultEdgeKey,
      ];
    case "return":
    case "unreachable":
      return [];
  }
}

function terminatorValueKeys(terminator: OptIrSkeletonTerminatorForTest): readonly string[] {
  switch (terminator.kind) {
    case "branch":
      return [terminator.conditionValueKey];
    case "switch":
      return [terminator.scrutineeValueKey];
    case "return":
      return terminator.valueKeys;
    case "jump":
    case "unreachable":
      return [];
  }
}

function scopedValueKey(functionInstanceId: MonoInstanceId, valueKey: string): string {
  return `${String(functionInstanceId)}/${valueKey}`;
}
