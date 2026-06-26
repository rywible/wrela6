import { expect, test } from "bun:test";
import { minimalSelectedImageProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

test("mono fixtures produce one selected image", () => {
  const program = minimalSelectedImageProgramForMonoTest();

  expect(program.images.entries()).toHaveLength(1);
  expect(program.images.entries()[0]?.entryFunctionId).toBeDefined();
});
