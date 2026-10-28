import type { HostKind } from "../entities/Host";

export interface WhisperLine {
  kind: HostKind;
  text: string;
}

export interface IncidentLog {
  id: string;
  title: string;
  body: string;
}

/** One-line memories that surface when the spore takes a body. */
export const WHISPERS: Record<HostKind, string[]> = {
  security: [
    "The air filters were leaking again.",
    "Her birthday was today.",
    "Please don't let them open Sector 4...",
    "I only took this shift for the dental plan.",
    "The turrets stopped answering at 0300.",
  ],
  enforcer: [
    "They said the suits were rated for this.",
    "I can still hear it moving in the vents.",
    "Hold the line. Hold the line.",
    "My daughter thinks I fix satellites.",
    "Something wore Ramirez. I didn't say anything.",
  ],
  mutant: [
    "It doesn't hurt anymore.",
    "We were people. We were people.",
    "The flesh remembers what the mind forgets.",
    "Feed it. Feed it and it stays quiet.",
    "I can taste the fluorescent lights.",
  ],
};

export const INCIDENT_LOGS: IncidentLog[] = [
  {
    id: "log_01",
    title: "QUARANTINE ORDER 04",
    body:
      "At 03:12 the Sector 4 biofoundry depressed its blast doors. No evacuation was authorized. " +
      "Personnel are instructed to remain calm and remain indoors. The entity is airborne, patient, and very small.",
  },
  {
    id: "log_02",
    title: "SUBJECT ZERO — THE SPORE",
    body:
      "Recovered from a cracked coolant line. One cell of muscle, one cell of want. It does not bite; it wears. " +
      "It cannot survive a single hostile impact outside a body. Inside one, it borrows the body's death.",
  },
  {
    id: "log_03",
    title: "GRAFT PROTOCOL",
    body:
      "When the spore abandons a body, its rootlets tear free with a signature trait still attached. " +
      "The next host inherits that trait. Every jump makes a worse, faster, better animal.",
  },
  {
    id: "log_04",
    title: "CORPSE CANNON",
    body:
      "A vacated host detonates on a 140px acid radius. The blast strips plating. " +
      "Field reports describe the sound as 'a wet door closing', followed by no further reports.",
  },
  {
    id: "log_05",
    title: "MELTDOWN",
    body:
      "A worn body rejects the passenger in ten to sixteen seconds. Damage accelerates the collapse. " +
      "At zero, the host folds inward and crushes whatever is still inside. The spore has no second body.",
  },
  {
    id: "log_06",
    title: "SECTOR 4 — CONTAINMENT BREACHED",
    body:
      "The wing is quiet. Eight bodies are no longer standing, and one of them is still moving. " +
      "Recommendation: do not record this entry. Recommendation: do not remember the whispers.",
  },
];

/**
 * Tracks which lore the player has earned. Persists across retries so the
 * codex fills in as the facility is explored.
 */
export class LoreLog {
  private readonly unlockedIds = new Set<string>(["log_01"]);
  readonly transcripts: WhisperLine[] = [];

  recordWhisper(kind: HostKind, text: string): void {
    if (this.transcripts.some((line) => line.text === text)) return;
    this.transcripts.push({ kind, text });
  }

  unlock(id: string): void {
    this.unlockedIds.add(id);
  }

  isUnlocked(id: string): boolean {
    return this.unlockedIds.has(id);
  }

  get unlockedCount(): number {
    return this.unlockedIds.size;
  }
}
