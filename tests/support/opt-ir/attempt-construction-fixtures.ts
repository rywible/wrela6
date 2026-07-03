import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType } from "../../../src/mono/mono-hir";
import type { ProofMirFunction } from "../../../src/proof-mir/model/program";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { coreTypeId } from "../../../src/semantic/ids";
import { attemptId, hirExpressionId, hirLocalId } from "../../../src/hir/ids";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import {
  proofMirRuntimeValue,
  reachableTwoBlockFunction,
  replaceFunctionBlock,
  table,
} from "./construction-fixture-rewriters";

export function callResultPlaceLoadFunction(function_: ProofMirFunction): ProofMirFunction {
  const baseFunction = reachableTwoBlockFunction(function_);
  const entryBlock =
    baseFunction.blocks.get(baseFunction.entryBlockId) ?? baseFunction.blocks.entries()[0];
  const loadBlock = baseFunction.blocks
    .entries()
    .find((block) => block.blockId !== baseFunction.entryBlockId);
  if (entryBlock === undefined) {
    return function_;
  }
  if (loadBlock === undefined) {
    return baseFunction;
  }

  const callResult = proofMirValueId(9351);
  const loadedResult = proofMirValueId(9352);
  const callResultPlace = proofMirPlaceId(9351);
  const loadedPlace = proofMirPlaceId(9352);
  const local = {
    instanceId: function_.functionInstanceId,
    hirId: hirLocalId(9351),
  };
  const valueType = coreCheckedType(coreTypeId("u8")) as MonoCheckedType;
  const callStatement = {
    statementId: proofMirStatementId(9351),
    kind: {
      kind: "call" as const,
      call: {
        callId: proofMirCallId(9351),
        target: {
          kind: "sourceFunction" as const,
          functionInstanceId: monoInstanceId("fixture::callee"),
          abi: {
            kind: "functionAbi" as const,
            functionInstanceId: monoInstanceId("fixture::callee"),
          },
        },
        arguments: [],
        requirements: [],
        result: {
          kind: "valueAndPlace" as const,
          value: callResult,
          place: callResultPlace,
        },
        origin: entryBlock.origin,
      },
    },
    origin: entryBlock.origin,
  };
  const loadStatement = {
    statementId: proofMirStatementId(9352),
    kind: {
      kind: "load" as const,
      place: loadedPlace,
      result: loadedResult,
    },
    origin: entryBlock.origin,
  };
  const rewrittenEntryBlock = {
    ...entryBlock,
    statements: [callStatement, ...entryBlock.statements],
  };
  const rewrittenLoadBlock = {
    ...loadBlock,
    statements: [loadStatement, ...loadBlock.statements],
  };

  return {
    ...replaceFunctionBlock(
      replaceFunctionBlock(baseFunction, rewrittenEntryBlock),
      rewrittenLoadBlock,
    ),
    values: table(
      [
        ...baseFunction.values.entries(),
        proofMirRuntimeValue(callResult, valueType, entryBlock.origin),
        proofMirRuntimeValue(loadedResult, valueType, entryBlock.origin),
      ],
      (value) => value.valueId,
    ),
    places: table(
      [
        ...baseFunction.places.entries(),
        {
          placeId: callResultPlace,
          root: { kind: "local" as const, localId: local },
          projection: [],
          type: valueType,
          resourceKind: "Copy" as never,
          origin: entryBlock.origin,
        },
        {
          placeId: loadedPlace,
          root: { kind: "local" as const, localId: local },
          projection: [],
          type: valueType,
          resourceKind: "Copy" as never,
          origin: entryBlock.origin,
        },
      ],
      (place) => place.placeId,
    ),
  };
}

