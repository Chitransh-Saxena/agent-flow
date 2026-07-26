// app.js
//
// The agentic-workflow player. A workflow is a list of `columns`, left to
// right. A column with one stage runs on its own; a column with several stages
// runs them IN PARALLEL — the rail fans out into it and merges back out, every
// branch's packet fires at once, and the column's wall-clock cost is the
// slowest branch (max), not the sum. So playback makes the difference between
// sequential and parallel execution visible, not just decorative.
//
// Alongside the run, the "under the hood" panel shows each active stage's real
// algorithm/protocol and the libraries that actually implement it — so it
// teaches what's happening, instead of being a slideshow.
//
// No canvas: the board is DOM + an SVG overlay for the connectors, so the icons
// stay crisp and the motion stays smooth.

(function () {
  "use strict";

  const WF = window.GRW.WORKFLOWS;
  const ICONS = window.GRW.ICONS;
  const SVGNS = "http://www.w3.org/2000/svg";
  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- DOM refs ----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const workflowSelect = $("workflowSelect");
  const themeToggle = $("themeToggle");
  const wfTitle = $("wfTitle");
  const wfSubtitle = $("wfSubtitle");
  const pipelineEl = $("pipeline");
  const consoleBody = $("consoleBody");
  const consoleMeta = $("consoleMeta");
  const uthBody = $("uthBody");
  const uthMode = $("uthMode");
  const mStep = $("mStep");
  const mTokens = $("mTokens");
  const mElapsed = $("mElapsed");
  const mStatus = $("mStatus");
  const playBtn = $("playBtn");
  const stepBackBtn = $("stepBackBtn");
  const stepFwdBtn = $("stepFwdBtn");
  const scrubInput = $("scrubInput");
  const stepLabel = $("transportStepLabel");

  // ---- state -------------------------------------------------------------
  let wf = null; // current workflow
  let columns = []; // [[stage,...], ...]
  let stages = []; // flat list; each carries ._col, ._el
  let cursor = 0; // columns executed [0..C]
  let playing = false;
  let playTimer = null;
  let svg = null; // connector overlay
  let edgeLayer = null; // <g> of edge paths
  let packetLayer = null; // <g> where flying packets live
  let edges = []; // { l, r, path } — l/r are stages, path is the <path> el
  let typeToken = 0; // cancels an in-flight typewriter

  // ---- helpers -----------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function svgEl(tag, cls) {
    const e = document.createElementNS(SVGNS, tag);
    if (cls) e.setAttribute("class", cls);
    return e;
  }
  function svgIcon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.robot}</svg>`;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  const colMs = (col) => col.reduce((m, s) => Math.max(m, s.ms || 0), 0); // parallel → max
  const colTokens = (col) => col.reduce((t, s) => t + (s.tokens || 0), 0); // → sum
  const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

  // ---- build the board for a workflow ------------------------------------
  function buildPipeline() {
    pipelineEl.replaceChildren();

    // SVG overlay for the fan-out / fan-in connectors, behind the cards
    svg = svgEl("svg", "pipe-svg");
    svg.setAttribute("preserveAspectRatio", "none");
    edgeLayer = svgEl("g", "pipe-svg__edges");
    packetLayer = svgEl("g", "pipe-svg__packets");
    svg.appendChild(edgeLayer);
    svg.appendChild(packetLayer);
    pipelineEl.appendChild(svg);

    stages = [];
    columns.forEach((col, ci) => {
      const parallel = col.length > 1;
      const colEl = el("div", "pipe-col" + (parallel ? " pipe-col--parallel" : ""));
      if (parallel) {
        colEl.appendChild(el("span", "pipe-col__tag", "&#8741; parallel &times;" + col.length));
      }
      col.forEach((stage) => {
        const card = el("div", "stage is-pending");
        card.appendChild(el("div", "stage__icon", svgIcon(stage.icon)));
        card.appendChild(el("div", "stage__label", stage.label));
        card.appendChild(el("div", "stage__step", pad2(ci + 1)));
        card.addEventListener("click", () => {
          pause();
          goto(ci + 1, { snap: true });
        });
        colEl.appendChild(card);
        stage._col = ci;
        stage._el = card;
        stages.push(stage);
      });
      pipelineEl.appendChild(colEl);
    });

    // one edge per (stage in col i) -> (stage in col i+1): 1->N is a fan-out,
    // N->1 a fan-in, 1->1 a straight hop.
    edges = [];
    for (let i = 0; i < columns.length - 1; i++) {
      columns[i].forEach((l) => {
        columns[i + 1].forEach((r) => {
          const path = svgEl("path", "edge");
          edgeLayer.appendChild(path);
          edges.push({ l, r, path });
        });
      });
    }

    requestAnimationFrame(measure);
  }

  // ---- geometry: place the connectors ------------------------------------
  function iconGeom(stage) {
    const prect = pipelineEl.getBoundingClientRect();
    const icon = stage._el.querySelector(".stage__icon");
    const r = icon.getBoundingClientRect();
    return {
      cx: r.left - prect.left + r.width / 2,
      cy: r.top - prect.top + r.height / 2,
      rad: r.width / 2,
    };
  }
  function edgePath(l, r) {
    const a = iconGeom(l);
    const b = iconGeom(r);
    const x1 = a.cx + a.rad + 2;
    const y1 = a.cy;
    const x2 = b.cx - b.rad - 2;
    const y2 = b.cy;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  }
  function measure() {
    if (!stages.length || !svg) return;
    const w = pipelineEl.clientWidth;
    const h = pipelineEl.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    edges.forEach((e) => e.path.setAttribute("d", edgePath(e.l, e.r)));
    updateEdges();
  }

  // ---- render visual state for the current cursor ------------------------
  function applyStageStates() {
    const activeCol = cursor - 1; // most-recent column
    const finished = cursor >= columns.length;
    stages.forEach((s) => {
      s._el.classList.remove("is-pending", "is-active", "is-done");
      if (s._col < activeCol) s._el.classList.add("is-done");
      else if (s._col === activeCol) s._el.classList.add(finished ? "is-done" : "is-active");
      else s._el.classList.add("is-pending");
    });
  }
  function updateEdges() {
    // an edge is "lit" once the column it feeds into has executed
    edges.forEach((e) => e.path.classList.toggle("is-lit", e.r._col < cursor));
  }

  // ---- packets: fire one down every edge feeding a column ----------------
  function firePackets(colIndex) {
    if (prefersReducedMotion || colIndex <= 0) return;
    const feed = edges.filter((e) => e.r._col === colIndex && e.l._col === colIndex - 1);
    feed.forEach((e) => animatePacket(e.path));
  }
  function animatePacket(path) {
    const len = path.getTotalLength();
    if (!len) return;
    const dot = svgEl("circle", "pipe-packet");
    dot.setAttribute("r", "4.5");
    packetLayer.appendChild(dot);
    const dur = 520;
    const start = performance.now();
    function frame(now) {
      const t = clamp((now - start) / dur, 0, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const p = path.getPointAtLength(eased * len);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("opacity", t < 0.12 ? String(t / 0.12) : t > 0.88 ? String((1 - t) / 0.12) : "1");
      if (t < 1) requestAnimationFrame(frame);
      else dot.remove();
    }
    requestAnimationFrame(frame);
  }
  function pulseColumn(colIndex) {
    columns[colIndex].forEach((s) => {
      const icon = s._el.querySelector(".stage__icon");
      s._el.classList.remove("stage--pulse");
      void s._el.offsetWidth;
      s._el.classList.add("stage--pulse");
    });
  }

  // ---- agent console -----------------------------------------------------
  let pendingType = null; // an in-flight typewriter, so we can finish it early
  function finishPending() {
    if (!pendingType) return;
    const p = pendingType;
    pendingType = null;
    typeToken++;
    p.target.textContent = "“" + p.text + "”";
    if (p.cursorEl) p.cursorEl.remove();
  }
  function appendStageLog(stage, opts) {
    opts = opts || {};
    finishPending();
    const hint = consoleBody.querySelector(".console__hint");
    if (hint) hint.remove();
    const line = el("div", "logline");
    if (stage.done) line.classList.add("logline--done");
    line.appendChild(el("span", "logline__stage", stage.label));
    const body = el("span", "logline__body");
    body.textContent = stage.log;
    line.appendChild(body);
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;

    if (stage.stream && !opts.instant && !prefersReducedMotion) {
      const gen = el("div", "logline__gen");
      const gentext = el("span", "logline__gentext");
      const cur = el("span", "logline__cursor");
      gen.appendChild(gentext);
      gen.appendChild(cur);
      line.appendChild(gen);
      typewrite(gentext, stage.stream, cur);
    } else if (stage.stream) {
      const gen = el("div", "logline__gen");
      gen.appendChild(el("span", "logline__gentext", "“" + stage.stream + "”"));
      line.appendChild(gen);
    }
  }
  function appendColumnLogs(colIndex, opts) {
    const col = columns[colIndex];
    if (col.length > 1) {
      const head = el("div", "logline logline--fork");
      head.appendChild(el("span", "logline__fork", "&#8741; " + col.length + " agents in parallel &middot; wall-clock = slowest branch"));
      consoleBody.appendChild(head);
    }
    col.forEach((s) => appendStageLog(s, opts));
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }
  function typewrite(target, text, cursorEl) {
    const myToken = ++typeToken;
    pendingType = { target, text, cursorEl };
    target.textContent = "“";
    let i = 0;
    const speed = clamp(1200 / text.length, 14, 45);
    function tick() {
      if (myToken !== typeToken) return;
      i++;
      target.textContent = "“" + text.slice(0, i) + (i < text.length ? "" : "”");
      consoleBody.scrollTop = consoleBody.scrollHeight;
      if (i < text.length) setTimeout(tick, speed);
      else {
        if (cursorEl) cursorEl.remove();
        if (pendingType && pendingType.target === target) pendingType = null;
      }
    }
    setTimeout(tick, speed);
  }
  function rebuildConsole(uptoCol) {
    typeToken++;
    consoleBody.replaceChildren();
    for (let i = 0; i < uptoCol; i++) appendColumnLogs(i, { instant: true });
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  // ---- "under the hood" learning panel -----------------------------------
  function renderDetail() {
    const activeCol = cursor - 1;
    uthBody.replaceChildren();
    if (activeCol < 0) {
      uthMode.textContent = "";
      uthBody.appendChild(el("div", "uth__hint", "// press play — each step explains the real algorithm & libraries behind it"));
      return;
    }
    const col = columns[activeCol];
    const parallel = col.length > 1;
    uthMode.textContent = parallel ? "parallel · " + col.length + " agents · time = max(branches)" : "sequential step";
    uthMode.className = "console__meta " + (parallel ? "is-parallel" : "");

    col.forEach((s) => {
      const block = el("div", "uth__stage");
      const head = el("div", "uth__stagehead");
      head.appendChild(el("span", "uth__ico", svgIcon(s.icon)));
      head.appendChild(el("span", "uth__name", s.label));
      block.appendChild(head);
      block.appendChild(el("p", "uth__algo", (s.detail && s.detail.algo) || ""));
      if (s.detail && s.detail.libs) {
        const libs = el("div", "uth__libs");
        libs.appendChild(el("span", "uth__libslabel", "libraries"));
        s.detail.libs.split("·").forEach((lib) => {
          const t = lib.trim();
          if (t) libs.appendChild(el("span", "uth__lib", t));
        });
        block.appendChild(libs);
      }
      uthBody.appendChild(block);
    });
    uthBody.scrollTop = 0;
  }

  // ---- meters ------------------------------------------------------------
  function tokensThru(k) {
    let t = 0;
    for (let i = 0; i < k; i++) t += colTokens(columns[i]);
    return t;
  }
  function msThru(k) {
    let t = 0;
    for (let i = 0; i < k; i++) t += colMs(columns[i]); // parallel columns cost max
    return t;
  }
  function tweenNumber(target, to, fmt) {
    // per-element token — a shared counter would let one tween cancel another
    target._tw = (target._tw || 0) + 1;
    const myToken = target._tw;
    const from = parseFloat(target.dataset.raw || "0");
    const start = performance.now();
    const dur = prefersReducedMotion ? 0 : 420;
    function frame(now) {
      if (myToken !== target._tw) return;
      const t = dur ? clamp((now - start) / dur, 0, 1) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      target.textContent = fmt(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(frame);
      else target.dataset.raw = String(to);
    }
    requestAnimationFrame(frame);
  }
  function updateMeters() {
    const C = columns.length;
    mStep.textContent = cursor + " / " + C;
    stepLabel.textContent = cursor + " / " + C;
    scrubInput.value = String(cursor);
    tweenNumber(mTokens, tokensThru(cursor), (v) => Math.round(v).toLocaleString());
    tweenNumber(mElapsed, msThru(cursor) / 1000, (v) => v.toFixed(1) + "s");

    const finished = cursor >= C;
    mStatus.textContent = cursor === 0 ? "idle" : finished ? "done" : "running";
    mStatus.className = "meter__value " + (cursor === 0 ? "" : finished ? "is-done" : "is-running");
    if (cursor === 0) consoleMeta.textContent = "";
    else {
      const col = columns[Math.min(cursor, C) - 1];
      consoleMeta.textContent = col.length > 1 ? col.length + " agents ∥" : col[0].label.toLowerCase();
    }
  }

  // ---- cursor movement ---------------------------------------------------
  function goto(k, opts) {
    opts = opts || {};
    const C = columns.length;
    k = clamp(k, 0, C);
    const forwardOne = k === cursor + 1;
    cursor = k;

    applyStageStates();
    updateEdges();
    updateMeters();
    renderDetail();

    if (forwardOne && !opts.snap) {
      pulseColumn(k - 1);
      firePackets(k - 1);
      appendColumnLogs(k - 1);
    } else {
      rebuildConsole(k);
    }
    updateTransportButtons();
  }

  // ---- playback ----------------------------------------------------------
  function dwell(colIndex) {
    if (prefersReducedMotion) return 700;
    return clamp(colMs(columns[colIndex]) * 0.85, 900, 2200);
  }
  function play() {
    if (playing) return;
    if (cursor >= columns.length) goto(0, { snap: true });
    playing = true;
    updatePlayButton();
    const tick = () => {
      if (!playing) return;
      if (cursor >= columns.length) return pause();
      goto(cursor + 1);
      if (cursor >= columns.length) return pause();
      playTimer = setTimeout(tick, dwell(cursor - 1));
    };
    goto(cursor + 1);
    if (cursor < columns.length) playTimer = setTimeout(tick, dwell(cursor - 1));
    else pause();
  }
  function pause() {
    playing = false;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    updatePlayButton();
  }
  function togglePlay() {
    playing ? pause() : play();
  }
  function updatePlayButton() {
    playBtn.classList.toggle("is-playing", playing);
    playBtn.setAttribute("aria-pressed", String(playing));
    playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  function updateTransportButtons() {
    stepBackBtn.disabled = cursor <= 0;
    stepFwdBtn.disabled = cursor >= columns.length;
  }

  // ---- load a workflow ---------------------------------------------------
  function loadWorkflow(id) {
    pause();
    wf = WF.find((w) => w.id === id) || WF[0];
    columns = wf.columns;

    wfTitle.textContent = wf.title;
    wfSubtitle.textContent = wf.subtitle;
    scrubInput.max = String(columns.length);
    scrubInput.value = "0";
    cursor = 0;

    buildPipeline();
    consoleBody.replaceChildren();
    consoleBody.appendChild(el("div", "console__hint", "// press play to run the simulation"));
    mTokens.dataset.raw = "0";
    mElapsed.dataset.raw = "0";
    applyStageStates();
    updateMeters();
    renderDetail();
    updateTransportButtons();
    updatePlayButton();
  }

  // ---- theme -------------------------------------------------------------
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("agentflow-theme", next);
    } catch (e) {}
  }

  // ---- wire up -----------------------------------------------------------
  function init() {
    WF.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = w.title;
      workflowSelect.appendChild(opt);
    });
    workflowSelect.addEventListener("change", () => loadWorkflow(workflowSelect.value));
    themeToggle.addEventListener("click", toggleTheme);

    playBtn.addEventListener("click", togglePlay);
    stepFwdBtn.addEventListener("click", () => {
      pause();
      goto(cursor + 1);
    });
    stepBackBtn.addEventListener("click", () => {
      pause();
      goto(cursor - 1, { snap: true });
    });
    scrubInput.addEventListener("input", () => {
      pause();
      goto(parseInt(scrubInput.value, 10) || 0, { snap: true });
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        pause();
        goto(cursor + 1);
      } else if (e.key === "ArrowLeft") {
        pause();
        goto(cursor - 1, { snap: true });
      } else if (e.key === "t" || e.key === "T") {
        toggleTheme();
      }
    });

    let resizeRAF = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(measure);
    });

    loadWorkflow(WF[0].id);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
