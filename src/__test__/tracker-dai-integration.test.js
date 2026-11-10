import CAFTracker, { CAFAdsTracker } from '../tracker';
import CAFDaiTracker from '../dai';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      // Mirrors the real base (videotracker.ts:74) closely enough for the
      // ad-break guard: the send* methods below move these flags exactly as
      // video-core's go* transitions do (videotrackerstate.ts:721-740), which
      // is what canCloseContentTransition() reads.
      this.state = {
        isAdBreak: false,
        isBuffering: false,
        isPaused: false,
        isSeeking: false,
      };
      this.adsTracker = null;
      this.parentTracker = null;
      this._isAd = false;
      this.registerListeners();
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    // video-core's getAttributes() FILLS AND RETURNS the object it is handed
    // (verified in 5.1.1), and it is where every player getter is called from.
    getAttributes(att) { return att || {}; }
    registerListeners() {}
    unregisterListeners() {}
    sendPlayerReady() {}
    sendRequest() {}
    sendDownload() {}
    sendBufferStart() { this.state.isBuffering = true; }
    sendBufferEnd() { this.state.isBuffering = false; }
    sendResume() { this.state.isPaused = false; }
    sendPause() { this.state.isPaused = true; }
    sendStart() {}
    sendSeekStart() { this.state.isSeeking = true; }
    sendSeekEnd() { this.state.isSeeking = false; }
    sendError() {}
    sendEnd() {}
    sendRenditionChanged() {}
    sendAdBreakStart() { this.state.isAdBreak = true; }
    sendAdBreakEnd() { this.state.isAdBreak = false; }
    sendAdQuartile() {}
    sendAdClick() {}
    setAdsTracker(tracker) {
      this.adsTracker = tracker;
      // videotracker.ts:183-197
      tracker.setIsAd(true);
      tracker.parentTracker = this;
    }
  }
  const nrvideo = {
    VideoTracker,
    Core: { addTracker: jest.fn() },
    Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
  return { ...nrvideo, default: nrvideo };
});

beforeEach(() => {
  global.cast = {
    framework: {
      events: {
        EventType: {
          REQUEST_FOCUS_STATE: 'requestFocusState',
          PLAYER_LOADING: 'playerLoading',
          LOADED_METADATA: 'loadedMetadata',
          REQUEST_PLAY: 'requestPlay',
          PLAYING: 'playing',
          PLAY: 'play',
          PAUSE: 'pause',
          BUFFERING: 'buffering',
          BITRATE_CHANGED: 'bitrateChanged',
          SEEKING: 'seeking',
          SEEKED: 'seeked',
          ERROR: 'error',
          MEDIA_STATUS: 'mediaStatus',
          MEDIA_FINISHED: 'mediaFinished',
          BREAK_STARTED: 'breakStarted',
          BREAK_ENDED: 'breakEnded',
          BREAK_CLIP_LOADING: 'breakClipLoading',
          BREAK_CLIP_STARTED: 'breakClipStarted',
          BREAK_CLIP_ENDED: 'breakClipEnded',
          TIME_UPDATE: 'timeUpdate',
        },
        DetailedErrorCode: {
          BREAK_CLIP_LOADING_ERROR: 'breakClipLoadingError',
          BREAK_SEEK_INTERCEPTOR_ERROR: 'breakSeekInterceptorError',
        },
      },
    },
    player: { api: { VERSION: 'test' } },
  };
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

function createMockPlayerManager(currentTime = 42) {
  let time = currentTime;
  return {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getCurrentTimeSec: jest.fn(() => time),
    getDurationSec: jest.fn(() => 600),
    getStats: jest.fn(() => ({ streamBandwidth: 512000, width: 1280, height: 720 })),
    // cast.framework.PlayerManager.getPlayerState() answers the literal 'IDLE'
    // whenever it has no player, and getLiveSeekableRange() is non-null only
    // for a stream the active media player determined is live from the
    // manifest. Both verified against the v3 receiver bundle.
    getPlayerState: jest.fn(() => 'PLAYING'),
    getLiveSeekableRange: jest.fn(() => null),
    _setTime(t) { time = t; },
  };
}

const StreamEventType = {
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click', VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged',
};

// removeEventListener matches on the HANDLER REFERENCE, as the real
// StreamManager does. Ignoring the second argument made a tracker that removed
// functions other than the ones it registered look clean.
function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type, cb) => {
      if (listeners[type] === cb) delete listeners[type];
    }),
    contentTimeForStreamTime: jest.fn((streamTime) => streamTime),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
    _listenerCount() { return Object.keys(listeners).length; },
  };
}