export function attemptMatchFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }

  const statusValue = proofMirValueId(9371);
  const pendingResultPlace = proofMirPlaceId(9371);
  const successValue = proofMirValueId(9372);
  const loadedSuccessValue = proofMirValueId(9373);
  const successPlace = proofMirPlaceId(9372);
  const successBlockId = proofMirBlockId(9371);
  const errorBlockId = proofMirBlockId(9372);
  const successEdgeId = proofMirControlEdgeId(9371);
  const errorEdgeId = proofMirControlEdgeId(9372);
  const attemptProofId = {
    owner: { kind: "function" as const, instanceId: function_.functionInstanceId },
    hirId: attemptId(9371),
    instanceId: function_.functionInstanceId,
  };
  const valueType = coreCheckedType(coreTypeId("u64")) as MonoCheckedType;
  const attemptStatement = {
    statementId: proofMirStatementId(9371),
    kind: {
      kind: "attempt" as const,
      attempt: {
        attemptId: attemptProofId,
        fallible: {
          expressionId: {
            instanceId: function_.functionInstanceId,
            hirId: hirExpressionId(9371),
          },
          result: { kind: "value" as const, value: statusValue },
          origin: entryBlock.origin,
        },
        pendingResultPlace,
        inputPlaces: [],
        origin: entryBlock.origin,
      },
    },
    origin: entryBlock.origin,
  };
  const rewrittenEntryBlock = {
    ...entryBlock,
    statements: [
      {
        statementId: proofMirStatementId(9370),
        kind: {
          kind: "literal" as const,
          value: statusValue,
          literal: { kind: "integer" as const, text: "0", value: 0n },
        },
        origin: entryBlock.origin,
      },
      attemptStatement,
    ],
    terminator: {
      terminatorId: proofMirTerminatorId(9371),
      kind: {
        kind: "matchAttempt" as const,
        match: {
          attemptId: attemptProofId,
          successTarget: { edgeId: successEdgeId, blockId: successBlockId },
          errorTarget: { edgeId: errorEdgeId, blockId: errorBlockId },
          inputPlaces: [],
          origin: entryBlock.origin,
        },
      },
      outgoingEdges: [successEdgeId, errorEdgeId],
      origin: entryBlock.origin,
    },
  };
  const successBlock = {
    blockId: successBlockId,
    scopeId: entryBlock.scopeId,
    parameters: [],
    statements: [
      {
        statementId: proofMirStatementId(9372),
        kind: {
          kind: "load" as const,
          place: successPlace,
          result: loadedSuccessValue,
        },
        origin: entryBlock.origin,
      },
    ],
    terminator: {
      terminatorId: proofMirTerminatorId(9372),
      kind: { kind: "unreachable" as const, reason: "emptyMatch" as const },
      outgoingEdges: [],
      origin: entryBlock.origin,
    },
    incomingEdges: [successEdgeId],
    origin: entryBlock.origin,
  };
  const errorBlock = {
    ...successBlock,
    blockId: errorBlockId,
    statements: [],
    incomingEdges: [errorEdgeId],
  };
  const successEdge = {
    edgeId: successEdgeId,
    fromBlockId: entryBlock.blockId,
    toBlockId: successBlockId,
    kind: "attemptSuccess" as const,
    arguments: [successValue],
    facts: [],
    effects: [{ kind: "introducePlace" as const, placeId: successPlace }],
    crossedScopes: [],
    origin: entryBlock.origin,
  };
  const errorEdge = {
    ...successEdge,
    edgeId: errorEdgeId,
    toBlockId: errorBlockId,
    kind: "attemptError" as const,
    arguments: [],
    effects: [],
  };

  return {
    ...function_,
    values: table(
      [
        ...function_.values.entries(),
        proofMirRuntimeValue(statusValue, valueType, entryBlock.origin),
        proofMirRuntimeValue(successValue, valueType, entryBlock.origin),
        proofMirRuntimeValue(loadedSuccessValue, valueType, entryBlock.origin),
      ],
      (value) => value.valueId,
    ),
    places: table(
      [
        ...function_.places.entries(),
        {
          placeId: pendingResultPlace,
          root: { kind: "temporary" as const, ordinal: 9371 },
          projection: [],
          type: valueType,
          resourceKind: "Copy" as never,
          origin: entryBlock.origin,
        },
        {
          placeId: successPlace,
          root: {
            kind: "local" as const,
            localId: {
              instanceId: function_.functionInstanceId,
              hirId: hirLocalId(9372),
            },
          },
          projection: [],
          type: valueType,
          resourceKind: "Copy" as never,
          origin: entryBlock.origin,
        },
      ],
      (place) => place.placeId,
    ),
    blocks: table([rewrittenEntryBlock, successBlock, errorBlock], (block) => block.blockId),
    edges: table([successEdge, errorEdge], (edge) => edge.edgeId),
  };
}
