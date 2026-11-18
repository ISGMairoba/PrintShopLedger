import { useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import Icon from '../Icon';
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

/**
 * The sign-in screens' layout (like Tillora's): the app's story on the left in the brand colour,
 * the form on the right. On phones the story becomes a short band above the form.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth auth-split">
      <section className="auth-story" aria-label="About PrintShopLedger">
        <div className="auth-story-brand">
          <span className="brand-mark">P</span>
          <strong>PrintShopLedger</strong>
        </div>
        <div className="auth-story-text">
          <p className="auth-story-kicker">For print shops and the counters beside them</p>
          <h2>
            Every job.
            <br />
            Every payment.
          </h2>
          <p>Orders, money and stock for every branch, kept together in one place.</p>
        </div>
        <div className="auth-feature">
          <Icon name="wifi" />
          <div>
            <strong>Keep taking orders, even offline.</strong>
            <p>Your work sends as soon as you are connected again.</p>
          </div>
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-card auth-inner">{children}</div>
      </section>
    </main>
  );
}

/** Shown while saved sign-ins load; offers a retry if loading stalls. */
export function StartupScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <AuthShell>
      <h1>{error ? 'Could not restore your sign-in' : 'Opening PrintShopLedger…'}</h1>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button onClick={onRetry}>Retry sign-in loading</button>
        </>
      )}
    </AuthShell>
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
      <AuthShell>
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
      </AuthShell>
    );
  return (
    <AuthShell>
      <span className="badge auth-badge">Business sign-in</span>
      <h1>Welcome back.</h1>
      <p className="muted">Sign in with your business email. Staff sign in with their own username next.</p>
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
        <button className="auth-submit" disabled={busy || !online}>
          Sign in <Icon name="next" />
        </button>
        <button type="button" className="text-button" onClick={() => setForgot(true)}>
          Forgot password?
        </button>
      </form>
      <button
        type="button"
        className="text-button auth-register"
        disabled={busy || !online}
        onClick={onRegister}
      >
        New here? Register your business
      </button>
      <div className="auth-divider" role="separator">
        Or take a look around
      </div>
      <button className="secondary auth-demo" onClick={onTrial}>
        <Icon name="show" /> Explore demo
      </button>
      <p className="muted auth-demo-note">The demo runs on this device only, apart from any business.</p>
      <FeedbackBanner message={feedback.message} tone={feedback.tone} login />
    </AuthShell>
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
    <AuthShell>
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
    </AuthShell>
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
    <AuthShell>
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
    </AuthShell>
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
    <AuthShell>
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
    </AuthShell>
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

/**
 * The screen after auto-lock for someone with a PIN: their username and PIN unlock it on this
 * device (no internet needed). Switch user signs them out for someone else; Managers and above can
 * also sign the business out of this device.
 */
export function PinLockScreen({
  name,
  username,
  minutes,
  onUnlock,
  onSwitchUser,
  onSignOutBusiness,
}: {
  name: string;
  username: string;
  minutes: number;
  /** '' when unlocked, else the message to show. */
  onUnlock: (pin: string) => Promise<string>;
  onSwitchUser: () => void;
  /** Managers and above only. */
  onSignOutBusiness?: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <AuthShell>
      <span className="badge auth-badge">Locked</span>
      <h1>Welcome back{name ? `, ${name.split(/\s+/)[0]}` : ''}.</h1>
      <p className="muted">
        This device locked after {minutes} minute{minutes === 1 ? '' : 's'} without use. Enter your PIN to
        carry on where you left off.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          const problem = await onUnlock(pin);
          setBusy(false);
          setPin('');
          setError(problem);
        }}
      >
        <label>
          Username
          <input value={username} readOnly aria-readonly="true" />
        </label>
        <label>
          PIN
          <SharedDeviceInput
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,6}"
            minLength={4}
            maxLength={6}
            required
            autoFocus
            aria-invalid={!!error}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>
        <button className="auth-submit" disabled={busy || pin.length < 4}>
          {busy ? 'Checking…' : 'Unlock'} <Icon name="next" />
        </button>
      </form>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="auth-divider" role="separator">
        Not you?
      </div>
      <button type="button" className="secondary auth-demo" onClick={onSwitchUser}>
        <Icon name="switchUser" /> Switch user
      </button>
      {onSignOutBusiness && (
        <button type="button" className="text-button auth-register danger-text" onClick={onSignOutBusiness}>
          Sign out business on this device
        </button>
      )}
    </AuthShell>
  );
}
