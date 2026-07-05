import type { FieldId } from "../semantic/ids";
import type { MonoExpression } from "./mono-hir";

export interface MonoObjectField {
  readonly fieldId?: FieldId;
  readonly name: string;
  readonly value: MonoExpression;
  readonly sourceOrigin: string;
}
