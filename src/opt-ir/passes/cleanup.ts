import { optIrCfgEdgeTable } from "../cfg";
import type { OptIrFactId, OptIrOperationId } from "../ids";
import type { OptIrProofErasureFact, OptIrProofErasureSubject } from "../lower/proof-erasure";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import { optIrTerminatorSuccessorEdges } from "../terminators";

export interface OptIrCleanupFactSet {
  readonly records: readonly OptIrProofErasureFact[];
  readonly indexes: OptIrCleanupFactIndexes;
}

export interface OptIrCleanupFactIndexes {
  readonly byId: Readonly<Record<number, OptIrProofErasureFact>>;
  readonly bySubjectKey: Readonly<Record<string, readonly OptIrFactId[]>>;
}

export interface RunConstructionCleanupInput {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly facts: readonly OptIrProofErasureFact[];
  readonly aliases?: readonly (readonly [OptIrProofErasureSubject, OptIrProofErasureSubject])[];
}

export interface RunConstructionCleanupResult {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrCleanupFactSet;
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly removedFactIds: readonly OptIrFactId[];
}

export function runConstructionCleanup(
  input: RunConstructionCleanupInput,
): RunConstructionCleanupResult {
  const removedOperations = new Set(
    input.operations
      .filter((operation) => operation.kind === "proofErasedMarker")
      .map((operation) => operation.operationId),
  );
  const operationIds = new Set(input.operations.map((operation) => operation.operationId));
  const aliasMap = new Map(
    (input.aliases ?? [])
      .filter(([source, target]) => subjectKey(source) !== subjectKey(target))
      .map(([source, target]) => [subjectKey(source), target]),
  );

  const functionOutput = cleanupFunction(input.function, removedOperations);
  const liveOperationIds = new Set(functionOutput.blocks.flatMap((block) => block.operations));
  const operations = Object.freeze(
    input.operations.filter((operation) => liveOperationIds.has(operation.operationId)),
  );
  const facts = cleanupFacts(input.facts, {
    aliasMap,
    liveOperationIds,
    operationIds,
  });
  const factIds = new Set(facts.records.map((record) => record.factId));
  const removedFactIds = input.facts
    .map((fact) => fact.factId)
    .filter((factId) => !factIds.has(factId))
    .sort(compareNumbers);

  return Object.freeze({
    function: functionOutput,
    operations,
    facts,
    removedOperationIds: Object.freeze(
      input.operations
        .map((operation) => operation.operationId)
        .filter((operationId) => !liveOperationIds.has(operationId))
        .sort(compareNumbers),
    ),
    removedFactIds: Object.freeze(removedFactIds),
  });
}

function cleanupFunction(
  functionInput: OptIrFunction,
  removedOperations: ReadonlySet<OptIrOperationId>,
): OptIrFunction {
  const reachableBlocks = reachableBlockIds(functionInput);
  const edges = functionInput.edges
    .entries()
    .filter(
      (edge) =>
        reachableBlocks.has(edge.from) &&
        (edge.toBlock === undefined || reachableBlocks.has(edge.toBlock)),
    );

  return Object.freeze({
    ...functionInput,
    blocks: Object.freeze(
      functionInput.blocks
        .filter((block) => reachableBlocks.has(block.blockId))
        .map((block) =>
          Object.freeze({
            ...block,
            operations: Object.freeze(
              block.operations.filter((operationId) => !removedOperations.has(operationId)),
            ),
          }),
        ),
    ),
    edges: optIrCfgEdgeTable(edges),
  });
}

function reachableBlockIds(functionInput: OptIrFunction) {
  const blocksById = new Map(functionInput.blocks.map((block) => [block.blockId, block]));

  const reachable = new Set([functionInput.entryBlock]);
  const queue = [functionInput.entryBlock];
  while (queue.length > 0) {
    const blockId = queue.shift();
    if (blockId === undefined) {
      continue;
    }
    const block = blocksById.get(blockId);
    if (block?.terminator === undefined) {
      continue;
    }
    for (const edgeId of optIrTerminatorSuccessorEdges(block.terminator)) {
      const edge = functionInput.edges.get(edgeId);
      if (edge === undefined) {
        continue;
      }
      if (edge.toBlock === undefined || reachable.has(edge.toBlock)) {
        continue;
      }
      reachable.add(edge.toBlock);
      queue.push(edge.toBlock);
    }
  }
  return reachable;
}

function cleanupFacts(
  facts: readonly OptIrProofErasureFact[],
  context: {
    readonly aliasMap: ReadonlyMap<string, OptIrProofErasureSubject>;
    readonly liveOperationIds: ReadonlySet<OptIrOperationId>;
    readonly operationIds: ReadonlySet<OptIrOperationId>;
  },
): OptIrCleanupFactSet {
  const records: OptIrProofErasureFact[] = [];
  for (const fact of [...facts].sort((left, right) => left.factId - right.factId)) {
    const subject = remapSubject(context.aliasMap, fact.subject);
    if (
      subject.kind === "operation" &&
      context.operationIds.has(subject.operationId) &&
      !context.liveOperationIds.has(subject.operationId)
    ) {
      continue;
    }
    const dependencies = fact.dependencies
      .map((dependency) => remapSubject(context.aliasMap, dependency))
      .filter((dependency) => {
        if (dependency.kind !== "operation") {
          return true;
        }
        return (
          !context.operationIds.has(dependency.operationId) ||
          context.liveOperationIds.has(dependency.operationId)
        );
      });
    records.push(
      Object.freeze({
        ...fact,
        subject: Object.freeze({ ...subject }),
        dependencies: Object.freeze(
          dependencies.map((dependency) => Object.freeze({ ...dependency })),
        ),
      }),
    );
  }
  return Object.freeze({
    records: Object.freeze(records),
    indexes: buildIndexes(records),
  });
}

function buildIndexes(records: readonly OptIrProofErasureFact[]): OptIrCleanupFactIndexes {
  const byId: Record<number, OptIrProofErasureFact> = {};
  const bySubjectKey: Record<string, OptIrFactId[]> = {};
  for (const record of records) {
    byId[Number(record.factId)] = record;
    const key = subjectKey(record.subject);
    const existing = bySubjectKey[key];
    if (existing === undefined) {
      bySubjectKey[key] = [record.factId];
      continue;
    }
    existing.push(record.factId);
  }
  return Object.freeze({
    byId: Object.freeze({ ...byId }),
    bySubjectKey: Object.freeze(
      Object.fromEntries(
        Object.entries(bySubjectKey).map(([key, factIds]) => [
          key,
          Object.freeze([...factIds].sort(compareNumbers)),
        ]),
      ),
    ),
  });
}

function remapSubject(
  aliasMap: ReadonlyMap<string, OptIrProofErasureSubject>,
  subject: OptIrProofErasureSubject,
): OptIrProofErasureSubject {
  return aliasMap.get(subjectKey(subject)) ?? subject;
}

function subjectKey(subject: OptIrProofErasureSubject): string {
  switch (subject.kind) {
    case "value":
      return `value:${subject.valueId}`;
    case "operation":
      return `operation:${subject.operationId}`;
  }
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}
