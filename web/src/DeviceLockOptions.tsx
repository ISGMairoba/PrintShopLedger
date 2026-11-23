import { useState } from 'react';
import Icon from './Icon';

/**
 * My Account → PIN: this device's lock options (plans/lock-screen.md). Remembered sign-in (when the
 * business remembers people on devices) and face/fingerprint unlock (when allowed and supported).
 */
export default function DeviceLockOptions({
  name,
  remembering,
  rememberDays,
  onForgetMe,
  biometric,
  disabled,
  setBusy,
  onMessage,
}: {
  name: string;
  remembering: boolean;
  rememberDays: number;
  onForgetMe: () => Promise<void>;
  /** Shown when the business allows it and this device supports it. owner: whose it is now. */
  biometric?: {
    owner: string | null;
    mine: boolean;
    hasPin: boolean;
    onTurnOn: () => Promise<void>;
    onTurnOff: () => Promise<void>;
  };
  disabled: boolean;
  setBusy: (busy: boolean) => void;
  onMessage: (text: string, tone?: 'error') => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await work();
      onMessage(done);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {remembering && (
        <>
          <h3>This device remembers you</h3>
          <p className="muted">
            {`You can switch back to your account here with your PIN, even without internet, for ${rememberDays} days after you last signed in here with your password.`}
          </p>
          <div className="material-actions">
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() => void run(onForgetMe, 'This device no longer remembers you.')}
            >
              <Icon name="logout" /> Remove me from this device
            </button>
          </div>
        </>
      )}
      {biometric && (
        <>
          <h3>Face/fingerprint unlock on this device</h3>
          {biometric.mine ? (
            <>
              <p className="muted">
                {'On. This device’s face or fingerprint unlock opens the app as you. Your PIN still works.'}
              </p>
              <div className="material-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={disabled}
                  onClick={() => void run(biometric.onTurnOff, 'Face/fingerprint unlock turned off.')}
                >
                  Turn off
                </button>
              </div>
            </>
          ) : !biometric.hasPin ? (
            <p className="muted">Set a PIN first: it is always there when face/fingerprint unlock is not.</p>
          ) : (
            <>
              <p className="muted">
                {biometric.owner
                  ? `It belongs to ${biometric.owner} on this device now. Turning it on for you replaces that.`
                  : 'Use this device’s own face or fingerprint unlock instead of typing your PIN.'}
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label="I agree the face/fingerprint unlock belongs to me"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                />
                <span>
                  {`This device’s face/fingerprint unlock belongs to me. Anyone who unlocks this app with it will be signed in as me, ${name}.`}
                </span>
              </label>
              <div className="material-actions">
                <button
                  type="button"
                  disabled={disabled || !agreed}
                  onClick={() =>
                    void run(async () => {
                      await biometric.onTurnOn();
                      setAgreed(false);
                    }, 'Face/fingerprint unlock is on for you on this device.')
                  }
                >
                  <Icon name="lock" /> Turn on face/fingerprint unlock
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
