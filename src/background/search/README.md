# Search, background side

`/` and `?` open the command line as a search line. In the thread list a search is the Quick Filter: it narrows the rows as the user types, Enter keeps the filter and selects a row, Escape puts the earlier filter back, and `n` and `N` step the rows.

| File | Role |
| --- | --- |
| `service.ts` | One live search per window: the tab and folder it began in, the filter to restore, a keystroke counter. `type` waits out a burst (150 ms), applies the filter, counts the rows and answers `stale` when a newer keystroke came. `commit`, `cancel` and `step` (`n`, `N`) |
| `register.ts` | The `/` register (`{ text, direction }`) in `storage.local`, one for every window |

## Rules

- Matching is Thunderbird's own: a case-insensitive text in the subject and the sender. The vendored `find_match.ts` supplies the stepping and the wording (`step_match`, `describe_match`).
- Every filter change of a search runs after the one before it, so a slow older filter never lands after a newer one or after the restore.
- The API cannot read the quick filter. `handlers/view.ts` remembers the last filter the add-on set for each tab (a copy in session storage survives a restart of the page), and the search restores that, or a hidden empty bar when none. A filter set by hand in the window is not known.
- The typed text goes on top of the earlier filter, so `F u` then `/` searches the unread messages.
- A search belongs to its tab and folder. If either changed, the search ends and touches no filter.
- Enter with no match keeps the search open. `n` after Escape narrows the list to the register again.
- Escape restores through the tab the search began in, so a tab switch mid-search leaves no narrowed tab behind. The line mounts with `clickThrough`, so clicks reach the list under its transparent part.
- The command line session stays in the map while an Enter commits, so Escape in that window cancels the search. A commit that finds the search gone throws and changes nothing.
