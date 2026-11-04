# Low-Level Design: Google IMA DAI Support for video-caf-js

Companion to `HLD-google-dai.md`. This covers exact files, classes, methods, and
event mappings a builder needs to implement without going back for
clarification.

## 1. File layout changes

```
src/
  dai.js                 (new) — CAFDaiTracker class
  index.js                (modified) — export CAFDaiTracker
  entry-browser.js         (modified) — export CAFDaiTracker
  tracker.js               (unchanged — see §3 for why)
  ads.js                   (unchanged)
  __test__/
    dai.test.js            (new)
jest.config.js             (new — this repo has no test infra today)
.babelrc                   (new, or reuse existing babel config if one exists
                             for the webpack build — verify at implementation
                             time; video-hls-js's is a good template)
package.json                (modified — add jest/babel-jest/jest-environment-jsdom
                             devDependencies + a "test" script)
samples/
  dai/
    index.html             (new)
README.md                   (modified — document DAI usage section)
```

## 2. `src/dai.js` — `CAFDaiTracker`

```js
import nrvideo from '@newrelic/video-core'
import { version } from '../package.json'

export default class CAFDaiTracker extends nrvideo.VideoTracker {
  constructor(streamManager, options) {
    super(streamManager, options); // player = streamManager; playerManager comes from options.playerManager
    this.streamManager = streamManager;
    this.playerManager = options?.playerManager || null;
    this.contentTracker = options?.contentTracker || null; // optional, isMuted() fallback only
    this.currentAdData = null;
    this.adBreakData = null;
    this.streamData = null;
    this.cuePoints = [];
    this.eventHandlers = null;
    this._currentBitrate = 0;
  }

  static isUsing(streamManager) {
    return !!(streamManager && typeof streamManager.getStreamTime === 'function');
  }
  ...
}
```

Notes:

- `nrvideo.VideoTracker`'s real constructor signature is `(player, options)` —
  same as every other tracker in this family (confirmed against
  `video-core-js/src/videotracker.ts:66`, and already the pattern
  `CAFAdsTracker` follows for its own `player` param). Do **not** add a
  positional `playerManager` parameter — it must come from `options.playerManager`,
  exactly like `video-hls-js`'s `DaiTracker` takes `options.tag` rather than a
  positional arg (same historical mistake to avoid).
- Call shape: `new CAFDaiTracker(streamManager, { playerManager: receiverContext.getPlayerManager() })`.
- `options.playerManager` is **effectively required** in practice (every
  playhead/duration/bitrate/position getter below depends on it) but is not
  validated/thrown on in the constructor, consistent with how `CAFAdsTracker`
  doesn't validate its own `player` param either — getters simply return `null`
  if it's missing, same graceful-degradation style as the rest of this family.
- `options.contentTracker` (optional) is only used for `isMuted()` (§2.6) — CAF
  does not expose a synchronous mute getter on `PlayerManager` the way it does
  for time/duration/stats.

### 2.0 How DAI events reach NRDB as `VideoAdAction` (read before implementing)

Identical mechanism to every other tracker in this family — `CAFDaiTracker`
must call only the existing semantic methods on `VideoTracker` (`sendRequest`,
`sendDownload`, `sendStart`, `sendEnd`, `sendPause`, `sendResume`,
`sendAdBreakStart`, `sendAdBreakEnd`, `sendAdQuartile`, `sendAdClick`,
`sendError`, `sendRenditionChanged`, ...). It must **never** call
`sendVideoAction`/`sendVideoAdAction`/`Core.addTracker` itself, and must
**never** be passed to `nrvideo.Core.addTracker()`. This is already verified
against `video-core-js/src` by the hls.js LLD (§2.0 there) — the exact same
code paths apply here unmodified:

1. `cafTracker.setAdsTracker(daiTracker)` (called once by the app, per HLD §8)
   makes `video-core` call `disposeAdsTracker()` first — which disposes
   (`dispose() → unregisterListeners()`) whatever `CAFTracker` auto-created in
   its own `registerListeners()` (today, always a `CAFAdsTracker` — see §3) —
   then sets `daiTracker.setIsAd(true)`, `daiTracker.parentTracker = cafTracker`,
   and registers `daiTracker.on('*', funnelAdEvents.bind(cafTracker))`
   (`videotracker.ts:183-197`).
