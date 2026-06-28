import type { BrandId } from "../../hir/ids";
import type { LayoutTypeKey } from "../../layout/layout-program";
import type {
  ProofMirLayoutTermPath,
  ProofMirLayoutTermReference,
  ProofMirLayoutTermRoot,
} from "../../proof-mir/model/layout-bindings";
import type {
  MonoCheckedType,
  MonoInstantiatedProofId,
  MonoLiteralValue,
  MonoProofOwner,
} from "../../mono/mono-hir";
import { monoCheckedTypeFingerprint } from "../../mono/mono-checked-type-fingerprint";
import { serializeProofAuthorityValue, type ProofAuthorityValue } from "./canonical-serialization";
import type {
  ProofCheckBrandBinder,
  ProofCheckFactTerm,
  ProofCheckNumericDomain,
  ProofCheckOperandTerm,
  ProofCheckPlaceBinder,
  ProofCheckPrivateStateBinder,
  ProofCheckRequirementTerm,
  ProofCheckTermProjection,
  ProofCheckTypeFactInvalidation,
  ProofCheckValueBinder,
} from "../model/fact-language";
import type {
  ProofCheckCallableSignature,
  ProofCheckContractEffect,
  ProofCheckGuardedPostcondition,
  ProofCheckPlatformContract,
} from "./platform-contracts";
import type {
  ProofCheckTypeFactCatalogEntry,
  ProofCheckTypeFactSchema,
} from "./type-fact-authority";

function proofCheckAuthorityArrayValue(items: readonly ProofAuthorityValue[]): ProofAuthorityValue {
  return { kind: "array", items };
}

function compareSerializedBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! - right[index]!;
    }
  }
  return left.length - right.length;
}

export function authorityContentBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return compareSerializedBytes(left, right) === 0;
}

function monoProofOwnerAuthorityValue(owner: MonoProofOwner): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "monoProofOwner",
    fields: [
      { name: "kind", value: { kind: "string", value: owner.kind } },
      { name: "instanceId", value: { kind: "string", value: String(owner.instanceId) } },
    ],
  };
}

function monoInstantiatedProofIdAuthorityValue<IdValue>(
  id: MonoInstantiatedProofId<IdValue>,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "monoInstantiatedProofId",
    fields: [
      { name: "owner", value: monoProofOwnerAuthorityValue(id.owner) },
      { name: "hirId", value: { kind: "string", value: String(id.hirId) } },
      { name: "instanceId", value: { kind: "string", value: String(id.instanceId) } },
    ],
  };
}

