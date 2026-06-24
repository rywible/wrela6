import { expect, test } from "bun:test";
import { checkSemanticSurface } from "../../../../src/semantic/surface/semantic-surface-checker";
import {
  deviceSurfaceFake,
  parseAndResolveSurfaceFixture,
  semanticTargetSurfaceFake,
} from "../../../support/semantic/semantic-surface-fakes";

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
