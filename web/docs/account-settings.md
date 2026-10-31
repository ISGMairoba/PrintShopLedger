# Account setup and payment methods

Developer: open **Business Settings → Accounts** to add or edit an account. Editing exposes the same fields as creation: name, type, branch/shared scope (when branches are enabled), opening date, opening balance/sign, and default payment-method links. Changing the opening date or balance recalculates expected balances; use **Accounts → Reconcile** for a counted difference today. Changes retain before/after history and reject stale edits.

**Business Settings → Payment methods** contains method names, accounting types, enabled state and add/remove controls. Other dropdown lists and workflow stages remain under **Dropdowns & workflow**. Each section saves independently, including when the other has unsaved edits. Existing users with dropdown-settings access retain payment-method access when older settings are upgraded; Developer can then configure the sections separately.

The main **Accounts** page retains balances, transactions, transfers, reconciliation, assigning previous payments, archive and restore. Add/Edit setup controls are no longer on that page.

Validation: targeted unit tests, rollback-only database permission/accounting checks, production build, and desktop/mobile operations browser checks.
