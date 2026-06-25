import { expect, test } from "bun:test";
import { functionId, typeId, itemId, coreTypeId } from "../../../../src/semantic/ids";
import { SourceSpan } from "../../../../src/frontend";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import {
  concreteKind,
  parametricKind,
  derivedKind,
  errorKind,
} from "../../../../src/semantic/surface/resource-kind";
import {
  CheckedTakeModeSurfaceTableBuilder,
  populateTakeModeSurfaces,
  emptyCheckedTakeModeSurfaceTable,
} from "../../../../src/semantic/surface/proof-contracts";
import type {
  TakeModePopulationContext,
  CheckedTakeModeSurface,
} from "../../../../src/semantic/surface/proof-contracts";
import {
  checkedProofSurface,
  checkedProofSurfaceEmpty,
} from "../../../../src/semantic/surface/proof-surface";

type StreamSurface = Extract<CheckedTakeModeSurface, { kind: "stream" }>;
type BufferSurface = Extract<CheckedTakeModeSurface, { kind: "buffer" }>;
type ValidatedBufferSurface = Extract<CheckedTakeModeSurface, { kind: "validatedBuffer" }>;

const span = SourceSpan.from(0, 6);
const laterSpan = SourceSpan.from(10, 16);

function buildTable(context: TakeModePopulationContext): readonly CheckedTakeModeSurface[] {
  const builder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(builder, context);
  return builder.build().entries();
}

test("take-mode surfaces sort deterministically by kind then id then span", () => {
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

test("builder orders kinds by code-unit ordering", () => {
  const builder = new CheckedTakeModeSurfaceTableBuilder();
  builder.add({
    kind: "validatedBuffer",
    validatedBufferTypeId: typeId(3),
    span,
  });
  builder.add({
    kind: "stream",
    producerFunctionId: functionId(1),
    itemType: coreCheckedType(coreTypeId("u32")),
    itemResourceKind: concreteKind("Stream"),
    span,
  });
  builder.add({
    kind: "buffer",
    sourceTypeId: typeId(0),
    bufferResourceKind: concreteKind("ValidatedBuffer"),
    span,
  });

  expect(
    builder
      .build()
      .entries()
      .map((entry) => entry.kind),
  ).toEqual(["buffer", "stream", "validatedBuffer"]);
});

test("builder breaks ties by numeric id then span start/end", () => {
  const builder = new CheckedTakeModeSurfaceTableBuilder();
  builder.add({
    kind: "buffer",
    sourceTypeId: typeId(5),
    bufferResourceKind: concreteKind("Linear"),
    span,
  });
  builder.add({
    kind: "buffer",
    sourceTypeId: typeId(2),
    bufferResourceKind: concreteKind("Linear"),
    span: laterSpan,
  });
  builder.add({
    kind: "buffer",
    sourceTypeId: typeId(2),
    bufferResourceKind: concreteKind("Linear"),
    span,
  });

  const entries = builder.build().entries() as readonly BufferSurface[];
  expect(entries.map((entry) => entry.sourceTypeId)).toEqual([typeId(2), typeId(2), typeId(5)]);
  expect(entries[0]!.span).toEqual(span);
  expect(entries[1]!.span).toEqual(laterSpan);
});

test("empty proof surface exposes an empty take-mode table", () => {
  expect(checkedProofSurfaceEmpty().takeModeSurfaces.entries()).toEqual([]);
  expect(emptyCheckedTakeModeSurfaceTable().entries()).toEqual([]);
});

test("population adds a stream surface only for take-only stream producers", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType: coreCheckedType(coreTypeId("u32")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: true,
        span,
      },
      {
        producerFunctionId: functionId(2),
        itemType: coreCheckedType(coreTypeId("u32")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: false,
        span,
      },
    ],
    bufferSources: [],
    validatedBuffers: [],
  };

  const entries = buildTable(context);
  expect(entries).toHaveLength(1);
  expect(entries[0]!.kind).toBe("stream");
  expect((entries[0] as StreamSurface).producerFunctionId).toBe(functionId(1));
});

test("a Stream resource kind without take-only authorization is not a take-mode surface", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(0),
        itemType: coreCheckedType(coreTypeId("u32")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: false,
        span,
      },
    ],
    bufferSources: [],
    validatedBuffers: [],
  };

  expect(buildTable(context)).toEqual([]);
});

test("population adds a buffer surface only for buffer-obligation sources with an allowed kind", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [],
    bufferSources: [
      {
        sourceTypeId: typeId(1),
        bufferResourceKind: concreteKind("Linear"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(2),
        bufferResourceKind: concreteKind("Affine"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(3),
        bufferResourceKind: concreteKind("EdgePath"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(4),
        bufferResourceKind: concreteKind("SealedPlatformToken"),
        bufferObligation: true,
        span,
      },
    ],
    validatedBuffers: [],
  };

  const entries = buildTable(context) as readonly BufferSurface[];
  expect(entries.map((entry) => entry.kind)).toEqual(["buffer", "buffer", "buffer", "buffer"]);
  expect(entries.map((entry) => entry.sourceTypeId)).toEqual([
    typeId(1),
    typeId(2),
    typeId(3),
    typeId(4),
  ]);
});

test("population rejects buffer sources missing the buffer-obligation declaration mark", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [],
    bufferSources: [
      {
        sourceTypeId: typeId(1),
        bufferResourceKind: concreteKind("Linear"),
        bufferObligation: false,
        span,
      },
    ],
    validatedBuffers: [],
  };

  expect(buildTable(context)).toEqual([]);
});

