import { expect, test } from "bun:test";
import { functionId, imageId, typeId } from "../../../src/semantic/ids";
import { instantiateMonoFunctionBody } from "../../../src/mono/function-instantiator";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import {
  callIntoGenericFunctionProgramForMonoTest,
  emptyMonoAncestryForTest,
  errorExpressionBodyProgramForMonoTest,
  genericBoxProgramForMonoTest,
  genericValidatedBufferProgramForMonoTest,
  instantiateShellOk,
  monoCoreType,
  monoTypeKeyForTest,
  ownerMethodInstantiationProgramForMonoTest,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";

test("generic instantiation clones caller body and extracts target edge", () => {
  const program = callIntoGenericFunctionProgramForMonoTest();
  const shell = instantiateShellOk(program, { functionId: functionId(1) });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("ok");
  if (body.kind === "ok") {
    expect(body.body.statements).toHaveLength(1);
    expect(body.outgoingEdges.length).toBeGreaterThanOrEqual(1);
    const functionEdges = body.outgoingEdges.filter((edge) => edge.targetKind === "function");
    expect(functionEdges).toHaveLength(1);
    expect(functionEdges[0]?.source.kind).toBe("function");
    expect(String(functionEdges[0]?.targetKey)).toContain("fn:0");
    expect(String(functionEdges[0]?.targetKey)).toContain("core:u32");
  }
});

test("generic instantiation rejects reachable error expressions", () => {
  const program = errorExpressionBodyProgramForMonoTest();
  const shell = instantiateShellOk(program);
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics[0]?.code).toBe(monoDiagnosticCode("MONO_REACHABLE_HIR_RECOVERY"));
  }
});

test("generic validated buffer instanceId matches canonical type identity", () => {
  const result = instantiateMonoType({
    program: genericValidatedBufferProgramForMonoTest(),
    key: monoTypeKeyForTest({
      typeId: typeId(10),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const buffer = result.validatedBuffer;
    expect(buffer).toBeDefined();
    expect(buffer?.instanceId).toBe(result.instance.instanceId);
    expect(buffer?.typeId).toBe(result.instance.sourceTypeId);
    expect(buffer?.itemId).toBe(result.instance.sourceItemId);
  }
});

test("non validated buffer source types do not produce a validated buffer row", () => {
  const result = instantiateMonoType({
    program: genericBoxProgramForMonoTest(),
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.validatedBuffer).toBeUndefined();
  }
});

test("two call sites against the same generic instance collapse to one mono instance with two edges", () => {
  const result = monomorphizeWholeImage({
    program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const identityInstances = result.program.functions
      .entries()
      .filter((entry) => entry.sourceFunctionId === functionId(9));
    const callExpressionIds = result.program.instantiationGraph.edges
      .filter(
        (edge) =>
          edge.targetKind === "function" &&
          edge.targetInstanceId === identityInstances[0]?.instanceId,
      )
      .flatMap((edge) =>
        edge.source.kind === "function" && edge.source.callExpressionId !== undefined
          ? [edge.source.callExpressionId]
          : [],
      )
      .sort((left, right) => left.hirId - right.hirId);

    expect(identityInstances).toHaveLength(1);
    expect(callExpressionIds).toHaveLength(2);
    expect(new Set(callExpressionIds).size).toBe(2);
  }
});

test("owner method root instantiates with concrete owner type arguments", () => {
  const result = monomorphizeWholeImage({
    program: ownerMethodInstantiationProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const ownerMethod = result.program.functions
      .entries()
      .find((entry) => entry.ownerTypeInstanceId !== undefined);

    expect(ownerMethod).toBeDefined();
    expect(ownerMethod?.ownerTypeArguments.map((argument) => argument.kind)).toEqual(["core"]);
    expect(ownerMethod?.ownerTypeInstanceId).toBeDefined();
  }
});
