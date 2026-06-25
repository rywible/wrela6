import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/frontend";
import { lowerTypedHir } from "../../../src/hir";
import type { LowerTypedHirResult } from "../../../src/hir";
import { checkSemanticSurface } from "../../../src/semantic/surface";
import { checkedProofSurface } from "../../../src/semantic/surface/proof-surface";
import type { CheckedProofSurface } from "../../../src/semantic/surface/proof-surface";
import {
  CheckedAttemptContractSurfaceTableBuilder,
  CheckedPrivateTransitionSurfaceTableBuilder,
  CheckedTakeModeSurfaceTableBuilder,
  CheckedValidationContractSurfaceTableBuilder,
} from "../../../src/semantic/surface/proof-contracts";
import { coreTypeId, typeId, type FunctionId } from "../../../src/semantic/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import {
  parseAndResolveSurfaceFixture,
  primitiveSpecFake,
  semanticTargetSurfaceFake,
} from "../../support/semantic/semantic-surface-fakes";
import {
  lowerTypedHirForTest,
  semanticSurfaceForHirTest,
} from "../../support/hir/typed-hir-fixtures";
import { targetWithCertifiedExit } from "../../support/hir/typed-hir-fakes";

function cloneProofSurface(
  surface: CheckedProofSurface,
  overrides: Partial<
    Pick<
      CheckedProofSurface,
      "takeModeSurfaces" | "validationContracts" | "attemptContracts" | "privateTransitions"
    >
  >,
): CheckedProofSurface {
  return checkedProofSurface({
    resourceKindByType: surface.resourceKindByType.entries(),
    signatureModes: surface.signatureModes.entries(),
    requirements: surface.requirementSurfaces.entries(),
    predicateFactSurfaces: surface.predicateFactSurfaces.entries(),
    terminalSurfaces: surface.terminalSurfaces.entries(),
    validationSurfaces: surface.validationSurfaces.entries(),
    privateStateSurfaces: surface.privateStateSurfaces.entries(),
    imageSurfaces: surface.imageSurfaces.entries(),
    platformContracts: surface.platformContracts,
    constructibilitySurfaces: surface.constructibilitySurfaces,
    takeModeSurfaces: overrides.takeModeSurfaces ?? surface.takeModeSurfaces,
    validationContracts: overrides.validationContracts ?? surface.validationContracts,
    attemptContracts: overrides.attemptContracts ?? surface.attemptContracts,
    privateTransitions: overrides.privateTransitions ?? surface.privateTransitions,
    platformEnsuredFacts: surface.platformEnsuredFacts,
    matchRefinements: surface.matchRefinements,
  });
}

function functionIdByName(
  fixture: ReturnType<typeof parseAndResolveSurfaceFixture>,
  name: string,
): FunctionId {
  const record = fixture.index.functions().find((entry) => entry.name === name);
  if (record === undefined) throw new Error(`Missing function ${name}`);
  return record.id;
}

function lowerWithInjectedProofSurface(): LowerTypedHirResult {
  const files: [string, string][] = [
    [
      "main.wr",
      [
        "fn source() -> u8",
        "fn validate(packet: u32) -> u32",
        "fn fallible(flag: bool) -> bool",
        "fn advance(state: u32) -> Never",
        "fn caller(packet: u32, flag: bool, state: u32) -> Never:",
        "    take source() as item:",
        "        continue",
        "    validate(packet)",
        "    fallible(flag)?",
        "    advance(state)",
      ].join("\n"),
    ],
  ];
  const fixture = parseAndResolveSurfaceFixture(files);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  const sourceFunctionId = functionIdByName(fixture, "source");
  const validateFunctionId = functionIdByName(fixture, "validate");
  const fallibleFunctionId = functionIdByName(fixture, "fallible");
  const advanceFunctionId = functionIdByName(fixture, "advance");
  const validateParameter = surface.program.functions.get(validateFunctionId)!.parameters[0]!;
  const fallibleParameter = surface.program.functions.get(fallibleFunctionId)!.parameters[0]!;
  const advanceParameter = surface.program.functions.get(advanceFunctionId)!.parameters[0]!;

  const takeModeSurfaces = new CheckedTakeModeSurfaceTableBuilder();
  takeModeSurfaces.add({
    kind: "stream",
    producerFunctionId: sourceFunctionId,
    itemType: coreCheckedType(coreTypeId("u8")),
    itemResourceKind: concreteKind("Affine"),
    span: SourceSpan.from(0, 0),
  });
  const validationContracts = new CheckedValidationContractSurfaceTableBuilder();
  validationContracts.add({
    validatedBufferTypeId: typeId(1000),
    resultType: coreCheckedType(coreTypeId("u32")),
    sourceType: coreCheckedType(coreTypeId("u32")),
    okPayloadType: coreCheckedType(coreTypeId("u32")),
    errPayloadType: coreCheckedType(coreTypeId("u32")),
    sourceParameterId: validateParameter.parameterId,
    span: SourceSpan.from(0, 0),
  });
  const attemptContracts = new CheckedAttemptContractSurfaceTableBuilder();
  attemptContracts.add({
    fallibleFunctionId,
    resultType: coreCheckedType(coreTypeId("bool")),
    okType: coreCheckedType(coreTypeId("bool")),
    errType: coreCheckedType(coreTypeId("u32")),
    inputs: [{ kind: "parameter", parameterId: fallibleParameter.parameterId }],
    span: SourceSpan.from(0, 0),
  });
  const privateTransitions = new CheckedPrivateTransitionSurfaceTableBuilder();
  privateTransitions.add({
    functionId: advanceFunctionId,
    kind: "advance",
    receiverParameterId: advanceParameter.parameterId,
    span: SourceSpan.from(0, 0),
  });

  return lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: {
      ...surface.program,
      proofSurface: cloneProofSurface(surface.program.proofSurface, {
        takeModeSurfaces: takeModeSurfaces.build(),
        validationContracts: validationContracts.build(),
        attemptContracts: attemptContracts.build(),
        privateTransitions: privateTransitions.build(),
      }),
    },
    image: surface.image,
  });
}

