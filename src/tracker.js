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
    const ET = cast.framework.events.EventType;

    // Handler references are stored for the same reason as in ads.js and
    // dai.js: removeEventListener matches on IDENTITY, and registering arrow
    // wrappers while unregistering bare methods removed nothing, so a disposed
    // tracker kept receiving CAF events.
    this.eventHandlers = {
      [ET.REQUEST_FOCUS_STATE]: (event) => this.onRequestFocusState(event),
      [ET.PLAYER_LOADING]: (event) => this.onPlayerLoading(event),
      [ET.LOADED_METADATA]: (event) => this.onLoadedMetadata(event),
      [ET.REQUEST_PLAY]: (event) => this.onRequestPlay(event),
      [ET.PLAYING]: (event) => this.onPlaying(event),
      [ET.PLAY]: (event) => this.onPlay(event),
      [ET.PAUSE]: (event) => this.onPause(event),
      [ET.BUFFERING]: (event) => this.onBuffering(event),
      [ET.BITRATE_CHANGED]: (event) => this.onBitrateChanged(event),
      [ET.SEEKING]: (event) => this.onSeekStart(event),
      [ET.SEEKED]: (event) => this.onSeekEnd(event),
      [ET.ERROR]: (event) => this.onError(event),
      [ET.MEDIA_STATUS]: (event) => this.onMediaStatus(event),
      [ET.MEDIA_FINISHED]: (event) => this.onMediaFinished(event),
    };

    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.player.addEventListener(type, handler)
    );

    if (!this.adsTracker) {
      this.setAdsTracker(new CAFAdsTracker(this.player))
    }
  }

  unregisterListeners() {
    if (!this.player || !this.eventHandlers) return;

    Object.entries(this.eventHandlers).forEach(([type, handler]) =>
      this.player.removeEventListener(type, handler)
    );
    this.eventHandlers = null;
  }

  reset () {
    this._currentBitrate = 0
  }

  /**
   * True while an ad is actually on screen, so content QoE events can stand
   * down.
   *
   * NOT `adsTracker.state.isAdBreak`. That flag only flips at AD_BREAK_STARTED,
   * which the IMA DAI SDK emits AFTER the playhead is already inside the ad, so
   * CAF's PLAYING fired CONTENT_START on a pre-roll's first frame — and because
   * video-core's goStart() is once-per-view, content startup time was then
   * permanently measured to the ad.
   *
   * The arms are ordered by how much each ads tracker knows:
   *  - isAdPlaying(), CAFDaiTracker's own answer, which covers the pre-roll
   *    window before the break is announced. A disposed CAFDaiTracker answers
   *    false rather than throwing — video-core's disposeAdsTracker() nulls its
   *    player and tag but leaves this reference in place.
   *  - getCurrentAdBreak(), for an ads tracker that tracks a break but cannot
   *    see ahead of it.
   *  - video-core's isAdBreak flag, which is all the auto-created CSAI
   *    CAFAdsTracker ever moves — it has neither accessor above, so this arm is
   *    the whole CSAI path.
   */
  isAdsTrackerActive () {
    if (!this.adsTracker) return false

    if (typeof this.adsTracker.isAdPlaying === 'function') {
      return this.adsTracker.isAdPlaying()
    }
    if (typeof this.adsTracker.getCurrentAdBreak === 'function') {
      return this.adsTracker.getCurrentAdBreak() != null
    }
    return !!this.adsTracker.state?.isAdBreak
  }

  /**
   * The tracker that should receive the CLOSE of transition `flag`
   * (`isBuffering`, `isSeeking`, `isPaused`).
   *
   * Closes are routed by WHO HOLDS THE TRANSITION OPEN, not by whether a break
   * is currently active — those are different questions, and conflating them
   * leaks transitions. Opening is still gated on the break (see onSeekStart,
   * onBuffering): that asymmetry is deliberate.
   *
   * Order matters:
   *  - Content first. A stall that began before the break belongs to content,
   *    and video-core bills (stopTime - startTime) to totalRebufferingTime, so
   *    holding it open across a pod charges the whole pod to content
   *    rebuffering. A stall just before an ad boundary is a common SSAI case.
   *  - Then the ads tracker, EVEN IF THE BREAK HAS ALREADY ENDED. Measured on
   *    the emulator: DAI seeks past the ad at break end, so SEEKING opens on
   *    the ads tracker while isAdPlaying() is true and SEEKED lands after it
   *    has gone false. Sending that close to content is silently dropped by
   *    video-core — nothing is open there — and the ad-side seek then stays
   *    open for the rest of the view.
   *  - Otherwise content, where video-core gates a close with nothing open.
   */
  closingTracker (flag) {
    if (this.state?.[flag]) return this
    if (this.adsTracker?.state?.[flag]) return this.adsTracker
    return this
  }

  /**
   * Reads a value from a third-party receiver API, tolerating a receiver with
   * nothing loaded.
   *
   * Under DAI that state is routine rather than exceptional: a failed stream
   * request leaves the receiver IDLE, and that is exactly when CAFDaiTracker
   * reports the error on THIS tracker and video-core collects content
   * attributes from it.
   *
   * It matters far more than a missing attribute. CAFDaiTracker's handlers run
   * inside the IMA DAI SDK's own event dispatch, so an exception escaping
   * attribute collection reaches the SDK, which aborts the stream request and
   * emits an empty ERROR — observed on the sibling DASH integration, where
   * nothing played at all. A telemetry library must not take the stream down
   * with it.
   */
  readFromPlayer (read, fallback = null) {
    try {
      const value = read()
      return value === undefined ? fallback : value
    }
    catch (e) {
      // Routine before media is loaded, so not worth logging on every event;
      // the absent attribute is the signal.
      return fallback
    }
  }

  getAttributes (att) {
    att = super.getAttributes(att)

    // getSenders() maps sender ids through an accessor that answers null for
    // one it cannot resolve (verified in the v3 receiver bundle), so a
    // non-empty list can still hold no Sender and `[0].userAgent` is a
    // reachable TypeError.
    const userAgent = this.readFromPlayer(
      () => this.receiverContext.getSenders()[0].userAgent
    )
    if (userAgent != null) att.senderUserAgent = userAgent

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
    const time = this.readFromPlayer(() => this.player.getCurrentTimeSec(), 0)
    if (typeof time !== 'number' || !Number.isFinite(time)) return 0
    return this.toContentTime(time) * 1000
  }

  /**
   * Stream time to content time, both in SECONDS.
   *
   * Under SSAI the stitched stream's clock includes every ad played so far, so
   * reporting it directly overstates content progress by the cumulative ad
   * duration — a 10-minute VOD with 4 minutes of ads reported a 14-minute
   * contentDuration and a playhead up to 4 minutes ahead of the content. An ads
   * tracker that can convert is asked to; anything else — no ads, or the CSAI
   * CAFAdsTracker, where CAF's clock is already content time — reports the
   * clock as-is.
   *
   * There is deliberately no isLive() skip: the SDK's conversion is an identity
   * on live, which is indistinguishable from not converting at all, so a skip
   * would add a branch for no measured gain and diverge from the siblings.
   */
  toContentTime (streamTime) {
    // CAFDaiTracker contains its own SDK call, but this reaches an ads tracker
    // we do not own, from inside attribute collection — which itself runs
    // inside CAF's event dispatch. A throwing third-party converter must not
    // become a throwing content getter.
    let converted
    try {
      converted = this.adsTracker?.contentTimeForStreamTime?.(streamTime)
    } catch (e) {
      return streamTime
    }
    return typeof converted === 'number' && Number.isFinite(converted)
      ? converted
      : streamTime
  }

  getDuration () {
    // Same stream-vs-content distinction as getPlayhead: a stitched VOD's
    // duration includes every inserted ad.
    const duration = this.readFromPlayer(() => this.player.getDurationSec())
    if (typeof duration !== 'number' || !Number.isFinite(duration)) return null
    return this.toContentTime(duration) * 1000
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

  /**
   * true, false, or null when the receiver cannot say yet — published as
   * contentIsLive.
   *
   * This override is the ONLY live signal that reaches NRDB: video-core takes
   * contentIsLive from the content tracker's isLive() (verified in 5.1.1,
   * `e.contentIsLive = this.isLive()`) and reads neither getStreamType() nor
   * isLiveStream() anywhere. Without it the base class answered null on every
   * event.
   *
   * The signal is PlayerManager.getLiveSeekableRange(), NOT the
   * MediaInformation.streamType the DAI ads tracker used to read. Verified
   * against the v3 receiver bundle: the range delegates to the active media
   * player, which returns null unless the MANIFEST says the stream is live,
   * whereas streamType is whatever the sender put in the LOAD request — and
   * when the sender omits it the receiver fills it in from a duration test
   * (`duration === -1 || duration === Infinity ? 'LIVE' : 'BUFFERED'`, logged
   * as "Media streamType is initially set wrong"). A DAI live stream is
   * stitched into a finite, growing DVR window, so that test calls every live
   * DAI stream BUFFERED.
   */
  isLive () {
    // The range is null for live and VOD alike until something is loaded, so
    // 'not live' there would be a guess. getPlayerState() answers the literal
    // 'IDLE' exactly when the PlayerManager has no player.
    const state = this.readFromPlayer(() => this.player.getPlayerState())
    if (state == null || state === 'IDLE') return null

    // undefined is the "could not read" fallback here, distinct from the null
    // the receiver itself reports for a non-live stream.
    const range = this.readFromPlayer(
      () => this.player.getLiveSeekableRange(), undefined
    )
    if (range === undefined) return null
    if (range !== null) return true

    // A null range means "not live" for VOD but only "not known yet" during
    // live startup, and the two are indistinguishable until the media player
    // has actually begun presenting. Measured: a live DAI view stored
    // contentIsLive:false on CONTENT_REQUEST — which fires while BUFFERING,
    // before the DVR window exists — and true on every event after it.
    // This is a TRADE, not a strict win. It buys "live views are no longer
    // mislabelled VOD on their first event" and it costs "a VOD startup
    // failure reported while buffering now lands in neither bucket" —
    // contentIsLive is in QOE_AGGREGATE_KEYS and copied by `key in obj`, so
    // the null propagates to the QoE aggregate too. Taken because a wrong
    // bucket corrupts segmentation for everyone reading it, while an absent
    // one only withholds; reverse it if VOD error attribution matters more.
    if (state === 'BUFFERING') return null
    return false
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
    return this.readFromPlayer(() => this.player.getPlaybackRate())
  }

  getLanguage () {
    return this.readFromPlayer(() => this.player.getPreferredTextLanguage())
  }

  /** CORE Events Listeners */

  onRequestFocusState (ev) {
    this.sendPlayerReady()
  }

  onRequestPlay (ev) {
    this.sendRequest()
  }

  onLoadedMetadata (ev) {
    if (!this.isAdsTrackerActive()) {
      this.sendDownload()
    }
  }

  onBuffering (ev) {
    if (ev.isBuffering) {
      if (this.isAdsTrackerActive()) {
        this.adsTracker.sendBufferStart();
      } else {
        this.sendBufferStart()
      }
    }
    else {
      // Closes go to whichever tracker holds the buffer open — see
      // closingTracker(). Routing by "is a break active?" dropped the close.
      this.closingTracker('isBuffering').sendBufferEnd()
    }
  }

  onMediaFinished (ev) {
    this.sendEnd()
  }

  onPlay (ev) {
    // The resume pairs with whichever tracker holds the pause open.
    this.closingTracker('isPaused').sendResume()
  }

  onPause (ev) {
    if (!ev.ended) {
      if (!this.isAdsTrackerActive()) {
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
    if (!this.isAdsTrackerActive()) {
      this.sendStart()
    }
  }

  onSeekStart (ev) {
    if (!this.isAdsTrackerActive()) {
      this.sendSeekStart()
    } else {
      this.adsTracker.sendSeekStart()
    }
  }

  onSeekEnd (ev) {
    // DAI seeks past the ad at break end, so this routinely arrives after the
    // break has ended while the ad-side seek is still open.
    this.closingTracker('isSeeking').sendSeekEnd()
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
    if (!this.isAdsTrackerActive()) {
      this.sendRenditionChanged()
    } else if (typeof this.adsTracker.onBitrateChanged === 'function') {
      // onBitrateChanged is OURS, not part of video-core's ads-tracker
      // contract, while isAdsTrackerActive() and closingTracker() above both
      // duck-type foreign ads trackers. A third-party tracker that satisfies
      // those arms without this method used to throw a TypeError straight into
      // CAF's BITRATE_CHANGED dispatch.
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
