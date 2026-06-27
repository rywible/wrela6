import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirLoanId,
  proofMirPlaceId,
  proofMirScopeId,
  proofMirStatementId,
} from "../../../src/proof-mir/ids";
import { validateProofMirEffects } from "../../../src/proof-mir/validation/effect-validator";
import {
  proofMirControlEdgeFake,
  proofMirLoanReferenceFake,
  proofMirPlaceFake,
  proofMirScopeFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("validateProofMirEffects", () => {
  test("accepts acyclic scope trees with matching crossed scopes on edges", () => {
    const functionScopeId = proofMirScopeId(0);
    const loopScopeId = proofMirScopeId(1);
    const bodyScopeId = proofMirScopeId(2);
    const afterScopeId = proofMirScopeId(3);
    const edgeId = proofMirControlEdgeId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        scopes: [
          proofMirScopeFake({ scopeId: functionScopeId, kind: "function" }),
          proofMirScopeFake({ scopeId: loopScopeId, parentScopeId: functionScopeId, kind: "loop" }),
          proofMirScopeFake({ scopeId: bodyScopeId, parentScopeId: loopScopeId, kind: "block" }),
          proofMirScopeFake({
            scopeId: afterScopeId,
            parentScopeId: functionScopeId,
            kind: "block",
          }),
        ],
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: bodyScopeId,
            parameters: [],
            statements: [],
            terminator: {
              terminatorId: 0 as never,
              kind: {
                kind: "goto",
                target: { edgeId, blockId: proofMirBlockId(1) },
              },
              outgoingEdges: [edgeId],
              origin: validatorOrigin("terminator"),
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
          {
            blockId: proofMirBlockId(1),
            scopeId: afterScopeId,
            parameters: [],
            statements: [],
            terminator: {
              terminatorId: 1 as never,
              kind: { kind: "unreachable", reason: "afterNever" },
              outgoingEdges: [],
              origin: validatorOrigin("terminator:1"),
            },
            incomingEdges: [edgeId],
            origin: validatorOrigin("block:1"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: proofMirBlockId(1),
            crossedScopes: [bodyScopeId, loopScopeId],
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirEffects(program);

    expect(diagnostics).toEqual([]);
  });

  test("rejects scope parent cycles", () => {
    const scopeA = proofMirScopeId(0);
    const scopeB = proofMirScopeId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        scopes: [
          proofMirScopeFake({ scopeId: scopeA, parentScopeId: scopeB }),
          proofMirScopeFake({ scopeId: scopeB, parentScopeId: scopeA }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirEffects(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SCOPE_TREE"),
    );
  });

  test("rejects edges whose crossed scopes do not match scope stacks", () => {
    const functionScopeId = proofMirScopeId(0);
    const loopScopeId = proofMirScopeId(1);
    const bodyScopeId = proofMirScopeId(2);
    const afterScopeId = proofMirScopeId(3);
    const edgeId = proofMirControlEdgeId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        scopes: [
          proofMirScopeFake({ scopeId: functionScopeId, kind: "function" }),
          proofMirScopeFake({ scopeId: loopScopeId, parentScopeId: functionScopeId, kind: "loop" }),
          proofMirScopeFake({ scopeId: bodyScopeId, parentScopeId: loopScopeId, kind: "block" }),
          proofMirScopeFake({
            scopeId: afterScopeId,
            parentScopeId: functionScopeId,
            kind: "block",
          }),
        ],
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: bodyScopeId,
            parameters: [],
            statements: [],
            terminator: {
              terminatorId: 0 as never,
              kind: {
                kind: "goto",
                target: { edgeId, blockId: proofMirBlockId(1) },
              },
              outgoingEdges: [edgeId],
              origin: validatorOrigin("terminator"),
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
          {
            blockId: proofMirBlockId(1),
            scopeId: afterScopeId,
            parameters: [],
            statements: [],
            terminator: {
              terminatorId: 1 as never,
              kind: { kind: "unreachable", reason: "afterNever" },
              outgoingEdges: [],
              origin: validatorOrigin("terminator:1"),
            },
            incomingEdges: [edgeId],
            origin: validatorOrigin("block:1"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: proofMirBlockId(1),
            crossedScopes: [bodyScopeId],
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirEffects(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SCOPE_TREE"),
    );
  });

  test("rejects loan references with unresolved place or scope IDs", () => {
    const loanId = proofMirLoanId(0);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        statements: [
          {
            statementId: proofMirStatementId(0),
            kind: {
              kind: "borrowPlace",
              place: proofMirPlaceId(99),
              loan: proofMirLoanReferenceFake({
                loanId,
                placeId: proofMirPlaceId(99),
                scopeId: proofMirScopeId(99),
              }),
            },
            origin: validatorOrigin("borrow"),
          },
        ],
      }),
    ]);

    const diagnostics = validateProofMirEffects(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_LOAN_IDENTITY"),
    );
  });

  test("accepts released loans with stable identity metadata", () => {
    const loanId = proofMirLoanId(0);
    const placeId = proofMirPlaceId(0);
    const scopeId = proofMirScopeId(0);
    const startOrigin = validatorOrigin("loan-start");
    const endOrigin = validatorOrigin("loan-end");
    const loan = proofMirLoanReferenceFake({
      loanId,
      placeId,
      scopeId,
      startOrigin,
      endOrigin,
    });
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        scopes: [proofMirScopeFake({ scopeId, kind: "function" })],
        places: [proofMirPlaceFake({ placeId })],
        statements: [
          {
            statementId: proofMirStatementId(0),
            kind: { kind: "borrowPlace", place: placeId, loan },
            origin: startOrigin,
          },
          {
            statementId: proofMirStatementId(1),
            kind: { kind: "releaseLoan", loan },
            origin: endOrigin,
          },
        ],
      }),
    ]);

    const diagnostics = validateProofMirEffects(program);

    expect(diagnostics).toEqual([]);
  });
});
