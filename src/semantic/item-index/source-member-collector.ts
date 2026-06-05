import { SyntaxKind } from "../../frontend/syntax";
import type {
  DeclarationView,
  HasTypeParameters,
  HasFields,
  HasMemberFunctions,
  HasEnumCases,
} from "../../frontend/ast/declaration-views";
import type { TypeParameterView } from "../../frontend/ast/type-views";
import type { ImageDeclarationView } from "../../frontend/ast/image-views";
import type { ValidatedBufferDeclarationView } from "../../frontend/ast/validated-buffer-views";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import { BlockView } from "../../frontend/ast/statement-views";
import { childNode, blockItems } from "../../frontend/ast/syntax-query";
import type { RedNode } from "../../frontend/syntax";
import {
  type FunctionId,
  type ItemId,
  type ModuleId,
  type ParameterId,
  fieldId,
  functionId,
  itemId,
  parameterId,
} from "../ids";
import type {
  FieldRecord,
  FieldRole,
  FunctionRecord,
  ImageRecord,
  ItemIndexRecords,
  ParameterRecord,
  SourceItemRecord,
  TypeParameterRecord,
  TypeRecord,
} from "./item-records";
import type { SourceCollectionResult, SourceDeclarationWorkItem } from "./source-module-collector";

export interface SourceMemberCollectionContext {
  items: SourceItemRecord[];
  types: TypeRecord[];
  functions: FunctionRecord[];
  images: ImageRecord[];
  fields: FieldRecord[];
  typeParameters: TypeParameterRecord[];
  parameters: ParameterRecord[];
  workQueue: SourceDeclarationWorkItem[];
  toResult(): ItemIndexRecords;
}

function createContext(source: SourceCollectionResult): SourceMemberCollectionContext {
  const types = [...source.types];
  const functions = [...source.functions];
  const images = [...source.images];
  const fields: FieldRecord[] = [];
  const typeParameters: TypeParameterRecord[] = [];
  const parameters: ParameterRecord[] = [];
  const workQueue = [...source.declarationWorkItems];

  return {
    items: [],
    types,
    functions,
    images,
    fields,
    typeParameters,
    parameters,
    workQueue,
    toResult(): ItemIndexRecords {
      return {
        modules: source.modules,
        items: this.items,
        types: this.types,
        functions: this.functions,
        images: this.images,
        fields: this.fields,
        typeParameters: this.typeParameters,
        parameters: this.parameters,
      };
    },
  };
}

function addItem(context: SourceMemberCollectionContext, item: SourceItemRecord): void {
  context.items.push(item);
}

function addFunction(context: SourceMemberCollectionContext, record: FunctionRecord): void {
  context.functions.push(record);
}

function addField(context: SourceMemberCollectionContext, record: FieldRecord): void {
  context.fields.push(record);
}

function addTypeParameter(
  context: SourceMemberCollectionContext,
  record: TypeParameterRecord,
): void {
  context.typeParameters.push(record);
}

function addParameter(context: SourceMemberCollectionContext, record: ParameterRecord): void {
  context.parameters.push(record);
}

function collectItemTypeParameters(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  parameters: readonly TypeParameterView[],
): void {
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!;
    const name = parameter.nameText();
    const nameSpan = parameter.nameSpan();
    if (name === undefined || nameSpan === undefined) continue;
    addTypeParameter(context, {
      owner: { kind: "item", itemId: item.id },
      index,
      name,
      nameSpan,
      span: parameter.span,
      bound: parameter.bound(),
    });
  }
}

function collectFunctionTypeParameters(
  context: SourceMemberCollectionContext,
  itemIdValue: ItemId,
  functionIdValue: FunctionId,
  parameters: readonly TypeParameterView[],
): void {
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!;
    const name = parameter.nameText();
    const nameSpan = parameter.nameSpan();
    if (name === undefined || nameSpan === undefined) continue;
    addTypeParameter(context, {
      owner: { kind: "function", itemId: itemIdValue, functionId: functionIdValue },
      index,
      name,
      nameSpan,
      span: parameter.span,
      bound: parameter.bound(),
    });
  }
}