function layoutTypeKeyAuthorityValue(key: LayoutTypeKey): ProofAuthorityValue {
  switch (key.kind) {
    case "source":
      return {
        kind: "record",
        recordKind: "layoutTypeKey",
        fields: [
          { name: "kind", value: { kind: "string", value: "source" } },
          { name: "instanceId", value: { kind: "string", value: String(key.instanceId) } },
        ],
      };
    case "core":
      return {
        kind: "record",
        recordKind: "layoutTypeKey",
        fields: [
          { name: "kind", value: { kind: "string", value: "core" } },
          { name: "coreTypeId", value: { kind: "string", value: key.coreTypeId } },
        ],
      };
    case "target":
      return {
        kind: "record",
        recordKind: "layoutTypeKey",
        fields: [
          { name: "kind", value: { kind: "string", value: "target" } },
          { name: "targetTypeId", value: { kind: "string", value: key.targetTypeId } },
        ],
      };
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

function monoLiteralValueAuthorityValue(literal: MonoLiteralValue): ProofAuthorityValue {
  switch (literal.kind) {
    case "integer":
      return {
        kind: "record",
        recordKind: "monoLiteral",
        fields: [
          { name: "kind", value: { kind: "string", value: "integer" } },
          { name: "text", value: { kind: "string", value: literal.text } },
          {
            name: "value",
            value:
              literal.value === undefined
                ? { kind: "absent" }
                : { kind: "int", value: literal.value },
          },
        ],
      };
    case "string":
      return {
        kind: "record",
        recordKind: "monoLiteral",
        fields: [
          { name: "kind", value: { kind: "string", value: "string" } },
          { name: "value", value: { kind: "string", value: literal.value } },
        ],
      };
    case "bool":
      return {
        kind: "record",
        recordKind: "monoLiteral",
        fields: [
          { name: "kind", value: { kind: "string", value: "bool" } },
          { name: "value", value: { kind: "bool", value: literal.value } },
        ],
      };
    default: {
      const unreachable: never = literal;
      return unreachable;
    }
  }
}

function proofCheckNumericDomainAuthorityValue(
  domain: ProofCheckNumericDomain,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "proofCheckNumericDomain",
    fields: [
      { name: "widthBits", value: { kind: "int", value: BigInt(domain.widthBits) } },
      { name: "signedness", value: { kind: "string", value: domain.signedness } },
      { name: "overflow", value: { kind: "string", value: domain.overflow } },
    ],
  };
}

export function proofCheckPlaceBinderAuthorityValue(
  binder: ProofCheckPlaceBinder,
): ProofAuthorityValue {
  switch (binder.kind) {
    case "receiver":
      return { kind: "union", variant: "receiver", value: { kind: "absent" } };
    case "parameter":
      return {
        kind: "union",
        variant: "parameter",
        value: {
          kind: "record",
          recordKind: "parameter",
          fields: [
            { name: "index", value: { kind: "int", value: BigInt(binder.index) } },
            {
              name: "parameterId",
              value:
                binder.parameterId === undefined
                  ? { kind: "absent" }
                  : { kind: "string", value: String(binder.parameterId) },
            },
          ],
        },
      };
    case "argument":
      return {
        kind: "union",
        variant: "argument",
        value: {
          kind: "record",
          recordKind: "argument",
          fields: [
            { name: "index", value: { kind: "int", value: BigInt(binder.index) } },
            {
              name: "parameterId",
              value:
                binder.parameterId === undefined
                  ? { kind: "absent" }
                  : { kind: "string", value: String(binder.parameterId) },
            },
          ],
        },
      };
    case "result":
      return { kind: "union", variant: "result", value: { kind: "absent" } };
    case "subject":
      return { kind: "union", variant: "subject", value: { kind: "absent" } };
    case "proofMirPlace":
      return {
        kind: "union",
        variant: "proofMirPlace",
        value: { kind: "int", value: BigInt(binder.placeId) },
      };
    case "synthetic":
      return {
        kind: "union",
        variant: "synthetic",
        value: { kind: "id", idKind: "syntheticBinder", stableId: String(binder.id) },
      };
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function proofCheckValueBinderAuthorityValue(binder: ProofCheckValueBinder): ProofAuthorityValue {
  switch (binder.kind) {
    case "proofMirValue":
      return {
        kind: "union",
        variant: "proofMirValue",
        value: { kind: "int", value: BigInt(binder.valueId) },
      };
    case "resultValue":
      return { kind: "union", variant: "resultValue", value: { kind: "absent" } };
    case "synthetic":
      return {
        kind: "union",
        variant: "synthetic",
        value: { kind: "id", idKind: "syntheticBinder", stableId: String(binder.id) },
      };
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function proofCheckBrandBinderAuthorityValue(binder: ProofCheckBrandBinder): ProofAuthorityValue {
  switch (binder.kind) {
    case "proofBrand":
      return {
        kind: "union",
        variant: "proofBrand",
        value: monoInstantiatedProofIdAuthorityValue(binder.brandId),
      };
    case "subjectBrand":
      return { kind: "union", variant: "subjectBrand", value: { kind: "absent" } };
    case "sourceBrand":
      return {
        kind: "union",
        variant: "sourceBrand",
        value: proofCheckPlaceBinderAuthorityValue(binder.place),
      };
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function proofCheckTermProjectionAuthorityValue(
  projection: ProofCheckTermProjection,
): ProofAuthorityValue {
  switch (projection.kind) {
    case "field":
      return {
        kind: "record",
        recordKind: "projection",
        fields: [
          { name: "kind", value: { kind: "string", value: "field" } },
          { name: "fieldId", value: { kind: "string", value: String(projection.fieldId) } },
        ],
      };
    case "deref":
      return {
        kind: "record",
        recordKind: "projection",
        fields: [{ name: "kind", value: { kind: "string", value: "deref" } }],
      };
    case "variant":
      return {
        kind: "record",
        recordKind: "projection",
        fields: [
          { name: "kind", value: { kind: "string", value: "variant" } },
          { name: "name", value: { kind: "string", value: projection.name } },
        ],
      };
    case "validatedPacketPayload":
      return {
        kind: "record",
        recordKind: "projection",
        fields: [
          { name: "kind", value: { kind: "string", value: "validatedPacketPayload" } },
          {
            name: "validationId",
            value: monoInstantiatedProofIdAuthorityValue(projection.validationId),
          },
        ],
      };
    case "imageDevice":
      return {
        kind: "record",
        recordKind: "projection",
        fields: [
          { name: "kind", value: { kind: "string", value: "imageDevice" } },
          { name: "fieldId", value: { kind: "string", value: String(projection.fieldId) } },
        ],
      };
    default: {
      const unreachable: never = projection;
      return unreachable;
    }
  }
}

function proofMirLayoutTermRootAuthorityValue(root: ProofMirLayoutTermRoot): ProofAuthorityValue {
  switch (root.kind) {
    case "validatedBufferSourceLength":
      return {
        kind: "record",
        recordKind: "layoutTermRoot",
        fields: [
          { name: "kind", value: { kind: "string", value: root.kind } },
          { name: "instanceId", value: { kind: "string", value: String(root.instanceId) } },
        ],
      };
    case "validatedBufferFieldTerm":
      return {
        kind: "record",
        recordKind: "layoutTermRoot",
        fields: [
          { name: "kind", value: { kind: "string", value: root.kind } },
          { name: "instanceId", value: { kind: "string", value: String(root.instanceId) } },
          { name: "fieldId", value: { kind: "string", value: String(root.fieldId) } },
          { name: "slot", value: { kind: "string", value: root.slot } },
        ],
      };
    case "validatedBufferReadRequirement":
      return {
        kind: "record",
        recordKind: "layoutTermRoot",
        fields: [
          { name: "kind", value: { kind: "string", value: root.kind } },
          { name: "instanceId", value: { kind: "string", value: String(root.instanceId) } },
          { name: "fieldId", value: { kind: "string", value: String(root.fieldId) } },
          {
            name: "requirementIndex",
            value: { kind: "int", value: BigInt(root.requirementIndex) },
          },
          { name: "slot", value: { kind: "string", value: root.slot } },
        ],
      };
    case "validatedBufferDerivedSource":
      return {
        kind: "record",
        recordKind: "layoutTermRoot",
        fields: [
          { name: "kind", value: { kind: "string", value: root.kind } },
          { name: "instanceId", value: { kind: "string", value: String(root.instanceId) } },
          { name: "fieldId", value: { kind: "string", value: String(root.fieldId) } },
        ],
      };
    case "validatedBufferDerivedCase":
      return {
        kind: "record",
        recordKind: "layoutTermRoot",
        fields: [
          { name: "kind", value: { kind: "string", value: root.kind } },
          { name: "instanceId", value: { kind: "string", value: String(root.instanceId) } },
          { name: "fieldId", value: { kind: "string", value: String(root.fieldId) } },
          { name: "caseIndex", value: { kind: "int", value: BigInt(root.caseIndex) } },
          { name: "slot", value: { kind: "string", value: root.slot } },
        ],
      };
    default: {
      const unreachable: never = root;
      return unreachable;
    }
  }
}

function proofMirLayoutTermPathAuthorityValue(path: ProofMirLayoutTermPath): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "layoutTermPath",
    fields: [
      { name: "root", value: proofMirLayoutTermRootAuthorityValue(path.root) },
      {
        name: "childPath",
        value: proofCheckAuthorityArrayValue(
          path.childPath.map((child) => ({ kind: "string", value: child })),
        ),
      },
    ],
  };
}

function proofMirLayoutTermReferenceAuthorityValue(
  term: ProofMirLayoutTermReference,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "layoutTermReference",
    fields: [
      { name: "termId", value: { kind: "int", value: BigInt(term.termId) } },
      { name: "path", value: proofMirLayoutTermPathAuthorityValue(term.path) },
      { name: "unit", value: { kind: "string", value: term.unit } },
    ],
  };
}

export function proofCheckOperandTermAuthorityValue(
  operand: ProofCheckOperandTerm,
): ProofAuthorityValue {
  switch (operand.kind) {
    case "place":
      return {
        kind: "union",
        variant: "place",
        value: {
          kind: "record",
          recordKind: "placeOperand",
          fields: [
            { name: "place", value: proofCheckPlaceBinderAuthorityValue(operand.place) },
            {
              name: "projection",
              value: proofCheckAuthorityArrayValue(
                operand.projection.map(proofCheckTermProjectionAuthorityValue),
              ),
            },
          ],
        },
      };
    case "value":
      return {
        kind: "union",
        variant: "value",
        value: proofCheckValueBinderAuthorityValue(operand.value),
      };
    case "layoutTerm":
      return {
        kind: "union",
        variant: "layoutTerm",
        value: proofMirLayoutTermReferenceAuthorityValue(operand.term),
      };
    case "authorityLayoutTerm":
      return {
        kind: "union",
        variant: "authorityLayoutTerm",
        value: { kind: "string", value: operand.layoutKey },
      };
    case "literal":
      return {
        kind: "union",
        variant: "literal",
        value: {
          kind: "record",
          recordKind: "literalOperand",
          fields: [
            { name: "literal", value: monoLiteralValueAuthorityValue(operand.literal) },
            {
              name: "numeric",
              value:
                operand.numeric === undefined
                  ? { kind: "absent" }
                  : proofCheckNumericDomainAuthorityValue(operand.numeric),
            },
          ],
        },
      };
    case "preState":
      return {
        kind: "union",
        variant: "preState",
        value: proofCheckOperandTermAuthorityValue(operand.operand),
      };
    case "postState":
      return {
        kind: "union",
        variant: "postState",
        value: proofCheckOperandTermAuthorityValue(operand.operand),
      };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function proofCheckPrivateStateBinderAuthorityValue(
  binder: ProofCheckPrivateStateBinder,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "privateStateBinder",
    fields: [
      { name: "place", value: proofCheckPlaceBinderAuthorityValue(binder.place) },
      {
        name: "generation",
        value:
          binder.generation === "current"
            ? { kind: "string", value: "current" }
            : { kind: "int", value: BigInt(binder.generation) },
      },
    ],
  };
}

export function proofCheckRequirementTermAuthorityValue(
  term: ProofCheckRequirementTerm,
): ProofAuthorityValue {
  switch (term.kind) {
    case "comparison":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "comparison" } },
          { name: "left", value: proofCheckOperandTermAuthorityValue(term.left) },
          { name: "operator", value: { kind: "string", value: term.operator } },
          { name: "right", value: proofCheckOperandTermAuthorityValue(term.right) },
        ],
      };
    case "predicate":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "predicate" } },
          {
            name: "predicateFunctionId",
            value: { kind: "string", value: String(term.predicateFunctionId) },
          },
          {
            name: "arguments",
            value: proofCheckAuthorityArrayValue(
              term.arguments.map(proofCheckOperandTermAuthorityValue),
            ),
          },
          {
            name: "privateState",
            value:
              term.privateState === undefined
                ? { kind: "absent" }
                : proofCheckPrivateStateBinderAuthorityValue(term.privateState),
          },
        ],
      };
    case "layoutFits":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "layoutFits" } },
          { name: "source", value: proofCheckPlaceBinderAuthorityValue(term.source) },
          { name: "end", value: proofCheckOperandTermAuthorityValue(term.end) },
        ],
      };
    case "payloadEnd":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "payloadEnd" } },
          { name: "source", value: proofCheckPlaceBinderAuthorityValue(term.source) },
          { name: "end", value: proofCheckOperandTermAuthorityValue(term.end) },
        ],
      };
    case "fieldAvailable":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "fieldAvailable" } },
          { name: "source", value: proofCheckPlaceBinderAuthorityValue(term.source) },
          { name: "fieldId", value: { kind: "string", value: String(term.fieldId) } },
        ],
      };
    case "rangeConstraint":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "rangeConstraint" } },
          { name: "left", value: proofCheckOperandTermAuthorityValue(term.left) },
          { name: "relation", value: { kind: "string", value: term.relation } },
          { name: "right", value: proofCheckOperandTermAuthorityValue(term.right) },
          { name: "width", value: layoutTypeKeyAuthorityValue(term.width) },
        ],
      };
    case "noUnsignedOverflow":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "noUnsignedOverflow" } },
          { name: "expression", value: proofCheckOperandTermAuthorityValue(term.expression) },
          { name: "width", value: layoutTypeKeyAuthorityValue(term.width) },
        ],
      };
    case "capability":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "capability" } },
          { name: "capability", value: proofCheckPlaceBinderAuthorityValue(term.capability) },
          { name: "capabilityKind", value: { kind: "string", value: String(term.capabilityKind) } },
          {
            name: "brand",
            value:
              term.brand === undefined
                ? { kind: "absent" }
                : proofCheckBrandBinderAuthorityValue(term.brand),
          },
        ],
      };
    case "packetSource":
      return {
        kind: "record",
        recordKind: "requirement",
        fields: [
          { name: "kind", value: { kind: "string", value: "packetSource" } },
          { name: "packet", value: proofCheckPlaceBinderAuthorityValue(term.packet) },
          { name: "source", value: proofCheckPlaceBinderAuthorityValue(term.source) },
        ],
      };
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function proofCheckFactTermAuthorityValue(term: ProofCheckFactTerm): ProofAuthorityValue {
  switch (term.kind) {
    case "matchRefinement":
      return {
        kind: "record",
        recordKind: "fact",
        fields: [
          { name: "kind", value: { kind: "string", value: "matchRefinement" } },
          { name: "scrutinee", value: proofCheckOperandTermAuthorityValue(term.scrutinee) },
          { name: "caseKey", value: { kind: "string", value: String(term.caseKey) } },
          { name: "polarity", value: { kind: "string", value: term.polarity } },
        ],
      };
    case "terminalCall":
      return {
        kind: "record",
        recordKind: "fact",
        fields: [
          { name: "kind", value: { kind: "string", value: "terminalCall" } },
          { name: "call", value: { kind: "int", value: BigInt(term.call) } },
          { name: "terminalKind", value: { kind: "string", value: term.terminalKind } },
        ],
      };
    default:
      return proofCheckRequirementTermAuthorityValue(term);
  }
}

