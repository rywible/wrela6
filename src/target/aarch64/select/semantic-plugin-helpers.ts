import type {
  AArch64SemanticPluginFactInput,
  AArch64SemanticPluginOperationInput,
} from "./semantic-superselector";

export function factsForFamily(
  operation: AArch64SemanticPluginOperationInput,
  extensionKey: string,
): readonly AArch64SemanticPluginFactInput[] {
  return Object.freeze(
    operation.facts
      .filter((fact) => fact.extensionKey === extensionKey)
      .sort((left, right) => left.factId - right.factId),
  );
}

export function factIdsForFamily(
  operation: AArch64SemanticPluginOperationInput,
  extensionKey: string,
): readonly number[] {
  return factsForFamily(operation, extensionKey).map((fact) => fact.factId);
}

export function semanticOperationFactsForFamily(
  operation: AArch64SemanticPluginOperationInput,
  family: string,
): readonly AArch64SemanticPluginFactInput[] {
  return factsForFamily(operation, "semantic-operation").filter(
    (fact) => fact.payload.family === family,
  );
}

export function profileHasAll(
  operation: AArch64SemanticPluginOperationInput,
  requiredFeatures: readonly string[],
): boolean {
  return requiredFeatures.every(
    (feature) => feature === "BASE_A64" || operation.profileFeatures.includes(feature),
  );
}

export function securityFactsWithConstantTime(
  operation: AArch64SemanticPluginOperationInput,
): readonly AArch64SemanticPluginFactInput[] {
  return factsForFamily(operation, "security").filter((fact) => {
    const labels = Array.isArray(fact.payload.labels) ? fact.payload.labels : [];
    return fact.payload.constantTime === true || labels.includes("constantTimeRequired");
  });
}

export function uniqueFactIds(
  ...groups: readonly (readonly AArch64SemanticPluginFactInput[] | readonly number[])[]
): readonly number[] {
  const ids = groups.flatMap((group) =>
    group.map((entry) => (typeof entry === "number" ? entry : entry.factId)),
  );
  return Object.freeze([...new Set(ids)].sort((left, right) => left - right));
}
