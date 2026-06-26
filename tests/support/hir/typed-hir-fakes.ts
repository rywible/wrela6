import { SourceSpan } from "../../../src/shared/source-span";
import {
  coreTypeId,
  functionId,
  itemId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../src/semantic/ids";
import type { FunctionId, ParameterId, TypeId } from "../../../src/semantic/ids";
import type { SemanticTargetSurface } from "../../../src/semantic/surface/platform-surface";
import {
  concreteKind,
  type CheckedResourceKind,
} from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType, type CheckedType } from "../../../src/semantic/surface/type-model";
import type {
  CertifiedPlatformBinding,
  CheckedFunctionSignature,
} from "../../../src/semantic/surface/checked-program";
import type {
  CheckedAttemptContractSurface,
  CheckedValidationContractSurface,
  CheckedTakeModeSurface,
} from "../../../src/semantic/surface/proof-contracts";
import {
  terminalSurface,
  type CheckedTerminalSurface,
} from "../../../src/semantic/surface/proof-surface";
import {
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  ownedResourcePlaceId,
} from "../../../src/hir/ids";
import type {
  HirCallArgument,
  HirCallExpression,
  HirExpression,
  HirLocal,
  HirResourcePlace,
} from "../../../src/hir/hir";
import {
  deviceSurfaceFake,
  primitiveSpecFake,
  semanticTargetSurfaceFake,
  shuffledSemanticTargetSurfaceFake as shuffledSemanticTargetSurfaceFakeBase,
  uefiImageProfileFake,
  platformVoidTargetSignature,
} from "../semantic/semantic-surface-fakes";

export { shuffledSemanticTargetSurfaceFakeBase as shuffledSemanticTargetSurfaceFake };

export function targetWithCertifiedExit(): SemanticTargetSurface {
  const exitPrimitive = primitiveSpecFake({
    name: "exit",
    signature: platformVoidTargetSignature(),
  });

  return semanticTargetSurfaceFake({
    primitives: [exitPrimitive],
  });
}

export function targetWithSerialDevice(edgeRootNames: readonly string[]): SemanticTargetSurface {
  const serialDevice = deviceSurfaceFake({
    name: "serial",
    sourceTypeName: "SerialDevice",
    resourceKind: "UniqueEdgeRoot",
    uniqueEdgeRoots: edgeRootNames,
  });

  return semanticTargetSurfaceFake({
    devices: [serialDevice],
    profiles: [
      {
        ...uefiImageProfileFake(),
        availableDeviceSurfaces: [serialDevice.deviceSurfaceId],
      },
    ],
  });
}

export function targetWithRejectedRawEnsuredFact(): SemanticTargetSurface {
  return semanticTargetSurfaceFake({
    primitives: [
      primitiveSpecFake({
        name: "raw_contract",
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [{ kind: "rawText", text: "ready(self)" }],
        },
      }),
    ],
  });
}

