# UI conventions

Use shared components and theme tokens when adding or updating screens. Product names, monetary values, stock rules and permissions belong to existing domain code; a layout change must preserve those behaviours.

## Controls and supporting text

- Standard text inputs, dates, selects and buttons use `--control-h` (44px). Controls use 8px corners, cards and dialogs 12px. Checkboxes, icon artwork and multiline text are intentionally different shapes.
- Use `.form-grid` for related fields: label, control and supporting text occupy shared rows. A hint may grow without moving a neighbouring control. `.hint-grid` remains an alias for older screens.
- Ordinary labels contain label text, then the control, then one supporting-text group. Group multiple hints/errors in that final group. Do not place a tooltip or placeholder in place of a persistent label.
- `CurrencyInput` groups its input and validation text so an error and a field hint cannot overlap. `ListedCombobox` participates in the same field rows. Keep checkbox descriptions beside their checkbox group, rather than treating the checkbox as a text field.
- Colours come from theme variables. Summary cards are neutral unless they communicate a meaningful state. Never highlight a card solely because it is last in a list.

## Lists and toolbars

- Use `ResponsiveTable` and explicitly declare the essential compact columns and their `details`. The wrapper observes its available width; below 840px, or in the phone/touch layout, it renders compact records.
- The first compact column contains the name and selected context; the second contains amount/stock. An optional third information column occupies a separate full-width row, avoiding overlap. Actions occupy their own row.
- Undeclared secondary columns appear under **More details**. When audit columns are explicitly enabled, audit information remains visible. No data is discarded.
- Preserve the table's accessible name and sorting. Wrap long identifiers, amounts and names; do not conceal content with `overflow-x: hidden`.
- `ToolbarActions` keeps `MenuToggle` view switches together as labelled icon buttons. Less frequent operations can use More. Filters and checkboxes wrap into intentional rows; actions retain stable dimensions.
- Receipt/document previews and genuine chart timelines are separate from operational record lists.

## Dialogs

- `Modal` owns the title, focus containment, focus restoration and scroll area. Do not create another page scroll area for a form.
- Main editors use `Modal.footer` with `DialogActions`: Cancel, then the main action. Checkout also shows its total. Wide dialogs use the full phone screen; short dialogs remain centred.
- Give the form a unique `useId()` ID and pass that ID to `DialogActions.form`. Native form association preserves validation, Enter submission and FormData when buttons sit outside the scrolling body.
- Pass `busy` to both the modal and its actions. Avoid duplicate submission controls. Leave enough space for phone safe areas and the onscreen keyboard.

## Settings

Business Settings uses vertical tabs on desktop, including Up/Down/Home/End keyboard navigation. Phones use the labelled Section picker. Both operate on the same section state and retain existing access restrictions and draft edits.

Section save buttons retain their existing scope. The separate all-settings action explicitly saves every edited section. A common status indicates unsaved changes or saving; do not add another independent save mechanism.

## Verification

Build first, then run `node scripts/check-ui-consistency.mjs`. It checks populated lists, field alignment, native footer submission, settings navigation and horizontal overflow at 320, 390, 740, 1024, 1280 and 1440px, in both themes. The iPhone-size checks also run in WebKit. Screenshots are written under `/tmp/ui-consistency` and uploaded by CI.

Use `settingsSection(page, name)` from `scripts/settings-navigation.mjs` in browser checks so the same check exercises desktop tabs and the mobile picker.
