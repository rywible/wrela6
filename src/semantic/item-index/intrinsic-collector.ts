import type {
  IntrinsicCatalog,
  IntrinsicDeclarationSpec,
  IntrinsicModuleSpec,
} from "./intrinsic-catalog";
import { stableSerializeIntrinsicDeclaration } from "./stable-serialization";
import type {
  FunctionRecord,
  ImageRecord,
  IntrinsicItemRecord,
  IntrinsicParameterRecord,
  ModuleRecord,
  TypeRecord,
} from "./item-records";
import { type ParameterId, functionId, itemId, moduleId, parameterId, typeId } from "../ids";

export interface IntrinsicCollectionOffsets {
  readonly moduleIdOffset: number;
  readonly itemIdOffset: number;
  readonly typeIdOffset: number;
  readonly functionIdOffset: number;
  readonly imageIdOffset: number;
  readonly fieldIdOffset: number;
  readonly parameterIdOffset: number;
}

export interface IntrinsicCollectionResult {
  readonly modules: readonly ModuleRecord[];
  readonly items: readonly IntrinsicItemRecord[];
  readonly types: readonly TypeRecord[];
  readonly functions: readonly FunctionRecord[];
  readonly images: readonly ImageRecord[];
  readonly fields: readonly import("./item-records").FieldRecord[];
  readonly typeParameters: readonly import("./item-records").TypeParameterRecord[];
  readonly parameters: readonly IntrinsicParameterRecord[];
}

function sortModules(modules: readonly IntrinsicModuleSpec[]): IntrinsicModuleSpec[] {
  return [...modules].sort((left, right) => {
    const pathCmp = left.pathKey.localeCompare(right.pathKey);
    if (pathCmp !== 0) return pathCmp;
    const displayCmp = left.display.localeCompare(right.display);
    if (displayCmp !== 0) return displayCmp;
    const leftSerialized = left.declarations.map(stableSerializeIntrinsicDeclaration).join(",");
    const rightSerialized = right.declarations.map(stableSerializeIntrinsicDeclaration).join(",");
    return leftSerialized.localeCompare(rightSerialized);
  });
}

function sortDeclarations(
  declarations: readonly IntrinsicDeclarationSpec[],
): IntrinsicDeclarationSpec[] {
  return [...declarations].sort((left, right) => {
    const idCmp = left.intrinsicId.localeCompare(right.intrinsicId);
    if (idCmp !== 0) return idCmp;
    const nameCmp = left.name.localeCompare(right.name);
    if (nameCmp !== 0) return nameCmp;
    const kindCmp = left.kind.localeCompare(right.kind);
    if (kindCmp !== 0) return kindCmp;
    return stableSerializeIntrinsicDeclaration(left.signature).localeCompare(
      stableSerializeIntrinsicDeclaration(right.signature),
    );
  });
}

export function collectIntrinsicItems(
  catalog: IntrinsicCatalog,
  offsets: IntrinsicCollectionOffsets,
): IntrinsicCollectionResult {
  const sortedModules = sortModules(catalog.modules);
  const modules: ModuleRecord[] = [];
  const items: IntrinsicItemRecord[] = [];
  const types: TypeRecord[] = [];
  const functions: FunctionRecord[] = [];
  const parameters: IntrinsicParameterRecord[] = [];

  let moduleIndex = 0;
  let itemIndex = 0;
  let typeIndex = 0;
  let functionIndex = 0;
  let parameterIndex = 0;

  for (const moduleSpec of sortedModules) {
    const moduleRecord: ModuleRecord = {
      id: moduleId(offsets.moduleIdOffset + moduleIndex),
      origin: "intrinsic",
      pathKey: moduleSpec.pathKey,
      display: moduleSpec.display,
    };
    modules.push(moduleRecord);
    moduleIndex++;

    const sortedDeclarations = sortDeclarations(moduleSpec.declarations);

    for (const decl of sortedDeclarations) {
      if (decl.kind === "function") {
        const funcRecord: FunctionRecord = {
          id: functionId(offsets.functionIdOffset + functionIndex),
          itemId: itemId(offsets.itemIdOffset + itemIndex),
          moduleId: moduleRecord.id,
          name: decl.name,
          parameterIds: [],
          intrinsicId: decl.intrinsicId,
        };
        functions.push(funcRecord);
        functionIndex++;

        const itemRecord: IntrinsicItemRecord = {
          id: itemId(offsets.itemIdOffset + itemIndex),
          origin: "intrinsic",
          kind: "intrinsicFunction",
          moduleId: moduleRecord.id,
          name: decl.name,
          intrinsicId: decl.intrinsicId,
          signature: decl.signature,
          targetAvailability: decl.targetAvailability,
          proofContract: decl.proofContract,
          lowering: decl.lowering,
          functionId: funcRecord.id,
        };
        items.push(itemRecord);

        const paramIds: ParameterId[] = [];
        for (let paramIdx = 0; paramIdx < decl.signature.parameters.length; paramIdx++) {
          const paramSpec = decl.signature.parameters[paramIdx]!;
          const paramRecord: IntrinsicParameterRecord = {
            id: parameterId(offsets.parameterIdOffset + parameterIndex),
            functionId: funcRecord.id,
            origin: "intrinsic",
            index: paramIdx,
            name: paramSpec.name,
            isConsumed: paramSpec.isConsumed,
            type: paramSpec.type,
          };
          parameters.push(paramRecord);
          paramIds.push(paramRecord.id);
          parameterIndex++;
        }

        const funcIdx = functions.length - 1;
        functions[funcIdx] = { ...functions[funcIdx]!, parameterIds: paramIds };
      } else {
        const typeRecord: TypeRecord = {
          id: typeId(offsets.typeIdOffset + typeIndex),
          itemId: itemId(offsets.itemIdOffset + itemIndex),
          moduleId: moduleRecord.id,
          name: decl.name,
        };
        types.push(typeRecord);
        typeIndex++;

        const itemRecord: IntrinsicItemRecord = {
          id: itemId(offsets.itemIdOffset + itemIndex),
          origin: "intrinsic",
          kind: "intrinsicType",
          moduleId: moduleRecord.id,
          name: decl.name,
          intrinsicId: decl.intrinsicId,
          signature: decl.signature,
          targetAvailability: decl.targetAvailability,
          proofContract: decl.proofContract,
          lowering: decl.lowering,
          typeId: typeRecord.id,
        };
        items.push(itemRecord);
      }

      itemIndex++;
    }
  }

  return {
    modules,
    items,
    types,
    functions,
    images: [],
    fields: [],
    typeParameters: [],
    parameters,
  };
}
