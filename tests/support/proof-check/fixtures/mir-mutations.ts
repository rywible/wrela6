import { buildMonoTable, proofMetadataIdKey } from "../../../../src/mono/proof-metadata-tables";
import { monoExpressionIdFor } from "../../../../src/mono/function-instantiator-shell";
import type { MonoInstantiatedProofId } from "../../../../src/mono/mono-hir";
import type { MonoTerminalCall } from "../../../../src/mono/mono-hir";
import type { MonoInstanceId } from "../../../../src/mono/ids";
import {
  hirExpressionId,
  hirTerminalCallId,
  obligationId as hirObligationId,
  validationId as hirValidationId,
  type ObligationId,
  type SessionId,
  type ValidationId,
} from "../../../../src/hir/ids";
import { proofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../../src/proof-mir/canonicalization/canonical-order";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirLoanId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirStatementId,
} from "../../../../src/proof-mir/ids";
import type {
  ProofMirControlEdgeId,
  ProofMirExitEdgeId,
  ProofMirTerminatorId,
} from "../../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirStatement,
} from "../../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../../src/proof-mir/model/program";
import type { ProofCheckInvalidFixtureCase } from "./fixture-types";
import {
  authorityFingerprintForMir,
  blocksTableForTest,
  edgesTableForTest,
  monoProofIdForFunction,
  reachableFunctionIds,
  replaceMirFunctions,
  updateFirstReachableFunction,
  withRuntimeCatalogFingerprint,
} from "./mir-fixture-utils";

function withLoopHeaderOnFirstBlock(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }
    const scope = functionGraph.scopes.entries()[0];
    if (scope === undefined) {
      return functionGraph;
    }
    const backedgeId = proofMirControlEdgeId(9101);
    const blocks = functionGraph.blocks.entries().map((entry) =>
      entry.blockId === block.blockId
        ? {
            ...entry,
            incomingEdges: [...entry.incomingEdges, backedgeId],
            stateMerge: {
              kind: "loopHeader" as const,
              loopScopeId: scope.scopeId,
              boundaryResources: {
                places: [],
                loans: [],
                obligations: [],
                sessionMembers: [],
                privateStateGenerations: [],
              },
              origin: entry.origin,
            },
            terminator: {
              ...entry.terminator,
              kind: "branch" as const,
              outgoingEdges: [...entry.terminator.outgoingEdges, backedgeId],
            },
          }
        : entry,
    );
    const edges = [
      ...functionGraph.edges.entries(),
      {
        edgeId: backedgeId,
        fromBlockId: block.blockId,
        toBlockId: block.blockId,
        kind: "loopBackedge" as const,
        origin: block.origin,
      },
    ] as readonly ProofMirControlEdge[];
    return {
      ...functionGraph,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
      edges: edgesTableForTest(edges),
    } as ProofMirFunction;
  });
}

