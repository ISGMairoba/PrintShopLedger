# Cashier Quick Start

[Manual contents](README.md) · First text draft, 15 October 2026

By the end of this guide, you will be able to sign in, record one service, take a part-payment, provide a receipt and check that the record has synced.

The instructions use the app's default labels. Your business may use different names for services, jobs and menu pages.

## 1. Sign in to the right business and user

You need the shop's business sign-in and your own staff account. First-time sign-in requires internet access.

1. Open PrintShopLedger.
2. Enter the **Business email** and **Business password**, then select **Sign in**.
3. If the app displays **Staff sign in**, check the selected **Business**, enter your **Username** and **Password**, and select **Sign in user**.
4. If business sign-in has already opened the app as the default Manager, do not continue under that identity unless it is your assigned account. Use **Switch user** to sign in as yourself.
5. Check the business name and current staff information in the sidebar. On a phone, select **Menu** to open it.

Success: you can open **Point of Service**, and the business and current user are correct.

**Try locally on this device** opens a separate trial. It is useful for practice, but records there are not uploaded to your business. Do not use the trial for a real sale.

## 2. Start a new sale

1. Open **Point of Service**.
2. Select **Add job**. The **New checkout** window opens.
3. In **Service**, select the work being sold.
4. Enter **Job description** if shown. Use a description that helps production identify the work. Whether this field is required, optional or hidden is controlled by the business.
5. Enter **Quantity**. For a size-based service, also complete the size fields shown. Use the material's configured measurement unit; do not assume the fields are in inches or metres.
6. Check the source and other job details shown. Enter a deadline if the job needs one.
7. Review the calculated amount. To include more work in the same checkout, select **Add another service** and review each line separately.

Success: the correct service, quantity, description and amount are visible before you move to payment.

Selecting a service does not always use stock. A material-linked service can deduct stock when saved; a materialless service does not. Pricing templates have their own input fields and calculated prices. Ask a supervisor if the amount or units look wrong instead of changing the quantity to force a desired price.

## 3. Select the customer

The customer field is at the top of the checkout's payment section.

1. Type a name or phone number in **Customer name or phone**.
2. Select the correct suggestion. Typing a name alone is not the same as selecting the customer.
3. Check the selected customer's details and displayed wallet credit.
4. If the customer is new, select **Add new customer**, complete the customer form and select **Save customer**. Confirm that the intended customer is selected when you return to checkout.

If a phone number is already assigned to a customer, check whether it is the same person before creating another record. Do not enter another person's phone number simply to bypass a warning.

## 4. Record only the money actually received

1. Check **Money received (₦)**. It may already contain a suggested amount; confirm it against the money actually received.
2. Enter the amount collected now, not the total order value unless the customer paid that total. Enter amounts in naira, for example `3000` for ₦3,000.
3. Select the correct **Payment method** and check **Payment date**. Add a **Reference / note** when needed to identify the payment.
4. If **Use available wallet credit when needed** is selected, review how much existing credit the checkout will use. Wallet credit is not new cash received.
5. Review **Job allocations**. Automatic allocation pays the customer's oldest unpaid jobs first, including previous orders. Money received today is not necessarily all assigned to the new job.
6. If payment must be assigned to particular jobs and your shop permits it, select **Override allocation** and review the amount against each job. Otherwise ask a supervisor before continuing.
7. Check the summary, including **Wallet used**, **Added to wallet**, **Wallet after checkout** and **Customer outstanding**.

### Worked example: a part-payment

For this example, Training Customer A has no previous debt or wallet credit. The shop has a materialless service named **DI printing — customer-supplied sheets**, priced at **₦50 per sheet**. These are training values, not recommended business prices.

| Field | Entry or expected result |
| --- | --- |
| Service | DI printing — customer-supplied sheets |
| Quantity | 100 |
| Job description | Training order — 100 customer-supplied sheets |
| New job amount | ₦5,000 |
| Customer | Training Customer A |
| Money received now | ₦3,000 |
| Payment method | Cash |
| Payment allocated to this job | ₦3,000 |
| Remaining balance on this job | ₦2,000 |
| Customer outstanding after checkout | ₦2,000 |
| Added to wallet | ₦0 |
| Shop stock deducted | None: this service has no shop material attached |

The example changes if the customer has earlier unpaid jobs, wallet credit, a discount, or a different service price. Always read your actual allocation summary.

