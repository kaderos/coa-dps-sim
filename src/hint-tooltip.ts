const HINT_SHOW_DELAY_MS = 150;

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
  };

  const show = (anchor: HTMLElement) => {
    const title = anchor.dataset.hintTitle;
    const body = anchor.dataset.hintBody;
    if (!title && !body) return;

    tooltip.replaceChildren();
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
    for (const text of paragraphs) {
      const line = document.createElement("p");
      line.className = "hint-card__body";
      line.textContent = text;
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
