import { expect, test } from "bun:test";
import {
  buildProofMir,
  proofMirBlockId,
  proofMirCanonicalKey,
  proofMirDiagnostic,
  proofMirDiagnosticCode,
  proofMirOriginId,
  sortProofMirDiagnostics,
} from "../../../src/proof-mir";
import { freezeDraftProgram } from "../../../src/proof-mir/internal";
import type {
  BuildProofMirInput,
  BuildProofMirResult,
  ProofMirBlock,
  ProofMirDiagnostic,
  ProofMirFact,
  ProofMirFunction,
  ProofMirOrigin,
  ProofMirProgram,
  ProofMirBuildTargetContext,
} from "../../../src/proof-mir";
import * as wrela from "../../../src";

type PublicProofMirModelSmoke = {
  readonly buildProofMirInput?: BuildProofMirInput;
  readonly buildProofMirResult?: BuildProofMirResult;
  readonly proofMirBuildTargetContext?: ProofMirBuildTargetContext;
  readonly proofMirDiagnostic?: ProofMirDiagnostic;
  readonly proofMirProgram?: ProofMirProgram;
  readonly proofMirFunction?: ProofMirFunction;
  readonly proofMirBlock?: ProofMirBlock;
  readonly proofMirFact?: ProofMirFact;
  readonly proofMirOrigin?: ProofMirOrigin;
};

const acceptPublicProofMirModel = (model: PublicProofMirModelSmoke): PublicProofMirModelSmoke =>
  model;

test("proof-mir public API exports builder and model types", () => {
  expect(typeof buildProofMir).toBe("function");
  expect(typeof freezeDraftProgram).toBe("function");
  expect(typeof proofMirDiagnostic).toBe("function");
  expect(typeof proofMirDiagnosticCode).toBe("function");
  expect(typeof sortProofMirDiagnostics).toBe("function");
  expect(typeof proofMirBlockId).toBe("function");
  expect(typeof proofMirCanonicalKey).toBe("function");
  expect(typeof proofMirOriginId).toBe("function");
  expect(acceptPublicProofMirModel({})).toEqual({});
});

test("proof-mir public API is exported from src/proof-mir and src root namespace", () => {
  expect(typeof buildProofMir).toBe("function");
  expect(typeof wrela.proofMir.buildProofMir).toBe("function");
  expect(typeof proofMirDiagnostic).toBe("function");
  expect(typeof wrela.proofMir.proofMirDiagnostic).toBe("function");
  expect(typeof proofMirDiagnosticCode).toBe("function");
  expect(typeof wrela.proofMir.proofMirDiagnosticCode).toBe("function");
  expect(typeof sortProofMirDiagnostics).toBe("function");
  expect(typeof wrela.proofMir.sortProofMirDiagnostics).toBe("function");
  expect("freezeDraftProgram" in wrela.proofMir).toBe(false);
});

test("public barrel exports Proof MIR builder", async () => {
  const api = await import("../../../src");

  expect(api.proofMir.buildProofMir).toBeFunction();
});

test("proof-mir public API does not expose lowering implementation modules", () => {
  expect("createProofMirExpressionLowerer" in wrela.proofMir).toBe(false);
  expect("lowerProofMirFunction" in wrela.proofMir).toBe(false);
  expect("createProofMirLoweringRegistry" in wrela.proofMir).toBe(false);
  expect("validateProofMirGraph" in wrela.proofMir).toBe(false);
});