export function withConcurrencyExtensionStatement(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }
    const origin = block.origin;
    const parameterId = functionGraph.signature.parameters[0]?.parameterId ?? (9000 as never);
    const placeId = proofMirPlaceId(9001);
    const parameterPlace =
      functionGraph.places
        .entries()
        .find(
          (place) =>
            place.root.kind === "parameter" &&
            String(place.root.parameterId) === String(parameterId),
        ) ?? undefined;
    const signature =
      functionGraph.signature.parameters.length > 0
        ? functionGraph.signature
        : {
            ...functionGraph.signature,
            parameters: [
              {
                parameterId,
                name: "transfer",
                type: { kind: "primitive" as const, name: "unit" } as never,
                mode: "observe" as const,
                resourceKind: "Affine" as const,
                sourceSpan: { start: 0, end: 0 },
              },
            ],
          };
    const placeTableResult = proofMirDeterministicTable({
      entries: [
        ...functionGraph.places.entries(),
        {
          placeId,
          root: { kind: "parameter" as const, parameterId },
          projection: [],
          type: { kind: "primitive" as const, name: "unit" } as never,
          resourceKind: "Affine" as const,
          origin,
        },
      ],
      keyOf: (place) => proofMirCanonicalKey(String(place.placeId)),
      lookupKeyOf: (key) => proofMirCanonicalKey(String(key)),
      normalizePayload: (place) => String(place.placeId),
    });
    const places =
      parameterPlace === undefined && placeTableResult.kind === "ok"
        ? placeTableResult.table
        : functionGraph.places;
    const fromPlace = parameterPlace?.placeId ?? placeId;
    const toPlace = proofMirPlaceId(9002);
    const extensionStatementId = proofMirStatementId(9001);
    const blocks = functionGraph.blocks.entries().map((entry) =>
      entry.blockId === block.blockId
        ? {
            ...entry,
            statements: [
              ...entry.statements,
              {
                statementId: extensionStatementId,
                kind: {
                  kind: "extension" as const,
                  extension: {
                    gate: "crossCoreOwnership" as const,
                    kind: "concurrency" as const,
                    operation: {
                      kind: "transferOwnership" as const,
                      fromPlace,
                      toPlace,
                      origin: entry.origin,
                    },
                  },
                },
                origin: entry.origin,
              },
            ],
          }
        : entry,
    );
    return {
      ...functionGraph,
      signature,
      places,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
    } as ProofMirFunction;
  });
}

export function withTerminalFunction(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => ({
    ...functionGraph,
    signature: {
      ...functionGraph.signature,
      modifiers: {
        ...functionGraph.signature.modifiers,
        isTerminal: true,
      },
    },
  }));
}

export function withEmbeddedRuntimeCatalogFingerprint(
  mir: ProofMirProgram,
  digestSeed: string,
): ProofMirProgram {
  const fingerprint = authorityFingerprintForMir(mir, "runtime", digestSeed, "runtime-v1");
  return {
    ...mir,
    runtimeCatalog: withRuntimeCatalogFingerprint(mir.runtimeCatalog, fingerprint),
  };
}

function prependStatementsToFirstBlock(
  mir: ProofMirProgram,
  statements: readonly ProofMirStatement[],
): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }
    const blocks = functionGraph.blocks
      .entries()
      .map((entry) =>
        entry.blockId === block.blockId
          ? { ...entry, statements: [...statements, ...entry.statements] }
          : entry,
      );
    return {
      ...functionGraph,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
    } as ProofMirFunction;
  });
}

function withOpenSessionMemberBeforeReturn(mir: ProofMirProgram): ProofMirProgram {
  const functionInstanceId = reachableFunctionIds(mir)[0];
  if (functionInstanceId === undefined) {
    return mir;
  }
  const origin = proofMirOriginId(9010);
  const sessionId = monoProofIdForFunction<SessionId>(functionInstanceId, 9010 as SessionId);
  const obligationIdValue = monoProofIdForFunction<ObligationId>(
    functionInstanceId,
    hirObligationId(9010),
  );
  return prependStatementsToFirstBlock(mir, [
    {
      statementId: proofMirStatementId(9010),
      kind: {
        kind: "openSessionMember",
        member: {
          sessionId,
          brandId: monoProofIdForFunction(functionInstanceId, 9011 as never),
          obligationId: obligationIdValue,
          origin,
        },
      },
      origin,
    },
  ]);
}

