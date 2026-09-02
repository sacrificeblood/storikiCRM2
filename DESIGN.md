---
version: alpha
name: "Minon Devils"
description: "A dark, high-density traffic CRM with the poise of an after-hours ledger."
colors:
  background: "#09070a"
  surface: "#151015"
  surfaceRaised: "#20171d"
  primary: "#ed294b"
  primaryDeep: "#80172b"
  ink: "#f5ece8"
  muted: "#aa9ca2"
  warning: "#f0b06d"
  info: "#89b8ff"
typography:
  display:
    fontFamily: "Arial Black, Arial, sans-serif"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
rounded:
  DEFAULT: "0.625rem"
  sm: "0.375rem"
  md: "0.625rem"
  lg: "1.125rem"
spacing:
  control: "0.625rem"
  panel: "1rem"
  page: "1.25rem"
components:
  button: { intent: "brand / neutral / danger" }
  card: { surface: "raised" }
  dialog: { surface: "raised" }
  table: { density: "compact" }
---

# Minon Devils Design System

## Overview

### Creative North Star

An after-hours financial ledger under red club light: precise, controlled, and slightly dangerous. The signature is a single sharp red line and metal-like red accents—not scattered neon or generic glassmorphism.

### Product context and register

- **Audience and primary job:** traffic team members managing daily performance, campaigns, assets, and tasks quickly.
- **Locale:** Russian UI; numeric and technical data remain compact and scanable.
- **Usage scene:** desktop-first operations work, with usable mobile fallbacks.
- **Register:** product with a strong brand shell.
- **Memorable signature:** a single red cut line, not ambient dashboard decoration.
- **Restraint:** tables, forms, and destructive actions stay calm and predictable.
- **Anti-references:** generic SaaS gradients, sci-fi HUDs, and corporate “command center” terminology.
- **Token ownership/runtime mapping:** runtime CSS variables in `public/index.html` are canonical; this document mirrors their accepted roles.

## Colors

`primary` is reserved for the active navigation state, primary actions, and the red-line signature. `warning` marks time-sensitive daily tasks; `info` marks neutral information. Surfaces use tonal depth and hairline borders instead of blur stacks.

## Typography

Display typography is compressed, all-caps, and limited to the brand lockup. Body and form text use the system sans stack for speed and Cyrillic clarity. Tabular figures and timing use the data stack and tabular numerals.

## Layout

The application keeps its dense desktop structure. Header, filter bars, and cards use a 10px control rhythm; page panels use 16–20px breathing room. Mobile collapses columns before shrinking controls below a comfortable touch target.

## Elevation & Depth

Depth comes from near-black tonal steps, thin warm borders, and a restrained red underglow on active surfaces. Static tables do not float; dialogs and active cards do.

## Shapes

Cards use 10px corners, controls use 6px, and the brand/header is the only large rounded shape. Buttons never become pills unless they communicate a binary state.

## Components

### Foundational visual states

Focus rings are red and visible. Disabled controls reduce contrast and lose pointer affordance. Busy controls preserve their geometry. Reduced-motion mode removes ambient movement.

### Buttons and actions

Primary actions are solid red, neutral actions are black-on-hairline, and danger stays separated in rose-red.

### Navigation and data display

Active navigation is a red cut line. Tables use compact rows and warm hairlines; badges identify state without becoming decoration.

### Notes board

The Notes tab is a spatial working surface, not a task column: cards are quiet oxblood paper slips, their red edge names the active object, and thin red curves show relationships. Pan and zoom are direct-manipulation controls; creation is available through the primary action and a right-click on open canvas.

### Forms and overlays

Fields are dark and inset with a visible red focus halo. Dialogs are raised oxblood surfaces. Toasts report actions in a single stable location.

### Motion

Motion is short and tactile: 140–200ms press/hover feedback. The background’s red drift is subtle and removed when reduced motion is requested.

## Do's and Don'ts

- **Do:** use red once to name the current action or current place.
- **Do:** keep data surfaces sober and legible.
- **Don't:** add dashboard/HUD decoration or status jargon.
- **Don't:** use blur or glow to hide weak hierarchy.
