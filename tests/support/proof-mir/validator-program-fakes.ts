import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirFactId,
  proofMirLoanId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirCall,
  ProofMirBlock,
  ProofMirBlockParameter,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirLoanReference,
  ProofMirPlace,
  ProofMirScope,
  ProofMirStatement,
  ProofMirTerminator,
  ProofMirTerminatorKind,
  ProofMirValue,
} from "../../../src/proof-mir/model/graph";
import type {
  ProofMirCallArgument,
  ProofMirCallReceiver,
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
} from "../../../src/proof-mir/model/operands";
import type { ProofMirValidatorProgram } from "../../../src/proof-mir/validation/graph-validator";
import { functionId, itemId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";

export const VALIDATOR_FUNCTION_INSTANCE_ID = monoInstanceId("fn:validator-test");

export function validatorOrigin(note = "test"): ReturnType<typeof proofMirOriginId> {
  return proofMirOriginId(note.length);
}

function emptySignature(): MonoFunctionSignature {
  return {
    functionId: functionId(0),
    itemId: itemId(0),
    parameters: [],
    returnType: { kind: "primitive", name: "unit" } as never,
    returnKind: "Copy",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}

function deterministicTable<LookupId, Entry>(
  prefix: string,
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
  lookupKeyOf: (id: LookupId) => string,
) {
  const result = proofMirDeterministicTable<LookupId, Entry>({
    entries,
    keyOf: (entry) => proofMirCanonicalKey(`${prefix}:${keyOf(entry)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`${prefix}:${lookupKeyOf(id)}`),
    normalizePayload: (entry) => JSON.stringify(entry),
  });
  if (result.kind !== "ok") {
    throw new Error(`${prefix} table failed`);
  }
  return result.table;
}

export interface ValidatorFunctionFakeInput {
  readonly functionInstanceId?: ReturnType<typeof monoInstanceId>;
  readonly entryBlockId?: ReturnType<typeof proofMirBlockId>;
  readonly blocks?: readonly ProofMirBlock[];
  readonly edges?: readonly ProofMirControlEdge[];
  readonly values?: readonly ProofMirValue[];
  readonly scopes?: readonly ProofMirScope[];
  readonly places?: readonly ProofMirPlace[];
  readonly exits?: readonly ProofMirExitEdge[];
  readonly statements?: readonly ProofMirStatement[];
  readonly terminator?: ProofMirTerminator;
}

export function proofMirValidatorFunctionFake(
  input: ValidatorFunctionFakeInput = {},
): ProofMirFunction {
  const origin = validatorOrigin();
  const functionInstanceId = input.functionInstanceId ?? VALIDATOR_FUNCTION_INSTANCE_ID;
  const entryBlockId = input.entryBlockId ?? proofMirBlockId(0);
  const scopeId = proofMirScopeId(0);
  const defaultTerminator: ProofMirTerminator = input.terminator ?? {
    terminatorId: proofMirTerminatorId(0),
    kind: { kind: "unreachable", reason: "unreachableSource" },
    outgoingEdges: [],
    origin,
  };
  const defaultBlock: ProofMirBlock = {
    blockId: entryBlockId,
    scopeId,
    parameters: [],
    statements: input.statements ?? [],
    terminator: defaultTerminator,
    incomingEdges: [],
    origin,
  };
  const blocks = input.blocks ?? [defaultBlock];
  const edges = input.edges ?? [];
  const values = input.values ?? [];
  const scopes = input.scopes ?? [
    {
      scopeId,
      kind: "function",
      ownedLocals: [],
      openedObligations: [],
      openedSessionMembers: [],
      origin,
    } satisfies ProofMirScope,
  ];
  const places = input.places ?? [];
  const exits = input.exits ?? [];

  return {
    functionInstanceId,
    sourceFunctionId: functionId(0),
    signature: emptySignature(),
    entryBlockId,
    blocks: deterministicTable(
      "block",
      blocks,
      (block) => String(block.blockId),
      (id) => String(id),
    ),
    edges: deterministicTable(
      "edge",
      edges,
      (edge) => String(edge.edgeId),
      (id) => String(id),
    ),
    values: deterministicTable(
      "value",
      values,
      (value) => String(value.valueId),
      (id) => String(id),
    ),
    locals: deterministicTable(
      "local",
      [],
      () => "",
      () => "",
    ),
    places: deterministicTable(
      "place",
      places,
      (place) => String(place.placeId),
      (id) => String(id),
    ),
    scopes: deterministicTable(
      "scope",
      scopes,
      (scope) => String(scope.scopeId),
      (id) => String(id),
    ),
    exits,
    origin,
  };
}

export function proofMirValidatorProgramFake(
  functions: readonly ProofMirFunction[],
): ProofMirValidatorProgram {
  return { functions };
}

export function proofMirBlockParameterFake(input: {
  readonly valueId?: ReturnType<typeof proofMirValueId>;
  readonly parameterKind?: ProofMirBlockParameter["parameterKind"];
}): ProofMirBlockParameter {
  return {
    valueId: input.valueId ?? proofMirValueId(0),
    type: { kind: "primitive", name: "u8" } as never,
    parameterKind: input.parameterKind ?? { kind: "copyScalar", resourceKind: "Copy" },
    origin: validatorOrigin("parameter"),
  };
}

export function proofMirValueFake(input: {
  readonly valueId: ReturnType<typeof proofMirValueId>;
  readonly resourceKind?: ProofMirValue["resourceKind"];
  readonly representation?: ProofMirValue["representation"];
}): ProofMirValue {
  return {
    valueId: input.valueId,
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: input.resourceKind ?? "Copy",
    representation: input.representation ?? { kind: "runtime" },
    origin: validatorOrigin(`value:${String(input.valueId)}`),
  };
}

export function proofMirControlEdgeFake(input: {
  readonly edgeId: ReturnType<typeof proofMirControlEdgeId>;
  readonly fromBlockId: ReturnType<typeof proofMirBlockId>;
  readonly toBlockId?: ReturnType<typeof proofMirBlockId>;
  readonly arguments?: readonly ReturnType<typeof proofMirValueId>[];
  readonly crossedScopes?: readonly ReturnType<typeof proofMirScopeId>[];
  readonly exit?: ReturnType<typeof proofMirExitEdgeId>;
  readonly kind?: ProofMirControlEdge["kind"];
}): ProofMirControlEdge {
  return {
    edgeId: input.edgeId,
    fromBlockId: input.fromBlockId,
    ...(input.toBlockId === undefined ? {} : { toBlockId: input.toBlockId }),
    kind: input.kind ?? "normal",
    arguments: input.arguments ?? [],
    facts: [],
    effects: [],
    crossedScopes: input.crossedScopes ?? [],
    ...(input.exit === undefined ? {} : { exit: input.exit }),
    origin: validatorOrigin(`edge:${String(input.edgeId)}`),
  };
}

export function proofMirExitEdgeFake(input: {
  readonly exitId: ReturnType<typeof proofMirExitEdgeId>;
  readonly fromBlockId: ReturnType<typeof proofMirBlockId>;
  readonly kind?: ProofMirExitEdge["kind"];
  readonly crossedScopes?: readonly ReturnType<typeof proofMirScopeId>[];
}): ProofMirExitEdge {
  return {
    exitId: input.exitId,
    fromBlockId: input.fromBlockId,
    kind: input.kind ?? "ordinaryReturn",
    boundary: { kind: "function", unwind: "none" },
    crossedScopes: input.crossedScopes ?? [],
    closure: {
      kind: "functionExit",
      requireNoLiveLoans: true,
      requireNoOpenObligations: true,
      requireNoLiveSessionMembers: true,
      requireNoPendingValidationResults: true,
      terminalReachability: "notRequired",
    },
    origin: validatorOrigin(`exit:${String(input.exitId)}`),
  };
}

export function proofMirCallFake(input: {
  readonly receiver?: ProofMirCallReceiver;
  readonly arguments?: readonly ProofMirCallArgument[];
}): ProofMirCall {
  return {
    callId: proofMirCallId(0),
    target: {
      kind: "sourceFunction",
      functionInstanceId: VALIDATOR_FUNCTION_INSTANCE_ID,
      abi: {
        kind: "functionAbi",
        functionInstanceId: VALIDATOR_FUNCTION_INSTANCE_ID,
      },
    },
    ...(input.receiver === undefined ? {} : { receiver: input.receiver }),
    arguments: input.arguments ?? [],
    requirements: [],
    origin: validatorOrigin("call"),
  };
}

export interface ProofMirProgramWithCallOperandForTestInput {
  readonly mode: "observe" | "consume";
  readonly operand: ProofMirObservedOperand | ProofMirConsumedOperand;
  readonly receiver?: boolean;
}

function validatorTablesForOperand(operand: ProofMirObservedOperand | ProofMirConsumedOperand): {
  readonly values: readonly ProofMirValue[];
  readonly places: readonly ProofMirPlace[];
} {
  switch (operand.kind) {
    case "value":
      return {
        values: [proofMirValueFake({ valueId: operand.value })],
        places: [],
      };
    case "place":
      return {
        values: [],
        places: [proofMirPlaceFake({ placeId: operand.place })],
      };
    case "valueAndPlace":
      return {
        values: [proofMirValueFake({ valueId: operand.value })],
        places: [proofMirPlaceFake({ placeId: operand.place })],
      };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function proofMirProgramWithCallOperandForTest(
  input: ProofMirProgramWithCallOperandForTestInput,
): ProofMirValidatorProgram {
  const origin = validatorOrigin("call-operand");
  const call = proofMirCallFake({
    ...(input.receiver
      ? {
          receiver:
            input.mode === "consume"
              ? {
                  mode: "consume" as const,
                  operand: input.operand as ProofMirConsumedOperand,
                  origin,
                }
              : {
                  mode: "observe" as const,
                  operand: input.operand as ProofMirObservedOperand,
                  origin,
                },
        }
      : {}),
    arguments: [
      input.mode === "consume"
        ? {
            mode: "consume" as const,
            operand: input.operand as ProofMirConsumedOperand,
            origin,
          }
        : {
            mode: "observe" as const,
            operand: input.operand as ProofMirObservedOperand,
            origin,
          },
    ],
  });
  const operandTables = validatorTablesForOperand(input.operand);
  const functionGraph = proofMirValidatorFunctionFake({
    statements: [
      {
        statementId: proofMirStatementId(0),
        kind: { kind: "call", call },
        origin,
      },
    ],
    values: [...operandTables.values],
    places: [...operandTables.places],
  });
  return proofMirValidatorProgramFake([functionGraph]);
}

export function proofMirPlaceFake(input: Pick<ProofMirPlace, "placeId">): ProofMirPlace {
  return {
    placeId: input.placeId,
    root: { kind: "temporary", ordinal: 0 },
    projection: [],
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    origin: validatorOrigin(`place:${String(input.placeId)}`),
  };
}

export function proofMirLoanReferenceFake(
  input: Partial<ProofMirLoanReference> & Pick<ProofMirLoanReference, "loanId">,
): ProofMirLoanReference {
  return {
    mode: input.mode ?? "shared",
    placeId: input.placeId ?? proofMirPlaceId(0),
    scopeId: input.scopeId ?? proofMirScopeId(0),
    startOrigin: input.startOrigin ?? validatorOrigin("loan-start"),
    ...(input.endOrigin === undefined ? {} : { endOrigin: input.endOrigin }),
    loanId: input.loanId,
  };
}

export function proofMirScopeFake(input: {
  readonly scopeId: ReturnType<typeof proofMirScopeId>;
  readonly parentScopeId?: ReturnType<typeof proofMirScopeId>;
  readonly kind?: ProofMirScope["kind"];
}): ProofMirScope {
  return {
    scopeId: input.scopeId,
    ...(input.parentScopeId === undefined ? {} : { parentScopeId: input.parentScopeId }),
    kind: input.kind ?? "block",
    ownedLocals: [],
    openedObligations: [],
    openedSessionMembers: [],
    origin: validatorOrigin(`scope:${String(input.scopeId)}`),
  };
}

export function proofMirTerminatorFake(kind: ProofMirTerminatorKind): ProofMirTerminator {
  return {
    terminatorId: proofMirTerminatorId(0),
    kind,
    outgoingEdges: [],
    origin: validatorOrigin("terminator"),
  };
}

export function proofMirFactIdForTest(value = 0): ReturnType<typeof proofMirFactId> {
  return proofMirFactId(value);
}

export function proofMirLoanIdForTest(value = 0): ReturnType<typeof proofMirLoanId> {
  return proofMirLoanId(value);
}
