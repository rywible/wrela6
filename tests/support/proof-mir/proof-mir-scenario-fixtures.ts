import { imageDeviceLayoutFixture } from "../layout/layout-fixtures";
import { minimalClosedProgramForMonoTest } from "../mono/monomorphization-fixtures";
import {
  ordinaryIteratorProtocolProofMirBuildInputParts,
  streamForLoopProofMirBuildInputParts,
} from "./lower-harness/iterator-lowerer-integration-parts";
import {
  buildReachableFunctionsForProofMirTest,
  closedProofMirFixture,
  layoutTargetForSerialDevice,
  monoAndLayoutForTypedHirProgram,
  proofMirBuildInputForSource,
  proofMirBuildInputFromMonoLayout,
  requireLayoutFacts,
  type ProofMirBuildInput,
} from "./proof-mir-build-input";
import { expressionIdFor } from "./lower-harness/iterator-lowerer-harness-bindings";
import { platformCallProofMirFixture } from "./proof-mir-layout-fixtures";
import { monoInstanceId } from "../../../src/mono/ids";
import { monoResolvedCallTargetTableFromEntries } from "../../../src/mono/resolved-call-targets";

export function ordinaryIteratorProofMirFixture(): ProofMirBuildInput {
  const closed = closedProofMirFixture();
  const iterator = ordinaryIteratorProtocolProofMirBuildInputParts();
  const mergedFunctions = [
    ...closed.program.functions.entries(),
    ...iterator.program.functions
      .entries()
      .filter(
        (functionInstance) =>
          !closed.program.functions
            .entries()
            .some((existing) => existing.instanceId === functionInstance.instanceId),
      ),
  ];
  const mergedLayoutFunctions = [
    ...closed.layout.functions.entries(),
    ...iterator.layout.functions
      .entries()
      .filter(
        (fact) =>
          !closed.layout.functions
            .entries()
            .some((existing) => existing.functionInstanceId === fact.functionInstanceId),
      ),
  ];
  const iteratorFunctionInstanceId = monoInstanceId("fn:iterator-protocol");
  const iteratorForStatement = iterator.program.functions.get(iteratorFunctionInstanceId)?.body
    ?.statements[0];
  if (iteratorForStatement?.kind.kind !== "for") {
    throw new Error("expected iterator for statement in merged proof-mir fixture");
  }
  const nextFunctionInstanceId = monoInstanceId("fn:iterator-next");
  const iterableFunctionInstanceId = monoInstanceId("fn:packet-bytes");
  const resolvedCallTargetEntries = [
    {
      callerInstanceId: iteratorFunctionInstanceId,
      callExpressionId: expressionIdFor(iteratorFunctionInstanceId, 2),
      resolvedTarget: {
        kind: "sourceFunction" as const,
        targetFunctionInstanceId: iterableFunctionInstanceId,
      },
    },
    {
      callerInstanceId: iteratorFunctionInstanceId,
      callExpressionId: expressionIdFor(iteratorFunctionInstanceId, 100),
      resolvedTarget: {
        kind: "sourceFunction" as const,
        targetFunctionInstanceId: nextFunctionInstanceId,
      },
    },
  ];
  const externalRoots = [
    ...closed.program.externalRoots,
    ...iterator.program.externalRoots.filter(
      (root) =>
        !closed.program.externalRoots.some(
          (existing) => existing.functionInstanceId === root.functionInstanceId,
        ),
    ),
  ];
  return {
    program: {
      ...closed.program,
      functions: {
        entries: () => mergedFunctions,
        get: (instanceId) =>
          mergedFunctions.find((functionInstance) => functionInstance.instanceId === instanceId),
      },
      externalRoots,
      reachableFunctions: buildReachableFunctionsForProofMirTest({
        externalRoots,
        functions: mergedFunctions,
        resolvedCallTargetEntries,
        seedReachableFunctions: closed.program.reachableFunctions.entries(),
      }),
      proofMetadata: {
        ...closed.program.proofMetadata,
        obligations: iterator.program.proofMetadata.obligations,
        callSiteRequirements: iterator.program.proofMetadata.callSiteRequirements,
      },
      resolvedCallTargets: monoResolvedCallTargetTableFromEntries(resolvedCallTargetEntries),
    },
    layout: {
      ...closed.layout,
      functions: {
        ...closed.layout.functions,
        entries: () => mergedLayoutFunctions,
        get: (key) => mergedLayoutFunctions.find((fact) => fact.functionInstanceId === key),
        has: (key) => mergedLayoutFunctions.some((fact) => fact.functionInstanceId === key),
      },
    },
    target: closed.target,
  };
}

