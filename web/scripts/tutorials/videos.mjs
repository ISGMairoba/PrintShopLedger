// The tutorial videos, one task each. Every step's `say` is shown as a caption and read aloud;
// `do` is what happens on screen meanwhile. The sample shop is in sample-shop.mjs.
// Video ids match the Help topics they belong to (help-content.mjs `video` fields).

const close = async ({ page, tap }) =>
  tap(page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }));

export const videos = [
  {
    id: '01-getting-started',
    title: 'Getting started',
    description: 'Signing in, finding your way around the menu, and getting help on any page.',
    startSignedOut: true,
    steps: [
      { say: 'Welcome to PrintShopLedger. This video shows how to sign in and find your way around.' },
      {
        say: 'On a new device, the business signs in once, with its email and business password.',
        do: async ({ page, type }) => {
          await type(page.getByLabel('Business email'), 'owner@example.com');
          await type(page.getByLabel('Business password'), 'password');
        },
      },
      {
        say: 'Then each staff member signs in with their own username and password, so every sale is recorded under their name.',
      },
      {
        say: 'For this tour, we will use a sample shop.',
        do: async ({ page, tap }) => {
          await page.getByLabel('Business email').fill('');
          await page.getByLabel('Business password').fill('');
          await tap(page.getByRole('button', { name: 'Try locally on this device' }));
        },
      },
      {
        say: 'The menu shows only the pages your rank can open, grouped by what they are for.',
        do: async ({ page, show }) => show(page.getByRole('navigation', { name: 'Main' }), 2500),
      },
      {
        say: 'Press the question mark beside any page title for help with that page.',
        do: async ({ page, tap }) => tap(page.getByRole('button', { name: /^Help with / })),
        min: 4,
      },
      {
        say: 'Or press Help in the menu, and search the whole guide.',
        do: async ({ page, tap, type }) => {
          await close({ page, tap });
          await tap(page.getByRole('button', { name: 'Help', exact: true }));
          await type(page.getByLabel('Search help'), 'receipt');
          await tap(page.getByRole('dialog', { name: 'Help' }).getByRole('button', { name: /^Receipts/ }));
        },
        min: 5,
      },
      {
        say: 'If nobody uses the app for a while, it locks itself. Just sign in again: your work is kept.',
        do: async ({ page, tap }) => close({ page, tap }),
      },
    ],
  },
  {
    id: '02-taking-a-job',
    title: 'Taking a job at Point of Service',
    description: 'Adding a job, choosing the customer, taking the payment and printing the receipt.',
    steps: [
      {
        say: 'To take a job, open Point of Service and press Add job.',
        do: async ({ page, nav, tap }) => {
          await nav('Point of Service');
          await tap(page.getByRole('button', { name: 'Add job', exact: true }));
        },
      },
      {
        say: 'Choose the service, and enter how many.',
        do: async ({ page, choose, type }) => {
          const line = page.getByRole('dialog', { name: 'New checkout' }).locator('.cart-line').first();
          await choose(line.getByLabel('Service', { exact: true }), 'A4 printing (colour)');
          await type(line.getByLabel('Quantity', { exact: true }), '20');
        },
      },
      {
        say: 'Add a short description, so the team knows what to make.',
        do: async ({ page, type }) => {
          const line = page.getByRole('dialog', { name: 'New checkout' }).locator('.cart-line').first();
          await type(line.getByLabel('Job description'), 'Event flyers');
        },
      },
      {
        say: 'Under Payment, find the customer by name or phone number.',
        do: async ({ page, type, tap }) => {
          const d = page.getByRole('dialog', { name: 'New checkout' });
          await type(d.getByRole('combobox', { name: 'Customer name or phone' }), 'Bello');
          await tap(d.getByRole('listbox', { name: 'Customer suggestions' }).getByRole('option').first());
        },
      },
      {
        say: 'Enter the money received. It can be nothing, part, or all of the total.',
        do: async ({ page, type, show }) => {
          const d = page.getByRole('dialog', { name: 'New checkout' });
          await type(d.getByLabel('Money received (₦)'), '3000');
          await show(d.locator('.cart-total'));
        },
      },
      {
        say: 'Press Complete checkout. The receipt opens, ready to print or share.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog', { name: 'New checkout' })
              .getByRole('button', { name: 'Complete checkout' }),
          ),
        min: 4,
      },
      { say: 'The job is now on the Jobs page, ready to be made.', do: async (h) => close(h) },
    ],
  },
  {
    id: '03-quick-sale',
    title: 'Quick sale',
    description: 'Selling shelf items in a few taps, including colours, pack prices and change.',
    steps: [
      {
        say: 'For items off the shelf, use Quick sale on Point of Service.',
        do: async ({ page, nav, tap }) => {
          await nav('Point of Service');
          await tap(page.getByRole('button', { name: 'Quick sale', exact: true }));
        },
      },
      {
        say: 'Tap a product to add it to the sale.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog', { name: 'Quick sale' })
              .locator('.quick-product', { hasText: 'Art card' }),
          ),
      },
      {
        say: 'For a product in colours, tap the colour. Each button shows how many are left.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog', { name: 'Quick sale' })
              .getByRole('button', { name: /^Add Envelope — Blue/ }),
          ),
      },
      {
        say: 'Type the quantity. Full packs are charged at the pack price, and the rest one by one.',
        do: async ({ page, type, show }) => {
          const q = page.getByRole('dialog', { name: 'Quick sale' });
          await type(q.getByRole('spinbutton', { name: 'Quantity of Envelope — Blue' }), '30');
          await show(q.locator('.quick-cart tr', { hasText: 'Envelope' }), 2000);
        },
        min: 5,
      },
      {
        say: 'Enter the money received. The change to give shows under the total.',
        do: async ({ page, type, show }) => {
          const q = page.getByRole('dialog', { name: 'Quick sale' });
          await type(q.getByLabel('Money received (₦)'), '3000');
          await show(q.locator('.cart-total'), 1800);
        },
      },
      {
        say: 'Press Complete sale. Stock goes down, and the receipt opens.',
        do: async ({ page, tap }) =>
          tap(
            page.getByRole('dialog', { name: 'Quick sale' }).getByRole('button', { name: /^Complete sale/ }),
          ),
        min: 4,
      },
      {
        say: 'Walk-in sales are paid in full. To let a customer owe, choose them instead of Walk-in customer.',
        do: async (h) => close(h),
      },
    ],
  },
  {
    id: '04-taking-a-payment',
    title: 'Taking a payment for earlier jobs',
    description: 'Recording money from a customer who owes, and how it is shared across their jobs.',
    steps: [
      {
        say: 'When a customer pays for earlier jobs, press Receive payment on Point of Service.',
        do: async ({ page, nav, tap }) => {
          await nav('Point of Service');
          await tap(page.getByRole('button', { name: 'Receive payment', exact: true }));
        },
      },
      {
        say: 'Find the customer. Their unpaid balance shows straight away.',
        do: async ({ page, type, tap }) => {
          const d = page.getByRole('dialog', { name: 'Receive payment' });
          await type(d.getByRole('combobox', { name: 'Customer name or phone' }), 'Ada');
          await tap(d.getByRole('listbox', { name: 'Customer suggestions' }).getByRole('option').first());
        },
        min: 4,
      },
      {
        say: 'Enter the amount and how it was paid.',
        do: async ({ page, type, show }) => {
          const d = page.getByRole('dialog', { name: 'Receive payment' });
          await type(d.getByLabel('Money received (₦)'), '10000');
          await show(d.getByLabel('Payment method').last());
        },
      },
      {
        say: 'The money goes to the oldest unpaid jobs first. Any extra is kept as credit for next time.',
        do: async ({ page, show }) =>
          show(page.getByRole('dialog', { name: 'Receive payment' }).locator('.allocation-heading'), 2500),
        min: 5,
      },
      {
        say: 'Press Complete checkout, and give the customer the receipt.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog', { name: 'Receive payment' })
              .getByRole('button', { name: 'Complete checkout' }),
          ),
        min: 4,
      },
      { say: 'That is it. The jobs now show as paid.', do: async (h) => close(h) },
    ],
  },
  {
    id: '05-receipts',
    title: 'Receipts: print, PDF and share',
    description: 'Printing, downloading and sharing a receipt, and finding an older one.',
    // A sale today, so My Sales has one to show.
    setup: async ({ page }) => {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Point of Service', exact: true })
        .click();
      await page.getByRole('button', { name: 'Quick sale', exact: true }).click();
      const q = page.getByRole('dialog', { name: 'Quick sale' });
      await q.locator('.quick-product', { hasText: 'Art card' }).click();
      await q.getByRole('button', { name: /^Complete sale/ }).click();
      await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Dashboard', exact: true })
        .click();
    },
    steps: [
      {
        say: 'Every sale opens its receipt. To find an older one, open My Sales.',
        do: async ({ nav }) => nav('My Sales'),
      },
      {
        say: 'Press Receipt next to the sale.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('main')
              .getByRole('button', { name: /Receipt/ })
              .first(),
          ),
        min: 3.5,
      },
      {
        say: 'Print receipt sends it to the shop printer.',
        do: async ({ page, show }) =>
          show(
            page
              .getByRole('dialog')
              .last()
              .getByRole('button', { name: /Print receipt/ }),
          ),
      },
      {
        say: 'Share sends it straight to the customer, for example on WhatsApp.',
        do: async ({ page, show }) =>
          show(page.getByRole('dialog').last().getByRole('button', { name: /Share/ })),
      },
      {
        say: 'Or download it as a PDF, in A4 or receipt-roll size.',
        do: async ({ page, show }) => {
          const r = page.getByRole('dialog').last();
          await show(r.getByRole('button', { name: 'Download PDF (A4)' }), 1000);
          await show(r.getByRole('button', { name: 'Download PDF (80mm)' }), 1000);
        },
      },
      {
        say: 'The logo and what shows on receipts are set by the manager, in Business Settings.',
        do: async (h) => close(h),
      },
    ],
  },
  {
    id: '06-discounts',
    title: 'Giving a discount',
    description: 'Taking a percentage or an amount off a sale, with a reason.',
    steps: [
      {
        say: 'You can give a discount in Quick sale, or on a job in a checkout.',
        do: async ({ page, nav, tap }) => {
          await nav('Point of Service');
          await tap(page.getByRole('button', { name: 'Quick sale', exact: true }));
          const q = page.getByRole('dialog', { name: 'Quick sale' });
          await tap(q.locator('.quick-product', { hasText: 'Ballpoint pen' }));
          await tap(q.locator('.quick-product', { hasText: 'Ballpoint pen' }));
        },
      },
      {
        say: 'Under Discount, choose a percentage or an amount.',
        do: async ({ page, choose }) =>
          choose(
            page.getByRole('dialog', { name: 'Quick sale' }).getByLabel('Discount', { exact: true }),
            'Percentage',
          ),
      },
      {
        say: 'Enter the discount, and a short reason.',
        do: async ({ page, type }) => {
          const q = page.getByRole('dialog', { name: 'Quick sale' });
          await type(q.getByLabel('Discount percentage'), '10');
          await type(q.getByLabel('Discount reason'), 'Regular customer');
        },
      },
      {
        say: 'The total shows the price before the discount, and how much was taken off.',
        do: async ({ page, show }) =>
          show(page.getByRole('dialog', { name: 'Quick sale' }).locator('.cart-total'), 2500),
      },
      {
        say: 'Each rank has a highest discount it may give. The manager sets it in Business Settings.',
        do: async (h) => close(h),
      },
    ],
  },
  {
    id: '07-working-offline',
    title: 'Working offline',
    description: 'Selling without a connection, and how the app catches up when it is back.',
    steps: [
      {
        say: 'The top of the menu shows whether you are online, and how many changes are waiting to upload.',
        do: async ({ page, show }) => show(page.getByText(/· \d+ pending changes/).first(), 2000),
      },
      {
        say: 'If the connection drops, keep working as usual.',
        do: async ({ page, context, show }) => {
          await context.setOffline(true);
          await page.waitForTimeout(800);
          await show(page.getByText(/Offline · /).first(), 1500);
        },
      },
      {
        say: 'Sales, payments and jobs are saved on this device.',
        do: async ({ page, nav, tap, type }) => {
          await nav('Point of Service');
          await tap(page.getByRole('button', { name: 'Quick sale', exact: true }));
          const q = page.getByRole('dialog', { name: 'Quick sale' });
          await tap(q.locator('.quick-product', { hasText: 'Art card' }));
          await tap(q.getByRole('button', { name: /^Complete sale/ }));
        },
        min: 4,
      },
      {
        say: 'When the connection returns, the changes upload by themselves.',
        do: async ({ page, context, tap }) => {
          await close({ page, tap });
          await context.setOffline(false);
          await page.waitForTimeout(800);
        },
      },
      {
        say: 'Do not clear the browser or sign out the business while changes are waiting, or they would be lost.',
        do: async ({ page, show }) => show(page.getByText(/· \d+ pending changes/).first(), 2000),
      },
    ],
  },
  {
    id: '08-job-stages',
    title: 'Moving jobs through their stages',
    description:
      'Moving a job from Added to In Queue, Printing and Completed, so everyone knows where it is.',
    steps: [
      {
        say: 'Open Jobs to see every job, its stage, its deadline and what it still owes.',
        do: async ({ nav, page, show }) => {
          await nav('Jobs');
          await show(page.getByRole('main').locator('table').first(), 1500);
        },
      },
      {
        say: 'Press Next to move a job to its next stage, then confirm.',
        do: async ({ page, tap }) => {
          await tap(
            page
              .getByRole('main')
              .getByRole('button', { name: /^Next: / })
              .first(),
          );
          await tap(page.getByRole('dialog').last().getByRole('button', { name: 'Confirm next action' }));
        },
        min: 4,
      },
      {
        say: 'Set Action jumps to any later stage, such as Printing.',
        do: async ({ page, tap, choose }) => {
          await tap(
            page
              .getByRole('main')
              .getByRole('button', { name: /Set Action/ })
              .first(),
          );
          const d = page.getByRole('dialog').last();
          await choose(d.locator('select'), 'Printing');
          await tap(d.getByRole('button', { name: 'Set action' }));
        },
        min: 4.5,
      },
      {
        say: 'When the work is done, press Mark as Complete.',
        do: async ({ page, tap }) => {
          await tap(
            page
              .getByRole('main')
              .getByRole('button', { name: /Mark as Complete/ })
              .first(),
          );
          await tap(page.getByRole('dialog').last().getByRole('button', { name: 'Mark as Complete' }));
        },
        min: 4,
      },
      {
        say: 'Each stage is recorded, with who moved it and when. Collected is recorded when the customer picks it up.',
        do: async ({ page, show }) => show(page.getByRole('main').locator('table').first(), 1500),
      },
    ],
  },
  {
    id: '09-customers',
    title: 'Customers, credit and reminders',
    description: 'Adding a customer with a credit limit, and reminding customers who owe.',
    steps: [
      {
        say: 'Open Customers and press Add customer.',
        do: async ({ nav, page, tap }) => {
          await nav('Customers');
          await tap(page.getByRole('button', { name: 'Add customer', exact: true }));
        },
      },
      {
        say: 'Enter the full name and phone number. Each phone number belongs to one customer.',
        do: async ({ page, type }) => {
          const d = page.getByRole('dialog', { name: 'Add customer' });
          await type(d.getByLabel('Full name'), 'Grace Bakery');
          await type(d.getByLabel('Phone number'), '08051112233');
        },
      },
      {
        say: 'A credit limit lets them owe up to that amount. Leave it at zero for pay-now customers.',
        do: async ({ page, type, tap }) => {
          const d = page.getByRole('dialog', { name: 'Add customer' });
          await type(d.getByLabel('Credit limit (₦)'), '20000');
          await tap(d.getByRole('button', { name: /Save customer/ }));
        },
        min: 4,
      },
      {
        say: 'Payment Reminders lists everyone who owes, oldest first.',
        do: async ({ nav }) => nav('Payment Reminders'),
      },
      {
        say: 'Remind sends a friendly WhatsApp message with their statement attached.',
        do: async ({ page, show }) =>
          show(
            page
              .getByRole('main')
              .getByRole('button', { name: /Remind/ })
              .first(),
            2000,
          ),
      },
    ],
  },
  {
    id: '10-expenses',
    title: 'Recording expenses',
    description: 'Recording money the business spends, paid now or later.',
    steps: [
      {
        say: 'Open Expenses and press Add expense.',
        do: async ({ nav, page, tap }) => {
          await nav('Expenses');
          await tap(page.getByRole('button', { name: 'Add expense', exact: true }));
        },
      },
      {
        say: 'Describe it, and enter the total cost and who it was paid to.',
        do: async ({ page, type }) => {
          const d = page.getByRole('dialog', { name: 'Add expense' });
          await type(d.getByLabel('Description', { exact: true }), 'Printer ink');
          await type(d.getByLabel('Total cost (₦)'), '25000');
          await type(d.getByLabel('Supplier / paid to'), 'Ink supplier');
        },
        min: 4,
      },
      {
        say: 'If you paid now, tick Record money paid now and enter the amount.',
        do: async ({ page, tap, type }) => {
          const d = page.getByRole('dialog', { name: 'Add expense' });
          await tap(d.getByRole('checkbox', { name: /Record money paid now/ }));
          await type(d.getByLabel('Amount paid (₦)'), '25000');
        },
      },
      {
        say: 'Press Save expense. Reports now show sales less expenses.',
        do: async ({ page, tap }) =>
          tap(
            page.getByRole('dialog', { name: 'Add expense' }).getByRole('button', { name: /Save expense/ }),
          ),
        min: 3.5,
      },
      {
        say: 'An expense paid later gets Record payment. A mistake is voided, never deleted.',
        do: async ({ page, show }) => show(page.getByRole('main').locator('table').first(), 1500),
      },
    ],
  },
  {
    id: '11-restocking',
    title: 'Restocking and counting stock',
    description:
      'Adding new stock when it arrives, setting the count after a stock-take, and the stock history.',
    steps: [
      {
        say: 'Open Materials. Each stock item shows what is available, and its minimum.',
        do: async ({ nav, page, show }) => {
          await nav('Materials');
          await show(page.getByRole('row', { name: /A4 paper/ }).first(), 1500);
        },
      },
      {
        say: 'When stock arrives, press Add to stock, enter the quantity and a note.',
        do: async ({ page, tap, type }) => {
          await tap(
            page
              .getByRole('row', { name: /A4 paper/ })
              .first()
              .getByRole('button', { name: /Add to stock/ }),
          );
          const d = page.getByRole('dialog').last();
          await type(d.getByLabel('Quantity to add'), '500');
          await type(d.locator('[name=reason]'), 'Delivery from supplier');
          await tap(d.getByRole('button', { name: 'Add to stock' }));
        },
        min: 5,
      },
      {
        say: 'After counting the shelf, press Set quantity and enter the number you counted.',
        do: async ({ page, tap, type }) => {
          await tap(
            page
              .getByRole('row', { name: /A4 paper/ })
              .first()
              .getByRole('button', { name: /Set quantity/ }),
          );
          const d = page.getByRole('dialog').last();
          await type(d.getByLabel('New available quantity'), '2480');
          await type(d.locator('[name=reason]'), 'Monthly count');
          await tap(d.getByRole('button', { name: 'Set quantity' }));
        },
        min: 5,
      },
      {
        say: 'Stock History shows every change: before, after, who and why.',
        do: async ({ nav, page, show }) => {
          await nav('Stock History');
          await show(page.getByRole('main').locator('table').first(), 1800);
        },
      },
    ],
  },
  {
    id: '12-waste',
    title: 'Waste, damage and reprints',
    description: 'Recording spoilt stock or a reprint, so stock levels and reports stay right.',
    steps: [
      {
        say: 'Spoilt work and reprints use stock too. Open Materials, then Waste and reprints.',
        do: async ({ nav, page, tap }) => {
          await nav('Materials');
          await tap(page.getByRole('main').getByRole('tab', { name: /Waste/ }));
        },
      },
      {
        say: 'Press Record material waste, and choose the stock item and the type.',
        do: async ({ page, tap, choose }) => {
          await tap(page.getByRole('button', { name: /Record material waste/ }).first());
          const d = page.getByRole('dialog').last();
          await choose(d.getByLabel('Material', { exact: true }), 'A4 paper');
          await choose(d.getByLabel('Type'), 'Reprint');
        },
        min: 4,
      },
      {
        say: 'Enter how much extra was used, link the job if it was a reprint, and give the reason.',
        do: async ({ page, type, choose }) => {
          const d = page.getByRole('dialog').last();
          await type(d.getByLabel(/Additional quantity used/), '10');
          await choose(d.getByLabel(/Related job/), 'Course notes');
          await type(d.getByLabel('Reason'), 'Pages printed too light');
        },
        min: 5,
      },
      {
        say: 'The stock after saving shows before you save. Press Approve and save waste.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog')
              .last()
              .getByRole('button', { name: /Approve and save waste/ }),
          ),
        min: 4,
      },
    ],
  },
  {
    id: '13-editing-products',
    title: 'Editing a product',
    description: 'Changing a product’s price, unit and pack prices, and restocking it, in one place.',
    steps: [
      {
        say: 'To change a product, open Edit Products and press Edit.',
        do: async ({ nav, page, tap }) => {
          await nav('Edit Products');
          await tap(
            page
              .getByRole('row', { name: /Ballpoint pen/ })
              .first()
              .getByRole('button', { name: /^Edit$/ }),
          );
        },
      },
      {
        say: 'Change the price, the unit, or the pack prices here.',
        do: async ({ page, type }) =>
          type(page.getByRole('dialog').last().getByLabel('Price', { exact: true }), '160'),
      },
      {
        say: 'You can restock it at the same time: choose Add stock, enter the quantity and a reason.',
        do: async ({ page, choose, type }) => {
          const d = page.getByRole('dialog').last();
          await choose(d.getByLabel('Stock change'), 'Add stock');
          await type(d.getByLabel('Quantity to add'), '100');
          await type(d.getByLabel('Reason'), 'New carton');
        },
        min: 5,
      },
      {
        say: 'The box at the bottom shows exactly what will change. Then press Save changes.',
        do: async ({ page, show, tap }) => {
          const d = page.getByRole('dialog').last();
          await show(d.getByRole('status').filter({ hasText: 'This will' }), 2000);
          await tap(d.getByRole('button', { name: /Save changes/ }));
        },
        min: 5,
      },
      {
        say: 'For a product in colours, the price and unit change for every colour, and stock for the one you opened.',
        do: async (h) => close(h),
      },
    ],
  },
  {
    id: '14-adding-products',
    title: 'Adding a product with colours and pack prices',
    description: 'Adding a shelf product that comes in colours, with a pack price.',
    steps: [
      {
        say: 'To add a product, open Services and press Add product.',
        do: async ({ nav, page, tap }) => {
          await nav('Services');
          await tap(page.getByRole('button', { name: 'Add product', exact: true }));
        },
      },
      {
        say: 'Enter the name and the single price.',
        do: async ({ page, type }) => {
          const d = page.getByRole('dialog', { name: 'Add product' });
          await type(d.locator('input[name=name]'), 'Exercise book');
          await type(d.getByRole('textbox', { name: 'Price (₦)' }).first(), '300');
        },
      },
      {
        say: 'If it comes in colours, tick Comes in variants, and add each colour with its opening stock.',
        do: async ({ page, tap, type }) => {
          const d = page.getByRole('dialog', { name: 'Add product' });
          await tap(d.getByRole('checkbox', { name: /Comes in variants/ }));
          await type(d.getByLabel('Variant 1 name'), 'Red');
          await type(d.getByLabel('Variant 1 opening stock'), '100');
          await type(d.getByLabel('Variant 2 name'), 'Green');
          await type(d.getByLabel('Variant 2 opening stock'), '80');
        },
        min: 6,
      },
      {
        say: 'For a pack price, press Add pack price, and enter the pack size and its price.',
        do: async ({ page, tap, type }) => {
          const d = page.getByRole('dialog', { name: 'Add product' });
          await tap(d.getByRole('button', { name: /Add pack price/ }));
          const packs = d.getByRole('group', { name: /Pack prices/ });
          await type(packs.getByLabel(/Pack of/).first(), '10');
          await type(packs.getByRole('textbox', { name: /Price/ }).first(), '2500');
        },
        min: 5,
      },
      {
        say: 'Press Save product. Each colour keeps its own stock, and colours never make up a pack together.',
        do: async ({ page, tap }) =>
          tap(
            page.getByRole('dialog', { name: 'Add product' }).getByRole('button', { name: /Save product/ }),
          ),
        min: 4,
      },
    ],
  },
  {
    id: '15-dashboard',
    title: 'Reading the Dashboard',
    description: 'Sales, money collected, expenses and what is owed, for any period.',
    steps: [
      {
        say: 'The Dashboard shows how the business is doing. Choose the period at the top.',
        do: async ({ nav, page, choose }) => {
          await nav('Dashboard');
          await choose(page.getByLabel('Period').first(), 'This month');
        },
      },
      {
        say: 'Sales value is the work sold. Net collected is the money received, less refunds.',
        do: async ({ page, show }) => show(page.getByRole('main').getByText('Sales value').first(), 1800),
      },
      {
        say: 'Further down, the daily trend compares sales and collections day by day.',
        do: async ({ page, show }) => show(page.getByRole('main').getByText('Daily trend').first(), 1800),
      },
      {
        say: 'Current position shows what customers owe and unpaid expenses, across all dates.',
        do: async ({ page, show }) =>
          show(page.getByRole('main').getByText('Current position').first(), 1800),
      },
      {
        say: 'The charts show top services, payment methods, top customers, and stock running low.',
        do: async ({ page, show }) => show(page.getByRole('main').getByText('Top 5 services').first(), 2200),
      },
    ],
  },
  {
    id: '16-reports',
    title: 'Reports and customer statements',
    description: 'Customer statements, transactions and summaries, ready to share or download.',
    steps: [
      {
        say: 'Reports gives customer statements, transactions and summaries.',
        do: async ({ nav }) => nav('Reports'),
      },
      {
        say: 'For a statement, type the customer’s name or phone number and choose them.',
        do: async ({ page, type, tap }) => {
          await type(page.getByRole('main').getByPlaceholder('Type a name or phone number'), 'Ada');
          await tap(page.getByRole('main').getByRole('option').first());
        },
        min: 4,
      },
      {
        say: 'The statement lists their jobs, payments and balance. Share it, or download a PDF or spreadsheet.',
        do: async ({ page, show }) =>
          show(page.getByRole('main').getByRole('button', { name: /Share/ }).first(), 2200),
        min: 4,
      },
      {
        say: 'Transactions lists every sale and payment in the period.',
        do: async ({ page, tap }) => tap(page.getByRole('main').getByRole('tab', { name: 'Transactions' })),
      },
      {
        say: 'Summary adds it all up, ready for your records.',
        do: async ({ page, tap }) => tap(page.getByRole('main').getByRole('tab', { name: 'Summary' })),
      },
    ],
  },
  {
    id: '17-quotations',
    title: 'Quotations',
    description: 'Giving a customer a price, and turning it into a job when they agree.',
    steps: [
      {
        say: 'A quotation gives a customer a price without selling. Open Quotations and press New quotation.',
        do: async ({ nav, page, tap }) => {
          await nav('Quotations');
          await tap(page.getByRole('button', { name: 'New quotation', exact: true }));
        },
      },
      {
        say: 'Type the customer’s name. They do not need to be a saved customer yet.',
        do: async ({ page, type }) =>
          type(
            page.getByRole('dialog', { name: 'New quotation' }).getByRole('combobox', { name: 'Customer' }),
            'Chika Events',
          ),
      },
      {
        say: 'Add the items, as in a checkout.',
        do: async ({ page, choose, type }) => {
          const d = page.getByRole('dialog', { name: 'New quotation' });
          await choose(d.getByLabel('Service', { exact: true }).first(), 'A4 printing (colour)');
          await type(d.getByLabel('Quantity', { exact: true }).first(), '200');
        },
        min: 4,
      },
      {
        say: 'Press Save quotation, then share or print it.',
        do: async ({ page, tap }) =>
          tap(
            page
              .getByRole('dialog', { name: 'New quotation' })
              .getByRole('button', { name: /Save quotation/ }),
          ),
        min: 4,
      },
      {
        say: 'When they agree, press Create job. A checkout opens at today’s prices.',
        do: async ({ page, show }) => {
          if (await page.getByRole('dialog').count()) await close({ page, tap: async (l) => l.click() });
          await show(
            page
              .getByRole('main')
              .getByRole('button', { name: /Create job/ })
              .first(),
            2000,
          );
        },
      },
    ],
  },
  {
    id: '18-business-settings',
    title: 'Business Settings tour',
    description: 'Business details and logo, receipts, words and limits, and the auto-lock.',
    steps: [
      {
        say: 'Business Settings is where a manager sets up the shop. Profile and logo holds your details and logos.',
        do: async ({ nav, page, show }) => {
          await nav('Business Settings');
          await show(page.getByRole('main').getByLabel('Business name'), 1500);
        },
      },
      {
        say: 'Receipts chooses what shows on receipt-printer and full-page receipts, with a live preview.',
        do: async ({ page, tap }) => tap(page.getByRole('main').getByRole('tab', { name: 'Receipts' })),
        min: 4,
      },
      {
        say: 'Jobs and payments sets your own words, deadlines and the highest discount for each rank.',
        do: async ({ page, tap }) =>
          tap(page.getByRole('main').getByRole('tab', { name: 'Jobs & payments' })),
        min: 4,
      },
      {
        say: 'Dropdowns and workflow sets the lists staff choose from, such as payment methods.',
        do: async ({ page, tap }) =>
          tap(page.getByRole('main').getByRole('tab', { name: 'Dropdowns & workflow' })),
      },
      {
        say: 'Security locks the app after a few minutes without use, so nobody sells under your name.',
        do: async ({ page, tap, choose }) => {
          await tap(page.getByRole('main').getByRole('tab', { name: 'Security' }));
          await choose(page.getByLabel('Lock the app after'), '10 minutes');
        },
        min: 4.5,
      },
      { say: 'Each section has its own Save button.' },
    ],
  },
  {
    id: '19-page-access',
    title: 'Ranks and page access',
    description: 'Choosing which pages Cashier, Admin and Manager can open.',
    steps: [
      {
        say: 'Staff ranks, from lowest, are Cashier, Admin, Manager and Developer.',
        do: async ({ nav }) => nav('Business Settings'),
      },
      {
        say: 'The Developer chooses which pages each rank can open, under Page access.',
        do: async ({ page, tap }) => tap(page.getByRole('main').getByRole('tab', { name: 'Page access' })),
        min: 4,
      },
      {
        say: 'Tick or untick a page for each rank. A cashier may only need Point of Service, My Sales and Customers.',
        do: async ({ page, show }) => show(page.getByRole('main').locator('table').first(), 2500),
        min: 5,
      },
      {
        say: 'Below, choose which Business Settings tabs Admin and Manager may change. Then save.',
        do: async ({ page, show }) => show(page.getByRole('main').locator('table').last(), 2000),
      },
      { say: 'Staff accounts themselves are added on the Users page, in a signed-in business.' },
    ],
  },
];
