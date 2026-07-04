/**
 * Import/export (canon §7.2, §9; R-EXPORT-001/002, R-STORE-004, R-DOMAIN-003).
 *
 * - Export: fixed schema YmirPropertyExport, version "1.0", validated strictly
 *   on import (R-EXPORT-001). Includes the full change log — the log is the
 *   positional-versioning authority (§5.4) and travels with the property.
 * - Import: property ID conflict → reject with a rename suggestion, user
 *   decides (R-EXPORT-002). UNKNOWN kinds preserved with a warning
 *   (R-DOMAIN-003). source_ref upserts are strict (R-STORE-004).
 */

import { randomUUID } from "node:crypto";
import type {
  PhysicalFeature,
  SpatialChange,
  ValidationWarning,
  YmirPropertyExport,
} from "./types.js";
import { isValidFeatureKind, YmirValidationError } from "./types.js";
import type { YmirEngine } from "./engine.js";
import { normalizeTimestamp } from "./temporal.js";

export interface ImportResult {
  property_id: string;
  imported_areas: number;
  imported_features: number;
  imported_adjacencies: number;
  imported_changes: number;
  warnings: ValidationWarning[];
}

export function exportProperty(engine: YmirEngine, propertyId: string): YmirPropertyExport {
  const property = engine.getProperty(propertyId);
  const storage = engine.internalStorage;
  const { areas, features, ...propertyRow } = property;
  return {
    version: "1.0",
    property: propertyRow,
    areas,
    features,
    adjacencies: storage.getAdjacencies(propertyId),
    changes: storage.getChanges(propertyId),
    metadata: {
      created_at: property.created_at,
      exported_at: new Date().toISOString(),
      app_version: "ymir-core 0.1.0",
    },
  };
}

/** Strict fixed-schema validation on import (R-EXPORT-001). */
function validateExportShape(data: unknown): asserts data is YmirPropertyExport {
  const d = data as Partial<YmirPropertyExport>;
  if (!d || typeof d !== "object") {
    throw new YmirValidationError("missing_required_field", "import payload is not an object");
  }
  if (d.version !== "1.0") {
    throw new YmirValidationError(
      "missing_required_field",
      `unsupported export version '${String(d.version)}' — expected "1.0" (R-EXPORT-001 fixed schema)`,
    );
  }
  for (const field of ["property", "areas", "features", "adjacencies", "changes", "metadata"] as const) {
    if (d[field] === undefined) {
      throw new YmirValidationError("missing_required_field", `import payload missing '${field}'`);
    }
  }
  if (!d.property?.id || !d.property?.name || !d.property?.boundary) {
    throw new YmirValidationError("missing_required_field", "import property missing id/name/boundary");
  }
}

export function importProperty(engine: YmirEngine, data: unknown): ImportResult {
  validateExportShape(data);
  const payload = data;
  const storage = engine.internalStorage;
  const warnings: ValidationWarning[] = [];

  // R-EXPORT-002: reject on property ID conflict with a rename offer.
  if (storage.getPropertyRow(payload.property.id)) {
    throw new YmirValidationError(
      "property_id_conflict",
      `property ${payload.property.id} already exists — import rejected; re-import under a new ID to keep both`,
      `${payload.property.id}-imported-${new Date().toISOString().slice(0, 10)}`,
    );
  }

  // Kind validation with UNKNOWN pass-through (R-DOMAIN-003).
  for (const feature of payload.features) {
    if (feature.kind === "unknown") {
      warnings.push({
        code: "unknown_kind",
        message: `feature ${feature.id} ('${feature.name}') imported with kind 'unknown' — preserved (R-DOMAIN-003)`,
        subject_id: feature.id,
      });
    } else if (!isValidFeatureKind(feature.kind)) {
      throw new YmirValidationError(
        "invalid_kind",
        `feature ${feature.id}: kind '${feature.kind}' is neither core nor 'domain:'-namespaced`,
      );
    }
  }

  const now = new Date().toISOString();
  storage.transaction(() => {
    storage.insertProperty({
      id: payload.property.id,
      name: payload.property.name,
      description: payload.property.description,
      boundary: payload.property.boundary,
      coordinate_convention: payload.property.coordinate_convention,
      wgs84_origin: payload.property.wgs84_origin,
      created_at: payload.property.created_at,
      updated_at: payload.property.updated_at,
    });
    for (const area of payload.areas) storage.insertArea(area, now);
    for (const feature of payload.features) storage.insertFeature(feature, now);
    for (const adjacency of payload.adjacencies) storage.insertAdjacency(adjacency);
    // The change log travels with the property (§5.4: replay authority).
    for (const change of payload.changes) storage.insertChange(change);
  });

  return {
    property_id: payload.property.id,
    imported_areas: payload.areas.length,
    imported_features: payload.features.length,
    imported_adjacencies: payload.adjacencies.length,
    imported_changes: payload.changes.length,
    warnings,
  };
}

