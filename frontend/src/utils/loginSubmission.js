export async function withLoginSubmissionLock(lock, setBusy, operation) {
  if (lock.current) return false;
  lock.current = true;
  setBusy(true);
  try {
    await operation();
    return true;
  } finally {
    lock.current = false;
    setBusy(false);
  }
}
