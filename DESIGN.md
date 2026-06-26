---
name: Sonic Dark
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bccbb9'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#869585'
  outline-variant: '#3d4a3d'
  surface-tint: '#4ae176'
  primary: '#4be277'
  on-primary: '#003915'
  primary-container: '#22c55e'
  on-primary-container: '#004b1e'
  inverse-primary: '#006e2f'
  secondary: '#ffb3b0'
  on-secondary: '#670211'
  secondary-container: '#881d24'
  on-secondary-container: '#ff9996'
  tertiary: '#7cd0ff'
  on-tertiary: '#00354a'
  tertiary-container: '#2eb7f2'
  on-tertiary-container: '#00455f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#6bff8f'
  primary-fixed-dim: '#4ae176'
  on-primary-fixed: '#002109'
  on-primary-fixed-variant: '#005321'
  secondary-fixed: '#ffdad8'
  secondary-fixed-dim: '#ffb3b0'
  on-secondary-fixed: '#410006'
  on-secondary-fixed-variant: '#881d24'
  tertiary-fixed: '#c4e7ff'
  tertiary-fixed-dim: '#7bd0ff'
  on-tertiary-fixed: '#001e2c'
  on-tertiary-fixed-variant: '#004c69'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '500'
    lineHeight: '1.4'
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  gutter: 16px
  margin: 24px
  container-max: 1280px
---

## Brand & Style

The design system is engineered for high-performance audio environments. The brand personality is **technical, precise, and focused**, minimizing visual noise to allow users to concentrate on sound waves and metadata. 

We utilize a **Glassmorphic-Minimalist** hybrid style. This approach uses deep, translucent layers to create a sense of depth without relying on traditional shadows, which can feel muddy in dark themes. The UI should evoke the feeling of a modern recording studio—dark, sleek, and lit only by essential indicators.

## Colors

This design system utilizes a palette of deep slates and navys to maintain high ergonomic comfort during long sessions. 

- **Primary (Microphone Green):** A vibrant emerald used for active recording states and "Go" actions. It is tuned to glow against dark backgrounds.
- **Secondary (Stop Red):** A desaturated, soft coral-red. It remains highly visible for emergency stops but avoids "vibration" against the dark navy surfaces.
- **Surface Strategy:** Use `#0f172a` for the base background and `#1e293b` for elevated containers and cards.
- **Contrast:** Typography must never drop below `#94a3b8` to ensure WCAG AA compliance on dark backgrounds.

## Typography

The design system utilizes **Geist** for its technical precision and developer-centric aesthetic. The monospaced-influenced letterforms are ideal for displaying timestamps, frequencies, and fluctuating audio data.

- **Headlines:** Use tight letter spacing and semi-bold weights to create a strong visual anchor.
- **Labels:** Small labels use uppercase with increased tracking (0.05em) to ensure legibility on low-brightness displays.
- **Data Display:** For numerical values (e.g., decibels), ensure tabular figures are enabled to prevent layout shift during live updates.

## Layout & Spacing

This design system follows a **4px baseline grid** to maintain technical rigor. 

- **Grid:** A 12-column fluid grid is used for desktop, shifting to a 4-column grid for mobile.
- **Gutters:** Standardized at 16px to keep content dense but readable.
- **Reflow:** On mobile devices, side-by-side utility panels (like waveform monitors and track lists) should stack vertically, prioritizing the waveform at the top of the viewport.

## Elevation & Depth

Hierarchy is established through **Glassmorphism and Tonal layering**. 

- **Level 0 (Base):** `#0f172a` — The infinite canvas.
- **Level 1 (Surface):** `#1e293b` — Main UI containers and cards.
- **Level 2 (Overlays):** Semi-transparent white `#ffffff05` with a `20px` backdrop blur. Used for modals and floating toolbars.
- **Outlines:** Instead of heavy shadows, use 1px inner borders of `#ffffff10` to define the edges of surfaces. This "ghost border" technique provides clarity without adding visual weight.

## Shapes

The design system uses **Soft (Level 1)** roundedness. 

- **Standard Elements:** 4px radius (0.25rem).
- **Large Containers:** 8px radius (0.5rem).
- **Interactive States:** Subtle rounding reinforces the technical, hardware-inspired aesthetic, avoiding the "bubbly" look of consumer social apps.

## Components

- **Buttons:** Primary buttons use a solid Green fill with dark Slate text. Ghost buttons use a 1px border of the accent color with no fill.
- **Microphone Indicators:** Use a "breathing" animation on the primary green color when active.
- **Waveform Displays:** Rendered in Primary Green against the Deep Slate background. Use a secondary color (Blue/Tertiary) for playhead markers.
- **Input Fields:** Backgrounds should be a shade darker than the surface they sit on (`#0f172a` inputs on a `#1e293b` surface) with a subtle 1px border that brightens on focus.
- **Chips/Status Tags:** Small, low-profile capsules with a 1px border and light text. No background fill unless the status is critical.
- **Cards:** No box shadows. Define card boundaries solely through background color shifts and 1px borders.