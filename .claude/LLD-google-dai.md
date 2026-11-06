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
    index.test.js          (new — export surface, incl. the UMD static of §4)
    tracker-dai-integration.test.js
                           (new — §3's guard proof, see §5 group 7)
jest.config.js             (new — this repo has no test infra today)
.babelrc                   (new, or reuse existing babel config if one exists
                             for the webpack build — verify at implementation
                             time; video-hls-js's is a good template)
package.json                (modified — add jest/babel-jest/jest-environment-jsdom
                             devDependencies + a "test" script, and exclude
                             src/__test__ from the published "files" list)
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
    this.streamManager = streamManager; // readability alias; this.player is load-bearing
    this.playerManager = options?.playerManager || null;
    this.contentTracker = options?.contentTracker || null; // optional, see §2.5/§2.2
    this.currentAdData = null;
    this.adStartStreamTime = null;
    this.adBreakData = null;
    this.adBreakFromPeriod = false;
    this.streamData = null;
    this.cuePoints = [];
    this._currentBitrate = 0;
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
  playhead/duration/bitrate/rendition getter below depends on it) but is not
  validated/thrown on in the constructor, consistent with how `CAFAdsTracker`
  doesn't validate its own `player` param either — getters simply return
  `null`/`0` if it's missing, same graceful-degradation style as the rest of
  this family.
- `options.contentTracker` (optional) must be the `CAFTracker` tracking the
  content — never a `CAFAdsTracker` (`setAdsTracker()` disposes the
  auto-created one, and it has no mute state of its own). It supplies
  `isMuted()` (§2.5) — CAF exposes no synchronous mute getter on
  `PlayerManager` the way it does for time/duration/stats — and acts as the
  fallback target for stream-error reporting when `parentTracker` is unset
  (§2.2).
- There is deliberately **no** `static isUsing(streamManager)` detector. The
  real `StreamManager` has no `getStreamTime()` (nor any other method unique to
  it), so the shape test an earlier draft used could never match a live SDK
  object; `video-hls-js` removed its equivalent for the same reason rather than
  inventing a replacement.

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

Same pattern as `video-hls-js/src/ads/dai.js`: build an `eventHandlers` map
keyed by `StreamEvent.Type`, register via `addEventListener`, tear down the
same map in `unregisterListeners()`.

Two details that are easy to get wrong:

- Register against **`this.player`**, not `this.streamManager`. The base
  constructor calls `registerListeners()` from `setPlayer()`, which runs before
  the subclass constructor body executes, so `this.streamManager` is still
  `undefined` at that point and every listener would be silently skipped.
  `this.player` is already the `StreamManager` (the base class sets it).
- Test the SDK global with `typeof` first. Optional chaining does **not**
  protect an undeclared identifier: `google?.ima` throws a `ReferenceError`
  when the IMA DAI script has not loaded, which is exactly the case the guard
  exists for.

```js
registerListeners() {
  const sdk = typeof google === 'undefined' ? undefined : google?.ima?.dai?.api;

  if (!this.player || !sdk?.StreamEvent) {
    nrvideo.Log.warn('CAFDaiTracker: StreamManager or DAI API not available');
    return;
  }
  const StreamEvent = sdk.StreamEvent.Type;

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
  };

  Object.entries(this.eventHandlers).forEach(([type, handler]) =>
    this.player.addEventListener(type, handler)
  );
}

unregisterListeners() {
  if (this.player && this.eventHandlers) {
    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.player.removeEventListener(type, handler)
    );
  }
  this.eventHandlers = null;
}
```

`TIMED_METADATA` is deliberately **not** subscribed to: the real `StreamEvent`
has no `getType()`/`getData()`, so a handler could only ever log a warning.
`video-hls-js` dropped its equivalent handler for the same reason.

`VideoTracker`'s base constructor already calls `registerListeners()` — no
manual call needed in the subclass constructor.

### 2.2 Event handler → New Relic call mapping

Same table as `video-hls-js/src/ads/dai.js` — this is player-agnostic, it's the
DAI SDK's own event surface, not CAF-specific:

| StreamEvent                | Handler                | NR call(s)                                  |
|-----------------------------|-------------------------|----------------------------------------------|
| `LOADED`                   | `onStreamLoaded`       | `extractStreamData()` → store, **no send**   |
| `STREAM_INITIALIZED`       | `onStreamInitialized`  | reset per-stream state, `sendDownload({ state: 'stream-initialized' })` |
| `ERROR`                    | `onStreamError`        | `sendError()` on the content tracker, and on itself when a break is open |
| `AD_BREAK_STARTED`         | `onAdBreakStarted`     | `extractAdBreakData()` then `sendAdBreakStart(adBreakAttributes())` |
| `AD_BREAK_ENDED`           | `onAdBreakEnded`       | `sendEnd()` for an ad still in flight, then `sendAdBreakEnd(adBreakAttributes())`, clear `adBreakData` |
| `AD_PERIOD_STARTED`        | `onAdPeriodStarted`    | if no current break: set `adBreakFromPeriod` and delegate to `onAdBreakStarted` |
| `AD_PERIOD_ENDED`          | `onAdPeriodEnded`      | if `adBreakFromPeriod`: delegate to `onAdBreakEnded`; otherwise no-op (an SDK-announced break may have more ads) |
| `STARTED`                  | `onAdStarted`          | `extractAdData()`, capture `adStartStreamTime`, backfill break data, then `sendRequest()` **and** `sendStart()` |
| `FIRST_QUARTILE`           | `onAdFirstQuartile`    | `sendAdQuartile({ quartile: 1 })` if an ad is in flight |
| `MIDPOINT`                 | `onAdMidpoint`         | `sendAdQuartile({ quartile: 2 })` if an ad is in flight |
| `THIRD_QUARTILE`           | `onAdThirdQuartile`    | `sendAdQuartile({ quartile: 3 })` if an ad is in flight |
| `COMPLETE`                 | `onAdComplete`         | `sendEnd()`, `clearCurrentAd()`              |
| `SKIPPED`                  | `onAdSkipped`          | `sendEnd({ skipped: true })`, `clearCurrentAd()` |
| `PAUSED`                   | `onAdPaused`           | `sendPause()`                                |
| `RESUMED`                  | `onAdResumed`          | `sendResume()`                               |
| `CLICK` / `VIDEO_CLICKED`  | `onAdClicked`          | if an ad is in flight: `sendAdClick({ url })`, url key omitted when unknown |
| `CUEPOINTS_CHANGED`        | `onCuePointsChanged`   | `extractCuePoints()` → store, no send        |

The non-obvious rules behind that table, all of them bugs found in review of the
first implementation:

1. **One `sendRequest()` per ad, at `STARTED` — not once per stream at
   `LOADED`.** video-core gates `AD_START` on `state.isRequested`
   (`videotrackerstate.ts:549`) and clears that flag on both `goEnd()` and
   `goAdBreakEnd()` (`:570`, `:735`), so a single request at `LOADED` meant only
   the session's very first ad ever reported a start.
2. **An ad still in flight when its break ends must be ended first.**
   `goAdBreakEnd()` clears `isRequested` but not `isStarted`, and only
   `sendEnd()` resets that — so an unfinished ad (a seek out of a mid-roll, an
   ad error) would block `AD_START` for every later ad in the session.
3. **A break opened from `AD_PERIOD_STARTED` must close at
   `AD_PERIOD_ENDED`.** Bumpers and some live breaks fire only period events,
   with no `AD_BREAK_ENDED` to close them — leaving `state.isAdBreak` true for
   the rest of the session, which makes `CAFTracker`'s guard suppress *all*
   content telemetry. The `adBreakFromPeriod` flag distinguishes a break this
   tracker opened itself from one the SDK announced (the latter is left alone;
   its own `AD_BREAK_ENDED` closes it).
4. **Quartiles and clicks are gated on `hasAdInFlight()`.** Joining a live
   stream mid-break, the SDK reports quartiles for an ad whose `STARTED` never
   arrived; counting those makes quartiles outnumber ad starts and breaks
   completion-rate funnels.
5. **`sendAdBreakStart`/`sendAdBreakEnd` get a freshly built attributes object
   (`adBreakAttributes()`), never `this.adBreakData`.** video-core's
   `getAttributes()` fills and returns the very object it is handed, so passing
   internal state by reference turns `adBreakData` — and the public
   `getCurrentAdBreak()` — into the whole telemetry payload.
6. **`ERROR` is reported against the content tracker.** `isAd()` is true here,
   so reporting a failed stream request only on this tracker makes it an
   `AD_ERROR`, and video-core sets `hadStartupError`/`hadPlaybackError` only
   for non-ad trackers — the most severe failure the integration can see would
   never reach content error or startup-failure analysis. It goes to
   `this.parentTracker ?? this.contentTracker`, plus this tracker as well when a
   break is open (the ad failed too), falling back to this tracker alone if
   neither is wired.

### 2.3 Data extraction helpers

**The real `StreamEvent` prototype is only `getAd` / `getAdUi` /
`getCustomAdUi` / `getStreamData`** (enumerated against the live SDK). There is
no `getAdBreak()`, no `getCuepoints()`, no `getError()`, no `getType()`/
`getData()`. Everything that is not an `Ad` comes off `event.getStreamData()`.
Each helper wraps its reads in try/catch and logs a warning on failure:

- `extractStreamData(event)` → `{ streamId, url }` from `event.getStreamData()`.
  No `streamType` snapshot: `getStreamType()` derives it from the player's
  duration, which is not known this early in the stream, so a snapshot taken
  here would pin every stream to `'vod'` for its whole life.
- `extractAdBreakData()` → `{ adCount: undefined, position: null }`. Nothing
  about the break is knowable at `AD_BREAK_STARTED` (no ad-break accessor
  exists); both fields are backfilled from the first ad's pod info in
  `onAdStarted`. Must stay non-null — `getCurrentAdBreak()` consumers read it as
  "a break is in progress".
- `extractAdData(event)` → `{ adId, creativeId, duration, title, description,
  advertiserName, dealId, wrapperAdIds, clickThroughUrl, position, adCount }`
  from `event.getAd()`. Each accessor is read **independently** through a small
  `read(name)` helper: the IMA `Ad` surface varies by creative and SDK version
  (notably it defines no `getClickThroughUrl` at all), and one missing or
  throwing method must not discard the attributes that did resolve.
- `extractPodTotalAds(ad)` → `ad.getAdPodInfo().getTotalAds()`, `undefined`
  rather than `0` when unavailable, so a missing pod is distinguishable from an
  empty one.
- `extractErrorData(event)` → `{ errorMessage }` from
  `event.getStreamData().errorMessage`, run through `sanitizeErrorMessage()`,
  falling back to `{ errorMessage: 'Unknown DAI error' }`. There is **no**
  numeric code anywhere on the real SDK — don't invent `errorCode`/`innerError`.
- `sanitizeErrorMessage(message)` → the SDK's `errorMessage` embeds the full DAI
  request URL, whose query string carries identifiers (`ua`, `uach`, `sid`, and
  in real integrations `ppid` and `cust_params`). video-core's obfuscation rules
  are opt-in per integrator, so verbatim this puts user identifiers in NRDB by
  default. Keep scheme/host/path, drop query and fragment, cap at 512 chars.
  The query group must be **optional** in the pattern
  (`/(https?:\/\/[^\s?#]*)(?:[?#]\S*)?/g`): requiring it makes every `http://`
  in the message scan to the end of the token, fail, and backtrack — quadratic
  in message length (CodeQL `js/polynomial-redos`), on an input the SDK does not
  bound.
- `extractCuePoints(event)` → `event.getStreamData()?.cuepoints` when it is an
  array, else `null`. Only `CUEPOINTS_CHANGED` carries them; a `null` return
  leaves the known list untouched rather than clearing it.

### 2.4 `getAdPosition()`

From IMA's **ad pod index**, captured once at `STARTED` and held for the life of
the ad: `podIndex === 0` → `'pre'`, `-1` → `'post'`, any other number →
`'mid'`, nothing readable → `null`.

Playback time cannot be used for this, on CAF or anywhere else: under SSAI the
ad itself advances the stitched stream's clock, so a
`currentTime`-vs-`duration` guess reclassifies a long pre-roll as a mid-roll
partway through it, and the same ad then reports two different positions across
its own events.

```js
extractAdPosition(ad) {
  try {
    const podIndex = ad?.getAdPodInfo?.()?.getPodIndex?.();
    if (podIndex === 0) return 'pre';
    if (podIndex === -1) return 'post';
    if (typeof podIndex === 'number') return 'mid';
  } catch (error) {
    nrvideo.Log.warn('CAFDaiTracker: Failed to read ad pod info', error);
  }
  return null;
}

getAdPosition() {
  return this.currentAdData?.position ?? this.adBreakData?.position ?? null;
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
| `getPlayhead()`          | ad-relative: `getStreamTimeMs() - adStartStreamTime`, floored at 0; plain `getStreamTimeMs()` when no ad is in flight (§2.5.1) |
| `getStreamTimeMs()`      | `(this.playerManager?.getCurrentTimeSec?.() ?? 0) * 1000`                 |
| `getAdPartner()`         | `'google-dai'` (must match the hls.js/videojs value exactly — cross-player dashboard queries depend on this being identical) |
| `getClickThroughUrl()`   | `this.currentAdData?.clickThroughUrl ?? null`                             |
| `getStreamType()`        | `this.playerManager?.getDurationSec?.() === Infinity ? 'live' : 'vod'`. Derived fresh on every call — never snapshotted into `streamData` (§2.3) |
| `isMuted()`              | `this.contentTracker?.isMuted?.() ?? null` (CAF has no synchronous mute getter independent of `CAFTracker`'s cached `MEDIA_STATUS` payload — see HLD §9) |
| `getRenditionHeight()` / `getRenditionWidth()` | `this.playerManager.getStats().height` / `.width` in try/catch, exactly as `CAFTracker` reads them (`src/tracker.js:137-153`). The stitched stream is decoded by CAF's own player during ads, so these are available — unlike hls.js, which has to delegate to a content tracker |

#### 2.5.1 `getPlayhead()` must be ad-relative

`STARTED` captures `adStartStreamTime = getStreamTimeMs()`, and `getPlayhead()`
subtracts it while an ad is in flight, so `playhead` measures progress *within
the ad* rather than the stitched stream's absolute position (which would make a
mid-roll's first frame report a playhead of several minutes). `clearCurrentAd()`
drops the offset together with the ad — keeping it would make every later
content read under-report by a finished ad's start time.

There is deliberately **no** `StreamManager` call here. The live SDK exposes no
`getStreamTime()`; its time API is `contentTimeForStreamTime()` /
`streamTimeForContentTime()`, both of which take a time rather than reporting
the current one. An earlier implementation called the nonexistent
`getStreamTime()` inside a try/catch and silently took its fallback path on
every single read.

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

### 2.7 Helper/convenience methods

`isLiveStream()`, `getCurrentAdBreak()`, `getCurrentAd()`, `getStreamData()`,
`getAdCuePoints()` — thin reads over this class's own
`streamData`/`adBreakData`/`currentAdData`/`cuePoints` fields, plus
`clearCurrentAd()` (drops `currentAdData` *and* `adStartStreamTime` together,
§2.5.1) and `hasAdInFlight()` (the quartile/click guard, §2.2).

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

CAFTracker.CAFDaiTracker = CAFDaiTracker

export default CAFTracker
export { CAFTracker, CAFAdsTracker, CAFDaiTracker }
```

That static attach is what makes the class reachable for UMD/browser-global
consumers. A named export alone does **not**: the UMD bundle is built from
`src/index.js` with `library: 'CAFTracker'` + `libraryExport: 'default'`
(`webpack.config.js`), so `window.CAFTracker` *is* the default export and no
named export is reachable as a global. `window.CAFDaiTracker` therefore never
existed; the integration point is `window.CAFTracker.CAFDaiTracker`. Attaching
the static was chosen over restructuring the webpack `output` config because it
cannot change anything for existing consumers of `window.CAFTracker`.

`src/entry-browser.js` (the `./browser` subpath entry, built as CJS and ESM
only) carries the same attach for parity, so a consumer that takes only the
default export finds the DAI tracker the same way on either entry.

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
real IMA SDK needed), and a fake `StreamManager`/`playerManager`. **The fixtures
must mirror the real SDK's surface and nothing more** — an earlier version of
this file invented a `StreamManager.getStreamTime()` and put `getCuepoints()`/
`getError()` directly on the event object, and those inventions were the only
reason four tests passed over code that could never work against the live SDK:

