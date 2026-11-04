# High-Level Design: Google IMA DAI Support for video-caf-js

## 1. Intent

`video-caf-js` (`@newrelic/video-caf`) currently tracks content playback QoE for a
CAF (Cast Application Framework) receiver via `CAFTracker`, plus native CAF
ad-break tracking (VAST/VMAP via CAF's own `BreakManager`) via `CAFAdsTracker`
(`src/ads.js`). Neither has any concept of **Google IMA DAI** (server-side Dynamic
Ad Insertion) — ad breaks stitched server-side into the manifest by Google's DAI
service, surfaced only through the IMA DAI SDK's own `StreamManager`, not through
CAF's native `cast.framework.events` break events.

Scope is Google IMA DAI only (not CSAI/VAST/VMAP — that's already covered by the
existing `CAFAdsTracker` — and not FreeWheel/MediaTailor). This brings CAF to
parity with the DAI support already shipped/in-progress for `video-hls-js` and
`video-videojs-js`.

## 2. Why now

SBS (active POV, see Slack thread 2026-11-04) asked whether they could manually
instrument Google DAI ad events on CAF themselves, using a hand-rolled snippet
calling non-existent tracker methods (`sendAdStart`/`sendAdEnd`/`sendAdError`).
That approach was confirmed incorrect: those methods don't exist, and even the
real lifecycle methods (`sendStart`/`sendEnd`/`sendError`) depend on internal
state/chrono bookkeeping (`video-core-js/src/videotrackerstate.ts`) that a
hand-driven caller would desynchronize, producing wrong attribute values, not
just missing ones. The correct fix is a dedicated tracker class on New Relic's
side — this document designs that class. CAF was confirmed as SBS's top priority
over `video-hls-js`'s DAI work (also in progress, see
`video-hls-js/.claude/HLD-google-dai.md`).

## 3. How Google DAI + CAF works (context)

Google's IMA DAI SDK (`ima3_dai.js`, exposed as `google.ima.dai.api.*`) works the
same way inside a CAF receiver page as it does in a regular browser tab — a CAF
receiver is just a Chrome page running on the Cast device:

1. Receiver app creates a `google.ima.dai.api.StreamManager(...)` (bound to
   whatever media element CAF renders — the CAF receiver SDK manages this; the
   tracker does not need the raw element, see §8 and LLD §2.6).
2. App builds a `VODStreamRequest`/`LiveStreamRequest` and calls
   `streamManager.requestStream(request)`.
3. On `StreamEvent.Type.LOADED`, the app reads the stitched manifest URL from
   `event.getStreamData().url` and feeds it to the CAF player — typically via a
   `LOAD` message interceptor (`playerManager.setMessageInterceptor(
   cast.framework.messages.MessageType.LOAD, ...)`) that substitutes the DAI URL
   into the load request before CAF's native player loads it.
4. From that point on, CAF's `PlayerManager` plays one continuous stitched
   stream. Ad boundaries are only known via `StreamManager`'s `StreamEvent`s
   (`AD_BREAK_STARTED`, `STARTED`, quartiles, `AD_BREAK_ENDED`, etc.) — **not**
   via CAF's native `BREAK_STARTED`/`BREAK_CLIP_STARTED`/etc. events that
   `CAFAdsTracker` listens to today. CAF's native BreakManager has no visibility
   into DAI-stitched breaks; they are two independent, mutually exclusive ad
   mechanisms for a given stream.

This means DAI ad tracking is purely **event-driven off the `StreamManager`**,
exactly as already designed for `video-hls-js` and already shipped for
`video-videojs-js`. The new piece for CAF is wiring this into `CAFTracker`
alongside the pre-existing `CAFAdsTracker`.

## 4. Goals

- Track Google DAI ad break/ad/quartile/click/error events for both **VOD and
  Live** DAI streams on CAF receivers.
- Correctly attribute ad view time vs. content view time (no double-counting) in
  the same New Relic video session.
- Match the data model and event semantics already established by
  `DaiAdsTracker` (video.js) / the in-progress `DaiTracker` (hls.js), so
  dashboards/queries work identically across player integrations — same
  `getAdPartner() → 'google-dai'`, same event→method mapping.
- Keep `CAFAdsTracker` (native CAF VMAP/VAST breaks) completely unchanged and
  unaffected — DAI is a parallel, not a replacement, code path.

## 5. Non-goals

- Supporting CSAI/VAST/VMAP on CAF for DAI's sake — already covered by
  `CAFAdsTracker`.
- Supporting FreeWheel, MediaTailor, or other SSAI vendors on CAF.
- Changing how the CAF receiver loads the stitched manifest (the `LOAD`
  interceptor / `setMediaPlaybackInfoHandler` wiring) — that remains the
  application's responsibility, same as the hls.js/videojs integrations.
- Auto-detecting DAI usage without the app explicitly constructing a
  `StreamManager` and attaching it.

## 6. Anti-goals (would be a failure even if "technically working")

