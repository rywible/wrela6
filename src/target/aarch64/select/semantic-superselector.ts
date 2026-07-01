import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";
import { checksumFingerprintPlugin } from "./checksum-fingerprint-selection";
import { classifierSelectionPlugin } from "./classifier-selection";
import { cryptoMixPlugin } from "./crypto-mix-selection";
import { packetZeroCopyPlugin } from "./packet-superpatterns";
import { aarch64SelectionPatternById, AARCH64_SELECTION_PATTERN_CATALOG } from "./pattern-catalog";
import { polynomialPmullPlugin } from "./polynomial-pmull-selection";
import { tailProofSelectionPlugin } from "./tail-proof-selection";
import { virtioRingSelectionPlugin } from "./virtio-ring-selection";

export interface AArch64SemanticCandidate {
  readonly patternId: string;
  readonly consumedOperations: readonly number[];
  readonly liveOuts: readonly string[];
  readonly effects: readonly string[];
  readonly factsUsed?: readonly number[];
}

export interface AArch64SemanticPluginFactInput {
  readonly factId: number;
  readonly extensionKey: string;
  readonly packetKind: string;
  readonly subjectKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AArch64SemanticPluginOperationInput {
  readonly operationId: number;
  readonly kind: string;
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly facts: readonly AArch64SemanticPluginFactInput[];
  readonly profileFeatures: readonly string[];
  readonly vectorPolicy: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
  readonly secretTableIndex: boolean;
  readonly constantTimeTable: boolean;
}

export interface AArch64SemanticPluginInput {
  readonly operations: readonly AArch64SemanticPluginOperationInput[];
  readonly constantTime?: boolean;
  readonly constantTimeTable?: boolean;
  readonly explicitFamily?: boolean;
  readonly finiteAlphabet?: boolean;
  readonly hasCompleteFootprint?: boolean;
  readonly hasFootprint?: boolean;
  readonly hasMemoryOrder?: boolean;
  readonly hasTailSlackFact?: boolean;
  readonly namedChecksum?: boolean;
  readonly polynomial?: string;
  readonly secretTableIndex?: boolean;
}

export interface AArch64SemanticPlugin {
  readonly pluginKey: string;
  readonly candidatesFor: (
    input: AArch64SemanticPluginInput,
  ) => readonly AArch64SemanticCandidate[];
}

export function dispatchAArch64SemanticPlugins(input: {
  readonly plugins: readonly AArch64SemanticPlugin[];
  readonly pluginInput: AArch64SemanticPluginInput;
}): {
  readonly candidates: readonly AArch64SemanticCandidate[];
  readonly diagnostics: readonly string[];
} {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const candidates: AArch64SemanticCandidate[] = [];
  for (const plugin of [...input.plugins].sort((left, right) =>
    left.pluginKey.localeCompare(right.pluginKey),
  )) {
    if (seen.has(plugin.pluginKey)) {
      diagnostics.push(`semantic-plugin:duplicate:${plugin.pluginKey}`);
      continue;
    }
    seen.add(plugin.pluginKey);
    for (const candidate of plugin.candidatesFor(input.pluginInput)) {
      if (aarch64SelectionPatternById(candidate.patternId) === undefined) {
        diagnostics.push(`semantic-candidate:unknown-manifest:${candidate.patternId}`);
      }
      candidates.push(candidate);
    }
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    diagnostics: Object.freeze(diagnostics.sort()),
  });
}

export function runAArch64SemanticSuperselectionStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  const preparedState = prepareAArch64SemanticSuperselectionState(state);
  const explanations = Object.freeze(
    [
      "semantic-superselection:plugins-dispatched",
      ...preparedState.semanticCandidates.map(
        (candidate) => `semantic-candidate:${candidate.patternId}`,
      ),
      ...preparedState.semanticDispatchDiagnostics,
    ].sort(),
  );
  return appendAArch64SelectionRecord(preparedState, {
    stageKey: "semantic-superselection",
    subjectKey: "program",
    patternId: "semantic.dispatch",
    tier: "semantic",
    factsUsed: uniqueSortedNumbers(
      preparedState.semanticCandidates.flatMap((candidate) => candidate.factsUsed ?? []),
    ),
    emittedOpcodes: [],
    explanation: explanations,
  });
}

