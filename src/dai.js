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
    return false;
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

  // Ad playback / cue point / metadata events — implemented in Task 2
  onAdStarted(event) {}
  onAdFirstQuartile(event) {}
  onAdMidpoint(event) {}
  onAdThirdQuartile(event) {}
  onAdComplete(event) {}
  onAdSkipped(event) {}
  onAdPaused(event) {}
  onAdResumed(event) {}
  onAdClicked(event) {}
  onCuePointsChanged(event) {}
  onTimedMetadata(event) {}

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

  getSrc() {
    return this.streamData?.url ?? null;
  }

  getCurrentAdBreak() {
    return this.adBreakData;
  }

  getStreamData() {
    return this.streamData;
  }

}
