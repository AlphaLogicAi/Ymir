/**
 * Ymir Core — canonical types.
 *
 * Source of truth: docs/YMIR_SPATIAL_ARCHITECTURE.md v1.1 §1–§3.
 * Every type here mirrors the canon schema; deviations are recorded in
 * docs/RULINGS_ADDENDUM.md, never made silently.
 */

/** ISO 8601 datetime string. Time-of-day optional; defaults to start of day (R-TIME-001). */
export type ISO8601 = string;

/**
 * Canonical coordinate convention identifier (canon §2.1).
 * ymir-local-si-v1 generalizes GardenOS's gardenos-local-si-v1 unchanged:
 * meters / m² / m³, +X east, +Y north, +Z up, heading degrees clockwise from
 * north, closed polygon rings, optional WGS84 anchor.
 */
export const COORDINATE_CONVENTION = "ymir-local-si-v1" as const;
export type CoordinateConvention = typeof COORDINATE_CONVENTION;

/** A 2D point in a local frame, meters. */
export interface Point {
  x: number;
  y: number;
}

/**
 * A polygon ring in a local frame. Rings are closed: the final point repeats
 * the first (canon §2.1). Validated on write.
 */
export type PolygonRing = Point[];

/** A polygon footprint/boundary: one outer ring (holes are out of scope for v0.1). */
export interface Polygon {
  ring: PolygonRing;
}

/** Axis-aligned bounding box, derived — never persisted (canon §3.1, GardenOS inheritance). */
export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Placement transform in the containing frame (canon §3.3). */
export interface Transform {
  /** meters */
  x: number;
  /** meters */
  y: number;
  /** degrees clockwise from north: 0 N, 90 E, 180 S, 270 W */
  heading?: number;
}

/** Optional WGS84 anchor for the property frame (canon §2.1, R-GEO-006: optional). */
export interface Wgs84Origin {
  longitude: number;
  latitude: number;
  altitude_m?: number;
}

/** Validity interval for every spatial object (canon §5.1). */
export interface TemporalEnvelope {
  from: ISO8601;
  to?: ISO8601;
  note?: string;
}

/** Nominal human-facing size, independent of footprint and placement (canon §3.3). */
export interface Dimensions {
  width_m: number;
  depth_m: number;
  height_m: number;
}

/** Vertical extent for collision/overlap semantics (canon §2.3, §3.3; R-GEO-005: layered). */
export interface VerticalEnvelope {
  /** depth below ground, negative (canon §3.3) */
  root_zone_m?: number;
  /** height above ground */
  canopy_top_m: number;
  /** space to obstruction above */
  clearance_above_m?: number;
  /** optional named layers for complex features (canon §2.3) */
  layers?: { name: string; from: number; to: number }[];
}

// ---------------------------------------------------------------------------
// AreaKind / AreaPurpose (canon §3.2)
// ---------------------------------------------------------------------------

export const AREA_KINDS = [
  "outdoor_yard",
  "outdoor_garden",
  "outdoor_patio",
  "outdoor_driveway",
  "outdoor_path",
  "indoor_room",
  "indoor_closet",
  "indoor_hallway",
  "indoor_basement",
  "indoor_attic",
  "indoor_garage",
  "transitional_porch",
  "transitional_deck",
  "transitional_entryway",
  "covered_structure",
] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export const AREA_PURPOSES = [
  "garden_zone",
  "living_space",
  "storage",
  "cultivation",
  "work_area",
  "circulation",
] as const;
export type AreaPurpose = (typeof AREA_PURPOSES)[number];

// ---------------------------------------------------------------------------
// FeatureKind — hybrid model (canon §3.3.1, R-DOMAIN-001 locked override)
// ---------------------------------------------------------------------------

