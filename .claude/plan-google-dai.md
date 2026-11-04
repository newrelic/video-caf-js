# Google IMA DAI Support for video-caf-js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `CAFDaiTracker` class to `@newrelic/video-caf` that tracks
Google IMA DAI ad breaks (VOD and Live) on a CAF receiver, correctly attributed
as `VideoAdAction` events linked to the existing `CAFTracker`'s content session
— without any changes to the existing native ad-break tracker (`CAFAdsTracker`)
or, per LLD §3, to `CAFTracker` itself.

**Architecture:** `CAFDaiTracker` (new, `src/dai.js`) extends
`nrvideo.VideoTracker` directly and listens to a `google.ima.dai.api.StreamManager`'s
`StreamEvent`s — a completely separate event source from CAF's native
`cast.framework.events` break events that `CAFAdsTracker` already handles.
Wiring is manual: the app constructs the `StreamManager` itself, then links it
with `cafTracker.setAdsTracker(daiTracker)`, which automatically disposes the
auto-created `CAFAdsTracker` via the inherited `dispose()`/`unregisterListeners()`
chain. `CAFTracker`'s existing ad-break guards (`this.adsTracker.state.isAdBreak`)
already work generically for any ads-tracker subclass that calls the inherited
`sendAdBreakStart()`/`sendAdBreakEnd()` — which `CAFDaiTracker` does — so no
`tracker.js` changes are needed, **except** that `CAFDaiTracker` must implement
its own `onBitrateChanged(ev)` method (not inherited) because `tracker.js`
calls that specific method by name during ad breaks.

**Tech Stack:** Vanilla JS (Babel/CommonJS transform), Jest + jsdom (**new** to
this repo — no test infra exists today), `@newrelic/video-core` (peer), Google
IMA DAI SDK (consumer-loaded global, not bundled), CAF Receiver SDK (consumer-
loaded global).

**Spec:** `.claude/HLD-google-dai.md`, `.claude/LLD-google-dai.md` — this plan
implements both; read LLD §2.0–§2.7 and §3 before Tasks 1–4, it has the exact
event→method mapping table, getter table, and the line-by-line proof that
`tracker.js` needs no changes.

## Global Constraints

- `nrvideo.VideoTracker`'s real constructor signature is `(player, options)` —
  `playerManager` comes from `options.playerManager`, never a positional
  parameter (LLD §2 note).
- `CAFDaiTracker` must never call `Core.addTracker`, or emit
  `VideoAdAction`/`VideoAction` directly — only the inherited semantic `send*`
  methods (LLD §2.0). Routing to `VideoAdAction` happens automatically via
  `isAd()` + the `setAdsTracker()` funnel.
- Support VOD and Live DAI through the identical event handling path — no
  stream-type branching in the event handlers (HLD §4).
- `CAFAdsTracker` (`src/ads.js`) and `CAFTracker` (`src/tracker.js`) must not be
  modified by this plan, with one exception noted per-task below (none — see
  LLD §3; `CAFDaiTracker` conforms to `tracker.js`'s existing expectations
  instead of the reverse).
- Fixed string values: `getTrackerName()` → `'caf-dai'`, `getPlayerName()` →
  `'caf-dai'`, `getAdPartner()` → `'google-dai'` (LLD §2.5) — the last one must
  match `video-videojs-js`/`video-hls-js` exactly for cross-player dashboard
  consistency.
- No new runtime dependencies — the IMA DAI SDK (`ima3_dai.js`) is loaded by
  the consuming application as a global `google.ima.dai.api.*`, never bundled
  or imported (HLD non-goals).
- This repo has no Jest setup today — Task 0 adds it, copied from
  `video-hls-js/jest.config.js` (confirmed compatible: the installed
  `@newrelic/video-core@4.1.6` package already ships the matching
  `__mock__.js`).

## Review Focus

1. **`tracker.js` truly needs zero changes** — the single highest-risk
   assumption in this plan (LLD §3). Task 3 includes an explicit integration
   test proving `CAFTracker.onPause`/`onBuffering` route correctly to a
   `CAFDaiTracker` with no source changes to `tracker.js`. If that test can't
   be made to pass without modifying `tracker.js`, stop and re-examine LLD §3
   rather than quietly patching around it.