function collectFunctionDeclaration(
  context: SourceMemberCollectionContext,
  node: RedNode,
  parentItemId: ItemId,
  moduleIdValue: ModuleId,
  _owningFunctionId?: FunctionId,
): void {
  const fnView = FunctionDeclarationView.from(node);
  if (fnView === undefined) return;
  const name = fnView.nameText();
  const nameSpan = fnView.nameSpan();
  if (name === undefined || nameSpan === undefined) return;

  const funcId = functionId(context.functions.length);
  const itemRec: SourceItemRecord = {
    id: itemId(context.items.length),
    kind: "function",
    moduleId: moduleIdValue,
    parentItemId,
    name,
    modifiers: fnView.modifiers() as SourceItemRecord["modifiers"],
    nameSpan,
    span: fnView.span,
    declaration: fnView,
    functionId: funcId,
  };

  addFunction(context, {
    id: funcId,
    itemId: itemRec.id,
    moduleId: moduleIdValue,
    parentItemId,
    name,
    parameterIds: [],
  });

  collectFunctionTypeParameters(context, itemRec.id, funcId, fnView.typeParameters());
  collectFunctionParameters(context, funcId, fnView);
  addItem(context, itemRec);

  const body = fnView.body();
  if (body !== undefined) {
    collectNestedFunctionsInFunctionBody(context, funcId, itemRec.id, moduleIdValue, body);
  }
}

function collectNestedFunctionsInFunctionBody(
  context: SourceMemberCollectionContext,
  ownerFunctionId: FunctionId,
  ownerItemId: ItemId,
  moduleIdValue: ModuleId,
  body: BlockView,
): void {
  for (const itemNode of walkStatementTree(body.items())) {
    if (itemNode.kind === SyntaxKind.FunctionDeclaration) {
      collectFunctionDeclaration(context, itemNode, ownerItemId, moduleIdValue, ownerFunctionId);
    }
  }
}

function walkStatementTree(items: readonly RedNode[]): RedNode[] {
  const result: RedNode[] = [];

  function walk(node: RedNode): void {
    result.push(node);
    if (node.kind === SyntaxKind.IfStatement) {
      const block = childNode(node, SyntaxKind.Block);
      if (block !== undefined) {
        for (const child of blockItems(block)) {
          walk(child);
        }
      }
      const elseClause = childNode(node, SyntaxKind.ElseClause);
      if (elseClause !== undefined) {
        const elseBlock = childNode(elseClause, SyntaxKind.Block);
        if (elseBlock !== undefined) {
          for (const child of blockItems(elseBlock)) {
            walk(child);
          }
        }
      }
    } else if (
      node.kind === SyntaxKind.ForStatement ||
      node.kind === SyntaxKind.WhileStatement ||
      node.kind === SyntaxKind.LoopStatement
    ) {
      const block = childNode(node, SyntaxKind.Block);
      if (block !== undefined) {
        for (const child of blockItems(block)) {
          walk(child);
        }
      }
    } else if (node.kind === SyntaxKind.MatchStatement) {
      const block = childNode(node, SyntaxKind.Block);
      if (block !== undefined) {
        for (const child of blockItems(block)) {
          walk(child);
        }
      }
    } else if (node.kind === SyntaxKind.MatchCase) {
      const block = childNode(node, SyntaxKind.Block);
      if (block !== undefined) {
        for (const child of blockItems(block)) {
          walk(child);
        }
      }
    }
  }

  for (const item of items) {
    walk(item);
  }
  return result;
}

