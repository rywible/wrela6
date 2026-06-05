import { coreTypeId, type CoreTypeId } from "../ids";

export interface CoreTypeSpec {
  readonly id: CoreTypeId;
  readonly name: string;
}

function defaultSpecs(): CoreTypeSpec[] {
  return [
    { id: coreTypeId("bool"), name: "bool" },
    { id: coreTypeId("u8"), name: "u8" },
    { id: coreTypeId("u16"), name: "u16" },
    { id: coreTypeId("u32"), name: "u32" },
    { id: coreTypeId("u64"), name: "u64" },
    { id: coreTypeId("usize"), name: "usize" },
    { id: coreTypeId("Never"), name: "Never" },
  ];
}

export class CoreTypeCatalog {
  private readonly _types: readonly CoreTypeSpec[];

  private constructor(types: readonly CoreTypeSpec[]) {
    this._types = types;
  }

  static default(): CoreTypeCatalog {
    return new CoreTypeCatalog(sortByName(defaultSpecs()));
  }

  static from(types: readonly CoreTypeSpec[]): CoreTypeCatalog {
    validate(types);
    return new CoreTypeCatalog(sortByName(types));
  }

  get types(): readonly CoreTypeSpec[] {
    return [...this._types];
  }

  byName(name: string): CoreTypeSpec | undefined {
    return this._types.find((type) => type.name === name);
  }
}

function sortByName(types: readonly CoreTypeSpec[]): CoreTypeSpec[] {
  return [...types].sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
}

function validate(types: readonly CoreTypeSpec[]): void {
  const seenNames = new Set<string>();
  const seenIds = new Set<CoreTypeId>();

  for (const type of types) {
    if (seenNames.has(type.name)) {
      throw new RangeError(`Duplicate core type name '${type.name}'.`);
    }
    seenNames.add(type.name);

    if (seenIds.has(type.id)) {
      throw new RangeError(`Duplicate core type id '${type.id}'.`);
    }
    seenIds.add(type.id);
  }
}
