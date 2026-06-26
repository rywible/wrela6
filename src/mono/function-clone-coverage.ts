import { HIR_EXPRESSION_KINDS, HIR_STATEMENT_KINDS } from "../hir/hir";
export const MONO_STATEMENT_CLONE_COVERAGE: Readonly<
  Record<(typeof HIR_STATEMENT_KINDS)[number], true>
> = Object.freeze({
  block: true,
  let: true,
  assignment: true,
  if: true,
  while: true,
  loop: true,
  for: true,
  match: true,
  validationMatch: true,
  take: true,
  return: true,
  yield: true,
  break: true,
  continue: true,
  expression: true,
  error: true,
});

export const MONO_EXPRESSION_CLONE_COVERAGE: Readonly<
  Record<(typeof HIR_EXPRESSION_KINDS)[number], true>
> = Object.freeze({
  literal: true,
  name: true,
  member: true,
  object: true,
  call: true,
  attempt: true,
  validationCreation: true,
  unary: true,
  binary: true,
  comparison: true,
  error: true,
});
