import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend";
import {
  fieldId,
  functionId,
  imageId,
  itemId,
  moduleId,
  parameterId,
  typeId,
} from "../../../../src/semantic/ids";
import { ItemIndex } from "../../../../src/semantic/item-index/item-index";
import type {
  FieldRecord,
  FunctionRecord,
  ImageRecord,
  ModuleRecord,
  SourceItemRecord,
  SourceParameterRecord,
  TypeParameterRecord,
  TypeRecord,
} from "../../../../src/semantic/item-index/item-records";

describe("ItemIndex", () => {
  const declaration = {} as SourceItemRecord["declaration"];

  function makeTestIndex(): ItemIndex {
    const moduleRecord: ModuleRecord = {
      id: moduleId(0),
      origin: "source",
      pathKey: "app/main.wr",
      display: "app/main.wr",
    };
    const itemRecord: SourceItemRecord = {
      id: itemId(0),
      origin: "source",
      kind: "class",
      moduleId: moduleId(0),
      name: "Box",
      modifiers: [],
      nameSpan: SourceSpan.from(0, 3),
      span: SourceSpan.from(0, 10),
      declaration,
    };
    const typeRecord: TypeRecord = {
      id: typeId(0),
      itemId: itemId(0),
      moduleId: moduleId(0),
      name: "Box",
    };
    const imageRecord: ImageRecord = {
      id: imageId(0),
      itemId: itemId(0),
      moduleId: moduleId(0),
      name: "Boot",
      fieldIds: [fieldId(0)],
      deviceFieldIds: [],
    };
    const functionRecord: FunctionRecord = {
      id: functionId(0),
      itemId: itemId(0),
      moduleId: moduleId(0),
      name: "run",
      parameterIds: [parameterId(0)],
    };
    const fieldRecord: FieldRecord = {
      id: fieldId(0),
      ownerItemId: itemId(0),
      role: "field",
      name: "value",
      nameSpan: SourceSpan.from(12, 17),
      span: SourceSpan.from(12, 21),
    };
    const typeParameter: TypeParameterRecord = {
      owner: { kind: "item", itemId: itemId(0) },
      index: 0,
      name: "T",
      nameSpan: SourceSpan.from(10, 11),
      span: SourceSpan.from(10, 11),
    };
    const parameterRecord: SourceParameterRecord = {
      id: parameterId(0),
      functionId: functionId(0),
      origin: "source",
      index: 0,
      name: "x",
      isConsumed: false,
      nameSpan: SourceSpan.from(22, 23),
      span: SourceSpan.from(22, 27),
    };

    return new ItemIndex({
      modules: [moduleRecord],
      items: [itemRecord],
      types: [typeRecord],
      functions: [functionRecord],
      images: [imageRecord],
      fields: [fieldRecord],
      typeParameters: [typeParameter],
      parameters: [parameterRecord],
    });
  }

  test("returns copies for arrays and bounds-checks lookups", () => {
    const index = makeTestIndex();
    const modules = index.modules() as ModuleRecord[];
    const typeParameters = index.typeParameters() as TypeParameterRecord[];
    modules.pop();
    typeParameters.pop();

    expect(index.modules()).toHaveLength(1);
    expect(index.fieldsForItem(itemId(0)).map((field) => field.name)).toEqual(["value"]);
    expect(index.parametersForFunction(functionId(0)).map((parameter) => parameter.name)).toEqual([
      "x",
    ]);
    expect(index.typeParameters()).toHaveLength(1);
    expect(index.typeParametersForItem(itemId(0)).map((parameter) => parameter.name)).toEqual([
      "T",
    ]);
    expect(index.item(itemId(99))).toBeUndefined();
    expect(index.type(itemId(99) as any)).toBeUndefined();
    expect(index.moduleByPath("app/main.wr", "source")!.id).toBe(moduleId(0));
    expect(index.moduleByPath("app/main.wr", "intrinsic")).toBeUndefined();
    expect(index.itemsInModule(moduleId(0)).map((item) => item.name)).toEqual(["Box"]);
  });

  test("returns undefined for unknown numeric lookups", () => {
    const index = makeTestIndex();
    expect(index.module(moduleId(99))).toBeUndefined();
    expect(index.function(functionId(99))).toBeUndefined();
    expect(index.image(imageId(99))).toBeUndefined();
    expect(index.field(fieldId(99))).toBeUndefined();
    expect(index.parameter(parameterId(99))).toBeUndefined();
  });
});
