import type {
  HirAttempt,
  HirBrand,
  HirCallSiteRequirement,
  HirFactOrigin,
  HirImageOrigin,
  HirObligation,
  HirPlatformContractEdge,
  HirPlatformContractEdgeLookupKey,
  HirPrivateStateTransition,
  HirResourcePlace,
  HirSession,
  HirTerminalCall,
  HirValidation,
} from "./hir";
import type { FunctionId } from "../semantic/ids";
import { checkedTypesEqual, type CheckedType } from "../semantic/surface/type-model";
import type {
  AttemptId,
  BrandId,
  CallSiteRequirementId,
  FactOriginId,
  HirImageOriginId,
  HirExpressionId,
  HirOwnedId,
  HirPlatformContractEdgeId,
  HirTerminalCallId,
  HirLocalId,
  ObligationId,
  PrivateStateTransitionId,
  ResourcePlaceId,
  SessionId,
  ValidationId,
} from "./ids";
import { hirTable, type HirTable } from "./hir-table";
import { compareCodeUnitStrings } from "./deterministic-sort";

function ownerSortKey(owner: HirOwnedId<unknown>["owner"]): string {
  switch (owner.kind) {
    case "program":
      return "program";
    case "function":
      return `function:${String(owner.functionId).padStart(12, "0")}`;
    case "image":
      return `image:${String(owner.imageId).padStart(12, "0")}`;
    case "type":
      return `type:${String(owner.typeId).padStart(12, "0")}`;
  }
}

function metadataIdKey<IdValue>(id: HirOwnedId<IdValue>, family: string): string {
  return `${ownerSortKey(id.owner)}/${family}:${String(id.id).padStart(12, "0")}`;
}

function platformContractEdgeLookupKeyString(key: HirPlatformContractEdgeLookupKey): string {
  return `${ownerSortKey(key.owner)}/${String(key.callExpressionId).padStart(12, "0")}/${String(key.calleeFunctionId).padStart(12, "0")}`;
}

export interface HirPlatformContractEdgeByCallTable {
  get(key: HirPlatformContractEdgeLookupKey): readonly HirPlatformContractEdge[];
}

function buildPlatformContractEdgeByCallTable(
  edges: readonly HirPlatformContractEdge[],
): HirPlatformContractEdgeByCallTable {
  const buckets = new Map<string, HirPlatformContractEdge[]>();
  for (const edge of edges) {
    if (edge.callExpressionId === undefined) continue;
    const key = platformContractEdgeLookupKeyString({
      owner: edge.edgeId.owner,
      callExpressionId: edge.callExpressionId,
      calleeFunctionId: edge.sourceFunctionId,
    });
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [edge]);
    } else {
      bucket.push(edge);
    }
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) =>
      compareCodeUnitStrings(
        metadataIdKey(left.edgeId, "platformContractEdge"),
        metadataIdKey(right.edgeId, "platformContractEdge"),
      ),
    );
  }
  return {
    get(key: HirPlatformContractEdgeLookupKey): readonly HirPlatformContractEdge[] {
      return buckets.get(platformContractEdgeLookupKeyString(key)) ?? [];
    },
  };
}

export interface HirProofMetadata {
  readonly obligations: HirTable<HirOwnedId<ObligationId>, HirObligation>;
  readonly sessions: HirTable<HirOwnedId<SessionId>, HirSession>;
  readonly brands: HirTable<HirOwnedId<BrandId>, HirBrand>;
  readonly resourcePlaces: HirTable<HirOwnedId<ResourcePlaceId>, HirResourcePlace>;
  readonly callSiteRequirements: HirTable<
    HirOwnedId<CallSiteRequirementId>,
    HirCallSiteRequirement
  >;
  readonly validations: HirTable<HirOwnedId<ValidationId>, HirValidation>;
  readonly attempts: HirTable<HirOwnedId<AttemptId>, HirAttempt>;
  readonly terminalCalls: HirTable<HirOwnedId<HirTerminalCallId>, HirTerminalCall>;
  readonly privateStateTransitions: HirTable<
    HirOwnedId<PrivateStateTransitionId>,
    HirPrivateStateTransition
  >;
  readonly factOrigins: HirTable<HirOwnedId<FactOriginId>, HirFactOrigin>;
  readonly platformContractEdges: HirTable<
    HirOwnedId<HirPlatformContractEdgeId>,
    HirPlatformContractEdge
  >;
  readonly platformContractEdgesByCall: HirPlatformContractEdgeByCallTable;
  readonly imageOrigins: HirTable<HirOwnedId<HirImageOriginId>, HirImageOrigin>;
}

