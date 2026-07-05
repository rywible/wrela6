import { expect, test } from "bun:test";
import { lowerTypedHir } from "../../../src/hir";
import type {
  HirAttempt,
  HirEnsureCandidate,
  HirForIteration,
  HirPlatformContractEdge,
  HirPrivateStateTransition,
  HirResourcePlace,
  HirTakeKind,
  HirTerminalCall,
  HirValidatedBuffer,
} from "../../../src/hir";

type PublicHirModelSmoke = {
  readonly attempt?: HirAttempt;
  readonly ensureCandidate?: HirEnsureCandidate;
  readonly iteration?: HirForIteration;
  readonly platformContractEdge?: HirPlatformContractEdge;
  readonly privateStateTransition?: HirPrivateStateTransition;
  readonly resourcePlace?: HirResourcePlace;
  readonly takeKind?: HirTakeKind;
  readonly terminalCall?: HirTerminalCall;
  readonly validatedBuffer?: HirValidatedBuffer;
};

const acceptPublicHirModel = (model: PublicHirModelSmoke): PublicHirModelSmoke => model;

test("typed HIR public API is exported", () => {
  expect(typeof lowerTypedHir).toBe("function");
  expect(acceptPublicHirModel({})).toEqual({});
});
