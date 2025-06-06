import * as nrvideo from "newrelic-video-core";
import { version } from "../package.json";

export default class CAFAdsTracker extends nrvideo.VideoTracker {

  constructor(player) {
    super(player);
    this.reset();
  }

  getTrackerName() {
    return 'caf-ads';
  }

  getTrackerVersion() {
    return version;
  }

  getVideoId() {
    if (this.breakClip != null) {
      return this.breakClip.id
    }
    return null
  }

  getTitle() {
    if (this.breakClip != null) {
      return this.breakClip.title
    }
    return null
  }

  getSrc() {
    if (this.breakClip != null) {
      return this.breakClip.contentId
    }
    return null
  }

  getDuration() {
    if (this.breakClip != null) {
      return this.breakClip.duration
    }
    return null
  }

  getRenditionBitrate () {
    return this._currentBitrate
  }

  registerListeners() {
    if (!this.player) return;

    this.player.addEventListener(cast.framework.events.EventType.BREAK_STARTED, (event) => {this.onStarted(event)});
    this.player.addEventListener(cast.framework.events.EventType.BREAK_ENDED, (event) => {this.onEnded(event)});
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_LOADING,(event) => {this.onClipLoading(event)});
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_STARTED,(event) => {this.onClipStarted(event)});
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_ENDED,(event) => {this.onClipEnded(event)});
    this.player.addEventListener(cast.framework.events.EventType.TIME_UPDATE, (event) => {this.onTimeUpdate(event)});
    this.player.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, (event) => {this.onBitrateChanged(event)});
    this.player.addEventListener(cast.framework.events.EventType.PAUSE, (event) => {this.onPause(event)});
    this.player.addEventListener(cast.framework.events.EventType.PLAY, (event) => {this.onPlay(event)});
    this.player.addEventListener(cast.framework.events.EventType.SEEKING, (event) => {this.onSeekStart(event)});
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, (event) => {this.onSeekEnd(event)});
  }

  unregisterListeners() {
    this.player.removeEventListener(cast.framework.events.EventType.BREAK_STARTED, this.onStarted);
    this.player.removeEventListener(cast.framework.events.EventType.BREAK_ENDED, this.onEnded);
    this.player.removeEventListener(cast.framework.events.EventType.BREAK_CLIP_LOADING, this.onClipLoading);
    this.player.removeEventListener(cast.framework.events.EventType.BREAK_CLIP_STARTED, this.onClipStarted);
    this.player.removeEventListener(cast.framework.events.EventType.BREAK_CLIP_ENDED, this.onClipEnded);
    this.player.removeEventListener(cast.framework.events.EventType.TIME_UPDATE, this.onTimeUpdate);
    this.player.removeEventListener(cast.framework.events.EventType.BITRATE_CHANGED, this.onBitrateChanged);
    this.player.removeEventListener(cast.framework.events.EventType.PAUSE, this.onPause);
    this.player.removeEventListener(cast.framework.events.EventType.PLAY, this.onPlay);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKING, this.onSeekStart);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKED, this.onSeekEnd);
  }

  reset() {
    this.quartilesTracked = {};
    this._currentBitrate = 0;
  }

  onStarted(ev) {
    this.sendAdBreakStart({ adBreakId: ev.breakId });
  }

  onEnded(ev) {
    this.sendAdBreakEnd({ adBreakId: ev.breakId });
  }

  onClipLoading(ev) {
    this.breakClip = this.player.getBreakManager().getBreakClipById(ev.breakClipId);
    this.quartilesTracked = {};  // Reset quartiles when a new clip loads
    this.sendRequest();
  }

  onClipStarted(ev) {
    this.sendStart();
  }

  onClipEnded(ev) {
    this.sendEnd();
  }

  onTimeUpdate(ev) {
    if (!this.breakClip || this.breakClip.duration === undefined || this.breakClip.duration <= 0) {
      return; 
    }

    const currentTime = ev.currentMediaTime;
    const duration = this.breakClip.duration; 
    if (currentTime > 0 && currentTime <= duration) {
      const progressPercent = (currentTime / duration) * 100;

      if (progressPercent >= 25 && progressPercent < 50 && !this.quartilesTracked['firstQuartile']) {
        nrvideo.Log.debug(`Ad Quartile 25% reached, currentTime: ${currentTime}`);
        this.sendAdQuartile({ adQuartile: 1 });
        this.quartilesTracked['firstQuartile'] = true;
      }
      if (progressPercent >= 50 && progressPercent < 75 && !this.quartilesTracked['midpoint']) {
        nrvideo.Log.debug(`Ad Quartile 50% reached, currentTime: ${currentTime}`);
        this.sendAdQuartile({ adQuartile: 2 });
        this.quartilesTracked['midpoint'] = true;
      }
      if (progressPercent >= 75 && !this.quartilesTracked['thirdQuartile']) {
        nrvideo.Log.debug(`Ad Quartile 75% reached, currentTime: ${currentTime}`);
        this.sendAdQuartile({ adQuartile: 3 });
        this.quartilesTracked['thirdQuartile'] = true;
      }
    }
  }

  onBitrateChanged (ev) {
    this._currentBitrate = ev.totalBitrate
    this.sendRenditionChanged()
  }

  onPause() {
    this.sendPause();
  }

  onPlay() {
    this.sendResume();
  }

  onSeekStart (ev) {
    this.sendSeekStart()
  }

  onSeekEnd (ev) {
    this.sendSeekEnd()
  }

  onError (ev) {
    let errorMessage = ev.reason; 

    if (ev.error && ev.error.message) {
      errorMessage = ev.error.message;
    }
    this.sendError({errorCode: ev.detailedErrorCode, errorMessage: errorMessage})
  }

}