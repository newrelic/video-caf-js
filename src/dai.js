/* global google */
import nrvideo from '@newrelic/video-core'
import { version } from '../package.json'

export default class CAFDaiTracker extends nrvideo.VideoTracker {

  constructor(streamManager, options) {
    super(streamManager, options);
    this.streamManager = streamManager;
    this.playerManager = options?.playerManager || null;
    this.contentTracker = options?.contentTracker || null;
    this.currentAdData = null;
    this.adBreakData = null;
    this.streamData = null;
    this.cuePoints = [];
    this._currentBitrate = 0;
  }

  static isUsing(streamManager) {
    return !!(streamManager && typeof streamManager.getStreamTime === 'function');
  }

  registerListeners() {
    if (!this.player || !google?.ima?.dai?.api?.StreamEvent) {
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
    this.streamData = this.extractStreamData(event);
    nrvideo.Log.debug('CAFDaiTracker: Stream loaded', this.streamData);
    this.sendRequest();
  }

  onStreamInitialized(event) {
    nrvideo.Log.debug('CAFDaiTracker: Stream initialized');
    this.sendDownload({ state: 'stream-initialized' });
  }

  onStreamError(event) {
    const errorData = this.extractErrorData(event);
    nrvideo.Log.error('CAFDaiTracker: Stream error', errorData);
    this.sendError(errorData);
  }

  // Ad Break Event Handlers
  onAdBreakStarted(event) {
    this.adBreakData = this.extractAdBreakData(event);
    nrvideo.Log.debug('CAFDaiTracker: Ad break started', this.adBreakData);
    this.sendAdBreakStart(this.adBreakData);
  }

  onAdBreakEnded(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad break ended');
    this.sendAdBreakEnd();
    this.adBreakData = null;
  }

  // Ad Period Event Handlers (for bumpers, etc.)
  onAdPeriodStarted(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad period started');
    if (!this.adBreakData) {
      this.onAdBreakStarted(event);
    }
  }

  onAdPeriodEnded(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad period ended');
    // Don't end the break here as there might be more ads
  }

  // Individual Ad Event Handlers
  onAdStarted(event) {
    this.currentAdData = this.extractAdData(event);
    nrvideo.Log.debug('CAFDaiTracker: Ad started', this.currentAdData);
    this.sendStart();
  }

  onAdFirstQuartile(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad first quartile');
    this.sendAdQuartile({ quartile: 1 });
  }

  onAdMidpoint(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad midpoint');
    this.sendAdQuartile({ quartile: 2 });
  }

  onAdThirdQuartile(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad third quartile');
    this.sendAdQuartile({ quartile: 3 });
  }

  onAdComplete(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad complete');
    this.sendEnd();
    this.currentAdData = null;
  }

  onAdSkipped(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad skipped');
    this.sendEnd({ skipped: true });
    this.currentAdData = null;
  }

  onAdPaused(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad paused');
    this.sendPause();
  }

  onAdResumed(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad resumed');
    this.sendResume();
  }

  onAdClicked(event) {
    nrvideo.Log.debug('CAFDaiTracker: Ad clicked');
    this.sendAdClick({ url: this.getClickThroughUrl() });
  }

  // Cue Points Handler
  onCuePointsChanged(event) {
    this.cuePoints = this.extractCuePoints(event);
    nrvideo.Log.debug('CAFDaiTracker: Cue points changed', this.cuePoints);
  }

  // Timed Metadata Handler
  onTimedMetadata(event) {
    const metadata = this.extractTimedMetadata(event);
    nrvideo.Log.debug('CAFDaiTracker: Timed metadata', metadata);
  }

  // Data Extraction Methods
  extractStreamData(event) {
    try {
      const streamData = event.getStreamData();
      return {
        streamId: streamData?.streamId,
        url: streamData?.url,
        adTagParameters: streamData?.adTagParameters,
        streamType: this.getStreamType(),
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract stream data', error);
      return {};
    }
  }

  extractAdBreakData(event) {
    try {
      const adBreakData = event.getAdBreak();
      return {
        adBreakId: adBreakData?.id,
        adBreakTitle: adBreakData?.title,
        adCount: adBreakData?.ads?.length || 0,
        position: this.getAdPosition(),
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract ad break data', error);
      return {};
    }
  }

  extractAdData(event) {
    try {
      const ad = event.getAd();
      return {
        adId: ad?.getAdId?.(),
        creativeId: ad?.getCreativeId?.(),
        duration: ad?.getDuration?.(),
        title: ad?.getTitle?.(),
        description: ad?.getDescription?.(),
        advertiserName: ad?.getAdvertiserName?.(),
        clickThroughUrl: ad?.getClickThroughUrl?.(),
        dealId: ad?.getDealId?.(),
        wrapperAdIds: ad?.getWrapperAdIds?.(),
        position: this.getAdPosition(),
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract ad data', error);
      return {};
    }
  }

  extractCuePoints(event) {
    try {
      return event.getCuepoints() || [];
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract cue points', error);
      return [];
    }
  }

  extractTimedMetadata(event) {
    try {
      return {
        type: event.getType(),
        data: event.getData(),
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract timed metadata', error);
      return {};
    }
  }

  extractErrorData(event) {
    try {
      const error = event.getError();
      return {
        errorCode: error?.getErrorCode(),
        errorMessage: error?.getMessage(),
        innerError: error?.getInnerError(),
      };
    } catch (error) {
      nrvideo.Log.warn('CAFDaiTracker: Failed to extract error data', error);
      return { errorMessage: 'Unknown DAI error' };
    }
  }

  getAdPosition() {
    if (!this.currentAdData && !this.adBreakData) return null;
    const currentTime = this.playerManager?.getCurrentTimeSec?.() ?? 0;
    const duration = this.playerManager?.getDurationSec?.();
    if (currentTime < 5) return 'pre';
    if (duration && currentTime > duration - 10) return 'post';
    return 'mid';
  }

  getStreamType() {
    if (this.streamData?.streamType) {
      return this.streamData.streamType;
    }
    const duration = this.playerManager?.getDurationSec?.();
    return duration === Infinity ? 'live' : 'vod';
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
    if (this.currentAdData?.duration !== undefined) {
      return this.currentAdData.duration * 1000;
    }
    return null;
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

  getPlayhead() {
    try {
      return this.streamManager.getStreamTime() * 1000;
    } catch (error) {
      return (this.playerManager?.getCurrentTimeSec?.() ?? 0) * 1000;
    }
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

  getRenditionHeight() {
    return null;
  }

  getRenditionWidth() {
    return null;
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
