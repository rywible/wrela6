import { checkedOptIrHandoffFingerprint, type CheckedOptIrHandoff } from "../../../src/proof-check";
import { emptyCheckedFactPacket, layoutFactKey } from "../../../src/proof-check/model/fact-packet";
import {
  proofCheckCoreCertificateId,
  proofCheckPathCertificateId,
} from "../../../src/proof-check/ids";
import {
  checkedFactPacketEntryForTest,
  factImportAuthorityFingerprintForTest,
} from "./fact-import-fixtures";
import { checkedOptIrHandoffForTest } from "./opt-ir-handoff-fixtures";
import {
  authenticatedLayoutFactsForTest,
  constructOptIrInputForTest,
  partialLayoutFactsForTest,
  targetSurfaceForInternalConstructionTest,
} from "./internal-construction-fixtures";
import type { ConstructOptIrInput, ConstructOptIrResult } from "../../../src/opt-ir/public-api";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoCheckedType } from "../../../src/mono/mono-hir";
import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import type { ProofMirFunction } from "../../../src/proof-mir/model/program";
import type { ProofMirBlock, ProofMirValue } from "../../../src/proof-mir/model/graph";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { coreTypeId, fieldId } from "../../../src/semantic/ids";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirFactId,
  proofMirLayoutTermBindingId,
  proofMirLayoutTermId,
  proofMirOwnedCallId,
  proofMirPlaceId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import {
  proofMirCanonicalKey,
  type ProofMirCanonicalKey,
} from "../../../src/proof-mir/canonicalization/canonical-keys";

export function validConstructOptIrInputForTest(): ConstructOptIrInput {
  const handoff = checkedOptIrHandoffForTest({ includeSemanticInlinePolicies: true });
  return constructOptIrInputForTest({
    handoff: withCheckedMir(handoff, { ...handoff.checkedMir, facts: emptyCheckedFactPacket() }),
    layoutFacts: authenticatedLayoutFactsForTest(),
    target: targetSurfaceForInternalConstructionTest(),
    options: { deterministicIds: true, recordConstructionTrace: true },
  });
}

export function validConstructOptIrInputWithShuffledTablesForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  return {
    ...input,
    handoff: withCheckedMir(input.handoff, withReversedFunctionTable(input.handoff.checkedMir)),
  };
}

