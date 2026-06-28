export type {
  ProofCheckClosedFixtureOptions,
  ProofCheckInvalidFixtureCase,
  ProofCheckValidFixtureCase,
} from "./fixtures/fixture-types";

export { withEmbeddedRuntimeCatalogFingerprint } from "./fixtures/mir-mutations";

export {
  checkProofAndResourcesForClosedFixture,
  checkProofAndResourcesForTest,
  proofCheckClosedFixture,
  withProofCheckAuthoritiesForTest,
} from "./fixtures/closed-fixture";
