import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'
import CAFAdsTracker from './ads'

export default class CAFTracker extends nrvideo.VideoTracker {
  registerListeners() {
    this.player = cast.framework.CastReceiverContext.getInstance().getPlayerManager()

    nrvideo.Log.debugCommonVideoEvents(this.player, [
      cast.framework.events.category.REQUEST,
      cast.framework.events.category.CORE,
      cast.framework.events.category.DEBUG,
      cast.framework.events.category.FINE
    ])

    /** CORE Events */
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PLAY, event => { this.onRequestPlay(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_LOAD, event => { this.onRequestLoad(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_STOP, event => { this.onRequesStop(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PAUSE, event => { this.onRequestPause(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PLAY_AGAIN, event => { this.onRequestPlayAgain(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_SEEK, event => { this.onRequestSeek(event) })
    this.player.addEventListener(cast.framework.events.EventType.BUFFERING, event => { this.onBuffering(event) })
    this.player.addEventListener(cast.framework.events.EventType.ERROR, event => { this.onError(event) })
    this.player.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, event => { this.onEnded(event) })
    this.player.addEventListener(cast.framework.events.EventType.ENDED, event => { this.onEnded(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) })
    this.player.addEventListener(cast.framework.events.EventType.PAUSE, event => { this.onPause(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOADING, event => { this.onPlayerLoading(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, event => { this.onPlayerLoadComplete(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYING, event => { this.onPlaying(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, event => { this.onSeeked(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKING, event => { this.onSeek(event) })
    this.player.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING_CANCELLED, event => { this.onPlayerPreloadingCancelled(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING, event => { this.onPlayerPreloading(event) })

    if (!this.adsTracker) {
      this.setAdsTracker(new CAFAdsTracker(this.player))
    }
  }

  reset () {
    this._currentBitrate = 0
  }

  getAttributes (att) {
    att = super.getAttributes(att)

    if (cast.framework.CastReceiverContext.getInstance().getSenders().length != 0) {
      att.senderUserAgent = cast.framework.CastReceiverContext.getInstance().getSenders()[0].userAgent
    }

    return att
  }

  getTrackerName () {
    return 'caf'
  }

  getTrackerVersion () {
    return version
  }

  getVideoId () {
    try {
      return this.player.getMediaInformation().contentId
    }
    catch (e) {
      return null
    }
  }

  getPlayhead () {
    return this.player.getCurrentTimeSec() * 1000
  }

  getDuration () {
  }

  getDuration () {
    if (this.player.getDurationSec() > 0) {
      return this.player.getDurationSec() * 1000
    }
    else {
      return null
    }
  }

  getBitrate () {
    try {
      return this.player.getStats().streamBandwidth
    }
    catch (e) {
      return null
    }
  }

  getFps () {
    //TODO
  }

  getRenditionBitrate () {
    return this._currentBitrate
  }

  getRenditionName () {
    //TODO
  }

  getRenditionWidth () {
    try {
      return this.player.getStats().width
    }
    catch (e) {
      return null
    }
  }

  getRenditionHeight () {
    try {
      return this.player.getStats().height
    }
    catch (e) {
      return null
    }
  }

  getTitle () {
    try {
      return this.player.getMediaInformation().metadata.title
    }
    catch (e) {
      return null
    }
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

  getPlayerVersion () {
    return cast.player.api.VERSION
  }

  isMuted () {
    return cast.framework.CastReceiverContext.getInstance().getSystemVolume().muted
  }

  getPlayrate () {
    return this.player.getPlaybackRate()
  }

  isAutoplayed () {
    //TODO
  }

  getPreload () {
    //TODO
  }

  getLanguage () {
    return this.player.getPreferredTextLanguage()
  }

  onRequestSeek () {
    this.ensurePlayerReady()
    this.ensureRequested()
  }

  onRequestPlay () {
    this.sendRequest()
  }

  onBuffering (ev) {
    this.ensurePlayerReady()
    this.ensureRequested()

    ev.isBuffering
      ? this.sendBufferStart()
      : this.sendBufferEnd();
  }

  onError (ev) {
    this.sendError({errorCode: ev.detailedErrorCode, errorMessage: ev.reason})
    this.sendEnd()
  }

  onEnded () {
    this.sendEnd()
  }

  onPause (ev) {
    if (!ev.ended) this.sendPause()
  }

  onPlayerLoading () {
    this.sendRequest()
  }

  onPlaying () {
    this.state.isPaused
      ? this.sendResume()
      : this.sendStart()
  }

  onPlay () {
    this.sendBufferEnd()
    this.sendResume()
  }

  onSeek () {
    this.sendSeekStart()
  }

  onSeeked () {
    this.ensurePlayerReady()
    this.ensureRequested()
    this.ensureStarted()

    this.sendSeekEnd()
  }

  onBitrateChanged (ev) {
    this._currentBitrate = ev.totalBitrate
    this.sendRenditionChanged()
  }

  ensurePlayerReady() {
    if (!this.state.isPlayerReady) this.sendPlayerReady()
  }

  ensureRequested() {
    if (!this.state.isRequested) this.sendRequest()
  }

  ensureStarted() {
    if (!this.state.isStarted) this.sendStart()
  }
}

// Static members
export {
  CAFAdsTracker
}