/**
 * Strict source_ref upsert (R-STORE-004): exact source_ref match updates the
 * existing feature; no match creates a new one; fuzzy matching is deliberately
 * absent. Used by import adapters (canon §9).
 */
export function upsertFeatureBySourceRef(
  engine: YmirEngine,
  propertyId: string,
  sourceRef: string,
  spec: Parameters<YmirEngine["addFeature"]>[1],
  opts?: Parameters<YmirEngine["addFeature"]>[2],
): { feature: PhysicalFeature; created: boolean; warnings: ValidationWarning[] } {
  const storage = engine.internalStorage;
  const existing = storage.findFeatureBySourceRef(propertyId, sourceRef);
  if (!existing) {
    const result = engine.addFeature(propertyId, { ...spec, source_ref: sourceRef }, opts);
    return { feature: result.value, created: true, warnings: result.warnings };
  }
  // Idempotent re-import: apply spatial updates through the write API so the
  // change log stays authoritative.
  const warnings: ValidationWarning[] = [];
  let feature = existing;
  const posChanged =
    existing.position.x !== spec.position.x ||
    existing.position.y !== spec.position.y ||
    (existing.position.heading ?? 0) !== (spec.position.heading ?? 0);
  if (posChanged) {
    const r = engine.moveFeature(existing.id, spec.position, opts);
    feature = r.value;
    warnings.push(...r.warnings);
  }
  if (
    spec.dimensions &&
    JSON.stringify(spec.dimensions) !== JSON.stringify(existing.dimensions)
  ) {
    const r = engine.resizeFeature(existing.id, spec.dimensions, opts);
    feature = r.value;
    warnings.push(...r.warnings);
  }
  if (spec.geometry && JSON.stringify(spec.geometry) !== JSON.stringify(existing.geometry)) {
    const r = engine.setFeatureGeometry(existing.id, spec.geometry, opts);
    feature = r.value;
    warnings.push(...r.warnings);
  }
  return { feature, created: false, warnings };
}

/** Re-id a full export payload so a conflicted import can be kept alongside the original (R-EXPORT-002 rename path). */
export function renameExportForImport(payload: YmirPropertyExport, newId: string, newName?: string): YmirPropertyExport {
  const idMap = new Map<string, string>();
  idMap.set(payload.property.id, newId);
  const mapId = (id: string): string => {
    if (!idMap.has(id)) idMap.set(id, randomUUID());
    return idMap.get(id)!;
  };
  const remapChange = (c: SpatialChange): SpatialChange => ({
    ...c,
    id: randomUUID(),
    property_id: newId,
    affected_ids: c.affected_ids.map(mapId),
    details: remapDetails(c.details),
  });
  const remapDetails = (details: Record<string, unknown>): Record<string, unknown> => {
    const entity = details["entity"] as Record<string, unknown> | undefined;
    if (!entity || typeof entity["id"] !== "string") return details;
    return {
      ...details,
      entity: {
        ...entity,
        id: mapId(entity["id"] as string),
        property_id: newId,
        ...(typeof entity["parent_feature_id"] === "string"
          ? { parent_feature_id: mapId(entity["parent_feature_id"] as string) }
          : {}),
        ...(typeof entity["parent_area_id"] === "string"
          ? { parent_area_id: mapId(entity["parent_area_id"] as string) }
          : {}),
        ...(typeof entity["parent_structure_id"] === "string"
          ? { parent_structure_id: mapId(entity["parent_structure_id"] as string) }
          : {}),
        ...(typeof entity["area1_id"] === "string" ? { area1_id: mapId(entity["area1_id"] as string) } : {}),
        ...(typeof entity["area2_id"] === "string" ? { area2_id: mapId(entity["area2_id"] as string) } : {}),
      },
    };
  };

  // First pass: register all entity ids so references remap consistently.
  for (const a of payload.areas) mapId(a.id);
  for (const f of payload.features) mapId(f.id);
  for (const adj of payload.adjacencies) mapId(adj.id);

  return {
    ...payload,
    property: { ...payload.property, id: newId, name: newName ?? payload.property.name },
    areas: payload.areas.map((a) => ({
      ...a,
      id: mapId(a.id),
      property_id: newId,
      parent_structure_id: a.parent_structure_id ? mapId(a.parent_structure_id) : undefined,
    })),
    features: payload.features.map((f) => ({
      ...f,
      id: mapId(f.id),
      property_id: newId,
      parent_feature_id: f.parent_feature_id ? mapId(f.parent_feature_id) : undefined,
      parent_area_id: f.parent_area_id ? mapId(f.parent_area_id) : undefined,
    })),
    adjacencies: payload.adjacencies.map((adj) => ({
      ...adj,
      id: mapId(adj.id),
      area1_id: mapId(adj.area1_id),
      area2_id: mapId(adj.area2_id),
    })),
    changes: payload.changes.map(remapChange),
  };
}

export { normalizeTimestamp };
