import { compareCodeUnitStrings } from "../deterministic-sort";
import type {
  PassInvariantCheckerId,
  PassInvariantSchema,
  PassInvariantSchemaId,
  RewriteInvariant,
} from "../passes/pass-contract";

export interface PassInvariantTypedCheckerContext {
  readonly schema: PassInvariantSchema;
  readonly invariant: RewriteInvariant;
}

export type PassInvariantTypedChecker = (context: PassInvariantTypedCheckerContext) => boolean;

export interface PassInvariantSchemaEntry {
  readonly schema: PassInvariantSchema;
  readonly checker: PassInvariantTypedChecker;
}

export interface PassInvariantSchemaRegistry {
  readonly entries: readonly PassInvariantSchemaEntry[];
  readonly get: (schemaId: PassInvariantSchemaId) => PassInvariantSchemaEntry | undefined;
}

export function createPassInvariantSchemaRegistry(
  schemas: readonly PassInvariantSchema[],
): PassInvariantSchemaRegistry {
  const entries = schemas
    .map((schema) =>
      freezeEntry({
        schema,
        checker: defaultPassInvariantTypedChecker,
      }),
    )
    .sort((left, right) => compareCodeUnitStrings(left.schema.schemaId, right.schema.schemaId));
  const entriesBySchemaId = new Map<PassInvariantSchemaId, PassInvariantSchemaEntry>();

  for (const entry of entries) {
    if (entriesBySchemaId.has(entry.schema.schemaId)) {
      throw new RangeError(`Duplicate OptIR pass invariant schema ${entry.schema.schemaId}.`);
    }
    entriesBySchemaId.set(entry.schema.schemaId, entry);
  }

  return Object.freeze({
    entries: Object.freeze(entries.slice()),
    get(schemaId: PassInvariantSchemaId): PassInvariantSchemaEntry | undefined {
      return entriesBySchemaId.get(schemaId);
    },
  });
}

export function passInvariantSchemaCheckerMatches(
  schema: PassInvariantSchema,
  checker: PassInvariantCheckerId,
): boolean {
  return schema.checker === checker;
}

export function passInvariantSchemaDecompositionMatches(
  schema: PassInvariantSchema,
  decomposition: readonly RewriteInvariant[],
): boolean {
  return invariantListKey(schema.decomposesTo) === invariantListKey(decomposition);
}

export function defaultPassInvariantTypedChecker(
  context: PassInvariantTypedCheckerContext,
): boolean {
  if (context.invariant.kind !== "passSpecificInvariant") {
    return false;
  }
  return (
    context.invariant.schema === context.schema.schemaId &&
    passInvariantSchemaCheckerMatches(context.schema, context.invariant.checker) &&
    context.invariant.decomposesTo.length > 0 &&
    passInvariantSchemaDecompositionMatches(context.schema, context.invariant.decomposesTo)
  );
}

export function invariantKey(invariant: RewriteInvariant): string {
  if (invariant.kind === "conjunction") {
    return `conjunction(${invariantListKey(invariant.invariants)})`;
  }
  if (invariant.kind === "passSpecificInvariant") {
    return [
      "passSpecificInvariant",
      invariant.schema,
      invariant.checker,
      invariantListKey(invariant.decomposesTo),
    ].join(":");
  }
  return invariant.kind;
}

export function invariantListKey(invariants: readonly RewriteInvariant[]): string {
  return invariants.map((invariant) => invariantKey(invariant)).join(",");
}

function freezeEntry(entry: PassInvariantSchemaEntry): PassInvariantSchemaEntry {
  return Object.freeze({
    schema: freezeSchema(entry.schema),
    checker: entry.checker,
  });
}

function freezeSchema(schema: PassInvariantSchema): PassInvariantSchema {
  return Object.freeze({
    ...schema,
    operands: Object.freeze(schema.operands.slice()),
    requiredFacts: Object.freeze(schema.requiredFacts.slice()),
    decomposesTo: Object.freeze(schema.decomposesTo.slice()),
  });
}
