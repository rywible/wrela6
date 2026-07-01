import type { OptIrFactRecord } from "../../../opt-ir/facts/fact-index";
import type { OptIrOperationId } from "../../../opt-ir/ids";
import type { OptIrOperation } from "../../../opt-ir/operations";
import { aarch64Diagnostic, type AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import { aarch64SelectionPatternById } from "../select/pattern-catalog";
import { prepareAArch64SemanticSuperselectionState } from "../select/semantic-superselector";
import { aarch64OperationSupportForKind } from "../target-surface/operation-matrix";
import type { AArch64OperationSupportContract, AArch64LoweringState } from "./pipeline-stages";

export type AArch64OperationSupportContractResult =
  | {
      readonly kind: "ok";
      readonly contracts: ReadonlyMap<number, AArch64OperationSupportContract>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };

export function verifyAArch64OperationSupportContractsForState(
  state: AArch64LoweringState,
): AArch64OperationSupportContractResult {
  const preparedState = prepareAArch64SemanticSuperselectionState(state);
  const semanticSupport = semanticSupportForState(preparedState);
  if (semanticSupport.kind === "error") {
    return { kind: "error", diagnostics: semanticSupport.diagnostics };
  }
  const contracts = new Map<number, AArch64OperationSupportContract>();
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const operation of [...state.operations.values()].sort(
    (left, right) => Number(left.operationId) - Number(right.operationId),
  )) {
    const contract = operationSupportContractForOperation({
      state: preparedState,
      operation,
      semanticSupportByOperationId: semanticSupport.supportByOperationId,
    });
    if (contract.kind === "error") {
      diagnostics.push(...contract.diagnostics);
      continue;
    }
    contracts.set(Number(operation.operationId), contract.contract);
  }
  return diagnostics.length === 0
    ? { kind: "ok", contracts: freezeContractMap(contracts) }
    : { kind: "error", diagnostics: Object.freeze(diagnostics) };
}

function operationSupportContractForOperation(input: {
  readonly state: AArch64LoweringState;
  readonly operation: OptIrOperation;
  readonly semanticSupportByOperationId: ReadonlyMap<
    number,
    { readonly patternIds: readonly string[]; readonly factsUsed: readonly number[] }
  >;
}):
  | { readonly kind: "ok"; readonly contract: AArch64OperationSupportContract }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  const support = aarch64OperationSupportForKind(input.operation.kind);
  const base = {
    operationId: Number(input.operation.operationId),
    operationKind: input.operation.kind,
    status: support.status,
  };
  switch (support.status) {
    case "required":
      return {
        kind: "ok",
        contract: Object.freeze({
          ...base,
          authorization: "required",
          factsUsed: [],
          helperPatternIds: [],
          explanation: [`operation-matrix:required:${input.operation.kind}`],
        }),
      };
    case "profile-rejected":
      return operationMismatch(
        input.operation,
        `operation-matrix:profile-rejected:${input.operation.kind}`,
      );
    case "unsupported-until-layout-lowering":
      return operationMismatch(
        input.operation,
        `operation-matrix:unsupported-until-layout-lowering:${String(input.operation.operationId)}:${input.operation.kind}:layout-facts`,
      );
    case "unreachable-after-optir":
      return {
        kind: "error",
        diagnostics: [
          aarch64Diagnostic({
            code: "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
            ownerKey: `operation:${String(input.operation.operationId)}`,
            rootCauseKey: `operation-kind:${input.operation.kind}`,
            stableDetail: `operation-matrix:unreachable-after-optir:${String(input.operation.operationId)}:${input.operation.kind}`,
          }),
        ],
      };
    case "fact-gated":
      return factGatedContract({
        state: input.state,
        operation: input.operation,
        base,
        fallback: support.fallback,
      });
    case "helper-lowered":
      return helperLoweredContract({
        operation: input.operation,
        base,
        catalogRequirement: support.catalogRequirement,
        semanticSupportByOperationId: input.semanticSupportByOperationId,
      });
  }
}

