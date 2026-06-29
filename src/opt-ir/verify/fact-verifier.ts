import type { OptIrDiagnostic, OptIrDiagnosticCode } from "../diagnostics";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey } from "../diagnostics";
import type { OptIrPreservedFact, OptIrFactScope } from "../facts/fact-preservation";
import { optIrFactSubjectKey, type OptIrFactSubject } from "../facts/subject-remapping";
import type { OptIrFactId } from "../ids";

export interface VerifyPreservedOptIrFactsInput {
  readonly facts: readonly OptIrPreservedFact[];
  readonly liveSubjects: ReadonlySet<string>;
  readonly liveScopes: ReadonlySet<string>;
  readonly liveFacts: ReadonlySet<OptIrFactId>;
}

export function verifyPreservedOptIrFacts(
  input: VerifyPreservedOptIrFactsInput,
): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];

  for (const fact of input.facts) {
    const subjectKey = optIrFactSubjectKey(fact.subject);
    if (!input.liveSubjects.has(subjectKey)) {
      diagnostics.push(
        diagnostic({
          fact,
          rootCauseKey: subjectKey,
          stableDetail: `fact-subject-stale:${fact.factId}:${subjectKey}`,
          messageTemplate: "Preserved fact subject is not live after rewrite.",
        }),
      );
    }

    const scopeKey = optIrFactScopeKey(fact.scope);
    if (!input.liveScopes.has(scopeKey)) {
      diagnostics.push(
        diagnostic({
          fact,
          rootCauseKey: scopeKey,
          stableDetail: `fact-scope-stale:${fact.factId}:${scopeKey}`,
          messageTemplate: "Preserved fact scope is not valid after rewrite.",
        }),
      );
    }

    for (const dependency of fact.dependencies) {
      if (!isLiveFactDependency(input, dependency)) {
        const dependencyKey = optIrFactSubjectKey(dependency);
        diagnostics.push(
          diagnostic({
            fact,
            rootCauseKey: dependencyKey,
            stableDetail: `fact-dependency-stale:${fact.factId}:${dependencyKey}`,
            messageTemplate: "Preserved fact dependency is not live after rewrite.",
          }),
        );
      }
    }

    if (fact.origin === undefined) {
      diagnostics.push(
        diagnostic({
          fact,
          rootCauseKey: "origin",
          stableDetail: `fact-origin-missing:${fact.factId}`,
          messageTemplate: "Preserved fact must retain origin metadata.",
        }),
      );
    }
  }

  return diagnostics;
}

export function optIrFactScopeKey(scope: OptIrFactScope): string {
  switch (scope.kind) {
    case "function":
      return `function:${scope.functionId}`;
    case "path":
      return `path:${scope.certificateId}`;
  }
}

function isLiveFactDependency(
  input: VerifyPreservedOptIrFactsInput,
  dependency: OptIrFactSubject,
): boolean {
  if (dependency.kind === "fact") {
    return input.liveFacts.has(dependency.factId);
  }
  return input.liveSubjects.has(optIrFactSubjectKey(dependency));
}

function diagnostic(input: {
  readonly fact: OptIrPreservedFact;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly messageTemplate: string;
}): OptIrDiagnostic {
  const ownerKey = `fact:${input.fact.factId}`;
  const code = optIrDiagnosticCode("OPT_IR_FACT_PRESERVATION_INVALID");
  return {
    severity: "error",
    code,
    messageTemplate: input.messageTemplate,
    arguments: {},
    ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code: code as OptIrDiagnosticCode,
      ownerKey,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}
