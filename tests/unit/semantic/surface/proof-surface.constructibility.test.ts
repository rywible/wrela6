import { expect, test } from "bun:test";
import { functionId, typeId } from "../../../../src/semantic/ids";
import { SourceSpan } from "../../../../src/frontend";
import {
  CheckedConstructibilitySurfaceTableBuilder,
  populateConstructibilitySurfaces,
} from "../../../../src/semantic/surface/proof-contracts";
import type { ConstructibilityPopulationContext } from "../../../../src/semantic/surface/proof-contracts";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";
import { checkedProofSurface } from "../../../../src/semantic/surface/proof-surface";

const span = SourceSpan.from(0, 6);

function entries(context: ConstructibilityPopulationContext) {
  const builder = new CheckedConstructibilitySurfaceTableBuilder();
  populateConstructibilitySurfaces(builder, context);
  return builder.build().entries();
}

test("constructibility surfaces sort by type and constructor id", () => {
  const builder = new CheckedConstructibilitySurfaceTableBuilder();
  builder.add({ typeId: typeId(2), authorization: "ordinary", sourceOrigin: span });
  builder.add({
    typeId: typeId(1),
    constructorFunctionId: functionId(4),
    authorization: "validatedBufferMint",
    sourceOrigin: span,
  });

  const surface = checkedProofSurface({ constructibilitySurfaces: builder.build() });

  expect(surface.constructibilitySurfaces.entries().map((entry) => entry.typeId)).toEqual([
    typeId(1),
    typeId(2),
  ]);
});

test("ordinary source types receive ordinary authorization", () => {
  expect(
    entries({
      sourceTypes: [{ typeId: typeId(1), resourceKind: concreteKind("Copy"), span }],
      constructors: [],
      validatedBuffers: [],
      explicitSpecialAuthorities: [],
    }),
  ).toEqual([{ typeId: typeId(1), authorization: "ordinary", sourceOrigin: span }]);
});

test("special authorizations require explicit checked authority", () => {
  expect(
    entries({
      sourceTypes: [
        { typeId: typeId(1), resourceKind: concreteKind("SealedPlatformToken"), span },
        { typeId: typeId(2), resourceKind: concreteKind("PrivateState"), span },
        { typeId: typeId(3), resourceKind: concreteKind("Stream"), span },
      ],
      constructors: [],
      validatedBuffers: [],
      explicitSpecialAuthorities: [],
    }),
  ).toEqual([]);
});

test("validated-buffer declarations and checked constructors mint explicit surfaces", () => {
  expect(
    entries({
      sourceTypes: [],
      constructors: [
        {
          typeId: typeId(2),
          constructorFunctionId: functionId(9),
          authorization: "privateStateMint",
          span,
        },
      ],
      validatedBuffers: [{ typeId: typeId(1), span }],
      explicitSpecialAuthorities: [],
    }),
  ).toEqual([
    { typeId: typeId(1), authorization: "validatedBufferMint", sourceOrigin: span },
    {
      typeId: typeId(2),
      constructorFunctionId: functionId(9),
      authorization: "privateStateMint",
      sourceOrigin: span,
    },
  ]);
});
