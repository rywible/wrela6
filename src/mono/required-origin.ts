import type { TypedHirProgram } from "../hir/hir";
import type { HirOriginId } from "../hir/ids";

export function firstHirOriginId(program: TypedHirProgram): HirOriginId {
  const originId = program.origins.originRecords()[0]?.originId;
  if (originId === undefined) {
    throw new RangeError("Monomorphization requires at least one HIR origin.");
  }
  return originId;
}
