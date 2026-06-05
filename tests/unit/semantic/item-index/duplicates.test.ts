import { describe, expect, test } from "bun:test";
import { SourceSpan, SourceText } from "../../../../src/frontend";
import { functionId, itemId, moduleId, parameterId } from "../../../../src/semantic/ids";
import { checkItemIndexDuplicates } from "../../../../src/semantic/item-index/duplicate-checker";
import type {
  ItemIndexRecords,
  SourceItemRecord,
} from "../../../../src/semantic/item-index/item-records";

const source = SourceText.from("main.wr", "class Box:\nclass Box:\n");
const declaration = { source } as SourceItemRecord["declaration"];

function sourceItem(id: number, name: string, start: number): SourceItemRecord {
  return {
    id: itemId(id),
    kind: "class",
    moduleId: moduleId(0),
    name,
    modifiers: [],
    nameSpan: SourceSpan.from(start, start + name.length),
    span: SourceSpan.from(start, start + name.length),
    declaration,
  };
}

describe("item-index duplicate diagnostics", () => {
  test("reports duplicate source declarations and parameters from records", () => {
    const records: ItemIndexRecords = {
      modules: [{ id: moduleId(0), pathKey: "main.wr", display: "main.wr", source }],
      items: [sourceItem(0, "Box", 6), sourceItem(1, "Box", 17)],
      types: [],
      functions: [
        {
          id: functionId(0),
          itemId: itemId(0),
          moduleId: moduleId(0),
          name: "run",
          parameterIds: [parameterId(0), parameterId(1)],
        },
      ],
      images: [],
      fields: [],
      typeParameters: [
        {
          owner: { kind: "function", itemId: itemId(0), functionId: functionId(0) },
          index: 0,
          name: "T",
          nameSpan: SourceSpan.from(46, 47),
          span: SourceSpan.from(46, 47),
        },
        {
          owner: { kind: "function", itemId: itemId(0), functionId: functionId(0) },
          index: 1,
          name: "T",
          nameSpan: SourceSpan.from(50, 51),
          span: SourceSpan.from(50, 51),
        },
      ],
      parameters: [
        {
          id: parameterId(0),
          functionId: functionId(0),
          index: 0,
          name: "x",
          isConsumed: false,
          nameSpan: SourceSpan.from(30, 31),
          span: SourceSpan.from(30, 36),
        },
        {
          id: parameterId(1),
          functionId: functionId(0),
          index: 1,
          name: "x",
          isConsumed: false,
          nameSpan: SourceSpan.from(38, 39),
          span: SourceSpan.from(38, 44),
        },
      ],
    };

    const diagnostics = checkItemIndexDuplicates(records);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "ITEM_DUPLICATE_DECLARATION",
      "ITEM_DUPLICATE_PARAMETER",
      "ITEM_DUPLICATE_TYPE_PARAMETER",
    ]);
    const typeParameterDiagnostic = diagnostics.find(
      (diagnostic) => diagnostic.code === "ITEM_DUPLICATE_TYPE_PARAMETER",
    )!;
    expect(typeParameterDiagnostic.severity).toBe("error");
    expect(typeParameterDiagnostic.message).toBe("Duplicate type parameter 'T' in function run.");
    expect(typeParameterDiagnostic.source).toBeDefined();
    expect(typeParameterDiagnostic.span).toEqual(SourceSpan.from(50, 51));
  });

  test("reports duplicate source modules", () => {
    const source1 = SourceText.from("main.wr", "");
    const records: ItemIndexRecords = {
      modules: [
        {
          id: moduleId(0),
          pathKey: "main.wr",
          display: "main.wr",
          source: source1,
        },
        {
          id: moduleId(1),
          pathKey: "main.wr",
          display: "main.wr",
          source: source1,
        },
      ],
      items: [],
      types: [],
      functions: [],
      images: [],
      fields: [],
      typeParameters: [],
      parameters: [],
    };
    const diagnostics = checkItemIndexDuplicates(records);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "ITEM_DUPLICATE_MODULE")).toBe(
      true,
    );
  });
});