export function validConstructOptIrInputWithReachableBlocksForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, reachableTwoBlockFunction);
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithScalarStatementsForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, scalarStatementFunction);
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithProofOnlyStatementForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, proofOnlyStatementFunction);
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithProofOnlyValueFactForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const proofOnlyValue = proofMirValueId(9451);
  const checkedMirWithValue = mapFirstFunction(input.handoff.checkedMir, (function_) =>
    proofOnlyValueFunction(function_, proofOnlyValue),
  );
  const erasureFact = checkedFactPacketEntryForTest({
    kind: "erasure",
    subject: { kind: "value", valueId: proofOnlyValue },
    dependencies: [
      { kind: "proofMirValue", valueId: proofOnlyValue },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const checkedMir: CheckedMirProgram = {
    ...checkedMirWithValue,
    facts: {
      ...checkedMirWithValue.facts,
      erasures: [erasureFact],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithProofOnlyDependentFactsForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const proofToken = proofMirValueId(9451);
  const dependentValue = proofMirValueId(9460);
  const orphanDependency = proofMirValueId(9452);
  const orphanSubject = proofMirValueId(9470);
  const checkedMirWithValues = mapFirstFunction(input.handoff.checkedMir, (function_) =>
    runtimeValueFunction(
      runtimeValueFunction(
        proofOnlyValueFunction(proofOnlyValueFunction(function_, proofToken), orphanDependency),
        dependentValue,
      ),
      orphanSubject,
    ),
  );
  const erasureFact = checkedFactPacketEntryForTest({
    kind: "erasure",
    subject: { kind: "value", valueId: proofToken },
    dependencies: [
      { kind: "proofMirValue", valueId: proofToken },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const dependentFact = checkedFactPacketEntryForTest({
    kind: "erasure",
    ordinal: 2,
    subject: { kind: "value", valueId: dependentValue },
    dependencies: [
      { kind: "proofMirValue", valueId: dependentValue },
      { kind: "proofMirValue", valueId: proofToken },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const orphanFact = checkedFactPacketEntryForTest({
    kind: "erasure",
    ordinal: 3,
    subject: { kind: "value", valueId: orphanSubject },
    dependencies: [
      { kind: "proofMirValue", valueId: orphanSubject },
      { kind: "proofMirValue", valueId: orphanDependency },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const checkedMir: CheckedMirProgram = {
    ...checkedMirWithValues,
    facts: {
      ...checkedMirWithValues.facts,
      erasures: [erasureFact, dependentFact, orphanFact],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithPreservedNoaliasWitnessForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const proofToken = proofMirValueId(9451);
  const livePlace = proofMirPlaceId(9480);
  const livePlaceValue = proofMirValueId(9481);
  const checkedMirWithWitness = mapFirstFunction(input.handoff.checkedMir, (function_) =>
    proofOnlyValueFunction(
      placeWithRuntimeValueFunction(function_, livePlace, livePlaceValue),
      proofToken,
    ),
  );
  const firstFunction = checkedMirWithWitness.mir.functions.entries()[0];
  if (firstFunction === undefined) {
    return input;
  }
  const edgeId = firstFunction.edges.entries()[0]?.edgeId ?? proofMirControlEdgeId(0);
  const erasureFact = checkedFactPacketEntryForTest({
    kind: "erasure",
    subject: { kind: "value", valueId: proofToken },
    dependencies: [
      { kind: "proofMirValue", valueId: proofToken },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const noaliasFact = checkedFactPacketEntryForTest({
    kind: "noalias",
    ordinal: 1,
    subject: {
      kind: "edge",
      functionInstanceId: firstFunction.functionInstanceId,
      edgeId,
    },
    dependencies: [
      { kind: "proofMirPlace", placeId: livePlace },
      { kind: "proofMirValue", valueId: proofToken },
      { kind: "proofMirEdge", edgeId },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });
  const checkedMir: CheckedMirProgram = {
    ...checkedMirWithWitness,
    facts: {
      ...checkedMirWithWitness.facts,
      erasures: [erasureFact],
      noalias: [noaliasFact],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithOrphanNoaliasWitnessForTest(): ConstructOptIrInput {
  const preserved = validConstructOptIrInputWithPreservedNoaliasWitnessForTest();
  const checkedMir: CheckedMirProgram = {
    ...preserved.handoff.checkedMir,
    facts: {
      ...preserved.handoff.checkedMir.facts,
      erasures: [],
    },
  };
  return { ...preserved, handoff: withCheckedMir(preserved.handoff, checkedMir) };
}

export function validConstructOptIrInputWithValidatedBufferReadForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, validatedBufferReadFunction);
  const firstFunction = checkedMir.mir.functions.entries()[0];
  if (firstFunction === undefined) {
    return input;
  }
  const layoutKey = layoutFactKey(String(firstFunction.functionInstanceId));
  const sourcePlace = proofMirPlaceId(9501);
  const checkedMirWithFact: CheckedMirProgram = {
    ...checkedMir,
    facts: {
      ...checkedMir.facts,
      validatedBuffers: [
        checkedFactPacketEntryForTest({
          kind: "validatedBuffer",
          subject: { kind: "place", placeId: sourcePlace },
          scope: { kind: "path", certificateId: proofCheckPathCertificateId(9501) },
          dependencies: [
            {
              kind: "proofMirEdge",
              edgeId: firstFunction.edges.entries()[0]?.edgeId ?? proofMirControlEdgeId(0),
            },
            { kind: "layoutFact", layoutKey },
            { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
          ],
        }),
      ],
    },
  };
  const pathHandoff = {
    ...input.handoff,
    packetValidation: {
      ...input.handoff.packetValidation,
      authorityFingerprints: [
        ...input.handoff.packetValidation.authorityFingerprints,
        input.layoutFacts.fingerprint,
      ],
    },
    pathCertificates: [
      {
        certificateId: proofCheckPathCertificateId(9501),
        functionInstanceId: firstFunction.functionInstanceId,
        requiredEdges: [],
        requiredDominators: [],
        excludedEdges: [],
        invalidatedBy: [],
        origin: {
          originKey: "opt-ir:validated-buffer-read:path:9501",
          proofMirOriginId: firstFunction.origin,
        },
      },
    ],
  };
  return {
    ...input,
    handoff: withCheckedMir(pathHandoff, checkedMirWithFact),
    layoutFacts: {
      ...input.layoutFacts,
      facts: partialLayoutFactsForTest({
        validatedBuffers: {
          entries: () => [{ instanceId: firstFunction.functionInstanceId }],
          keyString: (instanceId: typeof firstFunction.functionInstanceId) => String(instanceId),
        },
      } as unknown as Partial<LayoutFactProgram>).facts,
    },
  };
}

export function constructOptIrInputWithMissingValidatedBufferAuthorityForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputWithValidatedBufferReadForTest();
  const checkedMir: CheckedMirProgram = {
    ...input.handoff.checkedMir,
    facts: {
      ...input.handoff.checkedMir.facts,
      validatedBuffers: [],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function validConstructOptIrInputWithCapabilityFlowCallForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const firstFunction = input.handoff.checkedMir.mir.functions.entries()[0];
  if (firstFunction === undefined) {
    return input;
  }
  const callId = proofMirCallId(1);
  const capabilityFlow = checkedFactPacketEntryForTest({
    kind: "capabilityFlow",
    subject: {
      kind: "call",
      functionInstanceId: firstFunction.functionInstanceId,
      callId,
    },
    dependencies: [
      {
        kind: "authorityEntry",
        fingerprint: input.target.platformEffects.fingerprint,
        entryKey: "terminal.write",
      },
      { kind: "proofMirCall", callId },
    ],
  });
  const checkedMir: CheckedMirProgram = {
    ...input.handoff.checkedMir,
    facts: {
      ...input.handoff.checkedMir.facts,
      capabilityFlow: [capabilityFlow],
    },
    mir: {
      ...input.handoff.checkedMir.mir,
      callGraph: table(
        [
          {
            callId: proofMirOwnedCallId(firstFunction.functionInstanceId, callId),
            target: {
              kind: "compilerRuntime" as const,
              runtimeId: proofMirRuntimeOperationId(1),
              runtimeCallId: proofMirRuntimeCallId(1),
            },
            origin: firstFunction.origin,
          },
        ],
        (edge) => edge.callId,
      ),
    },
  };
  const handoff = withCheckedMir(
    {
      ...input.handoff,
      packetValidation: {
        ...input.handoff.packetValidation,
        authorityFingerprints: [
          ...input.handoff.packetValidation.authorityFingerprints,
          input.target.platformEffects.fingerprint,
        ],
      },
    },
    checkedMir,
  );
  return { ...input, handoff };
}

export function constructOptIrInputWithMismatchedCapabilityFlowCallForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputWithCapabilityFlowCallForTest();
  const entry = input.handoff.checkedMir.facts.capabilityFlow[0];
  if (entry === undefined) {
    return input;
  }
  const checkedMir: CheckedMirProgram = {
    ...input.handoff.checkedMir,
    facts: {
      ...input.handoff.checkedMir.facts,
      capabilityFlow: [
        {
          ...entry,
          subject:
            entry.subject.kind === "call"
              ? {
                  ...entry.subject,
                  functionInstanceId: monoInstanceId("fixture::missing-call-owner"),
                }
              : entry.subject,
        },
      ],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function invalidBoundaryConstructOptIrInputForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  return {
    ...input,
    handoff: {
      ...input.handoff,
      semanticInlinePolicies: [],
      handoffFingerprint: input.handoff.handoffFingerprint,
    },
  };
}

export function constructOptIrInputWithUnsupportedOperationForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, (function_) => ({
    ...function_,
    blocks: table(
      function_.blocks.entries().map((block, index) =>
        index === 0
          ? {
              ...block,
              statements: [
                {
                  statementId: proofMirStatementId(999),
                  kind: {
                    kind: "load",
                    place: proofMirPlaceId(999),
                    result: proofMirValueId(999),
                  },
                  origin: block.origin,
                },
              ],
            }
          : block,
      ),
      (block) => block.blockId,
    ),
  }));
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function constructOptIrInputWithMissingAuthorityForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const platformEffect = checkedFactPacketEntryForTest({
    kind: "platformEffect",
    subject: {
      kind: "authority",
      fingerprint: factImportAuthorityFingerprintForTest(99),
      entryKey: "platform:get_memory_map",
    },
  });
  const checkedMir = {
    ...input.handoff.checkedMir,
    facts: {
      ...input.handoff.checkedMir.facts,
      platformEffects: [platformEffect],
    },
  };
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function constructOptIrInputWithVerifierFailureForTest(): ConstructOptIrInput {
  const input = validConstructOptIrInputForTest();
  const checkedMir = mapFirstFunction(input.handoff.checkedMir, (function_) => ({
    ...function_,
    entryBlockId: proofMirBlockId(999),
  }));
  return { ...input, handoff: withCheckedMir(input.handoff, checkedMir) };
}

export function stableOptIrConstructionKey(result: ConstructOptIrResult): string {
  return stableJson(result);
}

function withCheckedMir(
  handoff: CheckedOptIrHandoff,
  checkedMir: CheckedMirProgram,
): CheckedOptIrHandoff {
  const withoutFingerprint = {
    ...handoff,
    checkedMir,
    packetValidation: {
      ...handoff.packetValidation,
      checkedFactPacketStableKey: stableJson(checkedMir.facts),
      acceptedFunctionInstanceIds: [...checkedMir.checkedFunctions.keys()].sort(),
      summaryCertificateIds: [...checkedMir.checkedFunctions.values()]
        .map((checkedFunction) => checkedFunction.summaryCertificate)
        .sort((left, right) => left - right),
      terminalGraphCertificateId: checkedMir.terminalGraph.certificateId,
      originMapStableKey: stableJson(checkedMir.originMap),
    },
  };
  return {
    ...withoutFingerprint,
    handoffFingerprint: checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

function withReversedFunctionTable(checkedMir: CheckedMirProgram): CheckedMirProgram {
  return {
    ...checkedMir,
    checkedFunctions: new Map([...checkedMir.checkedFunctions.entries()].reverse()),
    mir: {
      ...checkedMir.mir,
      functions: table(
        checkedMir.mir.functions.entries().slice().reverse(),
        (function_) => function_.functionInstanceId,
      ),
    },
  };
}

function reachableTwoBlockFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }

  const returnBlockId = proofMirBlockId(9101);
  const jumpEdgeId = proofMirControlEdgeId(9101);
  const returnEdge =
    function_.edges.entries().find((edge) => edge.kind === "returnExit") ??
    function_.edges.entries()[0];
  const returnEdgeId = returnEdge?.edgeId ?? proofMirControlEdgeId(9102);
  const exitId = function_.exits[0]?.exitId ?? proofMirExitEdgeId(9101);
  const origin = entryBlock.origin;
  const rewrittenEntryBlock = {
    ...entryBlock,
    terminator: {
      terminatorId: proofMirTerminatorId(9101),
      kind: {
        kind: "goto" as const,
        target: { edgeId: jumpEdgeId, blockId: returnBlockId },
      },
      outgoingEdges: [jumpEdgeId],
      origin,
    },
    incomingEdges: [],
  };
  const returnBlock = {
    blockId: returnBlockId,
    scopeId: entryBlock.scopeId,
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: proofMirTerminatorId(9102),
      kind: { kind: "return" as const, edgeId: returnEdgeId, exit: exitId },
      outgoingEdges: [returnEdgeId],
      origin,
    },
    incomingEdges: [jumpEdgeId],
    origin,
  };
  const jumpEdge = {
    edgeId: jumpEdgeId,
    fromBlockId: entryBlock.blockId,
    toBlockId: returnBlockId,
    kind: "normal" as const,
    arguments: [],
    facts: [],
    effects: [],
    crossedScopes: [],
    origin,
  };
  const rewrittenReturnEdge = {
    ...(returnEdge ?? jumpEdge),
    edgeId: returnEdgeId,
    fromBlockId: returnBlockId,
    toBlockId: undefined,
    kind: "returnExit" as const,
    arguments: [],
    origin,
  };

  return {
    ...function_,
    blocks: table([rewrittenEntryBlock, returnBlock], (block) => block.blockId),
    edges: table([jumpEdge, rewrittenReturnEdge], (edge) => edge.edgeId),
  };
}

function scalarStatementFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }
  const left = proofMirValueId(9301);
  const right = proofMirValueId(9302);
  const sum = proofMirValueId(9303);
  const predicate = proofMirValueId(9304);
  const u32 = coreCheckedType(coreTypeId("u32")) as MonoCheckedType;
  const bool = coreCheckedType(coreTypeId("bool")) as MonoCheckedType;

  const rewrittenEntryBlock = {
    ...entryBlock,
    statements: [
      {
        statementId: proofMirStatementId(9301),
        kind: {
          kind: "literal" as const,
          value: left,
          literal: { kind: "integer" as const, text: "2", value: 2n },
        },
        origin: entryBlock.origin,
      },
      {
        statementId: proofMirStatementId(9302),
        kind: {
          kind: "literal" as const,
          value: right,
          literal: { kind: "integer" as const, text: "40", value: 40n },
        },
        origin: entryBlock.origin,
      },
      {
        statementId: proofMirStatementId(9303),
        kind: { kind: "binary" as const, operator: "add" as const, left, right, result: sum },
        origin: entryBlock.origin,
      },
      {
        statementId: proofMirStatementId(9304),
        kind: {
          kind: "comparison" as const,
          operator: "ge" as const,
          left: sum,
          right,
          result: predicate,
        },
        origin: entryBlock.origin,
      },
    ],
    terminator:
      entryBlock.terminator.kind.kind === "return"
        ? {
            ...entryBlock.terminator,
            kind: {
              ...entryBlock.terminator.kind,
              value: {
                mode: "observe" as const,
                operand: { kind: "value" as const, value: predicate },
              },
            },
          }
        : entryBlock.terminator,
  };

  return {
    ...function_,
    values: table(
      [
        ...function_.values.entries(),
        proofMirRuntimeValue(left, u32, entryBlock.origin),
        proofMirRuntimeValue(right, u32, entryBlock.origin),
        proofMirRuntimeValue(sum, u32, entryBlock.origin),
        proofMirRuntimeValue(predicate, bool, entryBlock.origin),
      ],
      (value) => value.valueId,
    ),
    blocks: table(
      function_.blocks
        .entries()
        .map((block) => (block.blockId === entryBlock.blockId ? rewrittenEntryBlock : block)),
      (block) => block.blockId,
    ),
  };
}

function proofOnlyStatementFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }
  const rewrittenEntryBlock = {
    ...entryBlock,
    statements: [
      ...entryBlock.statements,
      {
        statementId: proofMirStatementId(9401),
        kind: { kind: "requireFact" as const, factId: proofMirFactId(9401) },
        origin: entryBlock.origin,
      },
    ],
  };
  return replaceFunctionBlock(function_, rewrittenEntryBlock);
}

function proofOnlyValueFunction(
  function_: ProofMirFunction,
  proofOnlyValueId: ReturnType<typeof proofMirValueId>,
): ProofMirFunction {
  const origin = function_.origin;
  const proofType = coreCheckedType(coreTypeId("bool")) as MonoCheckedType;
  return {
    ...function_,
    values: table(
      [
        ...function_.values.entries(),
        {
          valueId: proofOnlyValueId,
          type: proofType,
          resourceKind: "Copy" as never,
          representation: { kind: "proofOnly" as const, reason: "factToken" },
          origin,
        },
      ],
      (value) => value.valueId,
    ),
  };
}

function runtimeValueFunction(
  function_: ProofMirFunction,
  runtimeValueId: ReturnType<typeof proofMirValueId>,
): ProofMirFunction {
  const proofType = coreCheckedType(coreTypeId("bool")) as MonoCheckedType;
  return {
    ...function_,
    values: table(
      [
        ...function_.values.entries(),
        proofMirRuntimeValue(runtimeValueId, proofType, function_.origin),
      ],
      (value) => value.valueId,
    ),
  };
}

function placeWithRuntimeValueFunction(
  function_: ProofMirFunction,
  placeId: ReturnType<typeof proofMirPlaceId>,
  runtimeValueId: ReturnType<typeof proofMirValueId>,
): ProofMirFunction {
  const valueType = coreCheckedType(coreTypeId("u8")) as MonoCheckedType;
  return {
    ...runtimeValueFunction(function_, runtimeValueId),
    places: table(
      [
        ...function_.places.entries(),
        {
          placeId,
          root: { kind: "runtimeTemporary" as const, valueId: runtimeValueId },
          projection: [],
          type: valueType,
          resourceKind: "Copy" as never,
          origin: function_.origin,
        },
      ],
      (place) => place.placeId,
    ),
  };
}

function validatedBufferReadFunction(function_: ProofMirFunction): ProofMirFunction {
  const entryBlock = function_.blocks.get(function_.entryBlockId) ?? function_.blocks.entries()[0];
  if (entryBlock === undefined) {
    return function_;
  }
  const result = proofMirValueId(9501);
  const bufferInstanceId = function_.functionInstanceId;
  const payloadFieldId = fieldId(9501);
  const sourcePlace = proofMirPlaceId(9501);
  const offsetTermId = proofMirLayoutTermId(9501);
  const endTermId = proofMirLayoutTermId(9502);
  const byteType = coreCheckedType(coreTypeId("u8")) as MonoCheckedType;
  const readStatement = {
    statementId: proofMirStatementId(9501),
    kind: {
      kind: "readValidatedBufferField" as const,
      read: {
        sourcePlace,
        validatedBufferInstanceId: bufferInstanceId,
        fieldId: payloadFieldId,
        layoutField: {
          kind: "validatedBufferField" as const,
          instanceId: bufferInstanceId,
          fieldId: payloadFieldId,
        },
        offsetTerm: {
          termId: offsetTermId,
          unit: "byteOffset" as const,
          path: {
            root: {
              kind: "validatedBufferFieldTerm" as const,
              instanceId: bufferInstanceId,
              fieldId: payloadFieldId,
              slot: "offset" as const,
            },
            childPath: [],
          },
        },
        endTerm: {
          termId: endTermId,
          unit: "byteLength" as const,
          path: {
            root: {
              kind: "validatedBufferFieldTerm" as const,
              instanceId: bufferInstanceId,
              fieldId: payloadFieldId,
              slot: "end" as const,
            },
            childPath: [],
          },
        },
        termBindings: [proofMirLayoutTermBindingId(9501)],
        readRequires: [proofMirFactId(9501)],
        result,
        origin: entryBlock.origin,
      },
    },
    origin: entryBlock.origin,
  };
  const rewrittenEntryBlock = {
    ...entryBlock,
    statements: [...entryBlock.statements, readStatement],
  };
  return {
    ...replaceFunctionBlock(function_, rewrittenEntryBlock),
    values: table(
      [...function_.values.entries(), proofMirRuntimeValue(result, byteType, entryBlock.origin)],
      (value) => value.valueId,
    ),
    places: table(
      [
        ...function_.places.entries(),
        {
          placeId: sourcePlace,
          root: { kind: "runtimeTemporary" as const, valueId: result },
          projection: [],
          type: byteType,
          resourceKind: "Copy" as never,
          origin: entryBlock.origin,
        },
      ],
      (place) => place.placeId,
    ),
  };
}

function replaceFunctionBlock(
  function_: ProofMirFunction,
  replacementBlock: ProofMirBlock,
): ProofMirFunction {
  return {
    ...function_,
    blocks: table(
      function_.blocks
        .entries()
        .map((block) => (block.blockId === replacementBlock.blockId ? replacementBlock : block)),
      (block) => block.blockId,
    ),
  };
}

function proofMirRuntimeValue(
  valueId: ReturnType<typeof proofMirValueId>,
  type: MonoCheckedType,
  origin: ProofMirValue["origin"],
): ProofMirValue {
  return {
    valueId,
    type,
    resourceKind: "Copy" as never,
    representation: { kind: "runtime" },
    origin,
  };
}

function mapFirstFunction(
  checkedMir: CheckedMirProgram,
  mapper: (function_: ProofMirFunction) => ProofMirFunction,
): CheckedMirProgram {
  let mapped = false;
  return {
    ...checkedMir,
    mir: {
      ...checkedMir.mir,
      functions: table(
        checkedMir.mir.functions.entries().map((function_) => {
          if (mapped) {
            return function_;
          }
          mapped = true;
          return mapper(function_);
        }),
        (function_) => function_.functionInstanceId,
      ),
    },
  };
}

function table<LookupId, Entry>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => LookupId,
): {
  readonly get: (lookupId: LookupId) => Entry | undefined;
  readonly has: (lookupId: LookupId) => boolean;
  readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
  readonly lookupKeyOf: (lookupId: LookupId) => ProofMirCanonicalKey;
  readonly entries: () => readonly Entry[];
} {
  const byId = new Map(entries.map((entry) => [idOf(entry), entry] as const));
  return {
    get: (lookupId) => byId.get(lookupId),
    has: (lookupId) => byId.has(lookupId),
    keyOf: (entry) => proofMirCanonicalKey(String(idOf(entry))),
    lookupKeyOf: (lookupId) => proofMirCanonicalKey(String(lookupId)),
    entries: () => entries.slice(),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { kind: "bigint", value: value.toString() };
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => stableJson(left[0]).localeCompare(stableJson(right[0])));
  }
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }
  return value;
}
