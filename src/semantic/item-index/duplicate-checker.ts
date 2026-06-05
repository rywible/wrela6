import { SourceSpan, SourceText } from "../../frontend";
import type { ItemIndexDiagnostic } from "./diagnostics";
import type {
  FieldRecord,
  FunctionRecord,
  IntrinsicItemRecord,
  ItemIndexRecords,
  ItemRecord,
  ModuleRecord,
  ParameterRecord,
  SourceItemRecord,
  TypeParameterRecord,
} from "./item-records";
import type { FunctionId, ItemId } from "../ids";

const intrinsicSource = SourceText.from("<intrinsics>", "");

function duplicateError(
  code: ItemIndexDiagnostic["code"],
  message: string,
  source: SourceText,
  span: SourceSpan,
): ItemIndexDiagnostic {
  return { code, severity: "error", message, source, span };
}

function reportDuplicatesByKey<TRecord>(
  records: readonly TRecord[],
  keyOf: (record: TRecord) => string,
  report: (record: TRecord) => ItemIndexDiagnostic | undefined,
): ItemIndexDiagnostic[] {
  const diagnostics: ItemIndexDiagnostic[] = [];
  const firstByKey = new Map<string, TRecord>();
  for (const record of records) {
    const key = keyOf(record);
    if (firstByKey.has(key)) {
      const diagnostic = report(record);
      if (diagnostic) diagnostics.push(diagnostic);
    } else {
      firstByKey.set(key, record);
    }
  }
  return diagnostics;
}

interface OwnerLookup {
  readonly items: Map<number, SourceItemRecord>;
  readonly functions: Map<number, FunctionRecord>;
}

function buildOwnerLookup(records: ItemIndexRecords): OwnerLookup {
  const items = new Map<number, SourceItemRecord>();
  const functions = new Map<number, FunctionRecord>();
  for (const item of records.items) {
    if (item.origin === "source") {
      items.set(item.id as number, item);
    }
  }
  for (const func of records.functions) {
    functions.set(func.id as number, func);
  }
  return { items, functions };
}

function ownerSourceAndName(
  ownerItemId: ItemId,
  lookup: OwnerLookup,
): { source: SourceText; name: string } {
  const owner = lookup.items.get(ownerItemId as number);
  if (owner === undefined) return { source: intrinsicSource, name: `${ownerItemId}` };
  try {
    const declSource = (owner.declaration as { source: SourceText }).source;
    return { source: declSource, name: owner.name };
  } catch {
    return { source: intrinsicSource, name: owner.name };
  }
}

function functionOwnerSourceAndName(
  functionId: FunctionId,
  lookup: OwnerLookup,
): { source: SourceText; name: string } {
  const func = lookup.functions.get(functionId as number);
  if (func === undefined) return { source: intrinsicSource, name: `${functionId}` };
  const owner = lookup.items.get(func.itemId as number);
  if (owner === undefined) return { source: intrinsicSource, name: func.name };
  try {
    const declSource = (owner.declaration as { source: SourceText }).source;
    return { source: declSource, name: func.name };
  } catch {
    return { source: intrinsicSource, name: func.name };
  }
}

function checkDuplicateModules(modules: readonly ModuleRecord[]): ItemIndexDiagnostic[] {
  const sourceModules = modules.filter((mod) => mod.origin === "source");
  const sourceDiagnostics = reportDuplicatesByKey(
    sourceModules,
    (mod) => mod.pathKey,
    (mod) =>
      duplicateError(
        "ITEM_DUPLICATE_MODULE",
        `Duplicate source module '${mod.pathKey}'.`,
        mod.source ?? SourceText.from(mod.pathKey, ""),
        SourceSpan.from(0, 0),
      ),
  );

  const intrinsicModules = modules.filter((mod) => mod.origin === "intrinsic");
  const shadowDiagnostics: ItemIndexDiagnostic[] = [];
  const intrinsicPathKeys = new Set(intrinsicModules.map((mod) => mod.pathKey));
  for (const sourceMod of sourceModules) {
    if (intrinsicPathKeys.has(sourceMod.pathKey)) {
      shadowDiagnostics.push(
        duplicateError(
          "ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE",
          `Source module '${sourceMod.pathKey}' shadows an intrinsic module.`,
          sourceMod.source ?? SourceText.from(sourceMod.pathKey, ""),
          SourceSpan.from(0, 0),
        ),
      );
    }
  }

  const intrinsicDiagnostics = reportDuplicatesByKey(
    intrinsicModules,
    (mod) => mod.pathKey,
    (mod) =>
      duplicateError(
        "ITEM_DUPLICATE_MODULE",
        `Duplicate intrinsic module '${mod.pathKey}'.`,
        intrinsicSource,
        SourceSpan.from(0, 0),
      ),
  );

  return [...sourceDiagnostics, ...shadowDiagnostics, ...intrinsicDiagnostics];
}