test("lowerTypedHir returns pure HIR result without upstream diagnostics", () => {
  const result = lowerTypedHirForTest([["main.wr", "fn caller() -> Never:\n    return\n"]]);

  expect(result.program.functions.entries()).toHaveLength(1);
  expect(result.diagnostics).toEqual([]);
});

test("orchestration wires ensure fact lowering into full HIR", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn caller(ready: bool) -> Never:\n    ensure ready\n"],
  ]);

  expect(result.program.proofMetadata.factOrigins.entries()[0]!.fact?.kind).toBe("ensure");
});

test("orchestration reports duplicate signature locals", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn caller(value: u32, value: u32) -> Never:\n    return\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_LOCAL_NAME_SHADOWS",
  );
});

test("orchestration wires terminal, predicate, platform, and requirement metadata", () => {
  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "predicate fn ready() -> bool",
          "terminal fn done() -> Never",
          "platform fn exit() -> Never",
          "fn guarded() -> Never:",
          "    requires:",
          "        ready",
          "    done()",
          "fn caller() -> Never:",
          "    ready()",
          "    guarded()",
          "    exit()",
        ].join("\n"),
      ],
    ],
    { platformNames: ["exit"], targetSurface: targetWithCertifiedExit() },
  );

  expect(result.program.proofMetadata.terminalCalls.entries()).toHaveLength(1);
  expect(
    result.program.proofMetadata.factOrigins.entries().map((fact) => fact.fact?.kind),
  ).toContain("predicateCall");
  expect(result.program.proofMetadata.callSiteRequirements.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.platformContractEdges.entries()).toHaveLength(1);
});

test("orchestration links validation matches through source let bindings", () => {
  const u32Type = coreCheckedType(coreTypeId("u32"));
  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "validate",
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
          returnType: u32Type,
          returnKind: concreteKind("Copy"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          validationContracts: [
            {
              validatedBufferTypeId: typeId(88),
              resultType: u32Type,
              sourceType: u32Type,
              okPayloadType: u32Type,
              errPayloadType: u32Type,
              sourceParameterIndex: 0,
            },
          ],
        },
      }),
    ],
  });

  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "platform fn validate(raw: u32) -> u32",
          "fn caller(raw: u32) -> u32:",
          "    let result = validate(raw)",
          "    match result:",
          "        case Ok(value):",
          "            return value",
          "        case Err(error):",
          "            return error",
        ].join("\n"),
      ],
    ],
    { platformNames: ["validate"], targetSurface },
  );

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_UNLINKED_VALIDATION_MATCH",
  );
  const caller = result.program.functions
    .entries()
    .find(
      (entry) =>
        entry.bodyStatus === "sourceBody" &&
        entry.signature.parameters.some((parameter) => parameter.name === "raw"),
    );
  const validationMatch = caller?.body?.statements.find(
    (statement) => statement.kind.kind === "validationMatch",
  );
  expect(validationMatch?.kind.kind).toBe("validationMatch");
  if (validationMatch?.kind.kind !== "validationMatch") {
    throw new Error("expected validation match");
  }
  expect(validationMatch.kind.statement.okArm?.bindingLocals.map((local) => local.name)).toEqual([
    "value",
  ]);
  expect(validationMatch.kind.statement.errArm?.bindingLocals.map((local) => local.name)).toEqual([
    "error",
  ]);
  const resultLocalId = caller?.locals.entries().find((local) => local.name === "result")?.localId;
  expect(result.program.proofMetadata.validations.entries()[0]?.resultLocalId).toBe(resultLocalId);
});

