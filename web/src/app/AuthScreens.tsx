import type { FormEvent } from 'react';
import { FeedbackBanner, type FeedbackTone } from '../Feedback';
import type { Shop } from './shared';

type Feedback = { message: string; tone: FeedbackTone };
const invalid = ({ message, tone }: Feedback) => tone === 'error' && !!message;

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
}: {
  feedback: Feedback;
  busy: boolean;
  online: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRegister: () => void;
  onTrial: () => void;
}) {
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
        <input
          name="username"
          autoComplete="username"
          aria-invalid={invalid(feedback)}
          maxLength={40}
          required
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={invalid(feedback)}
          required
        />
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
