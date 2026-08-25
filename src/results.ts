import type { CharacterStats, SimCastEvent, SimResult, SpellFit } from "./types";
import { renderCastLogAuraItem } from "./cast-log-hints";
import { bindHintTooltips } from "./hint-tooltip";
import { CAST_EVENT_LOG_LIMIT } from "./sim/infernal";
import { spellFormulaHint } from "./spell-formula-hint";

export type SimSnapshot = {
  meanDps: number;
  minDps: number;
  p50Dps: number;
  p95Dps: number;
  maxDps: number;
  stdev: number;
  iterations: number;
};

export function toSnapshot(result: SimResult): SimSnapshot {
  return {
    meanDps: result.meanDps,
    minDps: result.minDps,
    p50Dps: result.p50Dps,
    p95Dps: result.p95Dps,
    maxDps: result.maxDps,
    stdev: result.stdev,
    iterations: result.iterations,
  };
}

export function renderGearSimCard(
  current: SimSnapshot | null,
  pinned: SimSnapshot | null,
  actions: { onSimulate: () => void; onPin: () => void; onUnpin: () => void },
) {
  const summary = document.getElementById("gear-sim-summary");
  const details = document.getElementById("gear-sim-details");
  if (!summary || !details) return;

  if (!current) {
    summary.innerHTML = `
      <div class="gear-sim__head">
        <h3>Sim</h3>
      </div>
      <button class="gear-sim__run" id="gear-sim-run" type="button">Simulate</button>`;
    details.innerHTML = `<p class="hint gear-sim__hint">Pin a result, change gear, then simulate again to compare.</p>`;
    wireGearSimActions(actions);
    return;
  }

  const comparing = Boolean(pinned && pinned !== current);
  summary.innerHTML = `
    <div class="gear-sim__head">
      <h3>${comparing ? "vs pinned" : pinned ? "Pinned" : "Latest"}</h3>
      ${pinned
        ? `<button class="text-button" id="gear-sim-unpin" type="button">Unpin</button>`
        : `<button class="text-button" id="gear-sim-pin" type="button">📌 Pin</button>`}
    </div>
    <button class="gear-sim__run" id="gear-sim-run" type="button">Simulate</button>`;
  details.innerHTML = `
    <div class="gear-sim__dps">${current.meanDps.toFixed(0)} <small>DPS</small></div>
    ${comparing && pinned ? `<div class="gear-sim__delta ${deltaClass(current.meanDps - pinned.meanDps)}">${signed(current.meanDps - pinned.meanDps, 0)} (${signedPct(current.meanDps, pinned.meanDps)})</div>` : ""}
    <div class="gear-sim__metrics">
      ${simMetric("Minimum", current.minDps, pinned?.minDps)}
      ${simMetric("Median", current.p50Dps, pinned?.p50Dps)}
      ${simMetric("95th percentile", current.p95Dps, pinned?.p95Dps)}
      ${simMetric("Maximum", current.maxDps, pinned?.maxDps)}
      ${simMetric("Std. deviation", current.stdev, pinned?.stdev)}
      ${simMetric("Iterations", current.iterations, pinned?.iterations, 0)}
    </div>
    ${comparing ? `<p class="hint gear-sim__hint">Pinned ${pinned!.meanDps.toFixed(0)} DPS. Next run updates the comparison.</p>` : `<p class="hint gear-sim__hint">Pin this result, change gear, then simulate again.</p>`}
  `;
  wireGearSimActions(actions);
}

function wireGearSimActions(actions: { onSimulate: () => void; onPin: () => void; onUnpin: () => void }) {
  document.getElementById("gear-sim-run")?.addEventListener("click", actions.onSimulate);
  document.getElementById("gear-sim-pin")?.addEventListener("click", actions.onPin);
  document.getElementById("gear-sim-unpin")?.addEventListener("click", actions.onUnpin);
}

