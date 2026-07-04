import { describe, expect, it } from "vitest";
import {
  boundingBox,
  closeRing,
  deriveBoundaryMeasurements,
  exposureDirection,
  headingToXY,
  isClosedRing,
  normalizeHeading,
  placedCentroid,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  roundCm,
} from "../src/geometry.js";

const square = (size: number, ox = 0, oy = 0) => ({
  ring: [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
    { x: ox, y: oy },
  ],
});

describe("canon §2.1 — ymir-local-si-v1 coordinate convention", () => {
  it("headingToXY: x = d·sin(h), y = d·cos(h) — the only heading-to-XY implementation", () => {
    // 0° north → +Y
    expect(headingToXY(0, 10).x).toBeCloseTo(0);
    expect(headingToXY(0, 10).y).toBeCloseTo(10);
    // 90° east → +X
    expect(headingToXY(90, 10).x).toBeCloseTo(10);
    expect(headingToXY(90, 10).y).toBeCloseTo(0);
    // 180° south → -Y
    expect(headingToXY(180, 10).y).toBeCloseTo(-10);
    // 270° west → -X
    expect(headingToXY(270, 10).x).toBeCloseTo(-10);
  });

  it("normalizes headings into [0, 360)", () => {
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(450)).toBe(90);
    expect(normalizeHeading(360)).toBe(0);
  });

  it("polygon rings are closed: final point repeats the first", () => {
    expect(isClosedRing(square(4).ring)).toBe(true);
    expect(isClosedRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    const closed = closeRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(isClosedRing(closed)).toBe(true);
  });
});

describe("canon §4.3 / R-GEO-004 — derived-only exposure direction", () => {
  it("maps headings to eight 45° cardinal sectors", () => {
    expect(exposureDirection(0)).toBe("N");
    expect(exposureDirection(22)).toBe("N");
    expect(exposureDirection(23)).toBe("NE");
    expect(exposureDirection(90)).toBe("E");
    expect(exposureDirection(135)).toBe("SE");
    expect(exposureDirection(180)).toBe("S");
    expect(exposureDirection(225)).toBe("SW");
    expect(exposureDirection(270)).toBe("W");
    expect(exposureDirection(315)).toBe("NW");
    expect(exposureDirection(338)).toBe("N");
    expect(exposureDirection(-45)).toBe("NW");
  });
});

describe("R-GEO-001 — centimeter precision", () => {
  it("rounds to 0.01 m", () => {
    expect(roundCm(1.2345)).toBe(1.23);
    expect(roundCm(1.235)).toBe(1.24);
    expect(roundCm(-0.005)).toBe(-0);
  });
});

describe("canon §3.1 — derived boundary measurements (never persisted)", () => {
  it("computes shoelace area and bounding box", () => {
    const poly = square(10);
    expect(polygonArea(poly)).toBe(100);
    expect(boundingBox(poly)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    const derived = deriveBoundaryMeasurements(poly);
    expect(derived.boundary_area).toBe(100);
  });

  it("computes centroid of a square at its center", () => {
    const c = polygonCentroid(square(10, 5, 5));
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(10);
  });
});

describe("R-IMPL-001 — Turf.js point-in-polygon", () => {
  it("classifies interior and exterior points", () => {
    const poly = square(20);
    expect(pointInPolygon({ x: 10, y: 10 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 25, y: 10 }, poly)).toBe(false);
  });
});

describe("placedCentroid — feature-local geometry placed in the container frame", () => {
  it("uses position alone when the feature has no footprint", () => {
    expect(placedCentroid({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("translates the footprint centroid by the position", () => {
    const c = placedCentroid({ x: 10, y: 20 }, square(2));
    expect(c.x).toBeCloseTo(11);
    expect(c.y).toBeCloseTo(21);
  });

  it("rotates the footprint by heading (clockwise from north)", () => {
    // centroid of the unit square footprint is (1,1); rotated 90° clockwise it lands at (1,-1) relative
    const c = placedCentroid({ x: 0, y: 0, heading: 90 }, square(2));
    expect(c.x).toBeCloseTo(1);
    expect(c.y).toBeCloseTo(-1);
  });
});
