export function relocationKeyFor(moduleKey: string, objectRelocationStableKey: string): string {
  return `${moduleKey}:reloc:${objectRelocationStableKey}`;
}
