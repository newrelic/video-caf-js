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
    this.clearCurrentAd();
    this.adBreakData = null;
    this.adBreakFromPeriod = false;
    this.cuePoints = [];
    this.streamData = null;

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

    if (this.adBreakData) this.sendError(errorData);

    if (contentTracker?.sendError) {
      contentTracker.sendError(errorData);
    } else if (!this.adBreakData) {
      // Nothing else to report on — better an ad error than a lost error.
      this.sendError(errorData);
    }
  }

  // Ad Break Event Handlers
  onAdBreakStarted(event) {
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
    // An ad still in flight has to be ended first. video-core's goAdBreakEnd()
    // clears isRequested but not isStarted, and only sendEnd() resets that, so
    // leaving a started ad unfinished here blocks AD_START for every later ad
    // in the session. Happens whenever a break ends mid-ad: a seek out of a
    // mid-roll, an ad error, a source switch.
    if (this.currentAdData) {
      this.sendEnd();
      this.clearCurrentAd();
    }

    // Attributes go out here rather than at AD_BREAK_STARTED: the break's
    // details are only known once its first ad has been seen (see onAdStarted).
    this.sendAdBreakEnd(this.adBreakAttributes());
    this.adBreakData = null;
    this.adBreakFromPeriod = false;
  }

  // Ad Period Event Handlers (for bumpers, etc.)
  onAdPeriodStarted(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad period started');
    // Bumpers and some live breaks fire only a period start, with no
    // AD_BREAK_STARTED to open the break.
    if (!this.adBreakData) {
      this.adBreakFromPeriod = true;
      this.onAdBreakStarted(event);
    }
  }

  onAdPeriodEnded() {
    nrvideo.Log.debug('CAFDaiTracker: Ad period ended');
    // A break this tracker opened from a period event gets no AD_BREAK_ENDED —
    // that is the premise of the fallback above — so the period end is its only
    // closing path. Without this the break stays open for the rest of the
    // session and CAFTracker's `adsTracker.state.isAdBreak` guard suppresses
    // all content telemetry. Periods nested inside an SDK-announced break are
    // left alone: that break may still have more ads, and its own
    // AD_BREAK_ENDED will close it.
    if (this.adBreakFromPeriod) {
      this.onAdBreakEnded();
    }
  }

  // Individual Ad Event Handlers
  onAdStarted(event) {
    this.currentAdData = this.extractAdData(event);
    this.adStartStreamTime = this.getStreamTimeMs();
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
    this.sendEnd();
    this.clearCurrentAd();
  }

  onAdSkipped() {
    nrvideo.Log.debug('CAFDaiTracker: Ad skipped');
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
      // No streamType snapshot here: getStreamType() derives it from the
      // player's duration, which is not known this early in the stream.
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
   * onAdStarted. Must stay non-null — CAFTracker's ad-break guard reads
   * video-core's own state flag, but getCurrentAdBreak() consumers treat this
   * object as "a break is in progress".
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
   * 'live' or 'vod', inferred from CAF's own duration. StreamData carries no
   * stream type of its own to consult, and PlayerManager exposes no live flag.
   *
   * getDurationSec() throws before media is loaded — CAFTracker.getDuration()
   * guards it for the same reason — and this getter runs for every ad event.
   */
  getStreamType() {
    try {
      return this.playerManager.getDurationSec() === Infinity ? 'live' : 'vod';
    } catch (error) {
      return 'vod';
    }
  }

  getTrackerName() {
    return 'caf-dai';
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
    if (this.adStartStreamTime == null) return streamTime;
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
    return (this.playerManager?.getCurrentTimeSec?.() ?? 0) * 1000;
  }

  getAdPartner() {
    return 'google-dai';
  }

  getClickThroughUrl() {
    return this.currentAdData?.clickThroughUrl ?? null;
  }

  isMuted() {
    return this.contentTracker?.isMuted?.() ?? null;
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
