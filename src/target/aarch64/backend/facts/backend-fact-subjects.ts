import type { AArch64MachineFactSubject } from "../../machine-ir/fact-set";
import { machineFactSubjectKey } from "../../machine-ir/fact-set";

export type AArch64BackendFactSubject =
  | AArch64MachineFactSubject
  | { readonly kind: "physicalRegister"; readonly register: string }
  | { readonly kind: "aliasSet"; readonly aliasSet: string }
  | { readonly kind: "liveRange"; readonly liveRangeKey: string }
  | { readonly kind: "allocationSegment"; readonly segmentKey: string }
  | { readonly kind: "frameSlot"; readonly slotKey: string }
  | { readonly kind: "sectionFragment"; readonly fragmentKey: string }
  | { readonly kind: "relocation"; readonly relocationKey: string }
  | { readonly kind: "literalPool"; readonly literalPoolKey: string }
  | { readonly kind: "veneer"; readonly veneerKey: string };

export type AArch64BackendFactSubjectKind = AArch64BackendFactSubject["kind"];

export function backendFactSubjectKey(subject: AArch64BackendFactSubject): string {
  switch (subject.kind) {
    case "machineFunction":
    case "machineBlock":
    case "machineEdge":
    case "virtualRegister":
    case "machineInstruction":
    case "memoryOperand":
    case "frameObject":
    case "symbol":
    case "callSite":
    case "region":
    case "relocationReference":
    case "targetDeclaration":
    case "droppedFact":
      return machineFactSubjectKey(subject);
    case "physicalRegister":
      return `physical-register:${subject.register}`;
    case "aliasSet":
      return `alias-set:${subject.aliasSet}`;
    case "liveRange":
      return `live-range:${subject.liveRangeKey}`;
    case "allocationSegment":
      return `allocation-segment:${subject.segmentKey}`;
    case "frameSlot":
      return `frame-slot:${subject.slotKey}`;
    case "sectionFragment":
      return `section-fragment:${subject.fragmentKey}`;
    case "relocation":
      return `relocation:${subject.relocationKey}`;
    case "literalPool":
      return `literal-pool:${subject.literalPoolKey}`;
    case "veneer":
      return `veneer:${subject.veneerKey}`;
  }
}
