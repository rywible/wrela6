import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirLengthDelimitedField } from "../canonicalization/canonical-order";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";

export type ProofMirSsaKey =
  | { readonly kind: "local"; readonly localKey: ProofMirCanonicalKey }
  | { readonly kind: "fact"; readonly factKey: ProofMirCanonicalKey };

export type ProofMirSsaParameterKind = "copyScalar" | "proofFact";

export interface DraftProofMirBlockParameterBinding {
  readonly ssaKey: ProofMirSsaKey;
  readonly valueKey: ProofMirCanonicalKey;
  readonly parameterKind: ProofMirSsaParameterKind;
  readonly complete: boolean;
  readonly predeclared: boolean;
}

export interface CreateProofMirGraphSsaInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
}

export interface ProofMirGraphSsa {
  createEntryParameters(input: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly copyScalarParameters: readonly {
      readonly ssaKey: ProofMirSsaKey;
      readonly valueKey: ProofMirCanonicalKey;
    }[];
  }): void;
  registerBlock(blockKey: ProofMirCanonicalKey, input?: { readonly sealed?: boolean }): void;
  sealBlock(blockKey: ProofMirCanonicalKey): void;
  declareLoopHeaderParameters(input: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly parameters: readonly {
      readonly ssaKey: ProofMirSsaKey;
      readonly valueKey: ProofMirCanonicalKey;
      readonly parameterKind: ProofMirSsaParameterKind;
    }[];
  }): void;
  defineScalar(input: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly ssaKey: ProofMirSsaKey;
    readonly valueKey: ProofMirCanonicalKey;
  }): void;
  readScalar(input: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly ssaKey: ProofMirSsaKey;
  }): ProofMirCanonicalKey | undefined;
  registerPredecessorEdge(input: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly edgeKey: ProofMirCanonicalKey;
    readonly argumentKeysBySsaKey?: Readonly<Record<string, ProofMirCanonicalKey>>;
    readonly fromBlockKey?: ProofMirCanonicalKey;
  }): void;
  setEdgeArguments(input: {
    readonly edgeKey: ProofMirCanonicalKey;
    readonly argumentKeys: readonly ProofMirCanonicalKey[];
  }): void;
  blockParameters(blockKey: ProofMirCanonicalKey): readonly DraftProofMirBlockParameterBinding[];
  edgeArgumentKeys(edgeKey: ProofMirCanonicalKey): readonly ProofMirCanonicalKey[];
  diagnostics(): readonly ProofMirDiagnostic[];
}

interface BlockState {
  readonly blockKey: ProofMirCanonicalKey;
  sealed: boolean;
  currentDefinitions: Map<string, ProofMirCanonicalKey>;
  parameters: DraftProofMirBlockParameterBinding[];
  incompleteParameters: Map<string, ProofMirCanonicalKey>;
  predeclaredKeys: Set<string>;
  predecessorEdges: ProofMirCanonicalKey[];
}

interface PredecessorEdgeState {
  readonly edgeKey: ProofMirCanonicalKey;
  readonly targetBlockKey: ProofMirCanonicalKey;
  readonly fromBlockKey?: ProofMirCanonicalKey;
  argumentKeysBySsaKey: Map<string, ProofMirCanonicalKey>;
  orderedArgumentKeys: ProofMirCanonicalKey[];
}

export function proofMirSsaLocalKey(localKey: ProofMirCanonicalKey): ProofMirSsaKey {
  return { kind: "local", localKey };
}

export function proofMirSsaFactKey(factKey: ProofMirCanonicalKey): ProofMirSsaKey {
  return { kind: "fact", factKey };
}

export function proofMirSsaKeyString(ssaKey: ProofMirSsaKey): string {
  switch (ssaKey.kind) {
    case "local":
      return `local:${String(ssaKey.localKey)}`;
    case "fact":
      return `fact:${String(ssaKey.factKey)}`;
    default: {
      const unreachable: never = ssaKey;
      return unreachable;
    }
  }
}

