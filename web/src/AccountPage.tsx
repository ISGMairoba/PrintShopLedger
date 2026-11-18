import { initialsFor } from './item-fields.mjs';
import Icon from './Icon';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { useState, type FormEvent } from 'react';
import { supabase } from './cloud';
import { hashPin, pinProblem } from './pin.mjs';
export default function AccountPage({
  shopId,
  userId,
  businessAccount,
  username,
  online,
  demo,
  themePreference,
  setThemePreference,
  onChanged,
  staffName = '',
  initials = '',
  pin,
}: {
  /** PIN lock: whether this person has a PIN, and saving a new hash (null removes it). */
  pin?: { has: boolean; save: (hash: string | null) => Promise<void> };
  /** The person's name and own initials, for the round avatar. */
  staffName?: string;
  initials?: string;
  shopId: string;
  userId: string;
  businessAccount: boolean;
  username: string;
  online: boolean;
  demo: boolean;
  themePreference: string;
  setThemePreference: (value: string) => void;
  onChanged: (message: string) => void;
}) {
  const [name, setName] = useState(username),
    [busy, setBusy] = useState(false),
    [message, setMessage, messageTone] = useFeedbackMessage('success');
  const valid = /^[a-z0-9][a-z0-9._-]{2,39}$/.test(name.trim().toLowerCase());
  async function save(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    if (busy || demo || !navigator.onLine || !supabase) return;
    const form = event.currentTarget,
      data = new FormData(form);
    if (action === 'password' && data.get('password') !== data.get('confirm')) {
      setMessage('New passwords must match.', 'error');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { data: result, error } = await supabase.functions.invoke('update-credentials', {
        body: {
          shopId,
          userId,
          action,
          username: name.trim().toLowerCase(),
          currentPassword: data.get('currentPassword'),
          password: data.get('password'),
        },
      });
      if (error) {
        let text = error.message;
        const response = (error as { context?: Response }).context;
        if (response)
          try {
            text = (await response.json()).error || text;
          } catch {}
        throw Error(text);
      }
      form.reset();
      if (action === 'username') onChanged(result.message);
      else setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  const [letters, setLetters] = useState(initials);
  async function saveInitials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || demo || !navigator.onLine || !supabase) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.rpc('set_my_initials', { p_shop: shopId, p_initials: letters });
      if (error) throw Error(error.message);
      onChanged(letters.trim() ? 'Initials saved.' : 'Initials cleared: your avatar uses your name.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || demo || !online;
  return (
    <section className="panel editor">
      <h2>My credentials</h2>
      <label>
        Appearance on this device
        <select
          aria-label="Appearance on this device"
          value={themePreference}
          onChange={(e) => {
            try {
              setThemePreference(e.target.value);
              setMessage('Appearance saved on this device.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error), 'error');
            }
          }}
        >
          <option value="business">Business default</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
      <p>
        Connect to save changes. Your current password is required. Usernames are unique within this business.
      </p>
      {demo && <p className="notice">Credential changes are available in a signed-in business.</p>}
      {!online && <p role="status">Connect to the internet before saving.</p>}
      <FeedbackBanner message={message} tone={messageTone} />
      <form onSubmit={(event) => void save(event, 'username')}>
        <div className="form-grid">
          <label>
            Username
            <input
              aria-label="Username"
              autoComplete="username"
              required
              maxLength={40}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <small>
              3–40 characters: letters, numbers, dots, underscores or hyphens. Start with a letter or number.
              {!valid && (
                <span className="field-error" role="alert">
                  Enter a valid username.
                </span>
              )}
            </small>
          </label>
          <label>
            Current password
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
        </div>
        <button disabled={disabled || !valid}>
          <Icon name="save" /> Save username
        </button>
      </form>
      {pin && (
        <>
          <h3>PIN</h3>
          <p className="muted">
            {pin.has
              ? 'You have a PIN. When the app locks after the auto-lock time, your PIN unlocks it on any device you have signed in on, even without internet.'
              : 'Set a 4 to 6 digit PIN. When the app locks after the auto-lock time, your PIN unlocks it, even without internet, instead of signing you out.'}
          </p>
          <form
            className="pin-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const next = String(form.get('pin') ?? '');
              const problem = pinProblem(next, String(form.get('again') ?? ''));
              if (problem) return setMessage(problem, 'error');
              setBusy(true);
              try {
                await pin.save(await hashPin(next));
                (event.target as HTMLFormElement).reset();
                setMessage(pin.has ? 'PIN changed.' : 'PIN set. It works on every device you sign in on.');
              } catch (error) {
                setMessage(error instanceof Error ? error.message : String(error), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                {pin.has ? 'New PIN' : 'PIN'}
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4,6}"
                  minLength={4}
                  maxLength={6}
                  required
                />
              </label>
              <label>
                Type it again
                <input
                  name="again"
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]{4,6}"
                  minLength={4}
                  maxLength={6}
                  required
                />
              </label>
            </div>
            <div className="material-actions">
              <button disabled={disabled}>
                <Icon name="save" /> {pin.has ? 'Change PIN' : 'Set PIN'}
              </button>
              {pin.has && (
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await pin.save(null);
                      setMessage('PIN removed. The app signs you out when it locks.');
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : String(error), 'error');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove PIN
                </button>
              )}
            </div>
          </form>
        </>
      )}
      <h3>Initials</h3>
      <form className="initials-form" onSubmit={(event) => void saveInitials(event)}>
        <span className="user-avatar" aria-hidden="true">
          {initialsFor(staffName || '?', letters)}
        </span>
        <label>
          Your initials (up to 2)
          <input
            aria-label="Initials"
            maxLength={2}
            value={letters}
            placeholder={initialsFor(staffName || '?')}
            onChange={(event) => setLetters(event.target.value.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase())}
          />
          <small>Shown in the round avatar. Leave empty to use the first letters of your name.</small>
        </label>
        <button disabled={disabled || letters === initials}>
          <Icon name="save" /> Save initials
        </button>
      </form>
      <h3>Change password</h3>
      {businessAccount && (
        <p className="notice">
          This account also signs in the business. Changing its password also changes the business sign-in
          password.
        </p>
      )}
      <form onSubmit={(event) => void save(event, 'password')}>
        <div className="form-grid">
          <label>
            Current password
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
          <label>
            Confirm new password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </label>
        </div>
        <button disabled={disabled}>
          <Icon name="save" /> Save password
        </button>
      </form>
    </section>
  );
}
