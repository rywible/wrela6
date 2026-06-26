import { SourceSpan } from "../shared/source-span";
import { FunctionDeclarationView } from "../frontend/ast/function-views";
import type { RedNode } from "../frontend/syntax/red-node";
import type { FieldId, FunctionId, ItemId, ModuleId, TypeId } from "../semantic/ids";
import { concreteKind, errorKind, joinResourceKinds } from "../semantic/surface/resource-kind";
import type { TypeParameterKey } from "../semantic/surface/resource-kind";
import { errorCheckedType } from "../semantic/surface/type-model";
import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type {
  HirDeclaration,
  HirEnumCaseRecord,
  HirFieldRecord,
  HirFieldTable,
  HirFunction,
  HirImage,
  HirLocal,
  HirTypeRecord,
  HirTypeTable,
  HirValidatedBuffer,
  TypedHirProgram,
} from "./hir";
import { hirTable } from "./hir-table";
import {
  createFunctionHirContext,
  createHirProgramContext,
  hirDiagnostic,
} from "./lowering-context";
import type { HirLoweringContext, LowerTypedHirInput } from "./lowering-context";
import { lowerBlockSkeleton } from "./body-lowerer";
import { lowerValidatedBuffers } from "./validated-buffer-lowerer";
import { lowerSelectedImage } from "./image-lowerer";
import { sortHirDiagnostics } from "./diagnostics";
import type { HirDiagnostic } from "./diagnostics";
import type { HirOriginId } from "./ids";
import { lowerRequirementSurface } from "./requirement-lowerer";
import { lowerMonoClosureSurface } from "./mono-closure-lowerer";

export type { LowerTypedHirInput } from "./lowering-context";

export interface LowerTypedHirResult {
  readonly program: TypedHirProgram;
  readonly diagnostics: readonly HirDiagnostic[];
}

function declarationNode(declaration: object): RedNode | undefined {
  if ("node" in declaration) {
    const node = (declaration as { readonly node?: unknown }).node;
    if (typeof node === "object" && node !== null && "kind" in node) return node as RedNode;
  }
  return undefined;
}

function declarationKind(itemKind: string): HirDeclaration["kind"] {
  switch (itemKind) {
    case "function":
      return "function";
    case "validatedBuffer":
      return "validatedBuffer";
    case "image":
      return "image";
    case "class":
    case "dataclass":
    case "enum":
    case "edgeClass":
    case "interface":
    case "stream":
      return "type";
    default:
      return "recovered";
  }
}

