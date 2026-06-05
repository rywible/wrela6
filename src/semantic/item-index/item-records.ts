import type { TypeReferenceView } from "../../frontend/ast/type-views";
import type { FunctionId, ImageId, ItemId, ModuleId, ParameterId, TypeId, FieldId } from "../ids";
import type { SourceSpan } from "../../frontend";

export type DeclarationView = object;

export interface ModuleRecord {
  readonly id: ModuleId;
  readonly pathKey: string;
  readonly display: string;
  readonly source?: import("../../frontend").SourceText;
}

export type SourceItemKind =
  | "enum"
  | "enumCase"
  | "dataclass"
  | "class"
  | "edgeClass"
  | "interface"
  | "stream"
  | "validatedBuffer"
  | "image"
  | "function";

export type ItemKind = SourceItemKind;

export type SourceItemModifier =
  | "private"
  | "unique"
  | "platform"
  | "terminal"
  | "predicate"
  | "constructor";

export interface SourceItemRecord {
  readonly id: ItemId;
  readonly kind: SourceItemKind;
  readonly moduleId: ModuleId;
  readonly parentItemId?: ItemId;
  readonly name: string;
  readonly modifiers: readonly SourceItemModifier[];
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly declaration: DeclarationView;
  readonly typeId?: TypeId;
  readonly functionId?: FunctionId;
  readonly imageId?: ImageId;
}

export type ItemRecord = SourceItemRecord;

export type FieldRole = "field" | "imageDevice" | "validatedParam" | "layoutField";

export interface FieldRecord {
  readonly id: FieldId;
  readonly ownerItemId: ItemId;
  readonly role: FieldRole;
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly type?: TypeReferenceView;
}

export interface TypeRecord {
  readonly id: TypeId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly name: string;
}

export interface FunctionRecord {
  readonly id: FunctionId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly parentItemId?: ItemId;
  readonly name: string;
  readonly parameterIds: readonly ParameterId[];
}

export interface ImageRecord {
  readonly id: ImageId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly name: string;
  readonly fieldIds: readonly FieldId[];
  readonly deviceFieldIds: readonly FieldId[];
}

export type TypeParameterOwner =
  | { readonly kind: "item"; readonly itemId: ItemId }
  | { readonly kind: "function"; readonly itemId: ItemId; readonly functionId: FunctionId };

export interface TypeParameterRecord {
  readonly owner: TypeParameterOwner;
  readonly index: number;
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly bound?: TypeReferenceView;
}

export interface ParameterRecord {
  readonly id: ParameterId;
  readonly functionId: FunctionId;
  readonly index: number;
  readonly name: string;
  readonly isConsumed: boolean;
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly type?: TypeReferenceView;
}

export interface ItemIndexRecords {
  readonly modules: readonly ModuleRecord[];
  readonly items: readonly ItemRecord[];
  readonly types: readonly TypeRecord[];
  readonly functions: readonly FunctionRecord[];
  readonly images: readonly ImageRecord[];
  readonly fields: readonly FieldRecord[];
  readonly typeParameters: readonly TypeParameterRecord[];
  readonly parameters: readonly ParameterRecord[];
}
