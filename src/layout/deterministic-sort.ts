export function compareCodeUnitStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function layoutLengthDelimitedField(kind: string, payload: string): string {
  return `${kind}:len(${payload.length}):${payload}`;
}
