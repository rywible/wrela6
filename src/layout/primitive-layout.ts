import type { LayoutBuilderResult } from "./builder-context";
import type {
  LayoutTypeFact,
  LayoutTypeFactTable,
  LayoutTypeRepresentation,
} from "./layout-program";
import type { LayoutTargetSurface, LayoutPrimitiveTypeSpec } from "./target-layout";
import { layoutDeterministicTable, layoutTypeKeyString } from "./type-key";
import { targetLayoutOwnerKey } from "./layout-owners";
import type { CoreTypeId, TargetTypeId } from "../semantic/ids";
import type { LayoutTypeKey } from "./layout-program";

export interface PrimitiveTypeFactsValue {
  readonly types: LayoutTypeFactTable;
}

function alignUp(sizeBytes: bigint, alignmentBytes: bigint): bigint {
  if (sizeBytes === 0n) {
    return 0n;
  }
  return ((sizeBytes + alignmentBytes - 1n) / alignmentBytes) * alignmentBytes;
}

function layoutTypeKeyForCoreSpec(spec: LayoutPrimitiveTypeSpec<CoreTypeId>): LayoutTypeKey {
  return { kind: "core", coreTypeId: spec.id };
}

function layoutTypeKeyForTargetSpec(spec: LayoutPrimitiveTypeSpec<TargetTypeId>): LayoutTypeKey {
  return { kind: "target", targetTypeId: spec.id };
}

function layoutRepresentationForPrimitive(
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): LayoutTypeRepresentation {
  if (spec.representation === "never") {
    return { kind: "never" };
  }
  if (spec.sizeBytes === 0n) {
    return { kind: "zeroSized", reason: "unit" };
  }
  return { kind: "primitive", primitive: spec.representation };
}

function primitiveLayoutFact(
  key: LayoutTypeKey,
  spec: LayoutPrimitiveTypeSpec<CoreTypeId> | LayoutPrimitiveTypeSpec<TargetTypeId>,
): LayoutTypeFact {
  const strideBytes = alignUp(spec.sizeBytes, spec.alignmentBytes);
  return {
    key,
    sizeBytes: spec.sizeBytes,
    alignmentBytes: spec.alignmentBytes,
    strideBytes,
    representation: layoutRepresentationForPrimitive(spec),
  };
}

export function seedPrimitiveTypeFacts(
  target: LayoutTargetSurface,
): LayoutBuilderResult<PrimitiveTypeFactsValue> {
  const ownerKey = targetLayoutOwnerKey(String(target.targetId));
  const facts: LayoutTypeFact[] = [];

  for (const spec of target.coreTypes.entries()) {
    facts.push(primitiveLayoutFact(layoutTypeKeyForCoreSpec(spec), spec));
  }
  for (const spec of target.targetTypes.entries()) {
    facts.push(primitiveLayoutFact(layoutTypeKeyForTargetSpec(spec), spec));
  }

  const types = layoutDeterministicTable({
    entries: facts,
    keyOf: (entry) => entry.key,
    keyString: layoutTypeKeyString,
  });

  return {
    kind: "ok",
    ownerKey,
    dependencies: [],
    value: { types },
    diagnostics: [],
  };
}
