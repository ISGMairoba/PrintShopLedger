import { consoleAuth } from '../cloud';

export type ConsoleMember = { userId: string; role: 'owner' | 'support'; name: string; email: string };
export type BusinessRow = {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string | null;
  staff: number;
  customers: number;
  jobs: number;
  sales30: number;
  events7: number;
  devices7?: number;
  lastActivity: string | null;
  plan?: string | null;
  subscription?: SubscriptionState;
  expiresAt?: string | null;
  problems?: number;
};
export type StaffRow = {
  id: string;
  version: number;
  name: string;
  username: string;
  role: string;
  rank: number;
  accessLevel: number;
  archived: boolean;
  createdAt: string;
  lastActivity: string | null;
};
export type BusinessDetail = {
  id: string;
  name: string;
  currency: string;
  createdAt: string;
  ownerEmail: string | null;
  settingsVersion: number | null;
  settingsChangedAt: string | null;
  staff: StaffRow[];
  records: Record<string, number>;
  storageBytes: Record<string, number>;
  daily: { day: string; events: number; sales: number }[];
};
export type ConsoleAction = {
  id: string;
  shopId: string | null;
  business: string | null;
  actorName: string;
  action: string;
  reason: string | null;
  details: Record<string, unknown>;
  at: string;
};
export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'support';
  disabled: boolean;
  addedAt: string;
};

function client() {
  if (!consoleAuth) throw Error('The console needs the cloud connection settings.');
  return consoleAuth;
}
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(name, args).abortSignal(AbortSignal.timeout(30000));
  if (error) throw Error(error.message);
  return data as T;
}
export const whoami = () => call<ConsoleMember | null>('console_whoami');
export const businesses = () => call<BusinessRow[]>('console_businesses');
export const business = (id: string) => call<BusinessDetail>('console_business', { p_shop: id });
export const activity = (shopId: string | null = null) =>
  call<ConsoleAction[]>('console_activity', { p_shop: shopId, p_limit: 300 });
export const team = () => call<TeamMember[]>('console_team');
export const setMember = (m: { userId: string; name: string; role: string; disabled: boolean }) =>
  call<null>('console_set_member', {
    p_user: m.userId,
    p_name: m.name,
    p_role: m.role,
    p_disabled: m.disabled,
  });

/** Team accounts are created (and passwords reset) by the console-team server function. */
export async function teamAction(body: Record<string, unknown>) {
  const { data, error } = await client().functions.invoke('console-team', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const message = context
      ? await context
          .json()
          .then((x) => x?.error)
          .catch(() => '')
      : '';
    throw Error(message || error.message);
  }
  return data as { userId?: string };
}

export async function signIn(email: string, password: string) {
  const { error } = await client().auth.signInWithPassword({ email: email.trim(), password });
  if (error)
    throw Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  const me = await whoami();
  if (!me) {
    await client().auth.signOut();
    throw Error('This account is not on the console team. Use your console email, not a business account.');
  }
  return me;
}
export async function currentMember() {
  const { data } = await client().auth.getSession();
  if (!data.session) return null;
  try {
    return await whoami();
  } catch {
    return null;
  }
}
export const signOut = () => client().auth.signOut();
export async function changePassword(password: string) {
  if (password.length < 12) throw Error('Use a password of at least 12 characters.');
  const { error } = await client().auth.updateUser({ password });
  if (error) throw Error(error.message);
}

export type SavedSettings = { settings: unknown; version: number; modifiedAt: string } | null;
export const businessSettings = (id: string) =>
  call<SavedSettings>('console_business_settings', { p_shop: id });
export const saveBusinessSettings = (id: string, version: number, settings: unknown) =>
  call<{ version: number; modified_at: string }>('console_save_business_settings', {
    p_shop: id,
    p_version: version,
    p_settings: settings,
  });
/** Change a staff member: edit (name, username, role), grant, revoke, archive or restore. */
export const saveStaff = (shopId: string, action: string, data: Record<string, unknown>) =>
  call<null>('console_save_staff', { p_shop: shopId, p_action: action, p_data: data });
/** Add staff or set a staff password (console-staff server function). */
export async function staffAction(body: Record<string, unknown>) {
  const { data, error } = await client().functions.invoke('console-staff', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const message = context
      ? await context
          .json()
          .then((x) => x?.error)
          .catch(() => '')
      : '';
    throw Error(message || error.message);
  }
  return data;
}

