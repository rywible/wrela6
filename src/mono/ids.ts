export type MonoInstanceId = string & { readonly __brand: "MonoInstanceId" };

export function monoInstanceId(value: string): MonoInstanceId {
  return value as MonoInstanceId;
}

export interface InstantiatedHirId<IdValue> {
  readonly hirId: IdValue;
  readonly instanceId: MonoInstanceId;
}

export function instantiatedHirId<IdValue>(
  instanceId: MonoInstanceId,
  hirId: IdValue,
): InstantiatedHirId<IdValue> {
  return { hirId, instanceId };
}

export function instantiatedHirIdKey(id: InstantiatedHirId<unknown>): string {
  return `${String(id.instanceId)}/${String(id.hirId).padStart(12, "0")}`;
}
