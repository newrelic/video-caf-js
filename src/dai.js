import nrvideo from '@newrelic/video-core'
import { version } from '../package.json'

/**
 * Tracks Google IMA DAI (server-side stitched) ad breaks for a CAF receiver.
 *
 * Attach it to the content tracker with `cafTracker.setAdsTracker(daiTracker)` —
 * that sets isAd()/parentTracker and funnels these events into the content
 * session as VideoAdAction. Never register this tracker with Core directly.
 */
export default class CAFDaiTracker extends nrvideo.VideoTracker {

  constructor(streamManager, options) {
    super(streamManager, options);
    // Readability alias only. `this.player` (set by the base class) is the
    // load-bearing StreamManager reference every method uses.
    this.streamManager = streamManager;
    this.playerManager = options?.playerManager || null;
    this.contentTracker = options?.contentTracker || null;
    this.currentAdData = null;
    this.adStartStreamTime = null;
    this.adBreakData = null;
    this.adBreakFromPeriod = false;
    this.streamData = null;
    this.cuePoints = [];
    this._currentBitrate = 0;
  }

  /**
   * Drops the in-flight ad. The stream-time offset has to go with it, or
   * getPlayhead() keeps subtracting a finished ad's start and under-reports
   * content position for the rest of the session.
   */
  clearCurrentAd() {
    this.currentAdData = null;
    this.adStartStreamTime = null;
  }