export function proofSurfaceKitchenSinkProgram(): readonly [string, string][] {
  return [
    [
      "main.wr",
      [
        "predicate fn ready() -> bool",
        "terminal fn stop() -> Never",
        "platform fn exit() -> Never",
        "fn use(ready_value: bool) -> Never:",
        "    ensure ready_value",
        "    stop()",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ];
}

export function streamTakeSurface(producerFunctionId: FunctionId): CheckedTakeModeSurface {
  return {
    kind: "stream",
    producerFunctionId,
    itemType: coreCheckedType(coreTypeId("u8")),
    itemResourceKind: concreteKind("Affine"),
    span: SourceSpan.from(0, 0),
  };
}

export function bufferTakeSurface(sourceTypeId: TypeId): CheckedTakeModeSurface {
  return {
    kind: "buffer",
    sourceTypeId,
    bufferResourceKind: concreteKind("Linear"),
    span: SourceSpan.from(0, 0),
  };
}

export function attemptContractForParameter(parameter: ParameterId): CheckedAttemptContractSurface {
  return {
    fallibleFunctionId: functionId(0),
    resultType: coreCheckedType(coreTypeId("Attempt")),
    okType: coreCheckedType(coreTypeId("bool")),
    errType: coreCheckedType(coreTypeId("u32")),
    inputs: [{ kind: "parameter", parameterId: parameter }],
    span: SourceSpan.from(0, 0),
  };
}

export function validationContractForBuffer(
  bufferTypeId: TypeId,
): CheckedValidationContractSurface {
  return {
    validatedBufferTypeId: bufferTypeId,
    resultType: coreCheckedType(coreTypeId("ValidationResult")),
    sourceType: coreCheckedType(coreTypeId("Buffer")),
    okPayloadType: coreCheckedType(coreTypeId("Buffer")),
    errPayloadType: coreCheckedType(coreTypeId("u32")),
    span: SourceSpan.from(0, 0),
  };
}

export function certifiedPlatformBindingFake(input: {
  readonly primitiveName: string;
}): CertifiedPlatformBinding {
  return {
    itemId: itemId(0),
    functionId: functionId(0),
    primitiveId: platformPrimitiveId(input.primitiveName),
    contractId: platformContractId(`${input.primitiveName}_contract`),
    targetId: targetId("uefi-aarch64"),
    certificate: {
      kind: "exactCatalogMatch",
      signatureFingerprint: `sig:${input.primitiveName}`,
      proofContractFingerprint: `contract:${input.primitiveName}`,
    },
  };
}

export function terminalSurfaceFake(input: {
  readonly functionId: FunctionId;
}): CheckedTerminalSurface {
  return terminalSurface({
    functionId: input.functionId,
    span: SourceSpan.from(0, 0),
  });
}

function nameExpressionFake(functionIdValue: FunctionId): HirExpression {
  return {
    expressionId: hirExpressionId(0),
    kind: {
      kind: "name",
      name: `function_${functionIdValue}`,
      functionId: functionIdValue,
    },
    type: coreCheckedType(coreTypeId("Function")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
  };
}

export function successfulCallFake(input: {
  readonly calleeFunctionId: FunctionId;
  readonly arguments?: readonly HirCallArgument[];
}): HirCallExpression {
  return {
    callee: nameExpressionFake(input.calleeFunctionId),
    calleeFunctionId: input.calleeFunctionId,
    ownerTypeArguments: [],
    ownerTypeArgumentSource: "none",
    arguments: input.arguments ?? [],
    typeArguments: [],
    sourceOrigin: hirOriginId(0),
  };
}

export function parameterPlace(parameter: ParameterId): HirResourcePlace {
  return {
    placeId: ownedResourcePlaceId(
      { kind: "function", functionId: functionId(0) },
      parameter as number,
    ),
    canonicalKey: `function:0/root:parameter:${parameter}/projection:/type:core:u32/kind:concrete:Copy`,
    root: { kind: "parameter", parameterId: parameter },
    projection: [],
    type: coreCheckedType(coreTypeId("u32")),
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
    kind: "parameter",
    parameterId: parameter,
  };
}

export function localFake(input: { readonly name: string; readonly type: CheckedType }): HirLocal {
  return {
    localId: hirLocalId(0),
    name: input.name,
    type: input.type,
    resourceKind: concreteKind("Copy"),
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: hirOriginId(0),
  };
}

export function checkedFunctionSignatureFake(overrides?: {
  readonly functionId?: FunctionId;
  readonly returnType?: CheckedType;
  readonly returnKind?: CheckedResourceKind;
}): CheckedFunctionSignature {
  const id = overrides?.functionId ?? functionId(0);
  return {
    functionId: id,
    itemId: itemId(id as number),
    parameters: [],
    returnType: overrides?.returnType ?? coreCheckedType(coreTypeId("u32")),
    returnKind: overrides?.returnKind ?? concreteKind("Copy"),
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}
