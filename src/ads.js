import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'

export default class CAFAdsTracker extends nrvideo.VideoTracker {
  getTrackerName () {
    return 'caf-ads'
  }

  getTrackerVersion () {
    return version
  }

  getDuration () {
    return this.player.getDurationSec()
  }

  getSrc () {
    try {
      if (this.player.getMediaInformation().contentUrl != null)
        return this.player.getMediaInformation().contentUrl
    }
    catch (e) {
      return this.getVideoId()
    }
  }

  getPlayhead () {
    return this.player.getCurrentTimeSec()
  }

  getTitle () {
    try {
      return this.player.getMediaInformation().metadata.title
    }
    catch (e) {
      return null
    }
  }

  registerListeners () {
    if (!this.player) return

    nrvideo.Log.debugCommonVideoEvents(this.player, [
      cast.framework.events.EventType.BREAK_STARTED,
      cast.framework.events.EventType.BREAK_ENDED,
      cast.framework.events.EventType.BREAK_CLIP_LOADING,
      cast.framework.events.EventType.BREAK_CLIP_STARTED,
      cast.framework.events.EventType.BREAK_CLIP_ENDED
    ])

    this.player.addEventListener(cast.framework.events.EventType.BREAK_STARTED, event => { this.onStarted(event) })
    this.player.addEventListener(cast.framework.events.EventType.BREAK_ENDED, event => { this.onEnded(event) })
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_LOADING, event => { this.onClipLoading(event) })
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_STARTED, event => { this.onClipStarted(event) })
    this.player.addEventListener(cast.framework.events.EventType.BREAK_CLIP_ENDED, event => { this.onClipEnded(event) })
  }

  onStarted (ev) {
    this.sendRequest()
    this.sendAdBreakStart({adId: ev.breakId})
  }

  onEnded () {
    this.sendAdBreakEnd()
  }

  onClipLoading () {
    this.sendRequest()
  }

  onClipStarted (ev) {
    this.sendStart({adId: ev.breakClipId})
  }

  onClipEnded () {
    this.sendEnd()
  }
}