  registerListeners() {
    // `typeof` first: optional chaining still throws a ReferenceError on an
    // identifier that was never declared, which is exactly the case when the
    // IMA DAI SDK script has not loaded.
    const sdk = typeof google === 'undefined' ? undefined : google?.ima?.dai?.api;

    if (!this.player || !sdk?.StreamEvent) {
      nrvideo.Log.warn('CAFDaiTracker: StreamManager or DAI API not available');
      return;
    }

    // Documented as "effectively required, though not validated". The
    // consequence worth warning about is not the missing attributes but the
    // CONTENT GUARD: without a playerManager getStreamTimeMs() is permanently
    // unreadable, so isAdPlaying()'s cue-point arm can never match a window.
    // A pre-roll still works (its window starts at 0 and the break object
    // covers it), which is exactly why this degrades unnoticed — but EVERY
    // mid-roll lead-in silently fails to suppress content events.
    if (!this.playerManager) {
      nrvideo.Log.warn(
        'CAFDaiTracker: no options.playerManager — playhead, duration and bitrate ' +
        'will be unavailable, and mid-roll content suppression will not work. ' +
        'Pass receiverContext.getPlayerManager().'
      );
    }
    const StreamEvent = sdk.StreamEvent.Type;

    /**
     * Every handler runs inside the IMA DAI SDK's own event dispatch, so an
     * exception escaping one does not just lose an event — it reaches the SDK,
     * which aborts the stream request and emits an empty ERROR. Observed on the
     * sibling DASH integration against the live asset: nothing played at all.
     *
     * The reachable chain here is onStreamError -> contentTracker.sendError()
     * -> CAFTracker.getAttributes(), which reads the CastReceiverContext and
     * the PlayerManager while the receiver is IDLE — the very state a failed
     * stream request leaves it in. Those getters are hardened in CAFTracker,
     * and this contains the whole class: the thrown value comes from a
     * third-party player through video-core's attribute collection, so the next
     * such throw would break the customer's playback the same way. A telemetry
     * library must never take the stream down with it.
     */
    const guard = (type, handler) => (event) => {
      try {
        handler(event);
      } catch (error) {
        nrvideo.Log.error(`CAFDaiTracker: handler for '${type}' failed`, error);
      }
    };

    const handlers = {
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

    // Store the GUARDED references, so unregisterListeners removes the same
    // functions that were registered.
    this.eventHandlers = Object.fromEntries(
      Object.entries(handlers).map(([type, handler]) => [type, guard(type, handler)])
    );

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

  // Stream Event Handlers
  onStreamLoaded(event) {
    // Capture the stitched stream only. This is not an ad request: emitting one
    // here would also consume video-core's isRequested flag, which AD_START
    // depends on, and the flag is per-ad (see onAdStarted).
    this.streamData = this.extractStreamData(event);
    nrvideo.Log.debug('CAFDaiTracker: Stream loaded', this.streamData);
  }

  /**
   * The only safe place to drop per-stream state. Verified live event order,
   * per stream request:
   *
   *   STREAM_INITIALIZED -> CUEPOINTS_CHANGED -> LOADED -> ... -> CUEPOINTS_CHANGED
   *
   * Cue points arrive before their own LOADED, so resetting at LOADED discards
   * the list for the stream being loaded; and they arrive again mid-stream, so
   * a "did any arrive" flag cannot tell a fresh list from a stale one either.
   * This event precedes a stream's cue points and nothing else does.
   */
  onStreamInitialized() {
    nrvideo.Log.debug('CAFDaiTracker: Stream initialized');
    // A stream replaced mid-break has to close that break rather than just
    // forget it: only sendAdBreakEnd() clears video-core's own isAdBreak flag,
    // so dropping adBreakData alone would leave the flag — and the break's
    // playtime accounting — stuck open for the rest of the session.
    try {
      if (this.adBreakData) this.onAdBreakEnded();
    } finally {
      // Same hazard as onAdBreakEnded, one level up: a throw inside the break
      // close used to skip these clears and carry the PREVIOUS stream's open
      // break and cue points into the new one, suppressing all content
      // telemetry for a stream that is playing perfectly well.
      this.clearCurrentAd();
      this.adBreakData = null;
      this.adBreakFromPeriod = false;
      this.cuePoints = [];
      this.streamData = null;
    }

    this.sendDownload({ state: 'stream-initialized' });
  }

  /**
   * StreamEvent.ERROR is predominantly stream-level — a failed stream request
   * means nothing plays at all. Because isAd() is true here, reporting it only
   * on this tracker routes it to AD_ERROR, and video-core sets
   * hadStartupError/hadPlaybackError only for non-ad trackers, so the most
   * severe failure the integration can see would never reach content error or
   * startup-failure analysis. It therefore goes to the content tracker, and
   * additionally to this one when a break is open, since the ad failed too.
   */
  onStreamError(event) {
    const errorData = this.extractErrorData(event);
    nrvideo.Log.error('CAFDaiTracker: Stream error', errorData);
    const contentTracker = this.parentTracker ?? this.contentTracker;

    // Each send gets its OWN copy. video-core's getAttributes() fills and
    // returns the object it is handed, so passing one payload to both trackers
    // would publish a CONTENT_ERROR carrying this tracker's adId, adPartner,
    // adPosition and adPlayhead — the same rule that keeps adBreakData out of
    // adBreakAttributes(), applied to a payload shared across two trackers
    // rather than to internal state.
    // Each report is independently contained. Previously the ad-side send ran
    // first and unguarded, so one throw in it — reaching getPlayhead() while
    // the receiver is IDLE, exactly the state a failed stream request leaves —
    // was caught at the handler boundary and the content error never ran. NRDB
    // then recorded NEITHER error for a stream that never played, defeating
    // the startup-failure analysis this method exists to feed.
    const report = (tracker, label) => {
      try {
        tracker.sendError({ ...errorData });
      } catch (error) {
        nrvideo.Log.warn(`CAFDaiTracker: ${label} sendError() failed`, error);
      }
    };

    const hasContentTracker = typeof contentTracker?.sendError === 'function';

    // Content FIRST: it is the report that carries hadStartupError, so it is
    // the one that must survive if only one can.
    if (hasContentTracker) report(contentTracker, 'content');

    if (this.adBreakData) {
      report(this, 'ad');
    } else if (!hasContentTracker) {
      // Nothing else to report on — better an ad error than a lost error.
      report(this, 'ad (no content tracker)');
    }
  }

  // Ad Break Event Handlers
  onAdBreakStarted(event) {
    // A real AD_BREAK_STARTED owns the break from here on, including one that
    // onAdPeriodStarted opened. Without this the period end stays a closing
    // path for an SDK-announced break, and on the ordering
    // period-start -> break-start -> period-end -> break-end it ends the
    // in-flight ad, sends AD_BREAK_END and drops the content guard while the
    // pod's remaining ads are still playing — then swallows the genuine
    // AD_BREAK_ENDED.
    this.adBreakFromPeriod = false;

    // Already open from a period event: adopt it rather than re-announce it.
    // video-core's goAdBreakStart() no-ops a second call anyway, and
    // re-extracting would discard the position and adCount that onAdStarted
    // backfilled from an ad that has already started inside this break.
    if (this.adBreakData) return;

    this.adBreakData = this.extractAdBreakData(event);
    nrvideo.Log.debug('CAFDaiTracker: Ad break started');
    this.sendAdBreakStart(this.adBreakAttributes());
  }

  /**
   * The break's reportable attributes, built fresh each time. Never the live
   * adBreakData: video-core's getAttributes() fills and returns the very object
   * it is handed, which would turn adBreakData — and so the public
   * getCurrentAdBreak() — into the whole telemetry payload. `position` is
   * deliberately excluded; it is already published as adPosition via
   * getAdPosition().
   */
  adBreakAttributes() {
    const { adCount } = this.adBreakData ?? {};
    return adCount === undefined ? {} : { adCount };
  }

  onAdBreakEnded() {
    nrvideo.Log.debug('CAFDaiTracker: Ad break ended');

    // Snapshot the attributes and the in-flight flag BEFORE any send, so the
    // clears below cannot depend on state a throw might have left behind.
    const attributes = this.adBreakAttributes();
    const hadAdInFlight = this.currentAdData != null;

    try {
      // An ad still in flight has to be ended first. video-core's
      // goAdBreakEnd() clears isRequested but not isStarted, and only
      // sendEnd() resets that, so leaving a started ad unfinished here blocks
      // AD_START for every later ad in the session. Happens whenever a break
      // ends mid-ad: a seek out of a mid-roll, an ad error, a source switch.
      //
      // Its own try/catch, because sendAdBreakEnd() below is what clears
      // video-core's isAdBreak flag. If a failed sendEnd() skipped it, the
      // flag would stay set and suppress content telemetry for the view.
      this.closeOpenAdTransitions();

      if (hadAdInFlight) {
        try {
          this.sendEnd();
        } catch (error) {
          nrvideo.Log.warn('CAFDaiTracker: sendEnd() failed closing a break', error);
        }
      }

      // Attributes go out here rather than at AD_BREAK_STARTED: the break's
      // details are only known once its first ad has been seen (onAdStarted).
      this.sendAdBreakEnd(attributes);
    } finally {
      // ALWAYS clear, even if a send threw. guard() catches at the handler
      // boundary, so a plain send-then-clear left adBreakData set — and
      // isAdPlaying() returns true for as long as it is, which makes
      // CAFTracker suppress every content event for the rest of the view.
      // The resulting shape (CONTENT_REQUEST, CONTENT_END, totalPlaytime 0, no
      // CONTENT_START) reads as exit-before-video-start, so the fault did not
      // merely hide, it mis-signalled as a different and alertable one.
      //
      // video-core does the same thing: goAdBreakEnd() flips its flag before
      // dispatching, so the flag clears even if attribute collection throws.
      this.clearCurrentAd();
      this.adBreakData = null;
      this.adBreakFromPeriod = false;
    }
  }

  // Ad Period Event Handlers (for bumpers, etc.)
  onAdPeriodStarted(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad period started');
    // Bumpers and some live breaks fire only a period start, with no
    // AD_BREAK_STARTED to open the break.
    if (!this.adBreakData) {
      this.onAdBreakStarted(event);
      // Flagged AFTER the call, not before: onAdBreakStarted clears the flag so
      // that a real AD_BREAK_STARTED takes ownership of the break.
      this.adBreakFromPeriod = true;
    }
  }

  onAdPeriodEnded() {
    nrvideo.Log.debug('CAFDaiTracker: Ad period ended');
    // A break this tracker opened from a period event gets no AD_BREAK_ENDED —
    // that is the premise of the fallback above — so the period end is its only
    // closing path. Without this the break stays open for the rest of the
    // session and CAFTracker's content guard suppresses all content telemetry.
    // Periods nested inside an SDK-announced break are left alone: that break
    // may still have more ads, and its own AD_BREAK_ENDED will close it.
    if (this.adBreakFromPeriod) {
      this.onAdBreakEnded();
    }
  }

  // Individual Ad Event Handlers
  onAdStarted(event) {
    // BOTH values before EITHER assignment. Assigning currentAdData first left
    // half an ad in flight whenever the second line threw: hasAdInFlight() went
    // true with adStartStreamTime null, so quartiles fired for an ad that never
    // started — the exact funnel corruption hasAdInFlight() exists to stop —
    // and getPlayhead() fell through to raw stitched stream position.
    const adData = this.extractAdData(event);
    const startStreamTime = this.getStreamTimeMs();

    this.currentAdData = adData;
    this.adStartStreamTime = startStreamTime;
    nrvideo.Log.debug('CAFDaiTracker: Ad started', this.currentAdData);
    // AD_BREAK_STARTED carries no break information at all, so backfill it from
    // the first ad's pod info now that one exists.
    if (this.adBreakData) {
      if (this.adBreakData.position == null) {
        this.adBreakData.position = this.currentAdData.position;
      }
      if (this.adBreakData.adCount === undefined &&
          this.currentAdData.adCount !== undefined) {
        this.adBreakData.adCount = this.currentAdData.adCount;
      }
    }
    // Each ad needs its own request: video-core gates AD_START on
    // state.isRequested and clears it on both AD_END and AD_BREAK_END, so
    // without this only the session's first ad would ever report a start.
    this.sendRequest();
    this.sendStart();
  }

  /**
   * Closes any ad-side QoE transition still open, BEFORE sendEnd() runs.
   *
   * This ordering is the whole point. video-core's goEnd() calls resetFlags(),
   * which clears isSeeking, isBuffering and isPaused outright — so a transition
   * still open when the ad ends loses its closing event entirely: the
   * AD_SEEK_START that already reached NRDB never gets an AD_SEEK_END, ever.
   * Routing the later close by which tracker holds the flag cannot help,
   * because by then no tracker holds it.
   *
   * Measured on live: DAI seeks past the pod at break end, so an AD_SEEK_START
   * opened inside the last ad was left unpaired. Closing here reports the seek
   * as ending when the ad does, which is what actually happened.
   *
   * Each close is contained: one failing must not block the others, nor the
   * sendEnd() that follows.
   */
  closeOpenAdTransitions() {
    const closers = [
      ['isSeeking', 'sendSeekEnd'],
      ['isBuffering', 'sendBufferEnd'],
      ['isPaused', 'sendResume'],
    ];

    closers.forEach(([flag, method]) => {
      if (!this.state?.[flag]) return;
      try {
        this[method]();
      } catch (error) {
        nrvideo.Log.warn(`CAFDaiTracker: ${method}() failed closing an ad transition`, error);
      }
    });
  }

  /**
   * Quartiles and clicks only mean something for an ad we are tracking. Joining
   * a live stream mid-break, the SDK reports quartiles for an ad whose STARTED
   * never reached us: those arrive with no adId or adTitle, and counting them
   * makes quartiles outnumber ad starts, which breaks completion-rate funnels.
   */
  hasAdInFlight() {
    return this.currentAdData != null;
  }

  onAdFirstQuartile() {
    if (!this.hasAdInFlight()) return;
    this.sendAdQuartile({ quartile: 1 });
  }

  onAdMidpoint() {
    if (!this.hasAdInFlight()) return;
    this.sendAdQuartile({ quartile: 2 });
  }

  onAdThirdQuartile() {
    if (!this.hasAdInFlight()) return;
    this.sendAdQuartile({ quartile: 3 });
  }

  onAdComplete() {
    nrvideo.Log.debug('CAFDaiTracker: Ad complete');
    this.closeOpenAdTransitions();
    this.sendEnd();
    this.clearCurrentAd();
  }

  onAdSkipped() {
    nrvideo.Log.debug('CAFDaiTracker: Ad skipped');
    this.closeOpenAdTransitions();
    this.sendEnd({ skipped: true });
    this.clearCurrentAd();
  }

  onAdPaused() {
    this.sendPause();
  }

  onAdResumed() {
    this.sendResume();
  }

  onAdClicked() {
    if (!this.hasAdInFlight()) return;
    // Omit url rather than send a known null: video-core warns when the key is
    // absent-or-falsy, and the DAI Ad object exposes no clickthrough accessor,
    // so a null would log that warning on every click.
    const url = this.getClickThroughUrl();
    this.sendAdClick(url ? { url } : {});
  }

  // Cue Points Handler
  onCuePointsChanged(event) {
    const cuePoints = this.extractCuePoints(event);
    if (cuePoints) this.cuePoints = cuePoints;
  }

  // Data Extraction Methods
  extractStreamData(event) {
    try {
      const streamData = event.getStreamData();
      // No streamType snapshot here: it is derived from the content tracker's
      // live flag, which the receiver cannot answer this early, and
      // getStreamType() reads it fresh anyway.
      return {
        streamId: streamData?.streamId,
        url: streamData?.url,
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract stream data', error);
      return {};
    }
  }

  /**
   * The DAI StreamEvent exposes no ad-break accessor (verified against the live
   * SDK, StreamEvent.prototype is only getAd / getAdUi / getCustomAdUi /
   * getStreamData), so nothing about the break is knowable at
   * AD_BREAK_STARTED. Both fields are filled from the first ad's pod info in
   * onAdStarted. Must stay non-null — isAdPlaying(), and so CAFTracker's whole
   * content guard, treats this object as "a break is in progress".
   */
  extractAdBreakData() {
    return { adCount: undefined, position: null };
  }

  extractAdData(event) {
    let ad;
    try {
      ad = event.getAd();
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract ad data', error);
      return {};
    }

    // Read each accessor independently. The IMA Ad surface varies by creative
    // and SDK version — notably it defines no getClickThroughUrl at all — and
    // one missing method must not discard the attributes that did resolve.
    const read = (name) => {
      try {
        return typeof ad?.[name] === 'function' ? ad[name]() : undefined;
      } catch (error) {
        nrvideo.Log.warn(`CAFDaiTracker: ad.${name}() failed`, error);
        return undefined;
      }
    };

    return {
      adId: read('getAdId'),
      creativeId: read('getCreativeId'),
      duration: read('getDuration'),
      title: read('getTitle'),
      description: read('getDescription'),
      advertiserName: read('getAdvertiserName'),
      dealId: read('getDealId'),
      wrapperAdIds: read('getWrapperAdIds'),
      // Absent from today's DAI Ad object; read defensively so a future SDK
      // that adds it is picked up without another change here.
      clickThroughUrl: read('getClickThroughUrl'),
      position: this.extractAdPosition(ad),
      adCount: this.extractPodTotalAds(ad),
    };
  }

  extractPodTotalAds(ad) {
    try {
      const total = ad?.getAdPodInfo?.()?.getTotalAds?.();
      return typeof total === 'number' ? total : undefined;
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to read ad pod size', error);
      return undefined;
    }
  }

  /**
   * Ad position from IMA's pod index, which is authoritative: podIndex 0 is a
   * pre-roll, -1 a post-roll, anything else a mid-roll. Playback time cannot be
   * used — under SSAI the ad itself advances the stitched stream's clock, so a
   * time-based guess reclassifies a long pre-roll as a mid-roll partway in.
   */
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

  /**
   * Cue points live on StreamData — the StreamEvent has no getCuepoints(). Only
   * CUEPOINTS_CHANGED actually carries them; other events report null, so a
   * missing list leaves the known one untouched rather than clearing it.
   */
  extractCuePoints(event) {
    try {
      const cuepoints = event.getStreamData?.()?.cuepoints;
      if (Array.isArray(cuepoints)) return cuepoints;
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract cue points', error);
    }
    return null;
  }

  /**
   * The DAI StreamEvent has no getError(); the only diagnostic the SDK provides
   * is StreamData.errorMessage, which carries the cause and HTTP status (e.g.
   * "Stream initialization failed... HTTP status code: 404"). There is no
   * numeric code field, so none is reported rather than inventing one.
   */
  extractErrorData(event) {
    try {
      const message = event.getStreamData?.()?.errorMessage;
      if (message) return { errorMessage: this.sanitizeErrorMessage(message) };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract error data', error);
    }
    return { errorMessage: 'Unknown DAI error' };
  }

  /**
   * The SDK's errorMessage embeds the full DAI request URL, whose query string
   * carries identifiers — ua, uach, sid, and in real integrations ppid and
   * cust_params. video-core's obfuscation rules are opt-in per integrator, so
   * verbatim this would put user identifiers in NRDB by default. Keep scheme,
   * host and path, which is what makes the error diagnosable, and drop the
   * query. Capped as a backstop against an unbounded message.
   *
   * The query/fragment group is optional on purpose. Requiring it made every
   * 'http://' in the message start a scan to the end of the token that then
   * failed and backtracked, which is quadratic in the message length
   * (CodeQL js/polynomial-redos). Optional, the match always succeeds at the
   * first attempt and never backtracks, so this is linear — and the output is
   * unchanged, since a URL with no query is replaced by itself.
   */
  sanitizeErrorMessage(message) {
    const MAX_LENGTH = 512;
    const stripped = String(message).replace(
      /(https?:\/\/[^\s?#]*)(?:[?#]\S*)?/g,
      '$1'
    );
    return stripped.length > MAX_LENGTH
      ? `${stripped.slice(0, MAX_LENGTH - 1)}…`
      : stripped;
  }

  // Returns the position captured when the ad started, so it stays constant
  // across every event of that ad instead of drifting as playback advances.
  getAdPosition() {
    return this.currentAdData?.position ?? this.adBreakData?.position ?? null;
  }

  /**
   * 'live', 'vod', or null when unknown — the same three values the hls.js and
   * dash.js DAI trackers report.
   *
   * Comes from the content tracker, as it does on both siblings. CAFTracker's
   * isLive() reads the receiver's live seekable range, which the media player
   * derives from the manifest.
   *
   * It is NOT `MediaInformation.streamType`. That is what the SENDER declared
   * in the LOAD request, not a property of the stitched stream, and when the
   * sender omits it the receiver fills it in from a duration test (verified in
   * the v3 bundle: `duration === -1 || duration === Infinity ? 'LIVE' :
   * 'BUFFERED'`) — which calls every live DAI stream BUFFERED, because a DAI
   * live stream is stitched into a finite, growing DVR window rather than
   * reporting Infinity.
   *
   * This getter runs for every ad event and the content tracker reads the
   * receiver, so it must not propagate. Unknown reports null rather than
   * guessing 'vod' — a wrong value is worse than an absent one — and only a
   * boolean counts as an answer.
   */
  getStreamType() {
    try {
      // parentTracker ?? contentTracker, as onStreamError does. setAdsTracker()
      // always wires parentTracker, while contentTracker is an optional
      // constructor option — reading only the latter made these answer null for
      // every integrator who omitted it, when the answer was available.
      const content = this.parentTracker ?? this.contentTracker;
      const live = content?.isLive?.();
      if (typeof live === 'boolean') return live ? 'live' : 'vod';
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to read stream type', error);
    }
    return null;
  }

  /**
   * 'dai-ads', matching video-hls-js and video-dash-js. Source-level
   * consistency only — this value does NOT reach New Relic.
   *
   * ⚠️ Corrects the claim in the commit that introduced this rename. That
   * commit said a dashboard filtering trackerName = 'dai-ads' would silently
   * exclude Chromecast. It would not. Verified against stored events: ad
   * telemetry is funnelled through `parentTracker.sendVideoAdAction`, so the
   * CONTENT tracker fills trackerName, playerName and playerVersion with its
   * own values. An hls DAI ad event stores trackerName 'hls' and playerName
   * 'HLS-JS' despite its ad tracker returning 'dai-ads' and 'hls-dai'.
   *
   * `adPartner` ('google-dai') is the only attribute that identifies an event
   * as DAI, and is therefore the only safe filter for a cross-player DAI query.
   *
   * The rename still stands — three sibling implementations answering the same
   * question differently is worth avoiding — but it is cosmetic, not a data
   * fix, and should not be cited as one.
   */
  getTrackerName() {
    return 'dai-ads';
  }

  getTrackerVersion() {
    return version;
  }

  getPlayerName() {
    return 'caf-dai';
  }

  getPlayerVersion() {
    return 'unknown';
  }

  getAdCuePoints() {
    return this.cuePoints;
  }

  getDuration() {
    const duration = this.currentAdData?.duration;
    return duration === undefined || duration === null ? null : duration * 1000;
  }

  getVideoId() {
    return this.currentAdData?.adId ?? null;
  }

  getAdCreativeId() {
    return this.currentAdData?.creativeId ?? null;
  }

  getTitle() {
    return this.currentAdData?.title ?? null;
  }

  getSrc() {
    return this.streamData?.url ?? null;
  }

  /**
   * Progress within the current ad, in ms, falling back to stream time when no
   * ad is in flight.
   *
   * There is deliberately no StreamManager call here: the live SDK exposes no
   * getStreamTime(). Its time API is contentTimeForStreamTime() /
   * streamTimeForContentTime(), both of which take a time rather than
   * reporting the current one. An earlier version called a nonexistent
   * getStreamTime() and silently fell back to the player on every read.
   */
  getPlayhead() {
    const streamTime = this.getStreamTimeMs();
    // null, not NaN or 0: an unreadable clock is an absent measurement, and
    // NaN would serialise into the event as a number-shaped non-number.
    if (!Number.isFinite(streamTime)) return null;
    if (!Number.isFinite(this.adStartStreamTime)) return streamTime;
    return Math.max(0, streamTime - this.adStartStreamTime);
  }

  /**
   * The stitched stream's own clock, in ms — the timeline the DAI cue points
   * and the SDK's time conversions are expressed in. Under SSAI the stitched
   * stream IS that timeline, so CAF's own playback position is the source of
   * truth. Anything comparing against DAI stream positions wants this, NOT
   * getPlayhead(), which is ad-relative while an ad is on screen.
   */
  getStreamTimeMs() {
    // Optional chaining covers a missing playerManager or a missing method. It
    // does NOTHING for a method that THROWS — and throwing when the receiver
    // has nothing loaded is the whole premise of CAFTracker.readFromPlayer().
    // Left bare, this detonated three separate handlers: video-core reads
    // att.adPlayhead = getPlayhead() on every VideoAdAction, so one throw here
    // turned every ad-side send into a throw.
    //
    // NaN rather than 0 on failure: 0 is a real stream position and would be
    // averaged into dashboards as though it had been measured. Every consumer
    // gates on Number.isFinite.
    try {
      const seconds = this.playerManager?.getCurrentTimeSec?.();
      return typeof seconds === 'number' ? seconds * 1000 : NaN;
    } catch (error) {
      nrvideo.Log.debug('CAFDaiTracker: getCurrentTimeSec() threw', error);
      return NaN;
    }
  }

  /**
   * Stream time to content time, for the content tracker's playhead and
   * duration. Returns undefined when the SDK cannot convert — including on a
   * disposed tracker — so the caller keeps reporting stream time rather than a
   * wrong number.
   *
   * Measured behaviour on the sibling DASH integration: on VOD it subtracts the
   * ad time played so far (gap exactly 10.010 after a 10.01s pre-roll, and 0
   * during it); on live it returns the input unchanged, for both the playhead
   * and the DVR duration.
   *
   * Takes and returns SECONDS, the unit the StreamManager's time API uses.
   */
  contentTimeForStreamTime(streamTime) {
    try {
      const contentTime = this.player?.contentTimeForStreamTime?.(streamTime);
      return typeof contentTime === 'number' ? contentTime : undefined;
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to convert stream time', error);
      return undefined;
    }
  }

  /**
   * True while an ad is on screen. Checked by CAFTracker so content QoE stands
   * down during breaks.
   *
   * AD_BREAK_STARTED arrives only after playback has already entered the ad —
   * expected SSAI behaviour, since on live the SDK cannot know about a break
   * before its metadata arrives — so the break object alone misses the first
   * moments of a pre-roll. That window is where CAF's PLAYING event lands, and
   * video-core's goStart() is once-per-view, so CONTENT_START reported there
   * measures content startup time to the ad for the rest of the session. The
   * cue points, known ahead of playback, cover it.
   *
   * Known limitation: cue points are a VOD facility in DAI. The live asset
   * reported none on the sibling DASH integration, so on live this degrades to
   * the break object alone and a live pre-roll can still report CONTENT_START a
   * moment early. That single arm is therefore the entire content guard on live.
   */
  isAdPlaying() {
    // video-core's disposeAdsTracker() calls dispose(), which nulls this
    // tracker's player and tag, but never clears the PARENT's adsTracker
    // reference — verified in 5.1.1 source. So the content guard keeps calling
    // in after setAdsTracker(null). A disposed tracker is not playing anything.
    if (!this.player && !this.tag) return false;

    if (this.adBreakData) return true;

    const cuePoints = this.cuePoints;
    if (!cuePoints?.length) return false;

    // Stream time, not getPlayhead(): cue point windows are stream times, and
    // the ad-relative value would never fall inside a mid-roll's window.
    const streamTime = this.getStreamTimeMs() / 1000;
    if (!Number.isFinite(streamTime)) return false;

    // Skip windows already played: seeking back into a watched pre-roll gets no
    // fresh ad telemetry, so suppressing content there would lose it outright.
    return cuePoints.some(
      (cue) =>
        cue?.played !== true &&
        typeof cue?.start === 'number' &&
        typeof cue?.end === 'number' &&
        cue.end > cue.start &&
        streamTime >= cue.start &&
        streamTime < cue.end
    );
  }

  getAdPartner() {
    return 'google-dai';
  }

  getClickThroughUrl() {
    return this.currentAdData?.clickThroughUrl ?? null;
  }

  isMuted() {
    const content = this.parentTracker ?? this.contentTracker;
    return content?.isMuted?.() ?? null;
  }

  // The stitched stream is decoded by CAF's own player during ads, so every
  // quality figure comes from PlayerManager, not from the StreamManager.
  getRenditionHeight() {
    try {
      return this.playerManager.getStats().height;
    } catch (error) {
      return null;
    }
  }

  getRenditionWidth() {
    try {
      return this.playerManager.getStats().width;
    } catch (error) {
      return null;
    }
  }

  getBitrate() {
    try {
      return this.playerManager.getStats().streamBandwidth;
    } catch (error) {
      return null;
    }
  }

  getRenditionBitrate() {
    return this._currentBitrate;
  }

  // Called by name from CAFTracker.onBitrateChanged() during an ad break.
  onBitrateChanged(ev) {
    this._currentBitrate = ev.totalBitrate;
    this.sendRenditionChanged();
  }

  isLiveStream() {
    return this.getStreamType() === 'live';
  }

  getCurrentAdBreak() {
    return this.adBreakData;
  }

  getCurrentAd() {
    return this.currentAdData;
  }

  getStreamData() {
    return this.streamData;
  }

}
