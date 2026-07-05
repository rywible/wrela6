import { expect, test } from "bun:test";

import {
  computeSourceAggregateLayout,
  resolveCheckedTypeToLayoutKey,
} from "../../../src/layout/aggregate-layout";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import type { LayoutEnumFact } from "../../../src/layout/layout-program";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";
import { computePlatformAbiFacts } from "../../../src/layout/platform-abi";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import { monoInstanceId } from "../../../src/mono/ids";
import { coreTypeId, itemId, targetId, typeId } from "../../../src/semantic/ids";
import {
  checkedTypeFingerprint,
  coreCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import {
  aggregateLayoutFixture,
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  platformEdgeProgramFixture,
  resolverForReachableTypesFromProgram,
} from "../../support/layout/layout-fixtures";

test("W1-16f returns undefined instead of fabricating a source layout key", () => {
  const unresolvedSourceType = sourceCheckedType({ typeId: typeId(200), itemId: itemId(200) });

  expect(resolveCheckedTypeToLayoutKey(unresolvedSourceType, new Map())).toBeUndefined();
});

test("W1-16f rejects ambiguous platform function instances", () => {
  const layoutTarget = layoutTargetSurfaceFake({ targetId: targetId("uefi-aarch64") });
  const fixture = platformEdgeProgramFixture({ layoutTarget });
  const edge = fixture.program.proofMetadata.platformContractEdges.entries()[0]!;
  const firstFunction = fixture.program.functions
    .entries()
    .find((instance) => instance.sourceFunctionId === edge.sourceFunctionId)!;
  const duplicateFunction = {
    ...firstFunction,
    instanceId: monoInstanceId(`${String(firstFunction.instanceId)}:duplicate`),
  };
  const functions = [...fixture.program.functions.entries(), duplicateFunction];
  const program = {
    ...fixture.program,
    functions: layoutDeterministicTable({
      entries: functions,
      keyOf: (instance) => instance.instanceId,
      keyString: (instanceId) => String(instanceId) as LayoutCanonicalKeyString,
    }),
  };
  const primitiveResult = seedPrimitiveTypeFacts(layoutTarget);
  expect(primitiveResult.kind).toBe("ok");
  if (primitiveResult.kind !== "ok") return;

  const result = computePlatformAbiFacts({
    program,
    target: layoutTarget,
    targetFacts: normalizeTargetFactsForTest(layoutTarget),
    types: primitiveResult.value.types,
    enums: layoutDeterministicTable({
      entries: [] as readonly LayoutEnumFact[],
      keyOf: (entry) => entry.owner,
      keyString: (owner) => String(owner.instanceId) as LayoutCanonicalKeyString,
    }),
    resolver: resolverForReachableTypesFromProgram(program),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    layoutDiagnosticCode("LAYOUT_PLATFORM_FUNCTION_INSTANCE_AMBIGUOUS"),
  );
});

test("W1-16f keeps mapped source field layout keys valid", () => {
  const nestedInstanceId = monoInstanceId("type:Nested");
  const nestedType = sourceCheckedType({ typeId: typeId(201), itemId: itemId(201) });
  const input = aggregateLayoutFixture({
    fields: [{ name: "nested", type: nestedType }],
  });

  const result = computeSourceAggregateLayout({
    ...input,
    nestedSourceTypes: [
      {
        instanceId: nestedInstanceId,
        sourceKind: "class",
        fields: [{ name: "value", type: coreCheckedType(coreTypeId("u32")) }],
      },
    ],
    sourceTypeKeys: new Map([
      [
        checkedTypeFingerprint(nestedType),
        {
          kind: "source",
          instanceId: nestedInstanceId,
        },
      ],
    ]),
  });

  expect(result.kind).toBe("ok");
});
