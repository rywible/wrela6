import type {
  LayoutEnumFact,
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeKey,
} from "./layout-program";
import type { LayoutEnumFactTable } from "./layout-program";

export interface LayoutTypeKeyLookupResult {
  readonly layout: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
}

export function lookupLayoutForTypeKey(
  typeKey: LayoutTypeKey,
  types: LayoutTypeFactTable,
  enums: LayoutEnumFactTable,
): LayoutTypeKeyLookupResult | undefined {
  const layout = types.get(typeKey);
  if (layout === undefined) {
    return undefined;
  }
  const enumFact =
    typeKey.kind === "source" && layout.representation.kind === "enum"
      ? enums.get(typeKey)
      : undefined;
  return { layout, ...(enumFact !== undefined ? { enumFact } : {}) };
}
