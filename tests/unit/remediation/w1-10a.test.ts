import { expect, test } from "bun:test";
import { resolveCanonicalStdlibContractTypeIds } from "../../../src/semantic/surface/contract-type-identity";
import { parseAndResolveSurfaceFixture } from "../../support/semantic/semantic-surface-fakes";

test("W1-10a resolves contract type ids from canonical stdlib core modules", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "wrela_std/core.wr",
      [
        "enum Result[Ok, Err]:",
        "    ok(value: Ok)",
        "    err(error: Err)",
        "class Validation[Ok, Err, Source]:",
        "class Attempt[Ok, Err, Input]:",
      ].join("\n"),
    ],
    [
      "main.wr",
      [
        "class Result[Ok, Err]:",
        "class Validation[Ok, Err, Source]:",
        "class Attempt[Ok, Err, Input]:",
      ].join("\n"),
    ],
  ]);

  const stdlibModule = fixture.index.moduleByPath("wrela_std/core.wr");
  expect(stdlibModule).toBeDefined();
  if (stdlibModule === undefined) return;

  const stdlibTypes = fixture.index
    .types()
    .filter((typeRecord) => typeRecord.moduleId === stdlibModule.id);
  const stdlibResult = stdlibTypes.find((typeRecord) => typeRecord.name === "Result");
  const stdlibValidation = stdlibTypes.find((typeRecord) => typeRecord.name === "Validation");
  const stdlibAttempt = stdlibTypes.find((typeRecord) => typeRecord.name === "Attempt");

  expect(stdlibResult).toBeDefined();
  expect(stdlibValidation).toBeDefined();
  expect(stdlibAttempt).toBeDefined();
  if (stdlibResult === undefined || stdlibValidation === undefined || stdlibAttempt === undefined) {
    return;
  }

  expect(resolveCanonicalStdlibContractTypeIds(fixture.index)).toEqual({
    resultTypeId: stdlibResult.id,
    validationTypeId: stdlibValidation.id,
    attemptTypeId: stdlibAttempt.id,
  });
});

test("W1-10a resolves direct-platform contract type ids from wrela_abi.core modules", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "wrela_abi/core.wr",
      [
        "enum Result[Ok, Err]:",
        "    ok(value: Ok)",
        "    err(error: Err)",
        "class Validation[Ok, Err, Source]:",
        "class Attempt[Ok, Err, Input]:",
      ].join("\n"),
    ],
  ]);

  const abiModule = fixture.index.moduleByPath("wrela_abi/core.wr");
  expect(abiModule).toBeDefined();
  if (abiModule === undefined) return;

  const abiTypes = fixture.index
    .types()
    .filter((typeRecord) => typeRecord.moduleId === abiModule.id);
  const abiResult = abiTypes.find((typeRecord) => typeRecord.name === "Result");
  const abiValidation = abiTypes.find((typeRecord) => typeRecord.name === "Validation");
  const abiAttempt = abiTypes.find((typeRecord) => typeRecord.name === "Attempt");

  expect(abiResult).toBeDefined();
  expect(abiValidation).toBeDefined();
  expect(abiAttempt).toBeDefined();
  if (abiResult === undefined || abiValidation === undefined || abiAttempt === undefined) {
    return;
  }

  expect(resolveCanonicalStdlibContractTypeIds(fixture.index)).toEqual({
    resultTypeId: abiResult.id,
    validationTypeId: abiValidation.id,
    attemptTypeId: abiAttempt.id,
  });
});

test("W1-10a leaves canonical contract ids undefined when only user collisions exist", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      [
        "class Result[Ok, Err]:",
        "class Validation[Ok, Err, Source]:",
        "class Attempt[Ok, Err, Input]:",
      ].join("\n"),
    ],
  ]);

  expect(resolveCanonicalStdlibContractTypeIds(fixture.index)).toEqual({
    resultTypeId: undefined,
    validationTypeId: undefined,
    attemptTypeId: undefined,
  });
});
