import * as nrvideo from 'newrelic-video-core'
import { version } from '../package.json'
import CAFAdsTracker from './ads'
import NRHarvester from './harvester';
import {DEFAULT_HARVEST_TIME, DEFAULT_BUFFER_SIZE} from './constants'

export default class CAFTracker extends nrvideo.VideoTracker {

  /**
   * Constructor
   */
  constructor(receiverContext, options, authCredentials) {
    super(receiverContext.getPlayerManager(), options);
    this.receiverContext = receiverContext;
    this.reset();
    this.configureAuthentication(authCredentials);
    this.initializeHarvester();
  }

  configureAuthentication(authCredentials) {
      this.accountId = authCredentials.accountId;
      this.licenseKey = authCredentials.applicationToken;
      this.endpoint = authCredentials.endpoint;
  }

  initializeHarvester() {
      this.nrHarvester = new NRHarvester(this.licenseKey, this.endpoint, {
          harvestInterval: DEFAULT_HARVEST_TIME,
          maxBufferSize: DEFAULT_BUFFER_SIZE,
      });
      this.updateRecordCustomEvent();
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
    this.player.addEventListener(cast.framework.events.EventType.REQUEST_SEEK, event => { this.onRequestSeek(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKING, event => { this.onSeekStart(event) })
    this.player.addEventListener(cast.framework.events.EventType.SEEKED, event => { this.onSeekEnd(event) })
    this.player.addEventListener(cast.framework.events.EventType.ERROR, event => { this.onError(event) })
    this.player.addEventListener(cast.framework.events.EventType.MEDIA_STATUS, event => { this.onMediaStatus(event) })
    // cast.framework.system.EventType.SHUTDOWN has to be part of SYSTEM_METRICS. Commented this out for now 
    // this.receiverContext.addEventListener(cast.framework.system.EventType.SHUTDOWN, event => { this.onShutdown(event)})

    /** DEBUG Events */
    this.player.addEventListener(cast.framework.events.EventType.BITRATE_CHANGED, event => { this.onBitrateChanged(event) });
    this.player.addEventListener(cast.framework.events.EventType.ENDED, event => { this.onEnded(event) });
    this.player.addEventListener(cast.framework.events.EventType.PLAY, event => { this.onPlay(event) });

    if (!this.adsTracker) {
      this.setAdsTracker(new CAFAdsTracker(this.player))
    }
  }

  unregisterListeners() {
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_FOCUS_STATE, this.onRequestFocusState);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_LOAD, this.onRequestLoad);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_STOP, this.onRequestStop);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_PAUSE, this.onRequestPause);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_PLAY, this.onRequestPlay);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_PLAY_AGAIN, this.onRequestPlayAgain);
    this.player.removeEventListener(cast.framework.events.EventType.BUFFERING, this.onBuffering);
    this.player.removeEventListener(cast.framework.events.EventType.MEDIA_FINISHED, this.onMediaFinished);
    this.player.removeEventListener(cast.framework.events.EventType.PAUSE, this.onPause);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYER_LOADING, this.onPlayerLoading);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYER_LOAD_COMPLETE, this.onPlayerLoadComplete);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYER_PRELOADING, this.onPlayerPreloading);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYER_PRELOADING_CANCELLED, this.onPlayerPreloadingCancelled);
    this.player.removeEventListener(cast.framework.events.EventType.PLAYING, this.onPlaying);
    this.player.removeEventListener(cast.framework.events.EventType.REQUEST_SEEK, this.onRequestSeek);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKING, this.onSeekStart);
    this.player.removeEventListener(cast.framework.events.EventType.SEEKED, this.onSeekEnd);
    this.player.removeEventListener(cast.framework.events.EventType.ERROR, this.onError);
    this.player.removeEventListener(cast.framework.events.EventType.MEDIA_STATUS, this.onMediaStatus);
    // this.receiverContext.removeEventListener(cast.framework.system.EventType.SHUTDOWN, this.onShutdown);
    this.player.removeEventListener(cast.framework.events.EventType.BITRATE_CHANGED, this.onBitrateChanged);
    this.player.removeEventListener(cast.framework.events.EventType.ENDED, this.onEnded);
    this.player.removeEventListener(cast.framework.events.EventType.PLAY, this.onPlay);
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
    this.sendPlayerReady()
  }

  onRequestLoad (ev) {
    // nrvideo.Log.debug("OnRequestLoad = ", ev)
  }

  onRequestStop (ev) {
    // nrvideo.Log.debug("OnRequestStop = ", ev)
  }

  onRequestPause (ev) {
    // nrvideo.Log.debug("onRequestPause  = ", ev)
  }

  onRequestPlay (ev) {
    this.sendRequest()
  }

  onRequestPlayAgain (ev) {
    // nrvideo.Log.debug("onRequestPlayAgain  = ", ev)
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

  onPause (ev) {
    if (!ev.ended) {
      this.sendPause()
    }
  }

  onPlayerLoading (ev) {
    // nrvideo.Log.debug("onPlayerLoading  = ", ev)
    this.sendRequest()
  }

  onPlayerLoadComplete (ev) {
    // nrvideo.Log.debug("onPlayerLoadComplete  = ", ev)
  }

  onPlayerPreloading (ev) {
    nrvideo.Log.debug("onPlayerPreloading  = ", ev)
  }

  onPlayerPreloadingCancelled (ev) {
    nrvideo.Log.debug("onPlayerPreloadingCancelled  = ", ev)
  }

  onPlaying (ev) {
    if (!this.adsTracker.state.isAdBreak) {
      if (this.state.isPaused) {
        this.sendResume()
      } else {
        this.sendStart()
      }
    }
  }

  onRequestSeek (ev) {
    // nrvideo.Log.debug("onRequestSeek  = ", ev)
  }

  onSeekStart (ev) {
    this.sendSeekStart()
  }

  onSeekEnd (ev) {
    this.sendSeekEnd()
  }

  onShutdown (ev) {
    this.sendEnd()
    this.dispose()
  }

  onError (ev) {
    if (this.state._isAd || ev.detailedErrorCode === cast.framework.events.DetailedErrorCode.BREAK_CLIP_LOADING_ERROR || 
        ev.detailedErrorCode === cast.framework.events.DetailedErrorCode.BREAK_SEEK_INTERCEPTOR_ERROR) {
      this.adsTracker.sendError({errorCode: ev.detailedErrorCode, errorMessage: ev.reason})
      return
    }
    this.sendError({errorCode: ev.detailedErrorCode, errorMessage: ev.reason})
  }

  /** DEBUG Events Listeners */

  onBitrateChanged (ev) {
    this._currentBitrate = ev.totalBitrate
    this.sendRenditionChanged()
  }

  onEnded (ev) {
    // nrvideo.Log.debug("onEnded  = ", ev)
  }

  onPlay (ev) {
    // nrvideo.Log.debug("onPlay  = ", ev)
  }

  onMediaStatus (ev) {
    this.mediaStatus = ev.mediaStatus
  }

  updateRecordCustomEvent() {
    window.newrelic = window.newrelic || {};
    window.newrelic.recordCustomEvent = (eventType, attributes) => { 
      this.nrHarvester.addEventToBuffer(
        eventType,
        attributes
      );
    };
  }
}

// Static members
export {
  CAFAdsTracker
}
