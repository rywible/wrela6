import type { ProofCheckDiagnostic } from "../diagnostics";
import type { BrandId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { ProofMirLayoutTermId, ProofMirPlaceId, ProofMirValueId } from "../../proof-mir/ids";
import type { ProofMirLayoutTermReference } from "../../proof-mir/model/layout-bindings";
import {
  normalizeProofCheckTerm,
  type NormalizedProofCheckTerm,
  type ProofCheckBrandBinder,
  type ProofCheckFactTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckPrivateStateBinder,
  type ProofCheckRequirementTerm,
  type ProofCheckTermPosition,
  type ProofCheckValueBinder,
} from "./fact-language";

export interface ProofCheckBinderSubstitution {
  readonly receiver?: ProofMirPlaceId;
  readonly parameters?: ReadonlyMap<number, ProofMirPlaceId>;
  readonly arguments?: ReadonlyMap<number, ProofMirPlaceId>;
  readonly result?: ProofMirPlaceId;
  readonly subject?: ProofMirPlaceId;
  readonly proofMirPlaces?: ReadonlyMap<ProofMirPlaceId, ProofMirPlaceId>;
  readonly proofMirValues?: ReadonlyMap<ProofMirValueId, ProofMirValueId>;
  readonly syntheticPlaces?: ReadonlyMap<string, ProofMirPlaceId>;
  readonly syntheticValues?: ReadonlyMap<string, ProofMirValueId>;
  readonly sourceBrands?: ReadonlyMap<string, MonoInstantiatedProofId<BrandId>>;
  readonly layoutTerms?: ReadonlyMap<ProofMirLayoutTermId, ProofMirLayoutTermReference>;
  readonly authorityLayoutTerms?: ReadonlyMap<string, ProofMirLayoutTermReference>;
}

export function substituteProofCheckPlaceBinder(
  binder: ProofCheckPlaceBinder,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckPlaceBinder {
  switch (binder.kind) {
    case "receiver":
      return substitution.receiver === undefined
        ? binder
        : { kind: "proofMirPlace", placeId: substitution.receiver };
    case "parameter": {
      const resolved = substitution.parameters?.get(binder.index);
      return resolved === undefined ? binder : { kind: "proofMirPlace", placeId: resolved };
    }
    case "argument": {
      const resolved = substitution.arguments?.get(binder.index);
      return resolved === undefined ? binder : { kind: "proofMirPlace", placeId: resolved };
    }
    case "result":
      return substitution.result === undefined
        ? binder
        : { kind: "proofMirPlace", placeId: substitution.result };
    case "subject":
      return substitution.subject === undefined
        ? binder
        : { kind: "proofMirPlace", placeId: substitution.subject };
    case "proofMirPlace": {
      const resolved = substitution.proofMirPlaces?.get(binder.placeId);
      return resolved === undefined ? binder : { kind: "proofMirPlace", placeId: resolved };
    }
    case "synthetic": {
      const resolved = substitution.syntheticPlaces?.get(String(binder.id));
      return resolved === undefined ? binder : { kind: "proofMirPlace", placeId: resolved };
    }
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

export function substituteProofCheckValueBinder(
  binder: ProofCheckValueBinder,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckValueBinder {
  switch (binder.kind) {
    case "proofMirValue": {
      const resolved = substitution.proofMirValues?.get(binder.valueId);
      return resolved === undefined ? binder : { kind: "proofMirValue", valueId: resolved };
    }
    case "resultValue":
      return binder;
    case "synthetic": {
      const resolved = substitution.syntheticValues?.get(String(binder.id));
      return resolved === undefined ? binder : { kind: "proofMirValue", valueId: resolved };
    }
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

export function substituteProofCheckBrandBinder(
  binder: ProofCheckBrandBinder,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckBrandBinder {
  switch (binder.kind) {
    case "proofBrand":
    case "subjectBrand":
      return binder;
    case "sourceBrand": {
      const substitutedPlace = substituteProofCheckPlaceBinder(binder.place, substitution);
      const sourceBrandKey = sourceBrandSubstitutionKey(substitutedPlace);
      const resolvedBrand = substitution.sourceBrands?.get(sourceBrandKey);
      return resolvedBrand === undefined
        ? { kind: "sourceBrand", place: substitutedPlace }
        : { kind: "proofBrand", brandId: resolvedBrand };
    }
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function sourceBrandSubstitutionKey(place: ProofCheckPlaceBinder): string {
  switch (place.kind) {
    case "proofMirPlace":
      return `proofMirPlace:${place.placeId}`;
    case "receiver":
      return "receiver";
    case "parameter":
      return `parameter:${place.index}`;
    case "argument":
      return `argument:${place.index}`;
    case "result":
      return "result";
    case "subject":
      return "subject";
    case "synthetic":
      return String(place.id);
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

function substituteProofCheckPrivateStateBinder(
  binder: ProofCheckPrivateStateBinder,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckPrivateStateBinder {
  return {
    place: substituteProofCheckPlaceBinder(binder.place, substitution),
    generation: binder.generation,
  };
}

export function substituteProofCheckOperand(
  operand: ProofCheckOperandTerm,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckOperandTerm {
  switch (operand.kind) {
    case "place":
      return {
        kind: "place",
        place: substituteProofCheckPlaceBinder(operand.place, substitution),
        projection: operand.projection,
      };
    case "value":
      return {
        kind: "value",
        value: substituteProofCheckValueBinder(operand.value, substitution),
      };
    case "layoutTerm": {
      const resolved = substitution.layoutTerms?.get(operand.term.termId);
      return {
        kind: "layoutTerm",
        term: resolved ?? operand.term,
      };
    }
    case "authorityLayoutTerm": {
      const resolved = substitution.authorityLayoutTerms?.get(operand.layoutKey);
      if (resolved === undefined) {
        return operand;
      }
      return {
        kind: "layoutTerm",
        term: resolved,
      };
    }
    case "literal":
      return operand;
    case "preState":
      return {
        kind: "preState",
        operand: substituteProofCheckOperand(operand.operand, substitution),
      };
    case "postState":
      return {
        kind: "postState",
        operand: substituteProofCheckOperand(operand.operand, substitution),
      };
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

export function substituteProofCheckRequirementTerm(
  term: ProofCheckRequirementTerm,
  substitution: ProofCheckBinderSubstitution,
): ProofCheckRequirementTerm {
  switch (term.kind) {
    case "comparison":
      return {
        kind: "comparison",
        left: substituteProofCheckOperand(term.left, substitution),
        operator: term.operator,
        right: substituteProofCheckOperand(term.right, substitution),
      };
    case "predicate":
      return {
        kind: "predicate",
        predicateFunctionId: term.predicateFunctionId,
        arguments: term.arguments.map((argument) =>
          substituteProofCheckOperand(argument, substitution),
        ),
        ...(term.privateState === undefined
          ? {}
          : {
              privateState: substituteProofCheckPrivateStateBinder(term.privateState, substitution),
            }),
      };
    case "layoutFits":
      return {
        kind: "layoutFits",
        source: substituteProofCheckPlaceBinder(term.source, substitution),
        end: substituteProofCheckOperand(term.end, substitution),
      };
    case "payloadEnd":
      return {
        kind: "payloadEnd",
        source: substituteProofCheckPlaceBinder(term.source, substitution),
        end: substituteProofCheckOperand(term.end, substitution),
      };
    case "fieldAvailable":
      return {
        kind: "fieldAvailable",
        source: substituteProofCheckPlaceBinder(term.source, substitution),
        fieldId: term.fieldId,
      };
    case "rangeConstraint":
      return {
        kind: "rangeConstraint",
        left: substituteProofCheckOperand(term.left, substitution),
        relation: term.relation,
        right: substituteProofCheckOperand(term.right, substitution),
        width: term.width,
      };
    case "noUnsignedOverflow":
      return {
        kind: "noUnsignedOverflow",
        expression: substituteProofCheckOperand(term.expression, substitution),
        width: term.width,
      };
    case "capability":
      return {
        kind: "capability",
        capability: substituteProofCheckPlaceBinder(term.capability, substitution),
        capabilityKind: term.capabilityKind,
        ...(term.brand === undefined
          ? {}
          : { brand: substituteProofCheckBrandBinder(term.brand, substitution) }),
      };
    case "packetSource":
      return {
        kind: "packetSource",
        packet: substituteProofCheckPlaceBinder(term.packet, substitution),
        source: substituteProofCheckPlaceBinder(term.source, substitution),
      };
    default: {
      const unreachable: never = term;
      return unreachable;
    }
  }
}

export function substituteProofCheckTerm<FactTerm extends ProofCheckFactTerm>(
  term: FactTerm,
  substitution: ProofCheckBinderSubstitution,
  position: ProofCheckTermPosition = "activeFact",
): NormalizedProofCheckTerm<FactTerm> {
  switch (term.kind) {
    case "matchRefinement":
      return normalizeProofCheckTerm(
        {
          kind: "matchRefinement",
          scrutinee: substituteProofCheckOperand(term.scrutinee, substitution),
          caseKey: term.caseKey,
          polarity: term.polarity,
        },
        position,
      ) as NormalizedProofCheckTerm<FactTerm>;
    case "terminalCall":
      return normalizeProofCheckTerm(term, position) as NormalizedProofCheckTerm<FactTerm>;
    default:
      return normalizeProofCheckTerm(
        substituteProofCheckRequirementTerm(term, substitution),
        position,
      ) as NormalizedProofCheckTerm<FactTerm>;
  }
}

export interface ProofCheckActiveFactScope {
  readonly termKey: string;
  readonly privateGenerationKey: string;
  readonly packetSourceKey: string;
  readonly numericDomainKey: string;
}

export interface ProofCheckActiveFactRecord {
  readonly factKey: string;
  readonly normalized: NormalizedProofCheckTerm;
  readonly scope: ProofCheckActiveFactScope;
  readonly authorityKey?: string;
}

export interface ProofCheckFactEnvironment {
  readonly facts: ReadonlyMap<string, ProofCheckActiveFactRecord>;
  readonly byScopeKey: ReadonlyMap<string, readonly ProofCheckActiveFactRecord[]>;
  readonly contradictory: boolean;
  readonly diagnostics: readonly ProofCheckDiagnostic[];
}

export function proofCheckActiveFactScopeKey(scope: ProofCheckActiveFactScope): string {
  return [
    scope.termKey,
    scope.privateGenerationKey,
    scope.packetSourceKey,
    scope.numericDomainKey,
  ].join("|");
}

export function proofCheckBinderSubstitutionForTest(input: {
  readonly receiver?: ProofMirPlaceId;
  readonly parameters?: Readonly<Record<number, ProofMirPlaceId>>;
  readonly arguments?: Readonly<Record<number, ProofMirPlaceId>>;
  readonly result?: ProofMirPlaceId;
  readonly subject?: ProofMirPlaceId;
  readonly proofMirPlaces?: Readonly<Record<number, ProofMirPlaceId>>;
  readonly proofMirValues?: Readonly<Record<number, ProofMirValueId>>;
  readonly syntheticPlaces?: Readonly<Record<string, ProofMirPlaceId>>;
  readonly syntheticValues?: Readonly<Record<string, ProofMirValueId>>;
  readonly sourceBrands?: Readonly<Record<string, MonoInstantiatedProofId<BrandId>>>;
  readonly layoutTerms?: Readonly<Record<number, ProofMirLayoutTermReference>>;
  readonly authorityLayoutTerms?: Readonly<Record<string, ProofMirLayoutTermReference>>;
}): ProofCheckBinderSubstitution {
  return {
    ...(input.receiver === undefined ? {} : { receiver: input.receiver }),
    ...(input.parameters === undefined
      ? {}
      : {
          parameters: new Map(
            Object.entries(input.parameters).map(([index, placeId]) => [Number(index), placeId]),
          ),
        }),
    ...(input.arguments === undefined
      ? {}
      : {
          arguments: new Map(
            Object.entries(input.arguments).map(([index, placeId]) => [Number(index), placeId]),
          ),
        }),
    ...(input.result === undefined ? {} : { result: input.result }),
    ...(input.subject === undefined ? {} : { subject: input.subject }),
    ...(input.proofMirPlaces === undefined
      ? {}
      : {
          proofMirPlaces: new Map(
            Object.entries(input.proofMirPlaces).map(([placeId, resolved]) => [
              Number(placeId) as ProofMirPlaceId,
              resolved,
            ]),
          ),
        }),
    ...(input.proofMirValues === undefined
      ? {}
      : {
          proofMirValues: new Map(
            Object.entries(input.proofMirValues).map(([valueId, resolved]) => [
              Number(valueId) as ProofMirValueId,
              resolved,
            ]),
          ),
        }),
    ...(input.syntheticPlaces === undefined
      ? {}
      : { syntheticPlaces: new Map(Object.entries(input.syntheticPlaces)) }),
    ...(input.syntheticValues === undefined
      ? {}
      : { syntheticValues: new Map(Object.entries(input.syntheticValues)) }),
    ...(input.sourceBrands === undefined
      ? {}
      : { sourceBrands: new Map(Object.entries(input.sourceBrands)) }),
    ...(input.layoutTerms === undefined
      ? {}
      : {
          layoutTerms: new Map(
            Object.entries(input.layoutTerms).map(([termId, term]) => [
              Number(termId) as ProofMirLayoutTermId,
              term,
            ]),
          ),
        }),
    ...(input.authorityLayoutTerms === undefined
      ? {}
      : { authorityLayoutTerms: new Map(Object.entries(input.authorityLayoutTerms)) }),
  };
}
