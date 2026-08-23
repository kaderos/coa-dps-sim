// ==UserScript==
// @name         CoA DPS Sim — Bisbeard Dump
// @namespace    https://github.com/matt/coa-dps-sim
// @version      1.0.0
// @description  Probe and dump coa.bisbeard.com IndexedDB, in-memory stores, and JSON API traffic for the Infernal DPS sim.
// @author       coa-dps-sim
// @match        https://coa.bisbeard.com/*
// @match        https://*.bisbeard.com/*
// @inject-into  page
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  "use strict";

  const MAX_NETWORK_BODIES = 80;
  const MAX_BODY_CHARS = 2_000_000;
  const INTERESTING_KEY =
    /item|spell|talent|enchant|stat|weight|gear|loot|db|store|redux|pinia|vuex|ember|ng|cache|catalog|character|build|mystic/i;

  const state = {
    network: [],
    lastResult: null,
  };

  const win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  installNetworkHooks(win);
  onReady(initUi);

  function installNetworkHooks(target) {
    const origFetch = target.fetch;
    if (typeof origFetch === "function") {
      target.fetch = function hookedFetch(input, init) {
        const url = stringifyUrl(input);
        const method = (init && init.method) || (input && input.method) || "GET";
        return origFetch.apply(this, arguments).then((res) => {
          captureResponse(url, method, res);
          return res;
        });
      };
    }

    const OrigXHR = target.XMLHttpRequest;
    if (!OrigXHR) return;
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      this.__coaDump = { method: method || "GET", url: String(url || "") };
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function () {
      this.addEventListener("load", function () {
        const meta = this.__coaDump || { method: "GET", url: "" };
        recordNetwork({
          url: meta.url,
          method: meta.method,
          status: this.status,
          contentType: this.getResponseHeader("content-type") || "",
          body: safeParseBody(this.responseText),
        });
      });
      return origSend.apply(this, arguments);
    };
  }

  function captureResponse(url, method, res) {
    try {
      const clone = res.clone();
      const contentType = clone.headers.get("content-type") || "";
      if (!/json|javascript|text\/plain/i.test(contentType) && !/json|\.js(\?|$)/i.test(url)) {
        recordNetwork({ url, method, status: clone.status, contentType, body: null, skipped: true });
        return;
      }
      clone.text().then((text) => {
        recordNetwork({
          url,
          method,
          status: clone.status,
          contentType,
          body: safeParseBody(text),
        });
      }).catch(() => {});
    } catch (_) {
      /* ignore opaque responses */
    }
  }

  function recordNetwork(entry) {
    if (state.network.length >= MAX_NETWORK_BODIES) return;
    const url = String(entry.url || "");
    if (/hot-update|sockjs|analytics|google-analytics|sentry|cloudflare/i.test(url)) return;
    state.network.push({
      ts: new Date().toISOString(),
      ...entry,
    });
    refreshPanelCounts();
  }

  function safeParseBody(text) {
    if (text == null) return null;
    const raw = String(text);
    if (raw.length > MAX_BODY_CHARS) {
      return { truncated: true, length: raw.length, preview: raw.slice(0, 2000) };
    }
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw.length > 4000 ? { textPreview: raw.slice(0, 2000), length: raw.length } : raw;
    }
  }

  function stringifyUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    try {
      return String(input);
    } catch (_) {
      return "";
    }
  }

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initUi() {
    injectPanel();
    if (typeof GM_registerMenuCommand === "function") {
      GM_registerMenuCommand("Bisbeard: Probe", () => runProbe().catch(showError));
      GM_registerMenuCommand("Bisbeard: Dump", () => runDump().catch(showError));
      GM_registerMenuCommand("Bisbeard: Download last result", downloadLast);
    }
  }

  function injectPanel() {
    if (document.getElementById("coa-bisbeard-dump-panel")) return;
    const panel = document.createElement("div");
    panel.id = "coa-bisbeard-dump-panel";
    panel.innerHTML = `
      <style>
        #coa-bisbeard-dump-panel {
          position: fixed; z-index: 2147483646; right: 12px; bottom: 12px;
          width: 340px; max-height: 70vh; overflow: auto;
          background: #1b1b22; color: #f3f3f7; font: 13px/1.4 Segoe UI, sans-serif;
          border: 1px solid #6c4cc4; border-radius: 10px; box-shadow: 0 8px 24px #000a;
        }
        #coa-bisbeard-dump-panel header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 10px; background: #2a2150; font-weight: 600;
        }
        #coa-bisbeard-dump-panel .body { padding: 8px 10px; }
        #coa-bisbeard-dump-panel button {
          background: #6c4cc4; color: #fff; border: 0; border-radius: 6px;
          padding: 6px 8px; margin: 0 6px 6px 0; cursor: pointer;
        }
        #coa-bisbeard-dump-panel button.secondary { background: #3a3a48; }
        #coa-bisbeard-dump-panel pre {
          white-space: pre-wrap; word-break: break-word; background: #111;
          padding: 8px; border-radius: 6px; max-height: 240px; overflow: auto;
        }
        #coa-bisbeard-dump-panel .muted { color: #bbb; }
      </style>
      <header>
        <span>Bisbeard dump</span>
        <button class="secondary" data-act="hide">hide</button>
      </header>
      <div class="body">
        <div class="muted" id="coa-dump-status">Wait for the Database to finish loading, then Probe.</div>
        <div style="margin: 8px 0;">
          <button data-act="probe">Probe</button>
          <button data-act="dump">Dump</button>
          <button class="secondary" data-act="download">Download last</button>
        </div>
        <div class="muted" id="coa-dump-counts"></div>
        <pre id="coa-dump-log">No probe yet.</pre>
      </div>
    `;
    document.documentElement.appendChild(panel);
    panel.addEventListener("click", (ev) => {
      const act = ev.target && ev.target.getAttribute && ev.target.getAttribute("data-act");
      if (act === "hide") panel.style.display = "none";
      if (act === "probe") runProbe().catch(showError);
      if (act === "dump") runDump().catch(showError);
      if (act === "download") downloadLast();
    });
    refreshPanelCounts();
  }

  function setStatus(text) {
    const el = document.getElementById("coa-dump-status");
    if (el) el.textContent = text;
  }

  function setLog(obj) {
    const el = document.getElementById("coa-dump-log");
    if (el) el.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }

  function showError(err) {
    const msg = err && err.stack ? err.stack : String(err);
    setStatus("Error");
    setLog(msg);
  }

  function refreshPanelCounts() {
    const el = document.getElementById("coa-dump-counts");
    if (el) el.textContent = `Captured JSON responses: ${state.network.length}`;
  }

  async function runProbe() {
    setStatus("Probing…");
    const probe = await buildProbe();
    state.lastResult = { kind: "probe", generatedAt: new Date().toISOString(), ...probe };
    downloadJson("bisbeard-probe.json", state.lastResult);
    setStatus("Probe saved as bisbeard-probe.json");
    setLog({
      origin: location.origin,
      indexedDB: summarizeIndexedDB(probe.indexedDB),
      localStorageKeys: probe.localStorage.keys,
      windowHits: probe.windowKeys.interesting,
      networkUrls: probe.network.map((n) => n.url).slice(0, 30),
    });
  }

  async function runDump() {
    setStatus("Dumping IndexedDB + captured network…");
    const probe = await buildProbe();
    const indexedDBData = await dumpAllIndexedDB();
    const dump = {
      kind: "dump",
      generatedAt: new Date().toISOString(),
      origin: location.origin,
      href: location.href,
      indexedDB: indexedDBData,
      localStorage: probe.localStorage,
      sessionStorage: probe.sessionStorage,
      windowSnapshot: snapshotWindow(win),
      network: state.network,
    };
    state.lastResult = dump;
    downloadJson("bisbeard-dump.json", dump);
    const perStore = splitIndexedDBFiles(indexedDBData);
    for (const file of perStore) {
      downloadJson(file.name, file.data);
    }
    setStatus(`Dump saved (${perStore.length + 1} files)`);
    setLog({
      databases: Object.keys(indexedDBData),
      files: ["bisbeard-dump.json", ...perStore.map((f) => f.name)],
    });
  }

  function downloadLast() {
    if (!state.lastResult) {
      setStatus("Nothing to download yet. Run Probe or Dump first.");
      return;
    }
    const name = state.lastResult.kind === "probe" ? "bisbeard-probe.json" : "bisbeard-dump.json";
    downloadJson(name, state.lastResult);
  }

  async function buildProbe() {
    const idbMeta = await listIndexedDBMeta();
    return {
      origin: location.origin,
      href: location.href,
      userAgent: navigator.userAgent,
      indexedDB: idbMeta,
      localStorage: dumpWebStorage(win.localStorage),
      sessionStorage: dumpWebStorage(win.sessionStorage),
      windowKeys: {
        allCount: countWindowKeys(win),
        interesting: interestingWindowKeys(win),
      },
      network: state.network.map((n) => ({
        ts: n.ts,
        method: n.method,
        url: n.url,
        status: n.status,
        contentType: n.contentType,
        skipped: n.skipped || false,
        bodyShape: describeShape(n.body),
      })),
    };
  }

  function countWindowKeys(target) {
    try {
      return Object.getOwnPropertyNames(target).length;
    } catch (_) {
      return 0;
    }
  }

  function interestingWindowKeys(target) {
    const hits = [];
    let names = [];
    try {
      names = Object.getOwnPropertyNames(target);
    } catch (_) {
      return hits;
    }
    for (const key of names) {
      if (!INTERESTING_KEY.test(key)) continue;
      let type = "unknown";
      try {
        type = target[key] == null ? "null" : typeof target[key];
      } catch (_) {
        type = "inaccessible";
      }
      hits.push({ key, type });
    }
    return hits.slice(0, 200);
  }

  function dumpWebStorage(storage) {
    const out = { keys: [], values: {} };
    if (!storage) return out;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        out.keys.push(key);
        if (!INTERESTING_KEY.test(key) && out.keys.length > 40) continue;
        const value = storage.getItem(key);
        out.values[key] = safeParseBody(value);
      }
    } catch (err) {
      out.error = String(err);
    }
    return out;
  }

  function snapshotWindow(target) {
    const snap = {};
    for (const key of interestingWindowKeys(target).map((h) => h.key)) {
      try {
        snap[key] = clonePlain(target[key], 0);
      } catch (err) {
        snap[key] = { error: String(err) };
      }
    }
    return snap;
  }

  function clonePlain(value, depth) {
    if (depth > 4) return "[max-depth]";
    if (value == null) return value;
    const t = typeof value;
    if (t === "function") return "[function]";
    if (t !== "object") return value;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.slice(0, 50).map((v) => clonePlain(v, depth + 1));
    }
    const out = {};
    const keys = Object.keys(value).slice(0, 80);
    for (const key of keys) {
      try {
        out[key] = clonePlain(value[key], depth + 1);
      } catch (_) {
        out[key] = "[unreadable]";
      }
    }
    return out;
  }

  async function listIndexedDBMeta() {
    const dbs = await listDatabases();
    const result = [];
    for (const dbInfo of dbs) {
      const name = dbInfo.name;
      const entry = { name, version: dbInfo.version, stores: [] };
      try {
        const db = await openDb(name);
        entry.version = db.version;
        for (const storeName of Array.from(db.objectStoreNames)) {
          const count = await countStore(db, storeName);
          const sample = await getStoreSample(db, storeName, 1);
          entry.stores.push({
            name: storeName,
            count,
            keyPath: sample.keyPath,
            sampleKeys: sample.keys,
            sampleShape: sample.records[0] ? describeShape(sample.records[0]) : null,
          });
        }
        db.close();
      } catch (err) {
        entry.error = String(err);
      }
      result.push(entry);
    }
    return result;
  }

  async function dumpAllIndexedDB() {
    const dbs = await listDatabases();
    const out = {};
    for (const dbInfo of dbs) {
      const name = dbInfo.name;
      out[name] = { version: dbInfo.version, stores: {} };
      try {
        const db = await openDb(name);
        out[name].version = db.version;
        for (const storeName of Array.from(db.objectStoreNames)) {
          out[name].stores[storeName] = await getStoreSample(db, storeName, 100000).then((s) => ({
            keyPath: s.keyPath,
            count: s.records.length,
            records: s.records,
          }));
        }
        db.close();
      } catch (err) {
        out[name].error = String(err);
      }
    }
    return out;
  }

  function splitIndexedDBFiles(indexedDBData) {
    const files = [];
    for (const [dbName, db] of Object.entries(indexedDBData || {})) {
      if (!db || !db.stores) continue;
      for (const [storeName, store] of Object.entries(db.stores)) {
        const safeDb = dbName.replace(/[^a-z0-9_-]+/gi, "_");
        const safeStore = storeName.replace(/[^a-z0-9_-]+/gi, "_");
        files.push({
          name: `bisbeard-${safeDb}-${safeStore}.json`,
          data: {
            database: dbName,
            store: storeName,
            keyPath: store.keyPath,
            count: store.count,
            records: store.records,
          },
        });
      }
    }
    return files;
  }

  async function listDatabases() {
    if (indexedDB.databases) {
      const listed = await indexedDB.databases();
      return (listed || []).filter((d) => d && d.name);
    }
    return [];
  }

  function openDb(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        /* do not change schema */
      };
    });
  }

  function countStore(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getStoreSample(db, storeName, limit) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const records = [];
      const keys = [];
      const req = store.openCursor();
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || records.length >= limit) {
          resolve({ keyPath: store.keyPath, records, keys });
          return;
        }
        keys.push(cursor.key);
        records.push(sanitizeRecord(cursor.value));
        cursor.continue();
      };
    });
  }

  function sanitizeRecord(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return clonePlain(value, 0);
    }
  }

  function describeShape(value) {
    if (value == null) return String(value);
    if (Array.isArray(value)) return `array(len=${value.length})`;
    if (typeof value === "object") return `object(keys=${Object.keys(value).slice(0, 12).join(",")})`;
    return typeof value;
  }

  function summarizeIndexedDB(meta) {
    return (meta || []).map((db) => ({
      name: db.name,
      stores: (db.stores || []).map((s) => `${s.name}:${s.count}`),
      error: db.error || null,
    }));
  }

  function downloadJson(filename, data) {
    const json = JSON.stringify(data);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
})();