```js
// Real StreamManager surface: addEventListener, clicked,
// contentTimeForStreamTime, dispatchEvent, focus, getAdSkippableState, listen,
// loadStreamMetadata, onTimedMetadata, previousCuePointForStreamTime,
// processMetadata, removeEventListener, replaceAdTagParameters, requestStream,
// reset, setClickElement, skipAd, streamTimeForContentTime.
// Note: NO getStreamTime.
function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    contentTimeForStreamTime: jest.fn((streamTime) => streamTime),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockPlayerManager(currentTime = 3) {
  let time = currentTime;
  return {
    getCurrentTimeSec: jest.fn(() => time),
    getDurationSec: jest.fn(() => 120),
    getStats: jest.fn(() => ({ streamBandwidth: 512000, width: 1280, height: 720 })),
    _setTime(t) { time = t; },   // ad-relative playhead needs time to advance
  };
}
```

Events carry their payload the way the SDK does: cue points as
`event.getStreamData().cuepoints`, errors as
`event.getStreamData().errorMessage`, ads as `event.getAd()` with pod info via
`getAdPodInfo().getPodIndex()`/`.getTotalAds()` — and the mock `Ad` deliberately
has **no** `getClickThroughUrl`.

The base-class mock must also mirror `videotracker.ts`: a `state` object (so
`state.isAdBreak` is reachable, per §3), `dispose()` nulling `player`/`tag`, and
the full `send*` set including `sendBufferStart`/`sendBufferEnd`/
`sendSeekStart`/`sendSeekEnd`, which `CAFTracker` calls on its ads tracker. The
`__mock__.js` shipped with `@newrelic/video-core` has none of these, hence the
local factory mock.

