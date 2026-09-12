---
version: alpha
name: "Minon"
description: "A black-and-signal-green traffic CRM built for fast operational work."
colors:
  background: "#020806"
  surface: "#07130d"
  surfaceRaised: "#0b1b12"
  primary: "#2eea72"
  primaryDeep: "#0e7f3d"
  ink: "#eefbf3"
  muted: "#8eaa98"
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

# Minon Design System

## Overview

### Creative North Star

A night-operations ledger lit by a focused green signal: precise, controlled, and fast. The signature is a pair of angular luminous marks derived from the supplied eye-like reference, paired with one sharp green line—not scattered neon or generic glassmorphism.

### Product context and register

- **Audience and primary job:** traffic team members managing daily performance, campaigns, assets, and tasks quickly.
- **Locale:** Russian UI; numeric and technical data remain compact and scanable.
- **Usage scene:** desktop-first operations work, with usable mobile fallbacks.
- **Register:** product with a strong brand shell.
- **Memorable signature:** two angular green signal marks and one green cut line, not ambient dashboard decoration.
- **Restraint:** tables, forms, and destructive actions stay calm and predictable.
- **Anti-references:** generic SaaS gradients, sci-fi HUDs, and corporate “command center” terminology.
- **Token ownership/runtime mapping:** runtime CSS variables in `public/index.html` are canonical; this document mirrors their accepted roles.

## Colors

`primary` is reserved for active navigation, primary actions, and the green signal signature. `warning` marks time-sensitive daily tasks; `info` marks neutral information. Surfaces use near-black green tonal depth and cool hairline borders instead of blur stacks.

## Typography

Display typography is compressed, all-caps, and limited to the brand lockup. Body and form text use the system sans stack for speed and Cyrillic clarity. Tabular figures and timing use the data stack and tabular numerals.

## Layout

The application keeps its dense desktop structure. Header, filter bars, and cards use a 10px control rhythm; page panels use 16–20px breathing room. Mobile collapses columns before shrinking controls below a comfortable touch target: navigation and filters wrap into readable rows, while data tables retain their columns inside their own horizontal scroller.

## Elevation & Depth

Depth comes from near-black tonal steps, thin cool-green borders, and restrained green underglow on active surfaces. Static tables do not float; dialogs and active cards do.

## Shapes

Cards use 10px corners, controls use 6px, and the brand/header is the only large rounded shape. Buttons never become pills unless they communicate a binary state.

## Components

### Foundational visual states

Focus rings are signal green and visible. Disabled controls reduce contrast and lose pointer affordance. Busy controls preserve their geometry. Reduced-motion mode removes ambient movement.

### Buttons and actions

Primary actions are solid signal green with near-black text, neutral actions are black-on-hairline, and danger stays separated in rose-red.

### Navigation and data display

Active navigation is a green cut line. Tables use compact rows and cool hairlines; badges identify state without becoming decoration.

### Daily launch plan

The launch plan lives as a peer tab to Tasks, using a date strip and expandable creative-name groups. Creative naming is the blue high-contrast badge and primary scan target; GEO stays as neutral row context, while quantity, setup, and budget remain quiet supporting data.

### Image uniquifier

The uniquifier is a private production bench: source controls stay in one compact panel while generated variants form a calm result grid. The green progress cut is the only active accent. Preview and result media sit on the darkest surface so color judgment is not distorted by the interface.

### Notes board

The Notes tab is a spatial working surface, not a task column: cards are deep green-black paper slips, their signal edge names the active object, and thin mint-gradient curves show relationships. The curves automatically select the nearest clean edge on each card, so the canvas stays legible as notes move. A compact amber clock badge marks a scheduled Telegram reminder and turns neutral after delivery. Pan and zoom are direct-manipulation controls; creation is available through the primary action and a right-click on open canvas.

Telegram recipients use the same compact native selector as the rest of the product. A recipient is shown as a CRM display name plus `@username`; the account relationship map is the single place where administrators maintain that username.

### Forms and overlays

Fields are dark and inset with a visible green focus halo. Dialogs are raised green-black surfaces. Toasts report actions in a single stable location.

### Motion

Motion is short and tactile: 140–200ms press/hover feedback. The background’s green drift is subtle and removed when reduced motion is requested.

## Do's and Don'ts

- **Do:** use signal green once to name the current action or current place.
- **Do:** keep data surfaces sober and legible.
- **Don't:** add dashboard/HUD decoration or status jargon.
- **Don't:** use blur or glow to hide weak hierarchy.
