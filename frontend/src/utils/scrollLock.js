let lockCount = 0;
let savedOverflow = '';

// Locks page scroll on <html> (body overflow doesn't propagate when html sets overflow-x).
// Reference-counted so nested dialogs work; returns an idempotent unlock function.
export function lockPageScroll() {
  const root = document.documentElement;
  if (lockCount === 0) {
    savedOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  lockCount += 1;
  let released = false;
  return function unlockPageScroll() {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) root.style.overflow = savedOverflow;
  };
}