function collectFunctionParameters(
  context: SourceMemberCollectionContext,
  functionIdValue: FunctionId,
  fnView: FunctionDeclarationView,
): void {
  const params = fnView.parameters();
  const paramIds: ParameterId[] = [];

  for (let index = 0; index < params.length; index++) {
    const param = params[index]!;
    const name = param.nameText();
    const nameSpan = param.nameSpan();
    if (name === undefined || nameSpan === undefined) continue;

    const paramId = parameterId(context.parameters.length);
    paramIds.push(paramId);

    addParameter(context, {
      id: paramId,
      functionId: functionIdValue,
      index: index,
      name,
      isConsumed: param.isConsumed(),
      nameSpan,
      span: param.span,
      type: param.type(),
    });
  }

  const funcIndex = context.functions.findIndex((func) => func.id === functionIdValue);
  if (funcIndex >= 0) {
    context.functions[funcIndex] = {
      ...context.functions[funcIndex]!,
      parameterIds: paramIds,
    };
  }
}

function isTypeLikeDeclaration(
  declaration: DeclarationView,
): declaration is DeclarationView & HasTypeParameters & HasFields & HasMemberFunctions {
  switch (declaration.kind) {
    case SyntaxKind.DataclassDeclaration:
    case SyntaxKind.ClassDeclaration:
    case SyntaxKind.EdgeClassDeclaration:
    case SyntaxKind.InterfaceDeclaration:
    case SyntaxKind.StreamDeclaration:
      return true;
    default:
      return false;
  }
}

function collectTypeLikeDeclaration(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  source: HasTypeParameters & HasFields & HasMemberFunctions,
): void {
  collectItemTypeParameters(context, item, source.typeParameters());
  collectFields(context, item, source.fields(), "field");
  collectMemberFunctions(context, item, source.memberFunctions());
}

function collectEnumDeclaration(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  source: HasTypeParameters & HasMemberFunctions & HasEnumCases,
): void {
  collectItemTypeParameters(context, item, source.typeParameters());

  for (const enumCase of source.enumCases()) {
    const caseName = enumCase.nameText();
    const caseNameSpan = enumCase.nameSpan();
    if (caseName === undefined || caseNameSpan === undefined) continue;

    addItem(context, {
      id: itemId(context.items.length),
      kind: "enumCase",
      moduleId: item.moduleId,
      parentItemId: item.id,
      name: caseName,
      modifiers: [],
      nameSpan: caseNameSpan,
      span: enumCase.span,
      declaration: enumCase,
    });
  }

  collectMemberFunctions(context, item, source.memberFunctions());
}

function collectImageDeclaration(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  source: ImageDeclarationView,
): void {
  collectFields(context, item, source.fields(), "field");
  collectFields(context, item, source.deviceFields(), "imageDevice");
  collectMemberFunctions(context, item, source.memberFunctions());

  const imageRecIdx = context.images.findIndex((img) => img.itemId === item.id);
  if (imageRecIdx >= 0) {
    const fieldIds = context.fields
      .filter((field) => field.ownerItemId === item.id && field.role === "field")
      .map((field) => field.id);
    const deviceFieldIds = context.fields
      .filter((field) => field.ownerItemId === item.id && field.role === "imageDevice")
      .map((field) => field.id);
    context.images[imageRecIdx] = {
      ...context.images[imageRecIdx]!,
      fieldIds,
      deviceFieldIds,
    };
  }
}

function collectFunctionItemDeclaration(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  source: FunctionDeclarationView,
): void {
  const functionIdValue = item.functionId;
  if (functionIdValue === undefined) return;

  collectFunctionTypeParameters(context, item.id, functionIdValue, source.typeParameters());
  collectFunctionParameters(context, functionIdValue, source);

  const body = source.body();
  if (body !== undefined) {
    collectNestedFunctionsInFunctionBody(context, functionIdValue, item.id, item.moduleId, body);
  }
}

function collectDeclarationLocalRecords(
  context: SourceMemberCollectionContext,
  workItem: SourceDeclarationWorkItem,
): void {
  const { item, declaration } = workItem;
  const kind = declaration.kind;

  if (isTypeLikeDeclaration(declaration)) {
    collectTypeLikeDeclaration(context, item, declaration);
    return;
  }

  switch (kind) {
    case SyntaxKind.EnumDeclaration:
      collectEnumDeclaration(
        context,
        item,
        declaration as unknown as HasTypeParameters & HasMemberFunctions & HasEnumCases,
      );
      break;

    case SyntaxKind.ImageDeclaration:
      collectImageDeclaration(context, item, declaration as unknown as ImageDeclarationView);
      break;

    case SyntaxKind.ValidatedBufferDeclaration:
      collectFields(
        context,
        item,
        (declaration as unknown as ValidatedBufferDeclarationView).paramFields(),
        "validatedParam",
      );
      collectLayoutFields(
        context,
        item,
        (declaration as unknown as ValidatedBufferDeclarationView).layoutFields(),
        "layoutField",
      );
      break;

    case SyntaxKind.FunctionDeclaration:
      collectFunctionItemDeclaration(context, item, declaration as FunctionDeclarationView);
      break;
  }
}