function withWrongSessionDischargeBeforeReturn(mir: ProofMirProgram): ProofMirProgram {
  const functionInstanceId = reachableFunctionIds(mir)[0];
  if (functionInstanceId === undefined) {
    return mir;
  }
  const origin = proofMirOriginId(9012);
  const sessionId = monoProofIdForFunction<SessionId>(functionInstanceId, 9012 as SessionId);
  const obligationIdValue = monoProofIdForFunction<ObligationId>(
    functionInstanceId,
    hirObligationId(9012),
  );
  return prependStatementsToFirstBlock(mir, [
    {
      statementId: proofMirStatementId(9012),
      kind: {
        kind: "openSessionMember",
        member: {
          sessionId,
          brandId: monoProofIdForFunction(functionInstanceId, 9014 as never),
          origin,
        },
      },
      origin,
    },
    {
      statementId: proofMirStatementId(9013),
      kind: {
        kind: "openObligation",
        obligation: {
          obligationId: monoProofIdForFunction(functionInstanceId, hirObligationId(9013)),
          origin: proofMirOriginId(9013),
        },
      },
      origin: proofMirOriginId(9013),
    },
    {
      statementId: proofMirStatementId(9014),
      kind: {
        kind: "dischargeObligation",
        obligation: {
          obligationId: obligationIdValue,
          origin: proofMirOriginId(9014),
        },
      },
      origin: proofMirOriginId(9014),
    },
  ]);
}

function withPlatformEdgeSourceRequirements(mir: ProofMirProgram): ProofMirProgram {
  const reachableId = reachableFunctionIds(mir)[0];
  if (reachableId === undefined) {
    return mir;
  }
  const requirementId = monoProofIdForFunction(reachableId, 9030 as never);
  const platformContractEdges = buildMonoTable(
    mir.proofMetadata.platformContractEdges.entries().map((edge) => ({
      ...edge,
      sourceRequirementIds: [requirementId],
    })),
    (entry) => proofMetadataIdKey(entry.edgeId),
    (id: MonoInstantiatedProofId<unknown>) => proofMetadataIdKey(id),
  );
  return {
    ...mir,
    proofMetadata: {
      ...mir.proofMetadata,
      platformContractEdges,
    },
  };
}

function withForgedSummaryFactsOnCallee(mir: ProofMirProgram): ProofMirProgram {
  const calleeId = [...mir.functions.entries()].find((functionGraph) =>
    [...mir.callGraph.entries()].some(
      (call) =>
        call.target.kind === "sourceFunction" &&
        String(call.target.functionInstanceId) === String(functionGraph.functionInstanceId),
    ),
  )?.functionInstanceId;
  if (calleeId === undefined) {
    return mir;
  }
  const origin = proofMirOriginId(9040);
  const obligationIdValue = monoProofIdForFunction(calleeId, hirObligationId(9040));
  return replaceMirFunctions(
    mir,
    mir.functions.entries().map((functionGraph) => {
      if (String(functionGraph.functionInstanceId) !== String(calleeId)) {
        return functionGraph;
      }
      const block = functionGraph.blocks.entries()[0];
      if (block === undefined) {
        return functionGraph;
      }
      const blocks = functionGraph.blocks.entries().map((entry) =>
        entry.blockId === block.blockId
          ? {
              ...entry,
              statements: [
                {
                  statementId: proofMirStatementId(9040),
                  kind: {
                    kind: "openObligation" as const,
                    obligation: { obligationId: obligationIdValue, origin },
                  },
                  origin,
                },
                ...entry.statements,
              ],
            }
          : entry,
      );
      return {
        ...functionGraph,
        blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
      } as ProofMirFunction;
    }),
  );
}

