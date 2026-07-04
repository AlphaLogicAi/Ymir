/**
 * YmirEngine — the library API surface (canon §8.1).
 *
 * Single write source (canon §6.3): consumers never mutate spatial data
 * directly; every write flows through this API, is validated (§4.4), recorded
 * in the spatial_changes log (§5.4 authority), and notified to subscribers
 * (§5.3, R-API-002).
 */

import { randomUUID } from "node:crypto";
import type {
  AreaKind,
  AreaOrientation,
  AreaPurpose,
  Dimensions,
  EventKind,
  FeatureKind,
  FeatureStatus,
  ISO8601,
  ObservedLightQuality,
  PhysicalFeature,
  Polygon,
  Property,
  SpatialAdjacency,
  SpatialArea,
  SpatialChange,
  SpatialSnapshot,
  Transform,
  ValidationWarning,
  VerticalEnvelope,
  Wgs84Origin,
  WriteOptions,
  WriteResult,
} from "./types.js";
import { COORDINATE_CONVENTION, YmirValidationError } from "./types.js";
import {
  deriveBoundaryMeasurements,
  polygonArea,
  roundCm,
  roundPolygon,
  roundTransform,
} from "./geometry.js";
import { YmirStorage } from "./storage.js";
import {
  assertClosedPolygon,
  assertNoContainmentCycle,
  assertTemporalConsistency,
  assertValidKind,
  checkCentroidContainment,
  resolveContainer,
} from "./validation.js";
import { activeAt, normalizeTimestamp, replayChanges, stateActiveAt } from "./temporal.js";

export interface PropertySpec {
  id?: string;
  name: string;
  description?: string;
  boundary: Polygon;
  wgs84_origin?: Wgs84Origin;
}

export interface AreaSpec {
  id?: string;
  name: string;
  kind: AreaKind;
  purpose?: AreaPurpose;
  geometry: Polygon;
  elevation?: number;
  parent_structure_id?: string;
  orientation?: AreaOrientation;
  observed_light?: ObservedLightQuality;
}

export interface FeatureSpec {
  id?: string;
  name: string;
  kind: FeatureKind;
  status?: FeatureStatus;
  geometry?: Polygon;
  position: Transform;
  dimensions?: Dimensions;
  vertical_envelope?: VerticalEnvelope;
  parent_feature_id?: string;
  parent_area_id?: string;
  source_ref?: string;
  tags?: string[];
  observed_light?: ObservedLightQuality;
  metadata?: Record<string, unknown>;
}

export interface FeatureFilter {
  kind?: FeatureKind;
  status?: FeatureStatus;
  parent_area_id?: string;
  parent_feature_id?: string;
}

export type Unsubscribe = () => void;
export type ChangeListener = (change: SpatialChange) => void;

/** Snapshot of a feature's spatial attributes for before/after logging (canon §5.3). */
function spatialSnapshot(f: PhysicalFeature): SpatialSnapshot {
  return {
    position: f.position,
    geometry: f.geometry,
    dimensions: f.dimensions,
    vertical_envelope: f.vertical_envelope,
    parent_feature_id: f.parent_feature_id ?? null,
    parent_area_id: f.parent_area_id ?? null,
    status: f.status,
    temporal_envelope: f.temporal_envelope,
  };
}

export class YmirEngine {
  private readonly storage: YmirStorage;
  private readonly listeners = new Map<string, Set<ChangeListener>>();

  constructor(dbPath: string = ":memory:") {
    this.storage = new YmirStorage(dbPath);
  }

  close(): void {
    this.storage.close();
  }

  /** Escape hatch for import/export modules; not part of the consumer contract. */
  get internalStorage(): YmirStorage {
    return this.storage;
  }

  // -- change log plumbing ---------------------------------------------------

  private emit(change: SpatialChange): void {
    const set = this.listeners.get(change.property_id);
    if (set) for (const listener of set) listener(change);
  }

