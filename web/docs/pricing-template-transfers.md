# Import, export and share pricing templates

## Who can transfer templates

Open **Pricing Templates → Templates**. Import, export and share are available to template managers (the existing Business Settings permission). The pricing feature and its page must also be enabled/allowed. Import uses the existing versioned settings save and server permission checks; it requires an online, ready workspace unless using the local trial. Cost-view access alone does not grant template management.

## Export or share

1. Use **Export active** to export active templates. Enable **Show archived** and use **Export all** to include archived templates too. A template card's **Export** exports only that card.
2. Review the export dialog. Files include input definitions/options, formulas, fixed amounts written in formulas, computed stock links, markup/margin, discount/profit limits, and referenced item names/formula names/consumption units.
3. Download the JSON file, or use **Share** on a card to open the device share sheet. Choose the recipient/app there. If file sharing is unavailable, download and attach the file manually.

Files exclude catalogue cost amounts and selling prices, stock quantities, customer information, payments, jobs and receipts. A fixed transport/design amount written directly in a formula remains part of that formula. Review formulas and profit rules before sharing them. A template with missing references must be repaired before it can be exported.

Sharing sends a file; it does not publish the template or create a public link. Cancelling the device share sheet sends nothing.

## Import into this or another shop

1. Use **Import** and select a PrintShopLedger template `.json` file (up to 2 MB).
2. Review the proposed template names. Existing names receive an ` (import N)` suffix; names remain editable. Saved templates are always new active copies at version 1, including templates archived in the source file.
3. Match every source item to a local item. Suggestions require a unique compatible formula name (or name for stock-only references). Inspect them before confirming. Options must have the same consumption unit and the required cost/selling-price information. References used for stock must also retain their stock-tracking behaviour. Create missing local items through the normal catalogue workflow, then return to import.
4. Resolve every reported error. The app rewrites item IDs and formula references, validates the definitions and tests calculations with default inputs against current local costs. All templates are saved together through the existing settings operation; an invalid template blocks that import.
5. Select **Import N templates**. Check the imported definitions, normal/boundary inputs, prices and stock quantities before staff use.

The destination's current costs and selling prices apply, so its result can differ from the source shop. Purchase units can differ (ream/pack) when consumption units agree; a stock calculation in sheets must still match a local item consumed in sheets. Import does not create stock, copy catalogue prices, overwrite an existing template or change saved orders/quotes. It keeps stock links pointing at the chosen local items. If formulas depend on item A's selling price, map it to an eligible local selling item, not a private cost.

Imports are additive: importing the same file twice creates two copies. Archive an unwanted copy through the normal template action. To update an existing definition, edit it or import a new copy and archive the old one after review.

## File contract for developers

The versioned envelope is `{ format, version, templates, items }`. `format` is `printshopledger.pricing-templates`; `version` is `1`. At most 500 template definitions and 1,000 referenced items are accepted, subject to the destination's active/total limits. UTF-8 input and output are limited to 2 MB. Unknown format versions are rejected, never guessed.

`templates` contains canonical definitions, not trusted serialized expression trees. All formula text is parsed again. `items` contains reference identity, display name, formula key, consumption unit, whether it tracks stock, and required uses (`cost`, `price`, `stock`). The app derives and checks the dependency manifest, including unused material options and conditional branches. No imported object is executed as JavaScript.

- `src/pricing-formulas.mjs`: grammar, name traversal and exact-decimal arithmetic.
- `src/pricing-templates.mjs`: definition validation, pricing and stock calculation.
- `src/template-transfer.mjs`: portable envelope, manifest validation, compatibility and remapping.
- `src/TemplateTransfer.tsx`: review dialogs, file download and native sharing.
- `tests/template-transfer.test.mjs`: round trips, cross-shop remapping, stock, limits and invalid inputs.
- `scripts/check-pricing-templates.mjs`: desktop/mobile integration with template management.

No schema migration or new endpoint is needed: accepted imports use the existing versioned business settings save. Existing saved-order snapshot formats are unchanged.
