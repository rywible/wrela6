import { type PlatformPrimitiveId } from "../ids";

const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface PlatformPrimitiveNameSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly name: string;
}

export interface PlatformPrimitiveNameCatalog {
  readonly primitives: readonly PlatformPrimitiveNameSpec[];
  byName(name: string): PlatformPrimitiveNameSpec | undefined;
}

export function platformPrimitiveNameCatalog(
  primitives: readonly PlatformPrimitiveNameSpec[],
): PlatformPrimitiveNameCatalog {
  const seenNames = new Map<string, PlatformPrimitiveNameSpec>();
  const seenIds = new Set<string>();

  for (const primitive of primitives) {
    if (!SIMPLE_IDENTIFIER.test(primitive.name)) {
      throw new RangeError(
        `Platform primitive names must be simple identifiers: '${primitive.name}'.`,
      );
    }
    if (seenNames.has(primitive.name)) {
      throw new RangeError(`Duplicate platform primitive name '${primitive.name}'.`);
    }
    const idStr = String(primitive.primitiveId);
    if (seenIds.has(idStr)) {
      throw new RangeError(`Duplicate platform primitive id '${primitive.primitiveId}'.`);
    }
    seenNames.set(primitive.name, primitive);
    seenIds.add(idStr);
  }

  const sorted = [...primitives].sort((primA, primB) => {
    const byName = primA.name.localeCompare(primB.name);
    if (byName !== 0) return byName;
    return String(primA.primitiveId).localeCompare(String(primB.primitiveId));
  });

  const nameIndex = new Map(sorted.map((primitive) => [primitive.name, primitive]));

  return {
    get primitives(): readonly PlatformPrimitiveNameSpec[] {
      return [...sorted];
    },
    byName(name: string): PlatformPrimitiveNameSpec | undefined {
      return nameIndex.get(name);
    },
  };
}
