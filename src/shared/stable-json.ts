import { createHash } from "node:crypto";

import { compareCodeUnitStrings } from "./deterministic-sort";

export function stableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

export function stableDigestHex(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.charCodeAt(0));
    hash *= 0x100000001b3n;
    hash &= 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function toStableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => compareCodeUnitStrings(stableJson(left[0]), stableJson(right[0])));
  }
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareCodeUnitStrings(left, right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }
  return value;
}
