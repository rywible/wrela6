import type { FieldId, ItemId, TypeId } from "../semantic/ids";
import type { MonoInstanceId } from "./ids";
import type { MonoExpression } from "./mono-hir";

export interface MonoEnumPayloadFieldBinding {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly value: MonoExpression;
  readonly sourceOrigin: string;
}

export interface MonoEnumConstructorExpression {
  readonly enumTypeInstanceId?: MonoInstanceId;
  readonly enumTypeId: TypeId;
  readonly caseItemId: ItemId;
  readonly caseName: string;
  readonly caseOrdinal: number;
  readonly payloadFields: readonly MonoEnumPayloadFieldBinding[];
}
