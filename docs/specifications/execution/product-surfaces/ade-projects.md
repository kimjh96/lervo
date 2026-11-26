# Lervo ADE projects and the first run

Status: `proposed`
As of: 2026-11-26

This specification defines S2f of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): the project profile and mark, adding and removing projects, the provider sign-in check, the product-owner role template, and how the ADE's start card and project switcher use them. Every operation is a core command that the terminal can run too; the ADE calls it through the core link ([Lervo ADE core link](ade-core-link.md)).

## Project profile

- A project's display name and mark live in `.lervo/project-profile.json`, a Lervo-managed file that is committed with the project. It is separate from `.lervo/project.yaml`, so writing it never changes the manifest or its hash, and no host's registry entry goes stale ([ADR-0169](../../../decisions/distribution/0169-user-local-repository-registration-and-resolution.md)).
- Schema version 1:
  - `schemaVersion`: `1`.
  - `kind`: `lervo_project_profile`.
  - `displayName`: 1 to 80 characters, without control characters or line breaks.
  - `mark`: `null`, or `{ "sha256": <64 lowercase hex>, "mediaType": "image/png" | "image/jpeg" | "image/webp" }`.
- Readers treat a missing file, an unknown schema version, or an invalid file as no profile: the display name is the manifest's `name`, and there is no mark. An invalid file is reported once as `project_profile_invalid` and never rewritten by a reader.
- The mark image is stored once, at `.lervo/assets/<sha256>.<png|jpg|webp>`. The core accepts a mark only when its bytes start with that format's signature, its size is at most 512 KiB, and its width and height are each between 16 and 1,024 pixels. SVG and every other format are refused (`project_mark_invalid`). The ADE scales a chosen image to at most 512 pixels square before it sends it.
- Setting a new mark writes the asset, then the profile. The previous asset is removed only when no profile names it. Clearing the mark sets `mark` to `null`.
- The first letter shown without a mark is the first grapheme of the display name, upper-cased when it has case, on one of the ADE's six mark colors (`color.mark.1` to `color.mark.6`). A small hash of the project ID chooses the color, so every host shows the same one.
- The ADE keeps a 64-pixel thumbnail of each mark it has read (`project.mark.read`), by the image's SHA-256, in its local storage: at most 64, so the switcher shows marks at once on the next launch.

## Adding a project

The core adds a project from one of three sources, each in one command, and then registers it on this host whatever the host's continuity policy.

| Source               | Command                                                            | What the core does                                                                                                                        |
| -------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| An existing folder   | `lervo project add --folder <absolute-path> --write`               | Runs `git init` when the folder is not inside a Git work tree, runs `lervo init` when it has no `.lervo/project.yaml`, then registers it. |
| A repository link    | `lervo project add --clone <url> [--into <absolute-path>] --write` | Clones into `<into>/<repository name>`, then initializes and registers it as above.                                                       |
| An instruction alone | `lervo project add --new <name> [--into <absolute-path>] --write`  | Creates `<into>/<folder name>`, runs `git init` and `lervo init`, and registers it.                                                       |

