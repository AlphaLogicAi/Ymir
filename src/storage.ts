/**
 * SQLite storage layer (canon §7; R-STORE-001: SQLite, locked).
 *
 * The spatial_changes table is the positional-versioning authority (§5.4):
 * retained forever (R-STORE-003, locked override), with before/after columns.
 * Current-state tables (properties/spatial_areas/physical_features) are a
 * read-optimizing projection of the log, never an independent source of truth.
 *
 * Geometry columns are stored as JSON text — canon §7.3's `GEOMETRY` column
 * type is illustrative; representation detail recorded in
 * docs/RULINGS_ADDENDUM.md (A-001).
 */

import Database from "better-sqlite3";
import type {
  ISO8601,
  PhysicalFeature,
  Polygon,
  Property,
  SpatialAdjacency,
  SpatialArea,
  SpatialChange,
  Wgs84Origin,
} from "./types.js";
import { COORDINATE_CONVENTION } from "./types.js";
import { deriveBoundaryMeasurements, polygonArea } from "./geometry.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  boundary TEXT NOT NULL,             -- JSON Polygon
  coordinate_convention TEXT NOT NULL DEFAULT '${COORDINATE_CONVENTION}',
  wgs84_longitude REAL,
  wgs84_latitude REAL,
  wgs84_altitude_m REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spatial_areas (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  purpose TEXT,
  geometry TEXT NOT NULL,             -- JSON Polygon
  elevation REAL,
  parent_structure_id TEXT REFERENCES physical_features(id),
  from_date TEXT NOT NULL,
  to_date TEXT,
  envelope_note TEXT,
  orientation TEXT,                   -- JSON
  observed_light TEXT,                -- JSON (canon §4.3: recorded observation)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_areas_property ON spatial_areas(property_id);

CREATE TABLE IF NOT EXISTS physical_features (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  geometry TEXT,                      -- JSON Polygon (feature-local footprint)
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  position_heading REAL,
  dimensions TEXT,                    -- JSON Dimensions
  vertical_envelope TEXT,             -- JSON VerticalEnvelope
  parent_feature_id TEXT REFERENCES physical_features(id),
  parent_area_id TEXT REFERENCES spatial_areas(id),
  from_date TEXT NOT NULL,
  to_date TEXT,
  envelope_note TEXT,
  source_ref TEXT,
  tags TEXT,                          -- JSON string[]
  observed_light TEXT,                -- JSON
  metadata TEXT,                      -- JSON (domain subdocuments, R-DOMAIN-002)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_features_property ON physical_features(property_id);
CREATE INDEX IF NOT EXISTS idx_features_source_ref ON physical_features(property_id, source_ref);

CREATE TABLE IF NOT EXISTS spatial_adjacencies (
  id TEXT PRIMARY KEY,
  area1_id TEXT NOT NULL REFERENCES spatial_areas(id),
  area2_id TEXT NOT NULL REFERENCES spatial_areas(id),
  relationship TEXT NOT NULL,
  opening TEXT,                       -- JSON
  notes TEXT
);

-- Authoritative log for positional versioning (canon §5.4). Retained forever
-- (R-STORE-003, locked override) — property_at(date) depends on full replay.
CREATE TABLE IF NOT EXISTS spatial_changes (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id),
  timestamp TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  affected_ids TEXT NOT NULL,         -- JSON array
  author TEXT,
  before TEXT,                        -- JSON: prior values of changed spatial attributes
  after TEXT,                         -- JSON: new values of changed spatial attributes
  details TEXT NOT NULL,              -- JSON
  transaction_id TEXT,
  seq INTEGER                         -- monotonic within-timestamp ordering for deterministic replay
);
CREATE INDEX IF NOT EXISTS idx_changes_property_time ON spatial_changes(property_id, timestamp, seq);
`;

interface PropertyRow {
  id: string;
  name: string;
  description: string | null;
  boundary: string;
  coordinate_convention: string;
  wgs84_longitude: number | null;
  wgs84_latitude: number | null;
  wgs84_altitude_m: number | null;
  created_at: string;
  updated_at: string;
}

interface AreaRow {
  id: string;
  property_id: string;
  name: string;
  kind: string;
  purpose: string | null;
  geometry: string;
  elevation: number | null;
  parent_structure_id: string | null;
  from_date: string;
  to_date: string | null;
  envelope_note: string | null;
  orientation: string | null;
  observed_light: string | null;
  created_at: string;
  updated_at: string;
}

interface FeatureRow {
  id: string;
  property_id: string;
  name: string;
  kind: string;
  status: string;
  geometry: string | null;
  position_x: number;
  position_y: number;
  position_heading: number | null;
  dimensions: string | null;
  vertical_envelope: string | null;
  parent_feature_id: string | null;
  parent_area_id: string | null;
  from_date: string;
  to_date: string | null;
  envelope_note: string | null;
  source_ref: string | null;
  tags: string | null;
  observed_light: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

interface AdjacencyRow {
  id: string;
  area1_id: string;
  area2_id: string;
  relationship: string;
  opening: string | null;
  notes: string | null;
}

interface ChangeRow {
  id: string;
  property_id: string;
  timestamp: string;
  event_kind: string;
  affected_ids: string;
  author: string | null;
  before: string | null;
  after: string | null;
  details: string;
  transaction_id: string | null;
  seq: number | null;
}

function json<T>(text: string | null): T | undefined {
  return text === null ? undefined : (JSON.parse(text) as T);
}

function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class YmirStorage {
  readonly db: Database.Database;
  private seqCounter: number;

  constructor(path: string = ":memory:") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM spatial_changes")
      .get() as { max_seq: number };
    this.seqCounter = row.max_seq;
  }

  close(): void {
    this.db.close();
  }

  /** Run a function inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // -- properties -----------------------------------------------------------

  insertProperty(p: Omit<Property, "areas" | "features" | "boundary_area" | "bounding_box">): void {
    this.db
      .prepare(
        `INSERT INTO properties (id, name, description, boundary, coordinate_convention,
          wgs84_longitude, wgs84_latitude, wgs84_altitude_m, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.name,
        p.description ?? null,
        JSON.stringify(p.boundary),
        p.coordinate_convention,
        p.wgs84_origin?.longitude ?? null,
        p.wgs84_origin?.latitude ?? null,
        p.wgs84_origin?.altitude_m ?? null,
        p.created_at,
        p.updated_at,
      );
  }

  updatePropertyMeta(id: string, name: string, description: string | undefined, updated_at: ISO8601): void {
    this.db
      .prepare("UPDATE properties SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(name, description ?? null, updated_at, id);
  }

  getPropertyRow(id: string): (Omit<Property, "areas" | "features">) | undefined {
    const row = this.db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
      | PropertyRow
      | undefined;
    if (!row) return undefined;
    return this.propertyFromRow(row);
  }

  listPropertyRows(): Omit<Property, "areas" | "features">[] {
    const rows = this.db.prepare("SELECT * FROM properties ORDER BY name").all() as PropertyRow[];
    return rows.map((r) => this.propertyFromRow(r));
  }

  private propertyFromRow(row: PropertyRow): Omit<Property, "areas" | "features"> {
    const boundary = JSON.parse(row.boundary) as Polygon;
    const derived = deriveBoundaryMeasurements(boundary);
    const wgs84_origin: Wgs84Origin | undefined =
      row.wgs84_longitude !== null && row.wgs84_latitude !== null
        ? {
            longitude: row.wgs84_longitude,
            latitude: row.wgs84_latitude,
            ...(row.wgs84_altitude_m !== null ? { altitude_m: row.wgs84_altitude_m } : {}),
          }
        : undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      boundary,
      boundary_area: derived.boundary_area,
      bounding_box: derived.bounding_box,
      coordinate_convention: row.coordinate_convention as Property["coordinate_convention"],
      wgs84_origin,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // -- areas ----------------------------------------------------------------

  insertArea(a: SpatialArea, now: ISO8601): void {
    this.db
      .prepare(
        `INSERT INTO spatial_areas (id, property_id, name, kind, purpose, geometry, elevation,
          parent_structure_id, from_date, to_date, envelope_note, orientation, observed_light,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        a.id,
        a.property_id,
        a.name,
        a.kind,
        a.purpose ?? null,
        JSON.stringify(a.geometry),
        a.elevation ?? null,
        a.parent_structure_id ?? null,
        a.temporal_envelope.from,
        a.temporal_envelope.to ?? null,
        a.temporal_envelope.note ?? null,
        toJson(a.orientation),
        toJson(a.observed_light),
        now,
        now,
      );
  }

  updateArea(a: SpatialArea, now: ISO8601): void {
    this.db
      .prepare(
        `UPDATE spatial_areas SET name = ?, kind = ?, purpose = ?, geometry = ?, elevation = ?,
          parent_structure_id = ?, from_date = ?, to_date = ?, envelope_note = ?,
          orientation = ?, observed_light = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        a.name,
        a.kind,
        a.purpose ?? null,
        JSON.stringify(a.geometry),
        a.elevation ?? null,
        a.parent_structure_id ?? null,
        a.temporal_envelope.from,
        a.temporal_envelope.to ?? null,
        a.temporal_envelope.note ?? null,
        toJson(a.orientation),
        toJson(a.observed_light),
        now,
        a.id,
      );
  }

  getArea(id: string): SpatialArea | undefined {
    const row = this.db.prepare("SELECT * FROM spatial_areas WHERE id = ?").get(id) as
      | AreaRow
      | undefined;
    return row ? this.areaFromRow(row) : undefined;
  }

  getAreas(propertyId: string): SpatialArea[] {
    const rows = this.db
      .prepare("SELECT * FROM spatial_areas WHERE property_id = ? ORDER BY name")
      .all(propertyId) as AreaRow[];
    return rows.map((r) => this.areaFromRow(r));
  }

  private areaFromRow(row: AreaRow): SpatialArea {
    const geometry = JSON.parse(row.geometry) as Polygon;
    return {
      id: row.id,
      property_id: row.property_id,
      name: row.name,
      kind: row.kind as SpatialArea["kind"],
      purpose: (row.purpose ?? undefined) as SpatialArea["purpose"],
      geometry,
      area_m2: polygonArea(geometry),
      elevation: row.elevation ?? undefined,
      parent_structure_id: row.parent_structure_id ?? undefined,
      temporal_envelope: {
        from: row.from_date,
        ...(row.to_date !== null ? { to: row.to_date } : {}),
        ...(row.envelope_note !== null ? { note: row.envelope_note } : {}),
      },
      orientation: json(row.orientation),
      observed_light: json(row.observed_light),
    };
  }

  // -- features -------------------------------------------------------------

  insertFeature(f: PhysicalFeature, now: ISO8601): void {
    this.db
      .prepare(
        `INSERT INTO physical_features (id, property_id, name, kind, status, geometry,
          position_x, position_y, position_heading, dimensions, vertical_envelope,
          parent_feature_id, parent_area_id, from_date, to_date, envelope_note,
          source_ref, tags, observed_light, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        f.id,
        f.property_id,
        f.name,
        f.kind,
        f.status,
        toJson(f.geometry),
        f.position.x,
        f.position.y,
        f.position.heading ?? null,
        toJson(f.dimensions),
        toJson(f.vertical_envelope),
        f.parent_feature_id ?? null,
        f.parent_area_id ?? null,
        f.temporal_envelope.from,
        f.temporal_envelope.to ?? null,
        f.temporal_envelope.note ?? null,
        f.source_ref ?? null,
        toJson(f.tags),
        toJson(f.observed_light),
        toJson(f.metadata),
        now,
        now,
      );
  }

  updateFeature(f: PhysicalFeature, now: ISO8601): void {
    this.db
      .prepare(
        `UPDATE physical_features SET name = ?, kind = ?, status = ?, geometry = ?,
          position_x = ?, position_y = ?, position_heading = ?, dimensions = ?,
          vertical_envelope = ?, parent_feature_id = ?, parent_area_id = ?,
          from_date = ?, to_date = ?, envelope_note = ?, source_ref = ?, tags = ?,
          observed_light = ?, metadata = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        f.name,
        f.kind,
        f.status,
        toJson(f.geometry),
        f.position.x,
        f.position.y,
        f.position.heading ?? null,
        toJson(f.dimensions),
        toJson(f.vertical_envelope),
        f.parent_feature_id ?? null,
        f.parent_area_id ?? null,
        f.temporal_envelope.from,
        f.temporal_envelope.to ?? null,
        f.temporal_envelope.note ?? null,
        f.source_ref ?? null,
        toJson(f.tags),
        toJson(f.observed_light),
        toJson(f.metadata),
        now,
        f.id,
      );
  }

  getFeature(id: string): PhysicalFeature | undefined {
    const row = this.db.prepare("SELECT * FROM physical_features WHERE id = ?").get(id) as
      | FeatureRow
      | undefined;
    return row ? this.featureFromRow(row) : undefined;
  }

  getFeatures(propertyId: string): PhysicalFeature[] {
    const rows = this.db
      .prepare("SELECT * FROM physical_features WHERE property_id = ? ORDER BY name")
      .all(propertyId) as FeatureRow[];
    return rows.map((r) => this.featureFromRow(r));
  }

  findFeatureBySourceRef(propertyId: string, sourceRef: string): PhysicalFeature | undefined {
    const row = this.db
      .prepare("SELECT * FROM physical_features WHERE property_id = ? AND source_ref = ?")
      .get(propertyId, sourceRef) as FeatureRow | undefined;
    return row ? this.featureFromRow(row) : undefined;
  }

  private featureFromRow(row: FeatureRow): PhysicalFeature {
    return {
      id: row.id,
      property_id: row.property_id,
      name: row.name,
      kind: row.kind as PhysicalFeature["kind"],
      status: row.status as PhysicalFeature["status"],
      geometry: json(row.geometry),
      position: {
        x: row.position_x,
        y: row.position_y,
        ...(row.position_heading !== null ? { heading: row.position_heading } : {}),
      },
      dimensions: json(row.dimensions),
      vertical_envelope: json(row.vertical_envelope),
      parent_feature_id: row.parent_feature_id ?? undefined,
      parent_area_id: row.parent_area_id ?? undefined,
      temporal_envelope: {
        from: row.from_date,
        ...(row.to_date !== null ? { to: row.to_date } : {}),
        ...(row.envelope_note !== null ? { note: row.envelope_note } : {}),
      },
      source_ref: row.source_ref ?? undefined,
      tags: json(row.tags),
      observed_light: json(row.observed_light),
      metadata: json(row.metadata),
    };
  }

  // -- adjacencies ----------------------------------------------------------

  insertAdjacency(a: SpatialAdjacency): void {
    this.db
      .prepare(
        `INSERT INTO spatial_adjacencies (id, area1_id, area2_id, relationship, opening, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(a.id, a.area1_id, a.area2_id, a.relationship, toJson(a.opening), a.notes ?? null);
  }

  getAdjacenciesForArea(areaId: string): SpatialAdjacency[] {
    const rows = this.db
      .prepare("SELECT * FROM spatial_adjacencies WHERE area1_id = ? OR area2_id = ?")
      .all(areaId, areaId) as AdjacencyRow[];
    return rows.map((r) => this.adjacencyFromRow(r));
  }

  getAdjacencies(propertyId: string): SpatialAdjacency[] {
    const rows = this.db
      .prepare(
        `SELECT adj.* FROM spatial_adjacencies adj
         JOIN spatial_areas a ON a.id = adj.area1_id
         WHERE a.property_id = ?`,
      )
      .all(propertyId) as AdjacencyRow[];
    return rows.map((r) => this.adjacencyFromRow(r));
  }

  private adjacencyFromRow(row: AdjacencyRow): SpatialAdjacency {
    return {
      id: row.id,
      area1_id: row.area1_id,
      area2_id: row.area2_id,
      relationship: row.relationship,
      opening: json(row.opening),
      notes: row.notes ?? undefined,
    };
  }

  // -- change log (§5.4 authority) -------------------------------------------

  insertChange(c: SpatialChange, transactionId?: string): void {
    this.seqCounter += 1;
    this.db
      .prepare(
        `INSERT INTO spatial_changes (id, property_id, timestamp, event_kind, affected_ids,
          author, before, after, details, transaction_id, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.property_id,
        c.timestamp,
        c.event_kind,
        JSON.stringify(c.affected_ids),
        c.author ?? null,
        toJson(c.before),
        toJson(c.after),
        JSON.stringify(c.details),
        transactionId ?? null,
        this.seqCounter,
      );
  }

  /**
   * Changes for a property in deterministic replay order (timestamp, then
   * insertion sequence), optionally bounded to `upTo` (inclusive) and/or
   * starting strictly after a cursor change id.
   */
  getChanges(propertyId: string, opts?: { upTo?: ISO8601; afterChangeId?: string; limit?: number }): SpatialChange[] {
    let afterSeq = -1;
    if (opts?.afterChangeId) {
      const row = this.db
        .prepare("SELECT seq FROM spatial_changes WHERE id = ?")
        .get(opts.afterChangeId) as { seq: number } | undefined;
      if (row) afterSeq = row.seq;
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM spatial_changes
         WHERE property_id = ?
           AND (? IS NULL OR timestamp <= ?)
           AND seq > ?
         ORDER BY timestamp ASC, seq ASC
         ${opts?.limit ? "LIMIT " + Math.floor(opts.limit) : ""}`,
      )
      .all(propertyId, opts?.upTo ?? null, opts?.upTo ?? null, afterSeq) as ChangeRow[];
    return rows.map((r) => this.changeFromRow(r));
  }

  getChangesForSubject(subjectId: string): SpatialChange[] {
    // affected_ids is a JSON array; match on the quoted id.
    const rows = this.db
      .prepare(
        `SELECT * FROM spatial_changes
         WHERE affected_ids LIKE ?
         ORDER BY timestamp ASC, seq ASC`,
      )
      .all(`%"${subjectId}"%`) as ChangeRow[];
    return rows.map((r) => this.changeFromRow(r));
  }

  private changeFromRow(row: ChangeRow): SpatialChange {
    return {
      id: row.id,
      property_id: row.property_id,
      timestamp: row.timestamp,
      event_kind: row.event_kind as SpatialChange["event_kind"],
      affected_ids: JSON.parse(row.affected_ids) as string[],
      author: row.author ?? undefined,
      before: json(row.before),
      after: json(row.after),
      details: JSON.parse(row.details) as Record<string, unknown>,
    };
  }
}
