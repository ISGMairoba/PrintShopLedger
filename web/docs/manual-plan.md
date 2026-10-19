# PrintShopLedger app manual — plan

Status: planning draft, 15 October 2026. The finished manual will describe the released app; this outline is not a claim that every workflow has been documented or visually verified.

## Draft now available

The [manual contents](manual/README.md) links the first text drafts of Cashier Quick Start, the owner setup checklist and the glossary. Default labels were checked against release `7b4ea3c`; `tests/manual-examples.test.mjs` checks the part-payment, balance-payment, overpayment and markup/margin examples against application rules. Screenshots, first-time-user testing, remaining chapters and the printable edition are still pending.

## Purpose and delivery

Help a new cashier complete a sale and recover from common problems, then help an owner configure and supervise the shop. Write in plain English with short actions, actual button names, NGN examples and mobile-first screenshots. Use one fictional shop and customers throughout; no live business records, credentials or personal contact details.

Maintain source chapters in this repository under `web/docs/manual/`. Start with Markdown so instructions can change alongside features. After the content and screenshots are verified, prepare a printable PDF and decide whether to expose the same chapters through an in-app Help menu. PDF and Help are planned deliverables, not implemented in this change. Consider Hausa explanations or a glossary after the English edition is reviewed.

## Reader paths

| Reader | First useful task | Sections to prioritise |
| --- | --- | --- |
| Cashier | Sell a service, record payment and provide a receipt | Quick start, selling, payments, My Sales, handover, offline work |
| Production staff | Find a job and advance its stage | Jobs, batch actions, completed vs collected |
| Admin / Manager | Maintain catalogue and supervise balances | Stock, customers, expenses, quotations, reports, corrections |
| Developer / maintenance | Set up a business and resolve deployment/access issues | Access, settings, printer trust, registration, sync review |

Explain that actual page visibility follows the business's configured permissions. A role name alone does not guarantee access to every chapter's actions.

## Proposed chapter order

| Chapter | Task and examples | Source/screens to verify |
| --- | --- | --- |
| 1. Quick start | Business sign-in → staff sign-in → first service sale → partial payment → receipt → confirm synced | AuthScreens, PointOfServicePage, CheckoutEditor, ReceiptView |
| 2. Find your way | Mobile menu, filters, sorting, search, action icons, modal close, status messages | Sidebar, ResponsiveTable, PeriodFilter, ToolbarActions |
| 3. Selling | Retail item vs service, quantity/size, materialless work, customer selection/creation, quick sale, discount | ServicesPage, ProductEditor, QuickSale, CheckoutEditor |
| 4. Customers and payments | Job-level allocation, part-payment, wallet credit, outstanding balance, credit-limit warning, statements/reminders | CustomersPage, CustomerAccount, CheckoutEditor, RemindersPage |
| 5. Jobs and production | Added → In Queue → Printing → Completed → Collected; grouped checkouts and selected visible items | JobsPaymentsPage, JobDetails, job-progress, job-batches |
| 6. My Sales and handover | Own receipts, expected/count cash, discrepancy, incoming user confirmation, refund effect | MySalesPage, close-drawer function |
| 7. Materials and stock | Unit selection, size-required material, restock, physical count, minimum level, history, waste and reprint | MaterialsPage, StockHistoryPage, MaterialWastePage |
| 8. Services and retail | Catalogue editing, archive, selling price vs template cost, private cost | ServicesPage, ProductEditor, EditProductsPage |
| 9. Quotations | Draft/send, expiry, current-price review and conversion to a sale | QuotationsPage, quotations rules, CheckoutEditor |
| 10. Pricing templates | Variables, computed quantities, expenses, cost sources, markup/margin, floors, rounding, compare options, transfers | PricingTemplatesPage, PricingTemplatesEditor, TemplateFields, TemplateTransfer |
| 11. Expenses and corrections | Purchases/stock, partial expense payments, void; correct/cancel job, credit and separate refund | ExpensesPage, SaleAdjustmentsPage, customer account |
| 12. Dashboard and Reports | Date basis, sales vs money collected, expenses vs payments, chart controls, customer filters and exports | DashboardPage, ReportsPage, InteractiveCharts |
| 13. Settings and accounts | Business registration, staff ranks/access, credential reset, branding, terminology, per-rank tabs | BusinessRegistration, UsersPage, AccountPage, BusinessSettingsPage |
| 14. Printing and sharing | QZ setup, paper/margins, test print, trusted certificate, print retry and mobile document sharing | PrintSettingsPage, printing, share-pdf, receipt-pdf |
| 15. Offline and recovery | Saved/pending/syncing/review states, reconnect, conflict review, safe user switching, clearing data | useAutoSync, useSyncConflicts, ConflictInbox, storage/cloud |
| Appendix | Glossary, icons, keyboard/mobile tips, troubleshooting, limits and release notes | Current app labels and verified workflows |

