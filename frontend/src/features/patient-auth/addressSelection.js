export function parseAddressStates(data) {
  if (!data || !Array.isArray(data.states)) throw new Error('ADDRESS_REFERENCE_UNAVAILABLE');
  const ids = new Set(); const arabic = new Set(); const english = new Set();
  for (const state of data.states) {
    if (!Number.isInteger(state.id) || state.id < 1 || state.id > 18 || ids.has(state.id) || typeof state.labelAr !== 'string' || !state.labelAr.trim() || typeof state.labelEn !== 'string' || !state.labelEn.trim()) throw new Error('ADDRESS_REFERENCE_UNAVAILABLE');
    const ar = state.labelAr.normalize('NFKC').trim().replace(/\s+/g, ' ');
    const en = state.labelEn.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    if (arabic.has(ar) || english.has(en)) throw new Error('ADDRESS_REFERENCE_UNAVAILABLE');
    ids.add(state.id); arabic.add(ar); english.add(en);
  }
  return data.states;
}
export function validAddressSelection(value, states) {
  return /^\d+$/.test(String(value)) && states.some(state => state.id === Number(value));
}