function modulePathKey(moduleId: number, modules: readonly ModuleRecord[]): string {
  return modules[moduleId]?.pathKey ?? `${moduleId}`;
}

function checkDuplicateDeclarations(
  items: readonly ItemRecord[],
  lookup: OwnerLookup,
  modules: readonly ModuleRecord[],
): ItemIndexDiagnostic[] {
  const sourceItems = items.filter((item): item is SourceItemRecord => item.origin === "source");
  const result: ItemIndexDiagnostic[] = [];

  // Group by scope key: "moduleId:none" for top-level, "moduleId:parentItemId" for nested
  const byScope = new Map<string, SourceItemRecord[]>();
  for (const item of sourceItems) {
    const scopeKey = `${item.moduleId}:${item.parentItemId ?? "none"}`;
    let group = byScope.get(scopeKey);
    if (group === undefined) {
      group = [];
      byScope.set(scopeKey, group);
    }
    group.push(item);
  }

  for (const [, scopeItems] of byScope) {
    const batchDiagnostics = reportDuplicatesByKey(
      scopeItems,
      (item) => item.name,
      (item) => {
        const moduleName = modulePathKey(item.moduleId as number, modules);
        return duplicateError(
          "ITEM_DUPLICATE_DECLARATION",
          `Duplicate declaration '${item.name}' in module ${moduleName}.`,
          (item.declaration as { source: SourceText }).source,
          item.nameSpan,
        );
      },
    );
    result.push(...batchDiagnostics);
  }
  return result;
}

function checkDuplicateFields(
  fields: readonly FieldRecord[],
  lookup: OwnerLookup,
): ItemIndexDiagnostic[] {
  const result: ItemIndexDiagnostic[] = [];
  const byOwner = new Map<number, FieldRecord[]>();
  for (const field of fields) {
    const group = byOwner.get(field.ownerItemId as number);
    if (group) {
      group.push(field);
    } else {
      byOwner.set(field.ownerItemId as number, [field]);
    }
  }

  for (const [, ownerFields] of byOwner) {
    const ownerInfo = ownerSourceAndName(ownerFields[0]!.ownerItemId, lookup);
    const batchDiagnostics = reportDuplicatesByKey(
      ownerFields,
      (field) => field.name,
      (field) =>
        duplicateError(
          "ITEM_DUPLICATE_FIELD",
          `Duplicate field '${field.name}' in item ${ownerInfo.name}.`,
          ownerInfo.source,
          field.nameSpan,
        ),
    );
    result.push(...batchDiagnostics);
  }
  return result;
}

function checkDuplicateParameters(
  parameters: readonly ParameterRecord[],
  lookup: OwnerLookup,
): ItemIndexDiagnostic[] {
  const sourceParams = parameters.filter(
    (param): param is import("./item-records").SourceParameterRecord => param.origin === "source",
  );
  const result: ItemIndexDiagnostic[] = [];
  const byFunction = new Map<number, import("./item-records").SourceParameterRecord[]>();
  for (const param of sourceParams) {
    const group = byFunction.get(param.functionId as number);
    if (group) {
      group.push(param);
    } else {
      byFunction.set(param.functionId as number, [param]);
    }
  }

  for (const [, funcParams] of byFunction) {
    const ownerInfo = functionOwnerSourceAndName(funcParams[0]!.functionId, lookup);
    const batchDiagnostics = reportDuplicatesByKey(
      funcParams,
      (param) => param.name,
      (param) =>
        duplicateError(
          "ITEM_DUPLICATE_PARAMETER",
          `Duplicate parameter '${param.name}' in function ${ownerInfo.name}.`,
          ownerInfo.source,
          param.nameSpan,
        ),
    );
    result.push(...batchDiagnostics);
  }
  return result;
}

function checkDuplicateTypeParameters(
  typeParameters: readonly TypeParameterRecord[],
  lookup: OwnerLookup,
): ItemIndexDiagnostic[] {
  return reportDuplicatesByKey(
    typeParameters,
    (typeParam) => {
      const ownerKey =
        typeParam.owner.kind === "item"
          ? `item:${typeParam.owner.itemId}`
          : `function:${typeParam.owner.functionId}`;
      return `${ownerKey}:${typeParam.name}`;
    },
    (typeParam) => {
      let ownerName: string;
      let source: SourceText;
      if (typeParam.owner.kind === "item") {
        const info = ownerSourceAndName(typeParam.owner.itemId, lookup);
        ownerName = `item ${info.name}`;
        source = info.source;
      } else {
        const info = functionOwnerSourceAndName(typeParam.owner.functionId, lookup);
        ownerName = `function ${info.name}`;
        source = info.source;
      }
      return duplicateError(
        "ITEM_DUPLICATE_TYPE_PARAMETER",
        `Duplicate type parameter '${typeParam.name}' in ${ownerName}.`,
        source,
        typeParam.nameSpan,
      );
    },
  );
}

