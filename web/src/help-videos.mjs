// Tutorial videos shown in Help. Each video file (made by scripts/tutorials) belongs to one or
// more Help topics. Once a video is on YouTube, put its video id here (the part after
// "watch?v=" or "youtu.be/"), and it plays at the top of those topics.

/** @type {Record<string, { title: string, topics: string[], youtube: string }>} */
export const helpVideos = {
  '01-getting-started': { title: 'Getting started', topics: ['sign-in', 'menu', 'auto-lock'], youtube: '' },
  '02-taking-a-job': { title: 'Taking a job at Point of Service', topics: ['new-job'], youtube: '' },
  '03-quick-sale': { title: 'Quick sale', topics: ['quick-sale', 'packs-colours'], youtube: '' },
  '04-taking-a-payment': { title: 'Taking a payment for earlier jobs', topics: ['payment'], youtube: '' },
  '05-receipts': { title: 'Receipts: print, PDF and share', topics: ['receipts'], youtube: '' },
  '06-discounts': { title: 'Giving a discount', topics: ['discounts'], youtube: '' },
  '07-working-offline': { title: 'Working offline', topics: ['offline', 'fix-sync'], youtube: '' },
  '08-job-stages': { title: 'Moving jobs through their stages', topics: ['job-stages'], youtube: '' },
  '09-customers': {
    title: 'Customers, credit and reminders',
    topics: ['customers', 'reminders'],
    youtube: '',
  },
  '10-expenses': { title: 'Recording expenses', topics: ['expenses'], youtube: '' },
  '11-restocking': {
    title: 'Restocking and counting stock',
    topics: ['restock', 'stock-history'],
    youtube: '',
  },
  '12-waste': { title: 'Waste, damage and reprints', topics: ['waste'], youtube: '' },
  '13-editing-products': { title: 'Editing a product', topics: ['edit-product'], youtube: '' },
  '14-adding-products': {
    title: 'Adding a product with colours and pack prices',
    topics: ['add-product'],
    youtube: '',
  },
  '15-dashboard': { title: 'Reading the Dashboard', topics: ['dashboard'], youtube: '' },
  '16-reports': { title: 'Reports and customer statements', topics: ['reports'], youtube: '' },
  '17-quotations': { title: 'Quotations', topics: ['quotations'], youtube: '' },
  '18-business-settings': {
    title: 'Business Settings tour',
    topics: ['settings-profile', 'settings-receipts', 'settings-workflow', 'settings-jobs', 'settings-other'],
    youtube: '',
  },
  '19-page-access': { title: 'Ranks and page access', topics: ['page-access'], youtube: '' },
};

/** The YouTube id of the video for a Help topic, if it has been uploaded. */
export function videoFor(topicId) {
  return Object.values(helpVideos).find((v) => v.youtube && v.topics.includes(topicId))?.youtube ?? '';
}
