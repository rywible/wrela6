import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type { OptIrFactId, OptIrOperationId, OptIrOriginId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";

export type OptIrProofErasureSubject =
  | { readonly kind: "value"; readonly valueId: OptIrValueId }
  | { readonly kind: "operation"; readonly operationId: OptIrOperationId };

export interface OptIrProofErasureFact {
  readonly factId: OptIrFactId;
  readonly subject: OptIrProofErasureSubject;
  readonly dependencies: readonly OptIrProofErasureSubject[];
  readonly lineage: OptIrProofErasureFactLineage;
}

export type OptIrProofErasureFactLineage =
  | { readonly kind: "imported" }
  | {
      readonly kind: "proofErasurePreserved";
      readonly sourceFactId: OptIrFactId;
      readonly erasedValueIds: readonly OptIrValueId[];
    };

export interface OptIrErasedValueProvenance {
  readonly valueId: OptIrValueId;
  readonly factIds: readonly OptIrFactId[];
  readonly operationIds: readonly OptIrOperationId[];
  readonly originIds: readonly OptIrOriginId[];
}

export interface OptIrProofErasureProvenance {
  readonly erasedValues: readonly OptIrErasedValueProvenance[];
}

export interface OptIrProofErasureDroppedFact {
  readonly factId: OptIrFactId;
  readonly reason: "missingLineage" | "erasedSubject";
}

export interface EraseProofOnlyOptIrInput {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly facts: readonly OptIrProofErasureFact[];
  readonly factImportCompleted: boolean;
  readonly proofOnlyValueIds: readonly OptIrValueId[];
  readonly proofOnlyOperationIds: readonly OptIrOperationId[];
  readonly proofValueFacts?: readonly (readonly [OptIrValueId, OptIrFactId])[];
}

export type EraseProofOnlyOptIrResult =
  | {
      readonly kind: "ok";
      readonly function: OptIrFunction;
      readonly operations: readonly OptIrOperation[];
      readonly facts: readonly OptIrProofErasureFact[];
      readonly droppedFacts: readonly OptIrProofErasureDroppedFact[];
      readonly provenance: OptIrProofErasureProvenance;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export function eraseProofOnlyOptIrForTest(
  input: EraseProofOnlyOptIrInput,
): EraseProofOnlyOptIrResult {
  return eraseProofOnlyOptIr(input);
}

export function eraseProofOnlyOptIr(input: EraseProofOnlyOptIrInput): EraseProofOnlyOptIrResult {
  if (!input.factImportCompleted) {
    return {
      kind: "error",
      diagnostics: [
        diagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          ownerKey: "proof-erasure",
          rootCauseKey: "fact-import",
          stableDetail: "factImportCompleted:false",
          messageTemplate: "Proof erasure requires imported OptIR facts.",
        }),
      ],
    };
  }

  const erasedValues = new Set(input.proofOnlyValueIds);
  const erasedOperations = new Set(input.proofOnlyOperationIds);
  const remainingOperations = input.operations.filter(
    (operation) => !erasedOperations.has(operation.operationId),
  );
  const executableUseDiagnostics = executableErasedValueUseDiagnostics(
    input.function,
    remainingOperations,
    erasedValues,
  );
  if (executableUseDiagnostics.length > 0) {
    return { kind: "error", diagnostics: sortOptIrDiagnostics(executableUseDiagnostics) };
  }

  const functionOutput = removeOperationsFromFunction(input.function, erasedOperations);
  const lineage = proofErasureLineageIndex({
    facts: input.facts,
    proofOnlyValueIds: input.proofOnlyValueIds,
    proofValueFacts: input.proofValueFacts,
  });
  const factResult = preserveFactsThroughErasure(input.facts, erasedValues, lineage);

  return Object.freeze({
    kind: "ok",
    function: functionOutput,
    operations: Object.freeze(remainingOperations),
    facts: factResult.facts,
    droppedFacts: factResult.droppedFacts,
    provenance: Object.freeze({
      erasedValues: Object.freeze(erasedValueProvenance(input, lineage)),
    }),
  });
}