function withDivergentObligationsAtJoin(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const entryBlock = functionGraph.blocks.get(functionGraph.entryBlockId);
    if (entryBlock === undefined) {
      return functionGraph;
    }
    const origin = proofMirOriginId(8901);
    const leftBlockId = proofMirBlockId(8901);
    const rightBlockId = proofMirBlockId(8902);
    const joinBlockId = proofMirBlockId(8903);
    const leftToJoinEdgeId = 8901 as ProofMirControlEdgeId;
    const rightToJoinEdgeId = 8902 as ProofMirControlEdgeId;
    const entryToLeftEdgeId = 8904 as ProofMirControlEdgeId;
    const entryToRightEdgeId = 8905 as ProofMirControlEdgeId;
    const joinReturnEdgeId = 8903 as ProofMirControlEdgeId;
    const joinExitId = 8901 as ProofMirExitEdgeId;
    const functionInstanceId = functionGraph.functionInstanceId;
    const leftObligation = monoProofIdForFunction(functionInstanceId, hirObligationId(8901));
    const rightObligation = monoProofIdForFunction(functionInstanceId, hirObligationId(8902));

    const leftBlock: ProofMirBlock = {
      blockId: leftBlockId,
      scopeId: entryBlock.scopeId,
      parameters: [],
      statements: [
        {
          statementId: proofMirStatementId(8901),
          kind: {
            kind: "openObligation",
            obligation: { obligationId: leftObligation, origin },
          },
          origin,
        },
      ],
      terminator: {
        terminatorId: 8901 as ProofMirTerminatorId,
        kind: { kind: "goto", target: { edgeId: leftToJoinEdgeId, blockId: joinBlockId } },
        outgoingEdges: [leftToJoinEdgeId],
        origin,
      },
      incomingEdges: [entryToLeftEdgeId],
      origin,
    };
    const rightBlock: ProofMirBlock = {
      blockId: rightBlockId,
      scopeId: entryBlock.scopeId,
      parameters: [],
      statements: [
        {
          statementId: proofMirStatementId(8902),
          kind: {
            kind: "openObligation",
            obligation: { obligationId: rightObligation, origin },
          },
          origin,
        },
      ],
      terminator: {
        terminatorId: 8902 as ProofMirTerminatorId,
        kind: { kind: "goto", target: { edgeId: rightToJoinEdgeId, blockId: joinBlockId } },
        outgoingEdges: [rightToJoinEdgeId],
        origin,
      },
      incomingEdges: [entryToRightEdgeId],
      origin,
    };
    const joinBlock: ProofMirBlock = {
      blockId: joinBlockId,
      scopeId: entryBlock.scopeId,
      parameters: [],
      statements: [],
      terminator: {
        terminatorId: 8903 as ProofMirTerminatorId,
        kind: { kind: "return", edgeId: joinReturnEdgeId, exit: joinExitId },
        outgoingEdges: [joinReturnEdgeId],
        origin,
      },
      incomingEdges: [leftToJoinEdgeId, rightToJoinEdgeId],
      origin,
    };
    const forkBlock: ProofMirBlock = {
      ...entryBlock,
      terminator: {
        terminatorId: 8904 as ProofMirTerminatorId,
        kind: { kind: "goto", target: { edgeId: entryToLeftEdgeId, blockId: leftBlockId } },
        outgoingEdges: [entryToLeftEdgeId, entryToRightEdgeId],
        origin,
      },
      incomingEdges: [],
    };
    const edges: ProofMirControlEdge[] = [
      {
        edgeId: entryToLeftEdgeId,
        fromBlockId: forkBlock.blockId,
        toBlockId: leftBlockId,
        kind: "normal",
        arguments: [],
        facts: [],
        effects: [],
        crossedScopes: [],
        origin,
      },
      {
        edgeId: entryToRightEdgeId,
        fromBlockId: forkBlock.blockId,
        toBlockId: rightBlockId,
        kind: "normal",
        arguments: [],
        facts: [],
        effects: [],
        crossedScopes: [],
        origin,
      },
      {
        edgeId: leftToJoinEdgeId,
        fromBlockId: leftBlockId,
        toBlockId: joinBlockId,
        kind: "normal",
        arguments: [],
        facts: [],
        effects: [],
        crossedScopes: [],
        origin,
      },
      {
        edgeId: rightToJoinEdgeId,
        fromBlockId: rightBlockId,
        toBlockId: joinBlockId,
        kind: "normal",
        arguments: [],
        facts: [],
        effects: [],
        crossedScopes: [],
        origin,
      },
      {
        edgeId: joinReturnEdgeId,
        fromBlockId: joinBlockId,
        toBlockId: joinBlockId,
        kind: "returnExit",
        arguments: [],
        facts: [],
        effects: [],
        crossedScopes: [],
        exit: joinExitId,
        origin,
      },
    ];
    const blocks = [forkBlock, leftBlock, rightBlock, joinBlock];
    return {
      ...functionGraph,
      entryBlockId: forkBlock.blockId,
      blocks: blocksTableForTest(forkBlock, blocks),
      edges: edgesTableForTest(edges),
      exits: [
        {
          exitId: joinExitId,
          fromBlockId: joinBlockId,
          kind: "ordinaryReturn",
          boundary: { kind: "function", unwind: "none" },
          crossedScopes: [],
          closure: {
            kind: "functionExit",
            requireNoLiveLoans: true,
            requireNoOpenObligations: true,
            requireNoLiveSessionMembers: true,
            requireNoPendingValidationResults: true,
            terminalReachability: "notRequired",
          },
          origin,
        },
      ],
    };
  });
}

