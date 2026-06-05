import type { GreenDiagnostic } from "./green-diagnostic";
import { SyntaxKind } from "./syntax-kind";
import { isNodeSyntaxKind } from "./syntax-kind-map";

export interface GreenElement {
  readonly kind: SyntaxKind;
  readonly width: number;
  reconstruct(): string;
}

export class GreenNode implements GreenElement {
  readonly kind: SyntaxKind;
  readonly width: number;
  readonly children: readonly GreenElement[];
  readonly diagnostics: readonly GreenDiagnostic[];

  constructor(init: {
    kind: SyntaxKind;
    children: GreenElement[];
    diagnostics?: GreenDiagnostic[];
  }) {
    if (!isNodeSyntaxKind(init.kind)) {
      throw new Error(`Expected a node SyntaxKind but got ${SyntaxKind[init.kind]}`);
    }

    let totalWidth = 0;
    for (const child of init.children) {
      totalWidth += child.width;
    }
    this.width = totalWidth;

    this.children = [...init.children];

    const inputDiagnostics = init.diagnostics ?? [];
    for (const inputDiagnostic of inputDiagnostics) {
      if (inputDiagnostic.relativeStart < 0) {
        throw new Error("Diagnostic relativeStart cannot be negative");
      }
      if (inputDiagnostic.relativeEnd < inputDiagnostic.relativeStart) {
        throw new Error("Diagnostic relativeEnd cannot be before relativeStart");
      }
    }
    this.diagnostics = [...inputDiagnostics];

    this.kind = init.kind;
    Object.freeze(this);
  }

  reconstruct(): string {
    return this.children.map((child) => child.reconstruct()).join("");
  }
}
