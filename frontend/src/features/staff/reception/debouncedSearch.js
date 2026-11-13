export const PATIENT_SEARCH_DELAY_MS = 350;

export function createLatestSearchScheduler({
  delay = PATIENT_SEARCH_DELAY_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  let timer = null;
  let generation = 0;

  const cancel = () => {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const schedule = (task, { onSuccess, onError, onSettled } = {}) => {
    cancel();
    const scheduledGeneration = generation;
    timer = setTimer(async () => {
      timer = null;
      try {
        const result = await task();
        if (scheduledGeneration === generation) onSuccess?.(result);
      } catch (error) {
        if (scheduledGeneration === generation) onError?.(error);
      } finally {
        if (scheduledGeneration === generation) onSettled?.();
      }
    }, delay);
  };

  return { cancel, schedule };
}

export function visiblePatientDirectory(query, directoryPatients, searchResults) {
  return query.trim().length > 2 ? searchResults : directoryPatients;
}
