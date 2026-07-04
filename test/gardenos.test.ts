/**
 * GardenOS import adapter — first consumer proof (canon §9).
 * Synthetic fixture data modeled on docs/reference/spatial-model.md:
 * a greenhouse containing benches containing seed trays, beds with
 * PlantingSpace extensions, and the containment/coordinate rules of the
 * inherited model.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YmirEngine } from "../src/engine.js";
import { importGardenOS, mapGardenOSFeatureKind, type GardenOSExport } from "../src/adapters/gardenos.js";

const square = (size: number, ox = 0, oy = 0) => ({
  ring: [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
    { x: ox, y: oy },
  ],
});

/** Synthetic GardenOS export — real garden data migrates later. */
function fixture(): GardenOSExport {
  return {
    property: {
      id: "midgard-prop-1",
      name: "Midgard Homestead",
      boundary: square(80),
      wgs84Origin: { longitude: -122.68, latitude: 45.52, altitude_m: 50 },
    },
    areas: [
      { id: "mg-area-veg", propertyId: "midgard-prop-1", name: "Vegetable Garden", purpose: "garden", geometry: square(25, 5, 5) },
      { id: "mg-area-yard", propertyId: "midgard-prop-1", name: "Back Yard", purpose: "yard", geometry: square(30, 35, 5) },
    ],
    features: [
      // deliberately listed child-before-parent to exercise topo ordering
      {
        id: "mg-tray-1",
        propertyId: "midgard-prop-1",
        parentFeatureId: "mg-bench-1",
        name: "Seed Tray 1",
        kind: "seed_tray",
        position: { x: 0.5, y: 0.5 },
      },
      {
        id: "mg-bench-1",
        propertyId: "midgard-prop-1",
        parentFeatureId: "mg-greenhouse",
        name: "Potting Bench",
        kind: "bench",
        position: { x: 1, y: 1 },
        dimensions: { width_m: 1.8, depth_m: 0.6, height_m: 0.9 },
      },
      {
        id: "mg-greenhouse",
        propertyId: "midgard-prop-1",
        name: "Greenhouse",
        kind: "greenhouse",
        position: { x: 40, y: 10, heading: 90 },
        geometry: square(6),
        dimensions: { width_m: 6, depth_m: 6, height_m: 3 },
      },
      {
        id: "mg-bed-1",
        propertyId: "midgard-prop-1",
        areaId: "mg-area-veg",
        sourceRef: "sheet-import:bed-1",
        name: "Raised Bed 1",
        kind: "raised_bed",
        position: { x: 8, y: 8 },
        geometry: square(2.4),
        dimensions: { width_m: 1.2, depth_m: 2.4, height_m: 0.3 },
        plantingSpaceId: "ps-bed-1",
      },
      {
        id: "mg-gnome",
        propertyId: "midgard-prop-1",
        areaId: "mg-area-yard",
        name: "Garden Gnome",
        kind: "gnome_statue",
        position: { x: 50, y: 20 },
      },
    ],
  };
}

let engine: YmirEngine;

beforeEach(() => {
  engine = new YmirEngine(":memory:");
});

afterEach(() => engine.close());

