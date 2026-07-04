> Imported design constraint reference from Yggdrasil `docs/design/BIFROST_DESIGN_SYSTEM.md` at commit `22c1247f2164e4c91aac8f1d5e55657c0fdc9e20`; Bifrost version `1.1`; read-only reference for Ymir design work.

# Bifrost — Cross-App Design System

**Version: 1.1** · Canonical copy: Yggdrasil repo, `docs/design/BIFROST_DESIGN_SYSTEM.md` · App repos carry copies; every copy states its version; build sessions must state which version they built against. A repo behind canon is caught up by replacing the file and reconciling tokens — never by editing the copy.

**Changelog**
- **1.1** — Added component-contribution law (Layer 1); added version/governance header; three-tier theme architecture ratified (Tier C per-context accents, from the Mímir's Well design sessions).
- **1.0** — Initial constitution: two-layer law, universal structure/behavior/tokens/semantics, per-app themes.

## Purpose

Every app in the estate — standalone or Yggdrasil-integrated — shares one structural and behavioral foundation while wearing its own visual theme. Universal elements look and behave the same everywhere; only the visual language (hue, mood, motifs, illustration) changes per app. This is what makes future cross-app UI management, liquid UI composition, and shared component maintenance possible without redesigning each app from scratch.

**The law: structure and behavior are universal; skin is local.**

## The two layers

### Layer 1 — Universal (identical in every app)

**Structural patterns**
- **App shell:** left navigation rail (sections with icon + label + one-line descriptor), top status bar (context/identity left, primary actions right), main content area, optional right rail for attention/detail.
- **Nav footer block:** every app pins its identity statement (creed, motto, or purpose line) plus version and a Local-Only/privacy badge at the bottom of the nav rail.
- **Panel/card grammar:** content lives in bordered panels with a consistent header pattern (icon + small-caps title + one-line descriptor), consistent corner radius, and consistent internal spacing.
- **The glance and the dig:** every app answers its core status question in under two seconds from its overview, with drill-down one level deeper. Overviews lead with what needs attention and bury what doesn't.

**Behavioral patterns**
- **State honesty:** one source of truth for app/system state; every surface that reflects state agrees with every other.
- **Calm default:** the resting state is quiet and designed with equal care to the busy state. Attention is spent only on deviation.
- **Gradual transitions:** no sudden visual jumps between states; changes glide.
- **Propose-then-act:** destructive or significant actions are proposed with context and explicitly confirmed; nothing irreversible happens silently.
- **Adjust in place:** live tweaks happen immediately, with a lightweight offer to persist — never forced pre-configuration.
- **Zero-config utility:** every app is useful at first launch with defaults; every setting must justify its existence.

**Token architecture (identical structure, different values)**
Every app carries the same token file structure — a single theme file defining:
- Color roles: `surface`, `surface-raised`, `edge`, `text-primary`, `text-muted`, `accent`, `accent-strong`, plus the universal semantic set below.
- Type roles: `display` (serif, small-caps capable, used for titles/headers), `body` (clean sans), `mono` (data/code) — same roles everywhere, same scale ratios; faces may vary per app only with justification.
- Spacing: one shared scale (4px base progression).
- Radius, border, glow/elevation treatments as named tokens.

**Universal semantics (same meaning and same hue family in every app, regardless of theme)**
- **Green = healthy / nominal / success.** Reserved; never decorative.
- **Red = critical / danger.**
- **Amber/orange = warning / needs attention.**
- **Muted blue/neutral = informational / hygiene / low-priority.**
- Severity ordering, iconography weight, and "danger draws the eye first" hierarchy are identical everywhere.

**Iconography and assets**
- Icons are always SVG, drawn code-side, recolorable via tokens, consistent within a set. Never raster.
- Illustration/art is raster, loaded through a per-app **asset manifest** (named keys → file paths in an `assets/` directory), never baked into components. Placeholders must be layout-safe.
- Every app defines the same core asset keys where applicable: hero art (per mood/state), crest/mark, and ornamental frame elements.

**Typography voice**
- Small-caps serif display headers over clean sans body is the estate-wide voice (established: Cinzel + Inter in Yggdrasil). Apps may substitute faces only when their world identity demands it (e.g., a fiction world's own typographic soul), but the display/body role split is universal.

**Component contribution (the future UI core accretes now)**
- Every app keeps its Layer 1-compliant UI primitives (panels, severity/status chips, nav rail, status bar, token file, HUD/overlay patterns) cleanly separated from app-specific logic — structured so a component could be lifted out with its tokens and dropped into another app. No shared package exists yet; build *as if it does*.
- Each app maintains a short `docs/design/components.md` inventory of its primitives. These inventories are the harvest source for the eventual shared UI core.

**Theme tiers (ratified 1.1)**
- Theming is three tiers: **(A)** app base theme — structural, calm, consistent; **(B)** per-world/per-context major theme where an app hosts multiple worlds or identities (theme tokens stored as data, never hardcoded as app constants); **(C)** fine-grained context accents within a theme (region/situation color applied to accents, selection, links, borders, active states). Single-identity apps use A with their Layer 2 skin as the only B. Apps hosting many identities (e.g., a world-building engine) implement B as data from day one and design for C.

### Layer 2 — Theme (each app's own)

Each app owns: its hue family and mood, its crest/mark, its hero illustration and motifs, its metaphor language (watchtower, hearth, well, settlement), and its named accent character. Established themes:
- **Yggdrasil core:** dark warm charcoal, amber gold, Norse/RPG, Cinzel/Inter.
- **Heimdall:** charcoal + amber-gold, watchtower/beam, sentinel mood.
- **Embers:** true black + ember red/amber, night-vision-safe, coal mood.
- **Ravenfall:** night blue-black + gold/frost, living settlement.
- **Mímir's Well / SunkenOath apps:** the world's own identity — defined by its creator, not inherited from Yggdrasil's Norse skin. Universal layer still applies in full.

## Governance

- This document is canon and lives in the Yggdrasil repo beside the architecture docs; every app brief references it.
- Every new app brief includes: "Inherit Bifrost Layer 1 in full; propose the Layer 2 theme for review."
- Changes to Layer 1 are constitution-level: deliberate, versioned, and propagated — never made ad hoc inside one app.
- When cross-app UI management arrives (liquid UI), Layer 1 compliance is what makes an app's components composable. Non-compliant surfaces are the ones that will need rework; build compliant now.
