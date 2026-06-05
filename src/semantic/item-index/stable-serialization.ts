export function stableSerializeIntrinsicDeclaration(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeIntrinsicDeclaration).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerializeIntrinsicDeclaration(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
