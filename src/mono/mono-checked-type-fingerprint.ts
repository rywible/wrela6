import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import type { MonoCheckedType } from "./mono-hir";

export function monoCheckedTypeFingerprint(type: MonoCheckedType): string {
  return checkedTypeFingerprint(type);
}