export function prepareAArch64SemanticSuperselectionState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  if (hasPreparedSemanticSuperselection(state)) {
    return state;
  }
  const dispatch = dispatchAArch64SemanticPlugins({
    plugins: state.options.semanticPlugins ?? defaultAArch64SemanticPlugins(),
    pluginInput: semanticPluginInputForAArch64LoweringState(state),
  });
  const semanticCandidates = Object.freeze(
    dispatch.candidates.map((candidate) => normalizeSemanticCandidate(candidate)),
  );
  const semanticManifestLiveOuts = semanticManifestLiveOutsFromCatalog();
  return Object.freeze({
    ...state,
    semanticCandidates,
    semanticDispatchDiagnostics: dispatch.diagnostics,
    semanticManifestLiveOuts,
  });
}

function hasPreparedSemanticSuperselection(state: AArch64LoweringState): boolean {
  return (
    state.semanticCandidates.length > 0 ||
    state.semanticDispatchDiagnostics.length > 0 ||
    Object.keys(state.semanticManifestLiveOuts).length > 0
  );
}

export function defaultAArch64SemanticPlugins(): readonly AArch64SemanticPlugin[] {
  return Object.freeze([
    checksumFingerprintPlugin,
    classifierSelectionPlugin,
    cryptoMixPlugin,
    packetZeroCopyPlugin,
    polynomialPmullPlugin,
    tailProofSelectionPlugin,
    virtioRingSelectionPlugin,
  ]);
}

export function semanticPluginInputForAArch64LoweringState(
  state: AArch64LoweringState,
): AArch64SemanticPluginInput {
  const extensionKeys = new Set(state.facts.records.map((record) => record.extensionKey));
  const operationKinds = new Set([...state.operations.values()].map((operation) => operation.kind));
  const securityFacts = semanticSecurityFacts(state);
  const operations = [...state.operations.values()].map((operation) => {
    const sourceValueIds = sourceValueIdsForOperation(operation);
    const factRecords = semanticFactInputsForOperation(state, operation, sourceValueIds);
    return Object.freeze({
      operationId: Number(operation.operationId),
      kind: operation.kind,
      semanticContract: semanticContractForOperation(operation),
      facts: factRecords,
      profileFeatures: Object.freeze(["BASE_A64", ...state.target.profile.requiredFeatures].sort()),
      vectorPolicy: vectorPolicyForSemanticOperation(state, operation),
      secretTableIndex: classifierOperationHasSecretTableIndex(sourceValueIds, securityFacts),
      constantTimeTable: classifierOperationHasConstantTimeAuthorization(
        operation,
        sourceValueIds,
        securityFacts,
      ),
    } satisfies AArch64SemanticPluginOperationInput);
  });
  return Object.freeze({
    constantTime: extensionKeys.has("security"),
    constantTimeTable: classifierTableHasConstantTimeAuthorization(state, securityFacts),
    explicitFamily: operationKinds.has("semanticCryptoMix"),
    finiteAlphabet: operationKinds.has("semanticClassifier"),
    hasCompleteFootprint: extensionKeys.has("footprint"),
    hasFootprint: extensionKeys.has("footprint"),
    hasMemoryOrder: extensionKeys.has("memory-order"),
    hasTailSlackFact: extensionKeys.has("footprint"),
    namedChecksum: operationKinds.has("semanticChecksum"),
    polynomial: operationKinds.has("semanticPolynomial") ? "pmull" : undefined,
    secretTableIndex: classifierHasSecretTableIndex(state, securityFacts),
    operations: Object.freeze(operations),
  });
}

interface AArch64SemanticSecurityFacts {
  readonly secretSubjectKeys: ReadonlySet<string>;
  readonly constantTimeSubjectKeys: ReadonlySet<string>;
}

