# Environment status

`environmentStatus.json` is written by the **Environment** tab of the Device Information Manager.
It records problems per robot port (environment/setup, Bluetooth/remote, box not working,
network, IR, box replaced, …) — **never edit it by hand while people use the app**; use the app.

- Grouped by robot → device port → list of updates (oldest first). The last entry is the current status.
- Every update is a commit, so the full history is also in this folder's Git history.
- Kept separate from `deviceInformation.json` so test automation is not affected.
- Commits to this folder do not rebuild the website (see `paths-ignore` in `.github/workflows`).

Entry fields: `at` (time saved), `by` (GitHub login), `status` (`ok` | `issue` | `down`),
`category` (`environment` | `bluetooth` | `box` | `network` | `ir` | `replaced` | `other`), `note`.
