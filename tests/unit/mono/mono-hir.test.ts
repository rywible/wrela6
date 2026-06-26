import { expect, test } from "bun:test";
import type {
  MonomorphizedHirProgram,
  MonoFunctionInstance,
  MonoTypeInstance,
  MonoProofMetadata,
} from "../../../src/mono/mono-hir";
import {
  MONO_EXPRESSION_KIND_COVERAGE,
  MONO_PROOF_METADATA_TABLE_COVERAGE,
  MONO_STATEMENT_KIND_COVERAGE,
} from "../../../src/mono/mono-hir";
import { HIR_EXPRESSION_KINDS, HIR_STATEMENT_KINDS } from "../../../src/hir";

type PublicMonoSmoke = {
  readonly program?: MonomorphizedHirProgram;
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