function factGatedContract(input: {
  readonly state: AArch64LoweringState;
  readonly operation: OptIrOperation;
  readonly base: Pick<AArch64OperationSupportContract, "operationId" | "operationKind" | "status">;
  readonly fallback: "scalar-addressing" | "scalar-helper" | "architectural-scalar";
}):
  | { readonly kind: "ok"; readonly contract: AArch64OperationSupportContract }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  if (input.operation.kind === "memoryLoad" || input.operation.kind === "memoryStore") {
    return {
      kind: "ok",
      contract: Object.freeze({
        ...input.base,
        authorization: "fact-gated-fallback",
        factsUsed: [],
        helperPatternIds: [],
        explanation: [`operation-matrix:fact-gated:fallback:${input.fallback}`],
      }),
    };
  }

  const factFamily = factFamilyForFactGatedOperation(input.operation.kind);
  const factIds = factFamily.idsFor(input.state, input.operation);
  if (factIds.length === 0) {
    return operationMismatch(
      input.operation,
      `operation-matrix:fact-gated:missing-fact:${String(input.operation.operationId)}:${input.operation.kind}:${factFamily.extensionKey}`,
    );
  }
  return {
    kind: "ok",
    contract: Object.freeze({
      ...input.base,
      authorization: "fact-gated-fact",
      factsUsed: factIds,
      helperPatternIds: [],
      explanation: [
        `operation-matrix:fact-gated:fact:${input.operation.kind}:${factFamily.extensionKey}`,
      ],
    }),
  };
}

function helperLoweredContract(input: {
  readonly operation: OptIrOperation;
  readonly base: Pick<AArch64OperationSupportContract, "operationId" | "operationKind" | "status">;
  readonly catalogRequirement:
    | "source-call-lowering"
    | "runtime-helper-symbol"
    | "platform-abi-symbol"
    | "intrinsic-helper-symbol";
  readonly semanticSupportByOperationId: ReadonlyMap<
    number,
    { readonly patternIds: readonly string[]; readonly factsUsed: readonly number[] }
  >;
}):
  | { readonly kind: "ok"; readonly contract: AArch64OperationSupportContract }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  if (isCallOperation(input.operation)) {
    return {
      kind: "ok",
      contract: Object.freeze({
        ...input.base,
        authorization: "helper-catalog",
        factsUsed: [],
        helperPatternIds: [],
        explanation: [
          `operation-matrix:helper-lowered:call:${input.catalogRequirement}`,
          `operation-matrix:helper-target:${callTargetKey(input.operation)}`,
        ],
      }),
    };
  }
  const support = input.semanticSupportByOperationId.get(Number(input.operation.operationId));
  if (support === undefined || support.patternIds.length === 0) {
    return operationMismatch(
      input.operation,
      `operation-matrix:helper-lowered:missing-helper:${String(input.operation.operationId)}:${input.operation.kind}:${input.catalogRequirement}`,
    );
  }
  return {
    kind: "ok",
    contract: Object.freeze({
      ...input.base,
      authorization: "semantic-plugin",
      factsUsed: support.factsUsed,
      helperPatternIds: support.patternIds,
      explanation: [
        `operation-matrix:helper-lowered:semantic:${input.catalogRequirement}`,
        ...support.patternIds.map((patternId) => `semantic-helper:${patternId}`),
      ],
    }),
  };
}