function executableErasedValueUseDiagnostics(
  functionInput: OptIrFunction,
  operations: readonly OptIrOperation[],
  erasedValues: ReadonlySet<OptIrValueId>,
): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  for (const operation of [...operations].sort(compareOperations)) {
    for (const operandId of operation.operandIds) {
      if (!erasedValues.has(operandId)) {
        continue;
      }
      diagnostics.push(
        diagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          ownerKey: `operation:${operation.operationId}`,
          rootCauseKey: "erased-value-use",
          stableDetail: `operation:${operation.operationId}:operand:${operandId}`,
          messageTemplate: "Executable OptIR operation depends on an erased proof-only value.",
        }),
      );
    }
  }
  for (const block of [...functionInput.blocks].sort(
    (left, right) => left.blockId - right.blockId,
  )) {
    const terminator = block.terminator;
    if (terminator !== undefined) {
      for (const valueId of terminatorValueIds(terminator)) {
        if (!erasedValues.has(valueId)) {
          continue;
        }
        diagnostics.push(
          diagnostic({
            code: "OPT_IR_INPUT_CONTRACT_INVALID",
            ownerKey: `terminator:${terminator.operationId}`,
            rootCauseKey: "erased-value-use",
            stableDetail: `terminator:${terminator.operationId}:value:${valueId}`,
            messageTemplate: "Executable OptIR terminator depends on an erased proof-only value.",
          }),
        );
      }
    }
  }
  for (const edge of functionInput.edges.entries()) {
    for (const argumentId of edge.arguments) {
      if (!erasedValues.has(argumentId)) {
        continue;
      }
      diagnostics.push(
        diagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          ownerKey: `edge:${edge.edgeId}`,
          rootCauseKey: "erased-value-use",
          stableDetail: `edge:${edge.edgeId}:argument:${argumentId}`,
          messageTemplate: "Executable OptIR edge argument depends on an erased proof-only value.",
        }),
      );
    }
    if (edge.condition !== undefined && erasedValues.has(edge.condition)) {
      diagnostics.push(
        diagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          ownerKey: `edge:${edge.edgeId}`,
          rootCauseKey: "erased-value-use",
          stableDetail: `edge:${edge.edgeId}:condition:${edge.condition}`,
          messageTemplate: "Executable OptIR edge condition depends on an erased proof-only value.",
        }),
      );
    }
  }
  return diagnostics;
}

function terminatorValueIds(
  terminator: NonNullable<OptIrFunction["blocks"][number]["terminator"]>,
): readonly OptIrValueId[] {
  switch (terminator.kind) {
    case "branch":
      return [terminator.condition];
    case "switch":
      return [terminator.scrutinee];
    case "return":
      return terminator.values;
    case "jump":
    case "unreachable":
      return [];
  }
}

function removeOperationsFromFunction(
  functionInput: OptIrFunction,
  erasedOperations: ReadonlySet<OptIrOperationId>,
): OptIrFunction {
  return Object.freeze({
    ...functionInput,
    blocks: Object.freeze(
      functionInput.blocks.map((block) =>
        Object.freeze({
          ...block,
          operations: Object.freeze(
            block.operations.filter((operationId) => !erasedOperations.has(operationId)),
          ),
        }),
      ),
    ),
  });
}

export function runProofErasureFactPreservation(input: {
  readonly facts: readonly OptIrProofErasureFact[];
  readonly erasedValueIds: readonly OptIrValueId[];
  readonly proofOnlyValueIds: readonly OptIrValueId[];
  readonly proofValueFacts?: readonly (readonly [OptIrValueId, OptIrFactId])[];
}): {
  readonly facts: readonly OptIrProofErasureFact[];
  readonly droppedFacts: readonly OptIrProofErasureDroppedFact[];
} {
  const erasedValues = new Set(input.erasedValueIds);
  const lineage = proofErasureLineageIndex({
    facts: input.facts,
    proofOnlyValueIds: input.proofOnlyValueIds,
    proofValueFacts: input.proofValueFacts,
  });
  return preserveFactsThroughErasure(input.facts, erasedValues, lineage);
}

export function mergeProofErasureProvenances(
  parts: readonly OptIrProofErasureProvenance[],
): OptIrProofErasureProvenance {
  return Object.freeze({
    erasedValues: Object.freeze(
      parts
        .flatMap((part) => part.erasedValues)
        .sort((left, right) => left.valueId - right.valueId),
    ),
  });
}

export function proofErasureLineageIndex(input: {
  readonly facts: readonly OptIrProofErasureFact[];
  readonly proofOnlyValueIds: readonly OptIrValueId[];
  readonly proofValueFacts?: readonly (readonly [OptIrValueId, OptIrFactId])[];
}): ReadonlyMap<OptIrValueId, readonly OptIrFactId[]> {
  const proofOnlyValueIds = new Set(input.proofOnlyValueIds);
  const mutable = new Map<OptIrValueId, OptIrFactId[]>();
  for (const [valueId, factId] of input.proofValueFacts ?? []) {
    appendLineageFact(mutable, valueId, factId);
  }

  for (const fact of input.facts) {
    if (fact.subject.kind !== "value") {
      continue;
    }
    if (!proofOnlyValueIds.has(fact.subject.valueId)) {
      continue;
    }
    appendLineageFact(mutable, fact.subject.valueId, fact.factId);
  }

  return new Map(
    [...mutable.entries()].map(([valueId, factIds]) => [
      valueId,
      Object.freeze([...new Set(factIds)].sort(compareNumbers)),
    ]),
  );
}

