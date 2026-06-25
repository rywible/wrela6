import type {
  CheckedFunctionSignature,
  CheckedParameter,
} from "../semantic/surface/checked-program";
import type { CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import { moduleId } from "../semantic/ids";
import type { HirDiagnostic } from "./diagnostics";
import { hirDiagnosticCode, hirDiagnosticTieBreaker } from "./diagnostics";
import type { HirLocal, HirRequirementOwner } from "./hir";
import type { HirOriginId } from "./ids";
import { hirLocalId } from "./ids";

export interface AddSourceLocalInput {
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
  readonly introducedBy: HirLocal["introducedBy"];
}

export interface AddTemporaryInput {
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface AddLocalResult {
  readonly local: HirLocal;
  readonly diagnostics: readonly HirDiagnostic[];
}

function ownerKey(owner: HirRequirementOwner): string {
  switch (owner.kind) {
    case "function":
      return `function:${owner.functionId}`;
    case "type":
      return `type:${owner.typeId}`;
  }
}

function duplicateLocalDiagnostic(input: {
  readonly owner: HirRequirementOwner;
  readonly name: string;
  readonly sourceOrigin: HirOriginId;
}): HirDiagnostic {
  const code = hirDiagnosticCode("HIR_LOCAL_NAME_SHADOWS");
  const ownerText = ownerKey(input.owner);
  const originKey = `origin:${input.sourceOrigin}`;
  return {
    code,
    message: `Local '${input.name}' shadows an existing local.`,
    originId: input.sourceOrigin,
    order: {
      moduleId: moduleId(0),
      spanStart: 0,
      spanEnd: 0,
      ownerKey: ownerText,
      originKey,
      code,
      originId: input.sourceOrigin,
      tieBreaker: hirDiagnosticTieBreaker({
        ownerKey: ownerText,
        originKey,
        code,
        stableDetail: input.name,
      }),
    },
  };
}

export class HirLocalScope {
  private readonly records: HirLocal[] = [];
  private readonly bindingsByName = new Map<string, HirLocal>();
  private readonly explicitBindingsByOrigin = new Map<HirOriginId, HirLocal>();
  private readonly diagnosticRecords: HirDiagnostic[] = [];

  private constructor(private readonly owner: HirRequirementOwner) {}

  static empty(owner: HirRequirementOwner): HirLocalScope {
    return new HirLocalScope(owner);
  }

  static fromSignature(input: {
    readonly owner: Extract<HirRequirementOwner, { readonly kind: "function" }>;
    readonly signature: CheckedFunctionSignature;
    readonly originForParameter: (
      parameter: CheckedParameter | NonNullable<CheckedFunctionSignature["receiver"]>,
    ) => HirOriginId;
  }): HirLocalScope {
    const scope = new HirLocalScope(input.owner);
    if (input.signature.receiver !== undefined) {
      scope.addParameterLocal({
        name: "self",
        type: input.signature.receiver.type,
        resourceKind: input.signature.receiver.resourceKind,
        sourceOrigin: input.originForParameter(input.signature.receiver),
        parameterId: input.signature.receiver.parameterId,
        mode: "receiver",
        introducedBy: "receiver",
      });
    }
    for (const parameter of input.signature.parameters) {
      scope.addParameterLocal({
        name: parameter.name,
        type: parameter.type,
        resourceKind: parameter.resourceKind,
        sourceOrigin: input.originForParameter(parameter),
        parameterId: parameter.parameterId,
        mode: "parameter",
        introducedBy: "parameter",
      });
    }
    return scope;
  }

  locals(): readonly HirLocal[] {
    return [...this.records];
  }

  diagnostics(): readonly HirDiagnostic[] {
    return [...this.diagnosticRecords];
  }

  lookup(name: string): HirLocal | undefined {
    return this.bindingsByName.get(name);
  }

  lookupBinding(sourceOrigin: HirOriginId): HirLocal | undefined {
    return this.explicitBindingsByOrigin.get(sourceOrigin);
  }

  addSourceLocal(input: AddSourceLocalInput): AddLocalResult {
    if (this.bindingsByName.has(input.name)) {
      const local = this.createLocal({
        ...input,
        mode: "error",
        introducedBy: "recovery",
      });
      this.explicitBindingsByOrigin.set(input.sourceOrigin, local);
      return {
        local,
        diagnostics: [
          duplicateLocalDiagnostic({
            owner: this.owner,
            name: input.name,
            sourceOrigin: input.sourceOrigin,
          }),
        ],
      };
    }

    const local = this.createLocal({ ...input, mode: "ordinary" });
    this.bindingsByName.set(input.name, local);
    this.explicitBindingsByOrigin.set(input.sourceOrigin, local);
    return { local, diagnostics: [] };
  }

  addTemporary(input: AddTemporaryInput): AddLocalResult {
    const local = this.createLocal({
      ...input,
      mode: "temporary",
      introducedBy: "temporary",
    });
    return { local, diagnostics: [] };
  }

  private addParameterLocal(input: {
    readonly name: string;
    readonly type: CheckedType;
    readonly resourceKind: CheckedResourceKind;
    readonly sourceOrigin: HirOriginId;
    readonly parameterId: import("../semantic/ids").ParameterId;
    readonly mode: "receiver" | "parameter";
    readonly introducedBy: "receiver" | "parameter";
  }): void {
    if (this.bindingsByName.has(input.name)) {
      const local = this.createLocal({
        ...input,
        mode: "error",
        introducedBy: "recovery",
      });
      this.explicitBindingsByOrigin.set(input.sourceOrigin, local);
      this.diagnosticRecords.push(
        duplicateLocalDiagnostic({
          owner: this.owner,
          name: input.name,
          sourceOrigin: input.sourceOrigin,
        }),
      );
      return;
    }
    const local = this.createLocal(input);
    this.bindingsByName.set(input.name, local);
    this.explicitBindingsByOrigin.set(input.sourceOrigin, local);
  }

  private createLocal(input: {
    readonly name: string;
    readonly type: CheckedType;
    readonly resourceKind: CheckedResourceKind;
    readonly sourceOrigin: HirOriginId;
    readonly mode: HirLocal["mode"];
    readonly introducedBy: HirLocal["introducedBy"];
    readonly parameterId?: import("../semantic/ids").ParameterId;
  }): HirLocal {
    const local: HirLocal = {
      localId: hirLocalId(this.records.length),
      name: input.name,
      type: input.type,
      resourceKind: input.resourceKind,
      mode: input.mode,
      introducedBy: input.introducedBy,
      sourceOrigin: input.sourceOrigin,
      ...(input.parameterId !== undefined ? { parameterId: input.parameterId } : {}),
    };
    this.records.push(local);
    return local;
  }
}