/**
 * A receiver with nothing loaded — the state a failed DAI stream request leaves
 * it in, and precisely when onStreamError collects content attributes.
 *
 * createMockPlayerManager() never throws, which is what hid the unguarded
 * getters. Every call here throws instead, and getSenders() returns a list
 * whose entry does not resolve to a Sender: the real
 * CastReceiverContext.getSenders() maps sender ids through an accessor that
 * returns null for an id it cannot resolve (verified in the v3 receiver
 * bundle), so `getSenders()[0].userAgent` is a reachable TypeError.
 */
function createIdleReceiverContext() {
  const explode = () => { throw new Error('no media loaded') };
  const playerManager = {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getCurrentTimeSec: jest.fn(explode),
    getDurationSec: jest.fn(explode),
    getPlaybackRate: jest.fn(explode),
    getPreferredTextLanguage: jest.fn(explode),
    getMediaInformation: jest.fn(explode),
    getStats: jest.fn(explode),
    getPlayerState: jest.fn(explode),
    getLiveSeekableRange: jest.fn(explode),
  };
  return {
    playerManager,
    receiverContext: {
      getPlayerManager: () => playerManager,
      getSenders: () => [undefined],
    },
  };
}

function createMockReceiverContext(playerManager) {
  return { getPlayerManager: () => playerManager, getSenders: () => [] };
}

/**
 * The send* methods MOVE state, as video-core's VideoTracker does
 * (goBufferStart sets isBuffering, goSeekStart sets isSeeking, and so on). A
 * fake whose state never moves cannot exercise close-routing at all: every
 * close looks like "nothing was open", which is precisely the condition
 * closingTracker() has to tell apart.
 */
function makeFakeAdsTracker(isAdBreak) {
  const state = { isAdBreak, isBuffering: false, isSeeking: false, isPaused: false };
  const moves = (flag, value) => jest.fn(() => { state[flag] = value; });
  return {
    state,
    sendPause: moves('isPaused', true),
    sendResume: moves('isPaused', false),
    sendBufferStart: moves('isBuffering', true),
    sendBufferEnd: moves('isBuffering', false),
    sendSeekStart: moves('isSeeking', true),
    sendSeekEnd: moves('isSeeking', false),
    onBitrateChanged: jest.fn(),
    sendError: jest.fn(),
  };
}

