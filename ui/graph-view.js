// graph-view.js
//
// Owns the <canvas> that renders the gossip network. The layout is computed
// once and frozen (nodes never drift). The guiding principle of the
// animation is SIGNAL, NOT NOISE: the vast majority of gossip exchanges are
// corroborations where nothing changes, so they are drawn silently. Only an
// exchange that actually flips a node's belief is animated — as a colored
// packet flying along the edge, and the receiving node holds its old color
// until the packet lands, then flips and "pops". That way the eye tracks
// exactly what matters: truth (or a lie) spreading node to node.
//
// app.js drives this through a small API and never touches the canvas.

window.GossipRAG = window.GossipRAG || {};

(function () {
  "use strict";

  const PADDING = 52; // px, canvas edge padding the layout fits inside
  const NODE_R_MIN = 12;
  const NODE_R_MAX = 22;
  const COLOR_EASE_RATE = 18; // exponential smoothing (1/s) — snappy ~150ms flip
  const TRUST_EASE_RATE = 9; // trust (node size) eases more gently
  const TRAVEL_MS = 480; // packet flight time along an edge
  const POP_MS = 620; // expanding ring after a node flips
  const STAGGER_MAX_MS = 130; // gap between staggered transmissions in a round
  const STAGGER_BUDGET_MS = 620; // total time to spread a round's transmissions over

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || "").trim());
    if (!m) return { r: 128, g: 128, b: 128 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
  }
  function rgbStr(c, alpha) {
    return `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${alpha == null ? 1 : alpha})`;
  }
  function mix(a, b, t) {
    return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function createGraphView(canvas, handlers) {
    const ctx = canvas.getContext("2d");
    const onSelect = (handlers && handlers.onSelect) || function () {};
    const prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let trace = null;
    let claim = null;
    let layoutAbstract = {};
    let nodeIds = [];
    let runtime = {};
    let roundIndex = 0;
    let selectedId = null;
    let hoveredId = null;
    let revealRoles = false;
    let transmissions = []; // {from, to, color, start, arrive}
    let pops = []; // {id, color, start}
    let rafHandle = null;
    let lastTs = 0;
    let cssW = 0,
      cssH = 0;

    let theme = null;
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
        surface: hexToRgb(cssVar("--surface") || "#ffffff"),
        line: hexToRgb(cssVar("--border-strong") || "#e0e0e0"),
        text2: cssVar("--text-2") || "#404040",
        text3: cssVar("--text-3") || "#737373",
        text4: cssVar("--text-4") || "#a3a3a3",
        surfaceStr: cssVar("--surface") || "#ffffff",
      };
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        if (!nr) return;
        nr.dispColor = beliefColorFor(nr.targetValue); // snap on palette change
      });
      requestRender();
    }
    refreshTheme();

    function beliefColorFor(value) {
      if (value == null) return { ...theme.gray };
      if (claim && value === claim.truth_value) return { ...theme.green };
      return { ...theme.red };
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
        runtime[id] = {
          meta: nodeMeta[id],
          px: 0,
          py: 0,
          targetValue: st.value,
          targetTrust: st.trust,
          dispTrust: st.trust,
          dispColor: beliefColorFor(st.value),
          pendingValue: undefined, // set when a packet is in flight toward this node
          pendingAt: 0,
        };
      });

      roundIndex = 0;
      selectedId = null;
      hoveredId = null;
      transmissions = [];
      pops = [];
      recomputeFit();
      onSelect(null);
      requestRender();
    }

    function gotoRound(index) {
      if (!trace) return;
      const clamped = Math.max(0, Math.min(trace.rounds.length - 1, index));
      const singleStepForward = clamped === roundIndex + 1;
      const round = trace.rounds[clamped];
      const prev = trace.rounds[clamped - 1];
      const now = performance.now();

      // clear any in-flight animation state from a prior round
      transmissions = [];
      pops = [];
      nodeIds.forEach((id) => {
        runtime[id].pendingValue = undefined;
        runtime[id].pendingAt = 0;
      });

      const animate = singleStepForward && !prefersReducedMotion && prev;

      // which nodes actually changed belief this round?
      const changed = [];
      nodeIds.forEach((id) => {
        const nv = round.node_states[id].value;
        const pv = prev ? prev.node_states[id].value : round.node_states[id].value;
        if (animate && nv !== pv) changed.push({ id, newVal: nv });
      });

      const stagger = changed.length > 1 ? Math.min(STAGGER_MAX_MS, STAGGER_BUDGET_MS / (changed.length - 1)) : 0;

      nodeIds.forEach((id) => {
        runtime[id].targetTrust = round.node_states[id].trust; // trust (size) always eases immediately
      });

      if (animate && changed.length) {
        changed.forEach((c, i) => {
          const startDelay = i * stagger;
          // find the exchange that delivered this new belief
          const ev = round.events.find((e) => e.to === c.id && e.claim_value_sent === c.newVal);
          const color = beliefColorFor(c.newVal);
          const nr = runtime[c.id];
          if (ev) {
            const start = now + startDelay;
            const arrive = start + TRAVEL_MS;
            transmissions.push({ from: ev.from, to: c.id, color, start, arrive });
            nr.pendingValue = c.newVal; // hold old color until the packet lands
            nr.pendingAt = arrive;
            pops.push({ id: c.id, color, start: arrive });
          } else {
            // no matching packet (rare) — flip immediately with a pop
            nr.targetValue = c.newVal;
            pops.push({ id: c.id, color, start: now + startDelay });
          }
        });
      } else {
        // scrub / jump / reduced-motion: snap targets, no packets
        nodeIds.forEach((id) => {
          runtime[id].targetValue = round.node_states[id].value;
        });
      }

      roundIndex = clamped;
      requestRender();
    }

    function selectNode(id) {
      if (id != null && !runtime[id]) return;
      selectedId = selectedId === id ? null : id;
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
      const now = performance.now();

      let animating = false;
      const ct = 1 - Math.exp(-COLOR_EASE_RATE * dt);
      const tt = 1 - Math.exp(-TRUST_EASE_RATE * dt);

      nodeIds.forEach((id) => {
        const nr = runtime[id];
        // apply a pending (packet-synced) belief flip once its packet lands
        if (nr.pendingValue !== undefined && now >= nr.pendingAt) {
          nr.targetValue = nr.pendingValue;
          nr.pendingValue = undefined;
        }
        if (nr.pendingValue !== undefined) animating = true; // waiting for a packet

        const target = beliefColorFor(nr.targetValue);
        nr.dispColor = mix(nr.dispColor, target, ct);
        nr.dispTrust = lerp(nr.dispTrust, nr.targetTrust, tt);

        if (
          Math.abs(nr.dispColor.r - target.r) > 0.6 ||
          Math.abs(nr.dispColor.g - target.g) > 0.6 ||
          Math.abs(nr.dispColor.b - target.b) > 0.6 ||
          Math.abs(nr.dispTrust - nr.targetTrust) > 0.003
        ) {
          animating = true;
        }
      });

      transmissions = transmissions.filter((t) => now < t.arrive);
      pops = pops.filter((p) => now - p.start < POP_MS);
      if (transmissions.length || pops.length) animating = true;

      render(now);

      if (animating) requestRender();
      else lastTs = 0;
    }

    // ---- rendering -------------------------------------------------------

    function nodeRadius(trust) {
      return NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * clamp01(trust);
    }

    function render(now) {
      now = now || performance.now();
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = theme.surfaceStr;
      ctx.fillRect(0, 0, cssW, cssH);

      if (!trace) {
        ctx.font = `12px ${fonts.mono}`;
        ctx.fillStyle = theme.text4;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("// no trace loaded", cssW / 2, cssH / 2);
        return;
      }

      drawEdges();
      drawTransmissions(now);
      drawNodes();
      drawPops(now);
    }

    function edgeKey(a, b) {
      return a < b ? a + "|" + b : b + "|" + a;
    }

    function drawEdges() {
      const active = new Set(transmissions.map((t) => edgeKey(t.from, t.to)));
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgbStr(theme.line, 0.55);
      trace.topology.edges.forEach(([a, b]) => {
        const na = runtime[a],
          nb = runtime[b];
        if (!na || !nb || active.has(edgeKey(a, b))) return;
        ctx.beginPath();
        ctx.moveTo(na.px, na.py);
        ctx.lineTo(nb.px, nb.py);
        ctx.stroke();
      });
    }

    function drawTransmissions(now) {
      transmissions.forEach((t) => {
        if (now < t.start) return; // still staggered / not launched
        const na = runtime[t.from],
          nb = runtime[t.to];
        if (!na || !nb) return;
        const progress = clamp01((now - t.start) / TRAVEL_MS);

        // the edge lights up in the belief's color while the packet travels
        ctx.save();
        ctx.strokeStyle = rgbStr(t.color, 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(na.px, na.py);
        ctx.lineTo(nb.px, nb.py);
        ctx.stroke();

        // the packet: a bright dot with a soft glow, easing toward arrival
        const et = easeInOutQuad(progress);
        const dx = lerp(na.px, nb.px, et);
        const dy = lerp(na.py, nb.py, et);
        ctx.shadowColor = rgbStr(t.color, 0.7);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.fillStyle = rgbStr(t.color, 1);
        ctx.arc(dx, dy, 5, 0, Math.PI * 2);
        ctx.fill();
        // small white core for pop against the surface
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.fillStyle = rgbStr(theme.surface, 0.9);
        ctx.arc(dx, dy, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    function drawNodes() {
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const r = nodeRadius(nr.dispTrust);
        const isSelected = id === selectedId;
        const isHovered = id === hoveredId;

        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(nr.px, nr.py, r + 5, 0, Math.PI * 2);
          ctx.strokeStyle = rgbStr(theme.accent, isSelected ? 0.9 : 0.4);
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.stroke();
        }

        // solid, high-contrast fill — belief color reads instantly. A subtle
        // darkening toward the edge gives a bit of depth without gloss.
        ctx.beginPath();
        ctx.arc(nr.px, nr.py, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbStr(nr.dispColor, 0.92);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgbStr(mix(nr.dispColor, { r: 0, g: 0, b: 0 }, 0.18), 1);
        ctx.stroke();

        if (revealRoles && nr.meta.role !== "honest") {
          ctx.beginPath();
          ctx.arc(nr.px + r * 0.66, nr.py - r * 0.66, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = rgbStr(theme.amber, 0.98);
          ctx.fill();
          ctx.strokeStyle = theme.surfaceStr;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = `700 8px ${fonts.mono}`;
          ctx.fillStyle = theme.surfaceStr;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", nr.px + r * 0.66, nr.py - r * 0.66 + 0.5);
        }

        ctx.font = `500 10px ${fonts.mono}`;
        ctx.fillStyle = isSelected || isHovered ? theme.text2 : theme.text3;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(id, nr.px, nr.py + r + 7);
      });
    }

    function drawPops(now) {
      pops.forEach((p) => {
        if (now < p.start) return;
        const nr = runtime[p.id];
        if (!nr) return;
        const progress = clamp01((now - p.start) / POP_MS);
        const base = nodeRadius(nr.dispTrust);
        const ringR = base + 4 + easeOutCubic(progress) * 20;
        const alpha = (1 - progress) * 0.85;
        ctx.beginPath();
        ctx.arc(nr.px, nr.py, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = rgbStr(p.color, alpha);
        ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
        ctx.stroke();
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