- `--into` defaults to the projects location: `~/Lervo` until the owner chooses another, which the core keeps in the user state directory as `projects-location.json` (`lervo project location --set <absolute-path> --write`).
- For a new project, the ADE proposes the name from the instruction. The folder name keeps the instruction's ASCII words, joined by hyphens and at most 40 characters, or else is `project-<yyyymmdd>-<4 hex>`. The display name is the instruction's first words, as a workspace title is, at most 80 characters. Both change later.
- An existing folder at the destination is never reused for a clone or a new project (`project_folder_exists`). A clone or a new project that fails leaves no folder behind (`project_clone_failed`, or the failing step's code).
- A new project gets its first commit, "Start the project with Lervo", with what Lervo wrote there, the profile included, so the first workspace has a commit to start from. It uses the owner's Git identity, or `Lervo <lervo@localhost.invalid>` when none is configured, and is reported after the fact as an effect notice (`project_first_commit`) whose undo removes the commit and keeps the files. A folder of the owner's files is never committed for them: a project with no commit yet refuses new work with `repository_has_no_commit` until the owner commits. Git runs without prompts, as `lervo workspace start` runs it.
- `lervo init` runs with its onboarding, so the project starts with a developer, as a terminal run does.

## Renaming, marking, and unregistering

- `lervo project show --project <id>` reads the display name and mark, and whether the profile is present, absent, or invalid.
- `lervo project rename --project <id> --name <text> --write` writes the display name to the profile.
- `lervo project mark set --project <id> --image <file> --write` and `lervo project mark clear --project <id> --write` set and clear the mark.
- `lervo repository unregister --project <id> --write` removes this host's registry entry only. It never touches the project's files, worktrees, workspaces, or state. Workspaces of an unregistered project stay on disk and reappear when the project is added again. The host's background knowledge maintenance and upgrades enumerate the registry, so they stop reaching an unregistered project.
- Rename and mark changes are repository writes under invariant 10: the core writes them at once and reports each as an effect notice (below). They never wait for approval.

## Provider sign-in

- `provider.list` reports `signedIn` for each provider: `true`, `false`, or `null` when Lervo cannot tell.
- For Claude Code, the adapter runs `claude auth status --json` with a 5-second limit and reads only `loggedIn`. It never reads, stores, logs, or sends the other fields, which include the account's email and organization. A failed or unparseable check is `null`. The result is cached for 60 seconds per host.
- `workspace.start` and a hosted launch fail with `provider_login_unavailable` when the provider reports `signedIn: false`. They proceed when it is `null`, so an unknown state never blocks work.
- The ADE shows `provider_login_unavailable` as one line under the start card, with one action that opens the provider's own sign-in in a terminal.

## The product-owner role template

- The core ships a `product-owner` role template, the same as this repository's role: it extends `ceo` and may plan, prioritize, hire, and delegate.
- When a project without a `product-owner` role hires a product owner, the core first writes `.lervo/roles/product-owner.json` from the template, then hires. Writing the role is a repository write under invariant 10, reported with the hire.
- It is not a built-in role. The core refuses a repository role whose ID duplicates a built-in role (`role_profile_invalid`, `packages/roles/src/repository.ts`), so a built-in `product-owner` would invalidate this repository's role and the agents bound to its contract hash ([ADR-0209](../../../decisions/execution/orchestration/0209-versioned-repository-role-contracts.md)).

## Core link

- `repository.list` adds `displayName`, `mark` (`null` or `{ sha256, mediaType }`), and `root`, the absolute path, which is local operational data the ADE uses only to show the folder in Finder.
- New application commands: `project.add` (`source`: `folder` with `path`, `clone` with `url`, or `new` with `name`, and an optional `into`), `project.rename`, `project.mark.set` (Base64 image within the bound), `project.mark.clear`, `project.mark.read` (returns the image's format, hash, and Base64 bytes, or null), `project.unregister`, and `projects.location` (returns the location, after setting it when `path` is given). Their results are named after them, such as `ProjectMarkSetResult`, as the session host looks them up.
- A clone asked over the core link stops after 100 seconds, within the session host's 120-second command deadline, and leaves nothing behind. A larger repository clones from the terminal, whose limit is 10 minutes, until the ADE shows a clone's progress.
- A core link from an older release does not name these commands, and the ADE hides what needs them.

## The ADE

- **The start card with no project.** The card's bar reads "Drop a folder, paste a repository link, or just describe new work". A folder dropped on the window or chosen with the system's picker calls `project.add` with `folder`. A pasted link that parses as a Git URL changes the bar to "Clone <name> · <location> ⌄". Text alone changes it to "New project <name> · <location> ⌄". The location is a small select of the same kind as the repository select, whose last item chooses another folder. Sending adds the project and, for an instruction, starts the work in it.
- **Confirmation.** A project that is added appears in the switcher and is selected. No success line shows. A failure shows as one line under the card with its code.
- **The switcher.** The sidebar's first row shows the selected project's mark and display name, with a dot when another project's workspaces need the owner. Clicking it opens the list of projects below it, in place: each with its mark, a dot when its workspaces need the owner, and `⌘1`–`⌘9`, then "Add project", which opens the folder panel. `⌘1`–`⌘9` also select a project with the list closed. Double-clicking a name edits it in place; Return or leaving the field keeps it, Escape keeps the old name. The system context menu holds "Change logo", "Remove logo" when there is one, "Rename", "Show in Finder", and "Remove from Lervo", with the disabled note "Files stay where they are." under the last. Labels carry no ellipsis (ADE design patterns, "Waiting"). An older core that answers no project command shows the list and "Show in Finder" only.
- **The selected project.** The ADE keeps the selected project in its local storage; the first listed project stands in when none is selected or the selected one is gone. The sidebar lists only the selected project's workspaces, and switching projects crossfades them in place. Work started from the start screen goes into the selected project, so the start card has no repository select.
- **Blocking checks.** Only a check that blocks work shows, as one line under the start card: the provider's sign-in, a session host older than the interface, or a core link that cannot be reached.

## Notices, privacy, and failure meaning

- A rename or mark change is reported after the fact as an effect notice (`effect`: `project_profile`, ADR-0561's journal), with the profile path and the mark's hash as targets and the command that restores the previous value as its undo. It carries no display name text and no absolute path, and it adds no event type, so no reader has to change first.
- Registry changes, including unregistering, stay local operational data and record no event (ADR-0169).
- A provider sign-in check records nothing. Its result is not stored beyond the 60-second cache.

| Code                         | Meaning                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `repository_not_registered`  | No registry entry on this host has that project ID (the registry's existing code).                             |
| `project_root_invalid`       | The folder does not exist, is not a directory, or cannot be written.                                           |
| `project_folder_exists`      | The destination of a clone or a new project already exists.                                                    |
| `project_clone_failed`       | Git could not clone the link; nothing was left behind.                                                         |
| `project_init_failed`        | `lervo init` could not set up the folder as a Lervo project; the folder stays as it was apart from `git init`. |
| `repository_has_no_commit`   | The project has no commit yet, so no workspace can start from one; the owner commits its files first.          |
| `project_name_invalid`       | The display name is empty, too long, or has control characters.                                                |
| `project_mark_invalid`       | The image's format, signature, size, or dimensions are outside the bound.                                      |
| `project_profile_invalid`    | The profile file exists but does not match its schema.                                                         |
| `projects_location_invalid`  | The projects location is not an absolute, writable directory.                                                  |
| `provider_login_unavailable` | The provider CLI reports that no one is signed in.                                                             |

## Open items

- How project profiles and mark assets replicate to a Hub is designed with accounts ([ADR-0638](../../../decisions/foundation/0638-keep-lervo-local-first-and-open-to-the-cloud.md)).
- Whether a new project's name may later come from the product owner instead of the instruction's words.