2. Every semantic send method branches on `this.isAd()`. Because it's `true`
   for `CAFDaiTracker`, e.g. `sendStart()` calls
   `this.sendVideoAdAction(AD_START, att)` instead of
   `sendVideoAction(CONTENT_START, att)` (`videotracker.ts:675-711`).
   `sendAdBreakStart`/`sendAdBreakEnd`/`sendAdQuartile`/`sendAdClick` only fire
   at all `if (this.isAd())` (`videotracker.ts:1055-1117`).
3. `sendVideoAdAction` emits on `daiTracker`'s own emitter, with `data` = all of
   `CAFDaiTracker`'s own getter overrides already baked in (ad id, title,
   quartile, `getAdPartner() → 'google-dai'`, position, bitrate, etc.).
4. `CAFDaiTracker` is never registered with `Core` directly — only `CAFTracker`
   is (in its own constructor, unchanged). The funnel re-emits on the parent
   (`cafTracker`), merging in the parent's session attributes
   (`viewId`, `viewSession`, `senderUserAgent`, etc.).
5. `CAFTracker`'s own `Core.addTracker`-installed listener catches that
   re-emission and calls `recordEvent('VideoAdAction', ...)` — the only point an
   HTTP/beacon payload actually goes out.

Net effect: content and ad data land in the same video view session, as
`VideoAction` vs `VideoAdAction` NRDB events, purely because `isAd()` is `true`
on `CAFDaiTracker` — no manual event-type selection or `Core` registration
belongs in `src/dai.js`.

### 2.1 Lifecycle: `registerListeners()` / `unregisterListeners()`

Same pattern as `video-videojs-js/src/ads/dai.js` and the (in-progress)
`video-hls-js/src/ads/dai.js`: build an `eventHandlers` map keyed by
`StreamEvent.Type`, register via `streamManager.addEventListener`, tear down
the same map in `unregisterListeners()`. Guard on
`google?.ima?.dai?.api?.StreamEvent` being defined — log a warning and no-op if
missing.

```js
registerListeners() {
  if (!this.streamManager || !google?.ima?.dai?.api?.StreamEvent) {
    nrvideo.Log.warn('CAFDaiTracker: StreamManager or DAI API not available');
    return;
  }
  const StreamEvent = google.ima.dai.api.StreamEvent.Type;

  this.eventHandlers = {
    [StreamEvent.LOADED]: this.onStreamLoaded.bind(this),
    [StreamEvent.STREAM_INITIALIZED]: this.onStreamInitialized.bind(this),
    [StreamEvent.ERROR]: this.onStreamError.bind(this),
    [StreamEvent.AD_BREAK_STARTED]: this.onAdBreakStarted.bind(this),
    [StreamEvent.AD_BREAK_ENDED]: this.onAdBreakEnded.bind(this),
    [StreamEvent.AD_PERIOD_STARTED]: this.onAdPeriodStarted.bind(this),
    [StreamEvent.AD_PERIOD_ENDED]: this.onAdPeriodEnded.bind(this),
    [StreamEvent.STARTED]: this.onAdStarted.bind(this),
    [StreamEvent.FIRST_QUARTILE]: this.onAdFirstQuartile.bind(this),
    [StreamEvent.MIDPOINT]: this.onAdMidpoint.bind(this),
    [StreamEvent.THIRD_QUARTILE]: this.onAdThirdQuartile.bind(this),
    [StreamEvent.COMPLETE]: this.onAdComplete.bind(this),
    [StreamEvent.SKIPPED]: this.onAdSkipped.bind(this),
    [StreamEvent.PAUSED]: this.onAdPaused.bind(this),
    [StreamEvent.RESUMED]: this.onAdResumed.bind(this),
    [StreamEvent.CLICK]: this.onAdClicked.bind(this),
    [StreamEvent.VIDEO_CLICKED]: this.onAdClicked.bind(this),
    [StreamEvent.CUEPOINTS_CHANGED]: this.onCuePointsChanged.bind(this),
    [StreamEvent.TIMED_METADATA]: this.onTimedMetadata.bind(this),
  };

  Object.entries(this.eventHandlers).forEach(([type, handler]) =>
    this.streamManager.addEventListener(type, handler)
  );
}

unregisterListeners() {
  if (this.streamManager && this.eventHandlers) {
    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.streamManager.removeEventListener(type, handler)
    );
  }
  this.eventHandlers = null;
}
```

