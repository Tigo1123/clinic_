const HIDDEN = Object.freeze({ mode: 'hidden', pending: false, outcome: null });

export function createPwaInstallController(browserWindow) {
  const listeners = new Set();
  let snapshot = HIDDEN;
  let deferred = null;
  let pending = false;
  let installed = false;
  let accepted = false;
  let sawPrompt = false;
  let outcome = null;
  let media;
  let started = false;
  let generation = 0;
  const consumed = new WeakSet();
  const navigator = browserWindow?.navigator;

  // Platform detection is only for manual iOS instructions. Direct installation
  // depends on the event's prompt capability, never a browser-name allowlist.
  const ios = Boolean(navigator && (
    'standalone' in navigator || /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  ));
  const standalone = () => Boolean(media?.matches || navigator?.standalone === true);
  const publish = () => {
    const hidden = installed || accepted || standalone();
    const mode = hidden ? 'hidden' : deferred || pending ? 'prompt' : ios && !sawPrompt ? 'ios' : 'hidden';
    const next = { mode, pending: pending && !hidden, outcome };
    if (Object.keys(next).every(key => next[key] === snapshot[key])) return;
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  };
  const onPrompt = event => {
    if (typeof event.prompt !== 'function' || consumed.has(event)) return;
    if (installed || accepted || standalone()) return;
    event.preventDefault();
    deferred = event;
    sawPrompt = true;
    outcome = null;
    publish();
  };
  const onInstalled = () => {
    installed = true;
    deferred = null;
    outcome = 'installed';
    publish();
  };
  const onModeChange = () => {
    if (standalone()) deferred = null;
    publish();
  };

  const stop = () => {
    if (!started) return;
    started = false;
    generation++;
    browserWindow.removeEventListener('beforeinstallprompt', onPrompt);
    browserWindow.removeEventListener('appinstalled', onInstalled);
    if (media?.removeEventListener) media.removeEventListener('change', onModeChange);
    else media?.removeListener?.(onModeChange);
    deferred = null;
    pending = false;
    publish();
  };
  const start = () => {
    if (!browserWindow || started) return stop;
    started = true;
    generation++;
    media = browserWindow.matchMedia?.('(display-mode: standalone)');
    browserWindow.addEventListener('beforeinstallprompt', onPrompt);
    browserWindow.addEventListener('appinstalled', onInstalled);
    if (media?.addEventListener) media.addEventListener('change', onModeChange);
    else media?.addListener?.(onModeChange);
    publish();
    return stop;
  };
  const install = async () => {
    if (!deferred || pending || installed || accepted || standalone()) return { outcome: 'unavailable' };
    const event = deferred;
    const ticket = generation;
    deferred = null;
    consumed.add(event);
    pending = true;
    publish();
    try {
      // Call synchronously from the button click, before the first await, to
      // retain the browser's transient user activation.
      const result = await event.prompt();
      const choice = await (event.userChoice ?? result);
      if (ticket !== generation) return { outcome: 'unavailable' };
      if (!choice || !['accepted', 'dismissed'].includes(choice.outcome)) throw new Error('No install choice');
      outcome = installed ? 'installed' : choice.outcome;
      if (choice.outcome === 'accepted') { accepted = true; deferred = null; }
      return choice;
    } catch {
      if (ticket === generation && !installed) outcome = 'error';
      return { outcome: 'error' };
    } finally {
      if (ticket === generation) { pending = false; publish(); }
    }
  };

  return {
    start, stop, install,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => HIDDEN,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}

export const pwaInstall = createPwaInstallController(typeof window === 'undefined' ? undefined : window);
