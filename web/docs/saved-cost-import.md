# Import saved pricing costs

Open **Pricing Templates → Costs → Import costs** with catalogue-editing access. Choose a version-1 `printshopledger.pricing-costs` JSON file and review each entry before saving.

New entries become private, materialless services with a template cost and zero selling price. They are available to formulas but do not appear as sellable services or create/consume stock. Amounts and purchase quantities determine the per-item rate. For example, a cost of ₦4,300 per 500 gives ₦8.60 per consumption item.

An existing active formula name is kept without changing its amount, purchase quantity, description or selling price. The review shows both the file's amount and the current amount. Reimporting the same file therefore does not duplicate or reprice matching entries. A formula name already attached to a material-linked item or an entry without a cost requires manual resolution, rather than silently relinking it.

The import saves new catalogue events together locally and queues them through the normal automatic sync path. Cloud sync still processes individual guarded events. Wait for **Saved** before importing the templates that reference these costs, so those entries also exist on the server. Do not clear pending work if a conflict occurs.

The file envelope is `{ "format": "printshopledger.pricing-costs", "version": 1, "costs": [...] }`. Each cost is `{ "description": "...", "costing": { "key": "...", "amount": 430000, "per": 500, "unit": "A4 sheets" } }`. `amount` is integer kobo; `per` is the number of consumption items covered by that cost. Optional provenance fields are not imported into catalogue records. Files are limited to 2 MB and 1–500 entries. Duplicate formula names and invalid amounts are rejected before saving.

The UI and server's existing catalogue permissions remain in force. No new database endpoint or migration is required. `tests/cost-transfer.test.mjs` and the existing desktop/mobile pricing check cover private-cost creation, keeping existing amounts, repeat imports, invalid inputs and preservation of stock/payment records.
