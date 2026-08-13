import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Dialog({ open, title, description, children, onClose, initialFocusRef }) {
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    const focusables = () => [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
    requestAnimationFrame(() => (initialFocusRef?.current || focusables()[0] || dialog).focus());
    function handleKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    dialog.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => { dialog.removeEventListener('keydown', handleKey); document.body.style.overflow = ''; returnFocusRef.current?.focus?.(); };
  }, [initialFocusRef, onClose, open]);
  if (!open) return null;
  return createPortal(<div className="ui-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby={description ? 'dialog-description' : undefined} tabIndex={-1}><h2 id="dialog-title">{title}</h2>{description && <p id="dialog-description">{description}</p>}{children}</section></div>, document.body);
}
