import { checkedOptIrHandoffFingerprint, type CheckedOptIrHandoff } from "../../../src/proof-check";
import { emptyCheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import {
  checkedFactPacketEntryForTest,
  factImportAuthorityFingerprintForTest,
} from "./fact-import-fixtures";
import { checkedOptIrHandoffForTest } from "./opt-ir-handoff-fixtures";
import {
  authenticatedLayoutFactsForTest,
  constructOptIrInputForTest,
  targetSurfaceForInternalConstructionTest,
} from "./internal-construction-fixtures";
import type { ConstructOptIrInput, ConstructOptIrResult } from "../../../src/opt-ir/public-api";
import type { MonoCheckedType } from "../../../src/mono/mono-hir";
import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import type { ProofMirFunction } from "../../../src/proof-mir/model/program";
import type { ProofMirValue } from "../../../src/proof-mir/model/graph";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import { coreTypeId } from "../../../src/semantic/ids";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirPlaceId,
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
