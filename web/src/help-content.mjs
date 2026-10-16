// The user manual shown in the app's Help panel. Written for any business using the app, with
// the app's default page names; the panel passes every line through the business's own words
// (Jobs may read Orders, Materials may read Stock items).
// Each topic: one task, a one-line answer, numbered steps, optional notes, the pages whose ?
// button opens it, the lowest rank that needs it (1 Cashier … 4 Developer) and its video link
// (a YouTube video id, filled in once the video is uploaded).

export const helpChapters = [
  { id: 'start', title: 'Getting started' },
  { id: 'selling', title: 'Selling' },
];

/** @type {{ id: string, chapter: string, title: string, summary: string, steps: string[], notes?: string[], pages: string[], rank: number, video?: string }[]} */
export const helpTopics = [
  // 1. Getting started
  {
    id: 'sign-in',
    chapter: 'start',
    title: 'Signing in',
    summary:
      'The business signs in once on a device; then each staff member signs in with their own username.',
    steps: [
      'On a new device, sign in the business with its email and business password. This is done once.',
      'On the Staff sign in screen, choose the business if there is more than one.',
      'Enter your staff username and password, then press Sign in user.',
      'Your name and rank show at the top of the menu. Everything you sell is recorded under your name.',
    ],
    notes: [
      'Staff passwords are never saved by the browser on a shared device. Type yours each time.',
      'Signing in needs a connection. Once signed in, you can keep working offline.',
    ],
    pages: ['My Account'],
    rank: 1,
  },
  {
    id: 'switch-user',
    chapter: 'start',
    title: 'Switching user and logging out',
    summary:
      'Switch user hands the device to someone else; Logout signs you out but keeps the business signed in.',
    steps: [
      'To hand over the device, press Switch user at the bottom of the menu and let the next person sign in.',
      'To leave, press Logout. The staff sign-in screen appears and the business stays signed in.',
      'Sign out business is only for removing the business from this device. Most staff never need it.',
    ],
    notes: [
      'At the end of a shift with cash, use the drawer handover on My Sales instead, so the cash is counted and both people confirm it.',
    ],
    pages: ['My Account', 'My Sales'],
    rank: 1,
  },
  {
    id: 'auto-lock',
    chapter: 'start',
    title: 'When the app locks itself',
    summary:
      'If nobody uses the app for a set time, it signs you out so nobody else can sell under your name.',
    steps: [
      'You will see the staff sign-in screen with the message “Locked after … minutes without use”.',
      'Sign in again with your username and password. Your saved work is still there.',
      'Managers set the time, or turn it off, in Business Settings → Security.',
    ],
    notes: [
      'While the device is offline it waits until the connection is back before locking.',
      'Work not yet uploaded stays on the device and uploads after you sign in again.',
    ],
    pages: [],
    rank: 1,
  },
  {
    id: 'forgot-password',
    chapter: 'start',
    title: 'Forgot your password',
    summary: 'Staff ask a Manager for a new password; the business password is reset by email.',
    steps: [
      'Staff: ask a Manager. They set a new password for you on the Users page.',
      'Business password: on the business sign-in screen, press Forgot password?, enter the business email and open the link in the email on the same device.',
      'After signing in, you can change your own password on My Account.',
    ],
    pages: ['My Account'],
    rank: 1,
  },
  {
    id: 'menu',
    chapter: 'start',
    title: 'Finding your way around',
    summary: 'The menu shows only the pages your rank can open, grouped by what they are for.',
    steps: [
      'On a computer the menu is on the left; on a phone, press Menu at the top.',
      'Pages are grouped: Selling, Jobs & money, Stock & catalogue, and Settings & control.',
      'Press ? at the top of any page for help with that page, or Help in the menu for this whole guide.',
    ],
    notes: [
      'Ranks, from lowest: Cashier, Admin, Manager, Developer. A Manager or Developer decides which pages each rank sees.',
      'Your business may use its own words for some pages, such as Orders instead of Jobs.',
    ],
    pages: ['Dashboard'],
    rank: 1,
  },
  {
    id: 'offline',
    chapter: 'start',
    title: 'Working offline and syncing',
    summary:
      'You can keep selling without a connection; the app uploads your work when the connection returns.',
    steps: [
      'The top of the menu shows Online or Offline and how many changes are waiting to upload.',
      'Keep working as usual when offline. Sales, payments and jobs are saved on this device.',
      'When the connection returns, the changes upload by themselves and the count goes back to 0.',
    ],
    notes: [
      'Do not clear the browser’s data or sign out the business while changes are waiting: they would be lost.',
      'If someone else changed the same thing meanwhile, the app holds your change for review in the Conflict Inbox rather than overwrite theirs.',
    ],
    pages: ['Conflict Inbox'],
    rank: 1,
  },
  // 2. Selling
  {
    id: 'new-job',
    chapter: 'selling',
    title: 'Taking a job at Point of Service',
    summary:
      'Add job opens a checkout: choose the service, enter the details, pick the customer and take any payment.',
    steps: [
      'On Point of Service, press Add job.',
      'Choose the service. Enter the quantity, and the width and height if the service is priced by size.',
      'Set the deadline and, if useful, a job description. Press Add another service for more items.',
      'Under Payment, search the customer by name or phone, or press Add new customer.',
      'Enter the money received (it can be zero, part or all) and the payment method.',
      'Press Complete checkout. The receipt opens, ready to print or share.',
    ],
    notes: [
      'The total updates as you type, including pack prices and discounts.',
      'Money received goes to this customer’s oldest unpaid jobs first, then to the new ones. Extra money is kept as credit in their wallet.',
    ],
    pages: ['Point of Service'],
    rank: 1,
  },
  {
    id: 'quick-sale',
    chapter: 'selling',
    title: 'Quick sale for shelf items',
    summary: 'Quick sale sells ready-made items in a few taps, with no job stages.',
    steps: [
      'On Point of Service, press Quick sale.',
      'Tap a product to add one. Tap again, or use + and −, to change the quantity; you can also type it.',
      'For a product that comes in colours or sizes, tap the colour you are selling. Each button shows how many are left.',
      'Leave the customer as Walk-in customer, or choose a saved customer to sell on credit.',
      'Choose the payment method and enter the money received. The change to give shows under the total.',
      'Press Complete sale. The receipt opens.',
    ],
    notes: [
      'Walk-in sales must be paid in full. Choose a customer to let them owe part of it.',
      'Stock goes down as soon as the sale is saved. Shelf sales are marked Collected straight away.',
    ],
    pages: ['Point of Service'],
    rank: 1,
  },
  {
    id: 'packs-colours',
    chapter: 'selling',
    title: 'Pack prices and colours at the till',
    summary:
      'Some products are cheaper by the pack, and some come in colours; the app works out the price for you.',
    steps: [
      'Enter the number of pieces the customer is buying. The app charges full packs at the pack price and the rest at the single price.',
      'Example: 25 for 1,500 and 100 each: 30 pieces = 1 pack (1,500) + 5 pieces (500) = 2,000.',
      'For colours, add each colour as its own line. Each colour is priced on its own.',
    ],
    notes: [
      'Different colours never make up a pack together: 10 pink and 15 blue are 25 single pieces, not a pack of 25.',
      'The cart line shows how a pack price was worked out.',
    ],
    pages: ['Point of Service'],
    rank: 1,
  },
  {
    id: 'payment',
    chapter: 'selling',
    title: 'Taking a payment for earlier jobs',
    summary: 'Receive payment records money from a customer who owes, without adding a new job.',
    steps: [
      'On Point of Service, press Receive payment.',
      'Search the customer by name or phone.',
      'Enter the money received, the payment method and any reference (such as a transfer sender).',
      'Check how it will be shared across the unpaid jobs, then press Complete checkout.',
    ],
    notes: [
      'Payments go to the oldest unpaid jobs first. To split it differently, press Override allocation.',
      'A customer with wallet credit can use it: tick Use available wallet credit when needed.',
    ],
    pages: ['Point of Service', 'Payments', 'Customers'],
    rank: 1,
  },
  {
    id: 'discounts',
    chapter: 'selling',
    title: 'Giving a discount',
    summary:
      'Discounts are a percentage or an amount, on one job or the whole order, within what your rank allows.',
    steps: [
      'In a checkout, open Job discount on a line, or Order discount for the whole order. In Quick sale, use Discount under the cart.',
      'Choose percentage or amount, enter it, and give a short reason.',
      'The total shows the price before the discount and the discount taken off.',
    ],
    notes: [
      'Each rank has a highest discount it may give. The Manager sets it in Business Settings → Jobs & payments.',
    ],
    pages: ['Point of Service'],
    rank: 1,
  },
  {
    id: 'receipts',
    chapter: 'selling',
    title: 'Receipts: print, PDF and share',
    summary: 'Every completed sale opens its receipt, which you can print, download or share.',
    steps: [
      'After Complete checkout or Complete sale, the receipt opens by itself.',
      'Press Print receipt for the shop printer, Share to send it (for example on WhatsApp), or download a PDF in A4 or 80mm roll size.',
      'To find an older receipt, press Receipt next to the sale on My Sales, or next to the payment on the Payments page.',
    ],
    notes: ['The paper size, logo and what shows on receipts are set in Business Settings → Receipts.'],
    pages: ['My Sales', 'Print Settings'],
    rank: 1,
  },
  {
    id: 'quotations',
    chapter: 'selling',
    title: 'Quotations',
    summary: 'A quotation gives a customer a price without selling; it can be turned into a checkout later.',
    steps: [
      'On Quotations, press New quotation, add the items (Add another item for more) and press Save quotation.',
      'Press Share or Print to give it to the customer.',
      'When the customer accepts, press Create job on the quotation. A checkout opens with its items.',
    ],
    notes: [
      'A checkout from a quotation is charged at today’s prices; any price changed since the quote is listed.',
    ],
    pages: ['Quotations'],
    rank: 1,
  },
  {
    id: 'my-sales',
    chapter: 'selling',
    title: 'My Sales and the drawer handover',
    summary:
      'My Sales lists your own sales and the cash you hold; the handover passes the drawer to the next person.',
    steps: [
      'Open My Sales to see your transactions. Use the dates to choose the period.',
      'Unclosed shows the sales still in your drawer.',
      'At the end of a shift, start a drawer handover: count the cash, let the next person sign in to confirm, then press Close drawer and switch user.',
      'Drawer history shows past handovers.',
    ],
    notes: ['Pending sales are uploaded before the handover is recorded, so do it while online.'],
    pages: ['My Sales'],
    rank: 1,
  },
];