function proofCheckTypeFactInvalidationAuthorityValue(
  invalidation: ProofCheckTypeFactInvalidation,
): ProofAuthorityValue {
  switch (invalidation.kind) {
    case "moveTransfers":
    case "consumeRemoves":
    case "validationSplit":
    case "attemptSplit":
      return {
        kind: "record",
        recordKind: "typeFactInvalidation",
        fields: [{ name: "kind", value: { kind: "string", value: invalidation.kind } }],
      };
    case "privateStateAdvance":
      return {
        kind: "record",
        recordKind: "typeFactInvalidation",
        fields: [
          { name: "kind", value: { kind: "string", value: invalidation.kind } },
          { name: "place", value: proofCheckPlaceBinderAuthorityValue(invalidation.place) },
        ],
      };
    case "platformEffect":
      return {
        kind: "record",
        recordKind: "typeFactInvalidation",
        fields: [
          { name: "kind", value: { kind: "string", value: invalidation.kind } },
          { name: "effectKind", value: { kind: "string", value: String(invalidation.effectKind) } },
        ],
      };
    case "runtimeEffect":
      return {
        kind: "record",
        recordKind: "typeFactInvalidation",
        fields: [
          { name: "kind", value: { kind: "string", value: invalidation.kind } },
          { name: "effectKind", value: { kind: "string", value: String(invalidation.effectKind) } },
        ],
      };
    default: {
      const unreachable: never = invalidation;
      return unreachable;
    }
  }
}

