# Minon Devils UX Contract

## Canonical behavior

- Create and edit actions use the existing app modal, save in place, and show the shared toast.
- Delete actions use the existing confirmation and restore flow through History.
- Search filters locally as the person types and preserves data; an empty result explains that no matching records exist.
- The native select is the accepted owner for compact filters and time inputs.
- Toasts use the single `showToast` system. Server failures use the existing error banner with recovery detail.
- Tables remain semantic HTML tables; their page owns horizontal overflow on narrow screens.
- Scrollbars inherit the global dark baseline in `public/index.html`.
