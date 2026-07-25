// graph-view.js
//
// The "consensus scope" — the network rendered as a surveillance readout
// rather than a physics blob. Nodes sit as blips evenly on a ring; their
// connections bow through the interior as faint chords; a convergence core
// with a health gauge sits at the centre; and a slow sweep rotates behind
// it so the whole thing reads as a live intelligence computing agreement.
//
// The animation principle is unchanged and deliberate: only an exchange
// that actually flips a node's belief is animated — a colour-coded packet
// rides the chord and the receiving blip flips the instant it lands. The
// many "we already agree" corroborations stay silent.

window.GossipRAG = window.GossipRAG || {};

(function () {
  "use strict";

  const PADDING = 62; // room for node blips + their labels outside the ring
  const NODE_R_MIN = 8;
  const NODE_R_MAX = 15;
  const COLOR_EASE_RATE = 18;
  const TRUST_EASE_RATE = 9;
  const CONV_EASE_RATE = 6;
  const TRAVEL_MS = 620;
  const POP_MS = 660;
  const STAGGER_MAX_MS = 130;
  const STAGGER_BUDGET_MS = 640;
  const SWEEP_PERIOD_MS = 11000; // one revolution of the ambient sweep
  const BOW = 0.55; // how far chords bow toward the centre

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
  function rgbStr(c, a) {
    return `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${a == null ? 1 : a})`;
  }
  function mix(a, b, t) {
    return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  // quadratic bezier point
  function qbez(p0, p1, p2, t) {
    const u = 1 - t;
    return {
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
  }

  function createGraphView(canvas, handlers) {
    const ctx = canvas.getContext("2d");
    const onSelect = (handlers && handlers.onSelect) || function () {};
    const prefersReducedMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let trace = null;
    let claim = null;
    let nodeIds = [];
    let runtime = {}; // id -> visual state
    let edges = []; // {a, b, ctrl}
    let cx = 0,
      cy = 0,
      ringR = 0,
      coreR = 0;
    let roundIndex = 0;
    let selectedId = null;
    let hoveredId = null;
    let revealRoles = false;
    let transmissions = [];
    let pops = [];
    let dispConv = 0; // eased convergence fraction shown in the core
    let targetConv = 0;
    let rafHandle = null;
    let lastTs = 0;
    let startTs = 0;
    let cssW = 0,
      cssH = 0;

    let theme = null;
    const fonts = {
      mono: cssVar("--font-mono") || "monospace",
      display: cssVar("--font-display") || 'Georgia, "Times New Roman", serif',
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
        text: hexToRgb(cssVar("--text") || "#111111"),
        text2: cssVar("--text-2") || "#404040",
        text3: cssVar("--text-3") || "#737373",
        text4: cssVar("--text-4") || "#a3a3a3",
        surfaceStr: cssVar("--surface") || "#ffffff",
      };
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        if (nr) nr.dispColor = beliefColorFor(nr.targetValue);
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

      const round0 = trace.rounds[0];
      runtime = {};
      nodeIds.forEach((id) => {
        const st = (round0 && round0.node_states[id]) || { value: null, trust: 1 };
        runtime[id] = {
          meta: nodeMeta[id],
          x: 0,
          y: 0,
          ang: 0,
          targetValue: st.value,
          targetTrust: st.trust,
          dispTrust: st.trust,
          dispColor: beliefColorFor(st.value),
          pendingValue: undefined,
          pendingAt: 0,
        };
      });

      roundIndex = 0;
      selectedId = null;
      hoveredId = null;
      transmissions = [];
      pops = [];
      targetConv = (round0 ? round0.convergence_pct : 0) / 100;
      dispConv = targetConv;
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

      transmissions = [];
      pops = [];
      nodeIds.forEach((id) => {
        runtime[id].pendingValue = undefined;
        runtime[id].pendingAt = 0;
        runtime[id].targetTrust = round.node_states[id].trust;
      });

      targetConv = round.convergence_pct / 100;

      const animate = singleStepForward && !prefersReducedMotion && prev;
      const changed = [];
      nodeIds.forEach((id) => {
        const nv = round.node_states[id].value;
        const pv = prev ? prev.node_states[id].value : round.node_states[id].value;
        if (animate && nv !== pv) changed.push({ id, newVal: nv });
      });
      const stagger = changed.length > 1 ? Math.min(STAGGER_MAX_MS, STAGGER_BUDGET_MS / (changed.length - 1)) : 0;

      if (animate && changed.length) {
        changed.forEach((c, i) => {
          const startDelay = i * stagger;
          const ev = round.events.find((e) => e.to === c.id && e.claim_value_sent === c.newVal);
          const color = beliefColorFor(c.newVal);
          const nr = runtime[c.id];
          if (ev) {
            const start = now + startDelay;
            const arrive = start + TRAVEL_MS;
            transmissions.push({ from: ev.from, to: c.id, color, start, arrive });
            nr.pendingValue = c.newVal;
            nr.pendingAt = arrive;
            pops.push({ id: c.id, color, start: arrive });
          } else {
            nr.targetValue = c.newVal;
            pops.push({ id: c.id, color, start: now + startDelay });
          }
        });
      } else {
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

    // ---- sizing / radial layout ------------------------------------------

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

      if (!nodeIds.length) return;
      cx = cssW / 2;
      cy = cssH / 2;
      ringR = Math.min(cssW, cssH) / 2 - PADDING;
      coreR = Math.max(40, Math.min(72, ringR * 0.34));

      const n = nodeIds.length;
      nodeIds.forEach((id, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const nr = runtime[id];
        nr.ang = ang;
        nr.x = cx + ringR * Math.cos(ang);
        nr.y = cy + ringR * Math.sin(ang);
      });

      // chord control points bow each edge toward the centre
      edges = trace.topology.edges.map(([a, b]) => {
        const na = runtime[a],
          nb = runtime[b];
        const mx = (na.x + nb.x) / 2,
          my = (na.y + nb.y) / 2;
        return { a, b, ctrl: { x: lerp(mx, cx, BOW), y: lerp(my, cy, BOW) } };
      });
    }

    const ro = new ResizeObserver(() => {
      recomputeFit();
      requestRender();
    });
    ro.observe(canvas);

    // ---- animation loop --------------------------------------------------

    function requestRender() {
      if (rafHandle == null) rafHandle = requestAnimationFrame(frame);
    }

    function frame(ts) {
      rafHandle = null;
      if (!startTs) startTs = ts;
      const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 1 / 60;
      lastTs = ts;
      const now = performance.now();

      const ct = 1 - Math.exp(-COLOR_EASE_RATE * dt);
      const tt = 1 - Math.exp(-TRUST_EASE_RATE * dt);
      const vt = 1 - Math.exp(-CONV_EASE_RATE * dt);

      nodeIds.forEach((id) => {
        const nr = runtime[id];
        if (nr.pendingValue !== undefined && now >= nr.pendingAt) {
          nr.targetValue = nr.pendingValue;
          nr.pendingValue = undefined;
        }
        const target = beliefColorFor(nr.targetValue);
        nr.dispColor = mix(nr.dispColor, target, ct);
        nr.dispTrust = lerp(nr.dispTrust, nr.targetTrust, tt);
      });
      dispConv = lerp(dispConv, targetConv, vt);

      transmissions = transmissions.filter((t) => now < t.arrive);
      pops = pops.filter((p) => now - p.start < POP_MS);

      render(ts, now);
      // the ambient sweep keeps the scope alive, so we always keep drawing
      // (browsers throttle rAF when the tab is hidden, so this idles cheaply)
      if (!prefersReducedMotion) requestRender();
      else if (transmissions.length || pops.length || Math.abs(dispConv - targetConv) > 0.001) requestRender();
      else lastTs = 0;
    }

    // ---- rendering -------------------------------------------------------

    function nodeRadius(trust) {
      return NODE_R_MIN + (NODE_R_MAX - NODE_R_MIN) * clamp01(trust);
    }

    function render(ts, now) {
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

      drawScope(ts);
      drawChords();
      drawTransmissions(now);
      drawCore();
      drawNodes();
      drawPops(now);
    }

    // concentric scope rings + a slow rotating sweep
    function drawScope(ts) {
      [0.46, 0.73, 1.0].forEach((f) => {
        ctx.beginPath();
        ctx.arc(cx, cy, ringR * f, 0, Math.PI * 2);
        ctx.strokeStyle = rgbStr(theme.line, 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      if (prefersReducedMotion || typeof ctx.createConicGradient !== "function") return;
      const ang = ((ts - startTs) / SWEEP_PERIOD_MS) * Math.PI * 2;
      const g = ctx.createConicGradient(ang, cx, cy);
      g.addColorStop(0.0, rgbStr(theme.accent, 0));
      g.addColorStop(0.04, rgbStr(theme.accent, 0.12));
      g.addColorStop(0.14, rgbStr(theme.accent, 0));
      g.addColorStop(1.0, rgbStr(theme.accent, 0));
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }

    function edgeKey(a, b) {
      return a < b ? a + "|" + b : b + "|" + a;
    }

    function drawChords() {
      const active = new Set(transmissions.map((t) => edgeKey(t.from, t.to)));
      ctx.strokeStyle = rgbStr(theme.line, 0.5);
      ctx.lineWidth = 1;
      edges.forEach((e) => {
        if (active.has(edgeKey(e.a, e.b))) return;
        const na = runtime[e.a],
          nb = runtime[e.b];
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.quadraticCurveTo(e.ctrl.x, e.ctrl.y, nb.x, nb.y);
        ctx.stroke();
      });
    }

    function ctrlFor(a, b) {
      const e = edges.find((ed) => (ed.a === a && ed.b === b) || (ed.a === b && ed.b === a));
      if (e) return e.ctrl;
      const na = runtime[a],
        nb = runtime[b];
      return { x: lerp((na.x + nb.x) / 2, cx, BOW), y: lerp((na.y + nb.y) / 2, cy, BOW) };
    }

    function drawTransmissions(now) {
      transmissions.forEach((t) => {
        if (now < t.start) return;
        const na = runtime[t.from],
          nb = runtime[t.to];
        if (!na || !nb) return;
        const ctrl = ctrlFor(t.from, t.to);
        const progress = clamp01((now - t.start) / TRAVEL_MS);

        // the chord lights up in the belief's colour while the packet travels
        ctx.save();
        ctx.strokeStyle = rgbStr(t.color, 0.9);
        ctx.lineWidth = 2;
        ctx.shadowColor = rgbStr(t.color, 0.5);
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.quadraticCurveTo(ctrl.x, ctrl.y, nb.x, nb.y);
        ctx.stroke();

        // the packet
        const p = qbez(na, ctrl, nb, easeInOutQuad(progress));
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.fillStyle = rgbStr(t.color, 1);
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.fillStyle = rgbStr(theme.surface, 0.95);
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // the consensus core: a health gauge + the live convergence readout
    function drawCore() {
      const frac = clamp01(dispConv);
      const gaugeR = coreR;
      const health = mix(theme.red, theme.green, frac); // red → green as it heals

      // track
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR, 0, Math.PI * 2);
      ctx.strokeStyle = rgbStr(theme.line, 0.5);
      ctx.lineWidth = 3;
      ctx.stroke();
      // progress arc, from top, clockwise
      if (frac > 0.001) {
        ctx.beginPath();
        ctx.arc(cx, cy, gaugeR, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.strokeStyle = rgbStr(health, 0.95);
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.lineCap = "butt";
      }

      // inner disc masks the chords converging behind the core
      ctx.beginPath();
      ctx.arc(cx, cy, gaugeR - 7, 0, Math.PI * 2);
      ctx.fillStyle = theme.surfaceStr;
      ctx.fill();

      // big convergence number (the one serif moment)
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = theme.text2;
      ctx.font = `600 ${Math.round(coreR * 0.5)}px ${fonts.display}`;
      ctx.fillText(Math.round(frac * 100) + "%", cx, cy + coreR * 0.06);

      const status = frac >= 0.999 ? "CONSENSUS" : frac >= 0.6 ? "CONVERGING" : "CONTESTED";
      ctx.fillStyle = rgbStr(health, 0.9);
      ctx.font = `600 8.5px ${fonts.mono}`;
      ctx.textBaseline = "top";
      // letter-spaced status
      drawSpaced(status, cx, cy + coreR * 0.28, 1.5);
    }

    function drawSpaced(text, centerX, y, gap) {
      ctx.save();
      ctx.textAlign = "left";
      let total = 0;
      const widths = [];
      for (const ch of text) {
        const w = ctx.measureText(ch).width + gap;
        widths.push(w);
        total += w;
      }
      let x = centerX - total / 2;
      let i = 0;
      for (const ch of text) {
        ctx.fillText(ch, x, y);
        x += widths[i++];
      }
      ctx.restore();
    }

    function drawNodes() {
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const r = nodeRadius(nr.dispTrust);
        const isSelected = id === selectedId;
        const isHovered = id === hoveredId;

        // soft belief-coloured halo so blips read against the scope
        ctx.beginPath();
        ctx.arc(nr.x, nr.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = rgbStr(nr.dispColor, 0.12);
        ctx.fill();

        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(nr.x, nr.y, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = rgbStr(theme.accent, isSelected ? 0.9 : 0.45);
          ctx.lineWidth = isSelected ? 2 : 1.5;
          ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(nr.x, nr.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgbStr(nr.dispColor, 0.95);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgbStr(mix(nr.dispColor, { r: 0, g: 0, b: 0 }, 0.2), 1);
        ctx.stroke();

        if (revealRoles && nr.meta.role !== "honest") {
          const bx = nr.x + r * 0.72,
            by = nr.y - r * 0.72;
          ctx.beginPath();
          ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = rgbStr(theme.amber, 0.98);
          ctx.fill();
          ctx.strokeStyle = theme.surfaceStr;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = `700 8px ${fonts.mono}`;
          ctx.fillStyle = theme.surfaceStr;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("!", bx, by + 0.5);
        }

        // label just outside the ring, radiating outward
        const lx = cx + (ringR + r + 12) * Math.cos(nr.ang);
        const ly = cy + (ringR + r + 12) * Math.sin(nr.ang);
        ctx.font = `500 10px ${fonts.mono}`;
        ctx.fillStyle = isSelected || isHovered ? theme.text2 : theme.text3;
        ctx.textAlign = Math.abs(Math.cos(nr.ang)) < 0.35 ? "center" : Math.cos(nr.ang) > 0 ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(id, lx, ly);
      });
    }

    function drawPops(now) {
      pops.forEach((p) => {
        if (now < p.start) return;
        const nr = runtime[p.id];
        if (!nr) return;
        const progress = clamp01((now - p.start) / POP_MS);
        const base = nodeRadius(nr.dispTrust);
        const rr = base + 4 + easeOutCubic(progress) * 18;
        ctx.beginPath();
        ctx.arc(nr.x, nr.y, rr, 0, Math.PI * 2);
        ctx.strokeStyle = rgbStr(p.color, (1 - progress) * 0.85);
        ctx.lineWidth = 2.5 * (1 - progress) + 0.5;
        ctx.stroke();
      });
    }

    // ---- interaction -----------------------------------------------------

    function hitTest(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      let best = null,
        bestDist = Infinity;
      nodeIds.forEach((id) => {
        const nr = runtime[id];
        const dx = x - nr.x,
          dy = y - nr.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = nodeRadius(nr.dispTrust) + 7;
        if (dist <= hitR && dist < bestDist) {
          best = id;
          bestDist = dist;
        }
      });
      return best;
    }

    canvas.addEventListener("click", (e) => selectNode(hitTest(e.clientX, e.clientY)));
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
