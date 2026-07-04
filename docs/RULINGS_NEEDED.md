# Ymir — Rulings Needed

**Status:** LOCKED — v1.1 · **Session:** Design architecture 2026-07-04 · **Rulings locked:** 2026-07-04

This document lists every significant judgment call, trade-off, and open question that emerged during the design session. All 26 rulings below are now decided and locked. Most decisions match the session's original recommendation (marked "matches recommendation"); a small number override the recommendation or amend it, called out individually below and summarized here for visibility.

## Overrides and Amendments (Summary)

- **R-STORE-003 (override):** Change log retention is **forever**, not the recommended configurable/default-2-years policy. Reason: positional versioning (`YMIR_SPATIAL_ARCHITECTURE.md` §5.4) makes the log the sole authority for reconstructing spatial state as of a past date — pruning it breaks historical queries before the prune point.
- **R-DOMAIN-001 (override):** FeatureKind is **hybrid — core enum + `domain:` prefix** — adopted immediately, not deferred until "extensibility becomes painful" as recommended. Two consumer domains already exist; waiting would block them on core schema releases.
- **R-FUTURE-002 (amendment):** Media references accept **`url`, `local_path`, or `brisingamen_asset_id`** — the recommendation only covered kind/url pairs. Brísingamen is an existing estate asset system; features referencing assets already living there shouldn't need a URL/path detour.

A related non-ruling addition: positional versioning was made explicit canon (§5.4 of the architecture doc) — this closes a gap the original draft left implicit (whether `property_at(date)` returns as-of *existence* only, or full as-of *spatial state*). It is now explicit: full as-of spatial state, via change-log replay as authority.

---

## Category: Storage and Persistence

### R-STORE-001: Primary Storage Medium

**Question:** Should Ymir's primary storage be SQLite, a JSON document store, or something else?

**Context:** SQLite is mature, local-first, ACID-compliant, and suitable for embedded distribution. JSON is schema-flexible and human-readable. RocksDB or similar would be faster for large properties.

**Trade-offs:**
- **SQLite:** Mature, portable, ACID, queryable, but schema rigidity.
- **JSON + indexing:** Flexible, human-readable, but schema evolution is implicit.
- **RocksDB/embedded DB:** Performance for large datasets (1000s of features), but less ecosystem support.

**Recommendation:** SQLite for v1 (mature, standard, portable). Revisit if performance testing shows bottlenecks.

**Decision (LOCKED):** ✅ SQLite — matches recommendation.

---

### R-STORE-002: Sync Strategy for Multi-Device Use

**Question:** For a user with the app on phone and desktop, how are changes synchronized?

**Context:** v1 may assume single-device. If multi-device is expected, we need conflict resolution, change logs, and either a backend service or cloud sync (Google Drive, iCloud, etc.).

**Trade-offs:**
- **No sync (v1 only):** Simple, but inconvenient for users.
- **Cloud backend:** Centralized, authoritative, complex infrastructure.
- **Peer-to-peer / cloud storage sync:** Decentralized, but conflict resolution is hard.
- **Change log + merge:** Replay changes, CRDT-like, but complex.

**Decision (LOCKED):** ✅ No sync in v1 — consistent with R-API-001 (library-only for v1); revisit alongside multi-device/service work in v2.

**Related:** R-API-001 (service vs. library).

---

### R-STORE-003: Change Log Retention

**Question:** How long do we keep the spatial change log?

**Context:** The change log enables historical queries and multi-device sync. But keeping infinite history consumes space.

**Options:**
- **Forever:** Preserves full audit trail, but storage grows unbounded.
- **Configurable retention:** User deletes old logs, but risks losing history.
- **Snapshot + delta:** Periodically snapshot and prune old logs.

**Recommendation:** Configurable retention (default: 2 years or 10,000 events).

