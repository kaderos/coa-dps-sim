const HINT_SHOW_DELAY_MS = 150;

const STAT_HINT_LABELS = new Set([
  "Base",
  "Gear",
  "Enchants",
  "Set bonuses",
  "Buffs & consumes",
  "Primary stat % buffs",
  "Total",
  "Talents",
  "Inner Demon",
  "Intellect",
  "Buffs & debuffs",
  "Fel Infusion",
  "Cruelty",
  "Nether Spirit (Spirit)",
  "Hidden Power (Spirit)",
  "Hidden Power (Intellect)",
  "From rating",
  "Crit Rating",
  "Hit Rating",
  "Haste Rating",
  "Normal hit",
  "Crit hit",
]);

let hintTimer: ReturnType<typeof setTimeout> | null = null;
let hintAnchor: HTMLElement | null = null;

export function bindHintTooltips(root: ParentNode, selector = "[data-hint-body]") {
  const tooltip = document.getElementById("hint-tooltip");
  if (!tooltip) return;

  const hide = () => {
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
    hintAnchor = null;
    tooltip.hidden = true;
    tooltip.className = "hint-tooltip";
  };

  const show = (anchor: HTMLElement) => {
    const title = anchor.dataset.hintTitle;
    const body = anchor.dataset.hintBody;
    const reminders = anchor.dataset.hintReminders?.split("\n\n").filter((line) => line.trim()) ?? [];
    if (!title && !body && !reminders.length) return;

    tooltip.replaceChildren();
    tooltip.className = anchor.dataset.hintCompact != null ? "hint-tooltip hint-tooltip--compact" : "hint-tooltip";
    const card = document.createElement("div");
    card.className = "hint-card";

    if (title) {
      const heading = document.createElement("p");
      heading.className = "hint-card__title";
      heading.textContent = title;
      card.appendChild(heading);
    }

    const note = anchor.dataset.hintNote;
    if (note) {
      const sub = document.createElement("p");
      sub.className = "hint-card__note";
      sub.textContent = note;
      card.appendChild(sub);
    }

    const paragraphs = (body ?? "").split("\n\n").filter((line) => line.trim());
    if (!paragraphs.length && body) paragraphs.push(body);
    let rowsGrid: HTMLElement | null = null;
    for (const text of paragraphs) {
      rowsGrid = appendHintBodyLine(card, text, rowsGrid);
    }

    for (const html of reminders) {
      const line = document.createElement("p");
      line.className = "hint-card__reminder-line";
      line.innerHTML = html;
      card.appendChild(line);
    }

    tooltip.appendChild(card);
    tooltip.hidden = false;
    positionHintTooltip(tooltip, anchor);
  };

  root.querySelectorAll<HTMLElement>(selector).forEach((anchor) => {
    anchor.addEventListener("mouseenter", () => {
      hintAnchor = anchor;
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        if (hintAnchor === anchor) show(anchor);
      }, HINT_SHOW_DELAY_MS);
    });
    anchor.addEventListener("mouseleave", hide);
    anchor.addEventListener("mousedown", hide);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (!tooltip.hidden) hide();
    },
    true,
  );
}

function appendHintBodyLine(card: HTMLElement, text: string, rowsGrid: HTMLElement | null): HTMLElement | null {
  const split = splitHintLabel(text);
  if (!split) {
    const line = document.createElement("p");
    line.className = card.querySelector(".hint-card__rows, .hint-card__lead, .hint-card__body")
      ? "hint-card__body"
      : "hint-card__lead";
    line.textContent = text;
    card.appendChild(line);
    return rowsGrid;
  }

  const grid = rowsGrid ?? createRowsGrid(card);
  const isTotal = split.label === "Total";

  const value = document.createElement("span");
  value.className = "hint-card__value";
  if (isTotal) value.classList.add("hint-card__value--total");
  value.textContent = split.value;

  const label = document.createElement("span");
  label.className = "hint-card__label";
  if (isTotal) label.classList.add("hint-card__label--total");
  label.textContent = split.label;

  grid.append(value, label);
  return grid;
}

function createRowsGrid(card: HTMLElement): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "hint-card__rows";
  card.appendChild(grid);
  return grid;
}

function splitHintLabel(text: string): { label: string; value: string } | null {
  const colon = text.indexOf(": ");
  if (colon <= 0) return null;
  const label = text.slice(0, colon);
  const value = text.slice(colon + 2);
  if (STAT_HINT_LABELS.has(label) || / rating$/.test(label)) return { label, value };
  return null;
}

function positionHintTooltip(tooltip: HTMLElement, anchor: HTMLElement) {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const gap = 12;
  let left = anchorRect.right + gap;
  if (left + tooltipRect.width > window.innerWidth - gap) {
    left = anchorRect.left - tooltipRect.width - gap;
  }
  let top = anchorRect.top;
  top = Math.max(gap, Math.min(top, window.innerHeight - tooltipRect.height - gap));
  tooltip.style.left = `${Math.max(gap, left)}px`;
  tooltip.style.top = `${top}px`;
}
