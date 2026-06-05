import type { ParsedModuleGraph } from "../../frontend/module-graph-parser";
import type { IntrinsicCatalog } from "./intrinsic-catalog";
import { collectIntrinsicItems, type IntrinsicCollectionOffsets } from "./intrinsic-collector";
import { checkItemIndexDuplicates } from "./duplicate-checker";
import { ItemIndex } from "./item-index";
import type { ItemIndexRecords, ItemRecord, ModuleRecord } from "./item-records";
import { collectSourceModulesAndTopLevelItems } from "./source-module-collector";
import { collectSourceMembers, createSourceMemberContext } from "./source-member-collector";

export interface BuildItemIndexInput {
  readonly graph: ParsedModuleGraph;
  readonly intrinsics?: IntrinsicCatalog;
}

export interface BuildItemIndexResult {
  readonly index: ItemIndex;
  readonly diagnostics: readonly import("./diagnostics").ItemIndexDiagnostic[];
}

function offsetsFrom(records: ItemIndexRecords): IntrinsicCollectionOffsets {
  return {
    moduleIdOffset: records.modules.length,
    itemIdOffset: records.items.length,
    typeIdOffset: records.types.length,
    functionIdOffset: records.functions.length,
    imageIdOffset: records.images.length,
    fieldIdOffset: records.fields.length,
    parameterIdOffset: records.parameters.length,
  };
}

function mergeRecords(
  source: ItemIndexRecords,
  intrinsic: {
    readonly modules: readonly ModuleRecord[];
    readonly items: readonly ItemRecord[];
    readonly types: readonly import("./item-records").TypeRecord[];
    readonly functions: readonly import("./item-records").FunctionRecord[];
    readonly images: readonly import("./item-records").ImageRecord[];
    readonly fields: readonly import("./item-records").FieldRecord[];
    readonly typeParameters: readonly import("./item-records").TypeParameterRecord[];
    readonly parameters: readonly import("./item-records").ParameterRecord[];
  },
): ItemIndexRecords {
  return {
    modules: [...source.modules, ...intrinsic.modules],
    items: [...source.items, ...intrinsic.items],
    types: [...source.types, ...intrinsic.types],
    functions: [...source.functions, ...intrinsic.functions],
    images: [...source.images, ...intrinsic.images],
    fields: [...source.fields, ...intrinsic.fields],
    typeParameters: [...source.typeParameters, ...intrinsic.typeParameters],
    parameters: [...source.parameters, ...intrinsic.parameters],
  };
}

export function buildItemIndex(input: BuildItemIndexInput): BuildItemIndexResult {
  const source = collectSourceModulesAndTopLevelItems(input.graph.modules);
  const context = createSourceMemberContext(source);
  const sourceWithMembers = {
    ...collectSourceMembers(context),
    modules: source.modules,
  } as ItemIndexRecords;

  const intrinsic = collectIntrinsicItems(
    input.intrinsics ?? { modules: [] },
    offsetsFrom(sourceWithMembers),
  );

  const records = mergeRecords(sourceWithMembers, intrinsic);
  const diagnostics = checkItemIndexDuplicates(records);

  return { index: new ItemIndex(records), diagnostics };
}
