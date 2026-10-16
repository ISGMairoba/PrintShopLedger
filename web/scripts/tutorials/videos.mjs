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
];
