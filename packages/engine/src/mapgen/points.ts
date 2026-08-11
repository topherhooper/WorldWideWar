/**
 * Wedge-symmetric point placement.
 *
 * Points are sampled inside a single angular wedge and then rotated P times, so
 * the resulting point set — and therefore the Voronoi diagram, the adjacency
 * graph, the regions and the starting positions derived from it — is exactly
 * P-fold rotationally symmetric.
 */

import type { Rng } from '../rng.js';
import type { SymmetryLayout } from './symmetry.js';

/** World radius in integer units. Coordinates are quantised to this scale. */
export const WORLD_RADIUS = 10_000;

/** Wedge points stay clear of the centre so the central territory has room. */
const INNER_RADIUS_FRACTION = 0.22;

/**
 * Sentinels sit beyond the playable disc purely to bound the outer Voronoi
 * cells. Placing them in a ring rather than clipping to a circle is what gives
 * the world an organic coastline: the boundary between an outer territory and a
 * sentinel is a natural Voronoi edge, so the coast comes out irregular instead
 * of a smooth arc — and, because the ring is itself symmetric, irregular in the
 * same way for every player.
 */
const SENTINEL_RADIUS_FRACTION = 1.32;
const SENTINELS_PER_WEDGE = 3;

export interface Polar {
  r: number;
  theta: number;
}

export function polarToCartesian(p: Polar): [number, number] {
  return [p.r * Math.cos(p.theta), p.r * Math.sin(p.theta)];
}

/**
 * Samples `perWedge` points inside one wedge with a Poisson-disc minimum
 * spacing, by dart throwing with progressive relaxation of the spacing.
 *
 * Distance checks wrap around the wedge boundary — a candidate is compared
 * against each existing point *and* against that point's neighbouring-wedge
 * copies. Without that, points would clump along the seams where the wedge
 * meets its rotated neighbours, and every seam in the world would show it.
 */
export function sampleWedge(rng: Rng, layout: SymmetryLayout): Polar[] {
  const wedgeAngle = (2 * Math.PI) / layout.playerCount;
  const innerRadius = WORLD_RADIUS * INNER_RADIUS_FRACTION;
  const area = (wedgeAngle / 2) * (WORLD_RADIUS ** 2 - innerRadius ** 2);

  // Start optimistic about spacing and relax until the wedge fills.
  let minDistance = 0.8 * Math.sqrt(area / layout.perWedge);

  for (let relaxation = 0; relaxation < 40; relaxation++) {
    const accepted = tryFill(rng, layout, wedgeAngle, innerRadius, minDistance);
    if (accepted.length === layout.perWedge) return accepted;
    minDistance *= 0.92;
  }

  // Spacing has been relaxed far past anything sensible; fall back to an even
  // spiral so generation always terminates with a usable wedge.
  return evenSpiral(layout, wedgeAngle, innerRadius);
}

function tryFill(
  rng: Rng,
  layout: SymmetryLayout,
  wedgeAngle: number,
  innerRadius: number,
  minDistance: number,
): Polar[] {
  const accepted: Polar[] = [];
  const acceptedXy: [number, number][] = [];
  const minSquared = minDistance * minDistance;
  const maxAttempts = 3000;

  for (let attempt = 0; attempt < maxAttempts && accepted.length < layout.perWedge; attempt++) {
    // Uniform over the annulus sector: sqrt keeps density even in r.
    const u = rng.float();
    const r = Math.sqrt(innerRadius ** 2 + u * (WORLD_RADIUS ** 2 - innerRadius ** 2));
    const theta = rng.float() * wedgeAngle;
    const candidate: Polar = { r, theta };
    const [cx, cy] = polarToCartesian(candidate);

    let ok = true;
    for (let i = 0; i < acceptedXy.length && ok; i++) {
      const existing = accepted[i];
      // Compare against the point and its two adjacent-wedge copies.
      for (let shift = -1; shift <= 1; shift++) {
        const [px, py] = polarToCartesian({
          r: existing.r,
          theta: existing.theta + shift * wedgeAngle,
        });
        const dx = cx - px;
        const dy = cy - py;
        if (dx * dx + dy * dy < minSquared) {
          ok = false;
          break;
        }
      }
    }

    if (ok) {
      accepted.push(candidate);
      acceptedXy.push([cx, cy]);
    }
  }

  return accepted;
}

/** Deterministic fallback: an even spiral through the wedge. */
function evenSpiral(layout: SymmetryLayout, wedgeAngle: number, innerRadius: number): Polar[] {
  const out: Polar[] = [];
  for (let i = 0; i < layout.perWedge; i++) {
    const t = (i + 0.5) / layout.perWedge;
    out.push({
      r: innerRadius + t * (WORLD_RADIUS - innerRadius),
      theta: ((i * 0.618034) % 1) * wedgeAngle,
    });
  }
  return out;
}

/**
 * Expands wedge-local polar coordinates into world positions for every
 * territory, indexed by territory id, with the centre last.
 */
export function expandPositions(
  layout: SymmetryLayout,
  wedge: readonly Polar[],
): [number, number][] {
  const wedgeAngle = (2 * Math.PI) / layout.playerCount;
  const positions: [number, number][] = new Array(layout.count);

  for (let local = 0; local < layout.perWedge; local++) {
    const base = wedge[local];
    for (let w = 0; w < layout.playerCount; w++) {
      positions[local * layout.playerCount + w] = polarToCartesian({
        r: base.r,
        theta: base.theta + w * wedgeAngle,
      });
    }
  }
  positions[layout.centre] = [0, 0];
  return positions;
}

/** The symmetric ring of out-of-play points that bounds the outer cells. */
export function sentinelRing(layout: SymmetryLayout): [number, number][] {
  const wedgeAngle = (2 * Math.PI) / layout.playerCount;
  const radius = WORLD_RADIUS * SENTINEL_RADIUS_FRACTION;
  const out: [number, number][] = [];

  for (let w = 0; w < layout.playerCount; w++) {
    for (let j = 0; j < SENTINELS_PER_WEDGE; j++) {
      const theta = w * wedgeAngle + (j / SENTINELS_PER_WEDGE) * wedgeAngle;
      out.push([radius * Math.cos(theta), radius * Math.sin(theta)]);
    }
  }
  return out;
}

/**
 * One round of Lloyd relaxation, re-symmetrised.
 *
 * Relaxation evens out cell sizes, but running it on all P wedges
 * independently would let floating-point error accumulate differently in each.
 * Instead we relax, then read the new positions back out of wedge 0 only and
 * re-replicate them, so the point set stays exactly symmetric no matter how
 * many rounds we run.
 */
export function relaxWedge(
  layout: SymmetryLayout,
  wedge: readonly Polar[],
  centroids: readonly ([number, number] | null)[],
): Polar[] {
  const out: Polar[] = [];
  for (let local = 0; local < layout.perWedge; local++) {
    const centroid = centroids[local * layout.playerCount];
    if (!centroid) {
      out.push(wedge[local]);
      continue;
    }
    const [x, y] = centroid;
    const r = Math.hypot(x, y);
    // Keep points inside the playable disc and clear of the centre.
    const clamped = Math.min(WORLD_RADIUS, Math.max(WORLD_RADIUS * INNER_RADIUS_FRACTION, r));
    out.push({ r: clamped, theta: Math.atan2(y, x) });
  }
  return out;
}

/** Area-weighted centroid of a closed polygon ring. */
export function polygonCentroid(points: readonly [number, number][]): [number, number] | null {
  if (points.length < 3) return null;

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  if (Math.abs(area) < 1e-9) return null;
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}