test("orchestration classifies validation match arms by Ok and Err pattern", () => {
  const u32Type = coreCheckedType(coreTypeId("u32"));
  const boolType = coreCheckedType(coreTypeId("bool"));
  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "validate",
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
          returnType: u32Type,
          returnKind: concreteKind("Copy"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          validationContracts: [
            {
              validatedBufferTypeId: typeId(88),
              resultType: u32Type,
              sourceType: u32Type,
              okPayloadType: boolType,
              errPayloadType: u32Type,
              sourceParameterIndex: 0,
            },
          ],
        },
      }),
    ],
  });

  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "platform fn validate(raw: u32) -> u32",
          "fn caller(raw: u32) -> u32:",
          "    let result = validate(raw)",
          "    match result:",
          "        case Err(error):",
          "            return error",
          "        case Ok(value):",
          "            return 1",
        ].join("\n"),
      ],
    ],
    { platformNames: ["validate"], targetSurface },
  );

  const caller = result.program.functions
    .entries()
    .find(
      (entry) =>
        entry.bodyStatus === "sourceBody" &&
        entry.signature.parameters.some((parameter) => parameter.name === "raw"),
    );
  const validationMatch = caller?.body?.statements.find(
    (statement) => statement.kind.kind === "validationMatch",
  );
  expect(validationMatch?.kind.kind).toBe("validationMatch");
  if (validationMatch?.kind.kind !== "validationMatch") {
    throw new Error("expected validation match");
  }
  expect(validationMatch.kind.statement.okArm?.patternText).toBe("Ok");
  expect(validationMatch.kind.statement.okArm?.bindingLocals[0]?.name).toBe("value");
  expect(validationMatch.kind.statement.okArm?.bindingLocals[0]?.type).toEqual(boolType);
  expect(validationMatch.kind.statement.errArm?.patternText).toBe("Err");
  expect(validationMatch.kind.statement.errArm?.bindingLocals[0]?.name).toBe("error");
  expect(validationMatch.kind.statement.errArm?.bindingLocals[0]?.type).toEqual(u32Type);
});

test("orchestration fails closed for malformed validation match arms", () => {
  const u32Type = coreCheckedType(coreTypeId("u32"));
  const targetSurface = semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "validate",
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
          returnType: u32Type,
          returnKind: concreteKind("Copy"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          validationContracts: [
            {
              validatedBufferTypeId: typeId(88),
              resultType: u32Type,
              sourceType: u32Type,
              okPayloadType: u32Type,
              errPayloadType: u32Type,
              sourceParameterIndex: 0,
            },
          ],
        },
      }),
    ],
  });

  const result = lowerTypedHirForTest(
    [
      [
        "main.wr",
        [
          "platform fn validate(raw: u32) -> u32",
          "fn caller(raw: u32) -> u32:",
          "    let result = validate(raw)",
          "    match result:",
          "        case Ok(value):",
          "            return value",
          "        case Ok(other):",
          "            return other",
        ].join("\n"),
      ],
    ],
    { platformNames: ["validate"], targetSurface },
  );

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_AMBIGUOUS_VALIDATION_MATCH",
  );
  const caller = result.program.functions
    .entries()
    .find(
      (entry) =>
        entry.bodyStatus === "sourceBody" &&
        entry.signature.parameters.some((parameter) => parameter.name === "raw"),
    );
  const validationMatch = caller?.body?.statements.find(
    (statement) => statement.kind.kind === "validationMatch",
  );
  expect(validationMatch?.kind.kind).toBe("validationMatch");
  if (validationMatch?.kind.kind !== "validationMatch") {
    throw new Error("expected validation match");
  }
  expect(validationMatch.kind.statement.recovered).toBe(true);
  expect(validationMatch.kind.statement.okArm).toBeUndefined();
  expect(validationMatch.kind.statement.errArm).toBeUndefined();
});

test("orchestration consumes checked proof contract tables for take validation attempt and private transition", () => {
  const result = lowerWithInjectedProofSurface();

  expect(result.program.proofMetadata.sessions.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.validations.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.attempts.entries()).toHaveLength(1);
  expect(result.program.proofMetadata.privateStateTransitions.entries()).toHaveLength(1);
});