## 5. Save the checkout once

1. Confirm the customer, work, amounts and payment method.
2. Select **Complete checkout** and wait for the result.
3. When the receipt opens, check the customer, jobs, money received and outstanding balance.

Success: the checkout has a receipt/reference and appears in the appropriate transaction list. The saved operation records the jobs, payment allocation and any stock or wallet changes together.

If there is a stock or credit-limit warning, the app may still allow saving. Check the shop's policy and ask a supervisor when approval is needed. A warning is not proof that material is physically available.

If an error or connection interruption occurs after you select Complete checkout, check **My Sales** and the pending/sync status before starting a new checkout. Re-entering the same sale as a fresh checkout can create a second record. Ask a supervisor if you cannot tell whether it saved.

## 6. Give the customer their receipt

From the receipt window, use the option you need:

- **Print receipt**: print through the configured QZ Tray printer.
- **Share**: use the device's supported sharing workflow. If the file downloads instead, attach that file in the intended app.
- **Download PDF (A4)** or **Download PDF (80mm)**: save a copy in the chosen layout.

Automatic printing depends on the device's **Print Settings**. If printing fails, reopen the saved receipt and retry printing; do not recreate the checkout. A print submission is not confirmation that paper came out of the printer.

Use **My Sales** to find your transaction and reopen its receipt. Check date and status filters if it is not visible. Pending receipts may be marked as awaiting cloud confirmation.

## 7. Check saving and sync status

The sidebar shows the connection/sync status and pending work. On a phone, open **Menu** to inspect it.

| Status | What to do |
| --- | --- |
| Saved | Changes have synced. Physical printing is a separate check. |
| Changes pending / Syncing… | Keep the browser/device available while automatic sync continues. |
| Waiting for connection / Waiting to retry | Work remains on this device; reconnect and allow automatic sync to continue. |
| Review changes | Ask an authorised supervisor to review the conflict. Do not collect the same payment again. |
| Loading / Connecting… | Wait for the workspace or initial sync; do not assume cloud confirmation yet. |

There is no manual Sync button. Do not clear site data, uninstall the app or reset the browser while business work is still pending.

## 8. Receive the remaining payment later

For the worked example, the customer returns to pay the remaining ₦2,000 and has no other unpaid jobs.

1. In **Point of Service**, select **Receive payment**. Do not add the original printing job again.
2. Select Training Customer A in **Customer name or phone**.
3. Enter **2000** in **Money received (₦)**, choose the actual payment method and check the date.
4. Check that **Job allocations** applies ₦2,000 to the outstanding printing job.
5. Check that the preview shows no remaining customer debt and no new job charge.
6. Select **Complete checkout**, provide the new payment receipt and confirm sync.

Expected result: the original job is fully paid, customer outstanding is ₦0, and no new job or additional stock consumption is created by this payment-only operation.

### What if the customer pays too much?

With no other debt or wallet balance, receiving ₦6,000 for a ₦5,000 job allocates ₦5,000 to that job and adds ₦1,000 to the customer wallet. The extra money is credit, not an increase in the job's selling price. Review **Added to wallet** before saving; do not record cash you have given back as money retained by the shop. Ask a supervisor if a recorded payment or refund needs correction.

## End-of-task checklist

- The right business, staff account and customer were used.
- The work and money received match what actually happened.
- Payment allocations and the remaining balance are correct.
- The customer has the intended receipt.
- Pending work has synced, or an authorised person knows which device still holds it.

Switching user does not itself count cash or close a drawer. Use the shop's handover procedure when another cashier takes over. Keep your staff password private.

## If something is missing or looks wrong

| Problem | First check |
| --- | --- |
| I cannot see a menu page or action | Confirm your staff identity and ask the person managing access. |
| The service is not listed | Ask a supervisor to check whether it is active and whether a linked material is available. Private costs are not sellable services. |
| The customer's new job still has a balance despite payment | Check whether automatic allocation paid older jobs first. |
| No money is being collected | Enter zero and review whether wallet credit is used. A disabled method field can show None or Wallet. |
| My receipt will not print | Confirm that the sale saved, then check printer/QZ Tray settings and retry the receipt only. |
| I entered the wrong amount or customer | Stop and ask a supervisor to use the correction workflow. Do not add an opposite or duplicate sale as a workaround. |

[Next: Owner setup checklist](owner-setup-checklist.md) · [Glossary](glossary.md)
