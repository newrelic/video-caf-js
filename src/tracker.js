import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'

export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * Constructor
   */
  constructor () {
    super()
    this.registerListeners()
    this.reset()
  }

  registerListeners() {
    const playerManager = cast.framework.CastReceiverContext.getInstance().getPlayerManager()

    /*
    // This captured all events. For testing and debug purpose only.
    playerManager.addEventListener(cast.framework.events.category.REQUEST, event => { nrvideo.Log.debug("REQUEST = ", event) })
    playerManager.addEventListener(cast.framework.events.category.CORE, event => { nrvideo.Log.debug("CORE = ", event) })
    playerManager.addEventListener(cast.framework.events.category.DEBUG, event => { nrvideo.Log.debug("DEBUG = ", event) })
    playerManager.addEventListener(cast.framework.events.category.FINE, event => { nrvideo.Log.debug("FINE = ", event) })
    */

    /** CORE Events */
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_FOCUS_STATE, event => { this.onRequestFocusState(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_LOAD, event => { this.onRequestLoad(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_STOP, event => { this.onRequesStop(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PAUSE, event => { this.onRequestPause(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PLAY, event => { this.onRequestPlay(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PLAY_AGAIN, event => { this.onRequestPlayAgain(event) })
    playerManager.addEventListener(cast.framework.events.EventType.BUFFERING, event => { this.onBuffering(event) })
    playerManager.addEventListener(cast.framework.events.EventType.ERROR, event => { this.onError(event) })
    playerManager.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, event => { this.onMediaFinished(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PAUSE, event => { this.onPause(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_LOADING, event => { this.onPlayerLoading(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, event => { this.onPlayerLoadComplete(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING, event => { this.onPlayerPreloading(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING_CANCELLED, event => { this.onPlayerPreloadingCancelled(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYING, event => { this.onPlaying(event) })

    /** DEBUG Events */
    playerManager.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) })    
    playerManager.addEventListener(cast.framework.events.EventType.ENDED, event => { this.onEnded(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) })
  }

  reset () {
    this._currentBitrate = 0
  }

  /** Tracker getters */

  getTrackerName () {
    return 'caf'
  }

  getTrackerVersion () {
    return version
  }

  getVideoId () {
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation() != null) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().contentId
    }
    else {
      return null
    }
  }

  getPlayhead () {
    return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getCurrentTimeSec()
  }

  getDuration () {
    return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getDurationSec()
  }

  getBitrate () {
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats() != null) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().streamBandwidth
    }
    else {
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
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats() != null) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().width
    }
    else {
      return null
    }
  }

  getRenditionHeight () {
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats() != null) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().height
    }
    else {
      return null
    }
  }

  getTitle () {
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation() != null) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().metadata.title
    }
    else {
      return null
    }
  }

  getSrc () {
    const mediaInfo = cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation()
    if (mediaInfo != null) {
      if (mediaInfo.contentUrl != undefined) {
        return mediaInfo.contentUrl
      }
      else {
        return this.getVideoId()
      }
    }
    else {
      return null
    }
  }

  getPlayerVersion () {
    return cast.player.api.VERSION
  }

  isMuted () {
    return cast.framework.CastReceiverContext.getInstance().getSystemVolume().muted
  }

  getPlayrate () {
    return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getPlaybackRate()
  }

  isAutoplayed () {
    //TODO
  }

  getPreload () {
    //TODO
  }

  getLanguage () {
    return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getPreferredTextLanguage()
  }

  /** CORE Events Listeners */

  onRequestFocusState (ev) {
    nrvideo.Log.debug("onRequestFocusState = ", ev)
    this.sendPlayerReady()
  }

  onRequestLoad (ev) {
    nrvideo.Log.debug("OnRequestLoad = ", ev)
    this.sendRequest()
  }

  onRequestStop (ev) {
    nrvideo.Log.debug("OnRequestStop = ", ev)
  }

  onRequestPause (ev) {
    nrvideo.Log.debug("onRequestPause  = ", ev)
  }

  onRequestPlay (ev) {
    nrvideo.Log.debug("onRequestPlay  = ", ev)
  }

  ononRequestPlayAgain (ev) {
    nrvideo.Log.debug("onRequestPlayAgain  = ", ev)
  }

  onBuffering (ev) {
    nrvideo.Log.debug("onBuffering  = ", ev)
    if (ev.isBuffering) {
      nrvideo.Log.debug("Buffer start")
      this.sendBufferStart()
    }
    else {
      nrvideo.Log.debug("Buffer end")
      this.sendBufferEnd()
    }
  }

  onError (ev) {
    nrvideo.Log.debug("onError  = ", ev)
    this.sendError({errorCode: ev.detailedErrorCode, errorMessage: ev.reason})
  }

  onMediaFinished (ev) {
    nrvideo.Log.debug("onMediaFinished  = ", ev)
    this.sendEnd()
  }

  onPause (ev) {
    nrvideo.Log.debug("onPause  = ", ev)
    if (!ev.ended) {
      this.sendPause()
    }
  }

  onPlayerLoading (ev) {
    nrvideo.Log.debug("onPlayerLoading  = ", ev)
  }

  onPlayerLoadComplete (ev) {
    nrvideo.Log.debug("onPlayerLoadComplete  = ", ev)
  }

  onPlayerPreloading (ev) {
    nrvideo.Log.debug("onPlayerPreloading  = ", ev)
  }

  onPlayerPreloadingCancelled (ev) {
    nrvideo.Log.debug("onPlayerPreloadingCancelled  = ", ev)
  }

  onPlaying (ev) {
    nrvideo.Log.debug("onPlaying  = ", ev)
    if (this.state.isPaused) {
      this.sendResume()
    }
    else {
      this.sendStart()
    }
  }

  /** DEBUG Events Listeners */

  onBitrateChanged (ev) {
    nrvideo.Log.debug("onBitrateChanged  = ", ev)
    this._currentBitrate = ev.totalBitrate
    this.sendRenditionChanged()
  }

  onEnded (ev) {
    nrvideo.Log.debug("onEnded  = ", ev)
  }

  onPlay (ev) {
    nrvideo.Log.debug("onPlay  = ", ev)
  }
}