2. **`setAdsTracker()` disposing the auto-created `CAFAdsTracker` cleanly** —
   assert via spy that `unregisterListeners()` fires exactly once on the old
   tracker and its CAF-native event listeners are actually removed (not just
   that the reference is dropped). Covered in Task 3.
3. **StreamManager event accessors throwing for the wrong event type** — same
   risk as the hls.js/videojs implementations; `extract*` helpers must catch
   and `Log.warn`, never propagate. Covered in Task 1/2 with a mock event whose
   getters throw.
4. **`onBitrateChanged(ev)` duck-type compatibility** — `CAFDaiTracker` must
   implement this method with the exact signature `tracker.js` calls it with
   (`this.adsTracker.onBitrateChanged(ev)`), or a DAI ad break with a bitrate
   change will throw. Covered in Task 2.
5. **Sequential ad breaks in one session** — `currentAdData`/`adBreakData`/
   `cuePoints` must not leak stale values from a previous break into the next.
   Covered in Task 2.

---

## File Layout

```
jest.config.js                (new)
package.json                  (modified — devDependencies + "test" script)
src/
  dai.js                       (new)
  index.js                     (modified — export CAFDaiTracker)
  entry-browser.js             (modified — export CAFDaiTracker)
  __test__/
    dai.test.js                (new)
    tracker-dai-integration.test.js  (new — Task 3's proof that tracker.js needs no changes)
samples/
  dai/
    index.html                 (new)
README.md                      (modified — DAI usage section)
```

---

### Task 0: Add Jest test infrastructure

**Files:**
- Create: `jest.config.js`
- Modify: `package.json`
- Create (if missing): `.babelrc` or reuse webpack's existing babel setup

**Interfaces:**
- Produces: `npm test` runs Jest with jsdom, resolving `@newrelic/video-core`
  to its shipped `__mock__.js`.

- [ ] **Step 1: Check for an existing babel config usable by `babel-jest`**

Run: `cat .babelrc babel.config.js 2>/dev/null` and check `webpack.config.js`'s
babel-loader options. If webpack configures babel presets inline rather than
via a `.babelrc`, create a minimal `.babelrc`:
```json
{
  "presets": ["@babel/preset-env"],
  "plugins": ["@babel/plugin-transform-modules-commonjs"]
}
```
(`@babel/preset-env` and `@babel/plugin-transform-modules-commonjs` are already
devDependencies — confirmed in `package.json`.)

- [ ] **Step 2: Add `jest.config.js`**

```js
module.exports = {
  testEnvironment: "jsdom",
  moduleFileExtensions: ["js", "jsx"],
  transform: { "^.+\\.jsx?$": "babel-jest" },
  moduleNameMapper: {
    "^@newrelic/video-core$": "<rootDir>/node_modules/@newrelic/video-core/__mock__.js",
  },
  testMatch: ["**/__test__/**/*.js?(x)", "**/?(*.)+(spec|test).js?(x)"],
};
```

- [ ] **Step 3: Add devDependencies and a test script**

```bash
npm install --save-dev jest babel-jest jest-environment-jsdom
```
Add to `package.json` `"scripts"`: `"test": "jest"`.

- [ ] **Step 4: Verify the harness works with a throwaway smoke test**

Create a temporary `src/__test__/smoke.test.js`:
```js
import nrvideo from '@newrelic/video-core';
it('resolves the video-core mock', () => { expect(nrvideo.VideoTracker).toBeDefined(); });
```
Run: `npx jest src/__test__/smoke.test.js` — expect PASS. Delete the file
afterward (Task 1 provides the real tests).

- [ ] **Step 5: Commit**

```bash
git add jest.config.js package.json package-lock.json .babelrc
git commit -m "chore(test): add Jest + jsdom test infrastructure"
```

---

### Task 1: `CAFDaiTracker` — construction, lifecycle, stream & ad-break events

**Files:**
- Create: `src/dai.js`
- Create: `src/__test__/dai.test.js`