export type HirProofMetadataRecordKind =
  | "obligation"
  | "session"
  | "brand"
  | "resourcePlace"
  | "callSiteRequirement"
  | "validation"
  | "attempt"
  | "terminalCall"
  | "privateStateTransition"
  | "factOrigin"
  | "platformContractEdge"
  | "imageOrigin";

function tableFor<IdValue, Entry>(
  entries: readonly Entry[],
  family: string,
  getId: (entry: Entry) => HirOwnedId<IdValue>,
): HirTable<HirOwnedId<IdValue>, Entry> {
  return hirTable({
    entries,
    keyOf: (entry) => metadataIdKey(getId(entry), family),
    lookupKeyOf: (id) => metadataIdKey(id, family),
  });
}

function buildMetadata(input: {
  readonly obligations: readonly HirObligation[];
  readonly sessions: readonly HirSession[];
  readonly brands: readonly HirBrand[];
  readonly resourcePlaces: readonly HirResourcePlace[];
  readonly callSiteRequirements: readonly HirCallSiteRequirement[];
  readonly validations: readonly HirValidation[];
  readonly attempts: readonly HirAttempt[];
  readonly terminalCalls: readonly HirTerminalCall[];
  readonly privateStateTransitions: readonly HirPrivateStateTransition[];
  readonly factOrigins: readonly HirFactOrigin[];
  readonly platformContractEdges: readonly HirPlatformContractEdge[];
  readonly imageOrigins: readonly HirImageOrigin[];
}): HirProofMetadata {
  return {
    obligations: tableFor(input.obligations, "obligation", (entry) => entry.obligationId),
    sessions: tableFor(input.sessions, "session", (entry) => entry.sessionId),
    brands: tableFor(input.brands, "brand", (entry) => entry.brandId),
    resourcePlaces: tableFor(input.resourcePlaces, "resourcePlace", (entry) => entry.placeId),
    callSiteRequirements: tableFor(
      input.callSiteRequirements,
      "callSiteRequirement",
      (entry) => entry.callSiteRequirementId,
    ),
    validations: tableFor(input.validations, "validation", (entry) => entry.validationId),
    attempts: tableFor(input.attempts, "attempt", (entry) => entry.attemptId),
    terminalCalls: tableFor(input.terminalCalls, "terminalCall", (entry) => entry.terminalCallId),
    privateStateTransitions: tableFor(
      input.privateStateTransitions,
      "privateStateTransition",
      (entry) => entry.transitionId,
    ),
    factOrigins: tableFor(input.factOrigins, "factOrigin", (entry) => entry.factOriginId),
    platformContractEdges: tableFor(
      input.platformContractEdges,
      "platformContractEdge",
      (entry) => entry.edgeId,
    ),
    platformContractEdgesByCall: buildPlatformContractEdgeByCallTable(input.platformContractEdges),
    imageOrigins: tableFor(input.imageOrigins, "imageOrigin", (entry) => entry.imageOriginId),
  };
}

export function emptyHirProofMetadata(): HirProofMetadata {
  return buildMetadata({
    obligations: [],
    sessions: [],
    brands: [],
    resourcePlaces: [],
    callSiteRequirements: [],
    validations: [],
    attempts: [],
    terminalCalls: [],
    privateStateTransitions: [],
    factOrigins: [],
    platformContractEdges: [],
    imageOrigins: [],
  });
}

