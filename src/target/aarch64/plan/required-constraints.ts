import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import { aarch64Diagnostic } from "../machine-ir/diagnostics";
import type { AArch64PreservedFactSet } from "../machine-ir/fact-set";
import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import type { AArch64PlanningTargetSurface } from "../target-surface/target-surface";

export type AArch64DependencyEdgeKind =
  | "register"
  | "memory"
  | "resource"
  | "call"
  | "barrier"
  | "mayTrap"
  | "errata"
  | "security"
  | "control";

export interface AArch64DependencyEdge {
  readonly fromInstruction: number;
  readonly toInstruction: number;
  readonly kind: AArch64DependencyEdgeKind;
  readonly resource?: string;
  readonly requiredBy: readonly string[];
}

export interface AArch64RequiredConstraintSet {
  readonly edges: readonly AArch64DependencyEdge[];
}

export interface AArch64RequiredConstraintProvider {
  readonly providerKey: string;
  readonly requiredEdgesFor: (input: {
    readonly machineFunction: AArch64MachineFunction;
    readonly preservedFacts?: AArch64PreservedFactSet;
    readonly targetPlanning?: AArch64PlanningTargetSurface;
  }) => readonly AArch64DependencyEdge[];
}

export function aarch64RequiredConstraintSet(
  edges: readonly AArch64DependencyEdge[],
): AArch64RequiredConstraintSet {
  return Object.freeze({ edges: Object.freeze([...edges].sort(compareDependencyEdges)) });
}

export function verifyRequiredEdgesComplete(input: {
  readonly graphEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
}):
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] } {
  const graphKeys = new Set(input.graphEdges.map(dependencyEdgeKey));
  const missing = input.requiredEdges.filter((edge) => !graphKeys.has(dependencyEdgeKey(edge)));
  if (missing.length === 0) return { kind: "ok" };
  return {
    kind: "error",
    diagnostics: missing.map((edge) =>
      aarch64Diagnostic({
        code: "AARCH64_SCHEDULER_CONSTRAINT_INVALID",
        ownerKey: `instruction:${edge.toInstruction}`,
        rootCauseKey: edge.requiredBy.join(","),
        stableDetail: `required-edge-missing:${edge.requiredBy.join("+")}:${edge.fromInstruction}:${edge.toInstruction}`,
      }),
    ),
  };
}

export function dependencyEdgeKey(edge: AArch64DependencyEdge): string {
  return `${edge.fromInstruction}->${edge.toInstruction}:${edge.kind}:${edge.resource ?? ""}:${edge.requiredBy.join(",")}`;
}

export function compareDependencyEdges(
  left: AArch64DependencyEdge,
  right: AArch64DependencyEdge,
): number {
  return dependencyEdgeKey(left).localeCompare(dependencyEdgeKey(right));
}
