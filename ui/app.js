// app.js
//
// The agentic-workflow player. It walks a workflow's `steps` timeline: each
// step flies a packet to its stage, lights that stage up, streams a line into
// the console, and ticks the token/latency meters — so a fully mocked run
// reads like watching a real agent execute. No canvas; the pipeline is DOM +
// CSS so the icons stay crisp and the motion stays smooth.

(function () {
  "use strict";

  const WF = window.GRW.WORKFLOWS;
  const ICONS = window.GRW.ICONS;
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
  let stageIndexById = {};
  let stepStageIdx = []; // step i -> stage index
  let cursor = 0; // steps executed [0..N]
  let playing = false;
  let playTimer = null;
  let stageEls = [];
  let packetEl = null;
  let progressEl = null;
  let trackEl = null;
  let centers = []; // stage center x (px, relative to pipeline)
  let typeToken = 0; // cancels an in-flight typewriter

  // ---- helpers -----------------------------------------------------------
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function svgIcon(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.robot}</svg>`;
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // ---- build the pipeline for a workflow ---------------------------------
  function buildPipeline() {
    pipelineEl.replaceChildren();

    trackEl = el("div", "pipeline__track");
    progressEl = el("div", "pipeline__progress");
    trackEl.appendChild(progressEl);
    pipelineEl.appendChild(trackEl);

    packetEl = el("div", "pipeline__packet");
    packetEl.setAttribute("aria-hidden", "true");
    pipelineEl.appendChild(packetEl);

    stageEls = wf.stages.map((s, i) => {
      const card = el("div", "stage is-pending");
      card.dataset.idx = String(i);
      card.appendChild(el("div", "stage__icon", svgIcon(s.icon)));
      card.appendChild(el("div", "stage__label", s.label));
      card.appendChild(el("div", "stage__step", "0" + (i + 1)));
      pipelineEl.appendChild(card);
      return card;
    });

    requestAnimationFrame(measure);
  }

  function measure() {
    if (!stageEls.length) return;
    const prect = pipelineEl.getBoundingClientRect();
    centers = stageEls.map((c) => {
      const r = c.getBoundingClientRect();
      return r.left - prect.left + r.width / 2;
    });
    const first = centers[0];
    const last = centers[centers.length - 1];
    const iconTop = stageEls[0].querySelector(".stage__icon").getBoundingClientRect();
    const y = iconTop.top - prect.top + iconTop.height / 2;
    trackEl.style.left = first + "px";
    trackEl.style.width = last - first + "px";
    trackEl.style.top = y + "px";
    packetEl.style.top = y + "px";
    renderPositions(false);
  }

  // ---- render the visual state for the current cursor --------------------
  function stageStatusRender() {
    const activeStage = cursor > 0 ? stepStageIdx[cursor - 1] : -1;
    const finished = cursor >= wf.steps.length;
    stageEls.forEach((card, i) => {
      card.classList.remove("is-pending", "is-active", "is-done");
      if (i < activeStage) card.classList.add("is-done");
      else if (i === activeStage) card.classList.add(finished ? "is-done" : "is-active");
      else card.classList.add("is-pending");
    });
  }

  function renderPositions(animate) {
    if (!centers.length) return;
    const activeStage = cursor > 0 ? stepStageIdx[cursor - 1] : -1;
    const targetX = activeStage >= 0 ? centers[activeStage] : centers[0];
    const first = centers[0];

    packetEl.style.transition = animate ? "" : "none";
    packetEl.style.transform = `translateX(${targetX}px)`;
    packetEl.style.opacity = activeStage >= 0 ? "1" : "0";
    progressEl.style.transition = animate ? "" : "none";
    progressEl.style.width = Math.max(0, targetX - first) + "px";
    if (!animate) {
      // force reflow so the next animated change transitions from here
      void packetEl.offsetWidth;
      packetEl.style.transition = "";
      progressEl.style.transition = "";
    }
  }

  // ---- console -----------------------------------------------------------
  let pendingType = null; // an in-flight typewriter, so we can finish it early
  function finishPending() {
    if (!pendingType) return;
    const p = pendingType;
    pendingType = null;
    typeToken++; // stop its scheduled ticks
    p.target.textContent = "“" + p.text + "”";
    if (p.cursorEl) p.cursorEl.remove();
  }

  function appendLog(step, opts) {
    opts = opts || {};
    finishPending(); // any previous streamed answer snaps to complete
    const hint = consoleBody.querySelector(".console__hint");
    if (hint) hint.remove();
    const line = el("div", "logline");
    if (step.done) line.classList.add("logline--done");
    const stageLabel = wf.stages[stepStageIdx[indexOfStep(step)]].label;
    line.appendChild(el("span", "logline__stage", stageLabel));
    const body = el("span", "logline__body");
    line.appendChild(body);
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    body.textContent = step.log;

    if (step.stream && !opts.instant && !prefersReducedMotion) {
      const gen = el("div", "logline__gen");
      const gentext = el("span", "logline__gentext");
      const cur = el("span", "logline__cursor");
      gen.appendChild(gentext);
      gen.appendChild(cur);
      line.appendChild(gen);
      typewrite(gentext, step.stream, cur);
    } else if (step.stream) {
      const gen = el("div", "logline__gen");
      gen.appendChild(el("span", "logline__gentext", "“" + step.stream + "”"));
      line.appendChild(gen);
    }
  }

  function indexOfStep(step) {
    return wf.steps.indexOf(step);
  }

  function typewrite(target, text, cursorEl) {
    const myToken = ++typeToken;
    pendingType = { target, text, cursorEl };
    target.textContent = "“";
    let i = 0;
    const speed = clamp(1200 / text.length, 14, 45); // finish in ~1.2s
    function tick() {
      if (myToken !== typeToken) return; // superseded
      i++;
      target.textContent = "“" + text.slice(0, i) + (i < text.length ? "" : "”");
      consoleBody.scrollTop = consoleBody.scrollHeight;
      if (i < text.length) {
        setTimeout(tick, speed);
      } else {
        if (cursorEl) cursorEl.remove();
        if (pendingType && pendingType.target === target) pendingType = null;
      }
    }
    setTimeout(tick, speed);
  }

  function rebuildConsole(upto) {
    typeToken++; // cancel any typing
    consoleBody.replaceChildren();
    for (let i = 0; i < upto; i++) appendLog(wf.steps[i], { instant: true });
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  // ---- meters ------------------------------------------------------------
  function sumTokens(k) {
    let t = 0;
    for (let i = 0; i < k; i++) t += wf.steps[i].tokens || 0;
    return t;
  }
  function sumMs(k) {
    let t = 0;
    for (let i = 0; i < k; i++) t += wf.steps[i].ms || 0;
    return t;
  }
  function tweenNumber(target, to, fmt) {
    // per-element token — a shared counter would let the elapsed tween cancel
    // the tokens tween (they run back-to-back), freezing one of them at 0
    target._tw = (target._tw || 0) + 1;
    const myToken = target._tw;
    const from = parseFloat(target.dataset.raw || "0");
    const start = performance.now();
    const dur = prefersReducedMotion ? 0 : 420;
    function frame(now) {
      if (myToken !== target._tw) return;
      const t = dur ? clamp((now - start) / dur, 0, 1) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      const val = from + (to - from) * eased;
      target.textContent = fmt(val);
      if (t < 1) requestAnimationFrame(frame);
      else target.dataset.raw = String(to);
    }
    requestAnimationFrame(frame);
  }
  function updateMeters() {
    const N = wf.steps.length;
    mStep.textContent = cursor + " / " + N;
    stepLabel.textContent = cursor + " / " + N;
    scrubInput.value = String(cursor);
    tweenNumber(mTokens, sumTokens(cursor), (v) => Math.round(v).toLocaleString());
    tweenNumber(mElapsed, sumMs(cursor) / 1000, (v) => v.toFixed(1) + "s");

    const finished = cursor >= N;
    mStatus.textContent = cursor === 0 ? "idle" : finished ? "done" : "running";
    mStatus.className = "meter__value " + (cursor === 0 ? "" : finished ? "is-done" : "is-running");
    consoleMeta.textContent = cursor === 0 ? "" : wf.stages[stepStageIdx[Math.min(cursor, N) - 1]].label.toLowerCase();
  }

  // ---- cursor movement ---------------------------------------------------
  function goto(k, opts) {
    opts = opts || {};
    const N = wf.steps.length;
    k = clamp(k, 0, N);
    const forwardOne = k === cursor + 1;
    cursor = k;

    stageStatusRender();
    renderPositions(!opts.snap);
    updateMeters();

    if (forwardOne && !opts.snap) {
      // pulse the freshly-activated stage, and stream just this step's line
      const idx = stepStageIdx[k - 1];
      const card = stageEls[idx];
      if (card) {
        card.classList.remove("stage--pulse");
        void card.offsetWidth;
        card.classList.add("stage--pulse");
      }
      appendLog(wf.steps[k - 1]);
    } else {
      rebuildConsole(k);
    }
    updateTransportButtons();
  }

  // ---- playback ----------------------------------------------------------
  function dwell(stepIdx) {
    const step = wf.steps[stepIdx];
    if (prefersReducedMotion) return 650;
    return clamp((step.ms || 800) * 0.85, 850, 2200);
  }
  function play() {
    if (playing) return;
    if (cursor >= wf.steps.length) {
      goto(0, { snap: true }); // restart from the top
    }
    playing = true;
    updatePlayButton();
    const tick = () => {
      if (!playing) return;
      if (cursor >= wf.steps.length) {
        pause();
        return;
      }
      goto(cursor + 1);
      if (cursor >= wf.steps.length) {
        pause();
        return;
      }
      playTimer = setTimeout(tick, dwell(cursor - 1));
    };
    // first advance kicks off immediately for responsiveness
    goto(cursor + 1);
    if (cursor < wf.steps.length) playTimer = setTimeout(tick, dwell(cursor - 1));
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
    stepFwdBtn.disabled = cursor >= wf.steps.length;
  }

  // ---- load a workflow ---------------------------------------------------
  function loadWorkflow(id) {
    pause();
    wf = WF.find((w) => w.id === id) || WF[0];
    stageIndexById = {};
    wf.stages.forEach((s, i) => (stageIndexById[s.id] = i));
    stepStageIdx = wf.steps.map((st) => stageIndexById[st.stage]);

    wfTitle.textContent = wf.title;
    wfSubtitle.textContent = wf.subtitle;
    scrubInput.max = String(wf.steps.length);
    scrubInput.value = "0";
    cursor = 0;

    buildPipeline();
    consoleBody.replaceChildren();
    consoleBody.appendChild(el("div", "console__hint", "// press play to run the simulation"));
    // meters reset
    mTokens.dataset.raw = "0";
    mElapsed.dataset.raw = "0";
    stageStatusRender();
    updateMeters();
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

    window.addEventListener("resize", () => {
      measure();
    });

    loadWorkflow(WF[0].id);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
