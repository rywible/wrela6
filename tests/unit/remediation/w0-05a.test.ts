import { expect, test } from "bun:test";

import { resolveSimpleNameExpression } from "../../../src/semantic/names/expression-resolver";

test("W0-05a keeps simple-name resolver exported from the stable expression resolver path", () => {
  expect(resolveSimpleNameExpression).toBeFunction();
});