- Ad time counted as content time (or vice versa) in New Relic.
- Any change to `CAFAdsTracker`'s behavior or to native VMAP/VAST break tracking.
- Requiring the app to restructure how it already wires up DAI on CAF just to
  get analytics.
- A design that can't be extended to Live DAI without rework.

## 7. Architecture overview

```
 Application code
      │
      │ creates
      ▼
 google.ima.dai.api.StreamManager ──events──▶  CAFDaiTracker (new)
      │                                             │
      │ stream URL (via LOAD interceptor)           │ parentTracker / isAd()
      ▼                                             ▼
   CAF PlayerManager  ◀──────── shared reference ── CAFTracker (existing)
      │                                             │
      │                                             │ auto-creates (existing,
      ▼                                             │ unchanged)
  Cast receiver <video>                        CAFAdsTracker (existing,
                                                 native VMAP/VAST breaks)
```

- **`CAFTracker`** (existing, `src/tracker.js`): **no code changes required**
  (see LLD §3 for why — this is the key architectural finding of this design).
  Its existing ad-break guard (`this.adsTracker.state.isAdBreak`, driven by the
  generic `video-core` state machine) already works for any ads-tracker
  subclass that calls the inherited `sendAdBreakStart()`/`sendAdBreakEnd()`,
  which `CAFDaiTracker` will.
- **`CAFAdsTracker`** (existing, `src/ads.js`): unchanged. Continues to handle
  native CAF `BreakManager` events for VMAP/VAST breaks, auto-created in
  `CAFTracker.registerListeners()` exactly as today.
- **`CAFDaiTracker`** (new, `src/dai.js`): tracks the `StreamManager`, extends
  `nrvideo.VideoTracker` directly (same pattern as hls.js's `DaiTracker` — there
  is no intermediate "CAF-DAI" base class needed, since `StreamManager` events
  are independent of both CAF's native break events and of `CAFAdsTracker`).
- Linked via the existing `nrvideo.VideoTracker.setAdsTracker()` API. Calling
  `cafTracker.setAdsTracker(daiTracker)` **automatically disposes the
  auto-created `CAFAdsTracker`** (via the base class's
  `setAdsTracker() → disposeAdsTracker() → dispose() → unregisterListeners()`
  chain, `video-core-js/src/videotracker.ts:183-218`) — no manual teardown code
  needed in this repo. This is safe because DAI and native CAF breaks are
  mutually exclusive for a given stream (§3).

## 8. Integration shape (application-facing)

```js
const receiverContext = cast.framework.CastReceiverContext.getInstance();
const tracker = new CAFTracker(receiverContext, options);

const streamManager = new google.ima.dai.api.StreamManager(/* CAF-managed media element */);
const daiTracker = new CAFDaiTracker(streamManager, { playerManager: receiverContext.getPlayerManager() });
tracker.setAdsTracker(daiTracker); // replaces the auto-created native CAFAdsTracker

receiverContext.getPlayerManager().setMessageInterceptor(
  cast.framework.messages.MessageType.LOAD,
  (loadRequestData) => {
    return streamManager.requestStream(buildStreamRequest(loadRequestData)).then((streamData) => {
      loadRequestData.media.contentUrl = streamData.url;
      return loadRequestData;
    });
  }
);

receiverContext.start();
```

This mirrors the hls.js/videojs integration's spirit (one explicit
`setAdsTracker` call) using CAF's own `LOAD` interceptor instead of
`hls.loadSource()`/a videojs plugin event to get the stitched URL into the
player.

## 9. Risks / open questions

- **No existing test infrastructure in this repo** (`video-caf-js` has no Jest
  config, unlike `video-hls-js`/`video-videojs-js`). The plan adds a minimal
  Jest + jsdom setup, mirroring `video-hls-js/jest.config.js` exactly (the
  installed `@newrelic/video-core` package already ships the same
  `__mock__.js` this repo would need — confirmed present at
  `node_modules/@newrelic/video-core/__mock__.js`, version 4.1.6).
- `StreamManager` does not expose CAF's media element or playback stats; unlike
  hls.js (which needed an app-supplied `contentTracker` reference for bitrate
  fallback), CAF's own `PlayerManager` already exposes `getCurrentTimeSec()`,
  `getDurationSec()`, and `getStats()` directly (confirmed in
  `src/tracker.js:111-153`), so `CAFDaiTracker` reads these off its own
  `options.playerManager` reference with no extra app wiring. The one exception
  is mute state (`isMuted()`), which `CAFTracker` only has via a cached
  `MEDIA_STATUS` event payload, not a synchronous `PlayerManager` getter — an
  optional `options.contentTracker` reference is accepted for this one getter
  only (degrades to `null` if omitted).
- No existing DAI test fixtures in this repo; tests are written from scratch,
  modeled on `video-videojs-js/src/ads/dai.js`'s behavior (the canonical
  source both other integrations port from).

## 10. What's left to the builder (LLD)

Exact method list, event-to-send-call mapping, data extraction helpers, the
`onBitrateChanged` duck-typing fix, file layout, and test plan are covered in
`LLD-google-dai.md`.