**Decision (LOCKED — OVERRIDE):** ✅ Forever — overrides the configurable-retention recommendation above. Reason: positional versioning (`YMIR_SPATIAL_ARCHITECTURE.md` §5.4) makes the change log the sole authority for reconstructing a feature's spatial state as of any past date; pruning it would silently break `property_at(date)` for anything before the prune point. Unbounded storage growth is an accepted trade-off against silent historical-query corruption.

---

### R-STORE-004: Import Alias Deduplication Strategy

**Question:** When importing from GardenOS or other sources, how do we handle idempotent upserts?

**Context:** An import might run multiple times. We use `source_ref` as an alias. The question is: should importing the same source twice update the existing record or create a duplicate?

**Options:**
- **Strict ID matching:** source_ref must match exactly; any mismatch creates a new feature.
- **Fuzzy matching:** Consider source_ref + name + position to detect the "same" feature.
- **Configurable:** User chooses per-import.

**Recommendation:** Strict matching on source_ref; if missing, user must resolve manually or accept duplicates.

**Decision (LOCKED):** ✅ Strict matching on source_ref — matches recommendation.

---

## Category: Spatial Geometry and Coordinate System

### R-GEO-001: Numeric Precision for Coordinates

**Question:** What precision should we store for X, Y, Z, and heading?

**Context:** The canonical coordinate is SI (meters). Storage precision affects accuracy of spatial queries (overlap, containment) and file size.

**Options:**
- **Millimeter (0.001 m, 3 decimals):** Very precise, unnecessary for most features.
- **Centimeter (0.01 m, 2 decimals):** Practical for most gardening and interior design.
- **Decimeter (0.1 m, 1 decimal):** Coarser but sufficient for approximate layouts.

**Recommendation:** 0.01 m (centimeter) for position and dimensions; degree for heading.

**Decision (LOCKED):** ✅ Centimeter (0.01 m) for position/dimensions; degree for heading — matches recommendation.

---

### R-GEO-002: Polygon Simplification and Minimum Vertices

**Question:** Should we enforce minimum vertex count, simplification tolerance, or leave it unconstrained?

**Context:** Complex polygons (many vertices) are more accurate but slower to process and larger to store. Simple polygons (few vertices) are faster but lose detail.

**Options:**
- **No constraints:** Store whatever the user provides.
- **Simplification on import:** Automatically reduce vertices to a tolerance (e.g., 0.1 m).
- **Minimum vertex count:** Require at least 3 (triangle) or 4 (quad) vertices, but allow user control.

**Recommendation:** No constraints in v1; offer optional simplification as a consumer app feature.

**Decision (LOCKED):** ✅ No constraints in v1 — matches recommendation; consumer apps may offer simplification as a feature.

---

### R-GEO-003: Coordinate Frame Nesting Depth Limit

**Question:** Can a feature be nested arbitrarily deep (Structure > Room > Furniture > Sub-feature), or should we limit nesting?

**Context:** Deep nesting increases complexity for coordinate transformation and containment queries. Most real-world properties have 2-3 levels (property > room > furniture).

**Options:**
- **No limit:** Flexible, but complexity grows.
- **Hard limit (e.g., 4 levels):** Simplifies implementation, but inflexible.
- **Practical limit (3 levels) without enforcement:** Trust users, but document.

**Recommendation:** Document practical limit of 3-4 levels; no hard enforcement in v1.

**Decision (LOCKED):** ✅ Practical guidance (3–4 levels), no hard enforcement — matches recommendation.

---

### R-GEO-004: Heading Precision and Cardinal Conversion

**Question:** Should heading be stored as degrees only, or also provide cardinal directions (N, NE, E, etc.)?

**Context:** Heading is mathematically a number (0-360 degrees). Consumer apps may want to display/filter by cardinal direction ("north-facing windows").

**Options:**
- **Degrees only:** Minimal schema, consumers compute cardinals.
- **Computed cardinal:** Derive from degrees (e.g., "N" = 330–30°).
- **Both:** Store degrees and cardinal (slight redundancy).

