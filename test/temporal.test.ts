/**
 * FLAGSHIP acceptance tests — canon §5 temporal modeling, §5.4 positional
 * versioning. property_at(date) must return full as-of SPATIAL STATE via
 * change-log replay, not merely as-of existence.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YmirEngine } from "../src/engine.js";
import { activeAt, normalizeTimestamp } from "../src/temporal.js";

const square = (size: number, ox = 0, oy = 0) => ({
  ring: [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
    { x: ox, y: oy },
  ],
});

describe("R-TIME-001 — timestamp normalization", () => {
  it("date-only inputs default to start of day, full datetimes pass through", () => {
    expect(normalizeTimestamp("2024-06-30")).toBe("2024-06-30T00:00:00.000Z");
    expect(normalizeTimestamp("2024-06-30T15:30:00.000Z")).toBe("2024-06-30T15:30:00.000Z");
    expect(() => normalizeTimestamp("not-a-date")).toThrowError(/invalid ISO 8601/);
  });
});

describe("A-003 — temporal envelope [from, to] inclusive at instant granularity", () => {
  it("treats a feature as active on its from and to instants, not after", () => {
    const env = { from: "2024-01-01T00:00:00.000Z", to: "2024-06-30T00:00:00.000Z" };
    expect(activeAt(env, "2024-01-01T00:00:00.000Z")).toBe(true);
    expect(activeAt(env, "2024-03-15T00:00:00.000Z")).toBe(true);
    expect(activeAt(env, "2024-06-30T00:00:00.000Z")).toBe(true);
    expect(activeAt(env, "2024-06-30T00:00:00.001Z")).toBe(false);
    expect(activeAt(env, "2023-12-31T23:59:59.999Z")).toBe(false);
  });
});

describe("canon §5.1 — kitchen renovation example reconstructs exactly", () => {
  it("returns the old kitchen before the renovation and the new one after", () => {
    const engine = new YmirEngine(":memory:");
    const pid = engine.createProperty(
      { name: "House", boundary: square(30) },
      { at: "2010-01-01" },
    ).value.id;
    const oldKitchen = engine.addFeature(
      pid,
      { name: "Kitchen", kind: "fixture", position: { x: 5, y: 5 } },
      { at: "2010-03-15" },
    ).value;
    engine.removeFeature(oldKitchen.id, "renovated", { at: "2022-06-30" });
    const newKitchen = engine.addFeature(
      pid,
      { name: "Kitchen (2022)", kind: "fixture", position: { x: 5, y: 5 } },
      { at: "2022-07-01" },
    ).value;

    const before = engine.propertyAt(pid, "2022-06-01");
    expect(before.features.map((f) => f.id)).toEqual([oldKitchen.id]);

    const after = engine.propertyAt(pid, "2022-08-01");
    expect(after.features.map((f) => f.id)).toEqual([newKitchen.id]);
    engine.close();
  });
});

describe("canon §5.4 — FLAGSHIP: full historical reconstruction via change-log replay", () => {
  let engine: YmirEngine;
  let pid: string;
  let bedA: string;
  let bedB: string;
  let greenhouse: string;

  beforeEach(() => {
    engine = new YmirEngine(":memory:");
    // 2024-03-01: property with front yard, bed A at (10,5), greenhouse at (30,20)
    pid = engine.createProperty({ name: "Homestead", boundary: square(100) }, { at: "2024-03-01" }).value.id;
    engine.addArea(
      pid,
      { id: "front-yard", name: "Front Yard", kind: "outdoor_yard", geometry: square(50) },
      { at: "2024-03-01" },
    );
    bedA = engine.addFeature(
      pid,
      {
        name: "Bed A",
        kind: "raised_bed",
        position: { x: 10, y: 5 },
        dimensions: { width_m: 1.2, depth_m: 2.4, height_m: 0.3 },
        parent_area_id: "front-yard",
      },
      { at: "2024-03-01" },
    ).value.id;
    greenhouse = engine.addFeature(
      pid,
      { name: "Greenhouse", kind: "greenhouse", position: { x: 30, y: 20 } },
      { at: "2024-03-01" },
    ).value.id;
    // 2024-04-15: bed A moves
    engine.moveFeature(bedA, { x: 12, y: 8 }, { at: "2024-04-15" });
    // 2024-05-01: bed B added
    bedB = engine.addFeature(
      pid,
      { name: "Bed B", kind: "raised_bed", position: { x: 14, y: 3 }, parent_area_id: "front-yard" },
      { at: "2024-05-01" },
    ).value.id;
    // 2024-06-10: bed A resized
    engine.resizeFeature(bedA, { width_m: 1.2, depth_m: 3.6, height_m: 0.3 }, { at: "2024-06-10" });
    // 2024-07-01: greenhouse demolished
    engine.removeFeature(greenhouse, "demolished", { at: "2024-07-01" });
    // 2024-08-20: bed A moves again
    engine.moveFeature(bedA, { x: 15, y: 10 }, { at: "2024-08-20" });
  });

  afterEach(() => engine.close());

  it("March 15: bed A at its ORIGINAL position, greenhouse present, no bed B", () => {
    const state = engine.propertyAt(pid, "2024-03-15");
    const a = state.features.find((f) => f.id === bedA)!;
    expect(a.position).toEqual({ x: 10, y: 5 });
    expect(a.dimensions?.depth_m).toBe(2.4);
    expect(state.features.some((f) => f.id === greenhouse)).toBe(true);
    expect(state.features.some((f) => f.id === bedB)).toBe(false);
  });

  it("April 20: bed A at (12,8) — as-of state, not current state", () => {
    const a = engine.propertyAt(pid, "2024-04-20").features.find((f) => f.id === bedA)!;
    expect(a.position).toEqual({ x: 12, y: 8 });
    // current state differs — the flagship distinction
    expect(engine.getFeature(bedA).position).toEqual({ x: 15, y: 10 });
  });

  it("May 15: bed B has appeared", () => {
    const state = engine.propertyAt(pid, "2024-05-15");
    expect(state.features.some((f) => f.id === bedB)).toBe(true);
  });

  it("June 15: bed A carries its resized dimensions but pre-final position", () => {
    const a = engine.propertyAt(pid, "2024-06-15").features.find((f) => f.id === bedA)!;
    expect(a.dimensions?.depth_m).toBe(3.6);
    expect(a.position).toEqual({ x: 12, y: 8 });
  });

  it("July 15: greenhouse gone; beds remain", () => {
    const state = engine.propertyAt(pid, "2024-07-15");
    expect(state.features.some((f) => f.id === greenhouse)).toBe(false);
    expect(state.features.some((f) => f.id === bedA)).toBe(true);
    expect(state.features.some((f) => f.id === bedB)).toBe(true);
  });

  it("greenhouse removal boundary: active on its removal instant, gone after (A-003)", () => {
    expect(
      engine.propertyAt(pid, "2024-07-01").features.some((f) => f.id === greenhouse),
    ).toBe(true);
    expect(
      engine.propertyAt(pid, "2024-07-02").features.some((f) => f.id === greenhouse),
    ).toBe(false);
  });

  it("September 1: bed A at its final position; replay converges with current state", () => {
    const replayed = engine.propertyAt(pid, "2024-09-01").features.find((f) => f.id === bedA)!;
    const current = engine.getFeature(bedA);
    expect(replayed.position).toEqual({ x: 15, y: 10 });
    expect(replayed.position).toEqual(current.position);
    expect(replayed.dimensions).toEqual(current.dimensions);
  });

  it("before the property existed: no features at all", () => {
    const state = engine.propertyAt(pid, "2024-01-01");
    expect(state.features).toHaveLength(0);
    expect(state.areas).toHaveLength(0);
  });

  it("featuresActiveAt matches propertyAt's feature set (canon §5.2)", () => {
    const viaProperty = engine.propertyAt(pid, "2024-05-15").features.map((f) => f.id).sort();
    const direct = engine.featuresActiveAt(pid, "2024-05-15").map((f) => f.id).sort();
    expect(direct).toEqual(viaProperty);
  });

  it("featureHistory returns the full ordered event timeline (canon §5.2)", () => {
    const history = engine.featureHistory(bedA);
    expect(history.map((c) => c.event_kind)).toEqual([
      "feature_added",
      "feature_moved",
      "feature_resized",
      "feature_moved",
    ]);
    // each mutation carries before/after spatial snapshots
    const firstMove = history[1]!;
    expect(firstMove.before?.position).toEqual({ x: 10, y: 5 });
    expect(firstMove.after?.position).toEqual({ x: 12, y: 8 });
  });

  it("removed features report their removal reason in the temporal envelope", () => {
    const july = engine.propertyAt(pid, "2024-06-20");
    const gh = july.features.find((f) => f.id === greenhouse)!;
    expect(gh.status).toBe("active");
    const current = engine.getFeature(greenhouse);
    expect(current.status).toBe("removed");
    expect(current.temporal_envelope.note).toBe("demolished");
    expect(current.temporal_envelope.to).toBe("2024-07-01T00:00:00.000Z");
  });
});

describe("canon §5.4 — backdated writes replay at their effective time (A-002)", () => {
  it("a correction entered later still lands at its effective date in replay", () => {
    const engine = new YmirEngine(":memory:");
    const pid = engine.createProperty({ name: "P", boundary: square(50) }, { at: "2024-01-01" }).value.id;
    const f = engine.addFeature(
      pid,
      { name: "Bench", kind: "furniture", position: { x: 1, y: 1 } },
      { at: "2024-02-01" },
    ).value;
    // entered "now", effective in March — between two later moves
    engine.moveFeature(f.id, { x: 9, y: 9 }, { at: "2024-06-01" });
    engine.moveFeature(f.id, { x: 5, y: 5 }, { at: "2024-03-01" }); // backdated entry
    const april = engine.propertyAt(pid, "2024-04-01").features[0]!;
    expect(april.position).toEqual({ x: 5, y: 5 });
    const july = engine.propertyAt(pid, "2024-07-01").features[0]!;
    expect(july.position).toEqual({ x: 9, y: 9 });
    engine.close();
  });
});

describe("canon §5.4 — area geometry changes replay too", () => {
  it("returns as-of area geometry", () => {
    const engine = new YmirEngine(":memory:");
    const pid = engine.createProperty({ name: "P", boundary: square(100) }, { at: "2024-01-01" }).value.id;
    const area = engine.addArea(
      pid,
      { name: "Garden", kind: "outdoor_garden", geometry: square(10) },
      { at: "2024-01-01" },
    ).value;
    engine.modifyAreaGeometry(area.id, square(20), { at: "2024-06-01" });
    expect(engine.propertyAt(pid, "2024-03-01").areas[0]!.area_m2).toBe(100);
    expect(engine.propertyAt(pid, "2024-07-01").areas[0]!.area_m2).toBe(400);
    engine.close();
  });
});
