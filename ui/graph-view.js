// graph-view.js
//
// Owns the <canvas> that renders the gossip network: layout (via
// force-layout.js), per-node smoothed visual state (color/trust ease
// toward each round's target instead of hard-cutting), edge "message
// traveled" pulses, hit-testing for click-to-select, and DPR-correct
// resizing. app.js drives it through a small API and never touches the
// canvas directly.

window.GossipRAG = window.GossipRAG || {};

(function () {
  "use strict";

  const PADDING = 48; // px, canvas edge padding the layout fits inside
  const NODE_R_MIN = 13;
  const NODE_R_MAX = 21;
  const EASE_RATE = 12; // exponential smoothing rate (1/s) — ~250-300ms settle
  const PULSE_DURATION_MS = 750;
  const PULSE_DOT_R = 4;

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return { r: 128, g: 128, b: 128 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }

  function rgbStr(c, alpha) {
    return `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${alpha == null ? 1 : alpha})`;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeOutQuad(t) {
    return 1 - (1 - t) * (1 - t);
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} handlers
   * @param {(id: string|null) => void} handlers.onSelect
   */
  function createGraphView(canvas, handlers) {
    const ctx = canvas.getContext("2d");
    const onSelect = (handlers && handlers.onSelect) || function () {};
    const prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let trace = null;
    let claim = null;
    let layoutAbstract = {}; // nodeId -> {x,y} in abstract space (static per trace)
    let nodeIds = [];
    let runtime = {}; // nodeId -> per-node runtime visual state
    let roundIndex = 0;
    let selectedId = null;
    let hoveredId = null;
    let revealRoles = false;
    let pulses = [];
    let rafHandle = null;
    let lastTs = 0;
    let cssW = 0,
      cssH = 0;

    let theme = null; // parsed colors, populated by refreshTheme()
    const fonts = {
      mono: cssVar("--font-mono") || "monospace",
      sans: cssVar("--font-sans") || "sans-serif",
    };

    function refreshTheme() {
      theme = {
        green: hexToRgb(cssVar("--green") || "#16a34a"),
        red: hexToRgb(cssVar("--red") || "#dc2626"),
        gray: hexToRgb(cssVar("--text-4") || "#a3a3a3"),
        accent: hexToRgb(cssVar("--accent") || "#2563eb"),
        amber: hexToRgb(cssVar("--amber") || "#b45309"),
        border: cssVar("--border-strong") || "#e0e0e0",
        surface: cssVar("--surface") || "#ffffff",
        text2: cssVar("--text-2") || "#404040",
        text3: cssVar("--text-3") || "#737373",
        text4: cssVar("--text-4") || "#a3a3a3",
      };
      // Snap (don't ease) — this is a palette change, not a data change.
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        if (!nr) return;
        nr.dispColor = beliefColorFor(nr.targetValue);
      });
      requestRender();
    }

    // Populate theme colors immediately (not lazily on first trace load).
    // The canvas's ResizeObserver below fires its first callback
    // asynchronously as soon as it starts observing, which can happen
    // before any trace has finished fetching — render() must be able to
    // draw its "no trace loaded" placeholder with real theme colors from
    // the very first frame, not a null theme.
    refreshTheme();

    function beliefColorFor(value) {
      if (value == null) return { ...theme.gray };
      if (claim && value === claim.truth_value) return { ...theme.green };
      return { ...theme.red }; // anything divergent (corrupted_value or otherwise)
    }

    // ---- lifecycle -------------------------------------------------------

    function loadTrace(newTrace) {
      trace = newTrace;
      claim = trace.claim;
      nodeIds = trace.nodes.map((n) => n.id);
      const nodeMeta = {};
      trace.nodes.forEach((n) => (nodeMeta[n.id] = n));

      layoutAbstract = window.GossipRAG.forceDirectedLayout(nodeIds, trace.topology.edges);

      const round0 = trace.rounds[0];
      runtime = {};
      nodeIds.forEach((id) => {
        const st = (round0 && round0.node_states[id]) || { value: null, confidence: 0, trust: 1 };
        const color = beliefColorFor(st.value);
        runtime[id] = {
          meta: nodeMeta[id],
          ax: layoutAbstract[id].x,
          ay: layoutAbstract[id].y,
          px: 0,
          py: 0,
          targetValue: st.value,
          targetTrust: st.trust,
          dispTrust: st.trust,
          dispColor: color,
          targetColorKey: st.value,
        };
      });

      roundIndex = 0;
      selectedId = null;
      hoveredId = null;
      pulses = [];
      recomputeFit();
      onSelect(null);
      requestRender();
    }

    function gotoRound(index) {
      if (!trace) return;
      const clamped = Math.max(0, Math.min(trace.rounds.length - 1, index));
      const forward = clamped > roundIndex;
      const round = trace.rounds[clamped];

      nodeIds.forEach((id) => {
        const st = round.node_states[id];
        const nr = runtime[id];
        nr.targetValue = st.value;
        nr.targetTrust = st.trust;
      });

      if (forward && round.events && round.events.length) {
        const now = performance.now();
        round.events.forEach((ev) => {
          pulses.push({ from: ev.from, to: ev.to, start: now, duration: prefersReducedMotion ? 180 : PULSE_DURATION_MS });
        });
      }

      roundIndex = clamped;
      requestRender();
    }

    function selectNode(id) {
      if (id != null && !runtime[id]) return;
      selectedId = selectedId === id ? null : id; // click again to deselect
      if (id == null) selectedId = null;
      onSelect(selectedId);
      requestRender();
    }

    function setRevealRoles(on) {
      revealRoles = !!on;
      requestRender();
    }

    function getNodeSnapshot(id, atRoundIndex) {
      if (!trace) return null;
      const idx = atRoundIndex == null ? roundIndex : atRoundIndex;
      const st = trace.rounds[idx].node_states[id];
      const meta = runtime[id] && runtime[id].meta;
      if (!st || !meta) return null;
      return {
        id,
        label: meta.label,
        role: meta.role,
        shardDocIds: meta.shard_doc_ids || [],
        value: st.value,
        confidence: st.confidence,
        trust: st.trust,
        provenance: st.provenance || [],
      };
    }

    // ---- sizing ------------------------------------------------------

    function recomputeFit() {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(rect.width, 1);
      cssH = Math.max(rect.height, 1);
      const dpr = window.devicePixelRatio || 1;
      const wantW = Math.round(cssW * dpr);
      const wantH = Math.round(cssH * dpr);
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width = wantW;
        canvas.height = wantH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (nodeIds.length) {
        const fitted = window.GossipRAG.fitToViewport(layoutAbstract, nodeIds, cssW, cssH, PADDING);
        nodeIds.forEach((id) => {
          runtime[id].px = fitted[id].x;
          runtime[id].py = fitted[id].y;
        });
      }
    }

    const ro = new ResizeObserver(() => {
      recomputeFit();
      requestRender();
    });
    ro.observe(canvas);

    // ---- animation loop ------------------------------------------------

    function requestRender() {
      if (rafHandle == null) rafHandle = requestAnimationFrame(frame);
    }

    function frame(ts) {
      rafHandle = null;
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 1 / 60;
      lastTs = ts;

      let animating = false;
      const rate = prefersReducedMotion ? 60 : EASE_RATE;
      const t = 1 - Math.exp(-rate * dt);

      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const targetColor = beliefColorFor(nr.targetValue);
        nr.dispColor.r = lerp(nr.dispColor.r, targetColor.r, t);
        nr.dispColor.g = lerp(nr.dispColor.g, targetColor.g, t);
        nr.dispColor.b = lerp(nr.dispColor.b, targetColor.b, t);
        nr.dispTrust = lerp(nr.dispTrust, nr.targetTrust, t);

        if (
          Math.abs(nr.dispColor.r - targetColor.r) > 0.5 ||
          Math.abs(nr.dispColor.g - targetColor.g) > 0.5 ||
          Math.abs(nr.dispColor.b - targetColor.b) > 0.5 ||
          Math.abs(nr.dispTrust - nr.targetTrust) > 0.002
        ) {
          animating = true;
        }
      });

      const now = performance.now();
      pulses = pulses.filter((p) => now - p.start < p.duration);
      if (pulses.length) animating = true;

      render();

      if (animating) {
        requestRender();
      } else {
        lastTs = 0;
      }
    }

    // ---- rendering -------------------------------------------------------

    function nodeRadius(trust) {
      return NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * clamp01(trust);
    }

    function render() {
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = theme ? theme.surface : "#fff";
      ctx.fillRect(0, 0, cssW, cssH);

      if (!trace) {
        ctx.font = `12px ${fonts.mono}`;
        ctx.fillStyle = theme ? theme.text4 : "#a3a3a3";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("// no trace loaded", cssW / 2, cssH / 2);
        return;
      }

      drawEdges();
      drawPulses();
      drawNodes();
    }

    function drawEdges() {
      const pulsedPairs = new Set(pulses.map((p) => edgeKey(p.from, p.to)));
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.border;
      trace.topology.edges.forEach(([a, b]) => {
        const na = runtime[a],
          nb = runtime[b];
        if (!na || !nb) return;
        if (pulsedPairs.has(edgeKey(a, b))) return; // drawn in drawPulses on top
        ctx.beginPath();
        ctx.moveTo(na.px, na.py);
        ctx.lineTo(nb.px, nb.py);
        ctx.stroke();
      });
    }

    function edgeKey(a, b) {
      return a < b ? a + "|" + b : b + "|" + a;
    }

    function drawPulses() {
      const now = performance.now();
      pulses.forEach((p) => {
        const na = runtime[p.from],
          nb = runtime[p.to];
        if (!na || !nb) return;
        const progress = clamp01((now - p.start) / p.duration);
        const fade = 1 - progress;

        // glowing edge
        ctx.save();
        ctx.strokeStyle = rgbStr(theme.accent, 0.25 + 0.65 * fade);
        ctx.lineWidth = 1 + 1.5 * fade;
        ctx.shadowColor = rgbStr(theme.accent, 0.5 * fade);
        ctx.shadowBlur = 8 * fade;
        ctx.beginPath();
        ctx.moveTo(na.px, na.py);
        ctx.lineTo(nb.px, nb.py);
        ctx.stroke();
        ctx.restore();

        // traveling dot: message moving from -> to, easing toward arrival
        const et = easeOutQuad(progress);
        const dx = lerp(na.px, nb.px, et);
        const dy = lerp(na.py, nb.py, et);
        ctx.beginPath();
        ctx.fillStyle = rgbStr(theme.accent, 0.55 + 0.45 * fade);
        ctx.arc(dx, dy, PULSE_DOT_R, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function drawNodes() {
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const r = nodeRadius(nr.dispTrust);
        const fillAlpha = 0.28 + 0.62 * clamp01(nr.dispTrust);
        const isSelected = id === selectedId;
        const isHovered = id === hoveredId;

        // selection / hover ring (drawn first, under the node)
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(nr.px, nr.py, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = rgbStr(theme.accent, isSelected ? 0.9 : 0.4);
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.stroke();
        }

        // fill (alpha communicates trust — eroding trust visibly fades)
        ctx.beginPath();
        ctx.arc(nr.px, nr.py, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbStr(nr.dispColor, fillAlpha);
        ctx.fill();

        // stable outline at fixed alpha so low-trust (faded) nodes stay
        // legible / clickable even as their fill washes out
        ctx.beginPath();
        ctx.arc(nr.px, nr.py, r, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgbStr(nr.dispColor, 0.9);
        ctx.stroke();

        // optional "reveal" badge for seeded adversarial roles
        if (revealRoles && nr.meta.role !== "honest") {
          ctx.beginPath();
          ctx.arc(nr.px + r * 0.68, nr.py - r * 0.68, 5, 0, Math.PI * 2);
          ctx.fillStyle = theme.amber ? rgbStr(theme.amber, 0.95) : "#b45309";
          ctx.fill();
          ctx.font = `700 7px ${fonts.mono}`;
          ctx.fillStyle = theme.surface;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", nr.px + r * 0.68, nr.py - r * 0.68 + 0.5);
        }

        // label
        ctx.font = `500 10px ${fonts.mono}`;
        ctx.fillStyle = isSelected ? theme.text2 : theme.text3;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(id, nr.px, nr.py + r + 8);
      });
    }

    // ---- interaction -------------------------------------------------

    function hitTest(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best = null;
      let bestDist = Infinity;
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const dx = x - nr.px;
        const dy = y - nr.py;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = nodeRadius(nr.dispTrust) + 6;
        if (dist <= hitR && dist < bestDist) {
          best = id;
          bestDist = dist;
        }
      });
      return best;
    }

    canvas.addEventListener("click", (e) => {
      selectNode(hitTest(e.clientX, e.clientY));
    });

    canvas.addEventListener("mousemove", (e) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit !== hoveredId) {
        hoveredId = hit;
        canvas.style.cursor = hit ? "pointer" : "default";
        requestRender();
      }
    });

    canvas.addEventListener("mouseleave", () => {
      if (hoveredId != null) {
        hoveredId = null;
        requestRender();
      }
    });

    return {
      loadTrace,
      gotoRound,
      selectNode,
      setRevealRoles,
      getNodeSnapshot,
      getRoundIndex: () => roundIndex,
      getSelectedId: () => selectedId,
      refreshTheme,
      resize: () => {
        recomputeFit();
        requestRender();
      },
    };
  }

  window.GossipRAG.createGraphView = createGraphView;
})();