**Recommendation:** Degrees only in core schema; consumers derive cardinals. Add computed cardinal as a helper function.

**Decision (LOCKED):** ✅ Degrees only in core schema, with a computed-cardinal helper — matches recommendation. This helper (`exposure_direction()`) is now the canonical way to derive directional exposure rather than storing it redundantly; see the Exposure split in `YMIR_SPATIAL_ARCHITECTURE.md` §4.3.

---

### R-GEO-005: Vertical Envelope Semantics for Containment

**Question:** If Feature A has a canopy top of 2.0 m and Feature B has a root zone of -0.5 m, and they occupy the same X/Y footprint, are they overlapping or layered?

**Context:** Ymir records but doesn't validate overlap. However, the semantics of "overlap" for containment checking need to be clear for apps that do enforce rules (e.g., "no two structures in the same place").

**Options:**
- **Ignore vertical:** Overlap is purely 2D (footprint).
- **Strict 3D:** Vertical envelopes must not intersect.
- **Layered interpretation:** Different layers (root, canopy) can coexist in the same footprint.

**Recommendation:** Layered interpretation: features can coexist vertically if layers don't overlap (e.g., roots and canopy of different plants). Ymir records this but doesn't enforce; consumers validate if needed.

**Decision (LOCKED):** ✅ Layered interpretation — matches recommendation.

---

## Category: API and Consumer Integration

### R-API-001: Library vs. Service API

**Question:** Should Ymir be consumed as a library (embedded in each app) or a service (running separately), or both?

**Context:** Library is simpler for v1, offline-first, and avoids backend infrastructure. Service enables better multi-device sync and central data management but adds complexity.

**Options:**
- **Library only:** Embedded in garden app and interior app; data syncs via cloud storage.
- **Service only:** Ymir runs as a server (local or cloud); apps are clients.
- **Both:** Library for single-device use, service for sync.

**Recommendation:** Library for v1. Service as an optional layer (v2) for multi-device support.

**Decision (LOCKED):** ✅ Library for v1; service as an optional v2 layer — matches recommendation.

---

### R-API-002: Change Notification Mechanism

**Question:** How should consumer apps learn about spatial changes (polling, webhooks, message queue)?

**Context:** If garden app and interior app both write to Ymir, each needs to know when the other made changes.

**Options:**
- **Polling:** Apps periodically query for changes.
- **Observer/subscriber pattern:** In-process callbacks (library only).
- **Event log table:** Apps read a change log and track their last-read position.
- **Webhooks/message queue:** (If service mode in future).

**Recommendation:** Event log table + optional observer pattern. Apps can poll the log or subscribe to callbacks (if library API).

**Decision (LOCKED):** ✅ Event log table, with an optional observer/callback pattern for library consumers — matches recommendation.

---

### R-API-003: Validation Strictness at Write Time

**Question:** When a consumer app requests a spatial write (e.g., "move feature"), how strict should validation be?

**Context:** Strict validation prevents invalid states but may reject legitimate complex operations (e.g., temporary overlap during a rearrangement). Lenient validation is flexible but could create data quality issues.

**Options:**
- **Strict:** All constraints checked; invalid requests rejected with clear error.
- **Lenient:** Record the request; validate asynchronously and flag issues.
- **Flexible:** Provide "strict" and "force" modes; apps choose.

**Recommendation:** Strict by default; provide "force" override for admin operations (user explicitly allows overlap, etc.). Log overrides.

**Decision (LOCKED):** ✅ Flexible with override — strict by default, explicit `force` mode for admin operations, all overrides logged — matches recommendation.

---

## Category: Temporal Modeling

### R-TIME-001: Temporal Resolution (Second vs. Day Level)

**Question:** Should temporal_envelope timestamps be second-precision (ISO 8601 datetime) or day-precision (date)?

**Context:** ISO 8601 datetime is precise to seconds; date-only (YYYY-MM-DD) is simpler and sufficient for most properties (e.g., "added on March 15, 2024"). Apps can assume midnight if day-only.

