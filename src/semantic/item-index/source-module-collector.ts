import { SourceFileView, type DeclarationView } from "../../frontend/ast/declaration-views";
import type { ParsedModule } from "../../frontend/module-graph-parser";
import { SyntaxKind } from "../../frontend/syntax";
import {
  functionId,
  imageId,
  itemId,
  moduleId,
  typeId,
  type FunctionId,
  type ImageId,
  type TypeId,
} from "../ids";
import type {
  FunctionRecord,
  ImageRecord,
  ModuleRecord,
  SourceItemKind,
  SourceItemModifier,
  SourceItemRecord,
  TypeParameterRecord,
  TypeRecord,
} from "./item-records";

export interface SourceDeclarationWorkItem {
  readonly item: SourceItemRecord;
  readonly declaration: DeclarationView;
}

export interface SourceCollectionResult {
  readonly modules: readonly ModuleRecord[];
  readonly items: readonly SourceItemRecord[];
  readonly types: readonly TypeRecord[];
  readonly functions: readonly FunctionRecord[];
  readonly images: readonly ImageRecord[];
  readonly typeParameters: readonly TypeParameterRecord[];
  readonly declarationWorkItems: readonly SourceDeclarationWorkItem[];
}

function sortModules(modules: readonly ParsedModule[]): ParsedModule[] {
  return [...modules].sort((left, right) => {
    const keyCmp = left.path.key.localeCompare(right.path.key);
    if (keyCmp !== 0) return keyCmp;
    const nameCmp = left.source.name.localeCompare(right.source.name);
    if (nameCmp !== 0) return nameCmp;
    return left.source.text.localeCompare(right.source.text);
  });
}

function declarationKindToSourceKind(kind: SyntaxKind): SourceItemKind {
  switch (kind) {
    case SyntaxKind.EnumDeclaration:
      return "enum";
    case SyntaxKind.EnumCase:
      return "enumCase";
    case SyntaxKind.DataclassDeclaration:
      return "dataclass";
    case SyntaxKind.ClassDeclaration:
      return "class";
    case SyntaxKind.EdgeClassDeclaration:
      return "edgeClass";
    case SyntaxKind.InterfaceDeclaration:
      return "interface";
    case SyntaxKind.StreamDeclaration:
      return "stream";
    case SyntaxKind.ValidatedBufferDeclaration:
      return "validatedBuffer";
    case SyntaxKind.ImageDeclaration:
      return "image";
    case SyntaxKind.FunctionDeclaration:
      return "function";
    default:
      return "function";
  }
}

function isTypeLike(kind: SyntaxKind): boolean {
  switch (kind) {
    case SyntaxKind.EnumDeclaration:
    case SyntaxKind.DataclassDeclaration:
    case SyntaxKind.ClassDeclaration:
    case SyntaxKind.EdgeClassDeclaration:
    case SyntaxKind.InterfaceDeclaration:
    case SyntaxKind.StreamDeclaration:
    case SyntaxKind.ValidatedBufferDeclaration:
      return true;
    default:
      return false;
  }
}

function extractModifiers(declaration: DeclarationView): readonly SourceItemModifier[] {
  if ("modifiers" in declaration && typeof declaration.modifiers === "function") {
    return declaration.modifiers() as readonly SourceItemModifier[];
  }
  return [];
}

export function collectSourceModulesAndTopLevelItems(
  parsedModules: readonly ParsedModule[],
): SourceCollectionResult {
  const sortedModules = sortModules(parsedModules);
  const modules: ModuleRecord[] = [];
  const items: SourceItemRecord[] = [];
  const types: TypeRecord[] = [];
  const functions: FunctionRecord[] = [];
  const images: ImageRecord[] = [];
  const typeParameters: TypeParameterRecord[] = [];
  const declarationWorkItems: SourceDeclarationWorkItem[] = [];

  for (let moduleIndex = 0; moduleIndex < sortedModules.length; moduleIndex++) {
    const parsedModule = sortedModules[moduleIndex]!;
    const moduleRecord: ModuleRecord = {
      id: moduleId(moduleIndex),
      pathKey: parsedModule.path.key,
      display: parsedModule.path.display,
      source: parsedModule.source,
    };
    modules.push(moduleRecord);

    const root = parsedModule.tree.root();
    const sourceFile = SourceFileView.fromRoot(root);
    if (sourceFile === undefined) continue;

    for (const declaration of sourceFile.declarations()) {
      const name = declaration.nameText();
      if (name === undefined) continue;

      const nameSpan = declaration.nameSpan();
      if (nameSpan === undefined) continue;

      const span = declaration.span;
      const itemKind = declarationKindToSourceKind(declaration.kind);
      let typeIdValue: TypeId | undefined;
      let functionIdValue: FunctionId | undefined;
      let imageIdValue: ImageId | undefined;

      if (isTypeLike(declaration.kind)) {
        typeIdValue = typeId(types.length);
        types.push({
          id: typeIdValue,
          itemId: itemId(items.length),
          moduleId: moduleRecord.id,
          name,
        });
      }

      if (declaration.kind === SyntaxKind.FunctionDeclaration) {
        functionIdValue = functionId(functions.length);
        functions.push({
          id: functionIdValue,
          itemId: itemId(items.length),
          moduleId: moduleRecord.id,
          name,
          parameterIds: [],
        });
      }

      if (declaration.kind === SyntaxKind.ImageDeclaration) {
        imageIdValue = imageId(images.length);
        images.push({
          id: imageIdValue,
          itemId: itemId(items.length),
          moduleId: moduleRecord.id,
          name,
          fieldIds: [],
          deviceFieldIds: [],
        });
      }

      const modifiers = extractModifiers(declaration);

      const itemRecord: SourceItemRecord = {
        id: itemId(items.length),
        kind: itemKind,
        moduleId: moduleRecord.id,
        name,
        modifiers,
        nameSpan,
        span,
        declaration,
        typeId: typeIdValue,
        functionId: functionIdValue,
        imageId: imageIdValue,
      };

      items.push(itemRecord);
      declarationWorkItems.push({ item: itemRecord, declaration });
    }
  }

  return {
    modules,
    items,
    types,
    functions,
    images,
    typeParameters,
    declarationWorkItems,
  };
}
