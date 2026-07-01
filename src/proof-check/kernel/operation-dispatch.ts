import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type {
  ProofMirBlock,
  ProofMirFunction,
  ProofMirStatement,
} from "../../proof-mir/model/graph";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  proofCheckProgramPointKey,
  type ProofCheckOperation,
  type ProofCheckOperationKind,
  type ProofCheckProgramPoint,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "./transition-api";

type ProofCheckOperationKindLiteral = ProofCheckOperation["kind"];

export interface ProofCheckOperationHandlerInput<
  OperationKind extends ProofCheckOperationKindLiteral,
> {
  readonly transition: ProofCheckTransition;
  readonly operation: Extract<ProofCheckOperation, { readonly kind: OperationKind }>;
}

export type ProofCheckOperationHandler<OperationKind extends ProofCheckOperationKindLiteral> = (
  input: ProofCheckOperationHandlerInput<OperationKind>,
) => ProofCheckTransitionResult;

export interface ProofCheckOperationTransferRegistry {
  readonly functionEntry: ProofCheckOperationHandler<"functionEntry">;
  readonly statement: ProofCheckOperationHandler<"statement">;
  readonly terminator: ProofCheckOperationHandler<"terminator">;
  readonly edge: ProofCheckOperationHandler<"edge">;
  readonly call: ProofCheckOperationHandler<"call">;
  readonly join: ProofCheckOperationHandler<"join">;
  readonly loopHeader: ProofCheckOperationHandler<"loopHeader">;
  readonly exit: ProofCheckOperationHandler<"exit">;
  readonly terminalClosure: ProofCheckOperationHandler<"terminalClosure">;
}

export type ProofCheckOperationForProgramPointResult =
  | { readonly kind: "ok"; readonly operation: ProofCheckOperation }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

type ResolveProofMirBlockResult =
  | { readonly kind: "ok"; readonly block: ProofMirBlock }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function proofCheckOperationKindOwnerKey(kind: ProofCheckOperationKind): string {
  return `operation:${kind}`;
}

export function proofCheckOperationKey(
  operation: ProofCheckOperation,
  location: ProofCheckProgramPoint,
): string {
  return proofCheckProgramPointKey(location);
}

function inputContractInvalidDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.input-contract-invalid",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
    ...(input.functionInstanceId !== undefined
      ? { functionInstanceId: input.functionInstanceId }
      : {}),
  });
}

function resolveProofMirFunction(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
): ProofMirFunction | undefined {
  return mir.functions.get(functionInstanceId);
}

function findProofMirStatement(
  block: ProofMirBlock,
  statementId: ProofMirStatement["statementId"],
): ProofMirStatement | undefined {
  return block.statements.find((statement) => statement.statementId === statementId);
}

function missingMirNodeDiagnostic(input: {
  readonly location: ProofCheckProgramPoint;
  readonly stableDetail: string;
}): ProofCheckDiagnostic {
  return inputContractInvalidDiagnostic({
    ownerKey: proofCheckProgramPointKey(input.location),
    stableDetail: input.stableDetail,
    functionInstanceId:
      "functionInstanceId" in input.location ? input.location.functionInstanceId : undefined,
  });
}

function resolveBlock(input: {
  readonly functionGraph: ProofMirFunction;
  readonly location: ProofCheckProgramPoint;
  readonly blockId: ProofMirBlockId;
}): ResolveProofMirBlockResult {
  const block = input.functionGraph.blocks.get(input.blockId);
  if (block === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingMirNodeDiagnostic({
          location: input.location,
          stableDetail: `missing-block:${String(input.blockId)}`,
        }),
      ]),
    };
  }
  return { kind: "ok", block };
}

function missingFunctionResult(
  location: ProofCheckProgramPoint,
  functionInstanceId: MonoInstanceId,
): ProofCheckOperationForProgramPointResult {
  return {
    kind: "error",
    diagnostics: sortProofCheckDiagnostics([
      missingMirNodeDiagnostic({
        location,
        stableDetail: `missing-function:${String(functionInstanceId)}`,
      }),
    ]),
  };
}

export function operationForProofMirProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: ProofCheckProgramPoint;
}): ProofCheckOperationForProgramPointResult {
  const { mir, location } = input;

  switch (location.kind) {
    case "functionEntry":
      return {
        kind: "ok",
        operation: {
          kind: "functionEntry",
          functionInstanceId: location.functionInstanceId,
        },
      };
    case "join":
      return operationForBlockProgramPoint({
        mir,
        location,
        blockId: location.blockId,
        operationKind: "join",
      });
    case "loopHeader":
      return operationForBlockProgramPoint({
        mir,
        location,
        blockId: location.blockId,
        operationKind: "loopHeader",
      });
    case "statement":
      return operationForStatementProgramPoint({ mir, location });
    case "terminator":
      return operationForTerminatorProgramPoint({ mir, location });
    case "edge":
      return operationForEdgeProgramPoint({ mir, location });
    case "call":
      return operationForCallProgramPoint({ mir, location });
    case "exit":
      return operationForExitProgramPoint({ mir, location });
    case "terminalClosure":
      return {
        kind: "ok",
        operation: {
          kind: "terminalClosure",
          terminalKey: location.terminalKey,
        },
      };
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function operationForBlockProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "join" | "loopHeader" }>;
  readonly blockId: ProofMirBlockId;
  readonly operationKind: "join" | "loopHeader";
}): ProofCheckOperationForProgramPointResult {
  const functionGraph = resolveProofMirFunction(input.mir, input.location.functionInstanceId);
  if (functionGraph === undefined) {
    return missingFunctionResult(input.location, input.location.functionInstanceId);
  }

  const blockResult = resolveBlock({
    functionGraph,
    location: input.location,
    blockId: input.blockId,
  });
  if (blockResult.kind === "error") {
    return blockResult;
  }

  if (input.operationKind === "join") {
    return {
      kind: "ok",
      operation: {
        kind: "join",
        blockId: input.blockId,
      },
    };
  }

  return {
    kind: "ok",
    operation: {
      kind: "loopHeader",
      blockId: input.blockId,
    },
  };
}

function operationForStatementProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "statement" }>;
}): ProofCheckOperationForProgramPointResult {
  const functionGraph = resolveProofMirFunction(input.mir, input.location.functionInstanceId);
  if (functionGraph === undefined) {
    return missingFunctionResult(input.location, input.location.functionInstanceId);
  }

  const blockResult = resolveBlock({
    functionGraph,
    location: input.location,
    blockId: input.location.blockId,
  });
  if (blockResult.kind === "error") {
    return blockResult;
  }

  const statement = findProofMirStatement(blockResult.block, input.location.statementId);
  if (statement === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingMirNodeDiagnostic({
          location: input.location,
          stableDetail: `missing-statement:${String(input.location.statementId)}`,
        }),
      ]),
    };
  }

  return {
    kind: "ok",
    operation: {
      kind: "statement",
      statement,
    },
  };
}

function operationForTerminatorProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "terminator" }>;
}): ProofCheckOperationForProgramPointResult {
  const functionGraph = resolveProofMirFunction(input.mir, input.location.functionInstanceId);
  if (functionGraph === undefined) {
    return missingFunctionResult(input.location, input.location.functionInstanceId);
  }

  const blockResult = resolveBlock({
    functionGraph,
    location: input.location,
    blockId: input.location.blockId,
  });
  if (blockResult.kind === "error") {
    return blockResult;
  }

  const terminator = blockResult.block.terminator;
  if (terminator.terminatorId !== input.location.terminatorId) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingMirNodeDiagnostic({
          location: input.location,
          stableDetail: `missing-terminator:${String(input.location.terminatorId)}`,
        }),
      ]),
    };
  }

  return {
    kind: "ok",
    operation: {
      kind: "terminator",
      terminator,
    },
  };
}

function operationForEdgeProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "edge" }>;
}): ProofCheckOperationForProgramPointResult {
  const functionGraph = resolveProofMirFunction(input.mir, input.location.functionInstanceId);
  if (functionGraph === undefined) {
    return missingFunctionResult(input.location, input.location.functionInstanceId);
  }

  const edge = functionGraph.edges.get(input.location.edgeId);
  if (edge === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingMirNodeDiagnostic({
          location: input.location,
          stableDetail: `missing-edge:${String(input.location.edgeId)}`,
        }),
      ]),
    };
  }

  return {
    kind: "ok",
    operation: {
      kind: "edge",
      edge,
    },
  };
}

function operationForCallProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "call" }>;
}): ProofCheckOperationForProgramPointResult {
  for (const callEdge of input.mir.callGraph.entries()) {
    if (callEdge.callId.functionInstanceId !== input.location.functionInstanceId) {
      continue;
    }
    if (String(callEdge.callId.callId) !== String(input.location.callId.callId)) {
      continue;
    }
    return {
      kind: "ok",
      operation: {
        kind: "call",
        call: callEdge,
      },
    };
  }

  return {
    kind: "error",
    diagnostics: sortProofCheckDiagnostics([
      missingMirNodeDiagnostic({
        location: input.location,
        stableDetail: `missing-call:${String(input.location.callId.callId)}`,
      }),
    ]),
  };
}

function operationForExitProgramPoint(input: {
  readonly mir: ProofMirProgram;
  readonly location: Extract<ProofCheckProgramPoint, { readonly kind: "exit" }>;
}): ProofCheckOperationForProgramPointResult {
  const functionGraph = resolveProofMirFunction(input.mir, input.location.functionInstanceId);
  if (functionGraph === undefined) {
    return missingFunctionResult(input.location, input.location.functionInstanceId);
  }

  const exit = functionGraph.exits.find((candidate) => candidate.exitId === input.location.exitId);
  if (exit === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingMirNodeDiagnostic({
          location: input.location,
          stableDetail: `missing-exit:${String(input.location.exitId)}`,
        }),
      ]),
    };
  }

  return {
    kind: "ok",
    operation: {
      kind: "exit",
      exit,
    },
  };
}

export function dispatchProofCheckOperation(input: {
  readonly registry: ProofCheckOperationTransferRegistry;
  readonly transition: ProofCheckTransition;
}): ProofCheckTransitionResult {
  const operation = input.transition.operation;

  switch (operation.kind) {
    case "functionEntry":
      return input.registry.functionEntry({ transition: input.transition, operation });
    case "statement":
      return input.registry.statement({ transition: input.transition, operation });
    case "terminator":
      return input.registry.terminator({ transition: input.transition, operation });
    case "edge":
      return input.registry.edge({ transition: input.transition, operation });
    case "call":
      return input.registry.call({ transition: input.transition, operation });
    case "join":
      return input.registry.join({ transition: input.transition, operation });
    case "loopHeader":
      return input.registry.loopHeader({ transition: input.transition, operation });
    case "exit":
      return input.registry.exit({ transition: input.transition, operation });
    case "terminalClosure":
      return input.registry.terminalClosure({ transition: input.transition, operation });
    default: {
      const unreachable: never = operation;
      return unreachable;
    }
  }
}
