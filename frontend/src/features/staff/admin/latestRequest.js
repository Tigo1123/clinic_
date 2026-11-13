// Unique tokens distinguish repeated requests for the same doctor (A → B → A).
export function createLatestGuard() {
  let current = null;
  return {
    start(key) { current = { key }; return current; },
    isCurrent(token) { return current === token; }
  };
}