**Options:**
- **Datetime (second precision):** More precise, supports time-of-day operations.
- **Date only:** Simpler, sufficient for most use cases.
- **User's choice:** Let importers specify; convert to ISO 8601 datetime internally.

**Recommendation:** ISO 8601 datetime with time optional (default to start of day if omitted).

**Decision (LOCKED):** ✅ ISO 8601 datetime, time-of-day optional (defaults to start of day) — matches recommendation.

---

### R-TIME-002: Historical Query Completeness

**Question:** When querying `property_as_of(date)`, what if the property boundary changed (e.g., expanded in 2020)? Should the returned boundary be the boundary on that date?

**Context:** The property boundary could theoretically change (land purchased, sold, partitioned). Ymir records temporal envelopes for features but not for the property itself.

**Options:**
- **Property boundary is static:** Never changes; it's an annotation to the root object.
- **Property boundary is temporal:** Could be a SpatialArea with its own temporal envelope.
- **Scope to v1:** Assume property boundary is immutable; revisit in v2.

**Recommendation:** Property boundary is immutable in v1. If land is subdivided/expanded, it's a new property.

**Decision (LOCKED):** ✅ Property boundary is immutable in v1 — matches recommendation. Subdivision/expansion is modeled as a new property, not a mutation of the existing one. (Distinct from R-TIME-003/§5.4's positional versioning of *features* — the property root boundary itself stays out of that mechanism in v1.)

---

### R-TIME-003: Event Log Grain (Feature-Level or Property-Level)

**Question:** Should change events be granular (one event per feature change) or batched (one event per property update)?

**Context:** Granular events are useful for detailed tracking; batched events are simpler to process.

**Options:**
- **Granular:** Each feature add/move/remove is a separate event.
- **Batched:** Multiple changes in one transaction become one event.

**Recommendation:** Granular with optional transaction grouping (allow apps to group related changes).

**Decision (LOCKED):** ✅ Granular, with optional transaction grouping — matches recommendation. This is also the mechanism underlying positional versioning; see `YMIR_SPATIAL_ARCHITECTURE.md` §5.4.

---

## Category: Domain Extension and Feature Kinds

### R-DOMAIN-001: Catalog of Feature Kinds

**Question:** Should Ymir's FeatureKind enum be comprehensive and frozen, or open-ended (string) to allow future domains?

**Context:** A comprehensive enum is type-safe; an open string allows any consumer to invent new kinds without changing core schema.

**Options:**
- **Closed enum:** Predefined list; new kinds require schema version bump.
- **Open string with registry:** Any string allowed; optional registry documents known kinds.
- **Hybrid:** Core enum + "domain:" prefix pattern for extension (e.g., "garden:tomato_variety").

**Recommendation:** Closed enum for v1 (type safety); move to hybrid if extensibility becomes painful.

**Decision (LOCKED — OVERRIDE):** ✅ Hybrid — core enum + `domain:` prefix pattern, adopted immediately rather than deferred. Reason: waiting for extensibility to "become painful" means every new domain blocks on a core schema bump before it can model anything; with two consumer domains (garden, interior) already known and more anticipated, the hybrid escape hatch is adopted from v1 instead of retrofitted later. No separate formal registry is required — the `domain:` namespace convention is self-documenting; see `YMIR_SPATIAL_ARCHITECTURE.md` §3.3.1.

---

### R-DOMAIN-002: Metadata vs. Specialization for Domain Data

**Question:** Should garden domain data (e.g., biological_lifecycle) be part of the core PhysicalFeature or stored in feature.metadata?

**Context:** Core fields are type-safe and queryable; metadata is flexible but untyped.

**Options:**
- **Core field:** `feature.biological_lifecycle: "annual" | "perennial" | ...`
- **Metadata:** `feature.metadata.garden.biological_lifecycle`
- **Separate table:** Garden-specific table with foreign key to feature ID.

**Recommendation:** Core metadata object (`feature.metadata`) with structured subdocuments by domain. Garden domain uses `feature.metadata.garden.*`. Keeps schema clean while allowing strong typing in consumer apps.

**Decision (LOCKED):** ✅ Metadata — structured `feature.metadata.<domain>.*` subdocuments — matches recommendation.

---

### R-DOMAIN-003: Feature Kinds for Unmapped/Future Domains

**Question:** Should there be a catch-all kind like "UNKNOWN" or "GENERIC", or should every feature have a defined kind?

**Context:** Users might import data from external sources with unrecognized feature types. Allowing UNKNOWN prevents import errors.

**Options:**
- **Require defined kind:** Every feature must map to a known kind; reject unknowns.
- **Allow UNKNOWN:** Preserve unmapped features with `kind: "unknown"`.
- **Custom kind:** Allow any string for kind (overlaps R-DOMAIN-001).

**Recommendation:** Allow UNKNOWN kind; log as a warning during import, but preserve the feature.

**Decision (LOCKED):** ✅ Allow UNKNOWN, logged as an import warning — matches recommendation.

---

## Category: Constraints and Validation

### R-CONSTRAINT-001: Spatial Overlap Rules

**Question:** Should Ymir allow features with overlapping footprints, or should it reject them?

**Context:** Overlap is sometimes intentional (intensive interplanting in gardens, stacked shelves indoors). Other times it's an error (two buildings in the same location). Domain-specific rules differ.

**Options:**
- **Allow all overlaps:** Ymir records; consumer apps validate if needed.
- **Reject overlaps for certain kinds:** Structures (buildings) cannot overlap; features can.
- **Strict no-overlap:** All features must have distinct footprints.

**Recommendation:** Allow all overlaps. Ymir records; consumer apps implement domain-specific rules. Log overlaps as warnings in debug mode.

**Decision (LOCKED):** ✅ Allow all overlaps; Ymir records, consumer apps validate domain-specific rules — matches recommendation.

---

### R-CONSTRAINT-002: Feature Containment Cycles

**Question:** Should Ymir detect and reject circular containment (Feature A contains B, B contains A)?

**Context:** Circular containment is nonsensical and should be prevented. The algorithm is simple (graph cycle detection).

**Options:**
- **Detect and reject:** Write operation fails with clear error.
- **Allow and warn:** Record the cycle, log a warning.
- **No check:** Assume consumer app prevents it.

**Recommendation:** Detect and reject. This is a basic structural invariant.

**Decision (LOCKED):** ✅ Detect and reject — matches recommendation.

---

### R-CONSTRAINT-003: Position Validity (Feature Inside Container)

**Question:** Should Ymir enforce that every feature's position is within its parent area's geometry?

**Context:** Features outside their declared container is likely an error. But complex shapes (rooms with alcoves) might make exact validation tricky.

**Options:**
- **Strict containment:** Feature's bounding box must be within container's polygon.
- **Centroid containment:** Feature's center point must be within container.
- **Warning only:** Log if feature appears to be outside; don't fail the write.
- **Disable in v1:** Validation is complex; defer to consumer apps.

**Recommendation:** Centroid containment with optional strict mode. Log warnings if feature is at boundary or apparently outside.

**Decision (LOCKED):** ✅ Centroid containment with a warning by default, plus an optional strict mode — matches recommendation. Now reflected as the canonical rule in `YMIR_SPATIAL_ARCHITECTURE.md` §4.4; strict polygon/bounding-box containment is no longer in the engine's default "validates" list.

---

## Category: WGS84 and Geolocation

### R-GEO-006: WGS84 Anchor Requirement

**Question:** Should the WGS84 geolocation (longitude, latitude, altitude) be required or optional?

**Context:** Geolocation is useful for outdoor properties (sunrise/sunset, climate lookup) but not essential for the spatial model. Indoor-only properties don't need it.

**Options:**
- **Required:** Every property must have WGS84 anchor.
- **Optional:** Include if available, but not required.
- **Domain-specific:** Outdoor properties require it; indoor-only don't.

**Recommendation:** Optional. Outdoor properties should have it for sun calculations; indoor-only can skip. Document the benefit.

**Decision (LOCKED):** ✅ Optional — matches recommendation.

---

## Category: Multi-Property and User Management

### R-USER-001: Single-User vs. Multi-User in v1

**Question:** Should Ymir assume single-user (one property per person) or multi-user (multiple people sharing a property)?

**Context:** Single-user simplifies v1 significantly. Multi-user requires permissions, conflict resolution, and audit trails.

**Options:**
- **Single-user only:** Assume one person owns/manages the property.
- **Multi-property:** One person can own multiple properties (independent stores).
- **Multi-user:** Multiple people can edit the same property.

**Recommendation:** Multi-property single-user for v1. Multi-user as a v2+ feature.

**Decision (LOCKED):** ✅ Multi-property, single-user for v1 — matches recommendation.

---

### R-USER-002: Author Attribution in Change Log

**Question:** Should the change log include `author` (who made the change) for audit purposes?

**Context:** Useful for households where multiple people edit; useful for audits. Adds friction to single-user use if not automated.

**Options:**
- **Required:** Every change must have an author.
- **Optional:** Author field present but nullable.
- **Defer to v2:** v1 assumes single user; v2 adds multi-user with authors.

**Recommendation:** Optional field in v1; defer requirement to multi-user mode (v2).

**Decision (LOCKED):** ✅ Optional field in v1; becomes required under multi-user mode (v2) — matches recommendation.

---

## Category: Export and Interoperability

### R-EXPORT-001: Export Format Standardization

**Question:** Should the JSON export format be a fixed schema or allow variation?

**Context:** A fixed schema enables tool compatibility and easier migrations. Variation is flexible but hard to parse.

**Options:**
- **Fixed schema:** Strict YmirPropertyExport format; any variation is invalid.
- **Flexible:** Allow extra fields; ignore unknown fields on import.
- **Multiple formats:** Support JSON, GeoJSON, and possibly others.

**Recommendation:** Fixed schema for v1; validate strictly on import. GeoJSON compatibility (e.g., areas as GeoJSON features) is a nice-to-have for future.

**Decision (LOCKED):** ✅ Fixed schema for v1, validated strictly on import; GeoJSON compatibility remains a future nice-to-have — matches recommendation.

---

### R-EXPORT-002: Import Conflict Resolution

**Question:** If importing a property with the same ID as an existing property, what happens?

**Context:** User might accidentally import twice, or have a backup they're restoring. Clear conflict resolution is important.

**Options:**
- **Reject:** Refuse the import; return error.
- **Merge:** Combine the two property models (complex).
- **Replace:** Overwrite existing with import.
- **Ask user:** Prompt for action.

**Recommendation:** Reject with clear message and offer to rename the imported property. User then decides.

**Decision (LOCKED):** ✅ Reject with a clear message, offering to rename the imported property — matches recommendation.

---

## Category: Future Extensibility and Visualization

### R-FUTURE-001: 3D Representation and Z-Index

**Question:** Should the schema include a Z-order or visual layer concept for rendering?

**Context:** Visualization layer (2D map, 3D view) needs to know draw order (which feature is in front?). Ymir stores geometry, not rendering.

**Options:**
- **Ignore:** Consumers compute Z-order based on coordinates and kind.
- **Optional z_order field:** Allow explicit visual ordering.
- **Vertical envelope only:** Use height ranges to infer order.

**Recommendation:** Ignore in core schema; consumers compute based on vertical_envelope and kind. For interior (stacked shelves), parent-child containment implies order.

**Decision (LOCKED):** ✅ Ignore in core schema; consumers compute z-order from vertical_envelope, kind, and containment — matches recommendation.

---

### R-FUTURE-002: Photo/Media Asset References

**Question:** How should features link to photos or media assets?

**Context:** User might take a photo of the garden and want to associate it with a feature. The schema should accommodate this without storing the photo itself.

**Options:**
- **URL only:** Store external URL (Google Drive, Figma, etc.).
- **Local path:** Reference a file relative to the export directory.
- **Asset manifest:** Separate file mapping media keys to paths.
- **Defer to v2:** v1 doesn't support media references.

**Recommendation:** Optional media_references array with kind/url pairs. Deferred to v2 for full implementation (photo capture tools, asset management).

**Decision (LOCKED — AMENDED):** ✅ Optional `media_references` array, with reference `kind` extended beyond the original recommendation to three values: `url`, `local_path`, and `brisingamen_asset_id`. Amendment reason: Brísingamen (the estate's asset system) is an existing source of media/asset identity; requiring a URL/path detour for assets that already have a Brísingamen ID would be unnecessary indirection. Full media management tooling (capture, asset lifecycle) remains deferred to v2 — only the reference shape is fixed now. See `YMIR_SPATIAL_ARCHITECTURE.md` §10.2.

---

## Category: Implementation and Tooling

### R-IMPL-001: Geometry Library Choice

**Question:** Which library should be used for polygon operations (overlap, containment, simplification)?

**Context:** Core Ymir logic will need geometry operations. Choices include GEOS (C++, JNI), Turf.js (JS), or similar.

**Options:**
- **Turf.js:** Pure JavaScript, easy to bundle, smaller feature set.
- **GEOS via binding:** More mature, but adds C++ dependency.
- **Custom lightweight:** Implement minimal geometry (centroid, bounding box).

**Recommendation:** Turf.js for TypeScript/JavaScript implementations. Document dependency clearly.

**Decision (LOCKED):** ✅ Turf.js — matches recommendation.

---

### R-IMPL-002: Backward Compatibility During Schema Evolution

**Question:** How should the library handle v1 data when the schema evolves to v2 or later?

**Context:** Properties created in v1 should still be readable (and ideally writable) in v2.

**Options:**
- **Strict versioning:** v2 cannot read v1 data; requires migration.
- **Upgrade on load:** Automatically migrate v1 to v2 on read.
- **Compatibility layer:** Keep v1 parsers; transparently convert.

**Recommendation:** Upgrade on load for minor versions; require explicit migration for major versions. Document migration path.

**Decision (LOCKED):** ✅ Upgrade-on-load for minor versions; explicit migration required for major versions — matches recommendation.

---

## Summary of Critical Decisions (Resolved)

These were flagged as most critical for the implementation roadmap; all are now locked:

1. **R-STORE-001:** SQLite.
2. **R-API-001:** Library for v1; service optional in v2.
3. **R-GEO-001:** Centimeter precision.
4. **R-CONSTRAINT-002:** Detect and reject circular containment.
5. **R-DOMAIN-001:** Hybrid FeatureKind (core enum + `domain:` prefix) — **override**, adopted immediately rather than deferred.
6. **R-EXPORT-002:** Reject on ID conflict, offer rename.
7. **R-IMPL-001:** Turf.js.

---

## Next Steps

1. ~~Stakeholder review~~ — complete; all 26 rulings decided and locked as of 2026-07-04.
2. ~~Finalize rulings~~ — complete; see decisions and overrides above.
3. **Produce implementation spec:** Translate locked rulings into detailed coding guidelines.
4. **Begin Ymir Core library:** Start with storage (SQLite) and core types, including the `spatial_changes` log as the positional-versioning authority (§5.4).
5. **Garden app migration:** Adapt existing garden app to use Ymir as spatial backend, per the migration path in `YMIR_SPATIAL_ARCHITECTURE.md` §9.

---

**Document Status:** LOCKED — v1.1. All rulings decided; this document is now a decision record, not an open question list. Future rulings (as new questions arise during implementation) should be appended as new entries rather than reopening the above.

**Last Updated:** 2026-07-04