Test groups (one `it` per §2.2 table row, minimum):

1. **Construction & lifecycle** — subscribes to exactly the handled
   `StreamEvent.Type` list (and *not* `TIMED_METADATA`); warns instead of
   throwing when the IMA SDK global is absent; removes every listener on
   `unregisterListeners()`; `LOADED` stores stream data and sends **nothing**;
   `STREAM_INITIALIZED` → `sendDownload({ state: 'stream-initialized' })` and
   resets ad/break/cue-point/stream state; `AD_BREAK_STARTED`/`AD_BREAK_ENDED`
   → `sendAdBreakStart()`/`sendAdBreakEnd()` + `getCurrentAdBreak()`
   set/cleared; break attributes carry the backfilled `adCount` but no internal
   `position` key, and the live `adBreakData` is never handed to the telemetry
   layer; `AD_PERIOD_STARTED` fallback; `AD_PERIOD_ENDED` closes a
   period-opened break and leaves an SDK-announced one open.
2. **Stream errors** — message read from `StreamData`; reported on the content
   tracker, on `parentTracker` in preference to `options.contentTracker`, on
   both trackers during a break, and on itself when neither is wired; query
   strings stripped from embedded URLs; pathological input sanitized in linear
   time; runaway message capped; throwing accessors fall back to
   `{ errorMessage: 'Unknown DAI error' }` without crashing.
