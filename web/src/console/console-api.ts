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
  lastActivity: string | null;
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
