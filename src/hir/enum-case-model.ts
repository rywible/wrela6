import type { ItemIndex } from "../semantic/item-index";
import type { FieldId, ItemId, TypeId } from "../semantic/ids";

export interface HirEnumCaseOrdinalRecord {
  readonly enumItemId: ItemId;
  readonly enumTypeId: TypeId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly payloadFieldIds: readonly FieldId[];
}

export type HirEnumCaseOrdinalResult =
  | { readonly kind: "ok"; readonly record: HirEnumCaseOrdinalRecord }
  | { readonly kind: "not-enum-case" }
  | { readonly kind: "broken"; readonly stableDetail: string };

export function hirEnumCaseOrdinal(input: {
  readonly index: ItemIndex;
  readonly caseItemId: ItemId;
}): HirEnumCaseOrdinalResult {
  const caseItem = input.index.item(input.caseItemId);
  if (caseItem?.kind !== "enumCase" || caseItem.parentItemId === undefined) {
    return { kind: "not-enum-case" };
  }

  const enumItem = input.index.item(caseItem.parentItemId);
  if (enumItem?.kind !== "enum" || enumItem.typeId === undefined) {
    return {
      kind: "broken",
      stableDetail: `enum-case-owner:${String(input.caseItemId)}`,
    };
  }

  const cases = hirEnumCasesForTypeItem({
    index: input.index,
    enumItemId: enumItem.id,
    enumTypeId: enumItem.typeId,
  });
  const record = cases.find((candidate) => candidate.caseItemId === caseItem.id);
  if (record === undefined) {
    return {
      kind: "broken",
      stableDetail: `enum-case-missing:${String(enumItem.id)}:${String(caseItem.id)}`,
    };
  }
  return { kind: "ok", record };
}

export function hirEnumCasesForTypeItem(input: {
  readonly index: ItemIndex;
  readonly enumItemId: ItemId;
  readonly enumTypeId: TypeId;
}): readonly HirEnumCaseOrdinalRecord[] {
  const item = input.index.item(input.enumItemId);
  if (item?.kind !== "enum") return Object.freeze([]);

  return Object.freeze(
    input.index
      .items()
      .filter(
        (caseItem) => caseItem.kind === "enumCase" && caseItem.parentItemId === input.enumItemId,
      )
      .map((caseItem, ordinal) =>
        Object.freeze({
          enumItemId: input.enumItemId,
          enumTypeId: input.enumTypeId,
          caseItemId: caseItem.id,
          name: caseItem.name,
          ordinal,
          payloadFieldIds: input.index
            .fieldsForItem(caseItem.id)
            .filter((field) => field.role === "enumPayload")
            .map((field) => field.id),
        }),
      ),
  );
}
