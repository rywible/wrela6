import type { ItemIndex } from "../item-index";
import type { FieldId, ItemId, TypeId } from "../ids";
import type { ValidatedBufferSection } from "../item-index/item-records";

export interface ValidatedBufferFieldDescriptor {
  readonly fieldId: FieldId;
  readonly itemId: ItemId;
  readonly typeId: TypeId;
  readonly name: string;
  readonly section: ValidatedBufferSection;
  readonly bodyOrdinal: number;
  readonly surfaceOrdinal: number;
}

export interface ValidatedBufferFieldModel {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly fields: readonly ValidatedBufferFieldDescriptor[];
  readonly parameterFieldIds: readonly FieldId[];
  readonly layoutFieldIds: readonly FieldId[];
  readonly derivedFieldIds: readonly FieldId[];
  readonly layoutDerivedFieldOrder: readonly FieldId[];
}

export interface ValidatedBufferFieldModelTable {
  get(typeId: TypeId): ValidatedBufferFieldModel | undefined;
  entries(): readonly ValidatedBufferFieldModel[];
}

export function validatedBufferFieldModelTableEmpty(): ValidatedBufferFieldModelTable {
  return validatedBufferFieldModelTable([]);
}

function validatedBufferFieldModelTable(
  models: readonly ValidatedBufferFieldModel[],
): ValidatedBufferFieldModelTable {
  const sorted = [...models].sort(
    (left, right) => (left.typeId as number) - (right.typeId as number),
  );
  const byTypeId = new Map(sorted.map((model) => [model.typeId, model]));
  return {
    get: (typeId) => byTypeId.get(typeId),
    entries: () => [...sorted],
  };
}

export function buildValidatedBufferFieldModels(index: ItemIndex): ValidatedBufferFieldModelTable {
  const models: ValidatedBufferFieldModel[] = [];

  for (const item of index.items()) {
    if (item.kind !== "validatedBuffer" || item.typeId === undefined) {
      continue;
    }

    const bufferFields = index
      .fieldsForItem(item.id)
      .filter(
        (field) =>
          field.validatedBufferSection !== undefined &&
          field.validatedBufferBodyOrdinal !== undefined &&
          field.validatedBufferSurfaceOrdinal !== undefined,
      );

    if (bufferFields.length === 0) {
      continue;
    }

    const descriptors: ValidatedBufferFieldDescriptor[] = bufferFields.map((field) => ({
      fieldId: field.id,
      itemId: item.id,
      typeId: item.typeId!,
      name: field.name,
      section: field.validatedBufferSection!,
      bodyOrdinal: field.validatedBufferBodyOrdinal!,
      surfaceOrdinal: field.validatedBufferSurfaceOrdinal!,
    }));

    const parameterFieldIds = descriptors
      .filter((field) => field.section === "params")
      .map((field) => field.fieldId);
    const layoutFieldIds = descriptors
      .filter((field) => field.section === "layout")
      .map((field) => field.fieldId);
    const derivedFieldIds = descriptors
      .filter((field) => field.section === "derive")
      .map((field) => field.fieldId);

    const layoutDerivedFieldOrder = [...descriptors]
      .filter((field) => field.section === "layout" || field.section === "derive")
      .sort((left, right) => left.bodyOrdinal - right.bodyOrdinal)
      .map((field) => field.fieldId);

    models.push({
      typeId: item.typeId,
      itemId: item.id,
      fields: descriptors,
      parameterFieldIds,
      layoutFieldIds,
      derivedFieldIds,
      layoutDerivedFieldOrder,
    });
  }

  return validatedBufferFieldModelTable(models);
}

export function validatedBufferFieldDescriptor(
  model: ValidatedBufferFieldModel,
  fieldId: FieldId,
): ValidatedBufferFieldDescriptor | undefined {
  return model.fields.find((field) => field.fieldId === fieldId);
}