/** Core enum: Ymir's own universal vocabulary. */
export const CORE_FEATURE_KINDS = [
  // Outdoor botanical
  "tree",
  "shrub",
  "herbaceous_perennial",
  "annual",
  "groundcover",
  "vine",
  // Outdoor cultivation
  "planting_bed",
  "raised_bed",
  "container",
  "trellis",
  "pathway",
  // Structures
  "building",
  "greenhouse",
  "shed",
  "garage",
  "deck",
  "fence",
  "wall",
  // Indoor
  "furniture",
  "appliance",
  "fixture",
  "window",
  "door",
  "shelf",
  // Misc
  "water_feature",
  "hardscape",
  "unknown",
] as const;
export type CoreFeatureKind = (typeof CORE_FEATURE_KINDS)[number];

/**
 * Domain-namespaced escape hatch (canon §3.3.1): any `domain:<name>` string is
 * a valid kind, stored and indexed identically to core-enum values. Ymir does
 * not validate the namespace contents.
 */
export type DomainFeatureKind = `domain:${string}`;

/** Hybrid FeatureKind: core enum OR domain-namespaced string. */
export type FeatureKind = CoreFeatureKind | DomainFeatureKind;

export function isCoreFeatureKind(kind: string): kind is CoreFeatureKind {
  return (CORE_FEATURE_KINDS as readonly string[]).includes(kind);
}

export function isDomainFeatureKind(kind: string): kind is DomainFeatureKind {
  return kind.startsWith("domain:") && kind.length > "domain:".length;
}

/** True if `kind` is a valid hybrid FeatureKind. */
export function isValidFeatureKind(kind: string): kind is FeatureKind {
  return isCoreFeatureKind(kind) || isDomainFeatureKind(kind);
}

