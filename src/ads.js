import nrvideo from '@newrelic/video-core'
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

    const ET = cast.framework.events.EventType;

    // Store the handler references. removeEventListener matches on IDENTITY,
    // so registering an arrow wrapper and later passing the bare method
    // removed nothing at all — this tracker stayed attached to the
    // PlayerManager after dispose(). That matters at setAdsTracker(): a still
    // live auto-created ads tracker double-reports every CAF-native break
    // alongside the DAI tracker. (video-core's own disposeAdsTracker() has the
    // same class of bug in Emitter.off, which indexOf-matches a bound
    // function; stopping the events here is what breaks the chain, because a
    // tracker that hears nothing emits nothing.)
    this.eventHandlers = {
      [ET.BREAK_STARTED]: (event) => this.onStarted(event),
      [ET.BREAK_ENDED]: (event) => this.onEnded(event),
      [ET.BREAK_CLIP_LOADING]: (event) => this.onClipLoading(event),
      [ET.BREAK_CLIP_STARTED]: (event) => this.onClipStarted(event),
      [ET.BREAK_CLIP_ENDED]: (event) => this.onClipEnded(event),
      [ET.TIME_UPDATE]: (event) => this.onTimeUpdate(event),
    };

    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.player.addEventListener(type, handler)
    );
  }

  unregisterListeners() {
    // dispose() nulls the player, and video-core may call this more than once.
    if (!this.player || !this.eventHandlers) return;

    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.player.removeEventListener(type, handler)
    );
    this.eventHandlers = null;
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
        this.sendAdQuartile({ adQuartile: 1 });
        this.quartilesTracked['firstQuartile'] = true;
      }
      if (progressPercent >= 50 && progressPercent < 75 && !this.quartilesTracked['midpoint']) {
        this.sendAdQuartile({ adQuartile: 2 });
        this.quartilesTracked['midpoint'] = true;
      }
      if (progressPercent >= 75 && !this.quartilesTracked['thirdQuartile']) {
        this.sendAdQuartile({ adQuartile: 3 });
        this.quartilesTracked['thirdQuartile'] = true;
      }
    }
  }

  onBitrateChanged (ev) {
    this._currentBitrate = ev.totalBitrate
    this.sendRenditionChanged()
  }

}