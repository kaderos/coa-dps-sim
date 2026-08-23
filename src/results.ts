import type { SimResult } from "./types";

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
  actions: { onPin: () => void; onUnpin: () => void },
) {
  const root = document.getElementById("gear-sim-summary");
  if (!root) return;
  if (!current) {
    root.innerHTML = `
      <div class="gear-sim__head">
        <h3>Sim</h3>
      </div>
      <p class="hint">Run a simulation to pin a result and compare the next run here.</p>`;
    return;
  }

  const comparing = Boolean(pinned && pinned !== current);
  root.innerHTML = `
    <div class="gear-sim__head">
      <h3>${comparing ? "vs pinned" : pinned ? "Pinned" : "Latest"}</h3>
      ${pinned
        ? `<button class="text-button" id="gear-sim-unpin" type="button">Unpin</button>`
        : `<button class="text-button" id="gear-sim-pin" type="button">Pin</button>`}
    </div>
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
    ${comparing ? `<p class="hint">Pinned ${pinned!.meanDps.toFixed(0)} DPS. Next run updates the comparison.</p>` : `<p class="hint">Pin this result, change gear, then simulate again.</p>`}
  `;
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

export function renderResults(result: SimResult) {
  const root = document.getElementById("results");
  if (!root) return;
  const baseline = result.logBaseline;
  const delta = result.logDeltaPct == null
    ? "No log baseline yet."
    : baseline
      ? `<a href="${escapeHtml(baseline.url)}" target="_blank" rel="noreferrer">${escapeHtml(baseline.player)} · ${escapeHtml(baseline.encounter)} ${escapeHtml(baseline.durationLabel)}</a> baseline ${result.logDps?.toFixed(0)} DPS (${signed(result.logDeltaPct)}%)${baseline.modeledDps ? ` · ${baseline.modeledDps.toFixed(0)} modeled` : ""}.`
      : `Log baseline ${result.logDps?.toFixed(0)} DPS (${signed(result.logDeltaPct)}%).`;

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
      <div class="compare">Level ${result.bossLevel} raid boss · stationary fight (no movement, no cleave) · ${result.durationSec}s ±5%. ${delta}</div>
    </div>
    <section class="result-section">
      <h3>DPS distribution</h3>
      <div class="histogram" aria-label="DPS sample histogram">${histogram(result.dpsSamples)}</div>
    </section>
    <section class="result-section">
      <h3>Spell breakdown</h3>
      ${baseline?.abilities?.length ? `<div class="hint">Sim vs ${escapeHtml(baseline.player)} ${escapeHtml(baseline.durationLabel)}. Unmodeled log lines stay in the baseline total.</div>` : ""}
      <div class="table-scroll"><table>
        <thead><tr><th>Spell</th><th>Casts</th><th>DPS</th>${baseline?.abilities?.length ? "<th>Log DPS</th><th>Δ DPS</th>" : ""}<th>Share</th>${baseline?.abilities?.length ? "<th>Log share</th>" : ""}<th>Normal</th><th>Critical</th><th>Misses</th></tr></thead>
        <tbody>${spellRows(result).join("")}</tbody>
      </table></div>
    </section>
    ${result.auraUptimes.length ? `
      <section class="result-section">
        <h3>Aura uptime</h3>
        <div class="uptime-list">${result.auraUptimes.map((aura) => `
          <div><span>${escapeHtml(aura.name)}</span><div class="uptime-track"><i style="width:${Math.min(100, aura.uptime * 100)}%"></i></div><strong>${(aura.uptime * 100).toFixed(1)}%</strong></div>
        `).join("")}</div>
      </section>` : ""}
    ${logPlayByPlay(baseline)}
    <section class="result-section">
      <div class="result-section__heading">
        <div>
          <h3>Sim cast log</h3>
          <div class="hint">First seed only · ${result.castEvents.length} events</div>
        </div>
        <button class="text-button" id="download-cast-log" type="button">Download JSON</button>
      </div>
      <div class="table-scroll cast-log"><table>
        <thead><tr><th>Time</th><th>Spell</th><th>Result</th><th>Damage</th><th>Energy</th><th>Felfury</th></tr></thead>
        <tbody>${result.castEvents.map((event) => `
          <tr>
            <td>${event.timestamp.toFixed(2)}s</td>
            <td>${escapeHtml(event.spell)}</td>
            <td class="cast-result cast-result--${event.result}">${event.result}</td>
            <td>${event.damage.toFixed(0)}</td>
            <td>${event.energy.toFixed(1)}</td>
            <td>${event.felfury.toFixed(1)}</td>
          </tr>`).join("")}</tbody>
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
}

function logPlayByPlay(baseline: SimResult["logBaseline"]): string {
  const casts = baseline?.casts;
  if (!casts?.events.length) return "";
  const counts = Object.entries(casts.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${escapeHtml(name)}`)
    .join(" · ");
  const href = baseline?.eventsUrl || casts.url;
  return `
    <section class="result-section">
      <div class="result-section__heading">
        <div>
          <h3>Log play-by-play</h3>
          <div class="hint"><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(casts.player)} · ${escapeHtml(casts.encounter)}</a> · ${casts.events.length} casts · ${counts}</div>
        </div>
      </div>
      <div class="table-scroll cast-log"><table>
        <thead><tr><th>Time</th><th>Spell</th><th>Target</th></tr></thead>
        <tbody>${casts.events.map((event) => `
          <tr>
            <td>${event.t.toFixed(2)}s</td>
            <td>${escapeHtml(event.spell)}</td>
            <td>${event.target ? escapeHtml(event.target) : "—"}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

function spellRows(result: SimResult): string[] {
  const abilities = result.logBaseline?.abilities || [];
  const byLog = new Map(abilities.map((row) => [row.name, row]));
  const seen = new Set<string>();
  const rows: string[] = [];

  for (const row of result.breakdown) {
    const log = byLog.get(row.name);
    if (log) seen.add(row.name);
    rows.push(spellRow(row.name, {
      casts: row.casts.toFixed(1),
      dps: row.dps,
      share: row.share,
      log,
      hits: combatCount(row.hits, row.hits + row.crits + row.misses),
      crits: combatCount(row.crits, row.hits + row.crits + row.misses),
      misses: combatCount(row.misses, row.hits + row.crits + row.misses),
      compare: abilities.length > 0,
    }));
  }

  for (const log of abilities) {
    if (seen.has(log.name)) continue;
    rows.push(spellRow(log.name, {
      casts: log.casts ? String(log.casts) : "—",
      dps: null,
      share: null,
      log,
      hits: "—",
      crits: log.hits ? `${log.critPct.toFixed(1)}% crit` : "—",
      misses: "—",
      compare: true,
      unmodeled: !log.modeled,
    }));
  }

  return rows;
}

function spellRow(name: string, row: {
  casts: string;
  dps: number | null;
  share: number | null;
  log?: { dps: number; share: number } | null;
  hits: string;
  crits: string;
  misses: string;
  compare: boolean;
  unmodeled?: boolean;
}): string {
  const delta = row.dps != null && row.log ? row.dps - row.log.dps : null;
  const deltaClass = delta == null ? "" : delta >= 0 ? "delta-pos" : "delta-neg";
  return `<tr${row.unmodeled ? ' class="unmodeled"' : ""}>
    <td>${escapeHtml(name)}</td>
    <td>${row.casts}</td>
    <td>${row.dps == null ? "—" : row.dps.toFixed(0)}</td>
    ${row.compare ? `<td>${row.log ? row.log.dps.toFixed(0) : "—"}</td><td class="${deltaClass}">${delta == null ? "—" : signed(delta, 0)}</td>` : ""}
    <td>${row.share == null ? "—" : `${(row.share * 100).toFixed(1)}%`}</td>
    ${row.compare ? `<td>${row.log ? `${(row.log.share * 100).toFixed(1)}%` : "—"}</td>` : ""}
    <td>${row.hits}</td>
    <td>${row.crits}</td>
    <td>${row.misses}</td>
  </tr>`;
}

function histogram(samples: number[]): string {
  if (!samples.length) return "";
  const binCount = Math.min(20, Math.max(6, Math.round(Math.sqrt(samples.length))));
  const min = samples[0];
  const max = samples[samples.length - 1];
  const span = Math.max(1, max - min);
  const bins = Array.from({ length: binCount }, () => 0);
  for (const sample of samples) {
    const index = Math.min(binCount - 1, Math.floor(((sample - min) / span) * binCount));
    bins[index]++;
  }
  const peak = Math.max(...bins, 1);
  return bins.map((count, index) => {
    const low = min + (span * index) / binCount;
    const high = min + (span * (index + 1)) / binCount;
    return `<i style="height:${Math.max(3, count / peak * 100)}%" title="${low.toFixed(0)}–${high.toFixed(0)} DPS: ${count} iterations"></i>`;
  }).join("");
}

function metric(label: string, value: number, digits = 0): string {
  return `<div><span>${label}</span><strong>${value.toFixed(digits)}</strong></div>`;
}

function signed(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function combatCount(count: number, total: number): string {
  return total > 0 ? `${count.toFixed(1)} (${(count / total * 100).toFixed(1)}%)` : "—";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char] || char);
}
