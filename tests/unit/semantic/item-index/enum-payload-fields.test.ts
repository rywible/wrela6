import { expect, test } from "bun:test";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";

test("item index records enum payload fields as case-owned fields", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "enum Result:\n    Ok(value: u8)\n    Err(error: u16)\n"],
  ]);

  const okCase = fixture.index
    .items()
    .find((item) => item.kind === "enumCase" && item.name === "Ok");
  const errCase = fixture.index
    .items()
    .find((item) => item.kind === "enumCase" && item.name === "Err");

  expect(okCase).toBeDefined();
  expect(errCase).toBeDefined();
  expect(
    fixture.index.fieldsForItem(okCase!.id).map((field) => ({
      name: field.name,
      role: field.role,
    })),
  ).toEqual([{ name: "value", role: "enumPayload" }]);
  expect(
    fixture.index.fieldsForItem(errCase!.id).map((field) => ({
      name: field.name,
      role: field.role,
    })),
  ).toEqual([{ name: "error", role: "enumPayload" }]);
});

test("generic enum payload fields resolve declaration type parameters", () => {
  const fixture = parseAndResolveSurfaceFixture([
    ["main.wr", "enum Result[Ok, Err]:\n    ok(value: Ok)\n    err(error: Err)\n"],
  ]);

  const resultItem = fixture.index.items().find((item) => item.kind === "enum");
  expect(resultItem).toBeDefined();
  if (resultItem === undefined) return;

  expect(fixture.diagnostics).toEqual([]);
  expect(fixture.index.typeParametersForItem(resultItem.id).map((param) => param.name)).toEqual([
    "Ok",
    "Err",
  ]);
  expect(
    fixture.index
      .items()
      .filter((item) => item.kind === "enumCase" && item.parentItemId === resultItem.id)
      .flatMap((item) => fixture.index.fieldsForItem(item.id).map((field) => field.name)),
  ).toEqual(["value", "error"]);
});
