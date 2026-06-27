import { describe, expect, test } from "bun:test";
import { hirExpressionId, hirLocalId, hirStatementId } from "../../../src/hir/ids";
import { instantiatedHirId, instantiatedHirIdKey, monoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance, MonoLocal, MonoLocalId } from "../../../src/mono/mono-hir";
import { buildMonoTable } from "../../../src/mono/proof-metadata-tables";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  collectLoopCarriedLocalsForLoop,
  createProofMirLocalClassifier,
} from "../../../src/proof-mir/lower/local-classifier";
import {
  classifyProofMirLocalsForFunctionForTest,
  classifyProofMirLocalsForTest,
} from "../../support/proof-mir/lower-harness/local-classifier-harness";
import { functionId, itemId } from "../../../src/semantic/ids";

const FUNCTION_INSTANCE_ID = monoInstanceId("fn:main");

describe("ProofMirLocalClassifier", () => {
  test("borrowed locals classify as place backed", () => {
    const result = classifyProofMirLocalsForTest({
      parameters: [{ name: "packet", type: "&Packet" }],
      body: ["let view = borrow packet.payload", "return view.len"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.classification.local("packet")?.storage).toBe("placeBacked");
  });

  test("missing body index is a construction diagnostic", () => {
    const result = classifyProofMirLocalsForFunctionForTest({
      bodyStatus: "sourceBody",
      bodyIndex: undefined,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
    );
  });

  test("copy scalar locals without place uses classify as scalarSsa", () => {
    const result = classifyProofMirLocalsForTest({
      parameters: [{ name: "value", type: "u8" }],
      body: ["return value"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.classification.local("value")?.storage).toBe("scalarSsa");
  });

  test("address-taken and resource-bearing locals classify as placeBacked", () => {
    const addressTaken = classifyProofMirLocalsForTest({
      parameters: [{ name: "packet", type: "Packet" }],
      body: ["let field = packet.payload", "return field"],
    });
    expect(addressTaken.kind).toBe("ok");
    if (addressTaken.kind !== "ok") return;
    expect(addressTaken.classification.local("packet")?.storage).toBe("placeBacked");

    const validatedBuffer = classifyProofMirLocalsForFunctionForTest({
      locals: [
        {
          name: "buffer",
          type: "ValidatedBuffer",
          resourceKind: "ValidatedBuffer",
        },
      ],
      bodyLines: ["return buffer"],
    });
    expect(validatedBuffer.kind).toBe("ok");
    if (validatedBuffer.kind !== "ok") return;
    expect(validatedBuffer.classification.local("buffer")?.storage).toBe("placeBacked");

    const affine = classifyProofMirLocalsForFunctionForTest({
      locals: [{ name: "handle", type: "Handle", resourceKind: "Affine" }],
      bodyLines: ["return handle"],
    });
    expect(affine.kind).toBe("ok");
    if (affine.kind !== "ok") return;
    expect(affine.classification.local("handle")?.storage).toBe("placeBacked");
  });

  test("classification order is deterministic by mono local id", () => {
    const result = classifyProofMirLocalsForTest({
      parameters: [{ name: "z", type: "u8", localIndex: 1 }],
      locals: [
        { name: "a", type: "u8", localIndex: 2 },
        { name: "b", type: "u8", localIndex: 3 },
      ],
      body: ["return a + b + z"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const orderedNames = result.classification.entries().map((entry) => entry.local.name);
    const orderedIds = result.classification.entries().map((entry) => entry.local.localId);

    expect(orderedNames).toEqual(["z", "a", "b"]);
    expect(
      [...orderedIds].sort((left, right) =>
        instantiatedHirIdKey(left).localeCompare(instantiatedHirIdKey(right)),
      ),
    ).toEqual(orderedIds);
  });

  test("classification order does not depend on traversal insertion order", () => {
    const forward = classifyProofMirLocalsForTest({
      locals: [
        { name: "first", type: "u8", localIndex: 1 },
        { name: "second", type: "u8", localIndex: 2 },
      ],
      body: ["return first + second"],
    });
    const reverse = classifyProofMirLocalsForTest({
      locals: [
        { name: "second", type: "u8", localIndex: 2 },
        { name: "first", type: "u8", localIndex: 1 },
      ],
      body: ["return second + first"],
    });

    expect(forward.kind).toBe("ok");
    expect(reverse.kind).toBe("ok");
    if (forward.kind !== "ok" || reverse.kind !== "ok") return;

    expect(forward.classification.entries().map((entry) => entry.local.name)).toEqual(
      reverse.classification.entries().map((entry) => entry.local.name),
    );
  });

  test("later lowerer request for unseen place use returns invalid value resource kind", () => {
    const build = classifyProofMirLocalsForTest({
      parameters: [{ name: "value", type: "u8" }],
      body: ["return value"],
    });
    expect(build.kind).toBe("ok");
    if (build.kind !== "ok") return;

    const confirmation = build.classifier.requireRecordedPlaceUse({
      localId: build.classification.local("value")!.local.localId,
      use: "place",
    });

    expect(confirmation.kind).toBe("error");
    if (confirmation.kind !== "error") return;
    expect(confirmation.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALUE_RESOURCE_KIND"),
    );
  });

  test("later lowerer request for unseen borrow use returns invalid value resource kind", () => {
    const build = classifyProofMirLocalsForTest({
      parameters: [{ name: "value", type: "u8" }],
      body: ["return value"],
    });
    expect(build.kind).toBe("ok");
    if (build.kind !== "ok") return;

    const confirmation = build.classifier.requireRecordedPlaceUse({
      localId: build.classification.local("value")!.local.localId,
      use: "borrow",
    });

    expect(confirmation.kind).toBe("error");
    if (confirmation.kind !== "error") return;
    expect(confirmation.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_VALUE_RESOURCE_KIND"),
    );
  });

  test("recorded borrow use is accepted for place-backed locals", () => {
    const build = classifyProofMirLocalsForTest({
      parameters: [{ name: "packet", type: "&Packet" }],
      body: ["let view = borrow packet.payload", "return view.len"],
    });
    expect(build.kind).toBe("ok");
    if (build.kind !== "ok") return;

    const confirmation = build.classifier.requireRecordedPlaceUse({
      localId: build.classification.local("packet")!.local.localId,
      use: "borrow",
    });

    expect(confirmation.kind).toBe("ok");
  });

  test("collectLoopCarriedLocalsForLoop finds outer scalarSsa locals assigned in while body", () => {
    const functionInstanceId = monoInstanceId("fn:loop-carried");
    const result = classifyProofMirLocalsForFunctionForTest({
      functionInstanceId,
      locals: [{ name: "i", type: "u8", localIndex: 1 }],
      bodyLines: ["return i"],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const iLocal = result.classification.local("i")!.local;
    const carried = collectLoopCarriedLocalsForLoop({
      classification: result.classification,
      allLocals: [iLocal],
      loopBody: {
        statements: [
          {
            statementId: instantiatedHirId(functionInstanceId, hirStatementId(2)),
            kind: {
              kind: "assignment",
              statement: {
                target: {
                  expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(1)),
                  kind: { kind: "name", name: "i", localId: iLocal.localId },
                  type: iLocal.type,
                  resourceKind: "Copy",
                  sourceOrigin: "source:target:i",
                },
                value: {
                  expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(2)),
                  kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
                  type: iLocal.type,
                  resourceKind: "Copy",
                  sourceOrigin: "source:value:1",
                },
              },
            },
            sourceOrigin: "source:assign:i",
          },
        ],
        sourceOrigin: "source:while:body",
      },
    });

    expect(carried.map((local) => local.name)).toEqual(["i"]);
  });

  test("collectLoopCarriedLocalsForLoop ignores locals introduced inside the loop body", () => {
    const functionInstanceId = monoInstanceId("fn:loop-introduced");
    const result = classifyProofMirLocalsForFunctionForTest({
      functionInstanceId,
      locals: [{ name: "j", type: "u8", localIndex: 1 }],
      bodyLines: ["return j"],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const jLocal = result.classification.local("j")!.local;
    const carried = collectLoopCarriedLocalsForLoop({
      classification: result.classification,
      allLocals: [jLocal],
      loopBody: {
        statements: [
          {
            statementId: instantiatedHirId(functionInstanceId, hirStatementId(2)),
            kind: {
              kind: "let",
              statement: {
                local: {
                  localId: instantiatedHirId(functionInstanceId, hirLocalId(2)),
                  name: "j",
                  type: jLocal.type,
                  resourceKind: "Copy",
                  mode: "ordinary",
                  introducedBy: "sourceLet",
                  sourceOrigin: "source:let:j",
                },
                value: {
                  expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(1)),
                  kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
                  type: jLocal.type,
                  resourceKind: "Copy",
                  sourceOrigin: "source:value:0",
                },
              },
            },
            sourceOrigin: "source:let:j",
          },
          {
            statementId: instantiatedHirId(functionInstanceId, hirStatementId(3)),
            kind: {
              kind: "assignment",
              statement: {
                target: {
                  expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(2)),
                  kind: {
                    kind: "name",
                    name: "j",
                    localId: instantiatedHirId(functionInstanceId, hirLocalId(2)),
                  },
                  type: jLocal.type,
                  resourceKind: "Copy",
                  sourceOrigin: "source:target:j",
                },
                value: {
                  expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(3)),
                  kind: { kind: "literal", literal: { kind: "integer", text: "1" } },
                  type: jLocal.type,
                  resourceKind: "Copy",
                  sourceOrigin: "source:value:1",
                },
              },
            },
            sourceOrigin: "source:assign:j",
          },
        ],
        sourceOrigin: "source:while:body",
      },
    });

    expect(carried).toEqual([]);
  });

  test("createProofMirLocalClassifier rejects source-body functions without body index", () => {
    const functionInstance: MonoFunctionInstance = {
      instanceId: FUNCTION_INSTANCE_ID,
      sourceFunctionId: functionId(1),
      sourceItemId: itemId(1),
      ownerTypeArguments: [],
      functionTypeArguments: [],
      signature: {
        functionId: functionId(1),
        itemId: itemId(1),
        parameters: [],
        returnType: { kind: "core", coreTypeId: "Never" } as never,
        returnKind: "Never",
        modifiers: {
          isPlatform: false,
          isTerminal: false,
          isPredicate: false,
          isConstructor: false,
          isPrivate: false,
        },
        sourceSpan: { start: 0, end: 0, length: 0 },
      },
      bodyStatus: "sourceBody",
      locals: buildMonoTable<MonoLocalId, MonoLocal>(
        [],
        (entry) => instantiatedHirIdKey(entry.localId),
        (id) => instantiatedHirIdKey(id),
      ),
      declaredRequirements: [],
      sourceOrigin: "source:1",
    };

    const result = createProofMirLocalClassifier({ functionInstance });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY"),
      );
    }
  });
});
