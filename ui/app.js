// app.js
//
// Entry point: fetches the manifest + trace files, owns playback state
// (play/pause/step/scrub), and wires up all the DOM chrome around the
// graph (stats bar, round log, node detail panel, theme toggle). All
// graph-specific rendering/layout/animation lives in graph-view.js /
// force-layout.js — this file is the "controller."

(function () {
  "use strict";

  const ROUND_INTERVAL_MS = 1000; // within the 900-1200ms spec range
  const THEME_KEY = "gossiprag-theme";

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- DOM refs ----------------------------------------------------------

  const scenarioSelect = document.getElementById("scenarioSelect");
  const themeToggle = document.getElementById("themeToggle");
  const errorBanner = document.getElementById("errorBanner");
  const errorBannerText = document.getElementById("errorBannerText");

  const scenarioTitleEl = document.getElementById("scenarioTitle");
  const scenarioDescEl = document.getElementById("scenarioDesc");
  const scenarioClaimEl = document.getElementById("scenarioClaim");
  const scenarioCaptionEl = document.getElementById("scenarioCaption");

  const roundValueEl = document.getElementById("roundValue");
  const convergenceValueEl = document.getElementById("convergenceValue");
  const trendValueEl = document.getElementById("trendValue");

  const graphCanvas = document.getElementById("graphCanvas");
  const graphLoading = document.getElementById("graphLoading");
  const revealBtn = document.getElementById("revealBtn");

  const stepBackBtn = document.getElementById("stepBackBtn");
  const playBtn = document.getElementById("playBtn");
  const playIcon = document.getElementById("playIcon");
  const pauseIcon = document.getElementById("pauseIcon");
  const stepFwdBtn = document.getElementById("stepFwdBtn");
  const scrubInput = document.getElementById("scrubInput");
  const transportRoundLabel = document.getElementById("transportRoundLabel");

  const roundLogList = document.getElementById("roundLogList");
  const detailCloseBtn = document.getElementById("detailCloseBtn");
  const detailBody = document.getElementById("detailBody");

  // ---- small DOM helpers --------------------------------------------------

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // ---- state ---------------------------------------------------------

  let manifest = [];
  let currentTrace = null;
  let isPlaying = false;
  let playTimer = null;
  let loadToken = 0;
  let displayedConvergence = 0;
  let convergenceToken = 0;
  let revealOn = false;

  const graphView = window.GossipRAG.createGraphView(graphCanvas, {
    onSelect: function () {
      renderDetailPanel();
    },
  });

  // ---- error / loading UI ----------------------------------------------

  function showError(msg) {
    errorBannerText.textContent = msg;
    errorBanner.hidden = false;
  }
  function hideError() {
    errorBanner.hidden = true;
  }
  function setLoading(on) {
    graphLoading.hidden = !on;
  }
  function friendlyFetchError(err) {
    return (
      "Couldn't load trace data (" +
      err.message +
      "). This viewer must be served over HTTP, not opened directly as a file. " +
      "From the gossip-rag repo root, run: python3 -m http.server 8000 — then open " +
      "http://localhost:8000/ui/ in your browser."
    );
  }

  // ---- manifest / scenario loading ----------------------------------------

  async function init() {
    try {
      const res = await fetch("../traces/manifest.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      manifest = await res.json();
    } catch (err) {
      showError(friendlyFetchError(err));
      setLoading(false);
      return;
    }

    if (!Array.isArray(manifest) || manifest.length === 0) {
      showError("No scenarios listed in traces/manifest.json.");
      setLoading(false);
      return;
    }

    scenarioSelect.replaceChildren(
      ...manifest.map((entry) => {
        const opt = document.createElement("option");
        opt.value = entry.file;
        opt.textContent = entry.title || entry.id;
        return opt;
      })
    );

    await loadScenarioFile(manifest[0].file);
  }

  async function loadScenarioFile(file) {
    const token = ++loadToken;
    pausePlayback();
    setLoading(true);
    try {
      const res = await fetch("../traces/" + file);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const trace = await res.json();
      if (token !== loadToken) return; // superseded by a newer scenario pick

      currentTrace = trace;
      graphView.loadTrace(trace);
      updateMetaHeader(trace);
      afterRoundChange();
      hideError();
    } catch (err) {
      if (token !== loadToken) return;
      showError(friendlyFetchError(err));
    } finally {
      if (token === loadToken) setLoading(false);
    }
  }

  function updateMetaHeader(trace) {
    scenarioTitleEl.textContent = trace.meta.title;
    scenarioDescEl.textContent = trace.meta.description;
    scenarioClaimEl.replaceChildren(
      el("b", null, "claim — "),
      trace.claim.question + "   ",
      el("span", "truth", "truth: " + trace.claim.truth_value),
      "   ·   ",
      el("span", "corrupted", "corrupted: " + trace.claim.corrupted_value)
    );
    scenarioCaptionEl.textContent =
      "// " +
      trace.nodes.length +
      " nodes · " +
      trace.rounds.length +
      " round snapshots (0–" +
      (trace.rounds.length - 1) +
      ") · seed " +
      trace.meta.seed;
  }

  scenarioSelect.addEventListener("change", () => {
    loadScenarioFile(scenarioSelect.value);
  });

  // ---- central "round changed" refresh -----------------------------------

  function afterRoundChange() {
    if (!currentTrace) return;
    const idx = graphView.getRoundIndex();
    const lastIdx = currentTrace.rounds.length - 1;
    const round = currentTrace.rounds[idx];

    roundValueEl.textContent = idx + " / " + lastIdx;
    transportRoundLabel.textContent = idx + " / " + lastIdx;
    scrubInput.max = String(lastIdx);
    scrubInput.value = String(idx);

    setConvergence(round.convergence_pct);
    renderTrend(idx);
    renderRoundLog(idx);
    renderDetailPanel();

    stepBackBtn.disabled = idx === 0;
    stepFwdBtn.disabled = idx === lastIdx;

    graphCanvas.setAttribute(
      "aria-label",
      "Gossip network graph, round " +
        idx +
        " of " +
        lastIdx +
        ", convergence " +
        round.convergence_pct.toFixed(1) +
        " percent"
    );
  }

  function setConvergence(target) {
    const token = ++convergenceToken;
    const from = displayedConvergence;
    const start = performance.now();
    const duration = prefersReducedMotion ? 1 : 400;
    function step(now) {
      if (token !== convergenceToken) return;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (target - from) * eased;
      convergenceValueEl.textContent = val.toFixed(1) + "%";
      displayedConvergence = val;
      if (t < 1) requestAnimationFrame(step);
      else displayedConvergence = target;
    }
    requestAnimationFrame(step);
  }

  function renderTrend(idx) {
    if (idx === 0) {
      trendValueEl.textContent = "—";
      trendValueEl.className = "trend trend--neutral";
      return;
    }
    const cur = currentTrace.rounds[idx].convergence_pct;
    const prev = currentTrace.rounds[idx - 1].convergence_pct;
    const delta = cur - prev;
    if (Math.abs(delta) < 0.05) {
      trendValueEl.textContent = "— 0.0";
      trendValueEl.className = "trend trend--neutral";
    } else if (delta > 0) {
      trendValueEl.textContent = "▲ +" + delta.toFixed(1);
      trendValueEl.className = "trend trend--up";
    } else {
      trendValueEl.textContent = "▼ " + delta.toFixed(1);
      trendValueEl.className = "trend trend--down";
    }
  }

  function renderRoundLog(idx) {
    const round = currentTrace.rounds[idx];
    roundLogList.replaceChildren();
    if (!round.events.length) {
      roundLogList.appendChild(
        el(
          "li",
          "round-log__empty",
          idx === 0 ? "// initial state — no exchanges yet" : "// no exchanges this round"
        )
      );
      return;
    }
    round.events.forEach((ev) => {
      const li = document.createElement("li");
      li.className = "round-log__item";
      li.appendChild(el("span", "round-log__edge", ev.from + " → " + ev.to));
      li.appendChild(el("span", "round-log__outcome", 'sent "' + ev.claim_value_sent + '" — ' + ev.outcome));
      roundLogList.appendChild(li);
    });
  }

  // ---- node detail panel --------------------------------------------------

  function buildMeterRow(label, value01, opts) {
    opts = opts || {};
    const row = el("div", "meter-row");
    const top = el("div", "meter-row__top");
    top.appendChild(el("span", "detail-label", label));
    top.appendChild(el("span", "meter-row__value", Math.round(clamp01(value01) * 100) + "%"));
    row.appendChild(top);
    const meter = el("div", "meter");
    const fill = el("div", "meter__fill");
    fill.style.width = clamp01(value01) * 100 + "%";
    if (opts.tiered) {
      fill.style.background = value01 >= 0.7 ? "var(--accent)" : value01 >= 0.4 ? "var(--amber)" : "var(--red)";
    }
    meter.appendChild(fill);
    row.appendChild(meter);
    return row;
  }

  function renderDetailPanel() {
    const id = graphView.getSelectedId();
    detailCloseBtn.hidden = !id;

    if (!id || !currentTrace) {
      detailBody.replaceChildren(el("p", "detail-empty", "// click a node to inspect its belief state"));
      return;
    }

    const snap = graphView.getNodeSnapshot(id);
    if (!snap) {
      detailBody.replaceChildren(el("p", "detail-empty", "// node not found"));
      return;
    }

    const frag = document.createDocumentFragment();

    const idRow = el("div", "detail-id-row");
    idRow.appendChild(el("span", "detail-id", snap.label || snap.id));
    idRow.appendChild(el("span", "detail-role", "role · " + snap.role));
    frag.appendChild(idRow);

    const valueBlock = el("div", "detail-value-block");
    valueBlock.appendChild(el("span", "detail-label", "current belief"));
    const badge = el("span", "badge");
    if (snap.value == null) {
      badge.classList.add("badge--gray");
      badge.textContent = "— uninformed —";
    } else if (currentTrace.claim && snap.value === currentTrace.claim.truth_value) {
      badge.classList.add("badge--green");
      badge.textContent = snap.value;
    } else {
      badge.classList.add("badge--red");
      badge.textContent = snap.value;
    }
    valueBlock.appendChild(badge);
    frag.appendChild(valueBlock);

    frag.appendChild(buildMeterRow("confidence", snap.confidence));
    frag.appendChild(buildMeterRow("trust", snap.trust, { tiered: true }));

    const provWrap = el("div", "detail-value-block");
    provWrap.appendChild(el("span", "detail-label", "provenance"));
    const ol = document.createElement("ol");
    ol.className = "provenance-list";
    if (!snap.provenance.length) {
      ol.appendChild(el("li", null, "(none yet)"));
    } else {
      snap.provenance.forEach((p, i) => {
        const li = document.createElement("li");
        li.appendChild(el("span", "idx", String(i + 1).padStart(2, "0")));
        li.appendChild(el("span", null, p));
        ol.appendChild(li);
      });
    }
    provWrap.appendChild(ol);
    frag.appendChild(provWrap);

    if (snap.shardDocIds && snap.shardDocIds.length) {
      const docsWrap = el("div", "detail-value-block");
      docsWrap.appendChild(el("span", "detail-label", "local document shards"));
      const docsList = el("div", "detail-docs");
      snap.shardDocIds.forEach((docId) => {
        const doc = currentTrace.documents && currentTrace.documents[docId];
        const text = doc ? docId + ' — "' + doc.title + '"' : docId;
        docsList.appendChild(el("span", "detail-docs__item", text));
      });
      docsWrap.appendChild(docsList);
      frag.appendChild(docsWrap);
    }

    detailBody.replaceChildren(frag);
  }

  detailCloseBtn.addEventListener("click", () => {
    graphView.selectNode(null);
  });

  // ---- playback controls --------------------------------------------------

  function stepForward() {
    if (!currentTrace) return;
    pausePlayback();
    graphView.gotoRound(graphView.getRoundIndex() + 1);
    afterRoundChange();
  }

  function stepBack() {
    if (!currentTrace) return;
    pausePlayback();
    graphView.gotoRound(graphView.getRoundIndex() - 1);
    afterRoundChange();
  }

  function scrubTo(idx) {
    if (!currentTrace) return;
    pausePlayback();
    graphView.gotoRound(idx);
    afterRoundChange();
  }

  function startPlayback() {
    if (!currentTrace || isPlaying) return;
    if (graphView.getRoundIndex() >= currentTrace.rounds.length - 1) {
      graphView.gotoRound(0); // restart from the top
      afterRoundChange();
    }
    isPlaying = true;
    updatePlayButton();
    playTimer = setInterval(() => {
      const next = graphView.getRoundIndex() + 1;
      if (next > currentTrace.rounds.length - 1) {
        pausePlayback();
        return;
      }
      graphView.gotoRound(next);
      afterRoundChange();
    }, ROUND_INTERVAL_MS);
  }

  function pausePlayback() {
    isPlaying = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    updatePlayButton();
  }

  function togglePlay() {
    if (isPlaying) pausePlayback();
    else startPlayback();
  }

  function updatePlayButton() {
    playIcon.hidden = isPlaying;
    pauseIcon.hidden = !isPlaying;
    playBtn.setAttribute("aria-pressed", String(isPlaying));
    playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
  }

  stepBackBtn.addEventListener("click", stepBack);
  stepFwdBtn.addEventListener("click", stepForward);
  playBtn.addEventListener("click", togglePlay);
  scrubInput.addEventListener("input", () => scrubTo(Number(scrubInput.value)));

  revealBtn.addEventListener("click", () => {
    revealOn = !revealOn;
    revealBtn.setAttribute("aria-pressed", String(revealOn));
    graphView.setRevealRoles(revealOn);
  });

  // ---- theme toggle --------------------------------------------------

  function getTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* localStorage unavailable — theme just won't persist across reloads */
    }
    graphView.refreshTheme();
  }
  function toggleTheme() {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  }
  themeToggle.addEventListener("click", toggleTheme);

  // ---- keyboard shortcuts --------------------------------------------------

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight") {
      stepForward();
    } else if (e.key === "ArrowLeft") {
      stepBack();
    } else if (e.key.toLowerCase() === "t") {
      toggleTheme();
    }
  });

  // ---- go --------------------------------------------------

  init();
})();
