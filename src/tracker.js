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