function withTerminalCallMetadata(
  mir: ProofMirProgram,
  input: {
    readonly callerFunctionInstanceId: MonoInstanceId;
    readonly calleeSourceFunctionId: ProofMirFunction["sourceFunctionId"];
  },
): ProofMirProgram {
  const callerGraph = mir.functions.get(input.callerFunctionInstanceId);
  if (callerGraph === undefined) {
    return mir;
  }
  const terminalCall: MonoTerminalCall = {
    terminalCallId: {
      owner: { kind: "function", instanceId: input.callerFunctionInstanceId },
      hirId: hirTerminalCallId(9101),
      instanceId: input.callerFunctionInstanceId,
    },
    callExpressionId: monoExpressionIdFor(input.callerFunctionInstanceId, hirExpressionId(9101)),
    calleeFunctionId: input.calleeSourceFunctionId,
    closureObligationId: {
      owner: { kind: "function", instanceId: input.callerFunctionInstanceId },
      hirId: hirObligationId(9101),
      instanceId: input.callerFunctionInstanceId,
    },
    sourceOrigin: "fixture:terminal-call",
  };
  const existingCalls = mir.proofMetadata.terminalCalls.entries();
  const terminalCalls = buildMonoTable(
    [...existingCalls, terminalCall],
    (entry) => proofMetadataIdKey(entry.terminalCallId),
    (id: MonoInstantiatedProofId<unknown>) => proofMetadataIdKey(id),
  );
  return {
    ...mir,
    proofMetadata: {
      ...mir.proofMetadata,
      terminalCalls,
    },
  };
}

