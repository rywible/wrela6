import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId, ProofMirOriginId } from "../../proof-mir/ids";
import type { ProofCheckOperation } from "./transition-api";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import { proofCheckTransitionId } from "../ids";
import {
  proofCheckBlockKey,
  proofCheckPathFrameKey,
  type ProofCheckTransitionWitness,
} from "./counterexample-builder";
import {
  dispatchProofCheckOperation,
  operationForProofMirProgramPoint,
  type ProofCheckOperationTransferRegistry,
} from "./operation-dispatch";
import type { ProofCheckResourceLimitHooks } from "./resource-limits";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckState } from "./state";
import {
  applyProofCheckTransitionResult,
  createProofCheckPacketStage,
  stageTransferPacketEntriesForBlock,
  proofCheckProgramPointKey,
  type ProofCheckProgramPoint,
  type ProofCheckTransition,
} from "./transition-api";
import type {
  ProofCheckFunctionRegistryArtifactsMutable,
  ProofCheckRegistryAccumulator,
} from "./registry/registry-effects";
import {
  applyTransitionRegistryEffects,
  blockIdForProgramPoint,
  blockLabelFor,
  originKeyFor,
} from "./graph-worklist-helpers";

function originIdForProofCheckOperation(
  operation: ProofCheckOperation,
  functionGraph: ProofMirFunction,
): ProofMirOriginId {
  switch (operation.kind) {
    case "functionEntry": {
      const entryBlock = functionGraph.blocks.get(functionGraph.entryBlockId);
      return entryBlock?.origin ?? (0 as ProofMirOriginId);
    }
    case "statement":
      return operation.statement.origin;
    case "terminator":
      return operation.terminator.origin;
    case "edge":
      return operation.edge.origin;
    case "join":
    case "loopHeader": {
      const block = functionGraph.blocks.get(operation.blockId);
      return block?.origin ?? (0 as ProofMirOriginId);
    }
    case "call":
      return operation.call.origin;
    case "exit":
      return operation.exit.origin;
    case "terminalClosure":
      return 0 as ProofMirOriginId;
    default: {
      const unreachable: never = operation;
      return unreachable;
    }
  }
}

export function runTransition(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockLabels?: ReadonlyMap<ProofMirBlockId, string>;
  readonly registry: ProofCheckOperationTransferRegistry;
  readonly resourceLimitHooks: ProofCheckResourceLimitHooks;
  readonly location: ProofCheckProgramPoint;
  readonly inputState: ProofCheckState;
  readonly witnesses: Map<string, ProofCheckTransitionWitness>;
  readonly predecessorPathFrameKey?: string;
  readonly staged: ReturnType<typeof createProofCheckPacketStage>;
  readonly allocateTransitionId: () => ReturnType<typeof proofCheckTransitionId>;
  readonly registryAccumulator?: ProofCheckRegistryAccumulator;
  readonly registryArtifacts?: ProofCheckFunctionRegistryArtifactsMutable;
}): {
  readonly kind: "ok" | "error";
  readonly outputState: ProofCheckState;
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly pathFrameKey: string;
  readonly failedComponentKeys: readonly string[];
} {
  const limitResult = input.resourceLimitHooks.beforeRecordTransition?.({
    functionInstanceId: input.functionInstanceId,
    location: input.location,
    state: input.inputState,
  });
  if (limitResult?.kind === "error") {
    return {
      kind: "error",
      outputState: input.inputState,
      diagnostics: limitResult.diagnostics,
      pathFrameKey: proofCheckPathFrameKey({
        functionInstanceId: input.functionInstanceId,
        programPointKey: proofCheckProgramPointKey(input.location),
        stateKey: proofCheckStateKey(input.inputState),
      }),
      failedComponentKeys: [],
    };
  }

  const operationResult = operationForProofMirProgramPoint({
    mir: input.mir,
    location: input.location,
  });
  if (operationResult.kind === "error") {
    return {
      kind: "error",
      outputState: input.inputState,
      diagnostics: operationResult.diagnostics,
      pathFrameKey: proofCheckPathFrameKey({
        functionInstanceId: input.functionInstanceId,
        programPointKey: proofCheckProgramPointKey(input.location),
        stateKey: proofCheckStateKey(input.inputState),
      }),
      failedComponentKeys: [],
    };
  }

  const transition: ProofCheckTransition = {
    transitionId: input.allocateTransitionId(),
    functionInstanceId: input.functionInstanceId,
    location: input.location,
    inputState: input.inputState,
    operation: operationResult.operation,
  };

  const transfer = dispatchProofCheckOperation({
    registry: input.registry,
    transition,
  });

  const application = applyProofCheckTransitionResult({
    state: input.inputState,
    staged: input.staged,
    transition,
    transfer,
  });

  if (application.kind === "ok" && transfer.kind === "ok") {
    applyTransitionRegistryEffects({
      registryAccumulator: input.registryAccumulator,
      registryArtifacts: input.registryArtifacts,
      functionInstanceId: input.functionInstanceId,
      transfer,
    });
  }

  if (
    input.location.kind === "functionEntry" &&
    transfer.kind === "ok" &&
    transfer.packetEntries.length > 0
  ) {
    stageTransferPacketEntriesForBlock({
      stage: input.staged,
      transition,
      inputState: input.inputState,
      transfer,
      commitBlockId: input.functionGraph.entryBlockId,
    });
  }
  const pathFrameKey = proofCheckPathFrameKey({
    functionInstanceId: input.functionInstanceId,
    programPointKey: proofCheckProgramPointKey(input.location),
    stateKey: proofCheckStateKey(input.inputState),
  });

  const blockId = blockIdForProgramPoint(input.location, input.functionGraph);

  const witness: ProofCheckTransitionWitness = {
    pathFrameKey,
    functionInstanceId: input.functionInstanceId,
    ...(blockId !== undefined ? { blockId } : {}),
    blockKey:
      blockId !== undefined
        ? proofCheckBlockKey({
            functionInstanceId: input.functionInstanceId,
            blockId,
            blockLabel: blockLabelFor(input.blockLabels, blockId),
          })
        : "entry",
    location: input.location,
    originKey: originKeyFor(
      originIdForProofCheckOperation(operationResult.operation, input.functionGraph),
    ),
    inputState: input.inputState,
    outputState: application.state,
    failedComponentKeys: [],
    ...(input.predecessorPathFrameKey !== undefined
      ? { predecessorPathFrameKey: input.predecessorPathFrameKey }
      : {}),
  };
  input.witnesses.set(pathFrameKey, witness);

  if (application.kind === "error") {
    return {
      kind: "error",
      outputState: application.state,
      diagnostics: application.diagnostics,
      pathFrameKey,
      failedComponentKeys: [],
    };
  }

  return {
    kind: "ok",
    outputState: application.state,
    diagnostics: application.diagnostics,
    pathFrameKey,
    failedComponentKeys: [],
  };
}