export function streamForLoopProofMirFixture(): ProofMirBuildInput {
  const closed = closedProofMirFixture();
  const stream = streamForLoopProofMirBuildInputParts();
  const mergedFunctions = [
    ...closed.program.functions.entries(),
    ...stream.program.functions
      .entries()
      .filter(
        (functionInstance) =>
          !closed.program.functions
            .entries()
            .some((existing) => existing.instanceId === functionInstance.instanceId),
      ),
  ];
  const mergedLayoutFunctions = [
    ...closed.layout.functions.entries(),
    ...stream.layout.functions
      .entries()
      .filter(
        (fact) =>
          !closed.layout.functions
            .entries()
            .some((existing) => existing.functionInstanceId === fact.functionInstanceId),
      ),
  ];
  const externalRoots = [
    ...closed.program.externalRoots,
    ...stream.program.externalRoots.filter(
      (root) =>
        !closed.program.externalRoots.some(
          (existing) => existing.functionInstanceId === root.functionInstanceId,
        ),
    ),
  ];
  return {
    program: {
      ...closed.program,
      functions: {
        entries: () => mergedFunctions,
        get: (instanceId) =>
          mergedFunctions.find((functionInstance) => functionInstance.instanceId === instanceId),
      },
      externalRoots,
      reachableFunctions: buildReachableFunctionsForProofMirTest({
        externalRoots,
        functions: mergedFunctions,
        seedReachableFunctions: closed.program.reachableFunctions.entries(),
      }),
      proofMetadata: stream.program.proofMetadata,
    },
    layout: {
      ...closed.layout,
      functions: {
        ...closed.layout.functions,
        entries: () => mergedLayoutFunctions,
        get: (key) => mergedLayoutFunctions.find((fact) => fact.functionInstanceId === key),
        has: (key) => mergedLayoutFunctions.some((fact) => fact.functionInstanceId === key),
      },
    },
    target: closed.target,
  };
}

export function proofMirImageDeviceBuildInput(): ProofMirBuildInput {
  const layoutTarget = layoutTargetForSerialDevice();
  const imageDevice = imageDeviceLayoutFixture({ target: layoutTarget });
  const layout = requireLayoutFacts({
    program: imageDevice.program,
    target: layoutTarget,
  });
  return proofMirBuildInputFromMonoLayout({
    program: imageDevice.program,
    layout,
    layoutTarget,
  });
}

export function proofMirPlatformPrimitiveBuildInput(): ProofMirBuildInput {
  return platformCallProofMirFixture();
}

export function proofMirClosedProgramFromMonoFixture(): ProofMirBuildInput {
  const monoLayout = monoAndLayoutForTypedHirProgram(minimalClosedProgramForMonoTest());
  return proofMirBuildInputFromMonoLayout({
    program: monoLayout.program,
    layout: monoLayout.layout,
    layoutTarget: monoLayout.layoutTarget,
  });
}

function whileLoopMutationProofMirSource(): string {
  return [
    "uefi image Boot:",
    "    fn main(i: u8) -> Never:",
    "        while true:",
    "            i = 1",
    "            break",
    "        return",
  ].join("\n");
}

function branchAndLoopProofMirSource(): string {
  return [
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        if true:",
    "            return",
    "        loop:",
    "            return",
    "        return",
  ].join("\n");
}

function nestedBranchProofMirSource(): string {
  return [
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        if true:",
    "            return",
    "        else:",
    "            return",
    "        return",
  ].join("\n");
}

function matchProofMirSource(): string {
  return [
    "enum Kind:",
    "    ping",
    "    pong",
    "uefi image Boot:",
    "    fn main(kind: Kind) -> Never:",
    "        match kind:",
    "            case Kind.ping:",
    "                return",
    "            case Kind.pong:",
    "                return",
    "        return",
  ].join("\n");
}

function loopReturnProofMirSource(): string {
  return [
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        loop:",
    "            return",
    "        return",
  ].join("\n");
}

function ifReturnProofMirSource(): string {
  return [
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        if true:",
    "            return",
    "        return",
  ].join("\n");
}

export function whileLoopMutationProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(whileLoopMutationProofMirSource());
}

export function branchAndLoopProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(branchAndLoopProofMirSource());
}

export function nestedBranchProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(nestedBranchProofMirSource());
}

export function matchProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(matchProofMirSource());
}

export function loopReturnProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(loopReturnProofMirSource());
}

export function ifReturnProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(ifReturnProofMirSource());
}

export function explicitOrdinaryReturnProofMirFixture(): ProofMirBuildInput {
  return closedProofMirFixture();
}
