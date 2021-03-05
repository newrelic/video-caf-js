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
    const receiverContext = cast.framework.CastReceiverContext.getInstance()
    const playerManager = receiverContext.getPlayerManager()

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
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_STOP, event => { this.onRequestStop(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PAUSE, event => { this.onRequestPause(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PLAY, event => { this.onRequestPlay(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_PLAY_AGAIN, event => { this.onRequestPlayAgain(event) })
    playerManager.addEventListener(cast.framework.events.EventType.BUFFERING, event => { this.onBuffering(event) })
    playerManager.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, event => { this.onMediaFinished(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PAUSE, event => { this.onPause(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_LOADING, event => { this.onPlayerLoading(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, event => { this.onPlayerLoadComplete(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING, event => { this.onPlayerPreloading(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING_CANCELLED, event => { this.onPlayerPreloadingCancelled(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAYING, event => { this.onPlaying(event) })
    playerManager.addEventListener(cast.framework.events.EventType.REQUEST_SEEK, event => { this.onSeekStart(event) })
    playerManager.addEventListener(cast.framework.events.EventType.SEEKED, event => { this.onSeekEnd(event) })
    receiverContext.addEventListener(cast.framework.system.EventType.SHUTDOWN, event => { this.onShutdown(event)})

    /** DEBUG Events */
    playerManager.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) })
    playerManager.addEventListener(cast.framework.events.EventType.ENDED, event => { this.onEnded(event) })
    playerManager.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) })
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

  /** Tracker getters */

  getTrackerName () {
    return 'caf'
  }

  getTrackerVersion () {
    return version
  }

  getVideoId () {
    try {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().contentId
    }
    catch (e) {
      return null
    }
  }

  getPlayhead () {
    return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getCurrentTimeSec() * 1000
  }

  getDuration () {
    if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getDurationSec() > 0) {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getDurationSec() * 1000
    }
    else {
      return null
    }
  }

  getBitrate () {
    try {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().streamBandwidth
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
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().width
    }
    catch (e) {
      return null
    }
  }

  getRenditionHeight () {
    try {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getStats().height
    }
    catch (e) {
      return null
    }
  }

  getTitle () {
    try {
      return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().metadata.title
    }
    catch (e) {
      return null
    }
  }

  getSrc () {
    try {
      if (cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().contentUrl != null)
        return cast.framework.CastReceiverContext.getInstance().getPlayerManager().getMediaInformation().contentUrl
    }
    catch (e) {
      return this.getVideoId()
    }
  }

  getPlayerVersion () {
    return cast.player.api.VERSION
  }

  isMuted () {
    if (cast.framework.CastReceiverContext.getInstance().getSystemVolume())
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

  onRequestPlayAgain (ev) {
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
    this.sendRequest()
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

  onSeekStart (ev) {
    nrvideo.Log.debug("onSeekStart  = ", ev)
    this.sendSeekStart()
  }

  onSeekEnd (ev) {
    nrvideo.Log.debug("onSeekEnd  = ", ev)
    this.sendSeekEnd()
  }

  onShutdown (ev) {
    nrvideo.Log.debug("onShutdown  = ", ev)
    this.sendEnd()
    this.dispose()
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
