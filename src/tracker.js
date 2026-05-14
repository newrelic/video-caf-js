import nrvideo from '@newrelic/video-core'
import { version } from '../package.json'
import CAFAdsTracker from './ads'

export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * @param {object} receiverContext  cast.framework.CastReceiverContext.getInstance()
   * @param {object} options
   * @param {object} options.info
   * @param {string} options.info.licenseKey    New Relic Browser license key
   * @param {string} options.info.beacon        e.g. "bam.nr-data.net"
   * @param {string} options.info.applicationID New Relic application ID
   * @param {object} [options.config]           Optional video-core config
   */
  constructor(receiverContext, options) {
    if (!receiverContext || typeof receiverContext.getPlayerManager !== 'function') {
      throw new Error('CAFTracker requires a valid CastReceiverContext. Pass cast.framework.CastReceiverContext.getInstance() as the first argument.');
    }
    super(receiverContext.getPlayerManager(), options);
    this.receiverContext = receiverContext;
    this.reset();
    nrvideo.Core.addTracker(this, options);
  }

  registerListeners() {
    /** CORE Events */

    this.player.addEventListener(cast.framework.events.EventType.REQUEST_FOCUS_STATE, event => { this.onRequestFocusState(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYER_LOADING, event => { this.onPlayerLoading(event) })
    this.player.addEventListener(cast.framework.events.EventType.LOADED_METADATA, event => { this.onLoadedMetadata(event) }) 
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_PLAY, event => { this.onRequestPlay(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAYING, event => { this.onPlaying(event) })
    this.player.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) })
    this.player.addEventListener(cast.framework.events.EventType.PAUSE, event => { this.onPause(event) })
    this.player.addEventListener(cast.framework.events.EventType.BUFFERING, event => { this.onBuffering(event) })
    this.player.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) });
    this.player.addEventListener(cast.framework.events.EventType.SEEKING, event => { this.onSeekStart(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, event => { this.onSeekEnd(event) })
    this.player.addEventListener(cast.framework.events.EventType.ERROR, event => { this.onError(event) })
    this.player.addEventListener(cast.framework.events.EventType.MEDIA_STATUS, event => { this.onMediaStatus(event) })
    this.player.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, event => { this.onMediaFinished(event) })

    if (!this.adsTracker) {
      this.setAdsTracker(new CAFAdsTracker(this.player))
    }
  }

  unregisterListeners() {
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_FOCUS_STATE, this.onRequestFocusState);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYER_LOADING, this.onPlayerLoading);
    this.player.removeEventListener(cast.framework.events.EventType.LOADED_METADATA, this.onLoadedMetadata);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_PLAY, this.onRequestPlay);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYING, this.onPlaying);
    this.player.removeEventListener(cast.framework.events.EventType.PLAY, this.onPlay);
    this.player.removeEventListener(cast.framework.events.EventType.PAUSE, this.onPause);
    this.player.removeEventListener(cast.framework.events.EventType.BUFFERING, this.onBuffering);
    this.player.removeEventListener(cast.framework.events.EventType.BITRATE_CHANGED, this.onBitrateChanged);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKING, this.onSeekStart);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKED, this.onSeekEnd);
    this.player.removeEventListener(cast.framework.events.EventType.ERROR, this.onError);
    this.player.removeEventListener(cast.framework.events.EventType.MEDIA_STATUS, this.onMediaStatus);
    this.player.removeEventListener(cast.framework.events.EventType.MEDIA_FINISHED, this.onMediaFinished);
  }

  reset () {
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

  getInstrumentationProvider() {
    return 'New Relic';
  }

  getInstrumentationName() {
    return this.getPlayerName();
  }

  getInstrumentationVersion() {
    return this.getPlayerVersion();
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

  getRenditionBitrate () {
    return this._currentBitrate
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

  getPlayerName() {
    return 'caf'
  }

  getPlayerVersion () {
    try {
      return cast.player.api.VERSION
    }
    catch (e) {
      return null
    }
  }

  isMuted () {
    try {
      return this.mediaStatus.volume.muted
    }
    catch (e) {
      return null
    }
  }

  getPlayrate () {
    return this.player.getPlaybackRate()
  }

  getLanguage () {
    return this.player.getPreferredTextLanguage()
  }

  /** CORE Events Listeners */

  onRequestFocusState (ev) {
    this.sendPlayerReady()
  }

  onRequestPlay (ev) {
    this.sendRequest()
  }

  onLoadedMetadata (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      this.sendDownload()
    }
  }

  onBuffering (ev) {
    if (ev.isBuffering) {
      if (this.adsTracker.state.isAdBreak) {
        this.adsTracker.sendBufferStart();
      } else {
        this.sendBufferStart()
      }
    }
    else {
      if (this.adsTracker.state.isAdBreak) {
        this.adsTracker.sendBufferEnd();
      } else {
        this.sendBufferEnd()
      }
    }
  }

  onMediaFinished (ev) {
    this.sendEnd()
  }

  onPlay (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      this.sendResume()
    } else {
      this.adsTracker.sendResume()
    }
  }

  onPause (ev) {
    if (!ev.ended) {
      if (!this.adsTracker.state.isAdBreak) {
        this.sendPause()
      } else {
        this.adsTracker.sendPause()
      }
    }
  }

  onPlayerLoading (ev) {
    this.sendRequest()
  }

  onPlaying (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      this.sendStart()
    } 
  }

  onSeekStart (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      this.sendSeekStart()
    } else {
      this.adsTracker.sendSeekStart()
    }
  }

  onSeekEnd (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      this.sendSeekEnd()
    } else {
      this.adsTracker.sendSeekEnd()
    }
  }

  onShutdown (ev) {
    this.sendEnd()
    this.dispose()
  }

  onError (ev) {
    let errorMessage = ev.reason; 
    if (ev.error && ev.error.message) {
      errorMessage = ev.error.message;
    }

    if (this.state._isAd || ev.detailedErrorCode === cast.framework.events.DetailedErrorCode.BREAK_CLIP_LOADING_ERROR || 
        ev.detailedErrorCode === cast.framework.events.DetailedErrorCode.BREAK_SEEK_INTERCEPTOR_ERROR) {
      this.adsTracker.sendError({errorCode: ev.detailedErrorCode, errorMessage: errorMessage})
      return
    }
    this.sendError({errorCode: ev.detailedErrorCode, errorMessage: errorMessage})
  }

  /** DEBUG Events Listeners */

  onBitrateChanged (ev) {
    this._currentBitrate = ev.totalBitrate
    if (!this.adsTracker.state.isAdBreak) {
      this.sendRenditionChanged()
    } else {
      this.adsTracker.onBitrateChanged(ev)
    }
  }

  onMediaStatus (ev) {
    this.mediaStatus = ev.mediaStatus
  }

}

// Static members
export {
  CAFAdsTracker
}