describe('CAFTracker ad-break guards work unmodified for a CAFDaiTracker-shaped adsTracker', () => {
  it('constructing CAFTracker auto-creates a real CAFAdsTracker as adsTracker', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    expect(tracker.adsTracker).toBeInstanceOf(CAFAdsTracker);
  });

  it('onPause() routes to adsTracker.sendPause() when an ad break is active, and to content sendPause() once it ends', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const fakeDai = makeFakeAdsTracker(true);
    tracker.adsTracker = fakeDai;
    jest.spyOn(tracker, 'sendPause');

    tracker.onPause({ ended: false });
    expect(fakeDai.sendPause).toHaveBeenCalledTimes(1);
    expect(tracker.sendPause).not.toHaveBeenCalled();

    fakeDai.state.isAdBreak = false; // simulates AD_BREAK_ENDED having fired on the real tracker
    tracker.onPause({ ended: false });
    expect(tracker.sendPause).toHaveBeenCalledTimes(1);
    expect(fakeDai.sendPause).toHaveBeenCalledTimes(1); // unchanged — still only the first call
  });

  it('onBuffering() routes to adsTracker.sendBufferStart()/sendBufferEnd() during an ad break', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const fakeDai = makeFakeAdsTracker(true);
    tracker.adsTracker = fakeDai;

    tracker.onBuffering({ isBuffering: true });
    expect(fakeDai.sendBufferStart).toHaveBeenCalledTimes(1);

    tracker.onBuffering({ isBuffering: false });
    expect(fakeDai.sendBufferEnd).toHaveBeenCalledTimes(1);
  });

  it('onBitrateChanged() calls adsTracker.onBitrateChanged(ev) during an ad break without throwing', () => {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const fakeDai = makeFakeAdsTracker(true);
    tracker.adsTracker = fakeDai;

    expect(() => tracker.onBitrateChanged({ totalBitrate: 999 })).not.toThrow();
    expect(fakeDai.onBitrateChanged).toHaveBeenCalledWith({ totalBitrate: 999 });
  });
});

/**
 * contentIsLive comes from the CONTENT tracker's isLive() — verified in
 * video-core 5.1.1, `e.contentIsLive = this.isLive()` — and the base class
 * answers null, so CAFTracker published null on every event. video-core reads
 * neither getStreamType() nor isLiveStream() anywhere (zero occurrences), so
 * this getter is the only live signal that reaches NRDB.
 *
 * The signal is PlayerManager.getLiveSeekableRange(), not the sender-declared
 * MediaInformation.streamType. Verified against the v3 receiver bundle:
 * getLiveSeekableRange() delegates to the active media player, which returns
 * null unless the manifest says the stream is live, while streamType is
 * whatever the sender put in the LOAD request — and when the sender omits it
 * the receiver fills it in from a DURATION test
 * (`duration === -1 || duration === Infinity ? 'LIVE' : 'BUFFERED'`, logged as
 * "Media streamType is initially set wrong"). A DAI live stream is stitched
 * into a finite DVR window, so that test reports it BUFFERED.
 */
describe('CAFTracker — liveness', () => {
  function withPlayer(overrides) {
    const pm = { ...createMockPlayerManager(), ...overrides };
    return new CAFTracker(createMockReceiverContext(pm), { info: {} });
  }

  it('reports live from a non-null live seekable range', () => {
    const tracker = withPlayer({ getLiveSeekableRange: () => ({ start: 0, end: 60 }) });
    expect(tracker.isLive()).toBe(true);
  });

  it('reports not live when the receiver has no live seekable range', () => {
    expect(withPlayer({ getLiveSeekableRange: () => null }).isLive()).toBe(false);
  });

  // The range is null for live and VOD alike until something is loaded, so
  // false would be a guess. 'IDLE' is exactly the no-player state.
  it('reports unknown while the receiver is idle', () => {
    expect(withPlayer({ getPlayerState: () => 'IDLE' }).isLive()).toBeNull();
  });

  /**
   * Measured on the emulator: a live DAI view stored
   * `contentIsLive: false` on CONTENT_REQUEST and `true` on every later event.
   * CONTENT_REQUEST fires while the player is still BUFFERING, before the DVR
   * window exists, and a null range there is indistinguishable from VOD's
   * permanently-null range. Mislabelling a live view as VOD corrupts
   * live-vs-VOD segmentation, so answer unknown instead of guessing.
   */
  it('reports unknown while buffering with no range yet, rather than guessing VOD', () => {
    const tracker = withPlayer({
      getPlayerState: () => 'BUFFERING',
      getLiveSeekableRange: () => null,
    });
    expect(tracker.isLive()).toBeNull();
  });

  it('still reports live while buffering once the range exists', () => {
    const tracker = withPlayer({
      getPlayerState: () => 'BUFFERING',
      getLiveSeekableRange: () => ({ start: 10, end: 45 }),
    });
    expect(tracker.isLive()).toBe(true);
  });

  it('reports not live once the player is presenting with no range', () => {
    // By PLAYING/PAUSED a live stream has its DVR window, so a null range here
    // really does mean VOD.
    expect(withPlayer({ getPlayerState: () => 'PLAYING', getLiveSeekableRange: () => null }).isLive()).toBe(false);
    expect(withPlayer({ getPlayerState: () => 'PAUSED', getLiveSeekableRange: () => null }).isLive()).toBe(false);
  });

  it('reports unknown rather than throwing when the getters are unavailable', () => {
    const tracker = withPlayer({
      getPlayerState: undefined,
      getLiveSeekableRange: undefined,
    });
    expect(tracker.isLive()).toBeNull();
  });

  it('ignores the sender-declared stream type', () => {
    const tracker = withPlayer({
      getLiveSeekableRange: () => ({ start: 0, end: 60 }),
      getMediaInformation: () => ({ streamType: 'BUFFERED' }),
    });
    expect(tracker.isLive()).toBe(true);
  });
});

