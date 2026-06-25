import { expect, test } from "bun:test";
import {
  coreTypeId,
  functionId,
  imageProfileId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  typeId,
} from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/frontend";
import { coreCheckedType, sourceCheckedType } from "../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import {
  CheckedTakeModeSurfaceTableBuilder,
  populateTakeModeSurfaces,
} from "../../../src/semantic/surface/proof-contracts";
import type { TakeModePopulationContext } from "../../../src/semantic/surface/proof-contracts";
import { checkedProofSurface } from "../../../src/semantic/surface/proof-surface";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";
import { checkSemanticSurface } from "../../../src/semantic/surface/semantic-surface-checker";
import {
  bufferTakeModeSurfaceFake,
  checkSemanticSurfaceForTest,
  parseAndResolveSurfaceFixture,
  streamTakeModeSurfaceFake,
  validatedBufferTakeModeSurfaceFake,
} from "../../support/semantic/semantic-surface-fakes";

const span = SourceSpan.from(0, 6);
const laterSpan = SourceSpan.from(20, 28);

const streamBufferValidatedSource =
  "unique edge class NetworkDevice:\n" +
  "edge class Frame:\n" +
  "stream Counter:\n" +
  "    field: u8\n" +
  "fn produce() -> Counter\n" +
  "validated buffer FrameBuffer:\n" +
  "    params:\n" +
  "        size: u8\n" +
  "uefi image Boot:\n" +
  "    fn main() -> Never\n";

test("real checker does not infer stream or buffer take modes from resource kind alone", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", streamBufferValidatedSource]]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.types.entries().length).toBeGreaterThan(0);
  expect(result.program.proofSurface.takeModeSurfaces.entries().map((entry) => entry.kind)).toEqual(
    ["validatedBuffer"],
  );
});

test("real checker produces stream take modes only from explicit certified target contracts", () => {
  const files: [string, string][] = [
    [
      "main.wr",
      "stream Counter:\n    field: u8\nplatform fn produce() -> Counter\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ];
  const fixture = parseAndResolveSurfaceFixture(files, { platformNames: ["produce"] });
  const counterItem = fixture.index.items().find((item) => item.name === "Counter")!;
  const counterType = sourceCheckedType({
    itemId: counterItem.id,
    typeId: counterItem.typeId!,
  });
  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([
      {
        primitiveId: platformPrimitiveId("produce"),
        contractId: platformContractId("produce_contract"),
        availability: {
          targetId: targetId("uefi-aarch64"),
          profiles: [imageProfileId("uefi")],
          features: [],
        },
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [],
          returnType: counterType,
          returnKind: concreteKind("Stream"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          takeModeContracts: [
            {
              kind: "stream",
              itemType: coreCheckedType(coreTypeId("u8")),
              itemResourceKind: concreteKind("Affine"),
            },
          ],
        },
      },
    ]),
    imageProfiles: [],
    deviceSurfaces: [],
  });

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface,
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
  );
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
  );
  const produceFunctionId = fixture.index.functions().find((entry) => entry.name === "produce")!.id;
  const produceSignature = result.program.functions.get(produceFunctionId)!;
  expect(result.program.proofSurface.takeModeSurfaces.entries()).toEqual([
    streamTakeModeSurfaceFake({
      producerFunctionId: produceFunctionId,
      itemType: coreCheckedType(coreTypeId("u8")),
      itemResourceKind: concreteKind("Affine"),
      span: produceSignature.sourceSpan,
    }),
  ]);
});

test("fake checked context populates explicit, deterministic take-mode surfaces", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType: coreCheckedType(coreTypeId("u8")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: true,
        span,
      },
    ],
    bufferSources: [
      {
        sourceTypeId: typeId(2),
        bufferResourceKind: concreteKind("EdgePath"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(4),
        bufferResourceKind: concreteKind("UniqueEdgeRoot"),
        bufferObligation: true,
        span,
      },
    ],
    validatedBuffers: [{ validatedBufferTypeId: typeId(3), span }],
  };

  const builder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(builder, context);
  const surface = checkedProofSurface({ takeModeSurfaces: builder.build() });
  const entries = surface.takeModeSurfaces.entries();

  expect(entries.map((entry) => entry.kind)).toEqual(["buffer", "stream", "validatedBuffer"]);
  expect(entries).toEqual([
    bufferTakeModeSurfaceFake({
      sourceTypeId: typeId(2),
      bufferResourceKind: concreteKind("EdgePath"),
      span,
    }),
    streamTakeModeSurfaceFake({
      producerFunctionId: functionId(1),
      itemType: coreCheckedType(coreTypeId("u8")),
      itemResourceKind: concreteKind("Stream"),
      span,
    }),
    validatedBufferTakeModeSurfaceFake({ validatedBufferTypeId: typeId(3), span }),
  ]);
});

