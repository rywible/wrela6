export const importParsingPolicyFixture = String.raw`
export {
  lowerProofMirFunction,
} from /* split re-export */ "../proof-mir/lower/function-lowerer";

import type {
  ParseResult,
} from /* split type import */ "../parser/module-parser";

import /* split side-effect import */ "node:fs";
`;