function withOpenExclusiveLoanBeforeReturn(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }
    const scope = functionGraph.scopes.entries()[0];
    const scopeId = scope?.scopeId ?? (0 as never);
    const placeId = proofMirPlaceId(8801);
    const loanId = proofMirLoanId(8801);
    const origin = proofMirOriginId(8801);
    const borrowStatement = {
      statementId: proofMirStatementId(8801),
      kind: {
        kind: "borrowPlace" as const,
        place: placeId,
        loan: {
          loanId,
          mode: "exclusive" as const,
          placeId,
          scopeId,
          startOrigin: origin,
          endOrigin: origin,
        },
      },
      origin,
    };
    const blocks = functionGraph.blocks.entries().map((entry) =>
      entry.blockId === block.blockId
        ? {
            ...entry,
            statements: [borrowStatement, ...entry.statements],
          }
        : entry,
    );
    const places = functionGraph.places.entries();
    const scopes = functionGraph.scopes.entries();
    const parameterId =
      functionGraph.signature.parameters[0]?.parameterId ??
      functionGraph.signature.receiver?.parameterId;
    const placeTable = proofMirDeterministicTable({
      entries: [
        ...places,
        {
          placeId,
          root:
            parameterId === undefined
              ? { kind: "local" as const, localId: 0 as never }
              : { kind: "parameter" as const, parameterId },
          projection: [],
          type: { kind: "primitive" as const, name: "unit" } as never,
          resourceKind: "Copy" as const,
          origin,
        },
      ],
      keyOf: (place) => proofMirCanonicalKey(String(place.placeId)),
      lookupKeyOf: (key) => proofMirCanonicalKey(String(key)),
      normalizePayload: (place) => String(place.placeId),
    });
    if (placeTable.kind !== "ok") {
      return functionGraph;
    }
    const scopeTable = proofMirDeterministicTable({
      entries:
        scopes.length > 0
          ? scopes
          : [
              {
                scopeId,
                kind: "function" as const,
                ownedLocals: [],
                openedObligations: [],
                openedSessionMembers: [],
                origin,
              },
            ],
      keyOf: (scopeEntry) => proofMirCanonicalKey(String(scopeEntry.scopeId)),
      lookupKeyOf: (key) => proofMirCanonicalKey(String(key)),
      normalizePayload: (scopeEntry) => String(scopeEntry.scopeId),
    });
    if (scopeTable.kind !== "ok") {
      return functionGraph;
    }
    return {
      ...functionGraph,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
      places: placeTable.table,
      scopes: scopeTable.table,
    } as ProofMirFunction;
  });
}

function withIgnoredValidationBeforeReturn(mir: ProofMirProgram): ProofMirProgram {
  const functionInstanceId = reachableFunctionIds(mir)[0];
  if (functionInstanceId === undefined) {
    return mir;
  }
  const validatedBuffer = mir.layout.validatedBuffers.entries()[0];
  if (validatedBuffer === undefined) {
    return mir;
  }

  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }

    const packetParameter = functionGraph.signature.parameters[0];
    if (packetParameter === undefined) {
      return functionGraph;
    }

    const parameterPlaces = functionGraph.places
      .entries()
      .filter(
        (place) =>
          place.root.kind === "parameter" &&
          String(place.root.parameterId) === String(packetParameter.parameterId),
      );
    const packetPlace =
      parameterPlaces.find((place) => place.resourceKind !== "ValidatedBuffer") ??
      parameterPlaces[0];
    if (packetPlace === undefined) {
      return functionGraph;
    }

    const pendingParameterId = 9020 as never;
    const pendingPlaceId = proofMirPlaceId(9020);
    const okPacketPlaceId = proofMirPlaceId(9021);
    const origin = proofMirOriginId(9020);
    const validationIdValue = monoProofIdForFunction<ValidationId>(
      functionInstanceId,
      hirValidationId(9022),
    );

    const placeTableResult = proofMirDeterministicTable({
      entries: [
        ...functionGraph.places.entries(),
        {
          placeId: pendingPlaceId,
          root: { kind: "parameter" as const, parameterId: pendingParameterId },
          projection: [],
          type: { kind: "primitive" as const, name: "unit" } as never,
          resourceKind: "Copy" as const,
          origin,
        },
        {
          placeId: okPacketPlaceId,
          root: { kind: "local" as const, localId: 9021 as never },
          projection: [],
          type: packetPlace.type,
          resourceKind: "Affine" as const,
          origin: proofMirOriginId(9021),
        },
      ],
      keyOf: (place) => proofMirCanonicalKey(String(place.placeId)),
      lookupKeyOf: (key) => proofMirCanonicalKey(String(key)),
      normalizePayload: (place) => String(place.placeId),
    });
    if (placeTableResult.kind !== "ok") {
      return functionGraph;
    }

    const validateStatement = {
      statementId: proofMirStatementId(9020),
      kind: {
        kind: "validate" as const,
        validation: {
          validationId: validationIdValue,
          sourcePlace: packetPlace.placeId,
          pendingResultPlace: pendingPlaceId,
          okPacketPlace: okPacketPlaceId,
          okPayloadType: packetPlace.type,
          errPayloadType: { kind: "primitive" as const, name: "unit" } as never,
          validatedBufferInstanceId: validatedBuffer.instanceId,
          layout: {
            kind: "validatedBuffer" as const,
            instanceId: validatedBuffer.instanceId,
          },
          origin,
        },
      },
      origin,
    };

    const blocks = functionGraph.blocks.entries().map((entry) =>
      entry.blockId === block.blockId
        ? {
            ...entry,
            statements: [validateStatement, ...entry.statements],
          }
        : entry,
    );

    return {
      ...functionGraph,
      signature: {
        ...functionGraph.signature,
        parameters: [
          ...functionGraph.signature.parameters,
          {
            parameterId: pendingParameterId,
            name: "pendingValidation",
            type: { kind: "primitive" as const, name: "unit" } as never,
            mode: "observe" as const,
            resourceKind: "Copy" as const,
            sourceSpan: { start: 0, end: 0 },
          },
        ],
      },
      places: placeTableResult.table,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
    } as ProofMirFunction;
  });
}