test("take-mode surfaces sort deterministically (buffer before validatedBuffer)", () => {
  const builder = new CheckedTakeModeSurfaceTableBuilder();
  builder.add({
    kind: "buffer",
    sourceTypeId: typeId(2),
    bufferResourceKind: concreteKind("Linear"),
    span,
  });
  builder.add({
    kind: "validatedBuffer",
    validatedBufferTypeId: typeId(1),
    span,
  });

  const surface = checkedProofSurface({ takeModeSurfaces: builder.build() });

  expect(surface.takeModeSurfaces.entries().map((entry) => entry.kind)).toEqual([
    "buffer",
    "validatedBuffer",
  ]);
});

test("no take mode is produced from source or target names alone", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType: coreCheckedType(coreTypeId("u8")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: false,
        span,
      },
    ],
    bufferSources: [
      {
        sourceTypeId: typeId(2),
        bufferResourceKind: concreteKind("EdgePath"),
        bufferObligation: false,
        span,
      },
      {
        sourceTypeId: typeId(4),
        bufferResourceKind: concreteKind("UniqueEdgeRoot"),
        bufferObligation: true,
        span,
      },
    ],
    validatedBuffers: [],
  };

  const builder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(builder, context);
  const surface = checkedProofSurface({ takeModeSurfaces: builder.build() });

  expect(surface.takeModeSurfaces.entries()).toEqual([]);
});

test("population surfaces stay deterministic across shuffled context input order", () => {
  const streamProducer = {
    producerFunctionId: functionId(1),
    itemType: coreCheckedType(coreTypeId("u8")),
    itemResourceKind: concreteKind("Stream"),
    takeOnlyStream: true,
    span,
  };
  const bufferSourceOne = {
    sourceTypeId: typeId(2),
    bufferResourceKind: concreteKind("EdgePath"),
    bufferObligation: true,
    span,
  };
  const bufferSourceTwo = {
    sourceTypeId: typeId(5),
    bufferResourceKind: concreteKind("Linear"),
    bufferObligation: true,
    span: laterSpan,
  };
  const validatedBuffer = { validatedBufferTypeId: typeId(3), span };

  const firstContext: TakeModePopulationContext = {
    streamProducers: [streamProducer],
    bufferSources: [bufferSourceOne, bufferSourceTwo],
    validatedBuffers: [validatedBuffer],
  };
  const secondContext: TakeModePopulationContext = {
    streamProducers: [streamProducer],
    bufferSources: [bufferSourceTwo, bufferSourceOne],
    validatedBuffers: [validatedBuffer],
  };

  const firstBuilder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(firstBuilder, firstContext);
  const secondBuilder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(secondBuilder, secondContext);

  expect(firstBuilder.build().entries()).toEqual(secondBuilder.build().entries());
});

test("population surfaces round-trip through the proof surface unchanged", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType: coreCheckedType(coreTypeId("u8")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: true,
        span,
      },
    ],
    bufferSources: [
      {
        sourceTypeId: typeId(2),
        bufferResourceKind: concreteKind("SealedPlatformToken"),
        bufferObligation: true,
        span: laterSpan,
      },
    ],
    validatedBuffers: [{ validatedBufferTypeId: typeId(3), span }],
  };

  const builder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(builder, context);
  const surface = checkedProofSurface({ takeModeSurfaces: builder.build() });
  const entries = surface.takeModeSurfaces.entries();

  expect(entries.map((entry) => entry.kind)).toEqual(["buffer", "stream", "validatedBuffer"]);
  expect(entries).toEqual([
    bufferTakeModeSurfaceFake({
      sourceTypeId: typeId(2),
      bufferResourceKind: concreteKind("SealedPlatformToken"),
      span: laterSpan,
    }),
    streamTakeModeSurfaceFake({
      producerFunctionId: functionId(1),
      itemType: coreCheckedType(coreTypeId("u8")),
      itemResourceKind: concreteKind("Stream"),
      span,
    }),
    validatedBufferTakeModeSurfaceFake({ validatedBufferTypeId: typeId(3), span }),
  ]);
});