export type DeviceRow = {
  id: string;
  name: string;
  userLabel: string;
  appVersion: string;
  pending: number;
  held: number;
  lastSynced: string | null;
  history: { checkedAt?: string; checked?: number; differing?: number };
  firstSeen: string;
  lastSeen: string;
  signOutRequestedAt: string | null;
  signedOutAt: string | null;
};
export const devices = (shopId: string) => call<DeviceRow[]>('console_devices', { p_shop: shopId });
export const deviceAction = (
  shopId: string,
  deviceId: string,
  action: 'sign-out' | 'cancel-sign-out' | 'forget',
) => call<null>('console_device_action', { p_shop: shopId, p_device: deviceId, p_action: action });

export type SubscriptionState = 'none' | 'trial' | 'active' | 'grace' | 'expired' | 'suspended';
export type ExpiryMode = 'warn' | 'read_only' | 'pages_off' | 'locked';
export type Plan = {
  id: string;
  name: string;
  price: number;
  periodDays: number;
  maxDevices: number | null;
  description: string;
  archived: boolean;
  businesses?: number;
};
export type Subscription = {
  planId: string | null;
  status: 'trial' | 'active' | 'suspended';
  startsAt: string;
  expiresAt: string | null;
  graceDays: number;
  expiryMode: ExpiryMode;
  pagesOff: string[];
  message: string;
  maxDevices: number | null;
  updatedAt?: string;
};
export type Payment = {
  id: string;
  receiptNo?: number | null;
  planName?: string;
  amount: number;
  paidOn: string;
  method: string;
  reference: string;
  extendedTo: string | null;
  note: string;
  recordedAt: string;
  recordedBy: string | null;
};
export type SubscriptionDetail = {
  subscription: Subscription | null;
  state: SubscriptionState;
  devices: number;
  payments: Payment[];
};
export const plans = () => call<Plan[]>('console_plans');
export const savePlan = (plan: Plan) => call<null>('console_save_plan', { p_plan: plan });
export const subscription = (shopId: string) =>
  call<SubscriptionDetail>('console_subscription', { p_shop: shopId });
export const saveSubscription = (shopId: string, sub: Subscription & { reason: string }) =>
  call<null>('console_save_subscription', { p_shop: shopId, p_sub: sub });
export const recordPayment = (
  shopId: string,
  payment: {
    amount: number;
    paidOn: string;
    method: string;
    reference: string;
    extendedTo: string | null;
    note: string;
  },
) =>
  call<{ id: string; receiptNo: number }>('console_record_payment', { p_shop: shopId, p_payment: payment });

export type TrialSettings = {
  enabled: boolean;
  planId: string | null;
  days: number;
  graceDays: number;
  expiryMode: ExpiryMode;
  pagesOff: string[];
  message: string;
  updatedAt?: string;
};
export const trialSettings = () => call<TrialSettings>('console_trial_settings');
export const saveTrialSettings = (trial: TrialSettings) =>
  call<null>('console_save_trial_settings', { p_trial: trial });
export const businessBackup = (shopId: string) =>
  call<Record<string, unknown>>('console_business_backup', { p_shop: shopId });

export type Problem = {
  id: string;
  shopId: string;
  business: string;
  deviceId: string;
  device: string;
  kind: 'error' | 'sync';
  message: string;
  detail: { stack?: string; path?: string; appVersion?: string; browser?: string; pending?: number };
  userLabel: string;
  appVersion: string;
  count: number;
  firstAt: string;
  lastAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};
export const problems = (shopId: string | null, open: boolean) =>
  call<Problem[]>('console_problems', { p_shop: shopId, p_open: open });
export const problemAction = (id: string, action: 'resolve' | 'reopen') =>
  call<null>('console_problem_action', { p_id: id, p_action: action });

export type ReceiptIssuer = {
  name: string;
  address: string;
  phone: string;
  email: string;
  bank: string;
  footer: string;
};
export const receiptIssuer = () => call<ReceiptIssuer>('console_receipt_issuer');
export const saveReceiptIssuer = (issuer: ReceiptIssuer) =>
  call<null>('console_save_receipt_issuer', { p_issuer: issuer });
