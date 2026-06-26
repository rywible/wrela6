import { expect, test } from "bun:test";
import { checkSemanticSurface } from "../../../../src/semantic/surface/semantic-surface-checker";
import {
  deviceSurfaceFake,
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
} from "../../../support/semantic/semantic-surface-fakes";
import { semanticSurfaceForHirTest } from "../../../support/hir/typed-hir-fixtures";

test("orchestrator returns checked program and image seed for valid minimal image", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  expect(result.program.functions.entries()).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});

test("orchestrator does not copy name-resolution diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn f(x: Missing)\n"]]);

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: semanticTargetSurfaceFake(),
  });

  const allSurfaceCodes = result.diagnostics.every((diagnostic) =>
    diagnostic.code.startsWith("SURFACE_"),
  );
  expect(allSurfaceCodes).toBe(true);
});

test("orchestrator returns image seed when image root is selected", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  expect(result.image).toBeDefined();
  expect(result.image!.imageId).toBeDefined();
});

test("orchestrator reports unresolved deferred members inside requires sections", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "fn checked_entry() -> Never:\n    requires:\n        packet.len\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ]);

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(diagnosticCodes).toContain("SURFACE_UNRESOLVED_DEFERRED_MEMBER");
});

test("orchestrator builds proof seeds after image devices are checked", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [
      [
        "main.wr",
        "class NetDevice:\nuefi image Boot:\n    devices:\n        net0: NetDevice\n    fn main() -> Never\n",
      ],
    ],
    {
      targetSurface: semanticTargetSurfaceFake({
        devices: [deviceSurfaceFake({ name: "NetDevice", uniqueEdgeRoots: ["net-root"] })],
      }),
    },
  );

  const result = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  expect(result.image?.devices).toHaveLength(1);
  expect(result.program.proofSurface.imageSurfaces.entries()).toHaveLength(1);
  expect(result.program.proofSurface.signatureModes.entries().length).toBeGreaterThan(0);
  expect(result.program.proofSurface.resourceKindByType.entries().length).toBeGreaterThan(0);
});

test("semantic surface requires endian marker for multi-byte layout field", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", ["validated buffer Packet:", "    layout:", "        size: u16 @ 0"].join("\n")],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface stores checked big-endian layout field encoding", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        size: be u16 @ 0\n"],
  ]);
  const sizeField = result.program.fields.entries().find((field) => field.name === "size");

  expect(sizeField?.layoutWireEndian).toBe("big");
  expect(sizeField?.wireEncoding).toEqual({
    kind: "integer",
    endian: "big",
    signedness: "unsigned",
    bitWidth: 16,
  });
});

test("semantic surface stores byte encoding for u8 layout field without marker", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        tag: u8 @ 0\n"],
  ]);
  const tagField = result.program.fields.entries().find((field) => field.name === "tag");

  expect(tagField?.layoutWireEndian).toBeUndefined();
  expect(tagField?.wireEncoding).toEqual({ kind: "byte" });
});

test("semantic surface stores checked little-endian layout field encoding", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        size: le u32 @ 0\n"],
  ]);
  const sizeField = result.program.fields.entries().find((field) => field.name === "size");

  expect(sizeField?.layoutWireEndian).toBe("little");
  expect(sizeField?.wireEncoding).toEqual({
    kind: "integer",
    endian: "little",
    signedness: "unsigned",
    bitWidth: 32,
  });
});

test("semantic surface rejects wire endian marker on bool layout field", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        flag: le bool @ 0\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface rejects wire endian marker on Never layout field", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        stop: be Never @ 0\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface rejects wire endian marker on source type layout field", () => {
  const result = semanticSurfaceForHirTest([
    [
      "main.wr",
      [
        "class Payload:",
        "validated buffer Packet:",
        "    layout:",
        "        body: le Payload @ 0",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface rejects wire endian marker on u8 layout field", () => {
  const result = semanticSurfaceForHirTest([
    ["main.wr", "validated buffer Packet:\n    layout:\n        tag: be u8 @ 0\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("semantic surface records fieldRole on checked fields", () => {
  const result = semanticSurfaceForHirTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        payload: u8 @ 0",
      ].join("\n"),
    ],
  ]);

  const paramField = result.program.fields.entries().find((field) => field.name === "expected_len");
  const layoutField = result.program.fields.entries().find((field) => field.name === "payload");

  expect(paramField?.fieldRole).toBe("validatedParam");
  expect(layoutField?.fieldRole).toBe("layoutField");

  const packetType = result.program.types
    .entries()
    .find((type) => result.program.fields.entries().some((field) => field.itemId === type.itemId));
  if (packetType === undefined) throw new Error("expected Packet type");
  const fieldModel = result.program.validatedBufferFields.get(packetType.typeId);
  expect(fieldModel?.layoutDerivedFieldOrder.length).toBeGreaterThan(0);
});

test("semantic surface wire encoding diagnostics sort by layout field span", () => {
  const result = semanticSurfaceForHirTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    layout:",
        "        first: u16 @ 0",
        "        second: u32 @ 2",
        "        third: u64 @ 6",
      ].join("\n"),
    ],
  ]);

  const wireDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "SURFACE_INVALID_WIRE_ENCODING",
  );
  expect(wireDiagnostics).toHaveLength(3);
  const spanStarts = wireDiagnostics.map((diagnostic) => diagnostic.span?.start ?? 0);
  expect(spanStarts).toEqual([...spanStarts].sort((left, right) => left - right));
  expect(wireDiagnostics.every((diagnostic) => diagnostic.order.span === diagnostic.span)).toBe(
    true,
  );
});
