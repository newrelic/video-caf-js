import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'
import CAFAdsTracker from './ads'

export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * Constructor
   */
  constructor () {
    super()
    this.reset()
    this.registerListeners()
  }

  registerListeners() {
    /** CORE Events */
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_FOCUS_STATE, event => { this.onRequestFocusState(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_LOAD, event => { this.onRequestLoad(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_STOP, event => { this.onRequestStop(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PAUSE, event => { this.onRequestPause(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PLAY, event => { this.onRequestPlay(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PLAY_AGAIN, event => { this.onRequestPlayAgain(event) })
    this.player.addEventListener(cast.framework.events.EventType.BUFFERING, event => { this.onBuffering(event) })
    this.player.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, event => { this.onMediaFinished(event) })
    this.player.addEventListener(cast.framework.events.EventType.PAUSE, event => { this.onPause(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOADING, event => { this.onPlayerLoading(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, event => { this.onPlayerLoadComplete(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING, event => { this.onPlayerPreloading(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_PRELOADING_CANCELLED, event => { this.onPlayerPreloadingCancelled(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYING, event => { this.onPlaying(event) })
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_SEEK, event => { this.onSeekStart(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, event => { this.onSeekEnd(event) })
    this.receiverContext.addEventListener(cast.framework.system.EventType.SHUTDOWN, event => { this.onShutdown(event)})

    /** DEBUG Events */
    this.player.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) })
    this.player.addEventListener(cast.framework.events.EventType.ENDED, event => { this.onEnded(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) })

    if (!this.adsTracker) {
      this.setAdsTracker(new CAFAdsTracker(this.player))
    }
  }

  reset () {
    this.receiverContext = cast.framework.CastReceiverContext.getInstance()
    this.player = this.receiverContext.getPlayerManager()
    this._currentBitrate = 0
  }

  getAttributes (att) {
    att = super.getAttributes(att)

    if (this.receiverContext.getSenders().length != 0) {
      att.senderUserAgent = this.receiverContext.getSenders()[0].userAgent
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
    try {
      return this.player.getDurationSec() * 1000
    }
    catch (e) {
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
    try {
      return this.receiverContext.getSystemVolume().muted
    }
    catch (e) {
      return null
    }
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
    this.sendRequest()
  }

  onRequestPlayAgain (ev) {
    nrvideo.Log.debug("onRequestPlayAgain  = ", ev)
  }

  onBuffering (ev) {
    nrvideo.Log.debug("onBuffering  = ", ev)
    if (ev.isBuffering) {
      if (this.adsTracker.state.isAdBreak) {
        nrvideo.Log.debug("Ad buffer start")
        this.adsTracker.sendBufferStart();
      } else {
        nrvideo.Log.debug("Buffer start")
        this.sendBufferStart()
      }
    }
    else {
      if (this.adsTracker.state.isAdBreak) {
        nrvideo.Log.debug("Ad buffer end")
        this.adsTracker.sendBufferEnd();
      } else {
        nrvideo.Log.debug("Buffer end")
        this.sendBufferEnd()
      }
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
    if (!this.adsTracker.state.isAdBreak) {
      nrvideo.Log.debug("onPlaying  = ", ev);
      if (this.state.isPaused) {
        this.sendResume()
      } else {
        this.sendStart()
      }
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

// Static members
export {
  CAFAdsTracker
}