function semanticSecurityFacts(state: AArch64LoweringState): AArch64SemanticSecurityFacts {
  const secretSubjectKeys = new Set<string>();
  const constantTimeSubjectKeys = new Set<string>();
  for (const fact of state.facts.records) {
    if (fact.extensionKey !== "security") continue;
    const labels = securityLabels(fact.extensionPayload);
    if (labels.includes("secret")) {
      secretSubjectKeys.add(fact.subjectKey);
    }
    if (labels.includes("constantTimeRequired") || securityConstantTime(fact.extensionPayload)) {
      constantTimeSubjectKeys.add(fact.subjectKey);
    }
  }
  return Object.freeze({
    secretSubjectKeys,
    constantTimeSubjectKeys,
  });
}

function classifierHasSecretTableIndex(
  state: AArch64LoweringState,
  securityFacts: AArch64SemanticSecurityFacts,
): boolean {
  return [...state.operations.values()]
    .filter((operation) => operation.kind === "semanticClassifier")
    .some((operation) =>
      classifierOperationHasSecretTableIndex(sourceValueIdsForOperation(operation), securityFacts),
    );
}

function classifierTableHasConstantTimeAuthorization(
  state: AArch64LoweringState,
  securityFacts: AArch64SemanticSecurityFacts,
): boolean {
  return [...state.operations.values()]
    .filter((operation) => operation.kind === "semanticClassifier")
    .some((operation) =>
      classifierOperationHasConstantTimeAuthorization(
        operation,
        sourceValueIdsForOperation(operation),
        securityFacts,
      ),
    );
}

function classifierOperationHasSecretTableIndex(
  sourceValueIds: readonly number[],
  securityFacts: AArch64SemanticSecurityFacts,
): boolean {
  return sourceValueIds
    .slice(1)
    .some((valueId) => securityFacts.secretSubjectKeys.has(`value:${valueId}`));
}

function classifierOperationHasConstantTimeAuthorization(
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
  sourceValueIds: readonly number[],
  securityFacts: AArch64SemanticSecurityFacts,
): boolean {
  return [
    `operation:${Number(operation.operationId)}`,
    ...sourceValueIds.map((valueId) => `value:${valueId}`),
  ].some((subjectKey) => securityFacts.constantTimeSubjectKeys.has(subjectKey));
}

function sourceValueIdsForOperation(
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): readonly number[] {
  if (!("sourceValueIds" in operation) || !Array.isArray(operation.sourceValueIds)) {
    return [];
  }
  return operation.sourceValueIds.map(Number);
}

function resultValueIdsForOperation(
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): readonly number[] {
  if (!("resultIds" in operation) || !Array.isArray(operation.resultIds)) {
    return [];
  }
  return operation.resultIds.map(Number);
}

function semanticFactInputsForOperation(
  state: AArch64LoweringState,
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
  sourceValueIds: readonly number[],
): readonly AArch64SemanticPluginFactInput[] {
  const subjectKeys = new Set<string>([
    `operation:${Number(operation.operationId)}`,
    ...sourceValueIds.map((valueId) => `value:${valueId}`),
    ...resultValueIdsForOperation(operation).map((valueId) => `value:${valueId}`),
    ...regionIdsForOperation(operation).map((regionId) => `region:${regionId}`),
    ...functionIdsForOperation(state, operation).map((functionId) => `function:${functionId}`),
  ]);
  return Object.freeze(
    state.facts.records
      .filter((fact) => fact.extensionKey !== undefined && subjectKeys.has(fact.subjectKey))
      .map((fact) =>
        Object.freeze({
          factId: Number(fact.factId),
          extensionKey: fact.extensionKey ?? "",
          packetKind: fact.extensionPacketKind ?? "",
          subjectKey: fact.subjectKey,
          payload: extensionPayload(fact),
        }),
      )
      .sort((left, right) => left.factId - right.factId),
  );
}

function regionIdsForOperation(
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): readonly number[] {
  const regionIds: number[] = [];
  if ("memoryAccess" in operation && typeof operation.memoryAccess === "object") {
    regionIds.push(Number(operation.memoryAccess.region));
  }
  const contract = semanticContractForOperation(operation);
  if (typeof contract.regionId === "number") {
    regionIds.push(contract.regionId);
  }
  if (typeof contract.region === "number") {
    regionIds.push(contract.region);
  }
  return Object.freeze([...new Set(regionIds)].sort((left, right) => left - right));
}

