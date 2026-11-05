import CAFTracker, { CAFAdsTracker } from '../tracker';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      this.registerListeners();
    }
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
    sendAdBreakStart() {}
    sendAdBreakEnd() {}
    sendAdQuartile() {}
    sendAdClick() {}
    setAdsTracker(tracker) { this.adsTracker = tracker; }
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
});

function createMockPlayerManager() {
  return { addEventListener: jest.fn(), removeEventListener: jest.fn() };
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
