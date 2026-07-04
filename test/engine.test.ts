import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YmirEngine } from "../src/engine.js";
import { YmirValidationError, type SpatialChange } from "../src/types.js";
import { isCoreFeatureKind, isDomainFeatureKind, isValidFeatureKind } from "../src/types.js";

const square = (size: number, ox = 0, oy = 0) => ({
  ring: [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
    { x: ox, y: oy },
  ],
});

let engine: YmirEngine;
let propertyId: string;

beforeEach(() => {
  engine = new YmirEngine(":memory:");
  propertyId = engine.createProperty({
    name: "Test Property",
    boundary: square(100),
  }).value.id;
});

afterEach(() => engine.close());

describe("canon §3.3.1 / R-DOMAIN-001 — hybrid FeatureKind", () => {
  it("accepts core enum kinds", () => {
    const r = engine.addFeature(propertyId, {
      name: "Oak",
      kind: "tree",
      position: { x: 10, y: 10 },
    });
    expect(r.value.kind).toBe("tree");
  });

  it("accepts domain-namespaced kinds without a schema change", () => {
    const r = engine.addFeature(propertyId, {
      name: "Zone Valve",
      kind: "domain:irrigation_valve",
      position: { x: 5, y: 5 },
    });
    expect(r.value.kind).toBe("domain:irrigation_valve");
    // stored and indexed identically to core kinds
    expect(engine.getFeatures(propertyId, { kind: "domain:irrigation_valve" })).toHaveLength(1);
  });

  it("rejects kinds that are neither core nor domain-namespaced", () => {
    expect(() =>
      engine.addFeature(propertyId, { name: "X", kind: "bogus" as never, position: { x: 1, y: 1 } }),
    ).toThrowError(/neither a core FeatureKind nor a 'domain:'/);
  });

  it("classifier helpers agree with the hybrid model", () => {
    expect(isCoreFeatureKind("raised_bed")).toBe(true);
    expect(isDomainFeatureKind("domain:garden:trellis_wire")).toBe(true);
    expect(isValidFeatureKind("domain:")).toBe(false);
    expect(isValidFeatureKind("gnome")).toBe(false);
  });
});

describe("canon §4.4 / R-CONSTRAINT-002 — circular containment rejects unconditionally", () => {
  it("rejects a self-parent", () => {
    const bed = engine.addFeature(propertyId, {
      id: "bed-1",
      name: "Bed",
      kind: "raised_bed",
      position: { x: 10, y: 10 },
    }).value;
    expect(() => engine.recontainFeature(bed.id, { parent_feature_id: bed.id })).toThrowError(
      YmirValidationError,
    );
  });

  it("rejects a two-node cycle, even with force", () => {
    const a = engine.addFeature(propertyId, { name: "A", kind: "shelf", position: { x: 1, y: 1 } }).value;
    const b = engine.addFeature(propertyId, {
      name: "B",
      kind: "container",
      position: { x: 1, y: 1 },
      parent_feature_id: a.id,
    }).value;
    expect(() =>
      engine.recontainFeature(a.id, { parent_feature_id: b.id }, { force: true, strict: true }),
    ).toThrowError(/containment cycle/);
  });
});

describe("canon §4.4 / R-CONSTRAINT-003 — centroid containment warns; strict rejects; force overrides logged", () => {
  it("warns but writes when the centroid falls outside the property boundary", () => {
    const r = engine.addFeature(propertyId, {
      name: "Stray Shed",
      kind: "shed",
      position: { x: 500, y: 500 },
    });
    expect(r.warnings.some((w) => w.code === "centroid_outside_container")).toBe(true);
    expect(engine.getFeature(r.value.id).position.x).toBe(500);
  });

  it("warns against the parent area geometry when contained in an area", () => {
    const area = engine.addArea(propertyId, {
      name: "Front Yard",
      kind: "outdoor_yard",
      geometry: square(20),
    }).value;
    const inside = engine.addFeature(propertyId, {
      name: "Bed In",
      kind: "raised_bed",
      position: { x: 5, y: 5 },
      parent_area_id: area.id,
    });
    expect(inside.warnings).toHaveLength(0);
    const outside = engine.addFeature(propertyId, {
      name: "Bed Out",
      kind: "raised_bed",
      position: { x: 50, y: 50 },
      parent_area_id: area.id,
    });
    expect(outside.warnings.some((w) => w.code === "centroid_outside_container")).toBe(true);
  });

  it("strict mode upgrades the warning to a rejection", () => {
    expect(() =>
      engine.addFeature(
        propertyId,
        { name: "Stray", kind: "shed", position: { x: 500, y: 500 } },
        { strict: true },
      ),
    ).toThrowError(/strict/i);
  });

  it("force proceeds despite strict, with a logged override (R-API-003)", () => {
    const r = engine.addFeature(
      propertyId,
      { name: "Forced", kind: "shed", position: { x: 500, y: 500 } },
      { strict: true, force: true },
    );
    expect(r.warnings.some((w) => w.code === "forced_override")).toBe(true);
    // the override is recorded in the change log
    const changes = engine.getChangesSince(propertyId);
    const change = changes.find((c) => c.affected_ids.includes(r.value.id))!;
    const logged = (change.details["warnings"] as { code: string }[]).map((w) => w.code);
    expect(logged).toContain("forced_override");
  });
});

