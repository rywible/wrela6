import type { LayoutDiagnostic } from "./diagnostics";

export type LayoutOwnerKey = string & { readonly __brand: "LayoutOwnerKey" };

export function layoutOwnerKey(value: string): LayoutOwnerKey {
  return value as LayoutOwnerKey;
}

export interface LayoutBuilderDependency {
  readonly ownerKey: LayoutOwnerKey;
  readonly reason:
    | "target"
    | "type"
    | "field"
    | "enum"
    | "validatedBuffer"
    | "wire"
    | "abi"
    | "imageDevice";
}

export interface LayoutBuilderIssue {
  readonly ownerKey: LayoutOwnerKey;
  readonly dependencies: readonly LayoutBuilderDependency[];
  readonly diagnostics: readonly LayoutDiagnostic[];
}

export type LayoutBuilderResult<Value> =
  | {
      readonly kind: "ok";
      readonly ownerKey: LayoutOwnerKey;
      readonly dependencies: readonly LayoutBuilderDependency[];
      readonly value: Value;
      readonly diagnostics: readonly LayoutDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly ownerKey: LayoutOwnerKey;
      readonly dependencies: readonly LayoutBuilderDependency[];
      readonly diagnostics: readonly LayoutDiagnostic[];
    };

export interface LayoutBuilderContext {
  reportIssue(issue: LayoutBuilderIssue): void;
  reportDiagnostic(diagnostic: LayoutDiagnostic): void;
  diagnostics(): readonly LayoutDiagnostic[];
  issues(): readonly LayoutBuilderIssue[];
}

export function createLayoutBuilderContext(): LayoutBuilderContext {
  const diagnostics: LayoutDiagnostic[] = [];
  const issues: LayoutBuilderIssue[] = [];

  return {
    reportIssue(issue: LayoutBuilderIssue): void {
      issues.push(issue);
      for (const diagnostic of issue.diagnostics) {
        diagnostics.push(diagnostic);
      }
    },
    reportDiagnostic(diagnostic: LayoutDiagnostic): void {
      diagnostics.push(diagnostic);
    },
    diagnostics(): readonly LayoutDiagnostic[] {
      return diagnostics.slice();
    },
    issues(): readonly LayoutBuilderIssue[] {
      return issues.slice();
    },
  };
}
