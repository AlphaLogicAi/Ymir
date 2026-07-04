# Ymir — Spatial Engine Architecture and Schema

**Version:** 1.0 · **Status:** Canon · **Session:** Deep architecture design · **Date:** 2026-07-04

---

## Executive Summary

Ymir is the single source of spatial truth for a user's property: land, structures, rooms, and all physical features exist in one continuous model. A property is modeled as nested spatial containers and features, with unified coordinates, versioning, and domain-agnostic core — extended by garden, interior, and future domains.

The core ontology is **Property** (root) → **SpatialArea** (zones: outdoor, indoor, transitional) → **PhysicalFeature** (any physical thing). A **Structure** (special feature) can contain **Spaces** (indoor spatial areas). **Time** is first-class: all spatial facts have validity intervals; the system can reconstruct "the property on 2024-05-15."

Ymir owns spatial truth; consumer apps (garden, interior, maintenance) own domain operations and history. Neither app can fork the spatial model.

---

## 1. Core Ontology

### 1.1 The Type Hierarchy

```
Property (root container, immutable ID)
├── SpatialArea (zones: outdoor yard, room, patio, etc.)
│   ├── geometry (boundary polygon)
│   ├── area (derived)
│   ├── purpose (garden_zone, living_space, transitional, storage, etc.)
│   ├── parentStructure (optional, if indoors)
│   └── features (PhysicalFeature[])
│
├── PhysicalFeature (any physical thing)
│   ├── geometry (footprint)
│   ├── position (placement in property frame)
│   ├── dimensions (W × D × H)
│   ├── kind (tree, shrub, bed, furniture, appliance, fixture, etc.)
│   ├── status (active, removed, dormant)
│   ├── temporal_envelope (from, to)
│   └── specializations:
│       ├── Structure (building, greenhouse, shed)
│       │   ├── spaces (SpatialArea[]) — rooms, levels
│       │   ├── footprint, floorplan
│       │   └── levels
│       ├── PlantingSpace (extends PhysicalFeature, garden domain)
│       │   └── occupancies (Occupancy[])
│       └── Furnishing (extends PhysicalFeature, interior domain)
│           └── fixture details (mounting, anchoring)
│
└── Domain state (owned by consumer apps, not Ymir)
    ├── Garden domain: Planting, Season, PlantingEvent, Outcome
    └── Interior domain: Asset, Maintenance, Renovation
```

### 1.2 Design Principles

**Principle: Ontological Parity**  
A raised garden bed and a bookshelf are both PhysicalFeatures. Both occupy space, have position/dimensions/history, and relate to their containers identically. Domain differences (one grows plants, one holds books) are not spatial concerns.

**Principle: Inheritance Over Composition**  
PlantingSpace and Furnishing extend PhysicalFeature, inheriting spatial semantics. Domain-specific behavior (planting cycles, maintenance records) lives in consumer apps, never in the core spatial model.

**Principle: Conservative Core**  
Ymir is minimal and schema-stable. Its core types should change rarely. Domains extend without mutation: a future "irrigation system" domain doesn't change the Feature model; it adds IrrigationComponent features and links.

**Principle: Immutable Identity**  
Every spatial object (Property, SpatialArea, PhysicalFeature) has a stable, immutable ID. Coordinates, dimensions, and containment change; identity does not. Aliases/imports are for idempotent upserts only, never canonical identity.

---

## 2. Spatial Coordinate System

### 2.1 Canonical Coordinate Convention: `gardenos-local-si-v1`

Inherited from GardenOS, generalized for indoor and outdoor spaces:

- **Units:** meters (length), square meters (area), cubic meters (volume)
- **Axes:** +X east, +Y north, +Z up (Earth-relative for outdoor; preserves sanity for structures)
- **Heading:** degrees clockwise from north: 0° north, 90° east, 180° south, 270° west
- **Polygon closure:** rings are closed (final point repeats first)
- **WGS84 anchor:** optional longitude/latitude/altitude to geo-locate the property frame

**Note on Indoor Spaces:**  
Rooms and interiors use the same convention. A room's position is defined within its structure's frame; the structure's position is in the property frame. Nested coordinates compose linearly.

### 2.2 Geometric Fidelity

Three layers of geometric precision, each with purpose:

| Layer | Fidelity | Use Case | Precision |
|-------|----------|----------|-----------|
| **Placement** | Position + heading | "Where is this feature?" | meters + degrees |
| **Footprint** | 2D boundary polygon | "What space does it occupy?" | 0.1–0.5 m (sub-meter) |
| **Vertical Envelope** | Height, root depth, layers | "Does this overlap that?" | specified per feature |

**Example: Raised Garden Bed**
- Position: X=10.5, Y=5.2, heading=0°
- Footprint: polygon defining the bed outline
- Vertical envelope: height=0.3 m, root_zone=−0.3 m (underground), canopy=0.5 m (above)

**Example: Room**
- Position: within structure frame
- Footprint: room outline (walls define boundary)
- Vertical envelope: floor_elevation, ceiling_height

### 2.3 Vertical Stratification

Spaces are often layered vertically, especially outdoors (groundcover, understory, canopy, trellis) and indoors (furniture on floors, wall-mounted, shelves). Rather than imposing fixed layers, Ymir stores named vertical envelopes per feature:

```typescript
vertical_envelope: {
  ground_level: 0,     // baseline (soil surface, floor)
  root_zone: -0.5,     // below ground (roots)
  canopy: 1.5,         // above ground (plant/feature height)
  clearance_above: 0,  // space to ceiling/overhead
  layers?: [           // optional: named layers for complex features
    { name: "understory", from: 0, to: 0.8 },
    { name: "canopy", from: 0.8, to: 2.0 }
  ]
}
```

---

## 3. Core Types: Detailed Schema

### 3.1 Property

```typescript
interface Property {
  id: string;                    // immutable UUID or similar
  name: string;                  // "Oak Grove Farm" or "42 Main St"
  description?: string;
  
  // Spatial extent
  boundary: Polygon;             // property boundary
  boundary_area: number;         // m² (derived)
  bounding_box: BoundingBox;     // (derived)
  
  // Coordinate frame
  coordinate_convention: "gardenos-local-si-v1";
  wgs84_origin?: {
    longitude: number;
    latitude: number;
    altitude_m?: number;
  };
  
  // Temporal
  created_at: ISO8601;
  updated_at: ISO8601;
  
  // References
  areas: SpatialArea[];
  features: PhysicalFeature[];
  
  // Consumer links (optional, for app-specific data)
  garden_context?: { garden_app_property_id: string };
  interior_context?: { interior_app_property_id: string };
}
```

### 3.2 SpatialArea

A bounded zone within a property. Can be outdoor (yard, garden section, patio) or indoor (room, closet, basement).

```typescript
interface SpatialArea {
  id: string;                    // immutable UUID
  property_id: string;
  name: string;                  // "Front Yard" or "Kitchen"
  kind: AreaKind;                // see enum below
  purpose: AreaPurpose;          // "garden_zone" | "living_space" | ...
  
  // Spatial
  geometry: Polygon;             // boundary of the area
  area_m2: number;               // derived from geometry
  elevation?: number;            // outdoor: ground level or reference height
  
  // Containment
  parent_structure_id?: string;  // if indoors within a structure
  features: PhysicalFeature[];
  
  // Temporal
  temporal_envelope: TemporalEnvelope;
  
  // Metadata
  orientation?: {                // outdoor areas
    primary_sun_exposure?: "N" | "NE" | "E" | ... // 16 cardinal/intercardinal
    slope?: number;              // degrees from horizontal
    drainage?: "poor" | "moderate" | "good";
  };
}

enum AreaKind {
  OUTDOOR_YARD = "outdoor_yard",
  OUTDOOR_GARDEN = "outdoor_garden",
  OUTDOOR_PATIO = "outdoor_patio",
  OUTDOOR_DRIVEWAY = "outdoor_driveway",
  OUTDOOR_PATH = "outdoor_path",
  INDOOR_ROOM = "indoor_room",
  INDOOR_CLOSET = "indoor_closet",
  INDOOR_HALLWAY = "indoor_hallway",
  INDOOR_BASEMENT = "indoor_basement",
  INDOOR_ATTIC = "indoor_attic",
  INDOOR_GARAGE = "indoor_garage",
  TRANSITIONAL_PORCH = "transitional_porch",
  TRANSITIONAL_DECK = "transitional_deck",
  TRANSITIONAL_ENTRYWAY = "transitional_entryway",
  COVERED_STRUCTURE = "covered_structure", // greenhouse, shed
}

enum AreaPurpose {
  GARDEN_ZONE = "garden_zone",
  LIVING_SPACE = "living_space",
  STORAGE = "storage",
  CULTIVATION = "cultivation",
  WORK_AREA = "work_area",
  CIRCULATION = "circulation",
}
```

