# Minon Devils UX Contract

## Canonical behavior

- Create and edit actions use the existing app modal, save in place, and show the shared toast.
- Delete actions use the existing confirmation and restore flow through History.
- Search filters locally as the person types and preserves data; an empty result explains that no matching records exist.
- The native select is the accepted owner for compact filters and time inputs.
- Toasts use the single `showToast` system. Server failures use the existing error banner with recovery detail.
- Tables remain semantic HTML tables; their page owns horizontal overflow on narrow screens.
- Scrollbars inherit the global dark baseline in `public/index.html`.
- Notes are stored as independent `note` and `noteLink` entities. A note saves its title, body, and board position; dragging the point onto another note creates one undirected relationship. Connection endpoints automatically use the closest card edges, and a connection can be removed with a double-click or keyboard Enter/Delete while focused. Editing and deletion use the note modal.
