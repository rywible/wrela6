import { expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import {
  deterministicLayoutProgramFixture,
  stableLayoutProjection,
} from "../../support/layout/layout-fixtures";

test("layout fact program is deterministic across repeated runs", () => {
  const input = deterministicLayoutProgramFixture();
  const first = computeRepresentationLayoutFacts(input);
  const second = computeRepresentationLayoutFacts(input);

  expect(stableLayoutProjection(first)).toEqual(stableLayoutProjection(second));
});

test("layout fact program diagnostics are deterministic across repeated runs", () => {
  const input = deterministicLayoutProgramFixture();
  const first = computeRepresentationLayoutFacts(input);
  const second = computeRepresentationLayoutFacts(input);

  expect(stableLayoutProjection(first)).toEqual(stableLayoutProjection(second));
  if (first.kind === "error" && second.kind === "error") {
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.code),
    );
  }
});
