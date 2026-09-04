# Minon Devils UX Contract

## Canonical behavior

- Create and edit actions use the existing app modal, save in place, and show the shared toast.
- Delete actions use the existing confirmation and restore flow through History.
- Search filters locally as the person types and preserves data; an empty result explains that no matching records exist.
- The native select is the accepted owner for compact filters and time inputs.
- Toasts use the single `showToast` system. Server failures use the existing error banner with recovery detail.
- Tables remain semantic HTML tables; their page owns horizontal overflow on narrow screens.
- Scrollbars inherit the global dark baseline in `public/index.html`.
- «Accs» stores each agent and soc disclosure state locally for the current browser. Agent order is a saved workspace property and can be changed with the visible up/down controls. An account marked as banned (or with a ban date) can be hidden from the working list without deletion.
- Search, agent, soc, and status filters in «Accs» are retained locally after a refresh; «Сбросить фильтры» clears both the current view and the saved filter state.
- Access is authenticated by a secure server session. Admins create buyers; buyers create assistants in their own workspace. Assistants receive read-only shared access, buyers can edit shared work data but can only move existing task cards between statuses, and the server enforces the same policy for every API request.
- Only administrators see the CRM-canvas switcher. Buyers and assistants enter the canvas assigned through their relationship, without a workspace-switching control. The global «Очистить всё» action is not exposed; data removal remains scoped to individual records and the recoverable History flow.
- «План залива» is a Tasks sub-tab. Each launch-plan row is independent and belongs to one selected calendar day; it records creative naming, GEO, quantity, campaign setup, and budget. Rows are grouped into expandable creative-name sections, with a per-creative campaign and quantity summary; GEO remains visible in every row. A creative header can add GEO rows directly, and a new plan can split comma-separated GEO values into multiple rows for one creative. Date arrows preserve the plan history, while Today returns to the current day.
- Notes are stored as independent `note` and `noteLink` entities. A note saves its title, body, and board position; dragging the point onto another note creates one undirected relationship. Connection endpoints automatically use the closest card edges, and a connection can be removed with a double-click or keyboard Enter/Delete while focused. Editing and deletion use the note modal.
