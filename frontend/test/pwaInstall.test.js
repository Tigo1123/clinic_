import test from 'node:test';
import assert from 'node:assert/strict';
import { createPwaInstallController } from '../src/app/pwa/pwaInstallStore.js';

class Media extends EventTarget {
  constructor(matches = false) { super(); this.matches = matches; }
  change(matches) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}
function environment(navigator = {}, standalone = false) {
  const browser = new EventTarget();
  browser.navigator = navigator;
  browser.media = new Media(standalone);
  browser.matchMedia = () => browser.media;
  return browser;
}
function offer(browser, choice = { outcome: 'dismissed' }, prompt = () => Promise.resolve()) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  let calls = 0;
  Object.assign(event, { prompt: () => { calls++; return prompt(); }, userChoice: Promise.resolve(choice) });
  browser.dispatchEvent(event);
  return { event, calls: () => calls };
}
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};

test('unsupported browsers and an eligible-looking browser without an actual offer stay hidden', async () => {
  const browser = environment({ userAgent: 'Chrome Android' });
  browser.onbeforeinstallprompt = null;
  const controller = createPwaInstallController(browser);
  controller.start();
  const before = controller.getSnapshot();
  assert.equal(before.mode, 'hidden');
  assert.equal(controller.getSnapshot(), before, 'external-store snapshot is stable');
  assert.deepEqual(await controller.install(), { outcome: 'unavailable' });
  const invalid = new Event('beforeinstallprompt', { cancelable: true });
  browser.dispatchEvent(invalid);
  assert.equal(invalid.defaultPrevented, false);
  assert.equal(controller.getSnapshot().mode, 'hidden');
  controller.stop();
});

test('a valid offer is captured without prompting, regardless of browser identity', async () => {
  for (const userAgent of ['Chrome Android', 'SamsungBrowser Android', 'Other install-capable browser']) {
    const browser = environment({ userAgent });
    const controller = createPwaInstallController(browser);
    controller.start();
    const offered = offer(browser);
    assert.equal(offered.event.defaultPrevented, true);
    assert.equal(offered.calls(), 0, 'never prompt from the event listener');
    assert.equal(controller.getSnapshot().mode, 'prompt');
    const result = controller.install();
    assert.equal(offered.calls(), 1, 'prompt called synchronously before any await');
    assert.equal(controller.getSnapshot().pending, true);
    assert.equal((await result).outcome, 'dismissed');
    assert.equal(controller.getSnapshot().mode, 'hidden');
    controller.stop();
  }
});

test('double-clicks cannot reuse a prompt; dismissal requires a fresh browser event', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  const choice = deferred();
  const offered = offer(browser, choice.promise);
  const first = controller.install();
  assert.deepEqual(await controller.install(), { outcome: 'unavailable' });
  assert.equal(offered.calls(), 1);
  choice.resolve({ outcome: 'dismissed' });
  await first;
  browser.dispatchEvent(offered.event);
  assert.equal(controller.getSnapshot().mode, 'hidden', 'consumed event is never reused');
  const next = offer(browser, { outcome: 'accepted' });
  await controller.install();
  assert.equal(next.calls(), 1);
  assert.equal(controller.getSnapshot().outcome, 'accepted');
  assert.equal(controller.getSnapshot().mode, 'hidden');
  controller.stop();
});

test('accepted choice does not claim installation until appinstalled fires', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  offer(browser, { outcome: 'accepted' }); await controller.install();
  assert.equal(controller.getSnapshot().outcome, 'accepted');
  browser.dispatchEvent(new Event('appinstalled'));
  assert.deepEqual(controller.getSnapshot(), { mode: 'hidden', pending: false, outcome: 'installed' });
  const late = offer(browser);
  assert.equal(late.calls(), 0); assert.equal(controller.getSnapshot().mode, 'hidden');
  controller.stop();
});

test('installation from browser UI clears an unused offer immediately', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  const offered = offer(browser);
  browser.dispatchEvent(new Event('appinstalled'));
  assert.equal(controller.getSnapshot().mode, 'hidden');
  await controller.install(); assert.equal(offered.calls(), 0);
  controller.stop();
});

