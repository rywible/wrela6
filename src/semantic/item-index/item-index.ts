import type {
  FieldRecord,
  FunctionRecord,
  ImageRecord,
  ItemIndexRecords,
  ItemRecord,
  ModuleRecord,
  ParameterRecord,
  TypeParameterRecord,
  TypeRecord,
} from "./item-records";
import type { FieldId, FunctionId, ImageId, ItemId, ModuleId, ParameterId, TypeId } from "../ids";

export class ItemIndex {
  private readonly moduleRecords: readonly ModuleRecord[];
  private readonly itemRecords: readonly ItemRecord[];
  private readonly typeRecords: readonly TypeRecord[];
  private readonly functionRecords: readonly FunctionRecord[];
  private readonly imageRecords: readonly ImageRecord[];
  private readonly fieldRecords: readonly FieldRecord[];
  private readonly typeParameterRecords: readonly TypeParameterRecord[];
  private readonly parameterRecords: readonly ParameterRecord[];

  private readonly moduleByPathIndex: Map<string, ModuleRecord>;
  private readonly itemsByModule: Map<ModuleId, ItemRecord[]>;
  private readonly fieldsByItem: Map<ItemId, FieldRecord[]>;
  private readonly parametersByFunction: Map<FunctionId, ParameterRecord[]>;
  private readonly typeParametersByItem: Map<ItemId, TypeParameterRecord[]>;
  private readonly typeParametersByFunction: Map<FunctionId, TypeParameterRecord[]>;

  constructor(records: ItemIndexRecords) {
    this.moduleRecords = [...records.modules];
    this.itemRecords = [...records.items];
    this.typeRecords = [...records.types];
    this.functionRecords = [...records.functions];
    this.imageRecords = [...records.images];
    this.fieldRecords = [...records.fields];
    this.typeParameterRecords = [...records.typeParameters];
    this.parameterRecords = [...records.parameters];

    this.moduleByPathIndex = new Map();
    this.itemsByModule = new Map();
    this.fieldsByItem = new Map();
    this.parametersByFunction = new Map();
    this.typeParametersByItem = new Map();
    this.typeParametersByFunction = new Map();

    for (const module of this.moduleRecords) {
      this.moduleByPathIndex.set(module.pathKey, module);
    }

    for (const item of this.itemRecords) {
      const moduleItems = this.itemsByModule.get(item.moduleId);
      if (moduleItems) {
        moduleItems.push(item);
      } else {
        this.itemsByModule.set(item.moduleId, [item]);
      }
    }

    for (const field of this.fieldRecords) {
      const itemFields = this.fieldsByItem.get(field.ownerItemId);
      if (itemFields) {
        itemFields.push(field);
      } else {
        this.fieldsByItem.set(field.ownerItemId, [field]);
      }
    }

    for (const parameter of this.parameterRecords) {
      const funcParams = this.parametersByFunction.get(parameter.functionId);
      if (funcParams) {
        funcParams.push(parameter);
      } else {
        this.parametersByFunction.set(parameter.functionId, [parameter]);
      }
    }

    for (const typeParameter of this.typeParameterRecords) {
      if (typeParameter.owner.kind === "item") {
        const itemTps = this.typeParametersByItem.get(typeParameter.owner.itemId);
        if (itemTps) {
          itemTps.push(typeParameter);
        } else {
          this.typeParametersByItem.set(typeParameter.owner.itemId, [typeParameter]);
        }
      } else {
        const funcTps = this.typeParametersByFunction.get(typeParameter.owner.functionId);
        if (funcTps) {
          funcTps.push(typeParameter);
        } else {
          this.typeParametersByFunction.set(typeParameter.owner.functionId, [typeParameter]);
        }
      }
    }
  }

  modules(): readonly ModuleRecord[] {
    return [...this.moduleRecords];
  }

  items(): readonly ItemRecord[] {
    return [...this.itemRecords];
  }

  types(): readonly TypeRecord[] {
    return [...this.typeRecords];
  }

  functions(): readonly FunctionRecord[] {
    return [...this.functionRecords];
  }

  images(): readonly ImageRecord[] {
    return [...this.imageRecords];
  }

  fields(): readonly FieldRecord[] {
    return [...this.fieldRecords];
  }

  typeParameters(): readonly TypeParameterRecord[] {
    return [...this.typeParameterRecords];
  }

  parameters(): readonly ParameterRecord[] {
    return [...this.parameterRecords];
  }

  module(id: ModuleId): ModuleRecord | undefined {
    return this.moduleRecords[id as number];
  }

  item(id: ItemId): ItemRecord | undefined {
    return this.itemRecords[id as number];
  }

  type(id: TypeId): TypeRecord | undefined {
    return this.typeRecords[id as number];
  }

  function(id: FunctionId): FunctionRecord | undefined {
    return this.functionRecords[id as number];
  }

  image(id: ImageId): ImageRecord | undefined {
    return this.imageRecords[id as number];
  }

  field(id: FieldId): FieldRecord | undefined {
    return this.fieldRecords[id as number];
  }

  parameter(id: ParameterId): ParameterRecord | undefined {
    return this.parameterRecords[id as number];
  }

  moduleByPath(pathKey: string): ModuleRecord | undefined {
    return this.moduleByPathIndex.get(pathKey);
  }

  itemsInModule(moduleId: ModuleId): readonly ItemRecord[] {
    return [...(this.itemsByModule.get(moduleId) ?? [])];
  }

  fieldsForItem(itemId: ItemId): readonly FieldRecord[] {
    return [...(this.fieldsByItem.get(itemId) ?? [])];
  }

  parametersForFunction(functionId: FunctionId): readonly ParameterRecord[] {
    return [...(this.parametersByFunction.get(functionId) ?? [])];
  }

  typeParametersForItem(itemId: ItemId): readonly TypeParameterRecord[] {
    return [...(this.typeParametersByItem.get(itemId) ?? [])];
  }

  typeParametersForFunction(functionId: FunctionId): readonly TypeParameterRecord[] {
    return [...(this.typeParametersByFunction.get(functionId) ?? [])];
  }
}