// The ads-activity predicates, pinned directly. isAdsTrackerActive() has to
// serve two very different ads trackers: CAFDaiTracker, which knows it is
// inside a pre-roll before the SDK announces the break, and the auto-created
// CSAI CAFAdsTracker, which exposes neither isAdPlaying() nor
// getCurrentAdBreak() and only ever moves video-core's isAdBreak flag.
describe('CAFTracker — ads-activity predicates', () => {
  function contentTracker() {
    return new CAFTracker(createMockReceiverContext(createMockPlayerManager()), { info: {} });
  }

  it('prefers isAdPlaying() over the ad-break flag', () => {
    const tracker = contentTracker();
    tracker.adsTracker = {
      state: { isAdBreak: false },
      isAdPlaying: () => true,
      getCurrentAdBreak: () => null,
    };
    expect(tracker.isAdsTrackerActive()).toBe(true);
  });

  it('falls back to getCurrentAdBreak() when there is no isAdPlaying()', () => {
    const tracker = contentTracker();
    tracker.adsTracker = { state: { isAdBreak: false }, getCurrentAdBreak: () => ({}) };
    expect(tracker.isAdsTrackerActive()).toBe(true);

    tracker.adsTracker = { state: { isAdBreak: false }, getCurrentAdBreak: () => null };
    expect(tracker.isAdsTrackerActive()).toBe(false);
  });

  // The CSAI path. A CAFAdsTracker has neither accessor, so removing this arm
  // would turn every CSAI break into "no ad playing" and route the whole break
  // to content.
  it("falls back to the CSAI tracker's isAdBreak flag", () => {
    const tracker = contentTracker();
    expect(tracker.adsTracker).toBeInstanceOf(CAFAdsTracker);
    expect(tracker.adsTracker.isAdPlaying).toBeUndefined();
    expect(tracker.adsTracker.getCurrentAdBreak).toBeUndefined();

    expect(tracker.isAdsTrackerActive()).toBe(false);
    tracker.adsTracker.state.isAdBreak = true;
    expect(tracker.isAdsTrackerActive()).toBe(true);
  });

  it('is false when there is no ads tracker at all', () => {
    const tracker = contentTracker();
    tracker.adsTracker = null;
    expect(tracker.isAdsTrackerActive()).toBe(false);
  });

  // video-core bills (stopTime - startTime) to totalRebufferingTime and pairs
  // goSeekEnd with isSeeking, so holding a content transition open across a
  // break charges the whole pod to content.
  it('allows closing a content transition that is already open mid-break', () => {
    const tracker = contentTracker();
    tracker.adsTracker = {
      state: { isAdBreak: true, isBuffering: true },
      isAdPlaying: () => true,
    };

    // Only the ad holds it open, so the close belongs to the ad.
    expect(tracker.closingTracker('isBuffering')).toBe(tracker.adsTracker);

    // Content holds one too — content wins, so the pod is not billed to it.
    tracker.state.isBuffering = true;
    expect(tracker.closingTracker('isBuffering')).toBe(tracker);
  });

  /**
   * Measured on the emulator: DAI seeks past the ad at break end, so SEEKING
   * opens on the ads tracker while isAdPlaying() is true, and SEEKED arrives
   * AFTER the break has ended. Routing that close by "is a break active?"
   * sends it to content, where video-core drops it (nothing open there) and
   * the ad-side seek is never closed for the rest of the view.
   */
  it('closes an ad-side transition on the ads tracker after the break has ended', () => {
    const tracker = contentTracker();
    tracker.adsTracker = {
      state: { isAdBreak: false, isSeeking: true },
      isAdPlaying: () => false,          // the break is over
    };

    expect(tracker.isAdsTrackerActive()).toBe(false);
    expect(tracker.closingTracker('isSeeking')).toBe(tracker.adsTracker);
  });

  it('routes a close to content when neither side holds the transition open', () => {
    const tracker = contentTracker();
    tracker.adsTracker = { state: { isAdBreak: false }, isAdPlaying: () => false };

    expect(tracker.closingTracker('isSeeking')).toBe(tracker);
  });

  it('prefers content when both sides hold the same transition open', () => {
    // A stall that began before the break belongs to content: video-core bills
    // (stopTime - startTime), so closing the ad's copy first would leave the
    // content stall open and charge the whole pod to content rebuffering.
    const tracker = contentTracker();
    tracker.state.isBuffering = true;
    tracker.adsTracker = {
      state: { isAdBreak: true, isBuffering: true },
      isAdPlaying: () => true,
    };

    expect(tracker.closingTracker('isBuffering')).toBe(tracker);
  });
});