**Interfaces:**
- Consumes: `nrvideo.VideoTracker` base (`constructor(player, options)`,
  `isAd()`, `setIsAd()`, `parentTracker`, `sendRequest()`, `sendDownload()`,
  `sendError()`, `sendAdBreakStart()`, `sendAdBreakEnd()`).
- Produces: `CAFDaiTracker` default export. Constructor
  `new CAFDaiTracker(streamManager, options)` where `options.playerManager` is
  the CAF `PlayerManager` and `options.contentTracker` is optional. Fields
  later tasks rely on: `this.streamManager`, `this.playerManager`,
  `this.contentTracker`, `this.streamData`, `this.adBreakData`,
  `this.currentAdData`, `this.cuePoints`, `this.eventHandlers`,
  `this._currentBitrate`. Static `CAFDaiTracker.isUsing(streamManager)`.

- [ ] **Step 1: Write the failing tests for construction + stream/ad-break lifecycle**

Create `src/__test__/dai.test.js` with shared fixtures this and later tasks
reuse:

```js
import CAFDaiTracker from '../dai';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      this._isAd = false;
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    registerListeners() {}
    sendRequest() {}
    sendDownload() {}
    sendError() {}
    sendAdBreakStart() {}
    sendAdBreakEnd() {}
    sendStart() {}
    sendAdQuartile() {}
    sendEnd() {}
    sendPause() {}
    sendResume() {}
    sendAdClick() {}
    sendRenditionChanged() {}
  }
  const nrvideo = { VideoTracker, Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  return { ...nrvideo, default: nrvideo };
});

const StreamEventType = {
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click', VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged', TIMED_METADATA: 'timedMetadata',
};

beforeEach(() => {
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    getStreamTime: jest.fn(() => 12.3),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockPlayerManager() {
  return {
    getCurrentTimeSec: jest.fn(() => 3),
    getDurationSec: jest.fn(() => 120),
    getStats: jest.fn(() => ({ streamBandwidth: 512000 })),
  };
}

describe('CAFDaiTracker — construction & lifecycle', () => {
  it('registers a listener for every StreamEvent.Type on construction', () => {
    const sm = createMockStreamManager();
    new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    expect(sm.addEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('removes all listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    tracker.unregisterListeners();
    expect(sm.removeEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('LOADED extracts stream data and calls sendRequest()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendRequest');
    const event = { getStreamData: () => ({ streamId: 's1', url: 'https://x/master.m3u8', adTagParameters: {} }) };
    sm._emit(StreamEventType.LOADED, event);
    expect(tracker.sendRequest).toHaveBeenCalled();
    expect(tracker.getSrc()).toBe('https://x/master.m3u8');
  });

  it('STREAM_INITIALIZED calls sendDownload({ state: "stream-initialized" })', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendDownload');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendDownload).toHaveBeenCalledWith({ state: 'stream-initialized' });
  });

  it('AD_BREAK_STARTED extracts break data and calls sendAdBreakStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    const event = { getAdBreak: () => ({ id: 'b1', title: 'Break 1', ads: [{}, {}] }) };
    sm._emit(StreamEventType.AD_BREAK_STARTED, event);
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toEqual(expect.objectContaining({ adBreakId: 'b1' }));
  });

  it('AD_BREAK_ENDED calls sendAdBreakEnd() and clears the current break', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  it('AD_PERIOD_STARTED with no current break falls back to starting a break', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'bumper', ads: [] }) });
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
  });

  it('AD_PERIOD_STARTED with a current break does not start a second one', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    expect(tracker.sendAdBreakStart).not.toHaveBeenCalled();
  });

  it('AD_PERIOD_ENDED does not end the break or send anything', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  it('ERROR with a throwing event object falls back to a generic message, not a crash', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendError');
    const throwingEvent = { getError: () => { throw new Error('boom'); } };
    expect(() => sm._emit(StreamEventType.ERROR, throwingEvent)).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'Unknown DAI error' }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__test__/dai.test.js`
Expected: FAIL — `Cannot find module '../dai'`.

- [ ] **Step 3: Implement `src/dai.js` to pass these tests**

