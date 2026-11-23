import Icon from './Icon';
import { hashPin, pinProblem } from './pin.mjs';

/**
 * Set, change or remove a PIN (My Account, and the "Set your PIN" window when the business
 * requires one). min: the business's minimum PIN length (Business Settings → Security).
 * required: the business requires a PIN, so it can't be removed.
 */
export default function PinForm({
  has,
  min,
  required,
  disabled,
  setBusy,
  save,
  onMessage,
}: {
  has: boolean;
  min: number;
  required: boolean;
  disabled: boolean;
  setBusy: (busy: boolean) => void;
  save: (hash: string | null) => Promise<void>;
  onMessage: (text: string, tone?: 'error') => void;
}) {
  const pattern = `[0-9]{${min},6}`;
  return (
    <form
      className="pin-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const next = String(form.get('pin') ?? '');
        const problem = pinProblem(next, String(form.get('again') ?? ''), min);
        if (problem) return onMessage(problem, 'error');
        setBusy(true);
        try {
          await save(await hashPin(next));
          (event.target as HTMLFormElement).reset();
          onMessage(has ? 'PIN changed.' : 'PIN set. It works on every device you sign in on.');
        } catch (error) {
          onMessage(error instanceof Error ? error.message : String(error), 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <label>
          {has ? 'New PIN' : 'PIN'}
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern={pattern}
            minLength={min}
            maxLength={6}
            required
          />
          <small>
            {min === 6 ? '6 digits' : `${min} to 6 digits`}, not easy to guess (not 1111 or 1234).
          </small>
        </label>
        <label>
          Type it again
          <input
            name="again"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            pattern={pattern}
            minLength={min}
            maxLength={6}
            required
          />
        </label>
      </div>
      <div className="material-actions">
        <button disabled={disabled}>
          <Icon name="save" /> {has ? 'Change PIN' : 'Set PIN'}
        </button>
        {has && !required && (
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              try {
                await save(null);
                onMessage('PIN removed. The app signs you out when it locks.');
              } catch (error) {
                onMessage(error instanceof Error ? error.message : String(error), 'error');
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
  );
}