// The tests above pin tracker.js's guard logic using a stand-in. These drive
// the real CAFDaiTracker off real DAI StreamEvents, so the integration is
// proven end to end rather than against a fixture that happens to have the
// right shape.
describe('a real CAFDaiTracker attached to a real CAFTracker', () => {
  function wireUp(currentTime = 42) {
    const pm = createMockPlayerManager(currentTime);
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const sm = createMockStreamManager();
    const dai = new CAFDaiTracker(sm, { playerManager: pm, contentTracker: tracker });
    tracker.setAdsTracker(dai);
    return { tracker, dai, sm, pm };
  }

  it('routes playback events to the DAI tracker for the duration of a break', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendPause');
    jest.spyOn(dai, 'sendPause');
    jest.spyOn(tracker, 'sendBufferStart');
    jest.spyOn(dai, 'sendBufferStart');

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    tracker.onPause({ ended: false });
    tracker.onBuffering({ isBuffering: true });
    expect(dai.sendPause).toHaveBeenCalledTimes(1);
    expect(dai.sendBufferStart).toHaveBeenCalledTimes(1);
    expect(tracker.sendPause).not.toHaveBeenCalled();
    expect(tracker.sendBufferStart).not.toHaveBeenCalled();

    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    tracker.onPause({ ended: false });
    tracker.onBuffering({ isBuffering: true });
    expect(tracker.sendPause).toHaveBeenCalledTimes(1);
    expect(tracker.sendBufferStart).toHaveBeenCalledTimes(1);
    expect(dai.sendPause).toHaveBeenCalledTimes(1);
  });

  it('routes bitrate changes to the DAI tracker during a break', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendRenditionChanged');
    jest.spyOn(dai, 'sendRenditionChanged');

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    tracker.onBitrateChanged({ totalBitrate: 999 });
    expect(dai.sendRenditionChanged).toHaveBeenCalledTimes(1);
    expect(dai.getRenditionBitrate()).toBe(999);
    expect(tracker.sendRenditionChanged).not.toHaveBeenCalled();
  });

  // A bumper fires only period events. Before AD_PERIOD_ENDED closed the break
  // it had opened, isAdBreak stayed true and every content event after the
  // bumper was routed to the ads tracker for the rest of the session.
  it('resumes content telemetry after a bumper that only fires period events', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendPause');

    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    expect(tracker.adsTracker.state.isAdBreak).toBe(true);

    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.adsTracker.state.isAdBreak).toBe(false);

    tracker.onPause({ ended: false });
    expect(tracker.sendPause).toHaveBeenCalledTimes(1);
    expect(dai.getCurrentAdBreak()).toBeNull();
  });

  // The IMA SDK emits AD_BREAK_STARTED only AFTER the playhead is already
  // inside the ad, so a guard on video-core's isAdBreak flag lets CAF's PLAYING
  // report CONTENT_START on the pre-roll's first frame. goStart() is
  // once-per-view, so content startup time is then permanently measured to the
  // ad, and ad buffering in that window bills to content rebuffering.
  function withPreRollCuePoint(sm) {
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: [{ start: 0, end: 10.01, played: false }] }),
    });
  }

  it('does not report CONTENT_START inside a pre-roll the SDK has not announced yet', () => {
    const { tracker, sm, pm } = wireUp(0);
    withPreRollCuePoint(sm);
    jest.spyOn(tracker, 'sendStart');

    // The break object is still null: this is the window the isAdBreak flag
    // cannot see.
    expect(tracker.adsTracker.state.isAdBreak).toBe(false);
    tracker.onPlaying({});
    expect(tracker.sendStart).not.toHaveBeenCalled();

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    pm._setTime(20);
    tracker.onPlaying({});
    expect(tracker.sendStart).toHaveBeenCalledTimes(1);
  });

  it('routes buffering inside an unannounced pre-roll to the ad tracker', () => {
    const { tracker, dai, sm } = wireUp(0);
    withPreRollCuePoint(sm);
    jest.spyOn(tracker, 'sendBufferStart');
    jest.spyOn(dai, 'sendBufferStart');

    tracker.onBuffering({ isBuffering: true });
    expect(dai.sendBufferStart).toHaveBeenCalledTimes(1);
    expect(tracker.sendBufferStart).not.toHaveBeenCalled();
  });

  it('suppresses the content download event inside an unannounced pre-roll', () => {
    const { tracker, sm } = wireUp(0);
    withPreRollCuePoint(sm);
    jest.spyOn(tracker, 'sendDownload');

    tracker.onLoadedMetadata({});
    expect(tracker.sendDownload).not.toHaveBeenCalled();
  });

  // The open/close asymmetry. Opening a content transition during a break is
  // suppressed; closing one that is ALREADY OPEN is not, or video-core bills
  // the whole pod to content rebuffering.
  it('closes a content buffer that was already open when the break started', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendBufferEnd');
    jest.spyOn(dai, 'sendBufferEnd');

    tracker.onBuffering({ isBuffering: true });
    expect(tracker.state.isBuffering).toBe(true);

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    tracker.onBuffering({ isBuffering: false });

    expect(tracker.sendBufferEnd).toHaveBeenCalledTimes(1);
    expect(dai.sendBufferEnd).not.toHaveBeenCalled();
  });

  it('closes a content seek that was already open when the break started', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendSeekEnd');
    jest.spyOn(dai, 'sendSeekEnd');

    tracker.onSeekStart({});
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    tracker.onSeekEnd({});

    expect(tracker.sendSeekEnd).toHaveBeenCalledTimes(1);
    expect(dai.sendSeekEnd).not.toHaveBeenCalled();
  });

  it('closes a content pause that was already open when the break started', () => {
    const { tracker, dai, sm } = wireUp();
    jest.spyOn(tracker, 'sendResume');
    jest.spyOn(dai, 'sendResume');

    tracker.onPause({ ended: false });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    tracker.onPlay({});

    expect(tracker.sendResume).toHaveBeenCalledTimes(1);
    expect(dai.sendResume).not.toHaveBeenCalled();
  });

  // A 10-minute VOD with 4 minutes of stitched ads reported contentDuration as
  // 14 minutes and overstated the playhead by up to 4 minutes, so percent
  // viewed and completion were wrong on every session.
  it('reports content playhead and duration without the stitched ad time', () => {
    const { tracker, sm } = wireUp(100);
    // 40s of ads played so far; getDurationSec() is the 600s stitched total.
    sm.contentTimeForStreamTime = jest.fn((streamTime) => streamTime - 40);

    expect(tracker.getPlayhead()).toBe(60000);
    expect(tracker.getDuration()).toBe(560000);
  });

  it('keeps reporting stream time when the SDK cannot convert', () => {
    const { tracker, sm } = wireUp(100);
    sm.contentTimeForStreamTime = jest.fn(() => undefined);

    expect(tracker.getPlayhead()).toBe(100000);
    expect(tracker.getDuration()).toBe(600000);
  });

  // The CSAI CAFAdsTracker has no conversion, and CAF's own clock is already
  // content time there — the ads are a separate break stream.
  it('keeps reporting stream time for an ads tracker with no conversion', () => {
    const pm = createMockPlayerManager(100);
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });

    expect(tracker.adsTracker.contentTimeForStreamTime).toBeUndefined();
    expect(tracker.getPlayhead()).toBe(100000);
    expect(tracker.getDuration()).toBe(600000);
  });

  // The real PlayerManager returns NaN from getDurationSec() when it has no
  // player (verified in the v3 receiver bundle), and NaN * 1000 is NaN — which
  // used to be published as contentDuration.
  it('reports null rather than NaN for a duration the receiver does not know', () => {
    const pm = createMockPlayerManager();
    pm.getDurationSec = jest.fn(() => NaN);
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });

    expect(tracker.getDuration()).toBeNull();
  });

  // A DAI stream ERROR is reported on the CONTENT tracker, and a failed stream
  // request is exactly when the receiver has nothing loaded. The attribute
  // collection that follows runs inside the IMA SDK's event dispatch, so a
  // throwing receiver getter aborts the stream request and nothing plays.
  it('survives a DAI stream error raised while the receiver is idle', () => {
    const { receiverContext } = createIdleReceiverContext();
    const tracker = new CAFTracker(receiverContext, { info: {} });
    const sm = createMockStreamManager();
    const dai = new CAFDaiTracker(sm, {
      playerManager: receiverContext.getPlayerManager(),
      contentTracker: tracker,
    });
    tracker.setAdsTracker(dai);
    jest.spyOn(tracker, 'sendError');

    expect(() =>
      sm._emit(StreamEventType.ERROR, {
        getStreamData: () => ({ errorMessage: 'Stream initialization failed' }),
      })
    ).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledTimes(1);
  });

  it('collects content attributes from an idle receiver without throwing', () => {
    const { receiverContext } = createIdleReceiverContext();
    const tracker = new CAFTracker(receiverContext, { info: {} });

    expect(() => tracker.getAttributes({})).not.toThrow();
    expect(tracker.getAttributes({}).senderUserAgent).toBeUndefined();
    expect(tracker.getPlayhead()).toBe(0);
    expect(tracker.getDuration()).toBeNull();
    expect(tracker.getPlayrate()).toBeNull();
    expect(tracker.getLanguage()).toBeNull();
  });

  it('reports every ad in a two-break session, not just the first', () => {
    const { dai, sm } = wireUp();
    const starts = jest.spyOn(dai, 'sendStart');
    const requests = jest.spyOn(dai, 'sendRequest');
    const ad = (adId) => ({
      getAd: () => ({
        getAdId: () => adId,
        getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 1 }),
      }),
    });

    for (const adId of ['ad1', 'ad2']) {
      sm._emit(StreamEventType.AD_BREAK_STARTED, {});
      sm._emit(StreamEventType.STARTED, ad(adId));
      sm._emit(StreamEventType.COMPLETE, {});
      sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    }

    expect(requests).toHaveBeenCalledTimes(2);
    expect(starts).toHaveBeenCalledTimes(2);
  });
});