export function proofCheckContractEffectAuthorityValue(
  effect: ProofCheckContractEffect,
): ProofAuthorityValue {
  switch (effect.kind) {
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
      return {
        kind: "record",
        recordKind: "contractEffect",
        fields: [{ name: "kind", value: { kind: "string", value: effect.kind } }],
      };
    case "platformEffect":
      return {
        kind: "record",
        recordKind: "contractEffect",
        fields: [
          { name: "kind", value: { kind: "string", value: effect.kind } },
          { name: "effectKind", value: { kind: "string", value: String(effect.effectKind) } },
        ],
      };
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState":
      return {
        kind: "record",
        recordKind: "contractEffect",
        fields: [
          { name: "kind", value: { kind: "string", value: effect.kind } },
          { name: "place", value: proofCheckPlaceBinderAuthorityValue(effect.place) },
        ],
      };
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function proofCheckCallableSignatureAuthorityValue(
  signature: ProofCheckCallableSignature,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "callableSignature",
    fields: [
      { name: "hasReceiver", value: { kind: "bool", value: signature.hasReceiver } },
      { name: "parameterCount", value: { kind: "int", value: BigInt(signature.parameterCount) } },
      { name: "hasResult", value: { kind: "bool", value: signature.hasResult } },
    ],
  };
}

function proofCheckGuardedPostconditionAuthorityValue(
  guarded: ProofCheckGuardedPostcondition,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "guardedPostcondition",
    fields: [
      {
        name: "when",
        value: proofCheckAuthorityArrayValue(
          guarded.when.map(proofCheckRequirementTermAuthorityValue),
        ),
      },
      {
        name: "consequentTerms",
        value: proofCheckAuthorityArrayValue(
          guarded.consequentTerms.map(proofCheckFactTermAuthorityValue),
        ),
      },
      {
        name: "otherwisePreserves",
        value:
          guarded.otherwisePreserves === undefined
            ? { kind: "absent" }
            : proofCheckAuthorityArrayValue(
                guarded.otherwisePreserves.map(proofCheckFactTermAuthorityValue),
              ),
      },
      { name: "authorityKey", value: { kind: "string", value: guarded.authorityKey } },
    ],
  };
}