function semanticSupportForState(state: AArch64LoweringState):
  | {
      readonly kind: "ok";
      readonly supportByOperationId: ReadonlyMap<
        number,
        { readonly patternIds: readonly string[]; readonly factsUsed: readonly number[] }
      >;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  if (state.semanticDispatchDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: state.semanticDispatchDiagnostics.map((stableDetail) =>
        aarch64Diagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: "semantic-superselection",
          rootCauseKey: "semantic-plugin-dispatch",
          stableDetail,
        }),
      ),
    };
  }
  const operationsById = new Map(
    [...state.operations.values()].map((operation) => [Number(operation.operationId), operation]),
  );
  const byOperationId = new Map<number, { patternIds: string[]; factsUsed: number[] }>();
  const factsById = new Map(state.facts.records.map((record) => [Number(record.factId), record]));
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const candidate of state.semanticCandidates) {
    const manifest = aarch64SelectionPatternById(candidate.patternId);
    if (manifest === undefined) {
      return {
        kind: "error",
        diagnostics: [
          aarch64Diagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: "semantic-superselection",
            rootCauseKey: "semantic-plugin-dispatch",
            stableDetail: `semantic-candidate:unknown-manifest:${candidate.patternId}`,
          }),
        ],
      };
    }
    if (candidate.consumedOperations.length === 0) {
      diagnostics.push(
        aarch64Diagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: candidate.patternId,
          rootCauseKey: candidate.patternId,
          stableDetail: "semantic-boundary:empty-consumed-operations",
        }),
      );
      continue;
    }
    for (const operationId of candidate.consumedOperations) {
      const operation = operationsById.get(operationId);
      if (operation === undefined) {
        diagnostics.push(
          aarch64Diagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `semantic-boundary:missing-consumed-operation:${operationId}`,
          }),
        );
        continue;
      }
      if (!manifest.coveredOperationKinds.includes(operation.kind)) {
        diagnostics.push(
          aarch64Diagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `semantic-boundary:operation-kind-mismatch:${operationId}:${operation.kind}`,
          }),
        );
        continue;
      }
      const factValidation = validateSemanticCandidateFacts({
        candidate,
        factIds: candidate.factsUsed ?? [],
        factsById,
        manifestRequiredFacts: manifest.requiredFacts,
      });
      if (factValidation.length > 0) {
        diagnostics.push(
          ...factValidation.map((stableDetail) =>
            aarch64Diagnostic({
              code: "AARCH64_SUPERSELECTION_INVALID",
              ownerKey: candidate.patternId,
              rootCauseKey: `operation:${operationId}`,
              stableDetail,
            }),
          ),
        );
        continue;
      }
      const existing = byOperationId.get(operationId) ?? { patternIds: [], factsUsed: [] };
      existing.patternIds.push(candidate.patternId);
      existing.factsUsed.push(...(candidate.factsUsed ?? []));
      byOperationId.set(operationId, existing);
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: Object.freeze(diagnostics) };
  }
  return {
    kind: "ok",
    supportByOperationId: new Map(
      [...byOperationId.entries()].map(([operationId, support]) => [
        operationId,
        Object.freeze({
          patternIds: Object.freeze([...new Set(support.patternIds)].sort()),
          factsUsed: Object.freeze(
            [...new Set(support.factsUsed)].sort((left, right) => left - right),
          ),
        }),
      ]),
    ),
  };
}

function validateSemanticCandidateFacts(input: {
  readonly candidate: { readonly patternId: string };
  readonly factIds: readonly number[];
  readonly factsById: ReadonlyMap<number, OptIrFactRecord>;
  readonly manifestRequiredFacts: readonly string[];
}): readonly string[] {
  const diagnostics: string[] = [];
  for (const requiredFact of input.manifestRequiredFacts) {
    if (
      !input.factIds.some((factId) =>
        semanticFactFamilyMatches(input.factsById.get(factId), requiredFact),
      )
    ) {
      diagnostics.push(
        `semantic-boundary:missing-required-fact:${input.candidate.patternId}:${requiredFact}`,
      );
    }
  }
  return Object.freeze(diagnostics);
}

function semanticFactFamilyMatches(
  fact: OptIrFactRecord | undefined,
  requiredFact: string,
): boolean {
  if (fact === undefined) return false;
  if (fact.extensionKey === requiredFact) return true;
  if (requiredFact === "semantic-contract" && fact.extensionKey === "semantic-operation") {
    return true;
  }
  return false;
}

