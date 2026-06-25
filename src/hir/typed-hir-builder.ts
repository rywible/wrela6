import { SourceSpan } from "../shared/source-span";
import { FunctionDeclarationView } from "../frontend/ast/function-views";
import type { RedNode } from "../frontend/syntax/red-node";
import type { FunctionId, ItemId, ModuleId } from "../semantic/ids";
import { errorKind } from "../semantic/surface/resource-kind";
import { errorCheckedType } from "../semantic/surface/type-model";
import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type {
  HirDeclaration,
  HirFunction,
  HirImage,
  HirLocal,
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
    this.validatedBuffers.push(...lowerValidatedBuffers({ context: this.context }));
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
        signature,
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
      functions: functionTable(this.functions),
      validatedBuffers: validatedBufferTable(this.validatedBuffers),
      images: imageTable(this.images),
      proofMetadata: this.context.proofMetadata.build(),
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

    return {
      functionId: signature.functionId,
      itemId: signature.itemId,
      signature,
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