export interface HirProofMetadataBuilderApi {
  count(kind: HirProofMetadataRecordKind): number;
  countBrandsForFunction(functionId: FunctionId): number;
  countPrivateStateTransitionsForPlace(canonicalKey: string | undefined): number;
  findValidationByExpressionId(expressionId: HirExpressionId): HirValidation | undefined;
  findValidationByPendingResultPlaceKey(
    canonicalKey: string | undefined,
  ): HirValidation | undefined;
  hasValidationPendingResultType(type: CheckedType): boolean;
  addObligation(obligation: HirObligation): this;
  addSession(session: HirSession): this;
  addBrand(brand: HirBrand): this;
  addResourcePlace(place: HirResourcePlace): this;
  addCallSiteRequirement(requirement: HirCallSiteRequirement): this;
  addValidation(validation: HirValidation): this;
  bindValidationResultLocal(validationId: HirOwnedId<ValidationId>, localId: HirLocalId): this;
  addAttempt(attempt: HirAttempt): this;
  addTerminalCall(call: HirTerminalCall): this;
  addPrivateStateTransition(transition: HirPrivateStateTransition): this;
  addFactOrigin(origin: HirFactOrigin): this;
  addPlatformContractEdge(edge: HirPlatformContractEdge): this;
  addImageOrigin(origin: HirImageOrigin): this;
  build(): HirProofMetadata;
}

export class HirProofMetadataBuilder implements HirProofMetadataBuilderApi {
  private readonly obligationRecords: HirObligation[] = [];
  private readonly sessionRecords: HirSession[] = [];
  private readonly brandRecords: HirBrand[] = [];
  private readonly resourcePlaceRecords: HirResourcePlace[] = [];
  private readonly callSiteRequirementRecords: HirCallSiteRequirement[] = [];
  private readonly validationRecords: HirValidation[] = [];
  private readonly attemptRecords: HirAttempt[] = [];
  private readonly terminalCallRecords: HirTerminalCall[] = [];
  private readonly privateStateTransitionRecords: HirPrivateStateTransition[] = [];
  private readonly factOriginRecords: HirFactOrigin[] = [];
  private readonly platformContractEdgeRecords: HirPlatformContractEdge[] = [];
  private readonly imageOriginRecords: HirImageOrigin[] = [];
  private stagedObligations: HirProofMetadata["obligations"] | undefined;
  private stagedSessions: HirProofMetadata["sessions"] | undefined;
  private stagedBrands: HirProofMetadata["brands"] | undefined;
  private stagedResourcePlaces: HirProofMetadata["resourcePlaces"] | undefined;
  private stagedCallSiteRequirements: HirProofMetadata["callSiteRequirements"] | undefined;
  private stagedValidations: HirProofMetadata["validations"] | undefined;
  private stagedAttempts: HirProofMetadata["attempts"] | undefined;
  private stagedTerminalCalls: HirProofMetadata["terminalCalls"] | undefined;
  private stagedPrivateStateTransitions: HirProofMetadata["privateStateTransitions"] | undefined;
  private stagedFactOrigins: HirProofMetadata["factOrigins"] | undefined;
  private stagedPlatformContractEdges: HirProofMetadata["platformContractEdges"] | undefined;
  private stagedPlatformContractEdgesByCall:
    | HirProofMetadata["platformContractEdgesByCall"]
    | undefined;
  private stagedImageOrigins: HirProofMetadata["imageOrigins"] | undefined;
  private readonly brandCountByFunction = new Map<FunctionId, number>();
  private readonly transitionCountByPlace = new Map<string, number>();

  get obligations(): HirProofMetadata["obligations"] {
    return (this.stagedObligations ??= tableFor(
      this.obligationRecords,
      "obligation",
      (entry) => entry.obligationId,
    ));
  }

  get sessions(): HirProofMetadata["sessions"] {
    return (this.stagedSessions ??= tableFor(
      this.sessionRecords,
      "session",
      (entry) => entry.sessionId,
    ));
  }

  get brands(): HirProofMetadata["brands"] {
    return (this.stagedBrands ??= tableFor(this.brandRecords, "brand", (entry) => entry.brandId));
  }

  get resourcePlaces(): HirProofMetadata["resourcePlaces"] {
    return (this.stagedResourcePlaces ??= tableFor(
      this.resourcePlaceRecords,
      "resourcePlace",
      (entry) => entry.placeId,
    ));
  }

