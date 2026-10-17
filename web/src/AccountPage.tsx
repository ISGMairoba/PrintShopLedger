import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { useState, type FormEvent } from 'react';
import { supabase } from './cloud';
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
}: {
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
        <button disabled={disabled || !valid}>Save username</button>
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
        <button disabled={disabled}>Save password</button>
      </form>
    </section>
  );
}