### 3.3 PhysicalFeature

The universal type for anything occupying space: plants, furniture, structures, fixtures, containers, etc.

```typescript
interface PhysicalFeature {
  id: string;                    // immutable UUID
  property_id: string;
  
  // Identity & kind
  name: string;                  // "Apple Tree" or "Kitchen Island"
  kind: FeatureKind;             // see enum below
  status: FeatureStatus;         // "active" | "removed" | "dormant" | "planned"
  
  // Spatial geometry
  geometry: Polygon;             // footprint in feature-local frame
  position: Transform;           // placement in property frame (X, Y, heading)
  dimensions: {
    width_m: number;
    depth_m: number;
    height_m: number;
  };
  
  vertical_envelope: {           // for collision/overlap detection
    root_zone_m?: number;        // depth below ground (negative)
    canopy_top_m: number;        // height above ground
    clearance_above_m?: number;  // space to obstruction above
  };
  
  // Containment
  parent_feature_id?: string;    // if contained in another feature
  parent_area_id?: string;       // spatial area the feature occupies
  contained_features?: string[]; // IDs of features inside this one
  
  // Temporal
  temporal_envelope: TemporalEnvelope;
  
  // Sourcing & identity
  source_ref?: string;           // import alias; never canonical identity
  tags?: string[];               // user labels
  
  // Metadata (optional, kind-dependent)
  metadata?: Record<string, unknown>;
}

enum FeatureKind {
  // Outdoor botanical
  TREE = "tree",
  SHRUB = "shrub",
  HERBACEOUS_PERENNIAL = "herbaceous_perennial",
  ANNUAL = "annual",
  GROUNDCOVER = "groundcover",
  VINE = "vine",
  
  // Outdoor cultivation
  PLANTING_BED = "planting_bed",
  RAISED_BED = "raised_bed",
  CONTAINER = "container",
  TRELLIS = "trellis",
  PATHWAY = "pathway",
  
  // Structures
  BUILDING = "building",         // primary dwelling (contains spaces)
  GREENHOUSE = "greenhouse",     // contains spaces
  SHED = "shed",
  GARAGE = "garage",
  DECK = "deck",
  FENCE = "fence",
  WALL = "wall",
  
  // Indoor
  FURNITURE = "furniture",
  APPLIANCE = "appliance",
  FIXTURE = "fixture",           // wall-mounted, built-in
  WINDOW = "window",
  DOOR = "door",
  SHELF = "shelf",
  
  // Misc
  WATER_FEATURE = "water_feature",
  HARDSCAPE = "hardscape",       // paving, mulch, etc.
  UNKNOWN = "unknown",
}

enum FeatureStatus {
  ACTIVE = "active",
  PLANNED = "planned",           // not yet built/planted
  DORMANT = "dormant",           // winter dormancy, empty containers
  REMOVED = "removed",           // historical record preserved
}

interface Transform {
  x: number;                     // meters
  y: number;                     // meters
  heading?: number;              // degrees from north, clockwise
}

interface TemporalEnvelope {
  from: ISO8601;                 // when did this exist
  to?: ISO8601;                  // removed/replaced on this date
  note?: string;                 // reason for removal, renovation note
}
```

### 3.4 Structure (Specialization)

A special PhysicalFeature that contains indoor spaces. Represents buildings, greenhouses, sheds — anything with interior volume that can be divided into rooms.