test("orchestration uses checked stream payload type for take aliases", () => {
  const result = lowerWithInjectedProofSurface();
  const caller = result.program.functions
    .entries()
    .find((entry) =>
      entry.bodyIndex?.statements.entries().some((statement) => statement.kind.kind === "take"),
    );
  const alias = caller?.locals.entries().find((local) => local.introducedBy === "takeAlias");

  expect(alias?.type).toEqual(coreCheckedType(coreTypeId("u8")));
  expect(alias?.resourceKind).toEqual(concreteKind("Affine"));
});

test("orchestration keys take brands to the actual take statement ordinal", () => {
  const result = lowerWithInjectedProofSurface();
  const caller = result.program.functions
    .entries()
    .find((entry) =>
      entry.bodyIndex?.statements.entries().some((statement) => statement.kind.kind === "take"),
    );
  const takeStatement = caller?.bodyIndex?.statements
    .entries()
    .find((statement) => statement.kind.kind === "take");
  const takeBrand = result.program.proofMetadata.brands
    .entries()
    .find((brand) => brand.origin.kind === "functionTake");

  expect(takeStatement).toBeDefined();
  expect(takeBrand?.origin.kind).toBe("functionTake");
  if (takeBrand?.origin.kind !== "functionTake" || takeStatement === undefined) {
    throw new Error("expected take statement and function take brand");
  }
  expect(takeBrand.origin.statementOrdinal).toBe(takeStatement.statementId);
  expect(takeBrand.canonicalKey).toBe(
    `function:${caller!.functionId}:take:${takeStatement.statementId}`,
  );
});

test("orchestration uses checked stream payload type for for bindings", () => {
  const files: [string, string][] = [
    [
      "main.wr",
      [
        "fn source() -> u8",
        "fn caller() -> Never:",
        "    for item in source():",
        "        continue",
      ].join("\n"),
    ],
  ];
  const fixture = parseAndResolveSurfaceFixture(files);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });
  const takeModeSurfaces = new CheckedTakeModeSurfaceTableBuilder();
  takeModeSurfaces.add({
    kind: "stream",
    producerFunctionId: functionIdByName(fixture, "source"),
    itemType: coreCheckedType(coreTypeId("u8")),
    itemResourceKind: concreteKind("Affine"),
    span: SourceSpan.from(0, 0),
  });
  const result = lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: {
      ...surface.program,
      proofSurface: cloneProofSurface(surface.program.proofSurface, {
        takeModeSurfaces: takeModeSurfaces.build(),
      }),
    },
    image: surface.image,
  });
  const binding = result.program.functions
    .entries()
    .flatMap((entry) => entry.locals.entries())
    .find((local) => local.introducedBy === "forBinding");

  expect(binding?.type).toEqual(coreCheckedType(coreTypeId("u8")));
  expect(binding?.resourceKind).toEqual(concreteKind("Affine"));
});

test("orchestration fails closed for stream for without take-only surface", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "stream Counter:",
        "    field: u8",
        "fn produce() -> Counter",
        "fn caller() -> Never:",
        "    for item in produce():",
        "        continue",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_TAKE_ONLY_CALL_REQUIRED",
  );
  const forStatement = result.program.functions
    .entries()
    .flatMap((entry) => entry.bodyIndex?.statements.entries() ?? [])
    .find((statement) => statement.kind.kind === "for");
  expect(forStatement?.kind.kind).toBe("for");
  if (forStatement?.kind.kind !== "for") throw new Error("expected for statement");
  expect(forStatement.kind.statement.iteration.kind).toBe("error");
});

test("semantic surface exposes predicate facts for HIR to consume", () => {
  const surface = semanticSurfaceForHirTest([
    ["main.wr", "predicate fn ready() -> bool\nfn caller() -> Never:\n    ready()\n"],
  ]);

  expect(surface.program.proofSurface.predicateFactSurfaces.entries()).toHaveLength(1);
});

test("orchestration records match refinement facts from checked enum matches", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "enum PacketKind:",
        "    ping",
        "    pong",
        "fn caller(kind: PacketKind) -> u32:",
        "    match kind:",
        "        case PacketKind.ping:",
        "            return 1",
        "        case PacketKind.pong:",
        "            return 0",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).not.toContain(
    "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  );
  expect(
    result.program.proofMetadata.factOrigins.entries().map((fact) => fact.fact?.kind),
  ).toContain("matchRefinement");
});

test("orchestration fails closed for unsupported source-type match refinements", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "class Packet:",
        "fn caller(packet: Packet) -> u32:",
        "    match packet:",
        "        case Packet:",
        "            return 1",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  );
});

test("orchestration reports return type mismatches from checked function signatures", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn caller() -> bool:\n    return 1\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_RETURN_TYPE_MISMATCH",
  );
});

test("orchestration reports yield type mismatches from checked function signatures", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "fn caller() -> bool:\n    yield 1\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_YIELD_TYPE_MISMATCH",
  );
});