function withWrapperHiddenAffineLinearBeforeReturn(mir: ProofMirProgram): ProofMirProgram {
  return updateFirstReachableFunction(mir, (functionGraph) => {
    const block = functionGraph.blocks.entries()[0];
    if (block === undefined) {
      return functionGraph;
    }

    const wrapperParameterId = 9050 as never;
    const hiddenParameterId = 9051 as never;
    const wrapperPlaceId = proofMirPlaceId(9050);
    const hiddenPlaceId = proofMirPlaceId(9051);
    const origin = proofMirOriginId(9050);

    const placeTableResult = proofMirDeterministicTable({
      entries: [
        ...functionGraph.places.entries(),
        {
          placeId: wrapperPlaceId,
          root: { kind: "parameter" as const, parameterId: wrapperParameterId },
          projection: [],
          type: { kind: "primitive" as const, name: "unit" } as never,
          resourceKind: "Copy" as const,
          origin,
        },
        {
          placeId: hiddenPlaceId,
          root: { kind: "parameter" as const, parameterId: hiddenParameterId },
          projection: [],
          type: { kind: "primitive" as const, name: "unit" } as never,
          resourceKind: "Linear" as const,
          origin: proofMirOriginId(9051),
        },
      ],
      keyOf: (place) => proofMirCanonicalKey(String(place.placeId)),
      lookupKeyOf: (key) => proofMirCanonicalKey(String(key)),
      normalizePayload: (place) => String(place.placeId),
    });
    if (placeTableResult.kind !== "ok") {
      return functionGraph;
    }

    const consumeStatement = {
      statementId: proofMirStatementId(9050),
      kind: {
        kind: "consumePlace" as const,
        place: wrapperPlaceId,
        reason: "return" as const,
      },
      origin,
    };

    const blocks = functionGraph.blocks.entries().map((entry) =>
      entry.blockId === block.blockId
        ? {
            ...entry,
            statements: [consumeStatement, ...entry.statements],
          }
        : entry,
    );

    return {
      ...functionGraph,
      signature: {
        ...functionGraph.signature,
        parameters: [
          {
            parameterId: wrapperParameterId,
            name: "saved",
            type: { kind: "primitive" as const, name: "unit" } as never,
            mode: "observe" as const,
            resourceKind: "Copy" as const,
            sourceSpan: { start: 0, end: 0 },
          } as never,
          {
            parameterId: hiddenParameterId,
            name: "savedContent",
            type: { kind: "primitive" as const, name: "unit" } as never,
            mode: "observe" as const,
            resourceKind: "Linear" as const,
            sourceSpan: { start: 0, end: 0 },
          } as never,
        ],
      },
      places: placeTableResult.table,
      blocks: blocksTableForTest(block, blocks as readonly ProofMirBlock[]),
    } as ProofMirFunction;
  });
}