```typescript
interface Structure extends PhysicalFeature {
  kind: "building" | "greenhouse" | "shed" | "garage";
  
  // Indoor organization
  spaces: SpatialArea[];         // rooms, closets, hallways, etc.
  levels: {
    floor_number: number;        // 0=ground, 1=first story, -1=basement
    elevation_m: number;         // absolute elevation of this floor
    spaces: SpatialArea[];
  }[];
  
  // Structural
  footprint_m2: number;          // total ground-floor area
  total_enclosed_volume_m3?: number;
  
  // Metadata
  construction_year?: number;
  materials?: string[];          // "wood frame" | "brick" | etc.
  insulation?: string;           // "R-value" or qualitative
}
```

### 3.5 Domain Extensions: Garden

The garden domain extends Ymir's core with biological and cultivation records. Garden data lives outside Ymir (in the garden app), but references spatial features.

```typescript
// Core Ymir: a raised bed is a PhysicalFeature of kind "raised_bed"
interface RaisedBedInYmir {
  id: "feat_12345";
  kind: "raised_bed";
  position: { x: 10, y: 15 };
  dimensions: { width_m: 1.5, depth_m: 3, height_m: 0.3 };
  vertical_envelope: { canopy_top_m: 0.5 };
}

// Garden domain: what grows in it (owned by garden app)
interface PlantingSpace {
  // NOT in Ymir—lives in garden app's database
  id: string;
  ymir_feature_id: "feat_12345";  // reference to the raised bed
  property_id: string;
  name: string;
  
  occupancies: Occupancy[];       // who/what is in this space, when
}

interface Occupancy {
  id: string;
  planting_id: string;
  from_date: ISO8601;
  to_date?: ISO8601;
  
  geometry: Polygon;              // footprint within the planting space
  vertical_envelope: {
    root_zone_m: number;
    canopy_top_m: number;
  };
  quantity: number;
  spacing?: { inrow_m: number; row_m: number };
}

interface Planting {
  id: string;
  property_id: string;
  
  // Botanical identity
  genus_species?: string;
  common_name: string;
  biological_lifecycle: "annual" | "biennial" | "perennial" | "woody_perennial";
  
  // Temporal
  sourced_from?: string;          // seed supplier, nursery, etc.
  established_season: Season;
  removed_season?: Season;
  
  // Cultivation
  cultivation_strategy: "single_season" | "overwintered" | "multi_season";
  overwintering?: Overwintering;
}

interface Season {
  id: string;
  property_id: string;
  year: number;
  name: string;                   // "Spring 2024" or "Q2 2024"
  from_date: ISO8601;
  to_date: ISO8601;
}

// Etc. (Outcome, PlantingEvent, Overwintering as in GardenOS)
```

---

## 4. Relationships and Constraints

### 4.1 Containment Hierarchy

Ymir enforces a consistent containment model:

```
Property
  └─ SpatialArea (outdoor yard)
      └─ PhysicalFeature (tree)
  └─ SpatialArea (indoor room within structure)
  └─ PhysicalFeature (Structure = building)
      └─ SpatialArea (kitchen)
          └─ PhysicalFeature (appliance)
          └─ PhysicalFeature (furniture)
```

**Rule: Strict Containment**
- Every SpatialArea belongs to exactly one Property.
- Every SpatialArea can belong to a parent Structure (for indoor areas).
- Every PhysicalFeature belongs to exactly one Property and optionally one SpatialArea or parent Feature.
- Circular containment is forbidden (Feature A cannot contain Feature B if B contains A).

### 4.2 Spatial Adjacency and Adjacency Relationships

Two SpatialAreas can be adjacent (share a boundary or opening). This is valuable for indoor layout (rooms share walls, doors connect them) and outdoor design (patio borders garden).

```typescript
interface SpatialAdjacency {
  id: string;
  area1_id: string;
  area2_id: string;
  relationship: "shares_wall" | "shares_opening" | "borders";
  opening?: {
    kind: "door" | "window" | "gate" | "passage";
    opening_width_m: number;
    opening_height_m?: number;
  };
  notes?: string;
}
```

### 4.3 Orientation and Exposure

Sun exposure (outdoor) and daylighting (indoor) are properties of features and areas.

```typescript
interface Exposure {
  // Outdoor
  primary_sun: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" | "full_sun" | "partial_shade" | "full_shade";
  seasonal_variation?: string;   // "southern exposure, full summer sun"
  
  // Indoor
  window_count?: number;
  daylighting?: "abundant" | "moderate" | "poor";
  artificial_only?: boolean;
}
```

