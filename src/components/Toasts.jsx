/**
 * The notices, bottom right.
 *
 * Bottom right because the top of the screen is the plan and the left is the
 * field: both are being read continuously, and a notice that covers either is
 * worse than no notice. Bottom right is the one corner of this layout that
 * holds nothing you steer by.
 *
 * Each notice carries the action it is about, and the action navigates rather
 * than executing. A toast offering "set the tyre" would need the five compound
 * buttons in a corner card, and picking the wrong one there writes a wrong
 * compound into the stint log and the learner for the rest of that stint. The
 * pickers already exist on the car's own dashboard, beside the tyre
 * temperatures and the driver list; the toast's job is to take you there.
 */

import { DEFAULT_LANG, t } from '../i18n/strings';

export default function Toasts({ toasts, onDismiss, lang = DEFAULT_LANG }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toasts" role="region" aria-live="polite" aria-label={t('toast_region', lang)}>
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind || 'info'}`}>
          <div className="toast-body">
            <span className="toast-title">{toast.title}</span>
            {toast.detail && <span className="toast-detail">{toast.detail}</span>}
          </div>

          <div className="toast-actions">
            {toast.action && (
              <button
                className="toast-go"
                onClick={() => { toast.action.run(); onDismiss(toast.id); }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('toast_dismiss', lang)}
              title={t('toast_dismiss', lang)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
