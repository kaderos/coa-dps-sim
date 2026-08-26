export type TalentEntry = {
  name: string;
  rank: string;
  combat: boolean;
  effect: string;
};

export type FelswornTalentDoc = {
  class: string;
  choice: string;
  note?: string;
  talents: TalentEntry[];
};

export type InfernalTalentDoc = {
  spec: string;
  choice: string;
  note?: string;
  talents: TalentEntry[];
};

export type TalentTreeId = "felsworn" | "infernal";

export type TalentTrees = {
  felsworn: FelswornTalentDoc;
  infernal: InfernalTalentDoc;
};

/** Per-talent on/off or rank (0–max for multi-point talents). */
export type TalentSelection = {
  felsworn: Record<string, boolean | number>;
  infernal: Record<string, boolean | number>;
};