### 4.4 Validation Rules (Engine vs. Record)

**Ymir validates these constraints:**
- Every object is within its parent's geometry (no feature outside its containing area).
- Temporal envelopes are logically consistent (no "to" before "from").
- Circular containment is forbidden.
- IDs are unique within property scope.
- Required fields are present.

**Ymir records but does not validate:**
- Overlap of features (intentional in some garden layouts, forbidden in others).
- Structural load-bearing and safety (engineer's problem).
- Maintenance, care, or lifecycle rules (domain app's problem).

---

## 5. Temporal Modeling and Versioning

### 5.1 Temporal Envelope

Every spatial object has a validity interval: `from` and `to`. This enables reconstructing "the property on date X."

```typescript
interface TemporalEnvelope {
  from: ISO8601;                 // when was this feature added/built?
  to?: ISO8601;                  // when was it removed/demolished?
  note?: string;                 // renovation, replaced, etc.
}
```

**Example: Kitchen Renovation**
- Old kitchen: `{ from: "2010-03-15", to: "2022-06-30", note: "renovated" }`
- New kitchen: `{ from: "2022-07-01", to: null }`

### 5.2 Property State Query

The engine provides a query API:

```typescript
// Reconstruct property as-of date
property_at(property_id: string, as_of_date: ISO8601): Property

// All features active on this date
features_active_at(property_id: string, date: ISO8601): PhysicalFeature[]

// Feature history
feature_history(feature_id: string): { version, changes, temporal_envelope }[]
```

### 5.3 Change Events (for consumers)

When Ymir changes, consumer apps need to know. A simple event stream:

```typescript
interface SpatialChange {
  id: string;
  timestamp: ISO8601;
  event_kind: "feature_added" | "feature_moved" | "feature_removed" | "area_modified" | ...;
  property_id: string;
  affected_ids: string[];        // which features/areas changed
  author?: string;               // user or import source
  details: Record<string, unknown>;
}
```

---

## 6. Engine/Consumer Boundary

### 6.1 What Ymir Owns (Canonical Source of Spatial Truth)

- Property extent and coordinate frame
- SpatialArea geometry and containment hierarchy
- PhysicalFeature spatial properties: position, dimensions, footprint, vertical envelope
- Feature temporal lifecycle (when added/removed)
- Coordinate system and transformation rules
- Versioning and historical state reconstruction

### 6.2 What Consumer Apps Own (Never Fork)

**Garden App**
- Planting records (species, sources, lifecycle)
- Occupancy and succession (what grows where, when)
- Outcomes and yields (per-season results, pest/disease notes)
- Events (sowing, germination, transplanting, harvest)
- Seasons and garden calendars (spring/summer/fall/winter designations)

→ Garden app reads Ymir for: "Where is the raised bed? What are its dimensions?"  
→ Garden app asks Ymir to: "Move raised bed from (10, 5) to (12, 8)" via a spatial update.

**Interior App**
- Room aesthetics and design (color, finishes, mood)
- Furniture/fixture specifications (brand, model, purchase history)
- Asset tracking and inventory
- Maintenance records (repair, servicing, upgrades)
- Renovation projects and timelines

→ Interior app reads Ymir for: "What rooms exist? What are their dimensions and adjacencies?"  
→ Interior app asks Ymir to: "Add a wall-mounted shelf at X/Y/Z" via feature creation.

### 6.3 Preventing Forks

**Single Write Source:**
- Only Ymir API allows spatial writes; apps do not mutate their own spatial data.
- Apps issue requests: "move this feature" or "add this feature here."
- Ymir validates, records, and notifies all consumers of the change.

**Immutable Property Records:**
- Apps can cache Ymir data locally for offline access.
- Cache invalidation is triggered by change events.
- Apps must not assume their cached copy is authoritative.

---

## 7. Storage and Persistence

### 7.1 Local-First Architecture

Ymir can live in:
- **Embedded:** SQLite or similar, bundled in each consumer app, synced via cloud/drive.
- **Server:** Optional backend for multi-device/household sync (not required for v1).
- **Export/Import:** Full property models as JSON for backup and transfer.

### 7.2 Core Data Format (JSON Schema)

```typescript
interface YmirPropertyExport {
  version: "1.0";
  property: Property;
  areas: SpatialArea[];
  features: PhysicalFeature[];
  metadata: {
    created_at: ISO8601;
    exported_at: ISO8601;
    app_version?: string;
  };
}
```

### 7.3 Database Schema (SQLite Example)

```sql
-- Property
CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  boundary GEOMETRY NOT NULL,
  boundary_area REAL,
  coordinate_convention TEXT DEFAULT 'gardenos-local-si-v1',
  wgs84_longitude REAL,
  wgs84_latitude REAL,
  wgs84_altitude_m REAL,
  created_at DATETIME,
  updated_at DATETIME
);

-- SpatialArea
CREATE TABLE spatial_areas (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  purpose TEXT,
  geometry GEOMETRY NOT NULL,
  area_m2 REAL,
  parent_structure_id TEXT REFERENCES physical_features(id),
  elevation REAL,
  from_date DATETIME NOT NULL,
  to_date DATETIME,
  created_at DATETIME,
  updated_at DATETIME
);

-- PhysicalFeature
CREATE TABLE physical_features (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT,
  geometry GEOMETRY,
  position_x REAL,
  position_y REAL,
  position_heading REAL,
  dimensions_width REAL,
  dimensions_depth REAL,
  dimensions_height REAL,
  vertical_root_zone REAL,
  vertical_canopy_top REAL,
  parent_feature_id TEXT REFERENCES physical_features(id),
  parent_area_id TEXT REFERENCES spatial_areas(id),
  from_date DATETIME NOT NULL,
  to_date DATETIME,
  source_ref TEXT,
  metadata JSON,
  created_at DATETIME,
  updated_at DATETIME
);

-- Adjacency
CREATE TABLE spatial_adjacencies (
  id TEXT PRIMARY KEY,
  area1_id TEXT REFERENCES spatial_areas(id),
  area2_id TEXT REFERENCES spatial_areas(id),
  relationship TEXT,
  opening_kind TEXT,
  opening_width REAL,
  opening_height REAL
);

-- Change Log
CREATE TABLE spatial_changes (
  id TEXT PRIMARY KEY,
  property_id TEXT REFERENCES properties(id),
  timestamp DATETIME NOT NULL,
  event_kind TEXT NOT NULL,
  affected_ids TEXT,  -- JSON array
  author TEXT,
  details JSON
);
```

### 7.4 Multi-Property Support

A user can own or manage multiple properties. Ymir supports:

```typescript
interface PropertySet {
  user_id: string;
  properties: Property[];
}
```

Storage groups properties by user (local filesystem or cloud).

---

## 8. API and Consumer Integration

### 8.1 Library-Style API (TypeScript Example)

```typescript
// Core queries
export class YmirEngine {
  // Property queries
  getProperty(id: string): Property
  listProperties(): Property[]
  createProperty(spec: PropertySpec): Property
  updateProperty(id: string, updates: PropertyUpdate): Property
  
  // Spatial queries
  getAreas(property_id: string): SpatialArea[]
  getFeatures(property_id: string, filter?: FeatureFilter): PhysicalFeature[]
  getFeature(id: string): PhysicalFeature
  
  // Spatial writes (validated and logged)
  addFeature(property_id: string, spec: FeatureSpec): PhysicalFeature
  moveFeature(feature_id: string, new_position: Transform): void
  removeFeature(feature_id: string, reason: string): void
  
  // Temporal
  propertyAsOf(property_id: string, date: ISO8601): Property
  featuresActiveAt(property_id: string, date: ISO8601): PhysicalFeature[]
  featureHistory(feature_id: string): FeatureVersion[]
  
  // Adjacency
  getAdjacentAreas(area_id: string): SpatialArea[]
  addAdjacency(area1: string, area2: string, spec: AdjacencySpec): void
  
  // Change stream
  subscribe(property_id: string, listener: (change: SpatialChange) => void): Unsubscribe
  
  // Import/Export
  importProperty(json: YmirPropertyExport): Property
  exportProperty(property_id: string): YmirPropertyExport
}
```

### 8.2 Service-Style API (REST, GraphQL)

Alternatively, Ymir can run as a service (optional for future versions).

---

## 9. Migration Path from GardenOS

The existing garden app has a working spatial model and real user data. Migration strategy:

### 9.1 Import GardenOS Property

```
GardenOS Property → Ymir Property
  mapping: ID, name, boundary, WGS84 anchor, areas
  
GardenOS SpatialArea → Ymir SpatialArea
  mapping: ID, name, geometry, purpose
  
GardenOS PhysicalFeature → Ymir PhysicalFeature
  mapping: ID, name, kind, position, geometry, dimensions
  
GardenOS PlantingSpace → stays in Garden App
  mapping: references feature ID in Ymir, not duplicated
```

### 9.2 Data Loss Audit

- GardenOS `PlantingSpace` and garden lifecycle data: stays in garden app, references Ymir features.
- GardenOS coordinate system, IDs, temporal fields: all forward-compatible.
- No data loss; garden app is augmented with Ymir references, not replaced.

### 9.3 One-Way Initial Import, Then Live Sync

1. **Initial bulk import:** Migrate existing gardens and features to Ymir format.
2. **Dual write during transition:** Both systems log spatial changes until garden app is retired.
3. **Cutover:** Garden app sources spatial truth from Ymir; its own database shrinks to just planting records.

---

## 10. Design for Later (Accommodations Without Full Design)

### 10.1 Visualization Layers

Ymir stores geometry; rendering is a consumer concern. Accommodations:
- Geometry is polygon-based, suitable for 2D plan rendering.
- Vertical envelope and layer data support 3D interpretation.
- Apps provide visualization context (z-order, visual style, labels).

### 10.2 Photo/Scan-Assisted Capture

Future: Users capture photos or point-cloud scans. Ymir will:
- Store references to media assets (not the media itself).
- Allow features to be linked to photos.
- Does not process or interpret images (that's a consumer tool).

### 10.3 Maintenance System Deep Integration

Interior app will attach maintenance records to Ymir features:
- Reference: `maintenance_records[].feature_id`
- Ymir stores the relationship, not the record.
- Maintenance records live in the interior app.

### 10.4 Environmental Modeling

Future: Sun angle, water flow, climate zones. Accommodations:
- Features store orientation and exposure metadata.
- Ymir does not compute sun paths or water runoff.
- Consumer apps layer environmental simulation.

### 10.5 Multi-User and Household Access

Future: Multiple users, permissions, shared properties. Not designed yet; Ymir assumes single-user for v1.

---

## 11. Examples and Narratives

### Example 1: Adding a Raised Garden Bed

User in garden app: "I built a new 4×8 raised bed in the front yard."

1. **Garden app requests spatial addition:**
   ```json
   {
     "property_id": "prop_12345",
     "parent_area_id": "area_front_yard",
     "kind": "raised_bed",
     "name": "Front Yard Bed #1",
     "position": { "x": 10.5, "y": 8.2, "heading": 0 },
     "dimensions": { "width_m": 1.2, "depth_m": 2.4, "height_m": 0.3 },
     "vertical_envelope": { "canopy_top_m": 0.5, "root_zone_m": -0.3 }
   }
   ```

2. **Ymir creates feature:**
   - Validates position is within front yard boundary.
   - Assigns stable ID (e.g., `feat_abc123`).
   - Records `created_at`, `from_date: today`.

3. **Ymir notifies garden app:**
   ```json
   {
     "event_kind": "feature_added",
     "property_id": "prop_12345",
     "feature_id": "feat_abc123"
   }
   ```

4. **Garden app caches the feature** and can now add plantings within it.

### Example 2: Renovating a Kitchen

User in interior app: "We're gutting the kitchen and rebuilding it."

1. **User specifies old kitchen removal and new kitchen addition.**
2. **Ymir marks old kitchen feature:**
   ```json
   { "to_date": "2024-06-30", "note": "renovated" }
   ```
3. **Ymir creates new kitchen feature:**
   ```json
   { "from_date": "2024-07-15", "name": "Kitchen (2024)" }
   ```
4. **Query `property_as_of("2024-06-01")` returns the old kitchen.**
5. **Query `property_as_of("2024-08-01")` returns the new kitchen.**

### Example 3: Planting Succession in a Garden Bed

Scenario: Spring peas, summer beans, fall greens in the same bed.

1. **Ymir feature:** Raised bed `feat_bed_1` with footprint and dimensions.
2. **Garden app records:**
   - **Spring:** Planting `plant_peas` with occupancy `{ from: "2024-03-15", to: "2024-05-30", geometry: full bed }`
   - **Summer:** Planting `plant_beans` with occupancy `{ from: "2024-06-01", to: "2024-08-30", geometry: full bed }`
   - **Fall:** Planting `plant_greens` with occupancy `{ from: "2024-09-01", to: "2024-11-15", geometry: full bed }`
3. **No overlap, no conflict.** Ymir does not know or care; it simply stores the bed.

---

## 12. Schema Stability and Extension

### 12.1 Versioning

The schema is versioned. Breaking changes increment the major version; additions and refinements are minor.

- **v1.0:** Initial release (this document)
- **v1.x:** Additions (new optional fields, new FeatureKind values)
- **v2.0:** Breaking changes (restructuring core types, required field changes)

### 12.2 Extension Points (Without Mutation)

New domains extend Ymir by:
1. Adding new FeatureKind values (e.g., `IRRIGATION_VALVE`).
2. Adding new AdjacencyKind values (e.g., `irrigation_line`).
3. Adding optional metadata fields to Feature.metadata.
4. Creating their own tables/records that reference Ymir IDs.

Example: Irrigation domain adds a feature `IRRIGATION_VALVE` and links records to the valve ID:
```typescript
// Ymir: new feature kind
feature: { id: "feat_valve", kind: "irrigation_valve" }

// Irrigation app: own table
CREATE TABLE valves (
  id TEXT,
  ymir_feature_id TEXT REFERENCES features(id),
  flow_rate_gpm REAL,
  control_method TEXT,
  ...
);
```

---

## 13. Non-Goals and Out of Scope

Ymir **does not** handle:
- CAD-level precision or tolerance modeling (sub-centimeter detail).
- Structural engineering (load-bearing, codes, compliance).
- Photogrammetry or 3D mesh reconstruction.
- Environmental simulation (hydrodynamics, thermal modeling).
- Asset management lifecycle (inventory, depreciation, accounting).
- User access control or permissions (handled by consumer apps).
- Real-time collaboration or conflict resolution (future/optional).
- Multi-currency or locale-specific units (SI only, consumer apps localize).

---

## 14. Principles and Maxims (Design Decisions)

1. **One property is one model.** Land and structures are not separate; they are unified.
2. **Identity is immutable; everything else can change.** An object's ID never changes; its position, status, and temporal bounds do.
3. **Contain, don't nest metadata.** Spatial data lives in core types; domain operations live in consumer apps.
4. **Validation is strict; recording is lenient.** Ymir enforces structural rules but records conflicting data if asked (for later reconciliation).
5. **Time is first-class.** Every spatial fact has a validity interval; the system is inherently historical.
6. **Coordinate system is invariant.** Property-local SI (meters, gardenos-local-si-v1) is canonical; consumer apps transform as needed.
7. **No schema pollution.** Domain-specific fields do not enter core types; they extend via specialization or metadata.
8. **Consumer apps are peers, not hierarchies.** Neither garden nor interior app is "primary"; both read/write through the same Ymir boundary.

---

## 15. Implementation Roadmap (Not This Session)

This session produced the schema and architecture. Implementation will follow:

1. **Ymir Core Library:** TypeScript/Rust library implementing the engine and validation.
2. **Local Storage:** SQLite schema and query layer.
3. **Garden App Migration:** Import existing gardens and connect to Ymir.
4. **Interior App Integration:** New app designed from the start with Ymir references.
5. **Export/Import Tools:** CLI and UI utilities for backup and transfer.
6. **Optional: Service Layer:** REST or GraphQL endpoint for multi-device sync (future).

---

## 16. Conclusion

Ymir unifies the spatial aspects of a property—outdoors and indoors, botanical and structural—under one coherent model. Its core is small and stable; extensibility comes through domain-specific consumer apps that reference Ymir features without forking spatial truth.

The schema is deliberate, versioned, and designed for long-term forward compatibility. It accommodates visualization, temporal queries, multi-property management, and future integrations without overspecifying their implementation.

With this canon in place, consumer apps can build with confidence that they share a single spatial source of truth.