function functionIdsForOperation(
  state: AArch64LoweringState,
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): readonly number[] {
  return Object.freeze(
    state.program.functions
      .entries()
      .filter((sourceFunction) =>
        sourceFunction.blocks.some((block) =>
          block.operations.some((operationId) => operationId === operation.operationId),
        ),
      )
      .map((sourceFunction) => Number(sourceFunction.functionId))
      .sort((left, right) => left - right),
  );
}

function vectorPolicyForSemanticOperation(
  state: AArch64LoweringState,
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): AArch64SemanticPluginOperationInput["vectorPolicy"] {
  const operationPolicy = state.facts.records.find(
    (fact) =>
      fact.extensionKey === "vector-state" &&
      fact.extensionPacketKind === "vector-state-policy" &&
      fact.subjectKey === `operation:${Number(operation.operationId)}`,
  );
  const functionPolicy = functionIdsForOperation(state, operation)
    .map((functionId) =>
      state.facts.records.find(
        (fact) =>
          fact.extensionKey === "vector-state" &&
          fact.extensionPacketKind === "vector-state-policy" &&
          fact.subjectKey === `function:${functionId}`,
      ),
    )
    .find((fact) => fact !== undefined);
  return (
    asVectorPolicy(extensionPayload(operationPolicy).mode) ??
    asVectorPolicy(extensionPayload(functionPolicy).mode) ??
    "ownsVectorState"
  );
}

function securityLabels(payload: unknown): readonly string[] {
  if (!isRecord(payload) || !Array.isArray(payload.labels)) {
    return [];
  }
  return Object.freeze(
    payload.labels.filter((label): label is string => typeof label === "string"),
  );
}

function securityConstantTime(payload: unknown): boolean {
  return isRecord(payload) && payload.constantTime === true;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function semanticContractForOperation(
  operation: AArch64LoweringState["operations"] extends ReadonlyMap<unknown, infer Operation>
    ? Operation
    : never,
): Readonly<Record<string, unknown>> {
  return "semanticContract" in operation &&
    operation.semanticContract !== undefined &&
    typeof operation.semanticContract === "object"
    ? operation.semanticContract
    : {};
}

function extensionPayload(
  record: { readonly extensionPayload?: unknown } | undefined,
): Readonly<Record<string, unknown>> {
  return record?.extensionPayload !== undefined &&
    typeof record.extensionPayload === "object" &&
    record.extensionPayload !== null
    ? (record.extensionPayload as Readonly<Record<string, unknown>>)
    : {};
}

function asVectorPolicy(
  value: unknown,
): AArch64SemanticPluginOperationInput["vectorPolicy"] | undefined {
  return value === "scalarOnly" || value === "ownsVectorState" || value === "callsVectorHelper"
    ? value
    : undefined;
}

function semanticManifestLiveOutsFromCatalog(): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      AARCH64_SELECTION_PATTERN_CATALOG.filter((pattern) => pattern.tier === "semantic").map(
        (pattern) => [String(pattern.patternId), pattern.declaredLiveOuts],
      ),
    ),
  );
}

function normalizeSemanticCandidate(candidate: AArch64SemanticCandidate): AArch64SemanticCandidate {
  const manifest = aarch64SelectionPatternById(candidate.patternId);
  if (manifest === undefined) {
    return Object.freeze({
      ...candidate,
      consumedOperations: Object.freeze([...candidate.consumedOperations]),
      liveOuts: Object.freeze([...candidate.liveOuts]),
      effects: Object.freeze([...candidate.effects]),
      factsUsed: Object.freeze(uniqueSortedNumbers(candidate.factsUsed ?? [])),
    });
  }
  return Object.freeze({
    ...candidate,
    consumedOperations: Object.freeze([...candidate.consumedOperations]),
    liveOuts: Object.freeze([...candidate.liveOuts]),
    effects: Object.freeze([...candidate.effects]),
    factsUsed: Object.freeze(uniqueSortedNumbers(candidate.factsUsed ?? [])),
  });
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left - right));
}