3. **Ad playback events** — `STARTED` → `sendStart()` + `getVideoId()`/
   `getTitle()`/`getAdCreativeId()`/`getDuration()`; ad identity survives an Ad
   object whose optional accessors all throw; position from pod index
   (0/-1/other/absent) and stable as the stream clock advances; `adCount` from
   the pod, `undefined` when unavailable; each quartile →
   `sendAdQuartile({ quartile: N })`, and none at all for an ad that never
   started or one that already completed; `COMPLETE` → `sendEnd()` + cleared
   `currentAdData`; `SKIPPED` → `sendEnd({ skipped: true })`;
   `PAUSED`/`RESUMED`; `CLICK`/`VIDEO_CLICKED` omit the url key the SDK cannot
   supply and carry one if a future SDK does; `sendRequest()` fires once per ad
   rather than once per stream; an ad in flight is ended by its break ending,
   without double-ending one that completed; no stale data leaking into a second
   sequential ad break; `getPlayhead()` ad-relative, back to stream time after
   the ad, rebased for each ad in a pod.
4. **Cue points, getters, bitrate** — `CUEPOINTS_CHANGED` updates
   `getAdCuePoints()` from `StreamData` with no `send*` call, does not clobber a
   known list when a later event carries none, and survives a throwing
   accessor; `getPlayhead()` reads CAF's player, never the `StreamManager`, and
   reports 0 rather than throwing without a `playerManager`; `getStreamType()`
   live/vod inference; `isMuted()` delegates to `options.contentTracker` and
   returns `null` without one; `getBitrate()`/`getRenditionWidth()`/
   `getRenditionHeight()` read `playerManager.getStats()`, `null` without it;
   `getRenditionBitrate()`/`onBitrateChanged()`; no `isUsing()` detector
   exists.
