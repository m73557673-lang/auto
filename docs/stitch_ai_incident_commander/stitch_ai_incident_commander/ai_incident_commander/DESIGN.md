---
name: AI Incident Commander
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434655'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#575e70'
  on-secondary: '#ffffff'
  secondary-container: '#d9dff5'
  on-secondary-container: '#5c6274'
  tertiary: '#46566c'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6e85'
  on-tertiary-container: '#e9f0ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dce2f7'
  secondary-fixed-dim: '#c0c6db'
  on-secondary-fixed: '#141b2b'
  on-secondary-fixed-variant: '#404758'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies high-velocity operational command and technical precision. Designed for Site Reliability Engineers (SREs), DevOps leads, and infrastructure operators navigating mission-critical production outages, the interface maintains complete emotional composure under high stress.

Drawing from modern precision engineering aesthetics (Linear, Stripe Dashboard, Datadog), the visual tone is strictly light mode, utilitarian, and distraction-free. It avoids decorative gradients, glowing neon highlights, or visual noise in favor of structural clarity, high information density, and instant legibility. The interface communicates speed, deterministic stability, and authoritative triage capabilities.

## Colors

The palette establishes an ultra-clean, clinical work environment with distinct functional semantics for telemetry, state assessment, and immediate status recognition.

- **Background & Canvas**: Pure off-white `#F8FAFC` canvas paired with `#FFFFFF` surfaces creates subtle, resting contrast without glare.
- **Typography & Structure**: Deep `#111827` ensures maximum contrast for primary metric readings and incident descriptions. Secondary details sit at `#64748B`, while disabled elements and placeholder text use `#94A3B8`.
- **Primary Brand**: Core interactive focus utilizes `#2563EB` (hover state `#1D4ED8`) for primary commands, active triage selections, and key action triggers.
- **Structural Dividers**: Crisp, structural separation is driven by `#E2E8F0` on nested components and `#E5E7EB` on outer panel divides.
- **Incident & Health Semantics**:
  - *Healthy / Resolved*: Text `#16A34A`, background `#DCFCE7`, border `#BBF7D0`.
  - *Warning / Elevated Latency*: Text `#D97706`, background `#FEF3C7`, border `#FDE68A`.
  - *Critical / P0 Outage*: Text `#DC2626`, background `#FEE2E2`, border `#FECACA`.

## Typography

The typographic hierarchy prioritizes rapid scanning, optical clarity at small scale, and unmistakable visual separation between human language and machine-generated telemetry.

- **Primary Interface**: Powered by Inter across headlines, operational summaries, and standard forms. Tight tracking (`-0.01em` to `-0.02em`) on headers gives a compact, engineered posture.
- **Telemetry & Identity**: JetBrains Mono serves strictly for incident IDs (e.g., `INC-8802`), error traces, payload JSON, commit hashes, latency metrics, and console stdout streams.
- **Scale Compactness**: Because incident dashboards display dense diagnostic tables, primary body text defaults to `13px` (`body-md`) with high x-height for optimal data compression.

## Layout & Spacing

This design system uses a strict 4px/8px incremental grid designed to optimize horizontal screen real estate for split-screen diagnostics and chronological activity feeds.

- **Workspace Division**: The layout is split into a 240px collapsable structural side rail, an automated timeline feed, and a multi-pane diagnostic viewport conforming to a fluid grid.
- **Component Density**: Inner panel padding standardizes at `0.75rem` (`space-md`) for telemetry widgets and `1rem` (`space-lg`) for major analysis panels. Compact spacing reduces cognitive fatigue by eliminating excess travel across multi-monitor setups.
- **Breakpoints**:
  - Desktop (>1280px): Multi-pane side-by-side incident runbook and graph telemetry.
  - Tablet (768px - 1279px): Stacked layout with expandable drawer triage panels.
  - Mobile (<768px): Single-column incident mitigation mode with sticky bottom actions.

## Elevation & Depth

Visual separation relies on crisp, ultra-subtle micro-shadows combined with 1px border lines rather than diffuse drop shadows or blurred layering.

- **Base Surfaces (Cards, Containers)**: Background `#FFFFFF` with a single 1px solid border of `#E2E8F0` and layered micro-shadows:
  `box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05), 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);`
- **Elevated Overlays (Dropdowns, Flyouts, Popovers)**:
  `box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);` paired with border `#E2E8F0`.
- **Modals / Incident War-Rooms**:
  `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04);` over a semi-transparent backdrop overlay of `rgba(15, 23, 42, 0.4)`.

## Shapes

The design system enforces a 10px to 12px structural radius (`rounded-xl` in implementation scale) across interactive surfaces, softening the density of technical data while preserving disciplined, box-aligned enterprise structure.

- **Primary Cards & Modals**: 12px corner radius for a continuous, tailored feel across container boundaries.
- **Interactive Controls (Inputs, Buttons, Segmented Controls)**: 8px to 10px radius, balancing tactile friendliness with dense grid alignment.
- **Badges & Severity Pills**: Fully rounded pill shapes (`9999px`) or compact 6px rounded badges depending on whether the indicator represents categorical metadata or raw status values.

## Components

- **Buttons**:
  - *Primary*: Background `#2563EB`, text `#FFFFFF`, 10px radius, micro-shadow. On hover: `#1D4ED8`. Active: `#1E40AF`.
  - *Secondary / Outline*: Background `#FFFFFF`, border 1px solid `#E2E8F0`, text `#111827`, subtle hover background `#F8FAFC`.
  - *Destructive / Rollback*: Background `#DC2626`, hover `#B91C1C`, text `#FFFFFF`.
- **Status Badges & Severity Chips**:
  - Thin 1px borders with tint-matched backgrounds and high-contrast text.
  - Critical (P0/P1): Text `#DC2626`, Background `#FEE2E2`, Border `#FECACA`.
  - Warning (P2): Text `#D97706`, Background `#FEF3C7`, Border `#FDE68A`.
  - Resolved: Text `#16A34A`, Background `#DCFCE7`, Border `#BBF7D0`.
  - Incident identifiers utilize mono chips: Background `#F1F5F9`, border `#E2E8F0`, font `JetBrains Mono`.
- **Input Fields & Search**:
  - Background `#FFFFFF`, 1px border `#E2E8F0`, text `#111827`, font size 13px.
  - Focus state: Border `#2563EB`, outline ring `2px solid rgba(37, 99, 235, 0.15)`. No loud glowing shadows.
- **Checkboxes & Radios**:
  - 16px square/circle with 1px border `#CBD5E1`. Checked state: background `#2563EB` with white crisp geometric checkmark.
- **Cards & Diagnostic Panes**:
  - Background `#FFFFFF`, 1px solid `#E2E8F0`, 12px radius, micro-shadow. Headers feature clean bottom borders `#F1F5F9` with integrated Lucide-style stroke icons (16px, 1.5px stroke width).
- **Incident Timeline Stream**:
  - Continuous vertical rail (1px solid `#E2E8F0`) with solid event dots mapping strictly to semantic status colors. Monospace timestamps aligned on the left.
- **Runbook / Action Callout**:
  - Left-bordered callout container with 3px solid `#2563EB` or `#DC2626` accent lines, `#F8FAFC` background fill, and structured checklist components.