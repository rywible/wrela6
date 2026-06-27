import { expect, test } from "bun:test";
import { functionId, imageId, itemId } from "../../../src/semantic/ids";
import { hirTable } from "../../../src/hir/hir-table";
import type { HirExpression, HirFunction, TypedHirProgram } from "../../../src/hir/hir";
import { genericParameterCheckedType } from "../../../src/semantic/surface/type-model";
import {
  derivedKind,
  errorKind,
  parametricKind,
} from "../../../src/semantic/surface/resource-kind";
import {
  instantiateMonoFunctionBody,
  instantiateMonoFunctionShell,
} from "../../../src/mono/function-instantiator";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import {
  bodylessRecoveryFunctionProgramForMonoTest,
  callIntoGenericFunctionProgramForMonoTest,
  errorExpressionBodyProgramForMonoTest,
  genericIdentityFunctionProgramForMonoTest,
  instantiateShellOk,
  eligibilityRuleTableFake,
  monoCoreType,
  monoFunctionKeyForTest,
  unresolvedGenericAtBoundaryProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import { hirOriginId } from "../../../src/hir/ids";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";

function callerProgramWithMutatedArgument(
  mutate: (expression: HirExpression) => HirExpression,
): TypedHirProgram {
  const base = callIntoGenericFunctionProgramForMonoTest();
  const sourceFunction = base.functions.get(functionId(1));
  if (sourceFunction?.body === undefined) throw new Error("expected bodyful caller");
  const returnStatement = sourceFunction.body.statements[0];
  if (returnStatement?.kind.kind !== "return") throw new Error("expected return statement");
  const callExpression = returnStatement.kind.expression;
  if (callExpression?.kind.kind !== "call") throw new Error("expected call expression");
  const argument = callExpression.kind.call.arguments[0];
  if (argument === undefined) throw new Error("expected call argument");

  const mutatedFunction: HirFunction = {
    ...sourceFunction,
    body: {
      ...sourceFunction.body,
      statements: [
        {
          ...returnStatement,
          kind: {
            kind: "return",
            expression: {
              ...callExpression,
              kind: {
                kind: "call",
                call: {
                  ...callExpression.kind.call,
                  arguments: [
                    {
                      ...argument,
                      expression: mutate(argument.expression),
                    },
                    ...callExpression.kind.call.arguments.slice(1),
                  ],
                },
              },
            },
          },
        },
        ...sourceFunction.body.statements.slice(1),
      ],
    },
  };

  return {
    ...base,
    functions: hirTable({
      entries: base.functions
        .entries()
        .map((entry) => (entry.functionId === sourceFunction.functionId ? mutatedFunction : entry)),
      keyOf: (entry: HirFunction) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id: HirFunction["functionId"]) => String(id).padStart(12, "0"),
    }),
  };
}

function targetProgramWithMutatedReturnPlace(
  mutate: (expression: HirExpression) => HirExpression,
): TypedHirProgram {
  const base = callIntoGenericFunctionProgramForMonoTest();
  const sourceFunction = base.functions.get(functionId(0));
  if (sourceFunction?.body === undefined) throw new Error("expected bodyful target");
  const returnStatement = sourceFunction.body.statements[0];
  if (returnStatement?.kind.kind !== "return" || returnStatement.kind.expression === undefined) {
    throw new Error("expected return statement");
  }

  const mutatedFunction: HirFunction = {
    ...sourceFunction,
    body: {
      ...sourceFunction.body,
      statements: [
        {
          ...returnStatement,
          kind: {
            kind: "return",
            expression: mutate(returnStatement.kind.expression),
          },
        },
        ...sourceFunction.body.statements.slice(1),
      ],
    },
  };

  return {
    ...base,
    functions: hirTable({
      entries: base.functions
        .entries()
        .map((entry) => (entry.functionId === sourceFunction.functionId ? mutatedFunction : entry)),
      keyOf: (entry: HirFunction) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id: HirFunction["functionId"]) => String(id).padStart(12, "0"),
    }),
  };
}