function factFamilyForFactGatedOperation(operationKind: string): {
  readonly extensionKey: string;
  readonly idsFor: (state: AArch64LoweringState, operation: OptIrOperation) => readonly number[];
} {
  if (operationKind.startsWith("vector")) {
    return { extensionKey: "vector-state", idsFor: vectorFactIdsForOperation };
  }
  if (operationKind === "fpNumeric") {
    return {
      extensionKey: "fp-numeric",
      idsFor: (state, operation) => operationFactIds(state, operation.operationId, "fp-numeric"),
    };
  }
  if (operationKind === "semanticRegionMarker") {
    return {
      extensionKey: "semantic-operation",
      idsFor: (state, operation) =>
        operationFactIds(state, operation.operationId, "semantic-operation"),
    };
  }
  return {
    extensionKey: "memory-order",
    idsFor: (state, operation) => operationFactIds(state, operation.operationId, "memory-order"),
  };
}

function vectorFactIdsForOperation(
  state: AArch64LoweringState,
  operation: OptIrOperation,
): readonly number[] {
  const functionIds = functionIdsForOperation(state, operation.operationId);
  return factIds(
    state.facts.records.filter(
      (fact) =>
        fact.extensionKey === "vector-state" &&
        (subjectOperationId(fact) === Number(operation.operationId) ||
          (subjectFunctionId(fact) !== undefined &&
            functionIds.has(subjectFunctionId(fact) as number))),
    ),
  );
}

function operationFactIds(
  state: AArch64LoweringState,
  operationId: OptIrOperationId,
  extensionKey: string,
): readonly number[] {
  return factIds(
    state.facts.records.filter(
      (fact) =>
        fact.extensionKey === extensionKey && subjectOperationId(fact) === Number(operationId),
    ),
  );
}

function factIds(records: readonly OptIrFactRecord[]): readonly number[] {
  return Object.freeze(
    records.map((record) => Number(record.factId)).sort((left, right) => left - right),
  );
}

function subjectOperationId(fact: OptIrFactRecord): number | undefined {
  return fact.subject.kind === "operation" ? Number(fact.subject.operationId) : undefined;
}

function subjectFunctionId(fact: OptIrFactRecord): number | undefined {
  return fact.subject.kind === "optIrFunction" ? Number(fact.subject.functionId) : undefined;
}

function functionIdsForOperation(
  state: AArch64LoweringState,
  operationId: OptIrOperationId,
): ReadonlySet<number> {
  const functionIds = new Set<number>();
  for (const sourceFunction of state.program.functions.entries()) {
    if (
      sourceFunction.blocks.some((block) =>
        block.operations.some((candidate) => candidate === operationId),
      )
    ) {
      functionIds.add(Number(sourceFunction.functionId));
    }
  }
  return functionIds;
}

function isCallOperation(
  operation: OptIrOperation,
): operation is Extract<
  OptIrOperation,
  { readonly kind: "sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall" }
> {
  return (
    operation.kind === "sourceCall" ||
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  );
}

function callTargetKey(operation: Extract<OptIrOperation, { readonly target: unknown }>): string {
  const target = operation.target;
  if (target.kind === "source") return `source:${String(target.functionInstanceId)}`;
  if (target.kind === "runtime") return `runtime:${target.runtimeKey}`;
  if (target.kind === "platform") return `platform:${target.platformKey}`;
  if (target.kind === "intrinsic") return `intrinsic:${target.intrinsicKey}`;
  return "unknown";
}

function operationMismatch(
  operation: OptIrOperation,
  stableDetail: string,
): { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  return {
    kind: "error",
    diagnostics: [
      aarch64Diagnostic({
        code: "AARCH64_OPERATION_TARGET_MISMATCH",
        ownerKey: `operation:${String(operation.operationId)}`,
        rootCauseKey: `operation-kind:${operation.kind}`,
        stableDetail,
      }),
    ],
  };
}

function freezeContractMap(
  contracts: ReadonlyMap<number, AArch64OperationSupportContract>,
): ReadonlyMap<number, AArch64OperationSupportContract> {
  return new Map(
    [...contracts.entries()].map(([operationId, contract]) => [
      operationId,
      Object.freeze({
        ...contract,
        factsUsed: Object.freeze([...contract.factsUsed]),
        helperPatternIds: Object.freeze([...contract.helperPatternIds]),
        explanation: Object.freeze([...contract.explanation]),
      }),
    ]),
  );
}
