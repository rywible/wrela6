import { expect, test } from "bun:test";
import { checkSemanticSurfaceForTest } from "../../support/semantic/semantic-surface-fakes";

test("real checker authorizes ordinary source type construction", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "class Packet:\n    byte: u8\n"]]);

  expect(result.program.proofSurface.constructibilitySurfaces.entries()).toContainEqual(
    expect.objectContaining({ authorization: "ordinary" }),
  );
});

test("real checker does not forge special constructibility from names alone", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "class SealedPlatformToken:\n    raw: u8\nclass StreamThing:\n    raw: u8\n"],
  ]);

  expect(
    result.program.proofSurface.constructibilitySurfaces
      .entries()
      .filter((entry) => entry.authorization !== "ordinary"),
  ).toEqual([]);
});

test("real checker authorizes checked private-state declarations", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "private class Door:\n    raw: u8\n"]]);

  expect(result.program.proofSurface.constructibilitySurfaces.entries()).toContainEqual(
    expect.objectContaining({ authorization: "privateStateMint" }),
  );
});

test("real checker authorizes validated-buffer declarations without ordinary fallback", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "validated buffer Packet:\n    params:\n        size: u8\n"],
  ]);

  expect(
    result.program.proofSurface.constructibilitySurfaces
      .entries()
      .map((entry) => entry.authorization),
  ).toEqual(["validatedBufferMint"]);
});
