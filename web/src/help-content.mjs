// The user manual shown in the app's Help panel. Written for any business using the app, with
// the app's default page names; the panel passes every line through the business's own words
// (Jobs may read Orders, Materials may read Stock items).
// Each topic: one task, a one-line answer, numbered steps, optional notes, the pages whose ?
// button opens it, the lowest rank that needs it (1 Cashier … 4 Developer) and its video link
// (a YouTube video id, filled in once the video is uploaded).

export const helpChapters = [
  { id: 'start', title: 'Getting started' },
  { id: 'selling', title: 'Selling' },
  { id: 'jobs', title: 'Jobs and money' },
  { id: 'stock', title: 'Stock and catalogue' },
  { id: 'reports', title: 'Reports' },
  { id: 'staff', title: 'Staff and control' },
  { id: 'settings', title: 'Business Settings' },
  { id: 'problems', title: 'Fixing problems' },
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
  // 3. Jobs and money
  {
    id: 'job-stages',
    chapter: 'jobs',
    title: 'Moving jobs through their stages',
    summary:
      'Each job moves from Added to In Queue, Printing, Completed and Collected, so everyone can see where it is.',
    steps: [
      'Open Jobs. Each job shows its stage, its deadline and what it still owes.',
      'Press Next: … to move a job to its next stage, then confirm.',
      'Press Set Action to jump to another stage, for example back to Printing for a reprint.',
      'Press Mark as Complete when the work is done. It moves to Collected when the customer takes it.',
      'Search, sort and the date button narrow the list; More shows collected and cancelled jobs.',
    ],
    notes: [
      'Shelf items from Quick sale skip the stages and are marked Collected straight away.',
      'A job with a choice of materials asks which material was used, and how much, when it passes its confirmation stage.',
      'Your business may use its own stage names, set in Business Settings → Jobs & payments.',
    ],
    pages: ['Jobs'],
    rank: 1,
  },
  {
    id: 'customers',
    chapter: 'jobs',
    title: 'Customers, credit and wallet',
    summary:
      'A customer record keeps their jobs, payments, what they owe and any credit they have paid ahead.',
    steps: [
      'Open Customers and press Add customer, or add them during a checkout with Add new customer.',
      'Enter the full name and phone number. The address is optional.',
      'Set a Credit limit if they may owe up to an amount; leave it at 0 for pay-as-you-go customers.',
      'Press Save customer. Use Edit to change the details later.',
    ],
    notes: [
      'Money paid beyond what a customer owes is kept in their wallet and can pay for later jobs.',
      'Phone numbers must be unique, so the same customer is not saved twice.',
    ],
    pages: ['Customers'],
    rank: 1,
  },
  {
    id: 'reminders',
    chapter: 'jobs',
    title: 'Reminding customers who owe',
    summary:
      'Payment Reminders lists everyone who owes, oldest first, and sends a friendly WhatsApp message with their statement.',
    steps: [
      'Open Payment Reminders. The cards show how many customers owe and how much.',
      'Find a customer by name or phone, or start with the oldest at the top.',
      'Press Remind. On a phone, WhatsApp opens with the message and the statement attached; on a computer, the statement downloads and WhatsApp opens ready to attach it.',
      'Last reminded shows when each customer was last reminded.',
    ],
    pages: ['Payment Reminders'],
    rank: 2,
  },
  {
    id: 'payments-list',
    chapter: 'jobs',
    title: 'The Payments page',
    summary: 'Payments lists every payment received, with the jobs it paid for.',
    steps: [
      'Open Payments to see each payment, its method and the jobs it covers.',
      'Use the date button and search to find a payment.',
      'Press Receipt next to a payment to open its receipt again.',
    ],
    notes: ['To take a new payment, use Receive payment on Point of Service.'],
    pages: ['Payments'],
    rank: 1,
  },
  {
    id: 'expenses',
    chapter: 'jobs',
    title: 'Recording expenses',
    summary:
      'Expenses records money the business spends, paid now or later, so reports show sales less expenses.',
    steps: [
      'Open Expenses and press Add expense.',
      'Enter a description, the date, the total cost and who it was paid to.',
      'Record money paid now is ticked: check the amount, date and method. Untick it if you will pay later.',
      'Press Save expense. To pay an unpaid expense later, press Record payment on it.',
    ],
    notes: [
      'Filters narrows the list by category, status and who recorded it.',
      'A mistaken expense is voided, not deleted, so the history stays complete.',
    ],
    pages: ['Expenses'],
    rank: 2,
  },
  // 4. Stock and catalogue
  {
    id: 'restock',
    chapter: 'stock',
    title: 'Restocking and counting stock',
    summary: 'Add to stock when new stock arrives; Set quantity after counting what is really on the shelf.',
    steps: [
      'Open Materials. Each stock item shows how many are available and its minimum.',
      'When stock arrives, press Add to stock on the item, enter the quantity and a note, and save.',
      'After a physical count, press Set quantity and enter the number you counted. The difference is recorded.',
      'Reorder list shows everything at or below its minimum.',
    ],
    notes: [
      'Every change is kept in Stock History with who made it and why.',
      'Edit Products can also restock or count an item while you change its price.',
    ],
    pages: ['Materials'],
    rank: 2,
  },
  {
    id: 'add-product',
    chapter: 'stock',
    title: 'Adding a product or service',
    summary:
      'Add product creates a shelf item and its stock in one step; Add service is for work priced per job.',
    steps: [
      'Open Services. Press Add product for things you sell off the shelf, or Add service for work such as printing.',
      'Enter the name, unit and price. For a product, enter the opening stock and the minimum.',
      'For pack prices, press Add pack price and enter the pack size and its price, e.g. 25 for 1,500.',
      'For colours or sizes, tick Comes in variants and add each one with its own opening stock.',
      'Press Save product (or Save service).',
    ],
    notes: [
      'A service can use a stock item (A4 printing uses A4 paper), or none for labour such as binding.',
      'Pieces of different colours never make up a pack together.',
    ],
    pages: ['Services'],
    rank: 2,
  },
  {
    id: 'material-choice',
    chapter: 'stock',
    title: 'A choice of materials for one service',
    summary:
      'A service can link several materials that do the same job, such as 2 ft, 5 ft and 10 ft rolls, at one price. The material used is confirmed in production.',
    steps: [
      'Open Services and edit the service (or Add service).',
      'Under Base material, choose A choice of materials…, then tick 2 to 10 materials with the same unit.',
      'Choose the stage after which the material is confirmed, for example Printing. Save.',
      'At the sale, nothing is taken from stock; the price is the same whichever material is used.',
      'When the job is moved past that stage (or straight to Completed), the app asks which material was used and how much. Split it across two if one ran out. Stock is taken then.',
    ],
    notes: [
      'Jobs still waiting show Material to confirm on the Jobs page.',
      'Services with one fixed material still take stock at the sale, as before.',
    ],
    pages: [],
    rank: 2,
  },
  {
    id: 'edit-product',
    chapter: 'stock',
    title: 'Editing a product: price, unit, packs and variants',
    summary: 'Edit Products changes a product’s name, price, unit, pack prices and stock together.',
    steps: [
      'Open Edit Products and press Edit on the product.',
      'Change the name, price, unit or pack prices. The box at the bottom shows what will change.',
      'To change stock at the same time, choose Add stock or Set to counted amount and give a reason.',
      'Press Save changes.',
    ],
    notes: [
      'For a product with variants, the name, unit, price and pack prices change for every variant; stock is for the variant you opened.',
      'Add variants turns a product into one with colours; Make … a separate item takes a variant out again.',
    ],
    pages: ['Edit Products'],
    rank: 2,
  },
  {
    id: 'waste',
    chapter: 'stock',
    title: 'Waste, damage and reprints',
    summary: 'Record stock that was spoilt or reprinted, so the stock level and reports stay right.',
    steps: [
      'Open Materials and choose the Waste & reprints tab.',
      'Press Record material waste. Choose the stock item and the type: Waste, Damage or Reprint.',
      'Enter the additional quantity used, link the job if it was a reprint, and give a reason.',
      'Check the stock after saving, then press Approve and save waste.',
    ],
    pages: ['Material Waste'],
    rank: 2,
  },
  {
    id: 'stock-history',
    chapter: 'stock',
    title: 'Stock history',
    summary: 'Stock History shows every change to every stock item: before, after, who and why.',
    steps: [
      'Open Stock History.',
      'Filter by stock item or action, or search for a note or a person.',
      'Press Details on a line to see the full change.',
    ],
    pages: ['Stock History'],
    rank: 2,
  },
  // 5. Reports
  {
    id: 'dashboard',
    chapter: 'reports',
    title: 'Reading the Dashboard',
    summary:
      'The Dashboard shows sales, money collected, expenses and what is owed, for the period you choose.',
    steps: [
      'Open Dashboard and choose the Period (or set From and To dates).',
      'Sales value is the work sold; Net collected is the money received, less refunds.',
      'Income − expenses and Money In − Money Out show how the business did in the period.',
      'Current position shows what customers owe and unpaid expenses, for all dates.',
      'The charts below show top services, payment methods, job sources, top customers and stock running low.',
    ],
    notes: ['Hover or tap a bar or slice to see its amount.'],
    pages: ['Dashboard'],
    rank: 3,
  },
  {
    id: 'reports',
    chapter: 'reports',
    title: 'Reports and customer statements',
    summary:
      'Reports gives customer statements, a transaction list and a summary, each ready to share or download.',
    steps: [
      'Open Reports and choose a tab: Customer statement, Transactions or Summary.',
      'For a statement, type the customer’s name or phone number and choose them.',
      'Choose the period, or set From and To dates.',
      'Use Share, or download it as a spreadsheet or PDF.',
    ],
    pages: ['Reports'],
    rank: 3,
  },
  // 6. Staff and control
  {
    id: 'users',
    chapter: 'staff',
    title: 'Adding staff and resetting passwords',
    summary: 'Users is where a Manager adds staff, sets their rank and resets forgotten passwords.',
    steps: [
      'Open Users and press Add user.',
      'Enter their name, a username, their rank (Cashier, Admin or Manager) and a starting password.',
      'Press Save user. Give them the username and password to sign in.',
      'If someone forgets their password, press Reset password on their line and set a new one.',
      'To stop someone signing in, press Archive on their line. Their sales history is kept.',
    ],
    notes: ['Managing users needs a connection, and is not available in the local trial.'],
    pages: ['Users'],
    rank: 3,
  },
  {
    id: 'page-access',
    chapter: 'staff',
    title: 'Ranks and page access',
    summary: 'Each rank sees only the pages it is allowed; the Developer chooses them.',
    steps: [
      'Open Business Settings and choose the Page access tab (Developer only).',
      'Tick the pages Cashier, Admin and Manager may open.',
      'Choose which Business Settings tabs Admin and Manager may change.',
      'Save page access.',
    ],
    notes: ['Seeing a page does not by itself allow approving corrections or managing users.'],
    pages: [],
    rank: 4,
  },
  {
    id: 'sale-adjustments',
    chapter: 'staff',
    title: 'Correcting, cancelling or refunding a sale',
    summary:
      'Sale Adjustments fixes a sale that was entered wrongly. The original receipt stays, and the change records who approved it and why.',
    steps: [
      'Open Sale Adjustments and type the job ID, description or service, then choose the job.',
      'Press Adjust selected sale and choose the adjustment type: correct the charge or details, cancel the sale, correct payment details, or refund customer credit.',
      'Enter the corrected values. For stock, choose whether the material was really used or can be returned.',
      'Give the reason and save. Adjustment history lists every change.',
    ],
    notes: [
      'To refund money paid for a job, first reduce the charge or cancel the sale; then refund the credit it leaves.',
      'Connect and let the app finish syncing before adjusting a sale.',
    ],
    pages: ['Sale Adjustments'],
    rank: 2,
  },
  {
    id: 'conflicts',
    chapter: 'staff',
    title: 'The Conflict Inbox',
    summary:
      'When two devices changed the same thing, the change waits in the Conflict Inbox for a supervisor to decide.',
    steps: [
      'Open Conflict Inbox and press Review conflict on an item.',
      'Compare the current business values with the values from the device.',
      'Press Reapply pending operation to keep the device’s change, or Keep business version to drop it.',
    ],
    notes: [
      'An Admin or higher can also review a cashier’s held work on the cashier’s own device by signing in as supervisor.',
      'Reviewing conflicts needs a connection.',
    ],
    pages: ['Conflict Inbox'],
    rank: 2,
  },
  {
    id: 'print-settings',
    chapter: 'staff',
    title: 'Printer setup',
    summary:
      'Print Settings chooses the printer, paper and font for this computer; each device keeps its own.',
    steps: [
      'Open Print Settings and press Edit settings.',
      'Choose the default printer, the paper size and, for a receipt printer, its print width.',
      'Press Save settings, then Test print to check the paper, font and margins.',
      'If the right side is cut off on a receipt printer, choose the next smaller print width.',
    ],
    notes: [
      'Direct printing uses QZ Tray on the computer. Trusted printing (no approval pop-up) needs a signed-in business.',
    ],
    pages: ['Print Settings'],
    rank: 2,
  },
  // 7. Business Settings
  {
    id: 'settings-profile',
    chapter: 'settings',
    title: 'Business details and logo',
    summary: 'Profile & logo holds the name, address and contacts printed on receipts, and your logos.',
    steps: [
      'Open Business Settings → Profile & logo.',
      'Enter the business name, address, phone or WhatsApp numbers, email, website and social handles. Press Save business details.',
      'Upload a logo (PNG or JPEG). For a wider choice, upload logo variants for light and dark backgrounds.',
      'Choose which layout shows in the sidebar and as the browser tab icon, then press Save logo.',
    ],
    pages: ['Business Settings'],
    rank: 3,
  },
  {
    id: 'settings-receipts',
    chapter: 'settings',
    title: 'Receipt settings',
    summary: 'Receipts chooses what shows on receipt-printer and full-page receipts, including which logo.',
    steps: [
      'Open Business Settings → Receipts.',
      'Set up Receipt printer (80mm or 58mm) and Full page (A4 or A5) separately.',
      'Choose the logo, whether to show the address and contacts, and the footer message. The preview updates as you go.',
      'Save.',
    ],
    pages: [],
    rank: 3,
  },
  {
    id: 'settings-workflow',
    chapter: 'settings',
    title: 'Dropdown lists',
    summary: 'Dropdowns & workflow sets the lists staff choose from, such as payment methods and units.',
    steps: [
      'Open Business Settings → Dropdowns & workflow.',
      'Edit lists such as payment methods, job sources, stock notes and units: add, rename, reorder or switch items off.',
      'Save.',
    ],
    pages: [],
    rank: 3,
  },
  {
    id: 'settings-jobs',
    chapter: 'settings',
    title: 'Jobs, payments, words and discount limits',
    summary:
      'Jobs & payments sets the app’s words and stage names, deadlines, payment defaults, discount limits and default time frames.',
    steps: [
      'Open Business Settings → Jobs & payments.',
      'Choose what the app calls jobs, services and materials (for example Orders, Items, Stock items), and the job stage names.',
      'Set the default deadline and what Money received starts at in a checkout.',
      'Set the highest discount each rank may give, and who may discount a whole order.',
      'Choose the default period each page opens with. Save each section.',
    ],
    pages: [],
    rank: 3,
  },
  {
    id: 'settings-other',
    chapter: 'settings',
    title: 'Appearance, corrections and security',
    summary: 'The remaining tabs set colours and theme, the correction window and the auto-lock time.',
    steps: [
      'Appearance: brand colours, light or dark theme, and background colours.',
      'Pricing templates: turn pricing templates on or off.',
      'Corrections: how many recent days of jobs show in Sale Adjustments.',
      'Security: lock the app after a number of minutes without use, or never.',
    ],
    notes: ['Admin and Manager can change only the tabs the Developer allows them in Page access.'],
    pages: [],
    rank: 3,
  },
  {
    id: 'pricing-templates',
    chapter: 'settings',
    title: 'Pricing templates',
    summary:
      'A pricing template works out a price from a few answers (such as pages and copies) using your costs.',
    steps: [
      'Open Pricing Templates. The Costs tab lists the items with a formula name and cost.',
      'On the Templates tab, open a template to see its questions and how the price is worked out.',
      'In a checkout or quotation, choose the template instead of a service and answer its questions.',
    ],
    notes: [
      'Give an item a formula name under Services → Edit → Use in pricing templates.',
      'Saving templates needs a connection.',
    ],
    pages: ['Pricing Templates'],
    rank: 3,
  },
  // 8. Fixing problems
  {
    id: 'fix-sync',
    chapter: 'problems',
    title: 'Changes waiting to upload',
    summary:
      'If the pending changes count does not go back to 0, the app is still waiting for a connection or for a review.',
    steps: [
      'Check the top of the menu: Offline means no connection. Move closer to the router or switch on data.',
      'If it says Online but the count stays, open Conflict Inbox (or ask an Admin): something may be waiting for review.',
      'Keep the app open until the count reaches 0. Do not clear the browser’s data or sign out the business meanwhile.',
    ],
    pages: [],
    rank: 1,
  },
  {
    id: 'fix-changed',
    chapter: 'problems',
    title: '“This changed elsewhere”',
    summary:
      'Someone else saved a change to the same thing first. The app stops you overwriting it by mistake.',
    steps: [
      'Close the form without saving.',
      'Wait a moment for the latest version to arrive, or press Reload saved settings where it is offered.',
      'Open it again and make your change on the latest version.',
    ],
    pages: [],
    rank: 1,
  },
  {
    id: 'fix-printing',
    chapter: 'problems',
    title: 'The printer does not print',
    summary: 'Most printing problems are the printer connection, the chosen printer or the paper size.',
    steps: [
      'Check the printer is on, has paper and is connected to this computer.',
      'Open Print Settings and press Test print.',
      'If nothing prints, press Find installed printers and choose the right one, then save.',
      'If the receipt is cut off, choose a smaller print width. Meanwhile, use Download PDF on the receipt and print that.',
    ],
    pages: [],
    rank: 1,
  },
  {
    id: 'fix-locked-out',
    chapter: 'problems',
    title: 'Cannot sign in',
    summary: 'Staff passwords are reset by a Manager; the business password is reset by email.',
    steps: [
      'Check you are online: signing in needs a connection.',
      'Check the username: it is not your email.',
      'Staff: ask a Manager to press Reset password for you on Users.',
      'Business password: press Forgot password? on the business sign-in screen.',
    ],
    pages: [],
    rank: 1,
  },
];

/** The printable one-page card for each rank: the everyday tasks, as topic ids. */
export const quickStartCards = {
  1: {
    title: 'Cashier quick-start',
    topics: ['sign-in', 'new-job', 'quick-sale', 'payment', 'receipts', 'offline', 'auto-lock'],
  },
  2: {
    title: 'Admin quick-start',
    topics: [
      'job-stages',
      'expenses',
      'restock',
      'edit-product',
      'sale-adjustments',
      'conflicts',
      'my-sales',
    ],
  },
  3: {
    title: 'Manager quick-start',
    topics: [
      'dashboard',
      'reports',
      'users',
      'add-product',
      'settings-profile',
      'settings-jobs',
      'settings-other',
    ],
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