## Standard chapter format

Each chapter should include: what the task achieves; required access/connection; numbered actions; a worked example; the visible success result; what changes in jobs/money/stock; and recovery from the two or three errors users are likely to encounter. Link related tasks instead of duplicating full instructions.

For money examples, show the before and after balances explicitly. Use a book order to connect retail art card, materialless DI/binding work, paper consumption, pricing, quotation and checkout. Use a separate T-shirt example for print areas/ratios and a simple retail item example for quick sale. State clearly when an action only calculates a price, saves a quotation, or posts an actual sale.

## Glossary to establish first

| Term | Meaning to explain |
| --- | --- |
| Job | An individual charge/order item with its own production state and payment balance |
| Checkout | A recorded selling/payment operation that may contain several jobs |
| Allocation | The part of a payment assigned to a particular job |
| Wallet / credit | Money held on the customer's account for later use or eligible refund |
| Stock / material | A tracked physical item consumed or adjusted in its measurement unit |
| Service / retail item | A sellable catalogue entry, optionally linked to stock |
| Template cost / selling price | Input expense rate versus what the shop charges; these can differ |
| Markup / margin | Profit as a percentage of cost versus profit as a percentage of selling price |
| Completed / collected | Production finished versus customer has taken delivery |
| Pending / review | Saved locally awaiting sync versus a change that needs a decision |

## Writing and review milestones

1. **Confirm labels and capture checklist.** Walk the released build with fictional data. Record the exact release commit and pages visible for each role. Resolve terminology discrepancies before writing.
2. **Cashier quick start.** Draft chapters 1–4 and 6 with mobile screenshots. Have a first-time user perform a sale, partial payment, wallet use and handover using only the draft. Record confusion and revise.
3. **Owner workflows.** Draft stock, catalogue, quotations, pricing templates and expenses. Verify the book example's formula results, stock deductions and outstanding balance against automated fixtures.
4. **Supervision and recovery.** Draft corrections/refunds, Reports, permissions, print setup and offline/conflict troubleshooting. Test each action with the intended rank and required connection.
5. **Publication review.** Check every button label, screenshot, internal link, currency example and limitation. Add a release/version note, then produce the first PDF and decide the Help entry point.

## Screenshot and acceptance checklist

- Capture 390 px phone layouts and a desktop view only where the layout materially differs. Include light/dark examples without doubling every image.
- Capture sign-in, checkout/payment allocation, receipt, job stages, stock adjustment, template mapping/preview and conflict review. Highlight one action per image; add meaningful alt text.
- Use demo data and clearly distinguish fictional screenshots from real operational advice. Never capture activation links, passwords, private keys or actual customer details.
- Follow each procedure from a fresh appropriate session; verify the visible result and the effects on money/stock. Confirm permission-denied and offline recovery instructions too.
- Have someone unfamiliar with the app complete the quick-start tasks without verbal help. Treat unfinished or confusing steps as manual defects.
- Keep screenshots associated with their source chapter and captured release. When UI or business rules change, update affected chapters/screenshots in the same pull request.

## Next writing deliverable

Review the available Cashier Quick Start, owner setup checklist and glossary with a first-time user. Capture verified screenshots using fictional data, then draft **Finding your way**, **Jobs and production**, and **My Sales and drawer handover**. Keep the printable edition until the core wording and workflows have been reviewed. No user credentials are needed to draft fictional examples.
