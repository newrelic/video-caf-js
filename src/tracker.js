import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'

export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * Constructor
   */
  constructor () {
    super()
    //TODO: init
    nrvideo.Log.debug("CAF Tracker initialized")
    this.registerListeners()
  }

  registerListeners() {
    nrvideo.Log.debug("Register CAF Listeners")
    
    const playerManager = cast.framework.CastReceiverContext.getInstance().getPlayerManager()
    playerManager.addEventListener(cast.framework.events.category.CORE, event => { nrvideo.Log.debug('CORE EVENT = ', event) })
    playerManager.addEventListener(cast.framework.events.category.DEBUG, event => { nrvideo.Log.debug('DEBUG EVENT = ', event) })
    playerManager.addEventListener(cast.framework.events.category.FINE, event => { nrvideo.Log.debug('FINE EVENT = ', event) })
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
}
