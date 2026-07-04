import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YmirEngine } from "../src/engine.js";
import {
  exportProperty,
  importProperty,
  renameExportForImport,
  upsertFeatureBySourceRef,
} from "../src/porting.js";
import { YmirValidationError } from "../src/types.js";

const square = (size: number, ox = 0, oy = 0) => ({
  ring: [
    { x: ox, y: oy },
    { x: ox + size, y: oy },
    { x: ox + size, y: oy + size },
    { x: ox, y: oy + size },
    { x: ox, y: oy },
  ],
});

let source: YmirEngine;
let pid: string;
let bedId: string;

beforeEach(() => {
  source = new YmirEngine(":memory:");
  pid = source.createProperty({ id: "prop-1", name: "Origin", boundary: square(50) }, { at: "2024-01-01" }).value.id;
  source.addArea(pid, { id: "yard", name: "Yard", kind: "outdoor_yard", geometry: square(30) }, { at: "2024-01-01" });
  bedId = source.addFeature(
    pid,
    { name: "Bed", kind: "raised_bed", position: { x: 5, y: 5 }, parent_area_id: "yard" },
    { at: "2024-02-01" },
  ).value.id;
  source.moveFeature(bedId, { x: 8, y: 8 }, { at: "2024-05-01" });
});

afterEach(() => source.close());

describe("canon §7.2 / R-EXPORT-001 — fixed-schema export", () => {
  it("exports version 1.0 with property, areas, features, adjacencies, changes, metadata", () => {
    const payload = exportProperty(source, pid);
    expect(payload.version).toBe("1.0");
    expect(payload.property.id).toBe(pid);
    expect(payload.areas).toHaveLength(1);
    expect(payload.features).toHaveLength(1);
    expect(payload.changes.length).toBeGreaterThanOrEqual(4); // created, area, feature, move
    expect(payload.metadata.exported_at).toBeTruthy();
  });

  it("rejects malformed payloads strictly on import", () => {
    const dest = new YmirEngine(":memory:");
    expect(() => importProperty(dest, { version: "2.0" })).toThrowError(/fixed schema/);
    expect(() => importProperty(dest, { version: "1.0" })).toThrowError(/missing/);
    dest.close();
  });
});

describe("canon §5.4 — the change log travels: history survives export/import", () => {
  it("reconstructs historical state in the destination engine", () => {
    const payload = exportProperty(source, pid);
    const dest = new YmirEngine(":memory:");
    const result = importProperty(dest, payload);
    expect(result.imported_features).toBe(1);
    expect(result.imported_changes).toBe(payload.changes.length);

    // as-of query in the DESTINATION engine, against imported log
    const march = dest.propertyAt(pid, "2024-03-01").features.find((f) => f.id === bedId)!;
    expect(march.position).toEqual({ x: 5, y: 5 });
    const june = dest.propertyAt(pid, "2024-06-01").features.find((f) => f.id === bedId)!;
    expect(june.position).toEqual({ x: 8, y: 8 });
    dest.close();
  });
});

describe("R-EXPORT-002 — property ID conflict rejects with a rename offer", () => {
  it("rejects the import and suggests a rename", () => {
    const payload = exportProperty(source, pid);
    try {
      importProperty(source, payload);
      expect.unreachable("import should have thrown");
    } catch (e) {
      const err = e as YmirValidationError;
      expect(err).toBeInstanceOf(YmirValidationError);
      expect(err.code).toBe("property_id_conflict");
      expect(err.suggestion).toMatch(/^prop-1-imported-/);
    }
  });

  it("the rename path imports cleanly alongside the original", () => {
    const payload = exportProperty(source, pid);
    const renamed = renameExportForImport(payload, "prop-1-copy", "Origin (Copy)");
    const result = importProperty(source, renamed);
    expect(result.property_id).toBe("prop-1-copy");
    expect(source.listProperties()).toHaveLength(2);
    // history replays under the new identity too
    const copy = source.propertyAt("prop-1-copy", "2024-03-01");
    expect(copy.features[0]!.position).toEqual({ x: 5, y: 5 });
  });
});

describe("R-DOMAIN-003 — unknown kinds preserved with a warning on import", () => {
  it("imports kind 'unknown' and warns", () => {
    const mystery = source.addFeature(
      pid,
      { name: "Mystery Object", kind: "unknown", position: { x: 1, y: 1 } },
      { at: "2024-03-01" },
    ).value;
    const payload = exportProperty(source, pid);
    const dest = new YmirEngine(":memory:");
    const result = importProperty(dest, payload);
    expect(result.warnings.some((w) => w.code === "unknown_kind" && w.subject_id === mystery.id)).toBe(true);
    expect(dest.getFeature(mystery.id).kind).toBe("unknown");
    dest.close();
  });
});

describe("R-STORE-004 — strict source_ref upserts", () => {
  it("creates on first import, updates (not duplicates) on exact match", () => {
    const first = upsertFeatureBySourceRef(source, pid, "ext:tree-7", {
      name: "Imported Oak",
      kind: "tree",
      position: { x: 20, y: 20 },
    });
    expect(first.created).toBe(true);

    const second = upsertFeatureBySourceRef(source, pid, "ext:tree-7", {
      name: "Imported Oak",
      kind: "tree",
      position: { x: 22, y: 20 },
    });
    expect(second.created).toBe(false);
    expect(second.feature.id).toBe(first.feature.id);
    expect(second.feature.position.x).toBe(22);
    expect(source.getFeatures(pid, { kind: "tree" })).toHaveLength(1);
    // the update went through the write API: it is in the change log
    const history = source.featureHistory(first.feature.id);
    expect(history.map((c) => c.event_kind)).toEqual(["feature_added", "feature_moved"]);
  });

  it("a different source_ref creates a new feature — no fuzzy matching", () => {
    upsertFeatureBySourceRef(source, pid, "ext:tree-7", {
      name: "Oak",
      kind: "tree",
      position: { x: 20, y: 20 },
    });
    const other = upsertFeatureBySourceRef(source, pid, "ext:tree-8", {
      name: "Oak", // same name, same position — still a new feature
      kind: "tree",
      position: { x: 20, y: 20 },
    });
    expect(other.created).toBe(true);
    expect(source.getFeatures(pid, { kind: "tree" })).toHaveLength(2);
  });
});
