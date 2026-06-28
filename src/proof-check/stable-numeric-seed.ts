const seedsByValue = new Map<number, string>();
const valuesBySeed = new Map<string, number>();

export function stableNumericSeed(seed: string): number {
  const existingValue = valuesBySeed.get(seed);
  if (existingValue !== undefined) {
    return existingValue;
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) >>> 0;
  }
  const value = hash >>> 0 || 1;
  const existingSeed = seedsByValue.get(value);
  if (existingSeed !== undefined && existingSeed !== seed) {
    throw new Error(
      `stableNumericSeed collision for ${JSON.stringify(seed)} and ${JSON.stringify(existingSeed)} at ${String(value)}`,
    );
  }
  seedsByValue.set(value, seed);
  valuesBySeed.set(seed, value);
  return value;
}

export function resetStableNumericSeedsForTest(): void {
  seedsByValue.clear();
  valuesBySeed.clear();
}