export function proofCheckPlatformContractAuthorityValue(
  contract: ProofCheckPlatformContract,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "ProofCheckPlatformContract",
    fields: [
      { name: "targetId", value: { kind: "string", value: contract.targetId } },
      { name: "primitiveId", value: { kind: "string", value: contract.primitiveId } },
      { name: "contractId", value: { kind: "string", value: contract.contractId } },
      { name: "authorityKey", value: { kind: "string", value: contract.authorityKey } },
      { name: "signature", value: proofCheckCallableSignatureAuthorityValue(contract.signature) },
      {
        name: "preconditions",
        value: proofCheckAuthorityArrayValue(
          contract.preconditions.map(proofCheckRequirementTermAuthorityValue),
        ),
      },
      {
        name: "postconditions",
        value: proofCheckAuthorityArrayValue(
          contract.postconditions.map(proofCheckFactTermAuthorityValue),
        ),
      },
      {
        name: "guardedPostconditions",
        value: proofCheckAuthorityArrayValue(
          contract.guardedPostconditions.map(proofCheckGuardedPostconditionAuthorityValue),
        ),
      },
      {
        name: "consumedCapabilities",
        value: proofCheckAuthorityArrayValue(
          contract.consumedCapabilities.map(proofCheckPlaceBinderAuthorityValue),
        ),
      },
      {
        name: "producedCapabilities",
        value: proofCheckAuthorityArrayValue(
          contract.producedCapabilities.map(proofCheckPlaceBinderAuthorityValue),
        ),
      },
      {
        name: "effects",
        value: proofCheckAuthorityArrayValue(
          contract.effects.map(proofCheckContractEffectAuthorityValue),
        ),
      },
    ],
  };
}