function proofMirSsaKeyFromString(ssaKeyString: string): ProofMirSsaKey | undefined {
  if (ssaKeyString.startsWith("local:")) {
    return {
      kind: "local",
      localKey: proofMirCanonicalKey(ssaKeyString.slice("local:".length)),
    };
  }
  if (ssaKeyString.startsWith("fact:")) {
    return {
      kind: "fact",
      factKey: proofMirCanonicalKey(ssaKeyString.slice("fact:".length)),
    };
  }
  return undefined;
}

function ssaParameterKindForKey(ssaKey: ProofMirSsaKey): ProofMirSsaParameterKind {
  switch (ssaKey.kind) {
    case "local":
      return "copyScalar";
    case "fact":
      return "proofFact";
    default: {
      const unreachable: never = ssaKey;
      return unreachable;
    }
  }
}

function blockParameterValueKey(
  blockKey: ProofMirCanonicalKey,
  ssaKey: ProofMirSsaKey,
): ProofMirCanonicalKey {
  return proofMirCanonicalKey(
    `ssa|block:${proofMirLengthDelimitedField("block", String(blockKey))}|${proofMirSsaKeyString(ssaKey)}`,
  );
}

export function createProofMirGraphSsa(input: CreateProofMirGraphSsaInput): ProofMirGraphSsa {
  const diagnostics: ProofMirDiagnostic[] = [];
  const blocks = new Map<ProofMirCanonicalKey, BlockState>();
  const edges = new Map<ProofMirCanonicalKey, PredecessorEdgeState>();

  function recordInvalidSsa(stableDetail: string): void {
    diagnostics.push(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_SSA",
        message: "Invalid Proof MIR SSA construction.",
        ownerKey: input.ownerKey,
        rootCauseKey: "ssa",
        stableDetail,
        functionInstanceId: input.functionInstanceId,
      }),
    );
  }

  function requireBlock(blockKey: ProofMirCanonicalKey): BlockState {
    const state = blocks.get(blockKey);
    if (state === undefined) {
      throw new RangeError(`Unknown Proof MIR SSA block key: ${String(blockKey)}.`);
    }
    return state;
  }

  function findParameter(
    state: BlockState,
    ssaKeyString: string,
  ): DraftProofMirBlockParameterBinding | undefined {
    return state.parameters.find(
      (parameter) => proofMirSsaKeyString(parameter.ssaKey) === ssaKeyString,
    );
  }

  function ensureIncompleteParameter(
    state: BlockState,
    ssaKey: ProofMirSsaKey,
  ): ProofMirCanonicalKey {
    const ssaKeyString = proofMirSsaKeyString(ssaKey);
    const predeclared = findParameter(state, ssaKeyString);
    if (predeclared !== undefined) {
      return predeclared.valueKey;
    }

    const existing = state.incompleteParameters.get(ssaKeyString);
    if (existing !== undefined) {
      return existing;
    }

    const valueKey = blockParameterValueKey(state.blockKey, ssaKey);
    state.incompleteParameters.set(ssaKeyString, valueKey);
    addBlockParameter(state, ssaKey, valueKey, { predeclared: false, complete: false });
    return valueKey;
  }

  function addBlockParameter(
    state: BlockState,
    ssaKey: ProofMirSsaKey,
    valueKey: ProofMirCanonicalKey,
    parameterInput: { readonly predeclared: boolean; readonly complete: boolean },
  ): ProofMirCanonicalKey {
    const ssaKeyString = proofMirSsaKeyString(ssaKey);
    const existing = findParameter(state, ssaKeyString);
    if (existing !== undefined) {
      return existing.valueKey;
    }
    state.parameters.push({
      ssaKey,
      valueKey,
      parameterKind: ssaParameterKindForKey(ssaKey),
      complete: parameterInput.complete,
      predeclared: parameterInput.predeclared,
    });
    return valueKey;
  }

  function valueAtEndOfPredecessor(
    fromBlockKey: ProofMirCanonicalKey,
    ssaKey: ProofMirSsaKey,
  ): ProofMirCanonicalKey | undefined {
    const source = blocks.get(fromBlockKey);
    if (source === undefined) {
      return undefined;
    }
    const ssaKeyString = proofMirSsaKeyString(ssaKey);
    const current = source.currentDefinitions.get(ssaKeyString);
    if (current !== undefined) {
      return current;
    }
    if (source.sealed) {
      return readFromPredecessors(source, ssaKey);
    }
    const parameter = findParameter(source, ssaKeyString);
    return parameter?.valueKey;
  }

  function readFromPredecessors(
    state: BlockState,
    ssaKey: ProofMirSsaKey,
  ): ProofMirCanonicalKey | undefined {
    const ssaKeyString = proofMirSsaKeyString(ssaKey);
    const predecessorValues: ProofMirCanonicalKey[] = [];

    for (const edgeKey of state.predecessorEdges) {
      const edge = edges.get(edgeKey);
      if (edge === undefined) {
        continue;
      }
      const explicit = edge.argumentKeysBySsaKey.get(ssaKeyString);
      if (explicit !== undefined) {
        predecessorValues.push(explicit);
        continue;
      }
      if (edge.fromBlockKey !== undefined) {
        const sourceValue = valueAtEndOfPredecessor(edge.fromBlockKey, ssaKey);
        if (sourceValue !== undefined) {
          predecessorValues.push(sourceValue);
        }
      }
    }

    if (predecessorValues.length === 0) {
      return undefined;
    }
    const first = predecessorValues[0]!;
    if (predecessorValues.every((value) => value === first)) {
      return first;
    }
    return undefined;
  }

  function markParameterComplete(
    state: BlockState,
    parameter: DraftProofMirBlockParameterBinding,
  ): void {
    const parameterIndex = state.parameters.findIndex(
      (candidate) => candidate.valueKey === parameter.valueKey,
    );
    if (parameterIndex >= 0) {
      state.parameters[parameterIndex] = {
        ...state.parameters[parameterIndex]!,
        complete: true,
      };
    }
  }

  function syncOrderedEdgeArguments(state: BlockState): void {
    for (const edgeKey of state.predecessorEdges) {
      const edge = edges.get(edgeKey);
      if (edge === undefined) {
        continue;
      }
      edge.orderedArgumentKeys = state.parameters
        .map((parameter) => {
          const argument = edge.argumentKeysBySsaKey.get(proofMirSsaKeyString(parameter.ssaKey));
          return argument;
        })
        .filter((argument): argument is ProofMirCanonicalKey => argument !== undefined);
    }
  }

  function completeIncompleteParameters(state: BlockState): void {
    for (const [ssaKeyString, valueKey] of state.incompleteParameters.entries()) {
      const parameter = findParameter(state, ssaKeyString);
      if (parameter === undefined) {
        continue;
      }

      if (state.predecessorEdges.length === 0) {
        recordInvalidSsa(`missing-predecessors:${String(state.blockKey)}:${ssaKeyString}`);
        continue;
      }

      const predecessorValues: ProofMirCanonicalKey[] = [];
      let missingArgument = false;
      for (const edgeKey of state.predecessorEdges) {
        const edge = edges.get(edgeKey);
        if (edge === undefined) {
          missingArgument = true;
          continue;
        }
        const explicit = edge.argumentKeysBySsaKey.get(ssaKeyString);
        if (explicit === undefined) {
          recordInvalidSsa(
            `missing-arguments:${String(state.blockKey)}:${String(edgeKey)}:${ssaKeyString}`,
          );
          missingArgument = true;
          continue;
        }
        predecessorValues.push(explicit);
      }

      if (missingArgument || predecessorValues.length !== state.predecessorEdges.length) {
        continue;
      }

      const first = predecessorValues[0]!;
      const needsParameter = !predecessorValues.every((candidate) => candidate === first);
      if (needsParameter) {
        markParameterComplete(state, parameter);
        syncOrderedEdgeArguments(state);
      } else {
        removeBlockParameter(state, ssaKeyString);
        state.incompleteParameters.delete(ssaKeyString);
      }

      void valueKey;
    }
  }

  function writeEdgeArgumentsForParameter(
    state: BlockState,
    parameter: DraftProofMirBlockParameterBinding,
  ): void {
    const ssaKeyString = proofMirSsaKeyString(parameter.ssaKey);
    for (const edgeKey of state.predecessorEdges) {
      const edge = edges.get(edgeKey);
      if (edge === undefined) {
        continue;
      }
      let incoming = edge.argumentKeysBySsaKey.get(ssaKeyString);
      if (incoming === undefined && edge.fromBlockKey !== undefined) {
        incoming = valueAtEndOfPredecessor(edge.fromBlockKey, parameter.ssaKey);
      }
      if (incoming === undefined) {
        continue;
      }
      edge.argumentKeysBySsaKey.set(ssaKeyString, incoming);
      const ordered = state.parameters.map((candidate) => {
        const existing = edge.argumentKeysBySsaKey.get(proofMirSsaKeyString(candidate.ssaKey));
        return existing;
      });
      edge.orderedArgumentKeys = ordered.filter(
        (candidate): candidate is ProofMirCanonicalKey => candidate !== undefined,
      );
    }
  }

  function removeBlockParameter(state: BlockState, ssaKeyString: string): void {
    state.parameters = state.parameters.filter(
      (parameter) => proofMirSsaKeyString(parameter.ssaKey) !== ssaKeyString,
    );
  }

  function createJoinParametersOnSeal(state: BlockState): void {
    const ssaKeys = new Set<string>();
    for (const edgeKey of state.predecessorEdges) {
      const edge = edges.get(edgeKey);
      if (edge === undefined) {
        continue;
      }
      for (const ssaKeyString of edge.argumentKeysBySsaKey.keys()) {
        ssaKeys.add(ssaKeyString);
      }
    }

    for (const ssaKeyString of ssaKeys) {
      if (state.incompleteParameters.has(ssaKeyString) || findParameter(state, ssaKeyString)) {
        continue;
      }
      const ssaKey = proofMirSsaKeyFromString(ssaKeyString);
      if (ssaKey === undefined) {
        continue;
      }
      const merged = readFromPredecessors(state, ssaKey);
      if (merged === undefined) {
        const valueKey = blockParameterValueKey(state.blockKey, ssaKey);
        addBlockParameter(state, ssaKey, valueKey, { predeclared: false, complete: true });
        const joinParameter = findParameter(state, ssaKeyString);
        if (joinParameter !== undefined) {
          writeEdgeArgumentsForParameter(state, joinParameter);
        }
      }
    }
  }

  return {
    createEntryParameters(parameterInput) {
      const state = requireBlock(parameterInput.blockKey);
      for (const parameter of parameterInput.copyScalarParameters) {
        const ssaKeyString = proofMirSsaKeyString(parameter.ssaKey);
        state.currentDefinitions.set(ssaKeyString, parameter.valueKey);
        addBlockParameter(state, parameter.ssaKey, parameter.valueKey, {
          predeclared: true,
          complete: true,
        });
        state.predeclaredKeys.add(ssaKeyString);
      }
    },

    registerBlock(blockKey, blockInput) {
      if (blocks.has(blockKey)) {
        return;
      }
      blocks.set(blockKey, {
        blockKey,
        sealed: blockInput?.sealed ?? false,
        currentDefinitions: new Map(),
        parameters: [],
        incompleteParameters: new Map(),
        predeclaredKeys: new Set(),
        predecessorEdges: [],
      });
    },

    declareLoopHeaderParameters(parameterInput) {
      const state = requireBlock(parameterInput.blockKey);
      for (const parameter of parameterInput.parameters) {
        const ssaKeyString = proofMirSsaKeyString(parameter.ssaKey);
        state.predeclaredKeys.add(ssaKeyString);
        state.currentDefinitions.set(ssaKeyString, parameter.valueKey);
        addBlockParameter(state, parameter.ssaKey, parameter.valueKey, {
          predeclared: true,
          complete: true,
        });
      }
    },

    defineScalar(defineInput) {
      const state = requireBlock(defineInput.blockKey);
      const ssaKeyString = proofMirSsaKeyString(defineInput.ssaKey);
      if (state.currentDefinitions.has(ssaKeyString)) {
        recordInvalidSsa(`duplicate-definition:${String(defineInput.blockKey)}:${ssaKeyString}`);
        return;
      }
      state.currentDefinitions.set(ssaKeyString, defineInput.valueKey);
    },

    readScalar(readInput) {
      const state = requireBlock(readInput.blockKey);
      const ssaKeyString = proofMirSsaKeyString(readInput.ssaKey);
      const current = state.currentDefinitions.get(ssaKeyString);
      if (current !== undefined) {
        return current;
      }

      const existingParameter = findParameter(state, ssaKeyString);
      if (existingParameter !== undefined) {
        return existingParameter.valueKey;
      }

      if (!state.sealed) {
        return ensureIncompleteParameter(state, readInput.ssaKey);
      }

      const reused = readFromPredecessors(state, readInput.ssaKey);
      if (reused !== undefined) {
        return reused;
      }

      const valueKey = blockParameterValueKey(state.blockKey, readInput.ssaKey);
      addBlockParameter(state, readInput.ssaKey, valueKey, {
        predeclared: false,
        complete: true,
      });
      const joinParameter = findParameter(state, ssaKeyString);
      if (joinParameter !== undefined) {
        writeEdgeArgumentsForParameter(state, joinParameter);
      }
      return valueKey;
    },

    registerPredecessorEdge(edgeInput) {
      const state = requireBlock(edgeInput.blockKey);
      if (!state.predecessorEdges.includes(edgeInput.edgeKey)) {
        state.predecessorEdges.push(edgeInput.edgeKey);
      }
      const argumentKeysBySsaKey = new Map<string, ProofMirCanonicalKey>();
      if (edgeInput.argumentKeysBySsaKey !== undefined) {
        for (const [ssaKeyString, valueKey] of Object.entries(edgeInput.argumentKeysBySsaKey)) {
          argumentKeysBySsaKey.set(ssaKeyString, valueKey);
        }
      }
      edges.set(edgeInput.edgeKey, {
        edgeKey: edgeInput.edgeKey,
        targetBlockKey: edgeInput.blockKey,
        ...(edgeInput.fromBlockKey === undefined ? {} : { fromBlockKey: edgeInput.fromBlockKey }),
        argumentKeysBySsaKey,
        orderedArgumentKeys: [],
      });
    },

    setEdgeArguments(argumentInput) {
      const edge = edges.get(argumentInput.edgeKey);
      if (edge === undefined) {
        throw new RangeError(`Unknown Proof MIR SSA edge key: ${String(argumentInput.edgeKey)}.`);
      }
      edge.orderedArgumentKeys = [...argumentInput.argumentKeys];
    },

    sealBlock(blockKey) {
      const state = requireBlock(blockKey);
      if (state.sealed) {
        if (state.incompleteParameters.size > 0) {
          recordInvalidSsa(`incomplete-after-seal:${String(blockKey)}`);
        }
        return;
      }

      completeIncompleteParameters(state);
      createJoinParametersOnSeal(state);

      if (state.incompleteParameters.size > 0) {
        recordInvalidSsa(`incomplete-after-seal:${String(blockKey)}`);
      }

      for (const parameter of state.parameters) {
        if (!parameter.complete) {
          recordInvalidSsa(
            `incomplete-parameter:${String(blockKey)}:${proofMirSsaKeyString(parameter.ssaKey)}`,
          );
        }
      }

      state.incompleteParameters.clear();
      state.sealed = true;
    },

    blockParameters(blockKey) {
      return requireBlock(blockKey).parameters.slice();
    },

    edgeArgumentKeys(edgeKey) {
      const edge = edges.get(edgeKey);
      if (edge === undefined) {
        return [];
      }
      return edge.orderedArgumentKeys.slice();
    },

    diagnostics() {
      return sortProofMirDiagnostics(diagnostics);
    },
  };
}
