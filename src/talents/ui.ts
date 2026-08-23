import {
  countEnabledTalents,
  isTalentEnabled,
  talentPoints,
  talentRankLabel,
  type TalentEntry,
  type TalentSelection,
  type TalentTreeId,
  type TalentTrees,
} from "./baseline";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTalentCard(
  tree: TalentTreeId,
  talent: TalentEntry,
  selection: TalentSelection,
): string {
  const enabled = isTalentEnabled(selection, tree, talent.name);
  const points = talentPoints(talent.rank);
  const rankLabel = talentRankLabel(talent.rank);
  const classes = [
    "talent-card",
    enabled ? "is-enabled" : "is-disabled",
    talent.combat ? "is-combat" : "is-utility",
  ].join(" ");
  const pointsLabel = points != null ? `${points} pt${points === 1 ? "" : "s"}` : rankLabel;

  return `
    <label class="${classes}">
      <input
        type="checkbox"
        data-talent-tree="${tree}"
        data-talent-name="${escapeHtml(talent.name)}"
        ${enabled ? "checked" : ""}
      />
      <span class="talent-card__body">
        <span class="talent-card__head">
          <strong class="talent-card__name">${escapeHtml(talent.name)}</strong>
          <span class="talent-card__rank" title="Rank">${escapeHtml(rankLabel)}</span>
          <span class="talent-card__points" title="Points invested">${escapeHtml(pointsLabel)}</span>
          <span class="talent-card__tag">${talent.combat ? "Combat" : "Utility"}</span>
        </span>
        <span class="talent-card__effect">${escapeHtml(talent.effect)}</span>
      </span>
    </label>
  `;
}

function renderTreeSection(
  tree: TalentTreeId,
  title: string,
  subtitle: string,
  note: string,
  talents: TalentEntry[],
  selection: TalentSelection,
): string {
  const enabled = countEnabledTalents(selection, tree, talents);
  const combat = talents.filter((talent) => talent.combat).length;
  const combatEnabled = talents.filter((talent) => talent.combat && isTalentEnabled(selection, tree, talent.name)).length;

  return `
    <section class="talent-tree" data-talent-tree="${tree}">
      <header class="talent-tree__header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="talent-tree__subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="talent-tree__counts">
          <span>${enabled}/${talents.length} enabled</span>
          <span>${combatEnabled}/${combat} combat</span>
        </div>
      </header>
      <p class="hint talent-tree__note">${escapeHtml(note)}</p>
      <div class="talent-grid">
        ${talents.map((talent) => renderTalentCard(tree, talent, selection)).join("")}
      </div>
    </section>
  `;
}

export function renderTalentTrees(trees: TalentTrees, selection: TalentSelection): string {
  const felsworn = renderTreeSection(
    "felsworn",
    trees.felsworn.class,
    `Capstone: ${trees.felsworn.choice}`,
    trees.felsworn.note,
    trees.felsworn.talents,
    selection,
  );
  const infernal = renderTreeSection(
    "infernal",
    trees.infernal.spec,
    `Capstone: ${trees.infernal.choice}`,
    trees.infernal.note,
    trees.infernal.talents,
    selection,
  );
  return `<div class="talent-layout">${felsworn}${infernal}</div>`;
}

export function setupTalents(
  trees: TalentTrees,
  selection: TalentSelection,
  onChange: (next: TalentSelection) => void,
): TalentSelection {
  const root = document.getElementById("talents-controls");
  if (!root) return selection;

  const paint = () => {
    root.innerHTML = renderTalentTrees(trees, selection);
    root.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-talent-tree]").forEach((input) => {
      input.addEventListener("change", () => {
        const tree = input.dataset.talentTree as TalentTreeId | undefined;
        const name = input.dataset.talentName;
        if (!tree || !name) return;
        selection[tree][name] = input.checked;
        onChange({ ...selection, [tree]: { ...selection[tree] } });
        paint();
      });
    });
  };

  paint();
  return selection;
}