5. **Interface `CAFTracker` depends on** — a real `CAFDaiTracker` instance (not
   a stand-in) exposes a `state` object carrying `isAdBreak`, and
   `sendPause`/`sendResume`/`sendBufferStart`/`sendBufferEnd`/`sendSeekStart`/
   `sendSeekEnd`/`sendError`/`onBitrateChanged` as functions; and it does not
   override the inherited `sendAdBreakStart`/`sendAdBreakEnd` that drive the
   flag. This is the standing guard against the duck-typed surface in §3
   drifting out from under `tracker.js`.
6. **Against video-core's real event gating** — re-implement
   `goStart`/`goEnd`/`goAdBreakStart`/`goAdBreakEnd`'s actual flag rules over
   the real tracker and assert the reported event sequence for a multi-ad pod,
   two sequential breaks, and a break that ends mid-ad. These are the tests that
   catch the `isRequested` class of bug described in §2.2.
7. **`CAFTracker` + `CAFDaiTracker` integration (no `tracker.js` changes
   required)**, in `src/__test__/tracker-dai-integration.test.js` — construct a
   real `CAFTracker` with a mocked `receiverContext`/`PlayerManager`, give it an
   ads tracker with the DAI tracker's shape, and assert `onPause()`/
   `onBuffering()`/`onBitrateChanged()` route to it — proving §3's reasoning
   holds in practice, not just on paper. The surface that stand-in has to match
   is pinned against the real class by group 5 above.

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
- `options.playerManager` as effectively-required-but-unvalidated (§2), not
  enforced-required, since the constructor does not throw without it.
- The optional `options.contentTracker` param, what it affects (`isMuted()` and
  error routing, §2.2), and that only a `CAFTracker` is a valid value — both the
  README snippet and the sample should actually pass it, since the content
  tracker is in scope one line above in each.
- That UMD/browser-global consumers construct it as
  `new CAFTracker.CAFDaiTracker(...)` (§4).

## 8. Build order for implementation

1. Add Jest/babel-jest test infra (§5 config) — Task 0.
2. `src/dai.js` (pure port + CAF adjustments per §2).
3. Exports (§4).
4. Tests (§5) — write and get green before touching samples/README, including
   the group 7 integration proof that `tracker.js` needs no changes.
5. Sample page (§6).
6. README (§7).
