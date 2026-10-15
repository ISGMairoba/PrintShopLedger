# Owner setup checklist

[Manual contents](README.md) · First text draft, 15 October 2026

Use this checklist before staff begin recording live sales. Configuration may require a Developer or an authorised Manager/Admin. Missing permissions should be arranged through the person managing the business, not bypassed by sharing a privileged account.

## 1. Business and staff access

- [ ] Register the business through **Register your business**, confirm its email and complete the first sign-in/workspace setup.
- [ ] Confirm that the business name and selected workspace are correct. The first staff membership is Manager.
- [ ] Arrange the separate Developer maintenance account with the person handling setup. Its initial activation depends on server configuration; it is not another business email/password to share with cashiers.
- [ ] Create individual staff accounts through **Users**. Give each person only the rank and pages needed for their work; verify the account can sign in using username/password after business sign-in.
- [ ] Check page access and permitted Business Settings tabs. Business Settings is Developer-only by default; Admin/Manager access can be configured. Do not assume all Managers have settings access.
- [ ] Test **Switch user** and confirm the sidebar shows the receiving staff member. Treat drawer handover as a separate operation.

## 2. Business information and working rules

- [ ] Review the business profile, logo and contact details used on customer documents.
- [ ] Set the available payment methods, job sources and production workflow to match actual operations.
- [ ] Decide whether job descriptions are required, optional or hidden; choose a payment-prefill behaviour staff will understand.
- [ ] Review discount permissions and limits. Tell staff that a suggested payment is not proof of money received.
- [ ] Review terminology and appearance. If you rename pages, explain the names used by your shop to staff following this manual.

## 3. Materials and opening stock

- [ ] Add each tracked material in **Materials** with a clear name and measurement unit.
- [ ] Set **Require size** only when that material's selling/consumption rules need dimensions. Confirm the actual units staff must enter.
- [ ] Record physically checked opening quantities. Check available stock before the first live order.
- [ ] Set a minimum stock level where a low-stock alert is useful. The app warns at or below that level.
- [ ] Explain **Add to stock** versus **Edit stock**: an addition increases the existing balance; a count correction sets a checked physical balance. Use the appropriate reason/note.
- [ ] If a purchase must also appear in expenses, use the supported purchase/expense workflow. Do not record the same purchased quantity again as a second independent stock addition.

Negative stock is allowed by the application. Decide who may approve work when material is short. Stock figures do not replace a physical availability check.

## 4. Services, retail items and costs

- [ ] Add the services and retail items staff actually sell. Check their selling prices.
- [ ] Link a service to a shop material only when a sale should consume that stock. For work on customer-supplied materials, use the materialless service option when appropriate.
- [ ] Test quantity and size calculations with a small known example before staff use a service.
- [ ] Keep selling prices separate from **template costs**. A service can have a cost rate for pricing formulas and a different amount charged to customers.
- [ ] Use private costs for template-only expenses, not ordinary sellable items. Confirm they do not appear in the checkout service picker.

For the Cashier Quick Start example, the training workspace needs a materialless service **DI printing — customer-supplied sheets** priced at **₦50 per sheet**. Do not adopt that demonstration rate without setting your own business price.

## 5. Customers and starting balances

- [ ] Review customer names and phone numbers before creating duplicates.
- [ ] Choose sensible credit limits and explain who may approve credit. The app's credit-limit warning does not automatically prevent saving.
- [ ] Reconcile old debts and credits before bringing them into the app. Do not create fictitious payments or duplicate sales to force a desired balance.
- [ ] Ask the person handling migration to assign historical balances to the correct jobs before any legacy-data import.

## 6. Pricing templates, if used

- [ ] Enable pricing templates in Business Settings and allow the intended staff to open **Pricing Templates**.
- [ ] Set which ranks may see internal costs and profit. Template management and cost visibility are distinct permissions.
- [ ] Create/import definitions, match local items and review variables, computed stock quantities, expenses, profit rules and rounding.
- [ ] Test a normal order, a small order and important boundary/alternative inputs. Default-input validation does not test every possible combination.
- [ ] Compare the result with a calculation you trust, including stock units and the minimum acceptable selling price.
- [ ] Show staff how **Price & compare**, a quotation and a completed checkout differ. Calculating or saving a quotation does not deduct stock or collect payment.

See the [template transfer guide](../pricing-template-transfers.md) before importing or sharing definitions. Shared files retain fixed formula amounts and profit rules; receiving shops use their own matched catalogue costs and selling prices.

## 7. Receipts and printing devices

- [ ] On each printing computer, install/connect QZ Tray and configure **Print Settings** for the intended user/business.
- [ ] Select the printer and paper settings; check margins, copies and automatic-print preference.
- [ ] Print a test receipt. Confirm the logo, customer details, amounts, width and cut position on real paper.
- [ ] If trusted printing is required, arrange the per-business certificate/signing configuration with maintenance. Do not distribute private signing keys to cashiers.
- [ ] Test PDF download and sharing on a phone. Explain manual attachment when the device cannot share the file directly.

Printer defaults are stored for the user/business on the current device, not automatically configured on every computer. Automatic printing and server-backed signing still depend on the device's actual setup and connectivity.

## 8. Trial run and go-live

- [ ] Use a separate training workspace or local trial for practice. Do not fill the live ledger with test orders.
- [ ] Complete a sale, a partial payment and a later balance payment; check the receipts and job balances.
- [ ] Test one material-linked service and confirm the stock deduction exactly once.
- [ ] Verify that staff can locate their transaction in **My Sales** and understand the selected filters.
- [ ] Demonstrate pending work, automatic sync and **Review changes**. Assign a supervisor responsible for conflicts.
- [ ] Confirm the app shows the intended business/user, correct prices, checked stock and the expected opening customer balances before the first real sale.

## Daily control reminders

Check pending work before shutting down the device. Reconcile cash using **My Sales → Close drawer** when handing over: review expected cash, count actual cash, record any difference and have both users confirm. The receiving user signs in as part of the handover. POS/transfer and wallet usage are not physical drawer cash.

Keep a clear procedure for corrections, cancellations, returns and refunds. Cancelling a charge does not automatically return stock or hand money back to a customer. Use authorised workflows, reasons and audit records rather than deleting or recreating sales.

[Back to Cashier Quick Start](cashier-quick-start.md) · [Glossary](glossary.md)