function collectFields(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  fieldViews: readonly import("../../frontend/ast/field-views").FieldDeclarationView[],
  role: FieldRole,
): void {
  for (const fieldView of fieldViews) {
    const name = fieldView.nameText();
    const nameSpan = fieldView.nameSpan();
    if (name === undefined || nameSpan === undefined) continue;

    addField(context, {
      id: fieldId(context.fields.length),
      ownerItemId: item.id,
      role,
      name,
      nameSpan,
      span: fieldView.span,
      type: fieldView.type(),
    });
  }
}

function collectLayoutFields(
  context: SourceMemberCollectionContext,
  item: SourceItemRecord,
  fieldViews: readonly import("../../frontend/ast/field-views").LayoutFieldView[],
  role: FieldRole,
): void {
  for (const fieldView of fieldViews) {
    const name = fieldView.nameText();
    const nameSpan = fieldView.nameSpan();
    if (name === undefined || nameSpan === undefined) continue;

    addField(context, {
      id: fieldId(context.fields.length),
      ownerItemId: item.id,
      role,
      name,
      nameSpan,
      span: fieldView.span,
      type: fieldView.type(),
    });
  }
}

function collectMemberFunctions(
  context: SourceMemberCollectionContext,
  parentItem: SourceItemRecord,
  memberFnViews: readonly import("../../frontend/ast/function-views").FunctionDeclarationView[],
): void {
  for (const fnView of memberFnViews) {
    collectFunctionDeclaration(context, fnView.node, parentItem.id, parentItem.moduleId);
  }
}

export function collectSourceMembers(context: SourceMemberCollectionContext): ItemIndexRecords {
  const oldToNewItemId = new Map<ItemId, ItemId>();

  // Record the count of Phase 1 records so we only remap those (Phase 2 records
  // already have correct itemIds from the sequential append order).
  const phase1FunctionCount = context.functions.length;
  const phase1TypeCount = context.types.length;
  const phase1ImageCount = context.images.length;

  for (const workItem of context.workQueue) {
    const oldId = workItem.item.id;
    const newId = itemId(context.items.length);

    context.items.push({ ...workItem.item, id: newId });
    oldToNewItemId.set(oldId, newId);

    collectDeclarationLocalRecords(context, {
      item: context.items[context.items.length - 1]!,
      declaration: workItem.declaration,
    });
  }

  // Only remap Phase 1 records. Phase 2 records (created by
  // collectDeclarationLocalRecords above) already have correct itemIds.
  for (let index = 0; index < phase1TypeCount; index++) {
    const typeRec = context.types[index]!;
    context.types[index] = {
      ...typeRec,
      itemId: oldToNewItemId.get(typeRec.itemId) ?? typeRec.itemId,
    };
  }
  for (let index = 0; index < phase1FunctionCount; index++) {
    const funcRec = context.functions[index]!;
    context.functions[index] = {
      ...funcRec,
      itemId: oldToNewItemId.get(funcRec.itemId) ?? funcRec.itemId,
    };
  }
  for (let index = 0; index < phase1ImageCount; index++) {
    const imageRec = context.images[index]!;
    context.images[index] = {
      ...imageRec,
      itemId: oldToNewItemId.get(imageRec.itemId) ?? imageRec.itemId,
    };
  }

  return context.toResult();
}

export function createSourceMemberContext(
  source: SourceCollectionResult,
): SourceMemberCollectionContext {
  return createContext(source);
}