`VideoTracker`'s base constructor already calls `registerListeners()` — no
manual call needed in the subclass constructor.

### 2.2 Event handler → New Relic call mapping

Identical table to `video-hls-js/.claude/LLD-google-dai.md` §2.2 and
`video-videojs-js/src/ads/dai.js` — this is player-agnostic, it's the DAI SDK's
own event surface, not CAF-specific:

| StreamEvent                | Handler                | NR call(s)                                  |
|-----------------------------|-------------------------|----------------------------------------------|
| `LOADED`                   | `onStreamLoaded`       | `extractStreamData()` then `sendRequest()`   |
| `STREAM_INITIALIZED`       | `onStreamInitialized`  | `sendDownload({ state: 'stream-initialized' })` |
| `ERROR`                    | `onStreamError`        | `sendError(extractErrorData(event))`         |
| `AD_BREAK_STARTED`         | `onAdBreakStarted`     | `extractAdBreakData()` then `sendAdBreakStart()` |
| `AD_BREAK_ENDED`           | `onAdBreakEnded`       | `sendAdBreakEnd()`, clear `adBreakData`      |
| `AD_PERIOD_STARTED`        | `onAdPeriodStarted`    | if no current break: delegate to `onAdBreakStarted` |
| `AD_PERIOD_ENDED`          | `onAdPeriodEnded`      | no-op (break may have more ads)              |
| `STARTED`                  | `onAdStarted`          | `extractAdData()` then `sendStart()`         |
| `FIRST_QUARTILE`           | `onAdFirstQuartile`    | `sendAdQuartile({ quartile: 1 })`            |
| `MIDPOINT`                 | `onAdMidpoint`         | `sendAdQuartile({ quartile: 2 })`            |
| `THIRD_QUARTILE`           | `onAdThirdQuartile`    | `sendAdQuartile({ quartile: 3 })`            |
| `COMPLETE`                 | `onAdComplete`         | `sendEnd()`, clear `currentAdData`           |
| `SKIPPED`                  | `onAdSkipped`          | `sendEnd({ skipped: true })`, clear `currentAdData` |
| `PAUSED`                   | `onAdPaused`           | `sendPause()`                                |
| `RESUMED`                  | `onAdResumed`          | `sendResume()`                               |
| `CLICK` / `VIDEO_CLICKED`  | `onAdClicked`          | `sendAdClick({ url: getClickThroughUrl() })` |
| `CUEPOINTS_CHANGED`        | `onCuePointsChanged`   | `extractCuePoints()` → store, no send        |
| `TIMED_METADATA`           | `onTimedMetadata`      | `extractTimedMetadata()` → store, no send    |

This is a 1:1 port of `video-videojs-js/src/ads/dai.js`'s handler bodies — reuse
the same `extract*` helper logic (try/catch around `event.getX()` calls, since
the DAI SDK's event objects throw if the wrong accessor is called for the event
type).

### 2.3 Data extraction helpers

Port directly from `video-videojs-js/src/ads/dai.js` (same method bodies, same
try/catch-and-log-warn-on-failure shape):

- `extractStreamData(event)` → `{ streamId, url, adTagParameters, streamType }`
- `extractAdBreakData(event)` → `{ adBreakId, adBreakTitle, adCount, position }`
- `extractAdData(event)` → `{ adId, creativeId, duration, title, description, advertiserName, clickThroughUrl, dealId, wrapperAdIds, position }`
- `extractErrorData(event)` → `{ errorCode, errorMessage, innerError }`, fallback
  `{ errorMessage: 'Unknown DAI error' }` if the event's own getters throw.
- `extractCuePoints(event)` → `event.getCuepoints() || []`
- `extractTimedMetadata(event)` → `{ type: event.getType(), data: event.getData() }`

