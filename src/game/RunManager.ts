export type Mutation = "long-life" | "quick-recharge" | "biomass";
export const MUTATIONS: readonly { id: Mutation; title: string; description: string }[] = [
  { id: "long-life", title: "STABLE GENOME", description: "+3 seconds to host lifespan" },
  { id: "quick-recharge", title: "RAPID METABOLISM", description: "Faster idle stamina recovery" },
  { id: "biomass", title: "BIO RECYCLER", description: "+5 DNA biomass" },
];
export class RunManager {
  floor = 1;
  biomass = 0;
  readonly mutations: Mutation[] = [];
  decayBonus = 0;
  maxDecayPenalty = 0;
  get label(): string { return `1-${this.floor}`; }
  choose(mutation: Mutation): void {
    this.mutations.push(mutation);
    if (mutation === "long-life") this.decayBonus += 3;
    if (mutation === "biomass") this.biomass += 5;
  }
}
