import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirScopeId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import { validateProofMirGraph } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirBlockParameterFake,
  proofMirControlEdgeFake,
  proofMirTerminatorFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  proofMirValueFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("validateProofMirGraph", () => {
  test("accepts a minimal valid function graph", () => {
    const program = proofMirValidatorProgramFake([proofMirValidatorFunctionFake()]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics).toEqual([]);
  });

  test("rejects a function whose entry block is missing", () => {
    const origin = validatorOrigin("missing-entry");
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        entryBlockId: proofMirBlockId(99),
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: proofMirTerminatorFake({
              kind: "unreachable",
              reason: "unreachableSource",
            }),
            incomingEdges: [],
            origin,
          },
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CFG"),
    );
  });

  test("rejects control edges not listed in source block outgoing edges", () => {
    const edgeId = proofMirControlEdgeId(1);
    const orphanEdgeId = proofMirControlEdgeId(2);
    const targetBlockId = proofMirBlockId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "goto",
                target: { edgeId, blockId: targetBlockId },
              }),
              outgoingEdges: [edgeId],
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
          {
            blockId: targetBlockId,
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [edgeId],
            origin: validatorOrigin("block:1"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: targetBlockId,
          }),
          proofMirControlEdgeFake({
            edgeId: orphanEdgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: targetBlockId,
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_DISCONNECTED_CONTROL_EDGE"),
    );
    expect(
      diagnostics.some(
        (diagnostic) =>
          diagnostic.stableDetail ===
          `orphan-edge:${String(orphanEdgeId)}:${String(proofMirBlockId(0))}`,
      ),
    ).toBe(true);
  });

  test("rejects terminators whose outgoing edge list does not match targets", () => {
    const edgeId = proofMirControlEdgeId(1);
    const targetBlockId = proofMirBlockId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "goto",
                target: { edgeId, blockId: targetBlockId },
              }),
              outgoingEdges: [proofMirControlEdgeId(2)],
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
          {
            blockId: targetBlockId,
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [edgeId],
            origin: validatorOrigin("block:1"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: targetBlockId,
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CFG"),
    );
  });

  test("rejects block targets whose edge resolves to a different destination block", () => {
    const edgeId = proofMirControlEdgeId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "goto",
                target: { edgeId, blockId: proofMirBlockId(2) },
              }),
              outgoingEdges: [edgeId],
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: proofMirBlockId(1),
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_CONTROL_EDGE"),
    );
  });

  test("rejects join edges whose argument count does not match block parameters", () => {
    const joinBlockId = proofMirBlockId(1);
    const edgeId = proofMirControlEdgeId(1);
    const parameterValueId = proofMirValueId(10);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "goto",
                target: { edgeId, blockId: joinBlockId },
              }),
              outgoingEdges: [edgeId],
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
          {
            blockId: joinBlockId,
            scopeId: proofMirScopeId(0),
            parameters: [proofMirBlockParameterFake({ valueId: parameterValueId })],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [edgeId],
            origin: validatorOrigin("block:1"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            toBlockId: joinBlockId,
            arguments: [],
          }),
        ],
        values: [proofMirValueFake({ valueId: parameterValueId })],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_JOIN_ARGUMENTS"),
    );
  });

  test("rejects duplicate scalar value definitions", () => {
    const valueId = proofMirValueId(1);
    const origin = validatorOrigin("duplicate-value");
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        values: [proofMirValueFake({ valueId })],
        statements: [
          {
            statementId: 0 as never,
            kind: {
              kind: "literal",
              value: valueId,
              literal: { kind: "bool", value: true },
            },
            origin,
          },
          {
            statementId: 1 as never,
            kind: {
              kind: "literal",
              value: valueId,
              literal: { kind: "bool", value: false },
            },
            origin,
          },
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_SSA"),
    );
  });

  test("rejects block parameters whose values are not copy scalar or proof facts", () => {
    const parameterValueId = proofMirValueId(5);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [proofMirBlockParameterFake({ valueId: parameterValueId })],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
        ],
        values: [
          proofMirValueFake({
            valueId: parameterValueId,
            resourceKind: "Copy",
            representation: { kind: "never" },
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALUE_RESOURCE_KIND"),
    );
  });

  test("rejects block parameters whose value resource kind mismatches", () => {
    const parameterValueId = proofMirValueId(6);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [
              proofMirBlockParameterFake({
                valueId: parameterValueId,
                parameterKind: { kind: "copyScalar", resourceKind: "Copy" },
              }),
            ],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
        ],
        values: [
          proofMirValueFake({
            valueId: parameterValueId,
            resourceKind: "Affine",
            representation: { kind: "runtime" },
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_TYPE_RESOURCE_KIND_MISMATCH"),
    );
  });

  test("return terminators require matching control and exit edges", () => {
    const edgeId = proofMirControlEdgeId(1);
    const exitId = proofMirExitEdgeId(1);
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: proofMirBlockId(0),
            scopeId: proofMirScopeId(0),
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "return",
                edgeId,
                exit: exitId,
              }),
              outgoingEdges: [edgeId],
            },
            incomingEdges: [],
            origin: validatorOrigin("block:0"),
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId,
            fromBlockId: proofMirBlockId(0),
            kind: "returnExit",
          }),
        ],
        exits: [],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_EXIT_CLOSURE_POLICY"),
    );
  });
});