Signature: `export default class CAFDaiTracker extends nrvideo.VideoTracker`.
Implement per LLD §2 (constructor + fields), §2.0 (do not deviate — only use
`send*` methods), §2.1 (`registerListeners`/`unregisterListeners`), the
`LOADED`/`STREAM_INITIALIZED`/`ERROR`/`AD_BREAK_STARTED`/`AD_BREAK_ENDED`/
`AD_PERIOD_STARTED`/`AD_PERIOD_ENDED` rows of §2.2, `extractStreamData`/
`extractAdBreakData`/`extractErrorData` from §2.3, `getTrackerName`/
`getTrackerVersion`/`getPlayerName`/`getSrc` from §2.5, and
`getCurrentAdBreak`/`getStreamData` from §2.7. Leave ad-playback events
(Task 2), remaining getters (Task 2), `onBitrateChanged` (Task 2), and
`isUsing` as a stub returning `false` for now.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__test__/dai.test.js`
Expected: PASS (all `describe('CAFDaiTracker — construction & lifecycle')` cases).

- [ ] **Step 5: Commit**

```bash
git add src/dai.js src/__test__/dai.test.js
git commit -m "feat(dai): add CAFDaiTracker stream and ad-break event handling"
```

---

### Task 2: `CAFDaiTracker` — ad playback events, getters, bitrate duck-typing

**Files:**
- Modify: `src/dai.js`
- Modify: `src/__test__/dai.test.js`

**Interfaces:**
- Consumes: fixtures from Task 1.
- Produces: `extractAdData()`, `getCurrentAd()`, `getAdPosition()`,
  `getClickThroughUrl()`, `getVideoId()`, `getAdCreativeId()`, `getTitle()`,
  `getDuration()`, `getAdCuePoints()`, `getPlayhead()`, `getStreamType()`,
  `isMuted()`, `getBitrate()`, `getRenditionBitrate()`, `onBitrateChanged(ev)`,
  `isLiveStream()`, `CAFDaiTracker.isUsing(streamManager)` — the full public
  surface Task 3 relies on.

- [ ] **Step 1: Write the failing tests**

Add to `dai.test.js` (ad playback events — same shape as hls.js LLD's Task 2
tests, using `createMockPlayerManager()` instead of a `tag` for position
classification):

```js
describe('CAFDaiTracker — ad playback events', () => {
  function startAd(tracker, sm, adOverrides = {}) {
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [{}] }) });
    sm._emit(StreamEventType.STARTED, { getAd: () => ({ getAdId: () => 'ad1', getCreativeId: () => 'c1', getDuration: () => 15, getTitle: () => 'My Ad', getClickThroughUrl: () => 'https://x', ...adOverrides }) });
  }

  it('STARTED extracts ad data and calls sendStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendStart');
    startAd(tracker, sm);
    expect(tracker.sendStart).toHaveBeenCalled();
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getTitle()).toBe('My Ad');
  });

  it.each([
    [StreamEventType.FIRST_QUARTILE, 1],
    [StreamEventType.MIDPOINT, 2],
    [StreamEventType.THIRD_QUARTILE, 3],
  ])('%s calls sendAdQuartile({ quartile: %i })', (type, quartile) => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendAdQuartile');
    startAd(tracker, sm);
    sm._emit(type, {});
    expect(tracker.sendAdQuartile).toHaveBeenCalledWith({ quartile });
  });

  it('COMPLETE calls sendEnd() and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    startAd(tracker, sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.COMPLETE, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith();
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('SKIPPED calls sendEnd({ skipped: true }) and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    startAd(tracker, sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.SKIPPED, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith({ skipped: true });
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('PAUSED calls sendPause(), RESUMED calls sendResume()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendPause');
    jest.spyOn(tracker, 'sendResume');
    startAd(tracker, sm);
    sm._emit(StreamEventType.PAUSED, {});
    sm._emit(StreamEventType.RESUMED, {});
    expect(tracker.sendPause).toHaveBeenCalled();
    expect(tracker.sendResume).toHaveBeenCalled();
  });

  it.each([StreamEventType.CLICK, StreamEventType.VIDEO_CLICKED])(
    '%s calls sendAdClick with the click-through url',
    (type) => {
      const sm = createMockStreamManager();
      const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
      jest.spyOn(tracker, 'sendAdClick');
      startAd(tracker, sm);
      sm._emit(type, {});
      expect(tracker.sendAdClick).toHaveBeenCalledWith({ url: 'https://x' });
    }
  );

  it.each([
    [2, 'pre'],
    [60, 'mid'],
    [117, 'post'],
  ])('classifies ad position as %s -> "%s" from playerManager time/duration', (currentTime, expected) => {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager();
    pm.getCurrentTimeSec = jest.fn(() => currentTime);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    startAd(tracker, sm);
    expect(tracker.getCurrentAd().position).toBe(expected);
  });

  it('a second ad break does not see stale data from the first', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    startAd(tracker, sm, { getAdId: () => 'ad1' });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    startAd(tracker, sm, { getAdId: () => 'ad2' });
    expect(tracker.getVideoId()).toBe('ad2');
  });
});

