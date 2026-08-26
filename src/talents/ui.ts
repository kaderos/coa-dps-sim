import {
  countEnabledTalents,
  INFERNAL_CORE_TALENTS,
  INFERNAL_TALENT_POINT_CAP,
  infernalTalentPoints,
  isCoreTalent,
  isRankedTalentEntry,
  isTalentEnabled,
  parseTalentMaxRank,
  talentPoints,
  talentRank,
  talentRankLabel,
  wouldExceedInfernalPointCap,
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

function renderRankedInput(
  tree: TalentTreeId,
  talent: TalentEntry,
  selection: TalentSelection,
): string {
  const max = parseTalentMaxRank(talent.rank) ?? 2;
  const rank = talentRank(selection, tree, talent.name);
  const options = Array.from({ length: max + 1 }, (_, value) => {
    const selected = value === rank ? " selected" : "";
    return `<option value="${value}"${selected}>${value}/${max}</option>`;
  }).join("");
  return `<select class="talent-card__rank-select" data-talent-tree="${tree}" data-talent-name="${escapeHtml(talent.name)}" data-talent-rank>${options}</select>`;
}

function renderTalentCard(
  tree: TalentTreeId,
  talent: TalentEntry,
  selection: TalentSelection,
  fixed = false,
): string {
  const ranked = !fixed && isRankedTalentEntry(talent);
  const enabled = fixed || isTalentEnabled(selection, tree, talent.name);
  const points = talentPoints(talent.rank);
  const rankLabel = talentRankLabel(talent.rank);
  const classes = [
    "talent-card",
    enabled ? "is-enabled" : "is-disabled",
    talent.combat ? "is-combat" : "is-utility",
    fixed ? "is-fixed" : "",
    ranked ? "is-ranked" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const pointsLabel = points != null ? `${points} pt${points === 1 ? "" : "s"}` : rankLabel;
  const input = ranked
    ? renderRankedInput(tree, talent, selection)
    : `<input type="checkbox" data-talent-tree="${tree}" data-talent-name="${escapeHtml(talent.name)}" ${fixed ? "checked disabled" : enabled ? "checked" : ""} />`;

  return `
    <div class="${classes}">
      ${input}
      <span class="talent-card__body">
        <span class="talent-card__head">
          <strong class="talent-card__name">${escapeHtml(talent.name)}</strong>
          <span class="talent-card__rank" title="Rank">${escapeHtml(rankLabel)}</span>
          ${ranked ? "" : `<span class="talent-card__points" title="Points invested">${escapeHtml(pointsLabel)}</span>`}
          <span class="talent-card__tag">${talent.combat ? "Combat" : "Utility"}</span>
        </span>
        <span class="talent-card__effect">${escapeHtml(talent.effect)}</span>
      </span>
    </div>
  `;
}

function infernalCoreTalents(talents: TalentEntry[]): TalentEntry[] {
  return INFERNAL_CORE_TALENTS.map((name) => talents.find((talent) => talent.name === name)).filter(
    (talent): talent is TalentEntry => Boolean(talent),
  );
}

function renderCoreSection(talents: TalentEntry[], selection: TalentSelection): string {
  return `
    <section class="talent-tree talent-tree--core">
      <header class="talent-tree__header">
        <div><h3>Core</h3></div>
        <div class="talent-tree__counts"><span>${talents.length}/${talents.length}</span></div>
      </header>
      <div class="talent-grid">
        ${talents.map((talent) => renderTalentCard("infernal", talent, selection, true)).join("")}
      </div>
    </section>
  `;
}

function renderTreeSection(
  tree: TalentTreeId,
  title: string,
  subtitle: string,
  talents: TalentEntry[],
  selection: TalentSelection,
  note?: string,
  pointsSummary?: string,
): string {
  const enabled = countEnabledTalents(selection, tree, talents);
  const counts = [
    pointsSummary ? `<span>${escapeHtml(pointsSummary)}</span>` : "",
    ...(pointsSummary ? [] : [`<span>${enabled}/${talents.length} enabled</span>`]),
  ]
    .filter(Boolean)
    .join("");

  return `
    <section class="talent-tree" data-talent-tree="${tree}">
      <header class="talent-tree__header">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p class="talent-tree__subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="talent-tree__counts">
          ${counts}
        </div>
      </header>
      ${note ? `<p class="hint talent-tree__note">${escapeHtml(note)}</p>` : ""}
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
    trees.felsworn.talents,
    selection,
    trees.felsworn.note,
  );
  const infernalCore = infernalCoreTalents(trees.infernal.talents);
  const infernalOptional = trees.infernal.talents.filter((talent) => !isCoreTalent("infernal", talent.name));
  const infernalPoints = `${infernalTalentPoints(selection, infernalOptional)}/${INFERNAL_TALENT_POINT_CAP} points`;
  const infernal = `
    <div class="talent-column">
      ${renderCoreSection(infernalCore, selection)}
      ${renderTreeSection(
        "infernal",
        trees.infernal.spec,
        `Capstone: ${trees.infernal.choice}`,
        infernalOptional,
        selection,
        trees.infernal.note,
        infernalPoints,
      )}
    </div>
  `;
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
        if (!tree || !name || isCoreTalent(tree, name)) return;
        const value = input.checked;
        if (wouldExceedInfernalPointCap(selection, trees.infernal.talents, tree, name, value)) {
          input.checked = !value;
          return;
        }
        selection[tree][name] = value;
        onChange({ ...selection, [tree]: { ...selection[tree] } });
        paint();
      });
    });
    root.querySelectorAll<HTMLSelectElement>("select[data-talent-rank]").forEach((select) => {
      select.addEventListener("change", () => {
        const tree = select.dataset.talentTree as TalentTreeId | undefined;
        const name = select.dataset.talentName;
        if (!tree || !name) return;
        const previous = talentRank(selection, tree, name);
        const value = Number(select.value);
        if (wouldExceedInfernalPointCap(selection, trees.infernal.talents, tree, name, value)) {
          select.value = String(previous);
          return;
        }
        selection[tree][name] = value;
        onChange({ ...selection, [tree]: { ...selection[tree] } });
        paint();
      });
    });
  };

  paint();
  return selection;
}
