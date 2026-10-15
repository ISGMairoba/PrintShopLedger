import { useState, type FormEvent, type InputHTMLAttributes } from 'react';
import Modal from '../Modal';
import { FeedbackBanner, type FeedbackTone } from '../Feedback';
import type { Shop } from './shared';

type Feedback = { message: string; tone: FeedbackTone };
const invalid = ({ message, tone }: Feedback) => tone === 'error' && !!message;

/**
 * Staff tills are shared, so staff and supervisor passwords are not filled in or saved by the
 * browser or a password manager: the boxes are marked as not-for-autofill ("new-password" stops
 * browsers filling a saved password; the data- attributes are honoured by 1Password, LastPass and
 * Bitwarden). Each sign-in form starts empty.
 */
function SharedDeviceInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      autoComplete={props.type === 'password' ? 'new-password' : 'off'}
      autoCapitalize="none"
      spellCheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-bwignore="true"
      data-form-type="other"
    />
  );
}

/** Shown while saved sign-ins load; offers a retry if loading stalls. */
export function StartupScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <main className="auth">
      <section className="auth-card">
        <h1>{error ? 'Could not restore your sign-in' : 'Opening PrintShopLedger…'}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button onClick={onRetry}>Retry sign-in loading</button>
          </>
        )}
      </section>
    </main>
  );
}

/** Business sign-in, with links to register a business or try the app locally. */
export function BusinessLogin({
  feedback,
  busy,
  online,
  onSubmit,
  onRegister,
  onTrial,
  onForgot,
}: {
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: () => void;
  onTrial: () => void;
  /** Send a password-reset email to this business email. */
  onForgot: (email: string) => Promise<void>;
}) {
  const [forgot, setForgot] = useState(false);
  if (forgot)
    return (
      <main className="auth">
        <div className="auth-card">
          <div className="brand-mark">S</div>
          <h1>Reset business password</h1>
          <p>
            Enter the business email. We will email a link to set a new password. Open the link on the device
            you want to sign in on.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
              void onForgot(email);
            }}
          >
            <label>
              Business email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <button disabled={busy || !online}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <button className="secondary" onClick={() => setForgot(false)}>
            Back to sign in
          </button>
          <p className="muted">
            Staff who forget their password: ask a Manager to set a new one on the Users page.
          </p>
          <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
        </div>
      </main>
    );
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-mark">S</div>
        <h1>PrintShopLedger</h1>
        <p>Every job. Every payment. Clearly tracked.</p>
        <form onSubmit={onSubmit}>
          <label>
            Business email
            <input
              name="email"
              type="email"
              autoComplete="username"
              aria-invalid={invalid(feedback)}
              required
            />
          </label>
          <label>
            Business password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={invalid(feedback)}
              required
            />
          </label>
          <button disabled={busy || !online}>Sign in</button>
          <button type="button" className="text-button" onClick={() => setForgot(true)}>
            Forgot password?
          </button>
        </form>
        <button className="secondary" disabled={busy || !online} onClick={onRegister}>
          Register your business
        </button>
        <button className="secondary" onClick={onTrial}>
          Try locally on this device
        </button>
        <p className="muted">Local trial data stays separate from business workspaces.</p>
        <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
      </div>
    </main>
  );
}

/** Opened from a password-reset email: choose the new business password. */
export function PasswordRecovery({
  feedback,
  busy,
  online,
  ready,
  onSubmit,
  onCancel,
}: {
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  /** The reset link was accepted (a recovery sign-in exists). */
  ready: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = !!again && password !== again;
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="brand-mark">S</div>
        <h1>Set a new business password</h1>
        {!ready ? (
          <p role="alert">
            Checking your reset link… If this stays, the link may have expired. Go back and send a new one.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!mismatch) onSubmit(password);
            }}
          >
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <small>At least 8 characters.</small>
            </label>
            <label>
              Type it again
              <input
                type="password"
                autoComplete="new-password"
                required
                aria-invalid={mismatch}
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
              {mismatch && <small className="danger-text">The passwords do not match.</small>}
            </label>
            <button disabled={busy || !online || mismatch || password.length < 8}>
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        )}
        <button className="secondary" onClick={onCancel}>
          Back to sign in
        </button>
        <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
      </div>
    </main>
  );
}

/** Shown while the signed-in business's workspaces load, or when that lookup fails. */
export function WorkspaceLoading({
  failed,
  error,
  online,
  onRetry,
  onSignOut,
}: {
  failed: boolean;
  error: string;
  online: boolean;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <main className="auth">
      <section className="auth-card">
        <h1>{failed ? 'Could not load your business' : 'Loading business workspace…'}</h1>
        {failed && (
          <>
            <p>
              Your sign-in succeeded, but the workspace lookup failed. This does not mean you need to create
              another workspace.
            </p>
            <p role="alert">{error || 'The server did not respond. Please retry.'}</p>
            <button disabled={!online} onClick={onRetry}>
              Retry workspace lookup
            </button>
          </>
        )}
        <button className="secondary" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </main>
  );
}

/** Staff username and password form; used on the staff sign-in screen and in Switch user. */
export function StaffLoginForm({
  feedback,
  busy,
  online,
  onSubmit,
}: {
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        Username
        <SharedDeviceInput name="username" aria-invalid={invalid(feedback)} maxLength={40} required />
      </label>
      <label>
        Password
        <SharedDeviceInput name="password" type="password" aria-invalid={invalid(feedback)} required />
      </label>
      <button disabled={busy || !online}>{busy ? 'Signing in…' : 'Sign in user'}</button>
    </form>
  );
}

/** The business is signed in; a staff member picks the workspace and signs in. */
export function StaffSignIn({
  shops,
  shop,
  onShop,
  feedback,
  busy,
  online,
  onSubmit,
}: {
  shops: Shop[];
  shop: Shop | null;
  onShop: (shop: Shop | null) => void;
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="auth">
      <section className="auth-card">
        <h1>Staff sign in</h1>
        <p>The business is signed in. Enter your username and password.</p>
        <label>
          Business
          <select
            value={shop?.id ?? ''}
            onChange={(e) => onShop(shops.find((item) => item.id === e.target.value) ?? null)}
          >
            {shops.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <StaffLoginForm feedback={feedback} busy={busy} online={online} onSubmit={onSubmit} />
        <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
      </section>
    </main>
  );
}

/** An Admin or higher signs in on the cashier's device to review held sync conflicts. */
export function SupervisorLogin({
  feedback,
  busy,
  online,
  onClose,
  onSubmit,
}: {
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  onClose: () => void;
  onSubmit: (username: string, password: string) => void;
}) {
  return (
    <Modal title="Supervisor conflict review" busy={busy} onClose={onClose}>
      <p>
        An Admin or higher rank must enter their credentials and personally review the pending work. This does
        not switch the cashier or move their saved sales.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onSubmit(String(form.get('username')), String(form.get('password')));
        }}
      >
        <label>
          Supervisor username
          <SharedDeviceInput name="username" aria-invalid={invalid(feedback)} required />
        </label>
        <label>
          Supervisor password
          <SharedDeviceInput name="password" type="password" aria-invalid={invalid(feedback)} required />
        </label>
        <button disabled={busy || !online}>Verify supervisor</button>
      </form>
      <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
    </Modal>
  );
}
