import type { SourceSpan } from "../../frontend";
import type {
  ModuleId,
  ItemId,
  TypeId,
  FunctionId,
  ImageId,
  FieldId,
  ParameterId,
  CoreTypeId,
  PlatformPrimitiveId,
} from "../ids";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { NameReferenceKind } from "./diagnostics";

export type { NameReferenceKind };

export type ResolvedReference =
  | { readonly kind: "module"; readonly moduleId: ModuleId }
  | { readonly kind: "item"; readonly itemId: ItemId }
  | { readonly kind: "type"; readonly itemId: ItemId; readonly typeId: TypeId }
  | { readonly kind: "builtinType"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "function"; readonly itemId: ItemId; readonly functionId: FunctionId }
  | { readonly kind: "image"; readonly itemId: ItemId; readonly imageId: ImageId }
  | { readonly kind: "field"; readonly ownerItemId: ItemId; readonly fieldId: FieldId }
  | { readonly kind: "typeParameter"; readonly owner: TypeParameterOwner; readonly index: number }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId };

export interface SyntaxReferenceKey {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameReferenceKind;
  readonly ordinal: number;
}

export interface ReferenceKeyInput {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameReferenceKind;
}

export interface ResolvedReferenceEntry {
  readonly key: SyntaxReferenceKey;
  readonly reference: ResolvedReference;
}

export interface DeferredMemberReference {
  readonly key: SyntaxReferenceKey;
  readonly receiverExpressionKey: SyntaxReferenceKey | undefined;
  readonly memberName: string;
  readonly memberSpan: SourceSpan;
  readonly allowedNamespaces: readonly MemberNamespaceKind[];
}

export type MemberNamespaceKind = "field" | "function" | "enumCase" | "imageDevice";

export interface PlatformPrimitiveBinding {
  readonly itemId: ItemId;
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
}