describe("canon §4.4 — hard invariants", () => {
  it("rejects duplicate feature IDs within property scope", () => {
    engine.addFeature(propertyId, { id: "f1", name: "One", kind: "tree", position: { x: 1, y: 1 } });
    expect(() =>
      engine.addFeature(propertyId, { id: "f1", name: "Two", kind: "tree", position: { x: 2, y: 2 } }),
    ).toThrowError(/already exists/);
  });

  it("rejects temporal inconsistency (removal before creation)", () => {
    const f = engine.addFeature(
      propertyId,
      { name: "Ephemeral", kind: "container", position: { x: 1, y: 1 } },
      { at: "2024-06-01" },
    ).value;
    expect(() => engine.removeFeature(f.id, "time travel", { at: "2024-01-01" })).toThrowError(
      /temporal envelope/,
    );
  });

  it("rejects unclosed polygon rings", () => {
    expect(() =>
      engine.addArea(propertyId, {
        name: "Bad",
        kind: "outdoor_yard",
        geometry: { ring: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
      }),
    ).toThrowError(/closed/);
  });

  it("rejects unknown parent references", () => {
    expect(() =>
      engine.addFeature(propertyId, {
        name: "Orphan",
        kind: "shelf",
        position: { x: 1, y: 1 },
        parent_area_id: "nope",
      }),
    ).toThrowError(/does not exist/);
  });
});

describe("canon §4.4 — overlap is recorded, never validated (R-CONSTRAINT-001)", () => {
  it("allows two features with identical footprints without warnings", () => {
    const spec = { kind: "planting_bed" as const, position: { x: 10, y: 10 }, geometry: square(2) };
    const a = engine.addFeature(propertyId, { ...spec, name: "Understory" });
    const b = engine.addFeature(propertyId, { ...spec, name: "Canopy" });
    expect(a.warnings).toHaveLength(0);
    expect(b.warnings).toHaveLength(0);
  });
});

describe("canon §4.2 — adjacency", () => {
  it("records adjacency and answers getAdjacentAreas", () => {
    const kitchen = engine.addArea(propertyId, { name: "Kitchen", kind: "indoor_room", geometry: square(4) }).value;
    const hall = engine.addArea(propertyId, { name: "Hall", kind: "indoor_hallway", geometry: square(4, 4) }).value;
    engine.addAdjacency(kitchen.id, hall.id, {
      relationship: "shares_opening",
      opening: { kind: "door", opening_width_m: 0.9 },
    });
    const neighbors = engine.getAdjacentAreas(kitchen.id);
    expect(neighbors.map((a) => a.id)).toEqual([hall.id]);
    expect(engine.getAdjacentAreas(hall.id).map((a) => a.id)).toEqual([kitchen.id]);
  });
});

describe("canon §5.3 / §8 / R-API-002 — event log and observer", () => {
  it("notifies subscribers of every write and honors unsubscribe", () => {
    const received: SpatialChange[] = [];
    const unsubscribe = engine.subscribe(propertyId, (c) => received.push(c));
    const f = engine.addFeature(propertyId, { name: "Bench", kind: "furniture", position: { x: 2, y: 2 } }).value;
    engine.moveFeature(f.id, { x: 3, y: 3 });
    expect(received.map((c) => c.event_kind)).toEqual(["feature_added", "feature_moved"]);
    unsubscribe();
    engine.moveFeature(f.id, { x: 4, y: 4 });
    expect(received).toHaveLength(2);
  });

  it("supports cursor-based polling via getChangesSince", () => {
    const f = engine.addFeature(propertyId, { name: "Bench", kind: "furniture", position: { x: 2, y: 2 } }).value;
    const all = engine.getChangesSince(propertyId);
    const cursor = all[all.length - 1]!.id;
    engine.moveFeature(f.id, { x: 3, y: 3 });
    engine.resizeFeature(f.id, { width_m: 1.5, depth_m: 0.5, height_m: 0.45 });
    const since = engine.getChangesSince(propertyId, cursor);
    expect(since.map((c) => c.event_kind)).toEqual(["feature_moved", "feature_resized"]);
  });

  it("move events carry before/after spatial snapshots (canon §5.3)", () => {
    const f = engine.addFeature(propertyId, { name: "Bench", kind: "furniture", position: { x: 2, y: 2 } }).value;
    engine.moveFeature(f.id, { x: 9, y: 9 });
    const history = engine.featureHistory(f.id);
    const move = history.find((c) => c.event_kind === "feature_moved")!;
    expect(move.before?.position).toEqual({ x: 2, y: 2 });
    expect(move.after?.position).toEqual({ x: 9, y: 9 });
  });
});

describe("R-GEO-001 — precision applied at the write boundary", () => {
  it("rounds positions and dimensions to centimeters", () => {
    const f = engine.addFeature(propertyId, {
      name: "Precise",
      kind: "container",
      position: { x: 1.2345, y: 2.9999, heading: 450 },
      dimensions: { width_m: 0.333333, depth_m: 0.666666, height_m: 0.5 },
    }).value;
    expect(f.position).toEqual({ x: 1.23, y: 3, heading: 90 });
    expect(f.dimensions).toEqual({ width_m: 0.33, depth_m: 0.67, height_m: 0.5 });
  });
});

describe("canon §3.1 / R-TIME-002 — property basics", () => {
  it("derives boundary measurements, never persisting them", () => {
    const p = engine.getProperty(propertyId);
    expect(p.boundary_area).toBe(10000);
    expect(p.bounding_box).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(p.coordinate_convention).toBe("ymir-local-si-v1");
  });

  it("supports multi-property (R-USER-001)", () => {
    engine.createProperty({ name: "Second Home", boundary: square(50) });
    expect(engine.listProperties()).toHaveLength(2);
  });

  it("updateProperty touches name/description only — the boundary is immutable", () => {
    const updated = engine.updateProperty(propertyId, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.boundary_area).toBe(10000);
  });
});
