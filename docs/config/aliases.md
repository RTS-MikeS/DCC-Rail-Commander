# Aliases

The Aliases editor manages `myAliases.h` — friendly names for the ID of a Roster, Turnout, Sensor, Route,
Sequence, or Automation entry defined elsewhere in your configuration, so other config files and EX-RAIL
scripts can refer to it by name instead of a raw numeric ID.

![Aliases editor, showing the alias folder tree on the left and the selected alias's fields on the right](../assets/screenshots/aliases-editor.png)

## Layout

Unlike Routes, Sequences, Automations, and Event Handlers, the Aliases editor has no Blocks canvas — the
**Visual** tab is a [folder tree](folders.md) of your aliases on the left and the selected alias's fields on
the right. New aliases are filed in a folder named for their target type (Roster, Turnout, Sensor, Route,
Sequence, Automation), and you can rearrange them like any other tree. The tree starts collapsed and is
sorted alphabetically (see [Expanding and collapsing](folders.md#expanding-and-collapsing)). The order of
the `ALIAS` lines written to `myAliases.h` follows **Alias sort order** in [Preferences](../preferences.md).

## Adding an alias

Click **+** in the Aliases list to open the **Add Alias** dialog:

1. Choose the target **Type** from the dropdown.
2. Choose the target **ID** from the second dropdown — it lists only IDs of that type that don't already have
   an alias, refreshed each time you open it.
3. Type a **Name** for the alias.
4. Pick a **Folder**. It defaults to the folder for the chosen type (it's created if it doesn't exist yet),
   and stays where you put it if you choose one yourself. Choose **(none)** for the top level.
5. Click **Add Alias**, or press **Enter** in the Name field.

![Add Alias dialog with Type, ID, Name and Folder fields](../assets/screenshots/aliases-add-dialog.png)

If no ID is selected, or the name/ID combination is invalid, an error appears in the dialog and it stays
open so you can fix it. **Cancel** closes it without adding anything.

## Alias fields

| Field | Notes |
|---|---|
| **Name** | Must start with a letter or underscore, and contain only letters, numbers, and underscores. Can't collide with an EXRAIL command name. |
| **ID** | The numeric ID of the target Roster/Turnout/Sensor/Route/Sequence/Automation entry. |
| **Type** | Shown as a read-only badge on each row; set when the alias is created and can't be changed afterward from the Visual tab. |

## Editing and removing

Edit a row's **Name** or **ID** directly and it commits when you leave the field (on blur). An edit that fails
validation shows an error message and reverts the whole list to its last valid state, so no other row's edit
is lost in the process. Click **×** on a row to remove that alias (you'll be asked to confirm first).

## Raw view

Switch to the **Raw** tab to edit `myAliases.h` directly in a Monaco editor. Each alias is written as
`ALIAS(name, id)`, with its target type recorded in a trailing `// type: <Type>` comment so the Visual tab can
round-trip it back into the correct group.