function appendLineageFact(
  lineage: Map<OptIrValueId, OptIrFactId[]>,
  valueId: OptIrValueId,
  factId: OptIrFactId,
): void {
  const existing = lineage.get(valueId);
  if (existing === undefined) {
    lineage.set(valueId, [factId]);
    return;
  }
  existing.push(factId);
}

function preserveFactsThroughErasure(
  facts: readonly OptIrProofErasureFact[],
  erasedValues: ReadonlySet<OptIrValueId>,
  lineage: ReadonlyMap<OptIrValueId, readonly OptIrFactId[]>,
): {
  readonly facts: readonly OptIrProofErasureFact[];
  readonly droppedFacts: readonly OptIrProofErasureDroppedFact[];
} {
  const preservedFacts: OptIrProofErasureFact[] = [];
  const droppedFacts: OptIrProofErasureDroppedFact[] = [];

  for (const fact of [...facts].sort(compareFacts)) {
    if (fact.subject.kind === "value" && erasedValues.has(fact.subject.valueId)) {
      if ((lineage.get(fact.subject.valueId) ?? []).includes(fact.factId)) {
        preservedFacts.push(freezeFact(fact));
      } else {
        droppedFacts.push(Object.freeze({ factId: fact.factId, reason: "erasedSubject" }));
      }
      continue;
    }

    const erasedDependencies = fact.dependencies.flatMap((dependency) =>
      dependency.kind === "value" && erasedValues.has(dependency.valueId)
        ? [dependency.valueId]
        : [],
    );
    if (erasedDependencies.length === 0) {
      preservedFacts.push(freezeFact(fact));
      continue;
    }

    const uniqueErasedDependencies = [...new Set(erasedDependencies)].sort(compareNumbers);
    const hasLineage = uniqueErasedDependencies.every(
      (valueId) => (lineage.get(valueId) ?? []).length > 0,
    );
    if (!hasLineage) {
      droppedFacts.push(Object.freeze({ factId: fact.factId, reason: "missingLineage" }));
      continue;
    }
    preservedFacts.push(
      freezeFact({
        ...fact,
        lineage: {
          kind: "proofErasurePreserved",
          sourceFactId: fact.factId,
          erasedValueIds: uniqueErasedDependencies,
        },
      }),
    );
  }

  return Object.freeze({
    facts: Object.freeze(preservedFacts),
    droppedFacts: Object.freeze(droppedFacts),
  });
}

function erasedValueProvenance(
  input: EraseProofOnlyOptIrInput,
  lineage: ReadonlyMap<OptIrValueId, readonly OptIrFactId[]>,
): readonly OptIrErasedValueProvenance[] {
  const operationIds = [...input.proofOnlyOperationIds].sort(compareNumbers);
  const operationsById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  return Object.freeze(
    [...input.proofOnlyValueIds].sort(compareNumbers).map((valueId) =>
      Object.freeze({
        valueId,
        factIds: Object.freeze([...(lineage.get(valueId) ?? [])]),
        operationIds: Object.freeze(operationIds),
        originIds: Object.freeze(
          operationIds
            .flatMap((operationId) => {
              const operation = operationsById.get(operationId);
              return operation === undefined ? [] : [operation.originId];
            })
            .sort(compareNumbers),
        ),
      }),
    ),
  );
}

function freezeFact(fact: OptIrProofErasureFact): OptIrProofErasureFact {
  return Object.freeze({
    ...fact,
    subject: Object.freeze({ ...fact.subject }),
    dependencies: Object.freeze(
      fact.dependencies.map((dependency) => Object.freeze({ ...dependency })),
    ),
    lineage: Object.freeze(
      fact.lineage.kind === "proofErasurePreserved"
        ? { ...fact.lineage, erasedValueIds: Object.freeze([...fact.lineage.erasedValueIds]) }
        : { ...fact.lineage },
    ),
  });
}

function diagnostic(input: {
  readonly code: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly messageTemplate: string;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode(input.code);
  return {
    severity: "error",
    code,
    messageTemplate: input.messageTemplate,
    arguments: {},
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "proof-erasure",
      functionKey: "proof-erasure",
      code,
      ownerKey: input.ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}

function compareOperations(left: OptIrOperation, right: OptIrOperation): number {
  return left.operationId - right.operationId;
}

function compareFacts(left: OptIrProofErasureFact, right: OptIrProofErasureFact): number {
  return left.factId - right.factId;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