describe('CAFDaiTracker — cue points, metadata, getters, bitrate', () => {
  it('CUEPOINTS_CHANGED updates getAdCuePoints() without sending anything', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getCuepoints: () => [10, 30, -1] });
    expect(tracker.getAdCuePoints()).toEqual([10, 30, -1]);
  });

  it('getPlayhead() uses streamManager.getStreamTime() when available', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    expect(tracker.getPlayhead()).toBe(12300);
  });

  it('getPlayhead() falls back to playerManager.getCurrentTimeSec() when getStreamTime throws', () => {
    const sm = createMockStreamManager();
    sm.getStreamTime = jest.fn(() => { throw new Error('not ready'); });
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    expect(tracker.getPlayhead()).toBe(3000);
  });

  it('getStreamType() infers "live" from Infinity duration, "vod" otherwise', () => {
    const sm = createMockStreamManager();
    const livePm = createMockPlayerManager();
    livePm.getDurationSec = jest.fn(() => Infinity);
    const live = new CAFDaiTracker(sm, { playerManager: livePm });
    const vod = new CAFDaiTracker(createMockStreamManager(), { playerManager: createMockPlayerManager() });
    expect(live.getStreamType()).toBe('live');
    expect(vod.getStreamType()).toBe('vod');
    expect(live.isLiveStream()).toBe(true);
  });

  it('isMuted() delegates to options.contentTracker, null without one', () => {
    const sm = createMockStreamManager();
    const contentTracker = { isMuted: jest.fn(() => true) };
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager(), contentTracker });
    expect(tracker.isMuted()).toBe(true);
    const noFallback = new CAFDaiTracker(createMockStreamManager(), { playerManager: createMockPlayerManager() });
    expect(noFallback.isMuted()).toBeNull();
  });

  it('getBitrate() reads playerManager.getStats().streamBandwidth', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    expect(tracker.getBitrate()).toBe(512000);
  });

  it('onBitrateChanged(ev) updates _currentBitrate and calls sendRenditionChanged()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendRenditionChanged');
    tracker.onBitrateChanged({ totalBitrate: 777 });
    expect(tracker.getRenditionBitrate()).toBe(777);
    expect(tracker.sendRenditionChanged).toHaveBeenCalled();
  });

  it('CAFDaiTracker.isUsing() detects a StreamManager-shaped object', () => {
    expect(CAFDaiTracker.isUsing(createMockStreamManager())).toBe(true);
    expect(CAFDaiTracker.isUsing({})).toBe(false);
    expect(CAFDaiTracker.isUsing(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__test__/dai.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the remaining handlers and getters**

Add the `STARTED`/`FIRST_QUARTILE`/`MIDPOINT`/`THIRD_QUARTILE`/`COMPLETE`/
`SKIPPED`/`PAUSED`/`RESUMED`/`CLICK`/`VIDEO_CLICKED` rows from LLD §2.2,
`extractAdData()` from §2.3, `getAdPosition()` from §2.4, the getter table from
§2.5, `getBitrate()`/`getRenditionBitrate()`/`onBitrateChanged(ev)` from §2.6
(this is the method that lets `tracker.js` stay unmodified — see LLD §3.4), and
`isLiveStream`/`getCurrentAdBreak`/`getCurrentAd`/`getStreamData` from §2.7.
Implement `CAFDaiTracker.isUsing(streamManager)` for real.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__test__/dai.test.js`
Expected: PASS — full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/dai.js src/__test__/dai.test.js
git commit -m "feat(dai): add ad playback events, getters, and bitrate duck-typing"
```

---

### Task 3: Integration proof — `CAFTracker` + `CAFDaiTracker`, no `tracker.js` changes

**Files:**
- Create: `src/__test__/tracker-dai-integration.test.js`

**Interfaces:**
- Consumes: real `CAFTracker` (`src/tracker.js`, unmodified) and the finished
  `CAFDaiTracker` from Tasks 1–2.
- Produces: proof (LLD §3, Review Focus #1) that attaching a `CAFDaiTracker`
  via `setAdsTracker()` correctly routes `CAFTracker`'s existing guards with
  zero source changes to `tracker.js`.

- [ ] **Step 1: Write the integration tests**

```js
import CAFTracker, { CAFAdsTracker } from '../tracker';
import CAFDaiTracker from '../dai';

// Reuse the same jest.mock('@newrelic/video-core', ...) shape from dai.test.js,
// extended with whatever CAFTracker's own constructor needs (Core.addTracker, etc.
// — check src/ads.js's own existing test patterns if any exist by this point, or
// model the mock on video-core's real __mock__.js directly).

function createMockReceiverContext(playerManager) {
  return {
    getPlayerManager: () => playerManager,
    getSenders: () => [],
    start: jest.fn(),
  };
}

function createMockPlayerManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn(),
    getCurrentTimeSec: jest.fn(() => 3),
    getDurationSec: jest.fn(() => 120),
    getStats: jest.fn(() => ({ streamBandwidth: 512000 })),
    getMediaInformation: jest.fn(() => ({ contentId: 'c1' })),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

describe('CAFTracker + CAFDaiTracker integration', () => {
  it('setAdsTracker(daiTracker) disposes the auto-created CAFAdsTracker exactly once', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const nativeAdsTracker = tracker.adsTracker;
    expect(nativeAdsTracker).toBeInstanceOf(CAFAdsTracker);
    const disposeSpy = jest.spyOn(nativeAdsTracker, 'unregisterListeners');

    const sm = { addEventListener: jest.fn(), removeEventListener: jest.fn(), getStreamTime: jest.fn(() => 1) };
    const daiTracker = new CAFDaiTracker(sm, { playerManager: pm });
    tracker.setAdsTracker(daiTracker);

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(tracker.adsTracker).toBe(daiTracker);
  });

  it('onPause() routes to the DAI tracker during a DAI ad break, with zero tracker.js changes', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const sm = { addEventListener: jest.fn(), removeEventListener: jest.fn(), getStreamTime: jest.fn(() => 1) };
    const daiTracker = new CAFDaiTracker(sm, { playerManager: pm });
    tracker.setAdsTracker(daiTracker);

    daiTracker.sendAdBreakStart(); // sets state.isAdBreak = true generically
    const daiPauseSpy = jest.spyOn(daiTracker, 'sendPause');
    const contentPauseSpy = jest.spyOn(tracker, 'sendPause');

    tracker.onPause({ ended: false });

    expect(daiPauseSpy).toHaveBeenCalled();
    expect(contentPauseSpy).not.toHaveBeenCalled();
  });

  it('onBitrateChanged() during a DAI ad break calls daiTracker.onBitrateChanged(ev) without throwing', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const sm = { addEventListener: jest.fn(), removeEventListener: jest.fn(), getStreamTime: jest.fn(() => 1) };
    const daiTracker = new CAFDaiTracker(sm, { playerManager: pm });
    tracker.setAdsTracker(daiTracker);
    daiTracker.sendAdBreakStart();

    expect(() => tracker.onBitrateChanged({ totalBitrate: 999 })).not.toThrow();
    expect(daiTracker.getRenditionBitrate()).toBe(999);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail or pass**

Run: `npx jest src/__test__/tracker-dai-integration.test.js`
Expected: depends on whether `CAFTracker`'s constructor/mocks need adjustment
to run standalone under Jest for the first time in this repo (this is the
first test ever written against `tracker.js`) — fix fixtures, not
`tracker.js`'s logic, to get these passing. If a test genuinely cannot pass
without editing `tracker.js`, stop (Review Focus #1) and re-verify LLD §3's
reasoning before touching it.

- [ ] **Step 3: Fix fixtures until green, with no edits to `src/tracker.js` or `src/ads.js`**

- [ ] **Step 4: Commit**

```bash
git add src/__test__/tracker-dai-integration.test.js
git commit -m "test(dai): prove CAFTracker needs no changes to support CAFDaiTracker"
```

---

### Task 4: Public exports

**Files:**
- Modify: `src/index.js`
- Modify: `src/entry-browser.js`
- Create: `src/__test__/index.test.js`

**Interfaces:**
- Consumes: `CAFDaiTracker` default export from Tasks 1–2's finished `src/dai.js`.
- Produces: `CAFDaiTracker` available as a named export from both
  `@newrelic/video-caf` and `@newrelic/video-caf/browser`, and as
  `window.CAFDaiTracker` in the UMD browser build.

- [ ] **Step 1: Write the failing test**

```js
import { CAFDaiTracker } from '../index';

describe('CAFDaiTracker Index Export', () => {
  it('should export CAFDaiTracker as a named export', () => {
    expect(CAFDaiTracker).toBeDefined();
    expect(typeof CAFDaiTracker).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__test__/index.test.js`
Expected: FAIL — `CAFDaiTracker` is `undefined`.

- [ ] **Step 3: Update exports**

`src/index.js`:
```js
import CAFTracker, { CAFAdsTracker } from './tracker'
import CAFDaiTracker from './dai'

export default CAFTracker
export { CAFTracker, CAFAdsTracker, CAFDaiTracker }
```

`src/entry-browser.js` — same additional export, preserving existing
default-export behavior for the UMD global.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__test__/index.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.js src/entry-browser.js src/__test__/index.test.js
git commit -m "feat(dai): export CAFDaiTracker from package entry points"
```

---

### Task 5: Sample page + README

**Files:**
- Create: `samples/dai/index.html`
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished public API from Tasks 1–4 (`new CAFTracker(receiverContext, options)`,
  `new CAFDaiTracker(streamManager, { playerManager })`,
  `cafTracker.setAdsTracker(daiTracker)`).
- Produces: nothing consumed by other tasks — manual verification only.

- [ ] **Step 1: Build `samples/dai/index.html` per LLD §6**

CAF Receiver SDK + Google IMA DAI SDK (`ima3_dai.js`) + the built
`@newrelic/video-caf` UMD bundle, `<cast-media-player>` element (reuse this
repo's existing `samples/sample.html` as the base to adapt, keeping its license
key placeholders). Wiring order per HLD §8: construct `CAFTracker` → construct
`StreamManager` → construct `CAFDaiTracker` → `setAdsTracker` → register a
`LOAD` message interceptor that calls `streamManager.requestStream()` and
substitutes the stitched URL → `receiverContext.start()`. Reuse Google's
public DAI test assets (CMS ID `2548831`, video ID `tears-of-steel` for VOD;
asset key `sN_IYUG8STe1ZzhIIE_ksA` for Live).

- [ ] **Step 2: Manually verify on the Chromecast Device Emulator**

Run: `npm run build:dev`, load `samples/dai/index.html` on the
[Chromecast Device Emulator](https://github.com/ajaidanial/chromecast-device-emulator)
(per this repo's existing Prerequisites section), cast a DAI VOD asset.
Expected: content plays, ad breaks are observable via `nrvideo.Log` debug
output or a beacon request once an ad break starts, no console errors.

- [ ] **Step 3: Write the README section per LLD §7**

Add a "Google DAI Ad Tracking" section under Usage: the wiring snippet from
HLD §8, the requirement that `ima3_dai.js` be loaded globally before
constructing `CAFDaiTracker`, the note that `setAdsTracker()` replaces the
auto-created native `CAFAdsTracker` (DAI and native VMAP/VAST breaks are
mutually exclusive per session), and what `options.contentTracker` affects
(`isMuted()` only, LLD §2.5).

- [ ] **Step 4: Commit**

```bash
git add samples/dai/index.html README.md
git commit -m "docs(dai): add DAI sample page and README usage section"
```
