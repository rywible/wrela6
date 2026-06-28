import { expect, test } from "bun:test";
import type {
  MonomorphizedHirProgram,
  MonoExternalRoot,
  MonoFunctionInstance,
  MonoReachableFunction,
  MonoTypeInstance,
  MonoProofMetadata,
} from "../../../src/mono/mono-hir";
import {
  MONO_EXPRESSION_KIND_COVERAGE,
  MONO_PROOF_METADATA_TABLE_COVERAGE,
  MONO_STATEMENT_KIND_COVERAGE,
} from "../../../src/mono/mono-hir";
import { HIR_EXPRESSION_KINDS, HIR_STATEMENT_KINDS } from "../../../src/hir";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { minimalClosedProgramForMonoTest } from "../../support/mono/monomorphization-fixtures";

type PublicMonoSmoke = {
  readonly program?: MonomorphizedHirProgram;
  readonly externalRoot?: MonoExternalRoot;
  readonly reachableFunction?: MonoReachableFunction;
  readonly functionInstance?: MonoFunctionInstance;
  readonly typeInstance?: MonoTypeInstance;
  readonly proofMetadata?: MonoProofMetadata;
};

const acceptPublicMonoModel = (model: PublicMonoSmoke): PublicMonoSmoke => model;

test("mono schema types are exported from the schema module", () => {
  expect(acceptPublicMonoModel({})).toEqual({});
});

test("mono schema coverage maps stay exhaustive with HIR unions", () => {
  const statementKinds = Object.keys(MONO_STATEMENT_KIND_COVERAGE).sort();
  const expressionKinds = Object.keys(MONO_EXPRESSION_KIND_COVERAGE).sort();
  const proofTables = Object.keys(MONO_PROOF_METADATA_TABLE_COVERAGE).sort();

  expect(statementKinds).toEqual([...HIR_STATEMENT_KINDS].sort());
  expect(expressionKinds).toEqual([...HIR_EXPRESSION_KINDS].sort());
  expect(proofTables).toEqual([
    "attempts",
    "brands",
    "callSiteRequirements",
    "factOrigins",
    "imageOrigins",
    "obligations",
    "platformContractEdges",
    "privateStateTransitions",
    "resourcePlaces",
    "sessions",
    "terminalCalls",
    "validations",
  ]);
});

test("monomorphized program exposes deterministic reachable function closure", () => {
  const result = monomorphizeWholeImage({ program: minimalClosedProgramForMonoTest() });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const reachableReasons = result.program.reachableFunctions.entries().map((entry) => entry.reason);
  expect(reachableReasons).toContain("imageEntry");
  for (const externalRoot of result.program.externalRoots) {
    expect(result.program.reachableFunctions.has(externalRoot.functionInstanceId)).toBe(true);
  }
  expect(
    result.program.reachableFunctions.entries().map((entry) => String(entry.functionInstanceId)),
  ).toEqual(
    [...result.program.reachableFunctions.entries()]
      .map((entry) => String(entry.functionInstanceId))
      .sort(),
  );
});