  get callSiteRequirements(): HirProofMetadata["callSiteRequirements"] {
    return (this.stagedCallSiteRequirements ??= tableFor(
      this.callSiteRequirementRecords,
      "callSiteRequirement",
      (entry) => entry.callSiteRequirementId,
    ));
  }

  get validations(): HirProofMetadata["validations"] {
    return (this.stagedValidations ??= tableFor(
      this.validationRecords,
      "validation",
      (entry) => entry.validationId,
    ));
  }

  get attempts(): HirProofMetadata["attempts"] {
    return (this.stagedAttempts ??= tableFor(
      this.attemptRecords,
      "attempt",
      (entry) => entry.attemptId,
    ));
  }

  get terminalCalls(): HirProofMetadata["terminalCalls"] {
    return (this.stagedTerminalCalls ??= tableFor(
      this.terminalCallRecords,
      "terminalCall",
      (entry) => entry.terminalCallId,
    ));
  }

  get privateStateTransitions(): HirProofMetadata["privateStateTransitions"] {
    return (this.stagedPrivateStateTransitions ??= tableFor(
      this.privateStateTransitionRecords,
      "privateStateTransition",
      (entry) => entry.transitionId,
    ));
  }

  get factOrigins(): HirProofMetadata["factOrigins"] {
    return (this.stagedFactOrigins ??= tableFor(
      this.factOriginRecords,
      "factOrigin",
      (entry) => entry.factOriginId,
    ));
  }

  get platformContractEdges(): HirProofMetadata["platformContractEdges"] {
    return (this.stagedPlatformContractEdges ??= tableFor(
      this.platformContractEdgeRecords,
      "platformContractEdge",
      (entry) => entry.edgeId,
    ));
  }

  get platformContractEdgesByCall(): HirProofMetadata["platformContractEdgesByCall"] {
    return (this.stagedPlatformContractEdgesByCall ??= buildPlatformContractEdgeByCallTable(
      this.platformContractEdgeRecords,
    ));
  }

  get imageOrigins(): HirProofMetadata["imageOrigins"] {
    return (this.stagedImageOrigins ??= tableFor(
      this.imageOriginRecords,
      "imageOrigin",
      (entry) => entry.imageOriginId,
    ));
  }

  count(kind: HirProofMetadataRecordKind): number {
    switch (kind) {
      case "obligation":
        return this.obligationRecords.length;
      case "session":
        return this.sessionRecords.length;
      case "brand":
        return this.brandRecords.length;
      case "resourcePlace":
        return this.resourcePlaceRecords.length;
      case "callSiteRequirement":
        return this.callSiteRequirementRecords.length;
      case "validation":
        return this.validationRecords.length;
      case "attempt":
        return this.attemptRecords.length;
      case "terminalCall":
        return this.terminalCallRecords.length;
      case "privateStateTransition":
        return this.privateStateTransitionRecords.length;
      case "factOrigin":
        return this.factOriginRecords.length;
      case "platformContractEdge":
        return this.platformContractEdgeRecords.length;
      case "imageOrigin":
        return this.imageOriginRecords.length;
    }
  }

  countBrandsForFunction(functionId: FunctionId): number {
    return this.brandCountByFunction.get(functionId) ?? 0;
  }

  countPrivateStateTransitionsForPlace(canonicalKey: string | undefined): number {
    return this.transitionCountByPlace.get(canonicalKey ?? "unknown") ?? 0;
  }

  findValidationByExpressionId(expressionId: HirExpressionId): HirValidation | undefined {
    return this.validationRecords.find(
      (validation) => validation.validationExpressionId === expressionId,
    );
  }

  findValidationByPendingResultPlaceKey(
    canonicalKey: string | undefined,
  ): HirValidation | undefined {
    if (canonicalKey === undefined) return undefined;
    return this.validationRecords.find(
      (validation) => validation.pendingResultPlace.canonicalKey === canonicalKey,
    );
  }

  hasValidationPendingResultType(type: CheckedType): boolean {
    return this.validationRecords.some(
      (validation) =>
        validation.pendingResultPlace.type !== undefined &&
        checkedTypesEqual(type, validation.pendingResultPlace.type),
    );
  }

