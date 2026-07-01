export function selectAArch64CompareSelectShape(input: {
  readonly hasNzcvProducer: boolean;
  readonly unpredictable: boolean;
}): "csel" | "ccmp" | "b-cond" {
  if (!input.hasNzcvProducer) return "b-cond";
  return input.unpredictable ? "csel" : "b-cond";
}