function fieldAggregatedSignatureProgramForTest(): {
  readonly program: TypedHirProgram;
  readonly functionId: ReturnType<typeof functionId>;
} {
  const source = [
    "unique edge class Token:",
    "class Box[T]:",
    "    token: T",
    "fn accept(box: Box[Token]) -> Never:",
    "    return",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  const sourceFunction = result.program.functions
    .entries()
    .find((entry) => entry.signature.parameters.some((parameter) => parameter.name === "box"));
  if (sourceFunction === undefined) throw new Error("expected accept function");
  const mutatedFunction: HirFunction = {
    ...sourceFunction,
    signature: {
      ...sourceFunction.signature,
      parameters: sourceFunction.signature.parameters.map((parameter) =>
        parameter.name === "box"
          ? { ...parameter, resourceKind: derivedKind("fieldAggregation", []) }
          : parameter,
      ),
    },
  };
  return {
    functionId: sourceFunction.functionId,
    program: {
      ...result.program,
      functions: hirTable({
        entries: result.program.functions
          .entries()
          .map((entry) =>
            entry.functionId === sourceFunction.functionId ? mutatedFunction : entry,
          ),
        keyOf: (entry: HirFunction) => String(entry.functionId).padStart(12, "0"),
        lookupKeyOf: (id: HirFunction["functionId"]) => String(id).padStart(12, "0"),
      }),
    },
  };
}

test("generic function signature and locals are instantiated", () => {
  const result = instantiateMonoFunctionShell({
    program: genericIdentityFunctionProgramForMonoTest(),
    key: monoFunctionKeyForTest({
      functionId: functionId(3),
      ownerTypeArguments: [],
      functionTypeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.signature.returnType.kind).toBe("core");
    expect(result.instance.locals.entries().map((local) => local.type.kind)).toEqual(["core"]);
  }
});

test("function signature field aggregation reads instantiated source fields", () => {
  const fixture = fieldAggregatedSignatureProgramForTest();

  const result = instantiateMonoFunctionShell({
    program: fixture.program,
    key: monoFunctionKeyForTest({
      functionId: fixture.functionId,
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.signature.parameters[0]?.resourceKind).toBe("Linear");
  }
});

test("local, expression, and statement ids include the function instance id", () => {
  const program = genericIdentityFunctionProgramForMonoTest();
  const first = instantiateMonoFunctionShell({
    program,
    key: monoFunctionKeyForTest({
      functionId: functionId(3),
      ownerTypeArguments: [],
      functionTypeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });
  const second = instantiateMonoFunctionShell({
    program,
    key: monoFunctionKeyForTest({
      functionId: functionId(3),
      ownerTypeArguments: [],
      functionTypeArguments: [monoCoreType("u32")],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") return;
  const firstLocal = first.instance.locals.entries()[0];
  const secondLocal = second.instance.locals.entries()[0];
  expect(firstLocal?.localId).toEqual({
    hirId: expect.any(Number),
    instanceId: first.instance.instanceId,
  });
  expect(secondLocal?.localId).toEqual({
    hirId: expect.any(Number),
    instanceId: second.instance.instanceId,
  });
  expect(firstLocal?.localId).not.toEqual(secondLocal?.localId);
});

test("generic function shell enforces instance eligibility rules", () => {
  const program = genericIdentityFunctionProgramForMonoTest();
  const sourceFunction = program.functions.get(functionId(3));
  expect(sourceFunction?.declaredTypeParameters).toHaveLength(1);
  if (sourceFunction === undefined) return;
  const restrictedProgram = {
    ...program,
    monoClosure: {
      ...program.monoClosure,
      instanceEligibilityRules: eligibilityRuleTableFake([
        {
          owner: { kind: "function", functionId: functionId(3) },
          parameter: sourceFunction.declaredTypeParameters[0]!,
          allowedConcreteKinds: ["Linear"],
          sourceOrigin: hirOriginId(0),
        },
      ]),
    },
  };

  const result = instantiateMonoFunctionShell({
    program: restrictedProgram,
    key: monoFunctionKeyForTest({
      functionId: functionId(3),
      ownerTypeArguments: [],
      functionTypeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_INSTANCE_KIND_ELIGIBILITY_FAILED"),
    );
  }
});

test("reachable bodyless recovery function is rejected", () => {
  const result = instantiateMonoFunctionShell({
    program: bodylessRecoveryFunctionProgramForMonoTest(),
    key: monoFunctionKeyForTest({
      functionId: functionId(4),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    source: { kind: "image", imageId: imageId(1) },
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error")
    expect(result.diagnostics[0]?.code).toBe(monoDiagnosticCode("MONO_REACHABLE_HIR_RECOVERY"));
});

test("generic function shell rejects unresolved signature types", () => {
  const program = unresolvedGenericAtBoundaryProgramForMonoTest();
  const entryFunctionId = program.images.entries()[0]?.entryFunctionId;
  if (entryFunctionId === undefined) throw new Error("expected image entry");

  const result = instantiateMonoFunctionShell({
    program,
    key: monoFunctionKeyForTest({
      functionId: entryFunctionId,
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_TYPE_PARAMETER"),
    );
  }
});

test("body instantiation remaps expression ids and extracts call edge", () => {
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
    expect(
      body.bodyIndex.statements
        .entries()
        .every((statement) => statement.statementId.instanceId === shell.instance.instanceId),
    ).toBe(true);
    expect(
      body.bodyIndex.expressions
        .entries()
        .every((expression) => expression.expressionId.instanceId === shell.instance.instanceId),
    ).toBe(true);
    expect(body.outgoingEdges.map((edge) => edge.targetKind)).toContain("function");
    expect(body.outgoingEdges[0]?.source.kind).toBe("function");
    const call = body.bodyIndex.expressions
      .entries()
      .map((expression) => expression.kind)
      .find((kind) => kind.kind === "call");
    expect(call?.kind).toBe("call");
    if (call?.kind === "call" && call.call.resolvedTarget?.kind === "sourceFunction") {
      expect(call.call.resolvedTarget.targetFunctionInstanceId).toBeDefined();
      expect(call.call.resolvedTarget.kind).not.toBe("certifiedPlatform");
    }
  }
});

test("recovered and unresolved calls do not receive fake resolved targets", () => {
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
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_REACHABLE_HIR_RECOVERY"),
    );
  }
});

test("body instantiation preserves normalization diagnostics from cloned expressions", () => {
  const unresolved = genericParameterCheckedType({
    owner: { kind: "item", itemId: itemId(901) },
    index: 0,
  });
  const program = callerProgramWithMutatedArgument((expression) => ({
    ...expression,
    type: unresolved,
  }));
  const shell = instantiateShellOk(program, { functionId: functionId(1) });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_TYPE_PARAMETER"),
    );
  }
});

test("body instantiation rejects error resource kinds instead of falling back to type kind", () => {
  const program = callerProgramWithMutatedArgument((expression) => ({
    ...expression,
    resourceKind: errorKind(),
  }));
  const shell = instantiateShellOk(program, { functionId: functionId(1) });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_RESOURCE_KIND"),
    );
  }
});

test("body instantiation rejects unresolved parametric resource kinds instead of falling back to type kind", () => {
  const program = callerProgramWithMutatedArgument((expression) => ({
    ...expression,
    resourceKind: parametricKind({
      owner: { kind: "item", itemId: itemId(902) },
      index: 0,
    }),
  }));
  const shell = instantiateShellOk(program, { functionId: functionId(1) });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_TYPE_PARAMETER"),
    );
  }
});

test("body resource place cloning preserves specific substitution diagnostics", () => {
  const unresolved = genericParameterCheckedType({
    owner: { kind: "item", itemId: itemId(903) },
    index: 0,
  });
  const program = targetProgramWithMutatedReturnPlace((expression) => ({
    ...expression,
    ...(expression.place !== undefined
      ? {
          place: {
            ...expression.place,
            type: unresolved,
          },
        }
      : {}),
  }));
  const shell = instantiateShellOk(program, {
    functionId: functionId(0),
    functionTypeArguments: [monoCoreType("u32")],
  });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_TYPE_PARAMETER"),
    );
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      monoDiagnosticCode("MONO_REACHABLE_HIR_RECOVERY"),
    );
  }
});

test("body instantiation rejects invalid derived resource kinds instead of falling back to type kind", () => {
  const program = callerProgramWithMutatedArgument((expression) => ({
    ...expression,
    resourceKind: derivedKind("targetDeclared", []),
  }));
  const shell = instantiateShellOk(program, { functionId: functionId(1) });
  const body = instantiateMonoFunctionBody({
    program,
    instance: shell.instance,
    substitution: shell.substitution,
    remap: shell.remap,
    source: { kind: "image", imageId: imageId(0) },
  });

  expect(body.kind).toBe("error");
  if (body.kind === "error") {
    expect(body.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_MISSING_TARGET_TYPE_KIND"),
    );
  }
});

test("reachable error expression is a closure error", () => {
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
  if (body.kind === "error")
    expect(body.diagnostics[0]?.code).toBe(monoDiagnosticCode("MONO_REACHABLE_HIR_RECOVERY"));
});
