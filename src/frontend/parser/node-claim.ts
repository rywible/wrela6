import type { SyntaxFactory } from "../syntax/syntax-factory";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { GreenToken } from "../syntax/green-token";
import type { GreenDiagnostic } from "../syntax/green-diagnostic";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParseDiagnosticCode } from "./parser-diagnostics";

export interface ParserMark {
  offset: number;
  diagnosticStartIndex: number;
}

export interface DraftParseDiagnostic {
  code: ParseDiagnosticCode;
  severity: string;
  message: string;
  absoluteStart: number;
  absoluteEnd: number;
  claimed: boolean;
}

export function nodeFromMark(params: {
  factory: SyntaxFactory;
  context: {
    draftDiagnostics(): readonly DraftParseDiagnostic[];
    offset: number;
  };
  mark: ParserMark;
  kind: SyntaxKind;
  children: GreenElement[];
}): GreenNode {
  const { context, mark, kind, children } = params;

  let firstChildLeadingWidth = 0;
  const firstChild = children[0];
  if (firstChild instanceof GreenToken) {
    firstChildLeadingWidth = firstChild.leadingTrivia.reduce(
      (sum, trivia) => sum + trivia.width,
      0,
    );
  }
  const adjustedStart = mark.offset - firstChildLeadingWidth;
  const nodeAbsoluteEnd = adjustedStart + children.reduce((sum, child) => sum + child.width, 0);
  const claimedDiagnostics: GreenDiagnostic[] = [];

  const allDrafts = context.draftDiagnostics();
  for (let index = mark.diagnosticStartIndex; index < allDrafts.length; index++) {
    const draft = allDrafts[index]!;
    if (draft.claimed) continue;
    if (draft.absoluteStart < adjustedStart || draft.absoluteEnd > nodeAbsoluteEnd) continue;
    if (draft.absoluteEnd === nodeAbsoluteEnd && draft.absoluteStart >= adjustedStart) {
      // zero-width at node end is inside the node
    }
    draft.claimed = true;
    claimedDiagnostics.push({
      code: draft.code,
      severity: draft.severity as "error" | "warning",
      message: draft.message,
      relativeStart: draft.absoluteStart - adjustedStart,
      relativeEnd: draft.absoluteEnd - adjustedStart,
    });
  }

  return new GreenNode({
    kind,
    children,
    diagnostics: claimedDiagnostics,
  });
}