  addObligation(obligation: HirObligation): this {
    this.obligationRecords.push(obligation);
    this.stagedObligations = undefined;
    return this;
  }

  addSession(session: HirSession): this {
    this.sessionRecords.push(session);
    this.stagedSessions = undefined;
    return this;
  }

  addBrand(brand: HirBrand): this {
    this.brandRecords.push(brand);
    if (brand.brandId.owner.kind === "function") {
      this.incrementBrandCount(brand.brandId.owner.functionId);
    }
    this.stagedBrands = undefined;
    return this;
  }

  addResourcePlace(place: HirResourcePlace): this {
    this.resourcePlaceRecords.push(place);
    this.stagedResourcePlaces = undefined;
    return this;
  }

  addCallSiteRequirement(requirement: HirCallSiteRequirement): this {
    this.callSiteRequirementRecords.push(requirement);
    this.stagedCallSiteRequirements = undefined;
    return this;
  }

  addValidation(validation: HirValidation): this {
    this.validationRecords.push(validation);
    this.stagedValidations = undefined;
    return this;
  }

  bindValidationResultLocal(validationId: HirOwnedId<ValidationId>, localId: HirLocalId): this {
    const index = this.validationRecords.findIndex(
      (validation) =>
        validation.validationId.owner.kind === validationId.owner.kind &&
        validation.validationId.owner.kind === "function" &&
        validationId.owner.kind === "function" &&
        validation.validationId.owner.functionId === validationId.owner.functionId &&
        validation.validationId.id === validationId.id,
    );
    if (index < 0) return this;
    this.validationRecords[index] = {
      ...this.validationRecords[index]!,
      resultLocalId: localId,
    };
    this.stagedValidations = undefined;
    return this;
  }

  addAttempt(attempt: HirAttempt): this {
    this.attemptRecords.push(attempt);
    this.stagedAttempts = undefined;
    return this;
  }

  addTerminalCall(call: HirTerminalCall): this {
    this.terminalCallRecords.push(call);
    this.stagedTerminalCalls = undefined;
    return this;
  }

  addPrivateStateTransition(transition: HirPrivateStateTransition): this {
    this.privateStateTransitionRecords.push(transition);
    this.incrementTransitionCount(transition.place?.canonicalKey);
    this.stagedPrivateStateTransitions = undefined;
    return this;
  }

  addFactOrigin(origin: HirFactOrigin): this {
    this.factOriginRecords.push(origin);
    this.stagedFactOrigins = undefined;
    return this;
  }

  addPlatformContractEdge(edge: HirPlatformContractEdge): this {
    this.platformContractEdgeRecords.push(edge);
    this.stagedPlatformContractEdges = undefined;
    this.stagedPlatformContractEdgesByCall = undefined;
    return this;
  }

  addImageOrigin(origin: HirImageOrigin): this {
    this.imageOriginRecords.push(origin);
    this.stagedImageOrigins = undefined;
    return this;
  }

  build(): HirProofMetadata {
    return this.staged();
  }

  private staged(): HirProofMetadata {
    return {
      obligations: this.obligations,
      sessions: this.sessions,
      brands: this.brands,
      resourcePlaces: this.resourcePlaces,
      callSiteRequirements: this.callSiteRequirements,
      validations: this.validations,
      attempts: this.attempts,
      terminalCalls: this.terminalCalls,
      privateStateTransitions: this.privateStateTransitions,
      factOrigins: this.factOrigins,
      platformContractEdges: this.platformContractEdges,
      platformContractEdgesByCall: this.platformContractEdgesByCall,
      imageOrigins: this.imageOrigins,
    };
  }

  private incrementBrandCount(functionId: FunctionId): void {
    this.brandCountByFunction.set(functionId, this.countBrandsForFunction(functionId) + 1);
  }

  private incrementTransitionCount(canonicalKey: string | undefined): void {
    const key = canonicalKey ?? "unknown";
    this.transitionCountByPlace.set(key, this.countPrivateStateTransitionsForPlace(key) + 1);
  }
}
