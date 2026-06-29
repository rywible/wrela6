import type {
  OptIrBlockId,
  OptIrEdgeId,
  OptIrFactId,
  OptIrOperationId,
  OptIrRegionId,
  OptIrValueId,
} from "../ids";

export type OptIrFactSubject =
  | { readonly kind: "value"; readonly valueId: OptIrValueId }
  | { readonly kind: "operation"; readonly operationId: OptIrOperationId }
  | { readonly kind: "block"; readonly blockId: OptIrBlockId }
  | { readonly kind: "edge"; readonly edgeId: OptIrEdgeId }
  | { readonly kind: "region"; readonly regionId: OptIrRegionId }
  | { readonly kind: "fact"; readonly factId: OptIrFactId };

export interface OptIrSubjectRemapTableInput {
  readonly values?: readonly (readonly [OptIrValueId, OptIrValueId])[];
  readonly operations?: readonly (readonly [OptIrOperationId, OptIrOperationId])[];
  readonly blocks?: readonly (readonly [OptIrBlockId, OptIrBlockId])[];
  readonly edges?: readonly (readonly [OptIrEdgeId, OptIrEdgeId])[];
  readonly regions?: readonly (readonly [OptIrRegionId, OptIrRegionId])[];
  readonly facts?: readonly (readonly [OptIrFactId, OptIrFactId])[];
  readonly droppedSubjects?: readonly OptIrFactSubject[];
}

export interface OptIrSubjectRemapEntry {
  readonly source: OptIrFactSubject;
  readonly target: OptIrFactSubject;
}

export interface OptIrSubjectRemapTable {
  readonly entries: readonly OptIrSubjectRemapEntry[];
  readonly droppedSubjectKeys: readonly string[];
  readonly remap: (subject: OptIrFactSubject) => OptIrFactSubject | undefined;
  readonly isDropped: (subject: OptIrFactSubject) => boolean;
}

export function createOptIrSubjectRemapTable(
  input: OptIrSubjectRemapTableInput,
): OptIrSubjectRemapTable {
  const entries = [
    ...subjectEntries(input.values ?? [], valueSubject),
    ...subjectEntries(input.operations ?? [], operationSubject),
    ...subjectEntries(input.blocks ?? [], blockSubject),
    ...subjectEntries(input.edges ?? [], edgeSubject),
    ...subjectEntries(input.regions ?? [], regionSubject),
    ...subjectEntries(input.facts ?? [], factSubject),
  ].sort(compareRemapEntry);

  const remaps = new Map<string, OptIrFactSubject>();
  for (const entry of entries) {
    remaps.set(optIrFactSubjectKey(entry.source), entry.target);
  }

  const droppedSubjectKeys = Object.freeze([
    ...new Set((input.droppedSubjects ?? []).map(optIrFactSubjectKey).sort(compareStrings)),
  ]);
  const droppedSubjects = new Set(droppedSubjectKeys);
  const frozenEntries = Object.freeze(entries.map(freezeRemapEntry));

  const table: OptIrSubjectRemapTable = {
    entries: frozenEntries,
    droppedSubjectKeys,
    remap(subject: OptIrFactSubject) {
      return remaps.get(optIrFactSubjectKey(subject));
    },
    isDropped(subject: OptIrFactSubject) {
      return droppedSubjects.has(optIrFactSubjectKey(subject));
    },
  };

  return Object.freeze(table);
}

export function remapOptionalOptIrFactSubject(
  table: OptIrSubjectRemapTable,
  subject: OptIrFactSubject,
): OptIrFactSubject {
  return table.remap(subject) ?? subject;
}

export function requireRemappedOptIrFactSubject(
  table: OptIrSubjectRemapTable,
  subject: OptIrFactSubject,
): OptIrFactSubject {
  if (table.isDropped(subject)) {
    throw new RangeError(`OptIR subject ${optIrFactSubjectKey(subject)} was explicitly dropped.`);
  }

  const remapped = table.remap(subject);
  if (remapped === undefined) {
    throw new RangeError(
      `Missing required OptIR subject remap for ${optIrFactSubjectKey(subject)}.`,
    );
  }
  return remapped;
}

export function optIrFactSubjectKey(subject: OptIrFactSubject): string {
  switch (subject.kind) {
    case "value":
      return `value:${subject.valueId}`;
    case "operation":
      return `operation:${subject.operationId}`;
    case "block":
      return `block:${subject.blockId}`;
    case "edge":
      return `edge:${subject.edgeId}`;
    case "region":
      return `region:${subject.regionId}`;
    case "fact":
      return `fact:${subject.factId}`;
  }
}

function subjectEntries<SubjectId>(
  pairs: readonly (readonly [SubjectId, SubjectId])[],
  createSubject: (subjectId: SubjectId) => OptIrFactSubject,
): OptIrSubjectRemapEntry[] {
  return pairs.map(([source, target]) => ({
    source: createSubject(source),
    target: createSubject(target),
  }));
}

function valueSubject(valueId: OptIrValueId): OptIrFactSubject {
  return { kind: "value", valueId };
}

function operationSubject(operationId: OptIrOperationId): OptIrFactSubject {
  return { kind: "operation", operationId };
}

function blockSubject(blockId: OptIrBlockId): OptIrFactSubject {
  return { kind: "block", blockId };
}

function edgeSubject(edgeId: OptIrEdgeId): OptIrFactSubject {
  return { kind: "edge", edgeId };
}

function regionSubject(regionId: OptIrRegionId): OptIrFactSubject {
  return { kind: "region", regionId };
}

function factSubject(factId: OptIrFactId): OptIrFactSubject {
  return { kind: "fact", factId };
}

function compareRemapEntry(left: OptIrSubjectRemapEntry, right: OptIrSubjectRemapEntry): number {
  return compareStrings(optIrFactSubjectKey(left.source), optIrFactSubjectKey(right.source));
}

function freezeRemapEntry(entry: OptIrSubjectRemapEntry): OptIrSubjectRemapEntry {
  return Object.freeze({
    source: Object.freeze({ ...entry.source }),
    target: Object.freeze({ ...entry.target }),
  });
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
