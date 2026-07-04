# Ymir — Rulings Addendum (v0.1 Implementation)

**Status:** Provisional — recorded during the Ymir Core v0.1 build (2026-07-04) · Review alongside the next canon revision

The locked canon (`YMIR_SPATIAL_ARCHITECTURE.md` v1.1) and rulings (`RULINGS_NEEDED.md`) decided everything the design session surfaced. Implementation surfaced the gaps below. Per build discipline, each got a provisional choice and the build continued; none reverses a locked ruling. Each entry needs a confirm-or-overturn ruling.

---

### A-001: Geometry column representation in SQLite

**Gap:** Canon §7.3's example SQL uses a `GEOMETRY` column type, which SQLite does not natively have (it's illustrative of SpatiaLite-style storage).

**Provisional choice:** Geometry (polygons) stored as JSON text columns. Spatial predicates run in the library layer via Turf.js (R-IMPL-001), not in SQL. At property scale (tens to low thousands of features) this is well within performance bounds and avoids a SpatiaLite native-extension dependency.

**Revisit if:** query patterns emerge that need SQL-level spatial indexing (e.g., viewport queries over very large properties).

---

### A-002: Record-time vs. effective-time on writes

**Gap:** Canon §5.3/§5.4 has a single `timestamp` on `SpatialChange` and defines replay over it, but doesn't address backdated entry — a user recording in July that a bed was moved in May.

**Provisional choice:** One timestamp field, writer-suppliable: every write accepts `WriteOptions.at` (effective time), defaulting to now. Replay orders by `(timestamp, seq)` where `seq` is a monotonic insertion counter, so backdated writes replay at their effective time and same-instant writes replay in insertion order deterministically.

**Consequence:** the log records when things *happened*, not when they were *entered*. A separate entered-at audit dimension is out of scope for v0.1.

---

### A-003: Temporal envelope boundary semantics

**Gap:** Canon §5.1 doesn't state whether `to` is inclusive. The kitchen example (`to: 2022-06-30`, successor `from: 2022-07-01`) queries away from the boundary dates.

**Provisional choice:** `[from, to]` inclusive at instant granularity: a feature is active at date D iff `from ≤ D ≤ to`. Combined with R-TIME-001 normalization (date-only → start of day, so `2022-06-30` = `2022-06-30T00:00:00.000Z`), a feature removed "on" a date is active at that date's first instant and not after. The canon example reconstructs correctly.

---

### A-004: Replay payload — full entity in `details.entity`

**Gap:** Canon §5.4 makes before/after spatial snapshots canonical, but replay must also reconstruct non-spatial attributes (name, kind, tags, metadata) to return full `PhysicalFeature` objects from `property_at()`.

**Provisional choice:** Every mutating event also carries the full post-change entity in `details.entity` (canon's `details: Record<string, unknown>` accommodates this). Replay applies entities; before/after remain the canonical spatial diffs for audit and consumer diffing. The log stays the single authority — this enriches the log rather than adding a second source.

---

### A-005: Force-bypassable vs. unconditional validations

**Gap:** R-API-003 locks "strict default, force override, logged" but doesn't enumerate which validations `force` can bypass.

**Provisional choice:** `force` bypasses only the strict-mode centroid-containment rejection (the one canon §4.4 defines as warning-by-default). Hard structural invariants — circular containment (R-CONSTRAINT-002 "basic structural invariant"), temporal inconsistency, duplicate IDs, unclosed rings, unknown references — always reject; force cannot bypass them. Overrides surface as a `forced_override` warning and are recorded in the change's details.

---

### A-006: GardenOS wire format

**Gap:** `docs/reference/spatial-model.md` specifies the GardenOS *model*, not a serialization format for export.

**Provisional choice:** The adapter defines a faithful wire shape (`GardenOSExport`: property + areas + features with `parentFeatureId`, `sourceRef`, `plantingSpaceId`). When the real GardenOS export lands for migration, only the adapter's input-shape layer should need adjustment; the mapping rules (IDs carry forward, PlantingSpace stays domain-side, kinds map with unknown-fallback) are canon-derived and stable.

---

### A-007: Canon §8.1 omits area-creation and non-move mutation methods

**Gap:** The §8.1 API listing has `addFeature`/`moveFeature`/`removeFeature` but no way to create areas, and §5.3's event kinds (`feature_resized`, `feature_regeometried`, `feature_recontained`) imply mutations §8.1 doesn't list.

**Provisional choice:** Added `addArea`, `modifyAreaGeometry`, `resizeFeature`, `setFeatureGeometry`, `recontainFeature`, `setFeatureStatus` — the minimal set that makes every canonical event kind producible through the single-write-source API (§6.3). No other surface added.

---

### A-008: Parent-feature containment frame ignores heading rotation

**Gap:** Checking a child feature's centroid against its parent *feature's* footprint requires placing the parent footprint in the property frame. Canon defines nested-frame composition (§2.1) but v0.1's containment check is warning-level only.

**Provisional choice:** Parent footprints are placed by translation only (heading rotation ignored) for the centroid *warning* check. Full transform composition is deferred until a consumer needs rotated-parent containment fidelity. This affects warnings only — never data.

---

### A-009: Precision applied by rounding at the write boundary

**Gap:** R-GEO-001 locks centimeter storage precision but doesn't say whether out-of-precision input is rejected or rounded.

**Provisional choice:** Rounded (half away from zero) at the write boundary: positions, polygon vertices, and dimensions round to 0.01 m; headings normalize to [0, 360). Inputs are never rejected for excess precision.

---

### A-010: `unknown` kind warning scope

**Gap:** R-DOMAIN-003 locks "allow UNKNOWN; log as a warning during import." Direct API writes with `kind: "unknown"` are not covered.

**Provisional choice:** Warning emitted on import paths only, exactly as the ruling states; direct `addFeature` with `"unknown"` is accepted silently (it is a core enum member). Consumers wanting stricter hygiene can check kinds themselves.
