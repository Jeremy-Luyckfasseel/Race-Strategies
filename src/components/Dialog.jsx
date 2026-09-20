/**
 * The card the app asks its questions on.
 *
 * Built on the same overlay language as the onboarding card — same backdrop,
 * same card, same display type — so a confirmation looks like part of this app
 * rather than like the operating system interrupting it.
 *
 * Every confirmation in the app comes through here, so they behave identically:
 * Escape and the backdrop cancel, Enter confirms, and focus lands on the
 * confirming button so the keyboard alone is enough.
 */

import { useEffect, useRef } from 'react';
import { DEFAULT_LANG, t } from '../i18n/strings';

export default function Dialog({ dialog, onClose, lang = DEFAULT_LANG }) {
  const confirmRef = useRef(null);

  // Escape cancels wherever focus is, which a listener on the card alone would
  // miss the moment anything outside it holds focus.
  useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(false); }
      else if (e.key === 'Enter') { e.preventDefault(); onClose(true); }
    };
    window.addEventListener('keydown', onKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  if (!dialog) return null;

  const isConfirm = dialog.kind === 'confirm';
  // The body arrives as one string with a blank line between the question and
  // its consequences — the shape `window.confirm` forced. Kept, because that
  // second paragraph is what says exactly which data is about to be reset, and
  // it reads better as its own block than as a run-on sentence.
  const paras = String(dialog.body || '').split('\n').map((p) => p.trim()).filter(Boolean);

  return (
    <div
      className="dlg-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }}
    >
      <div
        className={`dlg-card${dialog.danger ? ' dlg-card--danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
      >
        <h2 className="dlg-title" id="dlg-title">{dialog.title}</h2>

        {paras.map((p, i) => (
          <p key={i} className={i === 0 ? 'dlg-lead' : 'dlg-body'}>{p}</p>
        ))}

        <div className="dlg-actions">
          {isConfirm && (
            <button className="dlg-btn dlg-btn--cancel" onClick={() => onClose(false)}>
              {t('dlg_cancel', lang)}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`dlg-btn dlg-btn--go${dialog.danger ? ' dlg-btn--danger' : ''}`}
            onClick={() => onClose(true)}
          >
            {dialog.confirmLabel || t(isConfirm ? 'dlg_confirm' : 'dlg_ok', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
