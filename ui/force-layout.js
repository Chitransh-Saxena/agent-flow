// force-layout.js
//
// A small, dependency-free force-directed graph layout (Fruchterman–Reingold,
// 1991). No external library — this is the whole point: hand-rolling it is
// a better showcase than importing d3-force for a graph this size.
//
// The idea: treat every node as a charged particle that repels every other
// node, and every edge as a spring that pulls its two endpoints together.
// Run that simulation for a fixed number of steps while a shrinking
// "temperature" caps how far a node may move per step — that's what makes
// the system settle into a stable layout instead of oscillating forever.
//
// This module is pure/headless: it knows nothing about canvas, DOM, or
// pixels. It hands back positions in an abstract layout space; pixel
// fitting is a separate, cheap step (`fitToViewport`) so resizing the
// window never requires re-running the physics.

window.GossipRAG = window.GossipRAG || {};

(function () {
  "use strict";

  /**
   * @param {string[]} nodeIds
   * @param {Array<[string,string]>} edges
   * @param {object} [options]
   * @param {number} [options.iterations=320]
   * @param {number} [options.areaSide=1000]   abstract layout space size
   * @param {number} [options.gravity=0.02]    pull-to-center strength
   * @param {number} [options.seed=1337]       seeded PRNG so re-loading the
   *                                            same trace produces the same
   *                                            layout every time
   * @returns {Object<string,{x:number,y:number}>}
   */
  function forceDirectedLayout(nodeIds, edges, options) {
    options = options || {};
    const n = nodeIds.length;
    if (n === 0) return {};

    const iterations = options.iterations || 320;
    const areaSide = options.areaSide || 1000;
    // Ideal edge length: the classic FR choice, k = C * sqrt(area / n).
    const k = options.springLength || areaSide / Math.sqrt(n);
    const gravity = options.gravity != null ? options.gravity : 0.02;
    const rand = mulberry32(options.seed || 1337);

    // Validate edges against known node ids defensively — future scenario
    // trace files are machine-generated, so don't trust them blindly.
    const knownIds = new Set(nodeIds);
    const cleanEdges = (edges || []).filter(
      (e) => Array.isArray(e) && knownIds.has(e[0]) && knownIds.has(e[1]) && e[0] !== e[1]
    );

    // Seed positions on a circle + small jitter. This avoids the degenerate
    // "everyone starts at the origin" case (zero distance -> undefined
    // repulsion direction) and gives the solver a sane head start.
    const pos = {};
    nodeIds.forEach((id, i) => {
      const angle = (i / n) * Math.PI * 2;
      const r = areaSide * 0.3;
      pos[id] = {
        x: Math.cos(angle) * r + (rand() - 0.5) * 20,
        y: Math.sin(angle) * r + (rand() - 0.5) * 20,
      };
    });
    if (n === 1) return pos;

    let temperature = areaSide * 0.1;
    const cooling = temperature / iterations;
    const disp = {};

    for (let iter = 0; iter < iterations; iter++) {
      nodeIds.forEach((id) => {
        disp[id] = { x: 0, y: 0 };
      });

      // Repulsion: every pair of nodes pushes apart, like same-sign charges.
      // O(n^2) — perfectly fine at the node counts this project deals with
      // (tens of nodes; even a few hundred would still run in milliseconds).
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = nodeIds[i];
          const b = nodeIds[j];
          const dx = pos[a].x - pos[b].x;
          const dy = pos[a].y - pos[b].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const force = (k * k) / dist;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          disp[a].x += fx;
          disp[a].y += fy;
          disp[b].x -= fx;
          disp[b].y -= fy;
        }
      }

      // Attraction: each topology edge behaves like a spring pulling its
      // endpoints together, proportional to distance squared.
      for (let i = 0; i < cleanEdges.length; i++) {
        const a = cleanEdges[i][0];
        const b = cleanEdges[i][1];
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (dist * dist) / k;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        disp[a].x -= fx;
        disp[a].y -= fy;
        disp[b].x += fx;
        disp[b].y += fy;
      }

      // Mild gravity toward the origin. Keeps disconnected components (or a
      // future scenario file with an unexpectedly sparse topology) from
      // drifting off into empty space instead of settling near the center.
      nodeIds.forEach((id) => {
        disp[id].x -= pos[id].x * gravity;
        disp[id].y -= pos[id].y * gravity;
      });

      // Apply the displacement, capped by the current temperature, then
      // cool down. This is what makes the layout converge instead of
      // bouncing around forever.
      nodeIds.forEach((id) => {
        const d = disp[id];
        const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
        const capped = Math.min(dist, temperature);
        pos[id].x += (d.x / dist) * capped;
        pos[id].y += (d.y / dist) * capped;
      });

      temperature = Math.max(temperature - cooling, 0.01);
    }

    return pos;
  }

  /**
   * Maps abstract layout-space positions into pixel coordinates that fit
   * inside a width x height viewport, preserving aspect ratio and centering
   * the result. Cheap enough to call on every resize — no need to re-run
   * the physics simulation just because the window changed size.
   */
  function fitToViewport(positions, nodeIds, width, height, padding) {
    padding = padding == null ? 48 : padding;
    if (nodeIds.length === 0) return {};

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    nodeIds.forEach((id) => {
      const p = positions[id];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    // Single-node graphs have zero span; guard divide-by-zero.
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const availW = Math.max(width - padding * 2, 1);
    const availH = Math.max(height - padding * 2, 1);
    const scale = Math.min(availW / spanX, availH / spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const out = {};
    nodeIds.forEach((id) => {
      const p = positions[id];
      out[id] = {
        x: width / 2 + (p.x - cx) * scale,
        y: height / 2 + (p.y - cy) * scale,
      };
    });
    return out;
  }

  // Deterministic PRNG (mulberry32) so the same trace file lays out the
  // same way every time the page loads — no library, ~6 lines.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.GossipRAG.forceDirectedLayout = forceDirectedLayout;
  window.GossipRAG.fitToViewport = fitToViewport;
})();