/** The printable one-page card for each rank: the everyday tasks, as topic ids. */
export const quickStartCards = {
  1: {
    title: 'Cashier quick-start',
    topics: ['sign-in', 'new-job', 'quick-sale', 'payment', 'receipts', 'offline', 'auto-lock'],
  },
};

/** Topics a rank can see, in manual order. */
export const topicsFor = (rank) => helpTopics.filter((t) => t.rank <= Math.max(rank, 1));

/** The first topic for a page (what its ? button opens), if any. */
export const topicForPage = (page, rank) => topicsFor(rank).find((t) => t.pages.includes(page)) ?? null;

/**
 * Topics matching a search, by title first, then summary and steps.
 * @param {typeof helpTopics} topics
 * @param {string} query
 * @returns {typeof helpTopics}
 */
export function searchTopics(topics, query) {
  const q = query.trim().toLowerCase();
  if (!q) return topics;
  const words = q.split(/\s+/);
  const score = (t) => {
    const title = t.title.toLowerCase();
    const body = [t.summary, ...t.steps, ...(t.notes ?? [])].join(' ').toLowerCase();
    if (!words.every((w) => title.includes(w) || body.includes(w))) return 0;
    return words.filter((w) => title.includes(w)).length * 2 + 1;
  };
  return topics
    .map((t) => ({ t, s: score(t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.t);
}