function proofCheckTypeFactSchemaAuthorityValue(
  schema: ProofCheckTypeFactSchema,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "typeFactSchema",
    fields: [{ name: "term", value: proofCheckFactTermAuthorityValue(schema.term) }],
  };
}

function monoCheckedTypeAuthorityValue(type: MonoCheckedType): ProofAuthorityValue {
  return { kind: "string", value: monoCheckedTypeFingerprint(type) };
}

function monoBrandAuthorityValue(
  brand: MonoInstantiatedProofId<BrandId> | undefined,
): ProofAuthorityValue {
  if (brand === undefined) {
    return { kind: "absent" };
  }
  return monoInstantiatedProofIdAuthorityValue(brand);
}

export function proofCheckTypeFactCatalogEntryAuthorityValue(
  entry: ProofCheckTypeFactCatalogEntry,
): ProofAuthorityValue {
  return {
    kind: "record",
    recordKind: "ProofCheckTypeFactCatalogEntry",
    fields: [
      { name: "concreteType", value: monoCheckedTypeAuthorityValue(entry.concreteType) },
      { name: "brand", value: monoBrandAuthorityValue(entry.brand) },
      {
        name: "capabilityKind",
        value:
          entry.capabilityKind === undefined
            ? { kind: "absent" }
            : { kind: "string", value: String(entry.capabilityKind) },
      },
      { name: "liveValueScope", value: { kind: "string", value: String(entry.liveValueScope) } },
      { name: "authorityKey", value: { kind: "string", value: entry.authorityKey } },
      {
        name: "facts",
        value: proofCheckAuthorityArrayValue(
          entry.facts.map(proofCheckTypeFactSchemaAuthorityValue),
        ),
      },
      {
        name: "invalidatedBy",
        value: proofCheckAuthorityArrayValue(
          entry.invalidatedBy.map(proofCheckTypeFactInvalidationAuthorityValue),
        ),
      },
    ],
  };
}

export function canonicalPlatformContractContentBytes(
  contract: ProofCheckPlatformContract,
): Uint8Array {
  return serializeProofAuthorityValue(proofCheckPlatformContractAuthorityValue(contract));
}

export function canonicalTypeFactCatalogEntryContentBytes(
  entry: ProofCheckTypeFactCatalogEntry,
): Uint8Array {
  return serializeProofAuthorityValue(proofCheckTypeFactCatalogEntryAuthorityValue(entry));
}
