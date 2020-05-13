import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'

//TODO: add class description
export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * Constructor
   */
  constructor () {
    super()
    this.registerListeners()
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

  /** Reset all states. */
  reset () {
    //TODO: set flags and other stuff
  }

  /**
   * Returns tracker name.
   * @returns {String} Tracker name.
   */
  getTrackerName () {
    return 'caf'
  }

  /**
   * Returns tracker version. Fetched from package.
   * @returns {String} Tracker version.
   */
  getTrackerVersion () {
    return version
  }

  //TODO: add getters

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
    //TODO: get error message from "ev"
    this.sendError()
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
  }

  onEnded (ev) {
    nrvideo.Log.debug("onEnded  = ", ev)
  }

  onPlay (ev) {
    nrvideo.Log.debug("onPlay  = ", ev)
  }
}
