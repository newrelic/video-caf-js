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

    /** CORE Events */
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

  /** Resets all flags and chronos. */
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

  ononRequestPlayAgain (ev) {
    nrvideo.Log.debug("onRequestPlayAgain  = ", ev)
  }

  onBuffering (ev) {
    nrvideo.Log.debug("onBuffering  = ", ev)
  }

  onError (ev) {
    nrvideo.Log.debug("onError  = ", ev)
  }

  onMediaFinished (ev) {
    nrvideo.Log.debug("onMediaFinished  = ", ev)
  }

  onPause (ev) {
    nrvideo.Log.debug("onPause  = ", ev)
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