  private record(
    propertyId: string,
    eventKind: EventKind,
    affectedIds: string[],
    opts: WriteOptions | undefined,
    details: Record<string, unknown>,
    before?: SpatialSnapshot,
    after?: SpatialSnapshot,
  ): SpatialChange {
    const change: SpatialChange = {
      id: randomUUID(),
      property_id: propertyId,
      timestamp: normalizeTimestamp(opts?.at ?? new Date().toISOString()),
      event_kind: eventKind,
      affected_ids: affectedIds,
      author: opts?.author,
      before,
      after,
      details,
    };
    this.storage.insertChange(change, opts?.transaction_id);
    this.emit(change);
    return change;
  }

  // -- properties ------------------------------------------------------------

  createProperty(spec: PropertySpec, opts?: WriteOptions): WriteResult<Property> {
    const boundary = roundPolygon(spec.boundary);
    assertClosedPolygon(boundary, "property boundary");

    const id = spec.id ?? randomUUID();
    if (this.storage.getPropertyRow(id)) {
      throw new YmirValidationError(
        "property_id_conflict",
        `property ${id} already exists`,
        `${id}-imported-${new Date().toISOString().slice(0, 10)}`,
      );
    }

    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    const derived = deriveBoundaryMeasurements(boundary);
    const record = {
      id,
      name: spec.name,
      description: spec.description,
      boundary,
      coordinate_convention: COORDINATE_CONVENTION,
      wgs84_origin: spec.wgs84_origin,
      created_at: now,
      updated_at: now,
    };

    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.insertProperty(record);
      const change = this.record(id, "property_created", [id], opts, {
        name: spec.name,
        boundary,
      });
      changeIds.push(change.id);
    });

    return {
      value: { ...record, ...derived, areas: [], features: [] },
      warnings: [],
      change_ids: changeIds,
    };
  }

  getProperty(id: string): Property {
    const row = this.storage.getPropertyRow(id);
    if (!row) throw new YmirValidationError("unknown_reference", `property ${id} does not exist`);
    return {
      ...row,
      areas: this.storage.getAreas(id),
      features: this.storage.getFeatures(id),
    };
  }

  listProperties(): Omit<Property, "areas" | "features">[] {
    return this.storage.listPropertyRows();
  }

  /** Name/description only — the boundary is immutable in v1 (R-TIME-002). */
  updateProperty(
    id: string,
    updates: { name?: string; description?: string },
    opts?: WriteOptions,
  ): Property {
    const existing = this.storage.getPropertyRow(id);
    if (!existing) throw new YmirValidationError("unknown_reference", `property ${id} does not exist`);
    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    this.storage.updatePropertyMeta(
      id,
      updates.name ?? existing.name,
      updates.description ?? existing.description,
      now,
    );
    return this.getProperty(id);
  }

  // -- areas -------------------------------------------------------------

  addArea(propertyId: string, spec: AreaSpec, opts?: WriteOptions): WriteResult<SpatialArea> {
    const property = this.storage.getPropertyRow(propertyId);
    if (!property) {
      throw new YmirValidationError("unknown_reference", `property ${propertyId} does not exist`);
    }
    const geometry = roundPolygon(spec.geometry);
    assertClosedPolygon(geometry, `area ${spec.name}`);

    if (spec.parent_structure_id && !this.storage.getFeature(spec.parent_structure_id)) {
      throw new YmirValidationError(
        "unknown_reference",
        `parent_structure_id ${spec.parent_structure_id} does not exist`,
      );
    }

    const id = spec.id ?? randomUUID();
    if (this.storage.getArea(id)) {
      throw new YmirValidationError("duplicate_id", `area ${id} already exists`);
    }

    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    const area: SpatialArea = {
      id,
      property_id: propertyId,
      name: spec.name,
      kind: spec.kind,
      purpose: spec.purpose,
      geometry,
      area_m2: polygonArea(geometry),
      elevation: spec.elevation,
      parent_structure_id: spec.parent_structure_id,
      temporal_envelope: { from: now },
      orientation: spec.orientation,
      observed_light: spec.observed_light,
    };
    assertTemporalConsistency(area.temporal_envelope, `area ${id}`);

    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.insertArea(area, now);
      const change = this.record(
        propertyId,
        "area_added",
        [id],
        opts,
        { entity: area },
        undefined,
        { geometry: area.geometry, temporal_envelope: area.temporal_envelope },
      );
      changeIds.push(change.id);
    });

    return { value: area, warnings: [], change_ids: changeIds };
  }

  modifyAreaGeometry(areaId: string, geometry: Polygon, opts?: WriteOptions): WriteResult<SpatialArea> {
    const existing = this.storage.getArea(areaId);
    if (!existing) throw new YmirValidationError("unknown_reference", `area ${areaId} does not exist`);
    const rounded = roundPolygon(geometry);
    assertClosedPolygon(rounded, `area ${areaId}`);

    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    const updated: SpatialArea = { ...existing, geometry: rounded, area_m2: polygonArea(rounded) };

    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.updateArea(updated, now);
      const change = this.record(
        existing.property_id,
        "area_modified",
        [areaId],
        opts,
        { entity: updated },
        { geometry: existing.geometry },
        { geometry: rounded },
      );
      changeIds.push(change.id);
    });

    return { value: updated, warnings: [], change_ids: changeIds };
  }

  getAreas(propertyId: string): SpatialArea[] {
    return this.storage.getAreas(propertyId);
  }

  getArea(id: string): SpatialArea {
    const area = this.storage.getArea(id);
    if (!area) throw new YmirValidationError("unknown_reference", `area ${id} does not exist`);
    return area;
  }

  // -- features ----------------------------------------------------------

  getFeatures(propertyId: string, filter?: FeatureFilter): PhysicalFeature[] {
    let features = this.storage.getFeatures(propertyId);
    if (filter?.kind) features = features.filter((f) => f.kind === filter.kind);
    if (filter?.status) features = features.filter((f) => f.status === filter.status);
    if (filter?.parent_area_id) features = features.filter((f) => f.parent_area_id === filter.parent_area_id);
    if (filter?.parent_feature_id) features = features.filter((f) => f.parent_feature_id === filter.parent_feature_id);
    return features;
  }

  getFeature(id: string): PhysicalFeature {
    const feature = this.storage.getFeature(id);
    if (!feature) throw new YmirValidationError("unknown_reference", `feature ${id} does not exist`);
    return feature;
  }

  addFeature(propertyId: string, spec: FeatureSpec, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    const property = this.storage.getPropertyRow(propertyId);
    if (!property) {
      throw new YmirValidationError("unknown_reference", `property ${propertyId} does not exist`);
    }
    assertValidKind(spec.kind, `feature ${spec.name}`);
    if (!spec.name) throw new YmirValidationError("missing_required_field", "feature name is required");
    if (!spec.position) throw new YmirValidationError("missing_required_field", "feature position is required");

    const id = spec.id ?? randomUUID();
    if (this.storage.getFeature(id)) {
      throw new YmirValidationError("duplicate_id", `feature ${id} already exists`);
    }

    const geometry = spec.geometry ? roundPolygon(spec.geometry) : undefined;
    if (geometry) assertClosedPolygon(geometry, `feature ${spec.name}`);
    const position = roundTransform(spec.position);
    const dimensions = spec.dimensions
      ? {
          width_m: roundCm(spec.dimensions.width_m),
          depth_m: roundCm(spec.dimensions.depth_m),
          height_m: roundCm(spec.dimensions.height_m),
        }
      : undefined;

    // Cycle detection (R-CONSTRAINT-002): unconditional, force cannot bypass.
    assertNoContainmentCycle(id, spec.parent_feature_id, (fid) => this.storage.getFeature(fid)?.parent_feature_id);

    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    const feature: PhysicalFeature = {
      id,
      property_id: propertyId,
      name: spec.name,
      kind: spec.kind,
      status: spec.status ?? "active",
      geometry,
      position,
      dimensions,
      vertical_envelope: spec.vertical_envelope,
      parent_feature_id: spec.parent_feature_id,
      parent_area_id: spec.parent_area_id,
      temporal_envelope: { from: now },
      source_ref: spec.source_ref,
      tags: spec.tags,
      observed_light: spec.observed_light,
      metadata: spec.metadata,
    };
    assertTemporalConsistency(feature.temporal_envelope, `feature ${id}`);

    const warnings = this.runContainmentCheck(feature, property.boundary, propertyId, opts);

    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.insertFeature(feature, now);
      const change = this.record(
        propertyId,
        "feature_added",
        [id],
        opts,
        { entity: feature, warnings },
        undefined,
        spatialSnapshot(feature),
      );
      changeIds.push(change.id);
    });

    return { value: feature, warnings, change_ids: changeIds };
  }

  moveFeature(featureId: string, newPosition: Transform, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    return this.mutateFeature(featureId, "feature_moved", opts, (f) => ({
      ...f,
      position: roundTransform(newPosition),
    }));
  }

  resizeFeature(featureId: string, dimensions: Dimensions, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    return this.mutateFeature(featureId, "feature_resized", opts, (f) => ({
      ...f,
      dimensions: {
        width_m: roundCm(dimensions.width_m),
        depth_m: roundCm(dimensions.depth_m),
        height_m: roundCm(dimensions.height_m),
      },
    }));
  }

  setFeatureGeometry(featureId: string, geometry: Polygon, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    const rounded = roundPolygon(geometry);
    assertClosedPolygon(rounded, `feature ${featureId}`);
    return this.mutateFeature(featureId, "feature_regeometried", opts, (f) => ({
      ...f,
      geometry: rounded,
    }));
  }

  recontainFeature(
    featureId: string,
    parents: { parent_area_id?: string; parent_feature_id?: string },
    opts?: WriteOptions,
  ): WriteResult<PhysicalFeature> {
    // Cycle detection before mutation (R-CONSTRAINT-002): unconditional.
    assertNoContainmentCycle(featureId, parents.parent_feature_id, (fid) => this.storage.getFeature(fid)?.parent_feature_id);
    return this.mutateFeature(featureId, "feature_recontained", opts, (f) => ({
      ...f,
      parent_area_id: parents.parent_area_id,
      parent_feature_id: parents.parent_feature_id,
    }));
  }

  setFeatureStatus(featureId: string, status: FeatureStatus, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    return this.mutateFeature(featureId, "feature_status_changed", opts, (f) => ({ ...f, status }), {
      skipContainment: true,
    });
  }

  removeFeature(featureId: string, reason: string, opts?: WriteOptions): WriteResult<PhysicalFeature> {
    const at = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    return this.mutateFeature(
      featureId,
      "feature_removed",
      opts,
      (f) => ({
        ...f,
        status: "removed",
        temporal_envelope: { ...f.temporal_envelope, to: at, note: reason },
      }),
      { skipContainment: true },
    );
  }

  private mutateFeature(
    featureId: string,
    eventKind: EventKind,
    opts: WriteOptions | undefined,
    apply: (f: PhysicalFeature) => PhysicalFeature,
    flags?: { skipContainment?: boolean },
  ): WriteResult<PhysicalFeature> {
    const existing = this.storage.getFeature(featureId);
    if (!existing) throw new YmirValidationError("unknown_reference", `feature ${featureId} does not exist`);
    const property = this.storage.getPropertyRow(existing.property_id);
    if (!property) throw new YmirValidationError("unknown_reference", `property ${existing.property_id} missing`);

    const updated = apply(existing);
    assertTemporalConsistency(updated.temporal_envelope, `feature ${featureId}`);

    const warnings = flags?.skipContainment
      ? []
      : this.runContainmentCheck(updated, property.boundary, existing.property_id, opts);

    const now = normalizeTimestamp(opts?.at ?? new Date().toISOString());
    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.updateFeature(updated, now);
      const change = this.record(
        existing.property_id,
        eventKind,
        [featureId],
        opts,
        { entity: updated, warnings },
        spatialSnapshot(existing),
        spatialSnapshot(updated),
      );
      changeIds.push(change.id);
    });

    return { value: updated, warnings, change_ids: changeIds };
  }

  /**
   * Centroid containment (R-CONSTRAINT-003, canon §4.4): warning by default;
   * strict mode rejects; force proceeds despite strict with a logged override.
   * Hard invariants (cycles, temporal) are NOT force-bypassable.
   */
  private runContainmentCheck(
    feature: PhysicalFeature,
    propertyBoundary: Polygon,
    propertyId: string,
    opts: WriteOptions | undefined,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];
    const container = resolveContainer(feature, {
      getArea: (id) => this.storage.getArea(id),
      getFeature: (id) => this.storage.getFeature(id),
      propertyBoundary,
      propertyId,
    });
    const warning = checkCentroidContainment(feature, container);
    if (warning) {
      if (opts?.strict && !opts?.force) {
        throw new YmirValidationError(
          "strict_containment_violation",
          `strict mode: ${warning.message} (centroid containment is warning-level by default; this write ran with strict=true — R-CONSTRAINT-003)`,
        );
      }
      warnings.push(warning);
      if (opts?.strict && opts?.force) {
        warnings.push({
          code: "forced_override",
          message: `strict containment violation overridden by force for feature ${feature.id} (logged, R-API-003)`,
          subject_id: feature.id,
        });
      }
    }
    return warnings;
  }

  // -- adjacency (canon §4.2) ----------------------------------------------

  addAdjacency(
    area1Id: string,
    area2Id: string,
    spec: { relationship: SpatialAdjacency["relationship"]; opening?: SpatialAdjacency["opening"]; notes?: string },
    opts?: WriteOptions,
  ): WriteResult<SpatialAdjacency> {
    const area1 = this.storage.getArea(area1Id);
    const area2 = this.storage.getArea(area2Id);
    if (!area1) throw new YmirValidationError("unknown_reference", `area ${area1Id} does not exist`);
    if (!area2) throw new YmirValidationError("unknown_reference", `area ${area2Id} does not exist`);

    const adjacency: SpatialAdjacency = {
      id: randomUUID(),
      area1_id: area1Id,
      area2_id: area2Id,
      relationship: spec.relationship,
      opening: spec.opening,
      notes: spec.notes,
    };

    const changeIds: string[] = [];
    this.storage.transaction(() => {
      this.storage.insertAdjacency(adjacency);
      const change = this.record(area1.property_id, "adjacency_added", [adjacency.id, area1Id, area2Id], opts, {
        entity: adjacency,
      });
      changeIds.push(change.id);
    });

    return { value: adjacency, warnings: [], change_ids: changeIds };
  }

  getAdjacentAreas(areaId: string): SpatialArea[] {
    const adjacencies = this.storage.getAdjacenciesForArea(areaId);
    const neighborIds = adjacencies.map((a) => (a.area1_id === areaId ? a.area2_id : a.area1_id));
    return neighborIds
      .map((id) => this.storage.getArea(id))
      .filter((a): a is SpatialArea => a !== undefined);
  }

  // -- temporal queries (canon §5.2 / §5.4 — replay is the authority) --------

  /**
   * Reconstruct the property as of `date`: every entity's spatial attributes
   * reflect their values AT that date via change-log replay, not their
   * current values (canon §5.2, §5.4).
   */
  propertyAt(propertyId: string, asOfDate: ISO8601): Property {
    const row = this.storage.getPropertyRow(propertyId);
    if (!row) throw new YmirValidationError("unknown_reference", `property ${propertyId} does not exist`);
    const date = normalizeTimestamp(asOfDate);
    const changes = this.storage.getChanges(propertyId, { upTo: date });
    const replayed = replayChanges(changes);
    const active = stateActiveAt(replayed, date);
    return { ...row, areas: active.areas, features: active.features };
  }

  /** All features active on `date`, in their as-of-date spatial state. */
  featuresActiveAt(propertyId: string, date: ISO8601): PhysicalFeature[] {
    return this.propertyAt(propertyId, date).features;
  }

  /** Full version timeline for one feature (canon §5.2): every event, in order. */
  featureHistory(featureId: string): SpatialChange[] {
    return this.storage.getChangesForSubject(featureId);
  }

  // -- event log API (canon §5.3, §8; R-API-002: log + observer) -------------

  /**
   * Cursor-based change reads: consumers track their last-seen change id and
   * poll for everything after it (R-API-002 event-log pattern).
   */
  getChangesSince(propertyId: string, afterChangeId?: string, limit?: number): SpatialChange[] {
    return this.storage.getChanges(propertyId, { afterChangeId, limit });
  }

  /** In-process observer (R-API-002, library mode). */
  subscribe(propertyId: string, listener: ChangeListener): Unsubscribe {
    let set = this.listeners.get(propertyId);
    if (!set) {
      set = new Set();
      this.listeners.set(propertyId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
}

export { activeAt, normalizeTimestamp };
