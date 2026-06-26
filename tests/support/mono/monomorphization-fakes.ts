import type { FunctionId, TypeId } from "../../../src/semantic/ids";
import type { MonoCheckedType } from "../../../src/mono/mono-hir";

export interface MonoTypeKey {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
}

export interface MonoFunctionKey {
  readonly functionId: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
}