describe("canon §9.1 — GardenOS → Ymir mapping", () => {
  it("carries Midgard-level IDs forward as Ymir IDs", () => {
    const result = importGardenOS(engine, fixture());
    expect(result.property_id).toBe("midgard-prop-1");
    expect(engine.getFeature("mg-greenhouse").kind).toBe("greenhouse");
    expect(engine.getArea("mg-area-veg").kind).toBe("outdoor_garden");
    expect(result.areas_created).toBe(2);
    expect(result.features_created).toBe(5);
  });

  it("preserves the WGS84 anchor and coordinate frame unchanged (canon §2.1 provenance)", () => {
    importGardenOS(engine, fixture());
    const property = engine.getProperty("midgard-prop-1");
    expect(property.wgs84_origin?.latitude).toBe(45.52);
    expect(property.coordinate_convention).toBe("ymir-local-si-v1");
    // positions transfer verbatim — same convention under two names
    expect(engine.getFeature("mg-bed-1").position).toEqual({ x: 8, y: 8 });
    expect(engine.getFeature("mg-greenhouse").position.heading).toBe(90);
  });

  it("preserves the containment hierarchy: greenhouse → bench → tray (canon §1.1 inheritance)", () => {
    importGardenOS(engine, fixture());
    expect(engine.getFeature("mg-bench-1").parent_feature_id).toBe("mg-greenhouse");
    expect(engine.getFeature("mg-tray-1").parent_feature_id).toBe("mg-bench-1");
    // kinds mapped: bench → shelf, seed_tray → container
    expect(engine.getFeature("mg-bench-1").kind).toBe("shelf");
    expect(engine.getFeature("mg-tray-1").kind).toBe("container");
  });

  it("keeps PlantingSpace domain-side: only the link lands in metadata (R-DOMAIN-002)", () => {
    importGardenOS(engine, fixture());
    const bed = engine.getFeature("mg-bed-1");
    const garden = bed.metadata?.["garden"] as Record<string, unknown>;
    expect(garden["planting_space_id"]).toBe("ps-bed-1");
    expect(garden["gardenos_kind"]).toBe("raised_bed");
    // no planting/occupancy/season data anywhere in the core record
    expect(JSON.stringify(bed)).not.toMatch(/occupanc|season|planting_event/i);
  });

  it("imports unmapped kinds as 'unknown' with a warning (R-DOMAIN-003)", () => {
    const result = importGardenOS(engine, fixture());
    expect(engine.getFeature("mg-gnome").kind).toBe("unknown");
    expect(result.warnings.some((w) => w.code === "unknown_kind" && w.subject_id === "mg-gnome")).toBe(true);
  });

  it("kind mapper covers the reference model's named feature kinds", () => {
    expect(mapGardenOSFeatureKind("bed").kind).toBe("planting_bed");
    expect(mapGardenOSFeatureKind("greenhouse").kind).toBe("greenhouse");
    expect(mapGardenOSFeatureKind("container").kind).toBe("container");
    expect(mapGardenOSFeatureKind("shelf").kind).toBe("shelf");
    expect(mapGardenOSFeatureKind("tree").kind).toBe("tree");
    expect(mapGardenOSFeatureKind("weird").mapped).toBe(false);
  });
});

describe("R-STORE-004 — idempotent re-import via strict sourceRef matching", () => {
  it("re-importing identical data changes nothing", () => {
    importGardenOS(engine, fixture());
    const second = importGardenOS(engine, fixture());
    expect(second.features_created).toBe(0);
    expect(second.features_updated).toBe(5);
    expect(engine.getFeatures("midgard-prop-1")).toHaveLength(5);
    // idempotent: no spurious move/resize events from the unchanged re-import
    const history = engine.featureHistory("mg-bed-1");
    expect(history.map((c) => c.event_kind)).toEqual(["feature_added"]);
  });

  it("a moved bed in a re-import updates through the write API, preserving history", () => {
    importGardenOS(engine, fixture());
    const moved = fixture();
    moved.features.find((f) => f.id === "mg-bed-1")!.position = { x: 10, y: 12 };
    importGardenOS(engine, moved);

    expect(engine.getFeature("mg-bed-1").position).toEqual({ x: 10, y: 12 });
    const history = engine.featureHistory("mg-bed-1");
    expect(history.map((c) => c.event_kind)).toEqual(["feature_added", "feature_moved"]);
    expect(engine.getFeatures("midgard-prop-1")).toHaveLength(5);
  });

  it("as-of queries see pre-migration positions after a re-import moves things (§5.4 end-to-end)", () => {
    importGardenOS(engine, fixture());
    const importedAt = engine.getFeature("mg-bed-1").temporal_envelope.from;
    const moved = fixture();
    moved.features.find((f) => f.id === "mg-bed-1")!.position = { x: 10, y: 12 };
    importGardenOS(engine, moved);

    const asOf = engine.propertyAt("midgard-prop-1", importedAt).features.find((f) => f.id === "mg-bed-1")!;
    expect(asOf.position).toEqual({ x: 8, y: 8 });
  });
});

describe("adapter guards", () => {
  it("rejects features pointing at a different property", () => {
    const bad = fixture();
    bad.features[0]!.propertyId = "someone-else";
    expect(() => importGardenOS(engine, bad)).toThrowError(/references property/);
  });

  it("rejects containment cycles in the source data", () => {
    const bad = fixture();
    bad.features.find((f) => f.id === "mg-greenhouse")!.parentFeatureId = "mg-tray-1";
    expect(() => importGardenOS(engine, bad)).toThrowError(/cycle/);
  });
});
