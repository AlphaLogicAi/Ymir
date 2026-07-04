/**
 * Geometry helpers for ymir-local-si-v1 (canon §2).
 *
 * headingToXY is the ONLY heading-to-XY implementation (inherited law from
 * GardenOS canon); callers must not reimplement the conversion.
 *
 * Polygon predicates delegate to Turf.js (R-IMPL-001, locked).
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { polygon as turfPolygon, point as turfPoint } from "@turf/helpers";
import type {
  BoundingBox,
  CardinalDirection,
  Point,
  Polygon,
  Transform,
} from "./types.js";

/** Centimeter precision for stored coordinates and dimensions (R-GEO-001, locked). */
export function roundCm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundPoint(p: Point): Point {
  return { x: roundCm(p.x), y: roundCm(p.y) };
}

export function roundPolygon(poly: Polygon): Polygon {
  return { ring: poly.ring.map(roundPoint) };
}

export function roundTransform(t: Transform): Transform {
  const out: Transform = { x: roundCm(t.x), y: roundCm(t.y) };
  if (t.heading !== undefined) out.heading = normalizeHeading(t.heading);
  return out;
}

/** Normalize a heading into [0, 360). */
export function normalizeHeading(deg: number): number {
  const h = deg % 360;
  return h < 0 ? h + 360 : h;
}

/**
 * The canonical heading-to-XY conversion (canon §2.1, inherited unchanged):
 *   x = distance × sin(heading), y = distance × cos(heading)
 * Heading in degrees clockwise from north; converted to radians here.
 * Callers must not reimplement this conversion.
 */
export function headingToXY(headingDeg: number, distance: number): Point {
  const rad = (normalizeHeading(headingDeg) * Math.PI) / 180;
  return { x: distance * Math.sin(rad), y: distance * Math.cos(rad) };
}

/**
 * Derived-only cardinal direction from a heading (canon §4.3 / R-GEO-004).
 * Eight 45° sectors centered on the cardinals: N = [337.5, 22.5), etc.
 * Never persisted.
 */
export function exposureDirection(headingDeg: number): CardinalDirection {
  const sectors: CardinalDirection[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const h = normalizeHeading(headingDeg);
  const index = Math.floor(((h + 22.5) % 360) / 45);
  return sectors[index]!;
}

/** True if the ring is closed: final point repeats the first (canon §2.1). */
export function isClosedRing(ring: Point[]): boolean {
  if (ring.length < 4) return false; // triangle needs 3 distinct + closing point
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first.x === last.x && first.y === last.y;
}

/** Close a ring if it is not already closed. */
export function closeRing(ring: Point[]): Point[] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first.x === last.x && first.y === last.y) return ring;
  return [...ring, { ...first }];
}

/** Shoelace area of a closed ring, m². Always positive. */
export function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonArea(poly: Polygon): number {
  return ringArea(poly.ring);
}

/** Centroid of a closed polygon ring (area-weighted; falls back to vertex mean for degenerate rings). */
export function polygonCentroid(poly: Polygon): Point {
  const ring = poly.ring;
  let areaSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const cross = a.x * b.y - b.x * a.y;
    areaSum += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (areaSum === 0) {
    // degenerate: mean of distinct vertices
    const pts = ring.slice(0, -1);
    const n = pts.length || 1;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / n,
      y: pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * areaSum), y: cy / (3 * areaSum) };
}

export function boundingBox(poly: Polygon): BoundingBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly.ring) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Point-in-polygon via Turf.js (R-IMPL-001). Turf expects GeoJSON positions;
 * our local frame maps directly onto [x, y] positions — the predicate is
 * planar and coordinate-system agnostic at property scale.
 */
export function pointInPolygon(point: Point, poly: Polygon): boolean {
  const coords = poly.ring.map((p) => [p.x, p.y]);
  const turfPoly = turfPolygon([coords]);
  return booleanPointInPolygon(turfPoint([point.x, point.y]), turfPoly);
}

/**
 * The centroid of a feature's occupied space in the CONTAINER frame:
 * feature geometry centroid (if present) rotated by heading and translated by
 * position; otherwise the position itself.
 */
export function placedCentroid(position: Transform, geometry?: Polygon): Point {
  if (!geometry || geometry.ring.length === 0) return { x: position.x, y: position.y };
  const local = polygonCentroid(geometry);
  const headingDeg = position.heading ?? 0;
  const rad = (normalizeHeading(headingDeg) * Math.PI) / 180;
  // Rotation by heading (clockwise-from-north convention): a feature-local
  // +Y axis points along the heading. Equivalent to rotating the local frame
  // by -heading in standard math convention.
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: position.x + local.x * cos + local.y * sin,
    y: position.y - local.x * sin + local.y * cos,
  };
}

/** Derive boundary measurements — deliberately absent from persistence (canon §3.1). */
export function deriveBoundaryMeasurements(boundary: Polygon): {
  boundary_area: number;
  bounding_box: BoundingBox;
} {
  return {
    boundary_area: polygonArea(boundary),
    bounding_box: boundingBox(boundary),
  };
}
