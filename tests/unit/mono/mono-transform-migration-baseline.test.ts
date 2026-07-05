import { expect, test } from "bun:test";
import {
  monoTransformMigrationGenericProgramForTest,
  monoTransformMigrationProofProgramForTest,
  monoTransformMigrationSummariesForTest,
} from "../../support/mono/mono-transform-migration-fixtures";

test("mono transform migration fixtures preserve cloned body identity and remaps", () => {
  const programs = [
    monoTransformMigrationGenericProgramForTest(),
    monoTransformMigrationProofProgramForTest(),
  ];
  const instanceIds = programs.flatMap((program) =>
    program.functions.entries().map((function_) => String(function_.instanceId)),
  );

  expect(instanceIds.length).toBeGreaterThan(0);
  expect(instanceIds.sort()).toMatchSnapshot();
  expect(monoTransformMigrationSummariesForTest()).toMatchSnapshot();
});