test('appinstalled during a pending prompt cannot be overwritten by a late dismissed choice', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  const choice = deferred(); offer(browser, choice.promise);
  const result = controller.install();
  browser.dispatchEvent(new Event('appinstalled'));
  assert.equal(controller.getSnapshot().pending, false);
  choice.resolve({ outcome: 'dismissed' }); await result;
  assert.equal(controller.getSnapshot().outcome, 'installed');
  assert.equal(controller.getSnapshot().mode, 'hidden');
  controller.stop();
});

test('a fresh offer arriving before dismissal settles survives the old request cleanup', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  const choice = deferred(); offer(browser, choice.promise); const first = controller.install();
  const fresh = offer(browser, { outcome: 'accepted' });
  choice.resolve({ outcome: 'dismissed' }); await first;
  assert.equal(controller.getSnapshot().mode, 'prompt');
  await controller.install(); assert.equal(fresh.calls(), 1);
  controller.stop();
});

test('prompt failures are caught and the used event is discarded', async () => {
  for (const prompt of [() => { throw new Error('not allowed'); }, () => Promise.reject(new Error('unavailable'))]) {
    const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
    const offered = offer(browser, { outcome: 'dismissed' }, prompt);
    assert.deepEqual(await controller.install(), { outcome: 'error' });
    assert.deepEqual(controller.getSnapshot(), { mode: 'hidden', pending: false, outcome: 'error' });
    await controller.install(); assert.equal(offered.calls(), 1);
    controller.stop();
  }
});

test('iPhone and desktop-mode iPad receive instructions, while a direct capability takes precedence', async () => {
  for (const navigator of [{ userAgent: 'iPhone', standalone: false }, { platform: 'MacIntel', maxTouchPoints: 5 }]) {
    const browser = environment(navigator); const controller = createPwaInstallController(browser); controller.start();
    assert.equal(controller.getSnapshot().mode, 'ios');
    assert.equal((await controller.install()).outcome, 'unavailable', 'instructions cannot trigger an invented prompt');
    offer(browser); assert.equal(controller.getSnapshot().mode, 'prompt');
    await controller.install(); assert.equal(controller.getSnapshot().mode, 'hidden');
    controller.stop();
  }
  const desktop = createPwaInstallController(environment({ platform: 'MacIntel', maxTouchPoints: 0 }));
  desktop.start(); assert.equal(desktop.getSnapshot().mode, 'hidden'); desktop.stop();
});

test('standalone, iOS navigator.standalone, and live display-mode changes hide the action', () => {
  for (const [navigator, standalone] of [[{}, true], [{ userAgent: 'iPhone', standalone: true }, false]]) {
    const browser = environment(navigator, standalone); const controller = createPwaInstallController(browser); controller.start();
    offer(browser); assert.equal(controller.getSnapshot().mode, 'hidden'); controller.stop();
  }
  const browser = environment(); const controller = createPwaInstallController(browser); controller.start();
  offer(browser); browser.media.change(true); assert.equal(controller.getSnapshot().mode, 'hidden');
  browser.media.change(false); assert.equal(controller.getSnapshot().mode, 'hidden', 'old offer was cleared');
  controller.stop();
});

test('listeners start only once, clean up, and stopped pending work cannot republish', async () => {
  const browser = environment(); const controller = createPwaInstallController(browser);
  let changes = 0; const unsubscribe = controller.subscribe(() => changes++);
  controller.start(); controller.start();
  const choice = deferred(); offer(browser, choice.promise); const first = controller.install();
  controller.stop(); const stopped = controller.getSnapshot();
  offer(browser); choice.resolve({ outcome: 'accepted' }); await first;
  assert.equal(controller.getSnapshot(), stopped);
  assert.equal(changes, 3);
  unsubscribe();
  const server = createPwaInstallController(); server.start(); assert.equal(server.getSnapshot().mode, 'hidden'); server.stop();
});