function emptyLocalTable(locals: readonly HirLocal[] = []) {
  return hirTable({
    entries: locals,
    keyOf: (local) => String(local.localId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function functionBodyView(node: RedNode | undefined): FunctionDeclarationView | undefined {
  return node !== undefined ? FunctionDeclarationView.from(node) : undefined;
}

function moduleSpan(context: HirLoweringContext, moduleId: ModuleId): SourceSpan {
  const source = context.index.module(moduleId)?.source;
  return source !== undefined ? source.span(0, source.length) : SourceSpan.from(0, 0);
}

function originForDeclaration(input: {
  readonly context: HirLoweringContext;
  readonly itemId: ItemId;
  readonly functionId?: FunctionId;
  readonly moduleId: ModuleId;
  readonly declaration: object;
  readonly span: SourceSpan;
  readonly stableDetail: string;
}): HirOriginId {
  const node = declarationNode(input.declaration);
  if (node !== undefined) {
    return input.context.origins.forSyntax({
      moduleId: input.moduleId,
      node,
      ownerItemId: input.itemId,
      ownerFunctionId: input.functionId,
    });
  }
  return input.context.origins.forSynthetic({
    moduleId: input.moduleId,
    span: input.span,
    stableDetail: input.stableDetail,
    ownerItemId: input.itemId,
    ownerFunctionId: input.functionId,
  });
}

function emptyDeclarationTable(entries: readonly HirDeclaration[]) {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.itemId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function functionTable(entries: readonly HirFunction[]) {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.functionId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function validatedBufferTable(entries: readonly HirValidatedBuffer[]) {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function imageTable(entries: readonly HirImage[]) {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.imageId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function typeTable(entries: readonly HirTypeRecord[]): HirTypeTable {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.typeId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function fieldTable(entries: readonly HirFieldRecord[]): HirFieldTable {
  return hirTable({
    entries,
    keyOf: (entry) => String(entry.fieldId).padStart(12, "0"),
    lookupKeyOf: (id) => String(id).padStart(12, "0"),
  });
}

function declaredTypeParametersForItem(input: {
  readonly context: HirLoweringContext;
  readonly itemId: ItemId;
}): readonly TypeParameterKey[] {
  return [...input.context.index.typeParametersForItem(input.itemId)]
    .sort((left, right) => left.index - right.index)
    .map((parameter) => ({
      owner: { kind: "item", itemId: input.itemId },
      index: parameter.index,
    }));
}

function declaredTypeParametersForFunction(input: {
  readonly context: HirLoweringContext;
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
}): readonly TypeParameterKey[] {
  return [...input.context.index.typeParametersForFunction(input.functionId)]
    .sort((left, right) => left.index - right.index)
    .map((parameter) => ({
      owner: { kind: "function", itemId: input.itemId, functionId: input.functionId },
      index: parameter.index,
    }));
}

function ownerTypeIdForFunction(input: {
  readonly context: HirLoweringContext;
  readonly signature: CheckedFunctionSignature;
}): TypeId | undefined {
  if (input.signature.ownerItemId === undefined) return undefined;
  const ownerItem = input.context.index.item(input.signature.ownerItemId);
  return ownerItem?.typeId;
}

function typeIdForItem(input: {
  readonly context: HirLoweringContext;
  readonly itemId: ItemId;
}): TypeId | undefined {
  return input.context.index.item(input.itemId)?.typeId;
}

function fieldIdsForTypeItem(input: {
  readonly context: HirLoweringContext;
  readonly itemId: ItemId;
}): readonly FieldId[] {
  return input.context.index
    .fieldsForItem(input.itemId)
    .filter((field) => field.role === "field")
    .map((field) => field.id);
}

function originForEnumCase(input: {
  readonly context: HirLoweringContext;
  readonly caseItemId: ItemId;
  readonly moduleId: ModuleId;
  readonly ownerItemId: ItemId;
  readonly span: SourceSpan;
  readonly declaration: object;
}): HirOriginId {
  const node = declarationNode(input.declaration);
  if (node !== undefined) {
    return input.context.origins.forSyntax({
      moduleId: input.moduleId,
      node,
      ownerItemId: input.ownerItemId,
    });
  }
  return input.context.origins.forSynthetic({
    moduleId: input.moduleId,
    span: input.span,
    stableDetail: `enumCase:${input.caseItemId}`,
    ownerItemId: input.ownerItemId,
  });
}

function enumCasesForTypeItem(input: {
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
}): readonly HirEnumCaseRecord[] {
  const item = input.context.index.item(input.itemId);
  if (item?.kind !== "enum") return [];

  const enumCaseItems = input.context.index
    .items()
    .filter((caseItem) => caseItem.kind === "enumCase" && caseItem.parentItemId === input.itemId);

  return enumCaseItems.map((caseItem, ordinal) => ({
    enumTypeId: input.typeId,
    caseItemId: caseItem.id,
    name: caseItem.name,
    ordinal,
    sourceOrigin: originForEnumCase({
      context: input.context,
      caseItemId: caseItem.id,
      moduleId: input.moduleId,
      ownerItemId: input.itemId,
      span: caseItem.span,
      declaration: caseItem.declaration,
    }),
  }));
}

function lowerTypeRecord(input: {
  readonly context: HirLoweringContext;
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly sourceOrigin: HirOriginId;
}): HirTypeRecord | undefined {
  const item = input.context.index.item(input.itemId);
  if (item === undefined) return undefined;
  return {
    typeId: input.typeId,
    itemId: input.itemId,
    sourceKind: item.kind,
    declaredTypeParameters: declaredTypeParametersForItem({
      context: input.context,
      itemId: input.itemId,
    }),
    fieldIds: fieldIdsForTypeItem({ context: input.context, itemId: input.itemId }),
    enumCases: enumCasesForTypeItem({
      context: input.context,
      typeId: input.typeId,
      itemId: input.itemId,
      moduleId: input.moduleId,
    }),
    resourceKind: joinFieldResourceKinds({
      context: input.context,
      itemId: input.itemId,
    }),
    sourceOrigin: input.sourceOrigin,
  };
}

function joinFieldResourceKinds(input: {
  readonly context: HirLoweringContext;
  readonly itemId: ItemId;
}) {
  const item = input.context.index.item(input.itemId);
  const typeId = item?.typeId;
  if (typeId !== undefined) {
    const constructorRule = input.context.program.monoClosureFacts.constructorKindRules.get({
      kind: "source",
      typeId,
    });
    if (constructorRule?.resultKind !== undefined) {
      return constructorRule.resultKind;
    }
  }
  const fieldRecords = input.context.index
    .fieldsForItem(input.itemId)
    .filter((field) => field.role === "field")
    .map((field) => input.context.program.fields.get(field.id))
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .map((record) => record.resourceKind);
  if (fieldRecords.length === 0) return concreteKind("Copy");
  return joinResourceKinds(fieldRecords);
}

function recoverySignature(input: {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly span: SourceSpan;
}): CheckedFunctionSignature {
  return {
    functionId: input.functionId,
    itemId: input.itemId,
    parameters: [],
    returnType: errorCheckedType(),
    returnKind: errorKind(),
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: input.span,
  };
}

export class TypedHirBuilder {
  private readonly context: HirLoweringContext;
  private readonly declarations: HirDeclaration[] = [];
  private readonly typeRecords: HirTypeRecord[] = [];
  private readonly fieldRecords: HirFieldRecord[] = [];
  private readonly functions: HirFunction[] = [];
  private readonly validatedBuffers: HirValidatedBuffer[] = [];
  private readonly images: HirImage[] = [];

  constructor(input: LowerTypedHirInput) {
    this.context = createHirProgramContext(input);
  }

  lowerDeclarations(): void {
    for (const item of this.context.index.items()) {
      const sourceOrigin = originForDeclaration({
        context: this.context,
        itemId: item.id,
        functionId: item.functionId,
        moduleId: item.moduleId,
        declaration: item.declaration,
        span: item.span,
        stableDetail: `declaration:${item.id}`,
      });
      this.declarations.push({
        itemId: item.id,
        kind: declarationKind(item.kind),
        name: item.name,
        sourceOrigin,
        ...(item.typeId !== undefined ? { typeId: item.typeId } : {}),
        ...(item.functionId !== undefined ? { functionId: item.functionId } : {}),
        ...(item.imageId !== undefined ? { imageId: item.imageId } : {}),
      });
    }
    this.lowerTypeAndFieldRecords();
    this.validatedBuffers.push(...lowerValidatedBuffers({ context: this.context }));
  }

  private lowerTypeAndFieldRecords(): void {
    for (const typeRecord of this.context.index.types()) {
      const item = this.context.index.item(typeRecord.itemId);
      if (item === undefined) continue;
      const sourceOrigin = this.context.origins.forSynthetic({
        moduleId: typeRecord.moduleId,
        span: item.span,
        stableDetail: `type:${typeRecord.id}`,
        ownerItemId: typeRecord.itemId,
      });
      const lowered = lowerTypeRecord({
        context: this.context,
        typeId: typeRecord.id,
        itemId: typeRecord.itemId,
        moduleId: typeRecord.moduleId,
        sourceOrigin,
      });
      if (lowered !== undefined) this.typeRecords.push(lowered);
    }
    for (const field of this.context.index.fields()) {
      if (field.role !== "field" && field.role !== "validatedParam") {
        continue;
      }
      const checkedField = this.context.program.fields.get(field.id);
      if (checkedField === undefined) continue;
      const ownerTypeId = typeIdForItem({
        context: this.context,
        itemId: field.ownerItemId,
      });
      if (ownerTypeId === undefined) continue;
      const sourceOrigin = this.context.origins.forSynthetic({
        moduleId: this.context.index.item(field.ownerItemId)?.moduleId ?? (0 as ModuleId),
        span: field.span,
        stableDetail: `field:${field.id}`,
        ownerItemId: field.ownerItemId,
      });
      this.fieldRecords.push({
        fieldId: field.id,
        ownerTypeId,
        name: field.name,
        type: checkedField.type,
        resourceKind: checkedField.resourceKind,
        sourceOrigin,
      });
    }
  }

  lowerFunctionShells(): void {
    const seen = new Set<FunctionId>();
    for (const signature of this.context.program.functions.entries()) {
      seen.add(signature.functionId);
      this.functions.push(this.lowerFunctionShell(signature));
    }

    for (const functionRecord of this.context.index.functions()) {
      if (seen.has(functionRecord.id)) continue;
      const item = this.context.index.item(functionRecord.itemId);
      const span = item?.span ?? moduleSpan(this.context, functionRecord.moduleId);
      const signature = recoverySignature({
        functionId: functionRecord.id,
        itemId: functionRecord.itemId,
        span,
      });
      const sourceOrigin = this.context.origins.forSynthetic({
        moduleId: functionRecord.moduleId,
        span,
        stableDetail: `bodyless:${functionRecord.id}`,
        ownerItemId: functionRecord.itemId,
        ownerFunctionId: functionRecord.id,
      });
      this.context.diagnostics.report(
        hirDiagnostic({
          code: "HIR_BODYLESS_RECOVERY",
          message: `Missing checked signature for function '${functionRecord.name}'.`,
          moduleId: functionRecord.moduleId,
          spanStart: span.start,
          spanEnd: span.end,
          originId: sourceOrigin,
          ownerKey: `function:${functionRecord.id}`,
          originKey: `bodyless:${functionRecord.id}`,
          stableDetail: functionRecord.name,
        }),
      );
      this.functions.push({
        functionId: functionRecord.id,
        itemId: functionRecord.itemId,
        ...(ownerTypeIdForFunction({
          context: this.context,
          signature,
        }) !== undefined
          ? {
              ownerTypeId: ownerTypeIdForFunction({
                context: this.context,
                signature,
              })!,
            }
          : {}),
        signature,
        declaredTypeParameters: declaredTypeParametersForFunction({
          context: this.context,
          functionId: functionRecord.id,
          itemId: functionRecord.itemId,
        }),
        bodyStatus: "bodylessRecovery",
        locals: emptyLocalTable(),
        declaredRequirements: [],
        sourceOrigin,
      });
    }
  }

  lowerSelectedImage(): void {
    this.images.push(...lowerSelectedImage({ context: this.context }).images);
  }

  build(): LowerTypedHirResult {
    const program: TypedHirProgram = {
      declarations: emptyDeclarationTable(this.declarations),
      types: typeTable(this.typeRecords),
      fields: fieldTable(this.fieldRecords),
      functions: functionTable(this.functions),
      validatedBuffers: validatedBufferTable(this.validatedBuffers),
      images: imageTable(this.images),
      proofMetadata: this.context.proofMetadata.build(),
      monoClosure: lowerMonoClosureSurface({
        context: this.context,
        typeRecords: this.typeRecords,
      }),
      origins: this.context.origins,
    };
    return {
      program,
      diagnostics: sortHirDiagnostics(this.context.diagnostics.entries()),
    };
  }

  private lowerFunctionShell(signature: CheckedFunctionSignature): HirFunction {
    const item = this.context.index.item(signature.itemId);
    const moduleId = item?.moduleId ?? (0 as ModuleId);
    const declaration = item?.declaration;
    const node = declaration !== undefined ? declarationNode(declaration) : undefined;
    const sourceOrigin = originForDeclaration({
      context: this.context,
      itemId: signature.itemId,
      functionId: signature.functionId,
      moduleId,
      declaration: declaration ?? {},
      span: signature.sourceSpan,
      stableDetail: `function:${signature.functionId}`,
    });
    const functionContext = createFunctionHirContext({
      parent: this.context,
      signature,
      ownerItemId: signature.itemId,
      ownerModuleId: moduleId,
      originForParameter: (parameter) =>
        this.context.origins.forSynthetic({
          moduleId,
          span: "sourceSpan" in parameter ? parameter.sourceSpan : signature.sourceSpan,
          stableDetail: `parameter:${parameter.parameterId}`,
          ownerItemId: signature.itemId,
          ownerFunctionId: signature.functionId,
        }),
    });
    const functionView = functionBodyView(node);
    const isCertifiedPlatform =
      this.context.program.certifiedPlatformBindings.get(signature.functionId) !== undefined;
    const hasBody = functionView?.body() !== undefined;
    const bodyStatus = isCertifiedPlatform
      ? "certifiedPlatform"
      : hasBody
        ? "sourceBody"
        : "bodylessRecovery";
    const body =
      bodyStatus === "sourceBody"
        ? lowerBlockSkeleton({
            block: functionView?.body(),
            context: functionContext,
            sourceOrigin,
          })
        : undefined;
    const requirementSurfaces =
      this.context.program.proofSurface.requirementSurfaces.get(signature.functionId) ?? [];
    const declaredRequirements = requirementSurfaces.map((surface, ordinal) =>
      lowerRequirementSurface({
        surface,
        owner: { kind: "function", functionId: signature.functionId },
        context: functionContext,
        ordinal,
      }),
    );
    const bodyIndex = body !== undefined ? functionContext.bodyIndex.build() : undefined;
    for (const place of functionContext.places.entries()) {
      this.context.proofMetadata.addResourcePlace(place);
    }
    const ownerTypeId = ownerTypeIdForFunction({
      context: this.context,
      signature,
    });

    return {
      functionId: signature.functionId,
      itemId: signature.itemId,
      ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
      signature,
      declaredTypeParameters: declaredTypeParametersForFunction({
        context: this.context,
        functionId: signature.functionId,
        itemId: signature.itemId,
      }),
      bodyStatus,
      locals: emptyLocalTable(functionContext.locals.locals()),
      ...(body !== undefined && bodyIndex !== undefined ? { body, bodyIndex } : {}),
      declaredRequirements,
      sourceOrigin,
    };
  }
}

export function lowerTypedHir(input: LowerTypedHirInput): LowerTypedHirResult {
  const builder = new TypedHirBuilder(input);
  builder.lowerDeclarations();
  builder.lowerSelectedImage();
  builder.lowerFunctionShells();
  return builder.build();
}
