import CAFTracker, { CAFAdsTracker } from '../tracker';
import CAFDaiTracker from '../dai';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      // Mirrors the real base (videotracker.ts:74) closely enough for the
      // ad-break guard: sendAdBreakStart/End below move isAdBreak exactly as
      // goAdBreakStart()/goAdBreakEnd() do (videotrackerstate.ts:721-740).
      this.state = { isAdBreak: false };
      this.adsTracker = null;
      this.parentTracker = null;
      this._isAd = false;
      this.registerListeners();
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    registerListeners() {}
    unregisterListeners() {}
    sendPlayerReady() {}
    sendRequest() {}
    sendDownload() {}
    sendBufferStart() {}
    sendBufferEnd() {}
    sendResume() {}
    sendPause() {}
    sendStart() {}
    sendSeekStart() {}
    sendSeekEnd() {}
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

function createMockPlayerManager() {
  return {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getCurrentTimeSec: jest.fn(() => 42),
    getDurationSec: jest.fn(() => 600),
    getStats: jest.fn(() => ({ streamBandwidth: 512000, width: 1280, height: 720 })),
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

function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockReceiverContext(playerManager) {
  return { getPlayerManager: () => playerManager, getSenders: () => [] };
}

function makeFakeAdsTracker(isAdBreak) {
  return {
    state: { isAdBreak },
    sendPause: jest.fn(),
    sendBufferStart: jest.fn(),
    sendBufferEnd: jest.fn(),
    sendResume: jest.fn(),
    sendSeekStart: jest.fn(),
    sendSeekEnd: jest.fn(),
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

// The tests above pin tracker.js's guard logic using a stand-in. These drive
// the real CAFDaiTracker off real DAI StreamEvents, so the architectural claim
// — CAFTracker needs no changes to support DAI — is proven end to end rather
// than against a fixture that happens to have the right shape.
describe('a real CAFDaiTracker attached to a real CAFTracker', () => {
  function wireUp() {
    const pm = createMockPlayerManager();
    const tracker = new CAFTracker(createMockReceiverContext(pm), { info: {} });
    const sm = createMockStreamManager();
    const dai = new CAFDaiTracker(sm, { playerManager: pm, contentTracker: tracker });
    tracker.setAdsTracker(dai);
    return { tracker, dai, sm };
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