export function applyInvalidCaseMirMutation(
  mir: ProofMirProgram,
  invalidCase: ProofCheckInvalidFixtureCase | undefined,
): ProofMirProgram {
  if (invalidCase === undefined) {
    return mir;
  }

  let mutated = mir;
  switch (invalidCase) {
    case "missing-loop-convergence":
      mutated = withLoopHeaderOnFirstBlock(mir);
      break;
    case "missing-cross-core-certificate":
    case "non-core-movable-move-ring-transfer":
      mutated = withConcurrencyExtensionStatement(mir);
      break;
    case "terminal-self-cycle": {
      mutated = withTerminalFunction(mir);
      const terminalId = reachableFunctionIds(mutated)[0];
      const terminalGraph =
        terminalId === undefined ? undefined : mutated.functions.get(terminalId);
      if (terminalGraph !== undefined && terminalId !== undefined) {
        mutated = withTerminalCallMetadata(mutated, {
          callerFunctionInstanceId: terminalId,
          calleeSourceFunctionId: terminalGraph.sourceFunctionId,
        });
      }
      break;
    }
    case "terminal-mutual-cycle": {
      const reachable = reachableFunctionIds(mir);
      const firstId = reachable[0];
      const secondId = reachable[1] ?? reachable[0];
      if (firstId !== undefined) {
        mutated = replaceMirFunctions(
          mutated,
          mutated.functions.entries().map((functionGraph) =>
            String(functionGraph.functionInstanceId) === String(firstId) ||
            (secondId !== undefined &&
              String(functionGraph.functionInstanceId) === String(secondId))
              ? {
                  ...functionGraph,
                  signature: {
                    ...functionGraph.signature,
                    modifiers: { ...functionGraph.signature.modifiers, isTerminal: true },
                  },
                }
              : functionGraph,
          ),
        );
        const firstGraph = mutated.functions.get(firstId);
        const secondGraph = secondId === undefined ? undefined : mutated.functions.get(secondId);
        if (firstGraph !== undefined && secondGraph !== undefined && secondId !== undefined) {
          mutated = withTerminalCallMetadata(mutated, {
            callerFunctionInstanceId: firstId,
            calleeSourceFunctionId: secondGraph.sourceFunctionId,
          });
          mutated = withTerminalCallMetadata(mutated, {
            callerFunctionInstanceId: secondId,
            calleeSourceFunctionId: firstGraph.sourceFunctionId,
          });
        }
      }
      break;
    }
    case "runtime-catalog-fingerprint-mismatch":
      mutated = withEmbeddedRuntimeCatalogFingerprint(mir, "embedded-runtime");
      break;
    case "forged-summary-facts":
      mutated = withForgedSummaryFactsOnCallee(mir);
      break;
    case "live-loan-return":
      mutated = withOpenExclusiveLoanBeforeReturn(mir);
      break;
    case "live-session-member-return":
      mutated = withOpenSessionMemberBeforeReturn(mir);
      break;
    case "wrong-session-discharge":
      mutated = withWrongSessionDischargeBeforeReturn(mir);
      break;
    case "ignored-validation-result":
      mutated = withIgnoredValidationBeforeReturn(mir);
      break;
    case "wrapper-hidden-affine-linear-content":
      mutated = withWrapperHiddenAffineLinearBeforeReturn(mir);
      break;
    case "divergent-validation-split":
    case "divergent-attempt-split":
      mutated = withDivergentObligationsAtJoin(mir);
      break;
    case "missing-platform-precondition":
      mutated = withPlatformEdgeSourceRequirements(mir);
      break;
    case "unsupported-extension":
      mutated = withConcurrencyExtensionStatement(mir);
      break;
    default: {
      const unreachable: never = invalidCase;
      return unreachable;
    }
  }

  return mutated;
}