### 2.4 `getAdPosition()`

Use `this.playerManager.getCurrentTimeSec()` / `this.playerManager.getDurationSec()`
— CAF's `PlayerManager` exposes these directly (confirmed
`src/tracker.js:111,117`), no DOM `<video>` tag needed (unlike hls.js, which has
no such abstraction and must use `this.tag.currentTime`/`this.tag.duration`):

```js
getAdPosition() {
  if (!this.currentAdData && !this.adBreakData) return null;
  const currentTime = this.playerManager?.getCurrentTimeSec?.() ?? 0;
  const duration = this.playerManager?.getDurationSec?.();
  if (currentTime < 5) return 'pre';
  if (duration && currentTime > duration - 10) return 'post';
  return 'mid';
}
```

### 2.5 Required `VideoTracker` overrides

| Method                  | Implementation                                                             |
|--------------------------|-----------------------------------------------------------------------------|
| `getTrackerName()`       | `'caf-dai'`                                                                |
| `getTrackerVersion()`    | `version` from `package.json` (same import as `CAFTracker`/`CAFAdsTracker`) |
| `getPlayerName()`        | `'caf-dai'`                                                                |
| `getPlayerVersion()`     | `'unknown'` — same reasoning as hls.js LLD §2.5: no reliable DAI-SDK version string exists; don't invent one, verify at implementation time against `google.ima.dai.api` for any exported version constant first |
| `getAdCuePoints()`       | `this.cuePoints`                                                           |
| `getDuration()`          | `this.currentAdData?.duration * 1000` or `null`                           |
| `getVideoId()`           | `this.currentAdData?.adId ?? null`                                        |
| `getAdCreativeId()`      | `this.currentAdData?.creativeId ?? null`                                  |
| `getTitle()`             | `this.currentAdData?.title ?? null`                                       |
| `getSrc()`               | `this.streamData?.url ?? null`                                            |
| `getPlayhead()`          | `this.streamManager.getStreamTime() * 1000`, fallback `this.playerManager?.getCurrentTimeSec?.() * 1000` in try/catch |
| `getAdPartner()`         | `'google-dai'` (must match the hls.js/videojs value exactly — cross-player dashboard queries depend on this being identical) |
| `getClickThroughUrl()`   | `this.currentAdData?.clickThroughUrl ?? null`                             |
| `getStreamType()`        | `this.streamData?.streamType`, else infer `this.playerManager?.getDurationSec?.() === Infinity ? 'live' : 'vod'` |
| `isMuted()`              | `this.contentTracker?.isMuted?.() ?? null` (CAF has no synchronous mute getter independent of `CAFTracker`'s cached `MEDIA_STATUS` payload — see HLD §9) |
| `getRenditionHeight()` / `getRenditionWidth()` | `null` (DAI stream rendition isn't separately exposed, same as the hls.js/videojs versions) |

### 2.6 Bitrate during ad playback

Unlike hls.js (which has no implicit access to playback stats and needs an
app-supplied `contentTracker`), CAF's `PlayerManager` already exposes
`getStats()` directly and `CAFDaiTracker` holds its own `options.playerManager`
reference — **no `contentTracker` dependency needed for bitrate**:

```js
getBitrate() {
  try {
    return this.playerManager.getStats().streamBandwidth;
  } catch (e) {
    return null;
  }
}

getRenditionBitrate() {
  return this._currentBitrate;
}
```

`_currentBitrate` is populated the same way `CAFAdsTracker` populates its own
copy — see §3 for why this specific method must exist on `CAFDaiTracker` too:

```js
onBitrateChanged(ev) {
  this._currentBitrate = ev.totalBitrate;
  this.sendRenditionChanged(); // inherited; branches on isAd() automatically
}
```

### 2.7 Helper/convenience methods (ported as-is)

`isLiveStream()`, `getCurrentAdBreak()`, `getCurrentAd()`, `getStreamData()` —
same bodies as the videojs version, operating on this class's own
`streamData`/`adBreakData`/`currentAdData` fields.

## 3. `src/tracker.js` (`CAFTracker`) changes — **none required**

This is the key difference from the hls.js design (which needed a new
`isAdsTrackerActive()` method and four new guard call sites). Here's the exact
reasoning, verified line-by-line against the current `src/tracker.js` and
`video-core-js/src/videotrackerstate.ts`, so the builder doesn't have to
re-derive it:

1. Every place `tracker.js` currently guards on ad state does so via
   `this.adsTracker.state.isAdBreak` (`onLoadedMetadata`, `onBuffering`, `onPlay`,
   `onPause`, `onPlaying`, `onSeekStart`, `onSeekEnd`, `onBitrateChanged` —
   `src/tracker.js:215,222,229,242,251,264,270,278,308`).
2. `isAdBreak` is a **generic** field on `VideoTrackerState`
   (`videotrackerstate.ts:17`), set `true` by `goAdBreakStart()`
   (`videotrackerstate.ts:721-724`) and `false` by `goAdBreakEnd()`
   (`videotrackerstate.ts:735-740`) — both called generically by the inherited
   base methods `sendAdBreakStart()`/`sendAdBreakEnd()`
   (`videotracker.ts:1055-1082`), **not** by anything `CAFAdsTracker`-specific.
3. `CAFDaiTracker.onAdBreakStarted()`/`onAdBreakEnded()` (§2.2) call exactly
   those same inherited `sendAdBreakStart()`/`sendAdBreakEnd()` methods. So
   `this.adsTracker.state.isAdBreak` reads correctly regardless of whether
   `this.adsTracker` is a `CAFAdsTracker` or a `CAFDaiTracker` — **no change
   needed to any of the eight guard call sites above.**
4. The one call that is genuinely `CAFAdsTracker`-specific (not inherited from
   the base class) is `this.adsTracker.onBitrateChanged(ev)`
   (`src/tracker.js:311`). This is why §2.6 requires `CAFDaiTracker` to
   implement its own `onBitrateChanged(ev)` method with the same signature —
   duck-typing compatibility, zero `tracker.js` changes.
5. `onError()` (`src/tracker.js:290-302`) checks `ev.detailedErrorCode` against
   two CAF-native `DetailedErrorCode`s specific to `BreakManager`/`BreakClip`
   loading (`BREAK_CLIP_LOADING_ERROR`, `BREAK_SEEK_INTERCEPTOR_ERROR`). DAI
   stream errors never produce these codes — they arrive instead via the DAI
   `StreamManager`'s own `ERROR` `StreamEvent`, handled entirely inside
   `CAFDaiTracker.onStreamError()` (§2.2), independent of `cast.framework.events`.
   No change needed here either.

**Verification task for the builder:** write an explicit test (LLD §5, Test
Group 4) asserting that attaching a `CAFDaiTracker` via `setAdsTracker()` and
driving it through an ad break causes `tracker.js`'s `onPause`/`onBuffering`
guards to route to the DAI tracker correctly, with zero modifications to
`tracker.js`. If this test fails, that is a signal the reasoning above has a
gap — stop and re-examine before changing `tracker.js`, rather than patching
around it.

## 4. Public exports

`src/index.js`:
```js
import CAFTracker, { CAFAdsTracker } from './tracker'
import CAFDaiTracker from './dai'

export default CAFTracker
export { CAFTracker, CAFAdsTracker, CAFDaiTracker }
```

`src/entry-browser.js`: same additions, keeping existing default-export
behavior for UMD/browser-global consumers (`window.CAFDaiTracker` should become
available alongside `window.CAFTracker`).

## 5. Tests — `src/__test__/dai.test.js`

This repo has **no existing test infrastructure** — add it first (Task 0 in the
plan), mirroring `video-hls-js/jest.config.js` exactly:

```js
// jest.config.js
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

Mock `google.ima.dai.api.StreamEvent.Type` as a plain object of string keys (no
real IMA SDK needed), and a fake `StreamManager`/`playerManager`:

```js
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
```

Test groups (one `it` per §2.2 table row, minimum):

1. **Construction & lifecycle** — registers/removes a listener for every
   `StreamEvent.Type`; `LOADED` → `sendRequest()` + `getSrc()`;
   `STREAM_INITIALIZED` → `sendDownload({ state: 'stream-initialized' })`;
   `AD_BREAK_STARTED`/`AD_BREAK_ENDED` → `sendAdBreakStart()`/`sendAdBreakEnd()`
   + `getCurrentAdBreak()` set/cleared; `AD_PERIOD_STARTED` fallback behavior;
   `AD_PERIOD_ENDED` no-op; `ERROR` with throwing accessors falls back to
   `{ errorMessage: 'Unknown DAI error' }` without crashing.
2. **Ad playback events** — `STARTED` → `sendStart()` + `getVideoId()`/
   `getTitle()`; each quartile → `sendAdQuartile({ quartile: N })`; `COMPLETE`
   → `sendEnd()` + cleared `currentAdData`; `SKIPPED` → `sendEnd({ skipped: true })`;
   `PAUSED`/`RESUMED` → `sendPause()`/`sendResume()`; `CLICK`/`VIDEO_CLICKED` →
   `sendAdClick({ url })`; ad position pre/mid/post from mock `playerManager`
   times; no stale data leaking into a second sequential ad break.
3. **Cue points, metadata, getters** — `CUEPOINTS_CHANGED` updates
   `getAdCuePoints()` with no `send*` call; `TIMED_METADATA` likewise; `getPlayhead()`
   uses `streamManager.getStreamTime()` then falls back to
   `playerManager.getCurrentTimeSec()` when it throws; `getStreamType()`
   live/vod inference; `isMuted()` delegates to `options.contentTracker` and
   returns `null` without one; `getBitrate()`/`getRenditionBitrate()` read from
   `playerManager.getStats()`/`_currentBitrate` respectively;
   `CAFDaiTracker.isUsing()` detects a `StreamManager`-shaped object.
4. **`CAFTracker` + `CAFDaiTracker` integration (no `tracker.js` changes
   required)** — construct a real `CAFTracker` with a mocked
   `receiverContext`/`PlayerManager`, call `setAdsTracker(new CAFDaiTracker(...))`,
   drive an ad break through the DAI tracker, and assert `onPause()`/
   `onBuffering()` on `CAFTracker` route to the DAI tracker's `sendPause()`/
   `sendBufferStart()` — proving LLD §3's reasoning holds in practice, not just
   on paper. Also assert the auto-created `CAFAdsTracker`'s
   `unregisterListeners()` fires exactly once as a side effect of
   `setAdsTracker()` (via a spy), confirming no listener leak.

## 6. Sample page — `samples/dai/index.html`

Mirrors `video-videojs-js/samples/dai/index.html`'s structure, adapted for a
CAF receiver page:

- Load the CAF Receiver SDK (`cast_receiver_framework.js`) and the Google IMA
  DAI SDK (`https://imasdk.googleapis.com/js/sdkloader/ima3_dai.js`).
- Load the built `@newrelic/video-caf` UMD bundle.
- `<cast-media-player>` element, same as this repo's existing `samples/sample.html`.
- Script wiring per HLD §8: `CAFTracker` → `StreamManager` → `CAFDaiTracker` →
  `setAdsTracker()` → `LOAD` message interceptor → `receiverContext.start()`.
- Reuse Google's public DAI test assets already used by the videojs sample
  (CMS ID `2548831`, video ID `tears-of-steel` for VOD; asset key
  `sN_IYUG8STe1ZzhIIE_ksA` for Live).

## 7. README changes

Add a "Google DAI Ad Tracking" section under Usage, documenting:
- The manual wiring snippet from HLD §8.
- That `CAFDaiTracker` requires the IMA DAI SDK (`ima3_dai.js`) loaded globally
  before construction.
- That `setAdsTracker()` replaces the auto-created native `CAFAdsTracker` — DAI
  and native VMAP/VAST breaks are mutually exclusive per session.
- The optional `options.contentTracker` param and what it affects (`isMuted()`
  only).

## 8. Build order for implementation

1. Add Jest/babel-jest test infra (§5 config) — Task 0.
2. `src/dai.js` (pure port + CAF adjustments per §2).
3. Exports (§4).
4. Tests (§5) — write and get green before touching samples/README, including
   the Test Group 4 integration proof that `tracker.js` needs no changes.
5. Sample page (§6).
6. README (§7).
