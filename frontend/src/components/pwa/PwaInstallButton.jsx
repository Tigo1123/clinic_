import { useCallback, useState } from 'react';
import { Download, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePwaInstall } from '../../app/pwa/usePwaInstall.js';
import Dialog from '../ui/Dialog.jsx';
import './pwaInstall.css';

export default function PwaInstallButton({ compact = false, onInteract }) {
  const { t } = useTranslation();
  const { mode, pending, outcome, install } = usePwaInstall();
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const closeInstructions = useCallback(() => setInstructionsOpen(false), []);
  const visible = mode === 'prompt' || mode === 'ios';
  if (!visible && !outcome) return null;
  const status = { accepted: 'pwaInstallAccepted', installed: 'pwaInstallComplete', dismissed: 'pwaInstallDismissed', error: 'pwaInstallUnavailable' }[outcome];
  return <>
    {visible && <button
      type="button"
      className={`pwa-install-button${compact ? ' pwa-install-button--compact' : ''}`}
      disabled={pending}
      aria-busy={pending}
      aria-label={t(mode === 'ios' ? 'pwaInstallIosLabel' : 'pwaInstallLabel')}
      aria-haspopup={mode === 'ios' ? 'dialog' : undefined}
      aria-expanded={mode === 'ios' ? instructionsOpen : undefined}
      title={t(mode === 'ios' ? 'pwaInstallIosLabel' : 'pwaInstallLabel')}
      onClick={() => { onInteract?.(); if (mode === 'ios') setInstructionsOpen(true); else void install(); }}
    >
      <Download size={18} aria-hidden="true" />
      <span className="pwa-install-button__label">{t('pwaInstallApp')}</span>
    </button>}
    <Dialog open={mode === 'ios' && instructionsOpen} title={t('pwaInstallIosTitle')} description={t('pwaInstallIosInstructions')} onClose={closeInstructions}>
      <p className="pwa-install-hint"><Share size={20} aria-hidden="true" /><span>{t('pwaInstallIosShare')}</span></p>
      <button type="button" className="ui-button ui-button--secondary pwa-install-hint-close" onClick={closeInstructions}>{t('close')}</button>
    </Dialog>
    <span className="sr-only" role="status" aria-live="polite">{status ? t(status) : ''}</span>
  </>;
}
