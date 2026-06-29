import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import type { TargetId } from "../../../src/semantic/ids";
import { targetId } from "../../../src/semantic/ids";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
  type OptIrEdgeId,
  type OptIrOriginId,
} from "../../../src/opt-ir/ids";
import type { OptIrConstant } from "../../../src/opt-ir/constants";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import type { OptIrEdge, OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import type { OptIrProgram, OptIrFunction } from "../../../src/opt-ir/program";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  optIrConstantTable,
} from "../../../src/opt-ir/program";
import type { OptIrTerminator } from "../../../src/opt-ir/terminators";
import { optIrBranchTerminator, verifyOptIrTerminatorEdges } from "../../../src/opt-ir/terminators";

export function edgeForTest(input: Partial<OptIrEdge> = {}): OptIrEdge {
  return {
    edgeId: input.edgeId ?? optIrEdgeId(1),
    from: input.from ?? optIrBlockId(1),
    toBlock: input.toBlock ?? optIrBlockId(2),
    ordinal: input.ordinal ?? 0,
    kind: input.kind ?? "normal",
    arguments: input.arguments ?? [],
    ...(input.condition === undefined ? {} : { condition: input.condition }),
    ...(input.switchCase === undefined ? {} : { switchCase: input.switchCase }),
    originId: input.originId ?? optIrOriginId(1),
  };
}

export function branchTerminatorForTest(input: {
  readonly trueEdge: OptIrEdgeId;
  readonly falseEdge: OptIrEdgeId;
  readonly condition?: OptIrTerminator & { readonly kind: "branch" };
}): OptIrTerminator {
  return optIrBranchTerminator({
    operationId: 1 as never,
    condition: optIrValueId(1),
    trueEdge: input.trueEdge,
    falseEdge: input.falseEdge,
    originId: optIrOriginId(1),
  });
}

export function verifyCfgEdgesForTest(input: {
  readonly edges: readonly OptIrEdge[];
  readonly terminator: OptIrTerminator;
}) {
  return verifyOptIrTerminatorEdges({
    edges: optIrCfgEdgeTable(input.edges),
    terminator: input.terminator,
  });
}

export function optIrBlockForTest(input: Partial<OptIrBlock> = {}): OptIrBlock {
  return {
    blockId: input.blockId ?? optIrBlockId(1),
    parameters: input.parameters ?? [
      optIrBlockParameter({
        valueId: optIrValueId(1),
        type: optIrUnsignedIntegerType(32),
        incomingRole: "entry",
        originId: optIrOriginId(1),
      }),
    ],
    operations: input.operations ?? [],
    terminator: input.terminator,
    originId: input.originId ?? optIrOriginId(1),
  };
}

export function optIrFunctionForTest(input: Partial<OptIrFunction> = {}): OptIrFunction {
  const entryBlock = optIrBlockForTest({ blockId: optIrBlockId(1) });
  return {
    functionId: input.functionId ?? optIrFunctionId(1),
    monoInstanceId: input.monoInstanceId ?? monoInstanceId("test::function"),
    signature: input.signature ?? ({} as MonoFunctionSignature),
    blocks: input.blocks ?? [entryBlock],
    edges: input.edges ?? optIrCfgEdgeTable([]),
    entryBlock: input.entryBlock ?? entryBlock.blockId,
    ...(input.externalRoot === undefined ? {} : { externalRoot: input.externalRoot }),
    summary: input.summary ?? undefined,
    originId: input.originId ?? optIrOriginId(1),
  };
}

export function optIrProgramForTest(input: Partial<OptIrProgram> = {}): OptIrProgram {
  const testFunction = optIrFunctionForTest();
  const constant: OptIrConstant = optIrIntegerConstant({
    constantId: optIrConstantId(1),
    type: optIrUnsignedIntegerType(8),
    normalizedValue: 7n,
  });

  return optIrProgram({
    programId: input.programId ?? optIrProgramId(1),
    targetId: input.targetId ?? targetId("test-target"),
    functions: input.functions ?? optIrFunctionTable([testFunction]),
    regions:
      input.regions ??
      optIrRegionTable([{ regionId: optIrRegionId(1), originId: optIrOriginId(1) }]),
    constants: input.constants ?? optIrConstantTable([constant]),
    callGraph: input.callGraph ?? { calls: [] },
    provenance: input.provenance ?? { originIds: [optIrOriginId(1)] },
  });
}

export function targetIdForTest(value = "test-target"): TargetId {
  return targetId(value);
}

export function originIdForTest(value = 1): OptIrOriginId {
  return optIrOriginId(value);
}
