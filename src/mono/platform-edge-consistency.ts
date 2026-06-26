import type { HirPlatformContractEdge } from "../hir/hir";
import type { CertifiedPlatformBinding } from "../semantic/surface/checked-program";
import type {
  CheckedPlatformEnsuredFact,
  CheckedPlatformEnsuredFactSurface,
  CheckedPlatformFactArgument,
} from "../semantic/surface/proof-contracts";
import { compareCodeUnitStrings } from "./deterministic-sort";

export function platformEdgeBindingMismatch(input: {
  readonly edge: HirPlatformContractEdge;
  readonly binding: CertifiedPlatformBinding;
}): string | undefined {
  if (input.edge.sourceFunctionId !== input.binding.functionId) {
    return `function:${String(input.edge.sourceFunctionId)}!=${String(input.binding.functionId)}`;
  }
  if (input.edge.primitiveId !== input.binding.primitiveId) {
    return `primitive:${String(input.edge.primitiveId)}!=${String(input.binding.primitiveId)}`;
  }
  if (input.edge.contractId !== input.binding.contractId) {
    return `contract:${String(input.edge.contractId)}!=${String(input.binding.contractId)}`;
  }
  if (input.edge.targetId !== input.binding.targetId) {
    return `target:${String(input.edge.targetId)}!=${String(input.binding.targetId)}`;
  }
  return undefined;
}

export function platformEnsuredFactMismatch(input: {
  readonly edge: HirPlatformContractEdge;
  readonly binding: CertifiedPlatformBinding;
}): string | undefined {
  for (const fact of input.edge.ensuredFacts) {
    const surfaceMismatch = platformEnsuredFactSurfaceMismatch({
      surface: fact,
      edge: input.edge,
    });
    if (surfaceMismatch !== undefined) {
      return `surface:${fact.fingerprint}:${surfaceMismatch}`;
    }
  }

  const edgeFacts = input.edge.ensuredFacts.map(surfaceFactKey).sort(compareCodeUnitStrings);
  const bindingFacts = (input.binding.ensuredFacts ?? [])
    .map((fact) => certifiedFactKey(fact))
    .sort(compareCodeUnitStrings);
  if (edgeFacts.length !== bindingFacts.length) {
    return `count:${edgeFacts.length}!=${bindingFacts.length}`;
  }
  for (let index = 0; index < edgeFacts.length; index += 1) {
    if (edgeFacts[index] !== bindingFacts[index]) {
      return `fact:${edgeFacts[index] ?? "missing"}!=${bindingFacts[index] ?? "missing"}`;
    }
  }
  return undefined;
}

function platformEnsuredFactSurfaceMismatch(input: {
  readonly surface: CheckedPlatformEnsuredFactSurface;
  readonly edge: HirPlatformContractEdge;
}): string | undefined {
  if (input.surface.sourceFunctionId !== input.edge.sourceFunctionId) {
    return `function:${String(input.surface.sourceFunctionId)}!=${String(
      input.edge.sourceFunctionId,
    )}`;
  }
  if (input.surface.primitiveId !== input.edge.primitiveId) {
    return `primitive:${String(input.surface.primitiveId)}!=${String(input.edge.primitiveId)}`;
  }
  if (input.surface.contractId !== input.edge.contractId) {
    return `contract:${String(input.surface.contractId)}!=${String(input.edge.contractId)}`;
  }
  if (input.surface.targetId !== input.edge.targetId) {
    return `target:${String(input.surface.targetId)}!=${String(input.edge.targetId)}`;
  }
  return undefined;
}

function surfaceFactKey(fact: CheckedPlatformEnsuredFactSurface): string {
  return certifiedFactKey({ fingerprint: fact.fingerprint, fact: fact.fact });
}

function certifiedFactKey(input: {
  readonly fingerprint: string;
  readonly fact: CheckedPlatformEnsuredFact;
}): string {
  return `${input.fingerprint}:${platformEnsuredFactKey(input.fact)}`;
}

function platformEnsuredFactKey(fact: CheckedPlatformEnsuredFact): string {
  const argumentsKey = fact.argumentBindings.map(platformFactArgumentKey).join(",");
  if (fact.kind === "predicate") {
    return `predicate:${String(fact.predicateFunctionId)}:${argumentsKey}`;
  }
  return `state:${fact.stateKind}:${argumentsKey}`;
}

function platformFactArgumentKey(argument: CheckedPlatformFactArgument): string {
  return [
    argument.kind,
    argument.parameterId !== undefined ? String(argument.parameterId) : "",
    argument.placeKey ?? "",
    argument.expressionText ?? "",
  ].join(":");
}