function checkDuplicateEnumCases(
  items: readonly ItemRecord[],
  lookup: OwnerLookup,
): ItemIndexDiagnostic[] {
  const sourceItems = items.filter((item): item is SourceItemRecord => item.origin === "source");
  const enumCases = sourceItems.filter((item) => item.kind === "enumCase");
  const result: ItemIndexDiagnostic[] = [];
  const byParent = new Map<number, SourceItemRecord[]>();
  for (const item of enumCases) {
    const parentId = item.parentItemId;
    if (parentId === undefined) continue;
    const group = byParent.get(parentId as number);
    if (group) {
      group.push(item);
    } else {
      byParent.set(parentId as number, [item]);
    }
  }

  for (const [, cases] of byParent) {
    const ownerInfo = ownerSourceAndName(cases[0]!.parentItemId!, lookup);
    const batchDiagnostics = reportDuplicatesByKey(
      cases,
      (caseItem) => caseItem.name,
      (caseItem) =>
        duplicateError(
          "ITEM_DUPLICATE_ENUM_CASE",
          `Duplicate enum case '${caseItem.name}' in enum ${ownerInfo.name}.`,
          (caseItem.declaration as { source: SourceText }).source,
          caseItem.nameSpan,
        ),
    );
    result.push(...batchDiagnostics);
  }
  return result;
}

function checkIntrinsicDuplicates(
  items: readonly ItemRecord[],
  modules: readonly ModuleRecord[],
): ItemIndexDiagnostic[] {
  const intrinsicItems = items.filter(
    (item): item is IntrinsicItemRecord => item.origin === "intrinsic",
  );

  const idDiagnostics = reportDuplicatesByKey(
    intrinsicItems,
    (item) => item.intrinsicId,
    (item) =>
      duplicateError(
        "ITEM_DUPLICATE_INTRINSIC_ID",
        `Duplicate intrinsic id '${item.intrinsicId}'.`,
        intrinsicSource,
        SourceSpan.from(0, 0),
      ),
  );

  const byModule = new Map<number, IntrinsicItemRecord[]>();
  for (const item of intrinsicItems) {
    const group = byModule.get(item.moduleId as number);
    if (group) {
      group.push(item);
    } else {
      byModule.set(item.moduleId as number, [item]);
    }
  }

  const nameDiagnostics: ItemIndexDiagnostic[] = [];
  for (const [moduleIdValue, moduleItems] of byModule) {
    const modulePath = modulePathKey(moduleIdValue, modules);
    const batchDiagnostics = reportDuplicatesByKey(
      moduleItems,
      (item) => item.name,
      (item) =>
        duplicateError(
          "ITEM_DUPLICATE_INTRINSIC_DECLARATION",
          `Duplicate intrinsic declaration '${item.name}' in module ${modulePath}.`,
          intrinsicSource,
          SourceSpan.from(0, 0),
        ),
    );
    nameDiagnostics.push(...batchDiagnostics);
  }

  return [...idDiagnostics, ...nameDiagnostics];
}

export function checkItemIndexDuplicates(records: ItemIndexRecords): ItemIndexDiagnostic[] {
  const lookup = buildOwnerLookup(records);
  const diagnostics: ItemIndexDiagnostic[] = [
    ...checkDuplicateModules(records.modules),
    ...checkDuplicateDeclarations(records.items, lookup, records.modules),
    ...checkDuplicateFields(records.fields, lookup),
    ...checkDuplicateParameters(records.parameters, lookup),
    ...checkDuplicateTypeParameters(records.typeParameters, lookup),
    ...checkDuplicateEnumCases(records.items, lookup),
    ...checkIntrinsicDuplicates(records.items, records.modules),
  ];

  return diagnostics.sort((left, right) => {
    const nameCmp = left.source.name.localeCompare(right.source.name);
    if (nameCmp !== 0) return nameCmp;
    const startCmp = left.span.start - right.span.start;
    if (startCmp !== 0) return startCmp;
    const endCmp = left.span.end - right.span.end;
    if (endCmp !== 0) return endCmp;
    return left.code.localeCompare(right.code);
  });
}