test("population rejects buffer sources whose resource kind is not a buffer obligation kind", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [],
    bufferSources: [
      {
        sourceTypeId: typeId(1),
        bufferResourceKind: concreteKind("Copy"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(2),
        bufferResourceKind: concreteKind("Stream"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(3),
        bufferResourceKind: concreteKind("ValidatedBuffer"),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(4),
        bufferResourceKind: parametricKind({
          owner: { kind: "item", itemId: itemId(0) },
          index: 0,
        }),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(5),
        bufferResourceKind: derivedKind("join", [concreteKind("Linear")]),
        bufferObligation: true,
        span,
      },
      {
        sourceTypeId: typeId(6),
        bufferResourceKind: errorKind(),
        bufferObligation: true,
        span,
      },
    ],
    validatedBuffers: [],
  };

  expect(buildTable(context)).toEqual([]);
});

test("population adds a validated-buffer surface for every validated-buffer declaration", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [],
    bufferSources: [],
    validatedBuffers: [
      { validatedBufferTypeId: typeId(1), span },
      { validatedBufferTypeId: typeId(0), span: laterSpan },
    ],
  };

  const entries = buildTable(context) as readonly ValidatedBufferSurface[];
  expect(entries.map((entry) => entry.kind)).toEqual(["validatedBuffer", "validatedBuffer"]);
  expect(entries.map((entry) => entry.validatedBufferTypeId)).toEqual([typeId(0), typeId(1)]);
});

test("population produces no surfaces from an empty context", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [],
    bufferSources: [],
    validatedBuffers: [],
  };

  expect(buildTable(context)).toEqual([]);
});

test("population output is deterministic regardless of input ordering", () => {
  const streamProducer = {
    producerFunctionId: functionId(1),
    itemType: coreCheckedType(coreTypeId("u32")),
    itemResourceKind: concreteKind("Stream"),
    takeOnlyStream: true,
    span,
  };
  const bufferSource = {
    sourceTypeId: typeId(2),
    bufferResourceKind: concreteKind("Linear"),
    bufferObligation: true,
    span,
  };
  const validatedBuffer = { validatedBufferTypeId: typeId(3), span };
  const firstContext: TakeModePopulationContext = {
    streamProducers: [streamProducer],
    bufferSources: [bufferSource],
    validatedBuffers: [validatedBuffer],
  };
  const secondContext: TakeModePopulationContext = {
    streamProducers: [streamProducer],
    bufferSources: [bufferSource],
    validatedBuffers: [validatedBuffer, { validatedBufferTypeId: typeId(0), span: laterSpan }],
  };

  const first = buildTable(firstContext);
  const second = buildTable(secondContext);

  expect(first.map((entry) => entry.kind)).toEqual(["buffer", "stream", "validatedBuffer"]);
  expect(second.map((entry) => entry.kind)).toEqual([
    "buffer",
    "stream",
    "validatedBuffer",
    "validatedBuffer",
  ]);
  expect(
    (
      second.filter(
        (entry) => entry.kind === "validatedBuffer",
      ) as readonly ValidatedBufferSurface[]
    ).map((entry) => entry.validatedBufferTypeId),
  ).toEqual([typeId(0), typeId(3)]);
});

test("population preserves resource kinds and item types on emitted surfaces", () => {
  const itemType = coreCheckedType(coreTypeId("u32"));
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType,
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
    validatedBuffers: [],
  };

  const [bufferEntry, streamEntry] = buildTable(context) as [BufferSurface, StreamSurface];
  expect(bufferEntry.kind).toBe("buffer");
  expect(bufferEntry.bufferResourceKind).toEqual(concreteKind("SealedPlatformToken"));
  expect(streamEntry.kind).toBe("stream");
  expect(streamEntry.itemType).toEqual(itemType);
});

test("population never infers take modes from names alone", () => {
  const context: TakeModePopulationContext = {
    streamProducers: [
      {
        producerFunctionId: functionId(7),
        itemType: coreCheckedType(coreTypeId("u32")),
        itemResourceKind: concreteKind("Stream"),
        takeOnlyStream: false,
        span,
      },
    ],
    bufferSources: [
      {
        sourceTypeId: typeId(11),
        bufferResourceKind: concreteKind("Linear"),
        bufferObligation: false,
        span,
      },
    ],
    validatedBuffers: [],
  };

  expect(buildTable(context)).toEqual([]);
});

test("population surfaces flow through checkedProofSurface unchanged", () => {
  const builder = new CheckedTakeModeSurfaceTableBuilder();
  populateTakeModeSurfaces(builder, {
    streamProducers: [
      {
        producerFunctionId: functionId(1),
        itemType: coreCheckedType(coreTypeId("u32")),
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
    ],
    validatedBuffers: [{ validatedBufferTypeId: typeId(3), span }],
  });
  const surface = checkedProofSurface({ takeModeSurfaces: builder.build() });

  expect(surface.takeModeSurfaces.entries().map((entry) => entry.kind)).toEqual([
    "buffer",
    "stream",
    "validatedBuffer",
  ]);
});