function simMetric(label: string, value: number, pinned: number | undefined, digits = 0): string {
  const delta = pinned == null ? "" : `<em class="${deltaClass(value - pinned)}">${signed(value - pinned, digits)}</em>`;
  return `<div><span>${label}</span><strong>${value.toFixed(digits)}</strong>${delta}</div>`;
}

function deltaClass(value: number): string {
  if (value > 0) return "delta-pos";
  if (value < 0) return "delta-neg";
  return "delta-flat";
}

function signedPct(current: number, pinned: number): string {
  if (!pinned) return "0.0%";
  return `${signed(((current - pinned) / pinned) * 100)}%`;
}

export function renderResultsEmpty() {
  const root = document.getElementById("results");
  if (!root) return;
  root.innerHTML = `
    <div class="results-empty">
      <p class="hint">Use Simulate in the sidebar to see DPS, spell breakdown, and cast log.</p>
    </div>`;
}

export function renderResults(
  result: SimResult,
  options: { spells?: Record<string, SpellFit>; stats?: CharacterStats } = {},
) {
  const root = document.getElementById("results");
  if (!root) return;

  root.innerHTML = `
    <div class="result-summary">
      <div class="dps">${result.meanDps.toFixed(0)} <small>DPS</small></div>
      <div class="metric-grid">
        ${metric("Minimum", result.minDps)}
        ${metric("Median", result.p50Dps)}
        ${metric("95th percentile", result.p95Dps)}
        ${metric("Maximum", result.maxDps)}
        ${metric("Std. deviation", result.stdev)}
        ${metric("Iterations", result.iterations, 0)}
      </div>
      <div class="compare">Level ${result.bossLevel} raid boss · stationary fight (no movement, no cleave) · ${result.durationSec}s ±5s.</div>
      ${result.activeCombatBuffs?.length ? `<div class="compare">Active buffs: ${result.activeCombatBuffs.map((label) => escapeHtml(label)).join(" · ")}</div>` : ""}
    </div>
    <section class="result-section">
      <h3>DPS distribution</h3>
      <div class="histogram" role="img" aria-label="DPS per iteration histogram">${histogram(result.dpsSamples, result.meanDps, result.iterations)}</div>
    </section>
    <section class="result-section">
      <h3>Spell breakdown</h3>
      <div class="table-scroll"><table class="spell-breakdown">
        <thead><tr><th>Spell</th><th>DPS</th><th class="share-bar-col">% Share</th><th>Average Hit</th><th>Casts</th><th>Normal Hit</th><th>Crit Hit</th><th>Miss</th></tr></thead>
        <tbody>${spellRows(result, options.spells, options.stats).join("")}</tbody>
      </table></div>
    </section>
    ${result.auraUptimes.length ? `
      <section class="result-section">
        <h3>Aura uptime</h3>
        <div class="uptime-list">${renderAuraUptimes(result.auraUptimes)}</div>
      </section>` : ""}
    <section class="result-section">
      <div class="result-section__heading">
        <div>
          <h3>Sim cast log</h3>
          <div class="hint">${castLogHint(result)}</div>
        </div>
        <div class="cast-log-toolbar">
          <label class="check-option cast-log-filter">
            <input type="checkbox" id="cast-log-hide-ticks" checked />
            <span>Hide DoT ticks</span>
          </label>
          <button class="text-button" id="cast-log-expand-all" type="button">Expand all</button>
          <button class="text-button" id="cast-log-collapse-all" type="button">Collapse all</button>
          <button class="text-button" id="download-cast-log" type="button">Download JSON</button>
        </div>
      </div>
      <div class="table-scroll cast-log"><table>
        <thead><tr><th>Time</th><th>Spell</th><th>Result</th><th>Damage</th><th>Energy</th><th>Felfury</th><th class="cast-log-expand-col" aria-hidden="true"></th></tr></thead>
        <tbody>${castLogRows(result.castEvents).join("")}</tbody>
      </table></div>
    </section>
  `;
  document.getElementById("download-cast-log")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(result.castEvents, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `coa-cast-log-seed-1-${result.durationSec}s.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
  bindCastLogExpanders();
  bindCastLogTickFilter();
  bindCastLogBulkExpand();
  const castLog = root.querySelector(".cast-log");
  if (castLog) bindHintTooltips(castLog);
  const spellBreakdown = root.querySelector(".spell-breakdown");
  if (spellBreakdown) {
    bindHintTooltips(spellBreakdown, ".spell-breakdown__avg-hit[data-hint-body], .spell-breakdown__name[data-hint-body]");
  }
}

function setCastLogRowExpanded(row: HTMLTableRowElement, expanded: boolean) {
  const detail = row.nextElementSibling as HTMLTableRowElement | null;
  if (!detail?.classList.contains("cast-log-detail")) return;
  detail.hidden = !expanded;
  row.classList.toggle("is-expanded", expanded);
  const toggle = row.querySelector(".cast-log-expand");
  if (toggle) toggle.textContent = expanded ? "▾" : "▸";
}

function applyCastLogTickFilter() {
  const checkbox = document.getElementById("cast-log-hide-ticks") as HTMLInputElement | null;
  if (!checkbox) return;
  const hide = checkbox.checked;
  document.querySelectorAll<HTMLElement>("[data-log-kind='tick']").forEach((row) => {
    row.hidden = hide;
  });
}

function bindCastLogBulkExpand() {
  document.getElementById("cast-log-expand-all")?.addEventListener("click", () => {
    document.querySelectorAll<HTMLTableRowElement>(".cast-log-row--expandable").forEach((row) => {
      setCastLogRowExpanded(row, true);
    });
    applyCastLogTickFilter();
  });
  document.getElementById("cast-log-collapse-all")?.addEventListener("click", () => {
    document.querySelectorAll<HTMLTableRowElement>(".cast-log-row--expandable").forEach((row) => {
      setCastLogRowExpanded(row, false);
    });
  });
}

function castLogHint(result: SimResult): string {
  const lastTs = result.castEvents.at(-1)?.timestamp;
  const fight = `${result.castLogFightSec.toFixed(1)}s fight`;
  const events = `${result.castEvents.length} events logged`;
  const tail =
    result.castLogTruncated && lastTs != null
      ? ` · log capped at ${CAST_EVENT_LOG_LIMIT} (stops at ${lastTs.toFixed(1)}s; DPS still uses full ${fight})`
      : " · ticks are periodic damage (no GCD) · click a row to expand buffs";
  return `First seed only · ${fight} · ${events}${tail}`;
}

function castLogRows(events: SimCastEvent[]): string[] {
  return events.flatMap((event, index) => {
    const auras = event.activeAuras ?? [];
    const expandable = auras.length > 0;
    const isTick = event.kind === "tick" || event.result === "tick";
    const rowClass = [
      "cast-log-row",
      expandable ? "cast-log-row--expandable" : "",
      isTick ? "cast-log-row--tick" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const tickAttr = isTick ? ' data-log-kind="tick"' : "";
    const main = `<tr class="${rowClass}" data-cast-log-index="${index}"${tickAttr}${expandable ? ' title="Show active procs and buffs"' : ""}>
      <td>${event.timestamp.toFixed(2)}s</td>
      <td>${escapeHtml(event.spell)}</td>
      <td class="cast-result cast-result--${event.result}">${event.result}</td>
      <td>${event.damage.toFixed(0)}</td>
      <td>${event.energy.toFixed(1)}</td>
      <td>${event.felfury.toFixed(1)}</td>
      <td class="cast-log-expand" aria-hidden="true">${expandable ? "▸" : ""}</td>
    </tr>`;
    if (!expandable) return [main];
    return [
      main,
      `<tr class="cast-log-detail" data-cast-log-detail="${index}"${isTick ? ' data-log-kind="tick"' : ""} hidden>
        <td colspan="7">
          <ul class="cast-log-buffs">${auras.map((aura) => renderCastLogAuraItem(aura)).join("")}</ul>
        </td>
      </tr>`,
    ];
  });
}

function bindCastLogTickFilter() {
  const checkbox = document.getElementById("cast-log-hide-ticks") as HTMLInputElement | null;
  if (!checkbox) return;
  checkbox.addEventListener("change", applyCastLogTickFilter);
  applyCastLogTickFilter();
}

function bindCastLogExpanders() {
  document.querySelectorAll<HTMLTableRowElement>(".cast-log-row--expandable").forEach((row) => {
    row.addEventListener("click", () => {
      const detail = row.nextElementSibling as HTMLTableRowElement | null;
      if (!detail?.classList.contains("cast-log-detail")) return;
      setCastLogRowExpanded(row, detail.hidden);
    });
  });
}

function spellRows(
  result: SimResult,
  spells?: Record<string, SpellFit>,
  stats?: CharacterStats,
): string[] {
  const maxShare = result.breakdown.reduce((peak, row) => Math.max(peak, row.share), 0);
  return result.breakdown.map((row) =>
    spellRow(
      row.name,
      {
        dps: row.dps,
        share: row.share,
        maxShare,
        averageHit: formatAverageHitCell(row),
        casts: row.casts.toFixed(1),
        normalHit: combatPercent(row.hits, row.casts),
        critHit: combatPercent(row.crits, row.casts),
        miss: combatPercent(row.misses, row.casts),
      },
      spells && stats ? spellFormulaHint(row.name, spells, stats) : null,
    ),
  );
}

function formatAverageHitCell(row: SimResult["breakdown"][number]): string {
  const averageHit = formatAverageHit(row.damage, row.hits, row.crits);
  const body = averageHitHintBody(row);
  if (!body) return averageHit;
  return `<span class="stats__hover spell-breakdown__avg-hit" data-hint-title="Average hit" data-hint-body="${escapeAttr(body)}" data-hint-compact tabindex="0">${averageHit}</span>`;
}

function averageHitHintBody(row: SimResult["breakdown"][number]): string | null {
  const landed = row.hits + row.crits;
  if (landed <= 0) return null;
  return [
    `Normal hit: ${formatAverageHitAmount(row.hitDamage, row.hits)}`,
    `Crit hit: ${formatAverageHitAmount(row.critDamage, row.crits)}`,
  ].join("\n\n");
}

function spellRow(
  name: string,
  row: {
    dps: number;
    share: number;
    maxShare: number;
    averageHit: string;
    casts: string;
    normalHit: string;
    critHit: string;
    miss: string;
  },
  formulaHint: ReturnType<typeof spellFormulaHint>,
): string {
  const nameCell = formulaHint
    ? `<span class="stats__hover spell-breakdown__name" data-hint-title="${escapeAttr(formulaHint.title)}" data-hint-body="${escapeAttr(formulaHint.formula)}" data-hint-eval="${escapeAttr(formulaHint.evaluatedHtml)}" data-hint-reminders="${escapeAttr(formulaHint.reminders.join("\n\n"))}" tabindex="0">${escapeHtml(name)}</span>`
    : escapeHtml(name);
  return `<tr>
    <td>${nameCell}</td>
    <td>${row.dps.toFixed(0)}</td>
    ${shareBarCell(row.share, row.maxShare)}
    <td>${row.averageHit}</td>
    <td>${row.casts}</td>
    <td>${row.normalHit}</td>
    <td>${row.critHit}</td>
    <td>${row.miss}</td>
  </tr>`;
}

function shareBarCell(share: number, maxShare: number): string {
  const pct = share * 100;
  const width = maxShare > 0 ? Math.max(0, Math.min(100, (share / maxShare) * 100)) : 0;
  const pctLabel = `${pct.toFixed(1)}%`;
  const label = `${pctLabel} of total DPS`;
  return `<td class="share-bar-cell">
    <div class="share-bar-wrap" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
      <span class="share-bar-pct">${pctLabel}</span>
      <div class="share-bar"><i style="width:${width.toFixed(2)}%"></i></div>
    </div>
  </td>`;
}

function histogram(samples: number[], meanDps: number, iterations: number): string {
  if (!samples.length) return "";
  const binCount = Math.min(20, Math.max(6, Math.round(Math.sqrt(samples.length))));
  const min = samples[0];
  const max = samples[samples.length - 1];
  const span = Math.max(1, max - min);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    low: min + (span * index) / binCount,
    high: min + (span * (index + 1)) / binCount,
    count: 0,
    sum: 0,
    firstRank: -1,
    lastRank: -1,
  }));
  for (let rank = 0; rank < samples.length; rank++) {
    const sample = samples[rank];
    const index = Math.min(binCount - 1, Math.floor(((sample - min) / span) * binCount));
    const bin = bins[index];
    bin.count += 1;
    bin.sum += sample;
    if (bin.firstRank < 0) bin.firstRank = rank;
    bin.lastRank = rank;
  }
  const peak = Math.max(...bins.map((bin) => bin.count), 1);

  const bars = bins
    .map((bin) => {
      const avg = bin.count ? bin.sum / bin.count : (bin.low + bin.high) / 2;
      const delta = avg - meanDps;
      const height = Math.max(3, (bin.count / peak) * 100);
      const pctLow = bin.count
        ? dpsValuePercentile(samples[bin.firstRank], max)
        : dpsValuePercentile(bin.low, max);
      const pctHigh = bin.count
        ? dpsValuePercentile(samples[bin.lastRank], max)
        : dpsValuePercentile(bin.high, max);
      const tip = [
        `${bin.low.toFixed(0)}–${bin.high.toFixed(0)} DPS`,
        formatPercentileRange(pctLow, pctHigh),
        `${bin.count} of ${iterations} sims`,
        `${signed(delta, 0)} DPS vs mean`,
      ].join(" · ");
      return `<div class="histogram__bar" data-tip="${escapeAttr(tip)}" tabindex="0" role="graphics-symbol" aria-label="${escapeAttr(tip)}">
        <div class="histogram__fill-wrap"><i class="histogram__fill" style="height:${height}%"></i></div>
        <span class="histogram__label">${formatDpsAxis(bin.low)}</span>
      </div>`;
    })
    .join("");

  return `<p class="hint histogram__intro">Each bar groups one iteration’s DPS outcome. This run: <strong>${iterations}</strong> sims, mean <strong>${meanDps.toFixed(0)}</strong> DPS. Hover a bar for range, percentile, count, and delta from mean.</p>
    <div class="histogram__plot">${bars}</div>`;
}

function formatDpsAxis(value: number): string {
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

function formatPercentileRange(low: number, high: number): string {
  const lo = Math.max(0, Math.min(100, low));
  const hi = Math.max(0, Math.min(100, high));
  const loLabel = lo.toFixed(0);
  const hiLabel = hi.toFixed(0);
  return loLabel === hiLabel ? `${loLabel}%` : `${loLabel}–${hiLabel}%`;
}

/** 0 DPS = 0%, top DPS in the run = 100%. */
function dpsValuePercentile(value: number, maxDps: number): number {
  if (maxDps <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maxDps) * 100));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function metric(label: string, value: number | null, digits = 0, suffix = ""): string {
  const text = value == null ? "—" : `${value.toFixed(digits)}${suffix}`;
  return `<div><span>${label}</span><strong>${text}</strong></div>`;
}

function signed(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function combatPercent(count: number, total: number): string {
  return total > 0 ? `${(count / total * 100).toFixed(1)}%` : "—";
}

function formatAverageHit(damage: number, hits: number, crits: number): string {
  const landed = hits + crits;
  return landed > 0 ? Math.round(damage / landed).toLocaleString() : "—";
}

function formatAverageHitAmount(damage: number, count: number): string {
  return count > 0 ? Math.round(damage / count).toLocaleString() : "—";
}

const EXPANDABLE_AURA_GROUPS: Array<{ name: string; stackCount: number }> = [
  { name: "Chaotic", stackCount: 3 },
  { name: "Reckoning", stackCount: 4 },
];

function stackUptimeKeys(name: string, stackCount: number): string[] {
  return Array.from({ length: stackCount }, (_, index) => {
    const stacks = index + 1;
    return `${name} (${stacks} stack${stacks === 1 ? "" : "s"})`;
  });
}

function stackUptimeLabels(stackCount: number): string[] {
  return Array.from({ length: stackCount }, (_, index) => {
    const stacks = index + 1;
    return `${stacks} stack${stacks === 1 ? "" : "s"}`;
  });
}

function isNestedAuraUptime(name: string): boolean {
  if (name === "Chaotic (avg stacks)" || name === "Reckoning (damage)") return true;
  return EXPANDABLE_AURA_GROUPS.some((group) => stackUptimeKeys(group.name, group.stackCount).includes(name));
}

function renderAuraUptimes(auras: SimResult["auraUptimes"]): string {
  const byName = new Map(auras.map((aura) => [aura.name, aura]));

  return auras
    .filter((aura) => !isNestedAuraUptime(aura.name))
    .map((aura) => {
      const group = EXPANDABLE_AURA_GROUPS.find((entry) => entry.name === aura.name);
      if (!group) return renderAuraUptimeRow(aura.name, aura.uptime);

      const stackRows: { label: string; uptime: number }[] = [];
      for (let index = 0; index < group.stackCount; index++) {
        const key = stackUptimeKeys(group.name, group.stackCount)[index];
        const stackAura = byName.get(key);
        if (stackAura) stackRows.push({ label: stackUptimeLabels(group.stackCount)[index], uptime: stackAura.uptime });
      }
      if (!stackRows.length) return renderAuraUptimeRow(aura.name, aura.uptime);
      return renderExpandableUptimeGroup(aura.name, aura.uptime, stackRows);
    })
    .join("");
}

function renderExpandableUptimeGroup(
  name: string,
  uptime: number,
  stacks: { label: string; uptime: number }[],
): string {
  return `<details class="uptime-group">
    <summary class="uptime-row uptime-row--expandable">
      <span class="uptime-row__lead">
        <span class="uptime-row__chevron" aria-hidden="true">▸</span>
        <span class="uptime-row__label">${escapeHtml(name)}</span>
      </span>
      ${renderAuraUptimeBar(uptime)}
    </summary>
    <div class="uptime-sublist">
      ${stacks.map((row) => renderAuraUptimeRow(row.label, row.uptime, true)).join("")}
    </div>
  </details>`;
}

function renderAuraUptimeRow(name: string, uptime: number, nested = false): string {
  const className = nested ? "uptime-row uptime-row--sub" : "uptime-row";
  return `<div class="${className}">${renderAuraUptimeCells(name, uptime, nested)}</div>`;
}

function renderAuraUptimeCells(name: string, uptime: number, nested = false): string {
  const labelClass = nested ? "uptime-row__label uptime-row__label--sub" : "uptime-row__label";
  return `<span class="${labelClass}">${escapeHtml(name)}</span>${renderAuraUptimeBar(uptime)}`;
}

function renderAuraUptimeBar(uptime: number): string {
  const width = Math.min(100, uptime * 100);
  return `<div class="uptime-track"><i style="width:${width.toFixed(1)}%"></i></div><strong>${(uptime * 100).toFixed(1)}%</strong>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char] || char);
}
