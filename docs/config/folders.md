# Folders and the tree

Most configuration editors list their entries in a **tree** in the left sidebar, so a large layout can be
organized into folders instead of one long list. The same tree controls work the same way in every editor:

| Editor | File | Entries shown in the tree |
|---|---|---|
| [Roster](roster.md) | `myRoster.h` | Locomotives (with `#define` groups) |
| [Turnouts](turnouts.md#organizing-turnouts) | `myTurnouts.h` | Turnouts (also supports Virtual-turnout parents) |
| [Sensors](sensors.md) | `mySensors.h` | Sensors |
| [Signals](signals.md) | `mySignals.h` | Signals |
| [Routes](routes.md) | `myRoutes.h` | Routes |
| [Sequences](sequences.md) | `mySequences.h` | Sequences |
| [Automations](automations.md) | `myAutomations.h` | Automations |
| [Event Handlers](event-handlers.md) | `myEvents.h` | Event handlers |
| [Aliases](aliases.md) | `myAliases.h` | Aliases |

!!! important "Folders are for organization only"
    Putting an entry in a folder, moving it, or renaming or deleting a folder **never changes the firmware**.
    Folders exist only to help *you* find things in the editor. (The one exception is a Virtual turnout's
    children — see [Turnouts](turnouts.md#virtual-turnouts-as-groups).)

## Working with folders

- **Create a folder** with the folder button in the sidebar header, or **New Folder…** from a row's **⋯**
  menu (on a folder row this creates a subfolder). Names can't be blank or contain `/`. An empty folder is
  kept until you delete it.
- **Rename** or **Delete** a folder from its **⋯** menu. Renaming carries the folder's contents with it.
  Deleting a folder **does not delete its entries** — they move up one level.
- **Add an entry into a folder** by selecting the folder and clicking **+**.
- **Drag and drop** an entry (or a whole folder) onto a folder to move it in. While you drag, the folder the
  entry would land in is **outlined**; drop on blank space in the panel to move it back to the top level.
  Pressing Esc or releasing outside the panel cancels the drag and moves nothing.
- Folders show a folder icon and a count of the entries inside them.
- Where an editor has a **Location** drop-down on an entry's detail panel, it lists **Top level** and every
  folder, as another way to move the entry.

### Resizing the tree

Drag the divider between the tree and the editing pane to resize it (200–600 px). All the editors share
**one** width, which is remembered between sessions.

## Roster specifics

The Roster tree has one extra layer: folders sit **above** the shared-function `#define` groups. A group is
no longer a top-level node — it lives inside whichever folder you choose, and you can **drag a `#define`
group into a folder** to move all of its locomotives together.

### Searching the roster

The search box above the roster tree filters it as you type. It matches a locomotive's **name**,
**comment** or **DCC ID**; folders and groups that contain a match stay visible so you can see where it
lives. Click **×** to clear the search.

## How the tree is saved

Folders are stored **only in comments** in each file, directly above the entry they apply to, so the
EX-RAIL lines themselves are never altered and the firmware compiles exactly as before:

```cpp
// @tree-folder: Spare
// @tree: Yard/East
ROUTE(...)
```

| Comment | Meaning |
|---|---|
| `// @tree: Yard/East` | The next entry lives in folder `Yard`, subfolder `East`. |
| `// @tree-folder: Spare` | An empty folder that has no entries yet. |
| `// @id: <token>` | *Event handlers only.* A short unique tag that gives each handler a stable identity, since handlers have no ID of their own. |

If you edit a file in its **Raw** tab, the tree is rebuilt from whatever those comments say when you switch back
to Visual. Delete the comments and the entries return to the top level.