/** Structure kinds — features that contain indoor spaces (canon §3.4). */
export const STRUCTURE_KINDS = ["building", "greenhouse", "shed", "garage"] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const FEATURE_STATUSES = ["active", "planned", "dormant", "removed"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Observed light quality — recorded, never derived (canon §4.3, v1.1 split)
// ---------------------------------------------------------------------------

export interface ObservedLightQuality {
  quality:
    | "full_sun"
    | "partial_shade"
    | "full_shade"
    | "abundant"
    | "moderate"
    | "poor";
  seasonal_variation?: string;
  window_count?: number;
  artificial_only?: boolean;
  observed_at?: ISO8601;
  source?: "user_observed" | "imported" | "sensor";
}

/** Cardinal direction — derived only, never persisted (canon §4.3, R-GEO-004). */
export type CardinalDirection = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

// ---------------------------------------------------------------------------
// Core entities (canon §3.1–§3.4)
// ---------------------------------------------------------------------------

export interface Property {
  id: string;
  name: string;
  description?: string;

  /** Property boundary — authoritative; immutable in v1 (R-TIME-002). */
  boundary: Polygon;
  /** m², derived from boundary — never persisted. */
  boundary_area: number;
  /** derived — never persisted. */
  bounding_box: BoundingBox;

  coordinate_convention: CoordinateConvention;
  wgs84_origin?: Wgs84Origin;

  created_at: ISO8601;
  updated_at: ISO8601;

  areas: SpatialArea[];
  features: PhysicalFeature[];
}

export interface AreaOrientation {
  primary_sun_exposure?: string;
  slope?: number;
  drainage?: "poor" | "moderate" | "good";
}

export interface SpatialArea {
  id: string;
  property_id: string;
  name: string;
  kind: AreaKind;
  purpose?: AreaPurpose;

  geometry: Polygon;
  /** derived from geometry */
  area_m2: number;
  elevation?: number;

  /** if indoors within a structure */
  parent_structure_id?: string;

  temporal_envelope: TemporalEnvelope;

  orientation?: AreaOrientation;
  observed_light?: ObservedLightQuality;
}

export interface PhysicalFeature {
  id: string;
  property_id: string;

  name: string;
  kind: FeatureKind;
  status: FeatureStatus;

  /** footprint in feature-local frame */
  geometry?: Polygon;
  /** placement in containing frame */
  position: Transform;
  dimensions?: Dimensions;
  vertical_envelope?: VerticalEnvelope;

  parent_feature_id?: string;
  parent_area_id?: string;

  temporal_envelope: TemporalEnvelope;

  /** import alias; never canonical identity (canon §1.2) */
  source_ref?: string;
  tags?: string[];
  observed_light?: ObservedLightQuality;

  /** kind-dependent, domain-namespaced subdocuments (R-DOMAIN-002) */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adjacency (canon §4.2)
// ---------------------------------------------------------------------------

export type AdjacencyRelationship = "shares_wall" | "shares_opening" | "borders" | string;

export interface SpatialAdjacency {
  id: string;
  area1_id: string;
  area2_id: string;
  relationship: AdjacencyRelationship;
  opening?: {
    kind: "door" | "window" | "gate" | "passage";
    opening_width_m: number;
    opening_height_m?: number;
  };
  notes?: string;
}

// ---------------------------------------------------------------------------
// Change events (canon §5.3) — the positional-versioning authority (§5.4)
// ---------------------------------------------------------------------------

export const EVENT_KINDS = [
  "property_created",
  "area_added",
  "area_modified",
  "area_removed",
  "feature_added",
  "feature_moved",
  "feature_resized",
  "feature_regeometried",
  "feature_recontained",
  "feature_status_changed",
  "feature_removed",
  "adjacency_added",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Spatial attributes captured in before/after snapshots. */
export interface SpatialSnapshot {
  position?: Transform;
  geometry?: Polygon;
  dimensions?: Dimensions;
  vertical_envelope?: VerticalEnvelope;
  parent_feature_id?: string | null;
  parent_area_id?: string | null;
  status?: FeatureStatus;
  temporal_envelope?: TemporalEnvelope;
}

export interface SpatialChange {
  id: string;
  timestamp: ISO8601;
  event_kind: EventKind;
  property_id: string;
  affected_ids: string[];
  author?: string;
  /** prior values of changed spatial attributes, if any (canon §5.3) */
  before?: SpatialSnapshot;
  /** new values of changed spatial attributes, if any */
  after?: SpatialSnapshot;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Export format (canon §7.2, R-EXPORT-001: fixed schema)
// ---------------------------------------------------------------------------

export interface YmirPropertyExport {
  version: "1.0";
  property: Omit<Property, "areas" | "features">;
  areas: SpatialArea[];
  features: PhysicalFeature[];
  adjacencies: SpatialAdjacency[];
  changes: SpatialChange[];
  metadata: {
    created_at: ISO8601;
    exported_at: ISO8601;
    app_version?: string;
  };
}

// ---------------------------------------------------------------------------
// Validation results
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  code:
    | "centroid_outside_container"
    | "centroid_near_boundary"
    | "unknown_kind"
    | "forced_override";
  message: string;
  subject_id?: string;
}

export class YmirValidationError extends Error {
  constructor(
    public readonly code:
      | "circular_containment"
      | "temporal_inconsistency"
      | "duplicate_id"
      | "missing_required_field"
      | "invalid_kind"
      | "invalid_geometry"
      | "unknown_reference"
      | "strict_containment_violation"
      | "property_id_conflict",
    message: string,
    /** for property_id_conflict: suggested rename (R-EXPORT-002) */
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "YmirValidationError";
  }
}

/** Write-mode options (R-API-003: strict default, force override, logged). */
export interface WriteOptions {
  /** effective timestamp of the change; defaults to now */
  at?: ISO8601;
  author?: string;
  /** upgrade centroid-containment warnings to rejections (canon §4.4 strict mode) */
  strict?: boolean;
  /** force override: proceed despite rejectable validation, logged (R-API-003) */
  force?: boolean;
  /** optional transaction group id (R-TIME-003: granular with grouping) */
  transaction_id?: string;
}

export interface WriteResult<T> {
  value: T;
  warnings: ValidationWarning[];
  change_ids: string[];
}
