import { type MonoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionInstance } from "../../../src/mono/mono-hir";
import { createDraftProofMirBuildContext } from "../../../src/proof-mir/draft/draft-builder-context";
import {
  createProofMirLoweringRegistry,
  type CreateProofMirLoweringRegistryInput,
  type ProofMirLoweringRegistry,
} from "../../../src/proof-mir/lower/lowering-context";
import {
  lowerProofMirFunction,
  type LowerProofMirFunctionResult,
  type ProofMirFunctionLowererBuildInput,
} from "../../../src/proof-mir/lower/function-lowerer";
import { proofMirDiagnostic, sortProofMirDiagnostics } from "../../../src/proof-mir/diagnostics";
import { proofMirBuildInputForSource, type ProofMirBuildInput } from "./proof-mir-fixtures";

function functionNamesFromSource(source: readonly string[]): readonly string[] {
  const names: string[] = [];
  for (const line of source) {
    const match = /^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(:]/.exec(line);
    if (match !== null) {
      names.push(match[1]!);
    }
  }
  return names;
}

function buildFunctionNameLookup(input: {
  readonly source: readonly string[];
  readonly programFunctions: readonly MonoFunctionInstance[];
}): ReadonlyMap<string, MonoInstanceId> {
  const names = functionNamesFromSource(input.source);
  const sourceBodyFunctions = input.programFunctions
    .filter((functionInstance) => functionInstance.bodyStatus === "sourceBody")
    .sort((left, right) => String(left.instanceId).localeCompare(String(right.instanceId)));
  const lookup = new Map<string, MonoInstanceId>();
  for (const [index, name] of names.entries()) {
    const functionInstance = sourceBodyFunctions[index];
    if (functionInstance !== undefined) {
      lookup.set(name, functionInstance.instanceId);
    }
  }
  return lookup;
}

export interface ProofMirFunctionLowererFixture {
  readonly buildInput: ProofMirBuildInput;
  readonly buildContext: ReturnType<typeof createDraftProofMirBuildContext>;
  readonly registry: ProofMirLoweringRegistry;
  readonly functionNames: ReadonlyMap<string, MonoInstanceId>;
}

export type ProofMirFunctionLowererFixtureInput = {
  readonly source: readonly string[];
  readonly programFunctions?: readonly MonoFunctionInstance[];
  readonly registryInput: CreateProofMirLoweringRegistryInput;
};

function toBuildInput(input: ProofMirBuildInput): ProofMirFunctionLowererBuildInput {
  return {
    program: input.program,
    layout: input.layout,
    target: input.target,
  };
}

export function proofMirFunctionLowererFixture(
  input: ProofMirFunctionLowererFixtureInput,
): ProofMirFunctionLowererFixture {
  const buildInput =
    input.programFunctions === undefined
      ? proofMirBuildInputForSource(input.source)
      : proofMirBuildInputForSource(
          input.source.length > 0
            ? input.source
            : ["uefi image Boot:", "    fn main() -> Never:", "        return"],
        );

  const buildContext = createDraftProofMirBuildContext({
    program: buildInput.program,
    layout: buildInput.layout,
    target: buildInput.target,
  });

  const programFunctions = input.programFunctions ?? buildInput.program.functions.entries();
  const registryResult = createProofMirLoweringRegistry(input.registryInput);
  if (registryResult.kind === "error") {
    throw new RangeError(
      `proofMirFunctionLowererFixture registry failed: ${registryResult.diagnostics.map((diagnostic) => diagnostic.code).join(",")}`,
    );
  }

  return {
    buildInput,
    buildContext,
    registry: registryResult.registry,
    functionNames: buildFunctionNameLookup({
      source: input.source,
      programFunctions,
    }),
  };
}

export function lowerProofMirFunctionForTest(
  fixture: ProofMirFunctionLowererFixture,
  functionKey: string | MonoInstanceId,
  options?: { readonly functionInstance?: MonoFunctionInstance },
): LowerProofMirFunctionResult {
  const functionInstance =
    options?.functionInstance ??
    (() => {
      const functionInstanceId =
        typeof functionKey === "string" ? fixture.functionNames.get(functionKey) : functionKey;
      if (functionInstanceId === undefined) {
        return undefined;
      }
      return fixture.buildInput.program.functions.get(functionInstanceId);
    })();

  if (functionInstance === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_FUNCTION_BODY",
          message:
            typeof functionKey === "string"
              ? "Proof MIR function lowerer test fixture is missing the requested function."
              : "Proof MIR function lowerer test fixture is missing mono function metadata.",
          ownerKey: "proof-mir:function-lowerer-test",
          rootCauseKey: "missing-function",
          stableDetail: String(functionKey),
          ...(typeof functionKey === "string"
            ? {}
            : { functionInstanceId: functionKey as MonoInstanceId }),
        }),
      ]),
    };
  }

  return lowerProofMirFunction({
    buildInput: toBuildInput(fixture.buildInput),
    buildContext: fixture.buildContext,
    registry: fixture.registry,
    functionInstance,
  });
}

export function proofMirFunctionLowererFixtureFromSource(
  source: readonly string[],
  registryInput: CreateProofMirLoweringRegistryInput,
): ProofMirFunctionLowererFixture {
  return proofMirFunctionLowererFixture({ source, registryInput });
}
