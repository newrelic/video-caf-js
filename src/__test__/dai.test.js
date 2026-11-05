import CAFDaiTracker from '../dai';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      this._isAd = false;
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    registerListeners() {}
    sendRequest() {}
    sendDownload() {}
    sendError() {}
    sendAdBreakStart() {}
    sendAdBreakEnd() {}
    sendStart() {}
    sendAdQuartile() {}
    sendEnd() {}
    sendPause() {}
    sendResume() {}
    sendAdClick() {}
    sendRenditionChanged() {}
  }
  const nrvideo = { VideoTracker, Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  return { ...nrvideo, default: nrvideo };
});

const StreamEventType = {
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click', VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged', TIMED_METADATA: 'timedMetadata',
};

beforeEach(() => {
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

function createMockStreamManager() {
  const listeners = {};
  return {
    addEventListener: jest.fn((type, cb) => { listeners[type] = cb; }),
    removeEventListener: jest.fn((type) => { delete listeners[type]; }),
    getStreamTime: jest.fn(() => 12.3),
    _emit(type, event) { if (listeners[type]) listeners[type](event); },
  };
}

function createMockPlayerManager() {
  return {
    getCurrentTimeSec: jest.fn(() => 3),
    getDurationSec: jest.fn(() => 120),
    getStats: jest.fn(() => ({ streamBandwidth: 512000 })),
  };
}

describe('CAFDaiTracker — construction & lifecycle', () => {
  it('registers a listener for every StreamEvent.Type on construction', () => {
    const sm = createMockStreamManager();
    new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    expect(sm.addEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('removes all listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    tracker.unregisterListeners();
    expect(sm.removeEventListener).toHaveBeenCalledTimes(Object.keys(StreamEventType).length);
  });

  it('LOADED extracts stream data and calls sendRequest()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendRequest');
    const event = { getStreamData: () => ({ streamId: 's1', url: 'https://x/master.m3u8', adTagParameters: {} }) };
    sm._emit(StreamEventType.LOADED, event);
    expect(tracker.sendRequest).toHaveBeenCalled();
    expect(tracker.getSrc()).toBe('https://x/master.m3u8');
  });

  it('STREAM_INITIALIZED calls sendDownload({ state: "stream-initialized" })', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendDownload');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendDownload).toHaveBeenCalledWith({ state: 'stream-initialized' });
  });

  it('AD_BREAK_STARTED extracts break data and calls sendAdBreakStart()', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    const event = { getAdBreak: () => ({ id: 'b1', title: 'Break 1', ads: [{}, {}] }) };
    sm._emit(StreamEventType.AD_BREAK_STARTED, event);
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toEqual(expect.objectContaining({ adBreakId: 'b1' }));
  });

  it('AD_BREAK_ENDED calls sendAdBreakEnd() and clears the current break', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  it('AD_PERIOD_STARTED with no current break falls back to starting a break', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'bumper', ads: [] }) });
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
  });

  it('AD_PERIOD_STARTED with a current break does not start a second one', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    expect(tracker.sendAdBreakStart).not.toHaveBeenCalled();
  });

  it('AD_PERIOD_ENDED does not end the break or send anything', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    sm._emit(StreamEventType.AD_BREAK_STARTED, { getAdBreak: () => ({ id: 'b1', ads: [] }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  it('ERROR with a throwing event object falls back to a generic message, not a crash', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager() });
    jest.spyOn(tracker, 'sendError');
    const throwingEvent = { getError: () => { throw new Error('boom'); } };
    expect(() => sm._emit(StreamEventType.ERROR, throwingEvent)).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'Unknown DAI error' }));
  });
});
