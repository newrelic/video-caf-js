import * as nrvideo from "newrelic-video-core";
import { version } from "../package.json";

export default class CAFAdsTracker extends nrvideo.VideoTracker {
  getTrackerName() {
    return 'caf-ads';
  }

  getTrackerVersion() {
    return version;
  }

  getPlayhead() {
    return this.player.getCurrentTimeSec();
  }

  registerListeners() {
    if (!this.player) return;

    this.player.addEventListener(
      cast.framework.events.EventType.BREAK_STARTED,
      (event) => {
        this.onStarted(event);
      }
    );
    this.player.addEventListener(
      cast.framework.events.EventType.BREAK_ENDED,
      (event) => {
        this.onEnded(event);
      }
    );
    this.player.addEventListener(
      cast.framework.events.EventType.BREAK_CLIP_LOADING,
      (event) => {
        this.onClipLoading(event);
      }
    );
    this.player.addEventListener(
      cast.framework.events.EventType.BREAK_CLIP_STARTED,
      (event) => {
        this.onClipStarted(event);
      }
    );
    this.player.addEventListener(
      cast.framework.events.EventType.BREAK_CLIP_ENDED,
      (event) => {
        this.onClipEnded(event);
      }
    );
  }

  onStarted(ev) {
    nrvideo.Log.debug("onStartedAdBreak  = ", ev)
    this.sendAdBreakStart({ adId: ev.breakId });
    this.state.isAdBreak = true;
  }

  onEnded(ev) {
    nrvideo.Log.debug("onEndedAdBreak  = ", ev)
    this.sendAdBreakEnd({ adId: ev.breakId });
    this.state.isAdBreak = false;
  }

  onClipLoading(ev) {
    nrvideo.Log.debug("onClipLoading  = ", ev)
    const breakClip = this.player.getBreakManager().getBreakClipById(ev.breakClipId)
    this.sendRequest({ adId: breakClip.id, adTitle: breakClip.title, adSrc: breakClip.contentId, adDuration: breakClip.duration });
  }

  onClipStarted(ev) {
    nrvideo.Log.debug("onClipStarted  = ", ev)
    this.sendStart();
  }

  onClipEnded(ev) {
    nrvideo.Log.debug("onClipEnded  = ", ev)
    this.sendEnd();
  }
}
