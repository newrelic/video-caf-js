import CAFDaiTracker from '../dai';
import nrvideo from '@newrelic/video-core';

jest.mock('@newrelic/video-core', () => {
  class VideoTracker {
    constructor(player, options) {
      this.player = player;
      this.options = options || {};
      // Mirrors the real base (videotracker.ts:74): every tracker gets a
      // VideoTrackerState in its constructor, and CAFTracker's ad-break guards
      // read `adsTracker.state.isAdBreak` off it.
      this.state = { isAdBreak: false, isRequested: false, isStarted: false };
      this.adsTracker = null;
      this.parentTracker = null;
      this._isAd = false;
      this.registerListeners();
    }
    isAd() { return this._isAd; }
    setIsAd(v) { this._isAd = v; }
    registerListeners() {}
    unregisterListeners() {}
    // Mirrors the real base (videotracker.ts:212-218): it nulls player and tag.
    dispose() {
      this.unregisterListeners();
      this.player = null;
      this.tag = null;
    }
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
    sendBufferStart() {}
    sendBufferEnd() {}
    sendSeekStart() {}
    sendSeekEnd() {}
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

// Every StreamEvent type CAFDaiTracker subscribes to. TIMED_METADATA is
// deliberately absent — see 'does not subscribe to TIMED_METADATA'.
const HANDLED_EVENT_TYPES = [
  StreamEventType.LOADED,
  StreamEventType.STREAM_INITIALIZED,
  StreamEventType.ERROR,
  StreamEventType.AD_BREAK_STARTED,
  StreamEventType.AD_BREAK_ENDED,
  StreamEventType.AD_PERIOD_STARTED,
  StreamEventType.AD_PERIOD_ENDED,
  StreamEventType.STARTED,
  StreamEventType.FIRST_QUARTILE,
  StreamEventType.MIDPOINT,
  StreamEventType.THIRD_QUARTILE,
  StreamEventType.COMPLETE,
  StreamEventType.SKIPPED,
  StreamEventType.PAUSED,
  StreamEventType.RESUMED,
  StreamEventType.CLICK,
  StreamEventType.VIDEO_CLICKED,
  StreamEventType.CUEPOINTS_CHANGED,
];

beforeEach(() => {
  jest.clearAllMocks();
  global.google = { ima: { dai: { api: { StreamEvent: { Type: StreamEventType } } } } };
});

// Mirrors the LIVE StreamManager surface, enumerated from the real SDK:
//   addEventListener, clicked, contentTimeForStreamTime, dispatchEvent, focus,
//   getAdSkippableState, listen, loadStreamMetadata, onTimedMetadata,
//   previousCuePointForStreamTime, processMetadata, removeEventListener,
//   replaceAdTagParameters, requestStream, reset, setClickElement, skipAd,
//   streamTimeForContentTime
// Note there is NO getStreamTime: an earlier version of this fixture invented
// one, which hid the fact that getPlayhead() always took its fallback path and
// that isUsing() could never match a real StreamManager.
// removeEventListener matches on the HANDLER REFERENCE, as the real
// StreamManager (and EventTarget) does. An earlier fixture ignored the second
// argument, so a tracker that registered one function and tried to remove a
// different one still looked like it had cleaned up — exactly the leak a
// handler wrapper introduces if it stores the unwrapped references.
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

function createMockPlayerManager(currentTime = 3, streamType = 'BUFFERED') {
  let time = currentTime;
  return {
    getCurrentTimeSec: jest.fn(() => time),
    getDurationSec: jest.fn(() => 120),
    getStats: jest.fn(() => ({ streamBandwidth: 512000, width: 1280, height: 720 })),
    // cast.framework.messages.MediaInformation.streamType — 'BUFFERED',
    // 'LIVE' or 'OTHER'. Already the repo's established way of reading media
    // metadata (tracker.js uses getMediaInformation four times).
    getMediaInformation: jest.fn(() => ({ streamType })),
    _setTime(t) { time = t; },
  };
}

function newTracker(sm = createMockStreamManager(), options = {}) {
  return new CAFDaiTracker(sm, { playerManager: createMockPlayerManager(), ...options });
}

// Mirrors the real IMA DAI Ad object: note there is deliberately NO
// getClickThroughUrl — the live SDK does not define one, and calling it
// unguarded used to throw and wipe every ad attribute.
function makeAd(overrides = {}) {
  return {
    getAdId: () => 'ad1',
    getCreativeId: () => 'c1',
    getDuration: () => 15,
    getTitle: () => 'My Ad',
    getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 1 }),
    ...overrides,
  };
}

function startAd(sm, adOverrides = {}) {
  sm._emit(StreamEventType.AD_BREAK_STARTED, {});
  sm._emit(StreamEventType.STARTED, { getAd: () => makeAd(adOverrides) });
}

describe('CAFDaiTracker — construction & lifecycle', () => {
  it('subscribes to exactly the StreamEvent types it handles', () => {
    const sm = createMockStreamManager();
    newTracker(sm);
    const subscribed = sm.addEventListener.mock.calls.map(([type]) => type).sort();
    expect(subscribed).toEqual([...HANDLED_EVENT_TYPES].sort());
  });

  // Optional chaining does not protect an UNDECLARED identifier, so
  // `!google?.ima...` threw a ReferenceError out of the constructor when the
  // IMA SDK had not been loaded — contradicting the README's documented
  // no-op-with-a-warning behaviour.
  it('warns instead of throwing when the IMA DAI SDK is absent', () => {
    delete global.google;
    const sm = createMockStreamManager();
    expect(() => newTracker(sm)).not.toThrow();
    expect(sm.addEventListener).not.toHaveBeenCalled();
    expect(nrvideo.Log.warn).toHaveBeenCalled();
  });

  it('removes all listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    tracker.unregisterListeners();
    expect(sm.removeEventListener).toHaveBeenCalledTimes(HANDLED_EVENT_TYPES.length);
    // Counting the calls is not enough: the StreamManager matches on the
    // handler reference, so removing something other than what was registered
    // leaves every listener in place.
    expect(sm._listenerCount()).toBe(0);
  });

  // The stitched stream being ready is not an ad request. Spending the request
  // here would consume video-core's isRequested flag, which AD_START needs —
  // and the flag is per-ad, so the whole session would report one ad start.
  it('LOADED captures stream data without emitting an ad request', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendRequest');
    sm._emit(StreamEventType.LOADED, {
      getStreamData: () => ({ streamId: 's1', url: 'https://x/master.m3u8' }),
    });
    expect(tracker.sendRequest).not.toHaveBeenCalled();
    expect(tracker.getSrc()).toBe('https://x/master.m3u8');
    expect(tracker.getStreamData()).toEqual({ streamId: 's1', url: 'https://x/master.m3u8' });
  });

  it('STREAM_INITIALIZED calls sendDownload({ state: "stream-initialized" })', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendDownload');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendDownload).toHaveBeenCalledWith({ state: 'stream-initialized' });
  });

  it('forgets ad and break state when a new stream initializes', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.getCurrentAd()).toBeNull();
    expect(tracker.getCurrentAdBreak()).toBeNull();
    expect(tracker.getAdCuePoints()).toEqual([]);
    expect(tracker.getStreamData()).toBeNull();
  });

  // CAFTracker guards on video-core's isAdBreak flag, which only
  // sendAdBreakEnd() clears — forgetting the break without ending it would
  // leave that flag stuck true for the rest of the session.
  it('closes an open break when a new stream replaces it mid-break', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    jest.spyOn(tracker, 'sendAdBreakEnd');
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendEnd).toHaveBeenCalledTimes(1);
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledTimes(1);
  });

  it('does not report a break ending when no break was open', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.STREAM_INITIALIZED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
  });

  it('AD_BREAK_STARTED opens a break and calls sendAdBreakStart()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  it('AD_BREAK_ENDED calls sendAdBreakEnd() and clears the current break', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  // The break's details are only known once its first ad has been seen, so the
  // end event is the one that can actually carry them to the backend.
  // `position` is internal bookkeeping: video-core already publishes it as
  // adPosition via getAdPosition(), so sending it too would ship two
  // differently named copies of the same value.
  it('does not ship an internal position key alongside adPosition', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakStart');
    jest.spyOn(tracker, 'sendAdBreakEnd');
    startAd(sm);
    expect(tracker.getAdPosition()).toBe('pre');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    for (const spy of [tracker.sendAdBreakStart, tracker.sendAdBreakEnd]) {
      const att = spy.mock.calls[0][0] ?? {};
      expect(att).not.toHaveProperty('position');
    }
  });

  it('AD_BREAK_ENDED reports the backfilled break details', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 2 }) });
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledWith({ adCount: 2 });
  });

  it('does not hand its internal break state to the telemetry layer', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    // video-core's getAttributes() fills and returns the very object it is
    // given, so passing internal state by reference lets it be overwritten.
    jest.spyOn(tracker, 'sendAdBreakStart').mockImplementation((att) => {
      att.trackerName = 'injected';
      att.viewId = 'injected';
    });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.getCurrentAdBreak()).not.toHaveProperty('trackerName');
    expect(tracker.getCurrentAdBreak()).not.toHaveProperty('viewId');
  });

  it('AD_PERIOD_STARTED with no current break falls back to starting a break', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    expect(tracker.sendAdBreakStart).toHaveBeenCalled();
  });

  it('AD_PERIOD_STARTED with a current break does not start a second one', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakStart');
    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    expect(tracker.sendAdBreakStart).not.toHaveBeenCalled();
  });

  // A break opened from a period event never gets an AD_BREAK_ENDED, so
  // without this it stayed open forever and CAFTracker's isAdBreak guard
  // suppressed every content event for the rest of the session.
  it('AD_PERIOD_ENDED closes a break that a period event opened', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  it('AD_PERIOD_ENDED leaves an SDK-announced break open (more ads may follow)', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakEnd');
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();
  });

  // A real AD_BREAK_STARTED takes ownership of the break a period event opened,
  // so the period end stops being a closing path for it. The measured ordering
  // on the sibling DASH integration was break-end-then-period-end, which hides
  // this; CAF has no cue-point fallback behind the break object on live, so the
  // other order has to be driven explicitly.
  it('a real AD_BREAK_STARTED takes over a break opened by a period event', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendAdBreakEnd');

    // The pod may still have ads to play: closing here would end the in-flight
    // ad, drop the content guard mid-break, and make the genuine
    // AD_BREAK_ENDED a no-op.
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});
    expect(tracker.sendAdBreakEnd).not.toHaveBeenCalled();
    expect(tracker.getCurrentAdBreak()).not.toBeNull();

    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledTimes(1);
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  it('closes the break exactly once when the break end precedes the period end', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakStart');
    jest.spyOn(tracker, 'sendAdBreakEnd');

    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});

    expect(tracker.sendAdBreakStart).toHaveBeenCalledTimes(1);
    expect(tracker.sendAdBreakEnd).toHaveBeenCalledTimes(1);
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });

  // The whole point of the period fallback: a bumper fires only period events.
  it('still closes a bumper break that never got an AD_BREAK_STARTED', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdBreakEnd');

    sm._emit(StreamEventType.AD_PERIOD_STARTED, {});
    sm._emit(StreamEventType.AD_PERIOD_ENDED, {});

    expect(tracker.sendAdBreakEnd).toHaveBeenCalledTimes(1);
    expect(tracker.getCurrentAdBreak()).toBeNull();
  });
});

describe('CAFDaiTracker — stream errors', () => {
  it('ERROR reports the SDK error message from StreamData', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'Stream initialization failed.' }),
    });
    expect(tracker.sendError).toHaveBeenCalledWith({
      errorMessage: 'Stream initialization failed.',
    });
  });

  // isAd() is true on this tracker, so reporting a failed stream request only
  // here makes it an AD_ERROR, and video-core sets hadStartupError only for
  // non-ad trackers — the most severe failure possible would never reach
  // content error analysis.
  it('ERROR is reported on the content tracker, not just as an ad error', () => {
    const sm = createMockStreamManager();
    const contentTracker = { sendError: jest.fn() };
    const tracker = newTracker(sm, { contentTracker });
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'The stream is inactive.' }),
    });
    expect(contentTracker.sendError).toHaveBeenCalledWith({
      errorMessage: 'The stream is inactive.',
    });
    expect(tracker.sendError).not.toHaveBeenCalled();
  });

  it('ERROR during an ad break is reported as both an ad and a content error', () => {
    const sm = createMockStreamManager();
    const contentTracker = { sendError: jest.fn() };
    const tracker = newTracker(sm, { contentTracker });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'Ad fetch failed.' }),
    });
    expect(tracker.sendError).toHaveBeenCalledTimes(1);
    expect(contentTracker.sendError).toHaveBeenCalledTimes(1);
  });

  // video-core's getAttributes() FILLS AND RETURNS the object it is handed, so
  // handing ONE payload to the ad tracker and then the content tracker
  // publishes a CONTENT_ERROR carrying adId, adPartner, adPosition and
  // adPlayhead. Already fixed in video-hls-js and video-dash-js.
  //
  // The test above cannot catch it: its mocks are plain jest.fn()s that do not
  // mutate, and Jest records arguments BY REFERENCE. This one replays the
  // mutation and snapshots what each tracker actually received.
  it('does not leak ad attributes into the content error event', () => {
    const sm = createMockStreamManager();
    let contentReceived = null;
    const contentTracker = {
      sendError: jest.fn((att) => {
        contentReceived = { ...att };
        att.isAd = false;
        att.contentId = 'content-1';
        return att;
      }),
    };
    const tracker = newTracker(sm, { contentTracker });
    tracker.sendError = jest.fn((att) => {
      att.isAd = true;
      att.adId = 'ad-1';
      att.adPartner = 'google-dai';
      att.adPosition = 'pre';
      att.adPlayhead = 3200;
      return att;
    });

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'Ad fetch failed.' }),
    });

    expect(contentReceived).toEqual({ errorMessage: 'Ad fetch failed.' });
    ['adId', 'adPartner', 'adPosition', 'adPlayhead'].forEach((key) => {
      expect(contentReceived).not.toHaveProperty(key);
    });
  });

  // setAdsTracker() sets parentTracker, so the usual integration needs no
  // explicit contentTracker option for errors to reach the content session.
  it('ERROR prefers the parentTracker set by setAdsTracker()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    tracker.parentTracker = { sendError: jest.fn() };
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'boom' }),
    });
    expect(tracker.parentTracker.sendError).toHaveBeenCalledWith({ errorMessage: 'boom' });
  });

  it('ERROR still reports on itself when no content tracker is wired', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'orphan error' }),
    });
    expect(tracker.sendError).toHaveBeenCalledWith({ errorMessage: 'orphan error' });
  });

  it('strips the query string from URLs in the SDK error message', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({
        errorMessage:
          'Stream initialization failed. HTTP status code: 404 with URL: ' +
          'https://pubads.g.doubleclick.net/ondemand/hls/content/1/vid/x/streams' +
          '?ppid=user-4821&cust_params=uid%3D99&ua=Mozilla%2F5.0&sid=ABC-123',
      }),
    });
    const { errorMessage } = tracker.sendError.mock.calls[0][0];
    expect(errorMessage).toContain('HTTP status code: 404');
    expect(errorMessage).toContain('/ondemand/hls/content/1/vid/x/streams');
    expect(errorMessage).not.toContain('ppid');
    expect(errorMessage).not.toContain('cust_params');
    expect(errorMessage).not.toContain('user-4821');
    expect(errorMessage).not.toContain('sid=');
  });

  // CodeQL js/polynomial-redos: a query-stripping regex that requires the
  // [?#] to match makes every 'http://' in the message start a scan to the end
  // of the token that then fails and backtracks — quadratic in the message
  // length. The SDK's errorMessage is unbounded, and the cap is applied after
  // the regex, so nothing bounds the work.
  it('sanitizes a pathological error message in linear time', () => {
    const tracker = newTracker();

    const pathological = 'http://'.repeat(20000);
    const start = Date.now();
    tracker.sanitizeErrorMessage(pathological);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(400);
  });

  it('caps a runaway error message', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendError');
    sm._emit(StreamEventType.ERROR, {
      getStreamData: () => ({ errorMessage: 'x'.repeat(5000) }),
    });
    const { errorMessage } = tracker.sendError.mock.calls[0][0];
    expect(errorMessage.length).toBeLessThanOrEqual(512);
  });

  it('ERROR with a throwing event object falls back to a generic message, not a crash', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendError');
    const throwingEvent = { getStreamData: () => { throw new Error('boom'); } };
    expect(() => sm._emit(StreamEventType.ERROR, throwingEvent)).not.toThrow();
    expect(tracker.sendError).toHaveBeenCalledWith(
      expect.objectContaining({ errorMessage: 'Unknown DAI error' })
    );
  });
});

describe('CAFDaiTracker — ad playback events', () => {
  it('STARTED extracts ad data and calls sendStart()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendStart');
    startAd(sm);
    expect(tracker.sendStart).toHaveBeenCalled();
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getTitle()).toBe('My Ad');
    expect(tracker.getAdCreativeId()).toBe('c1');
    expect(tracker.getDuration()).toBe(15000);
  });

  it('extracts ad identity even though the SDK has no getClickThroughUrl', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getClickThroughUrl()).toBeNull();
  });

  it('survives an Ad object whose optional accessors all throw', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    const throwing = () => { throw new Error('nope'); };
    startAd(sm, {
      getCreativeId: throwing,
      getDuration: throwing,
      getTitle: throwing,
      getDescription: throwing,
    });
    expect(tracker.getVideoId()).toBe('ad1');
    expect(tracker.getTitle()).toBeNull();
    expect(tracker.getDuration()).toBeNull();
  });

  // Under SSAI the ad advances the stitched stream's clock, so a time-based
  // guess reclassifies a long pre-roll as a mid-roll partway through it. IMA's
  // pod index is authoritative instead.
  it.each([
    [0, 'pre'],
    [-1, 'post'],
    [2, 'mid'],
  ])('classifies ad pod index %i as "%s"', (podIndex, expected) => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdPodInfo: () => ({ getPodIndex: () => podIndex }) });
    expect(tracker.getCurrentAd().position).toBe(expected);
    expect(tracker.getAdPosition()).toBe(expected);
  });

  it('leaves the position unknown rather than guessing when the pod info is absent', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdPodInfo: undefined });
    expect(tracker.getAdPosition()).toBeNull();
  });

  it('keeps adPosition stable for the whole ad as the stream time advances', () => {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager(1);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    startAd(sm, { getAdPodInfo: () => ({ getPodIndex: () => 0 }) });
    expect(tracker.getAdPosition()).toBe('pre');
    pm._setTime(90); // deep into a long pre-roll
    expect(tracker.getAdPosition()).toBe('pre');
  });

  it('reports the real ad count from the IMA ad pod, not 0', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 3 }) });
    expect(tracker.getCurrentAd().adCount).toBe(3);
  });

  it('leaves adCount unset rather than reporting 0 when the pod is unavailable', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdPodInfo: undefined });
    expect(tracker.getCurrentAd().adCount).toBeUndefined();
  });

  it.each([
    [StreamEventType.FIRST_QUARTILE, 1],
    [StreamEventType.MIDPOINT, 2],
    [StreamEventType.THIRD_QUARTILE, 3],
  ])('%s calls sendAdQuartile({ quartile: %i })', (type, quartile) => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdQuartile');
    startAd(sm);
    sm._emit(type, {});
    expect(tracker.sendAdQuartile).toHaveBeenCalledWith({ quartile });
  });

  // Joining a live stream mid-break, the SDK reports quartiles for an ad whose
  // STARTED never arrived. Counting those makes quartiles outnumber ad starts.
  it('does not report a quartile for an ad that never started', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdQuartile');
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.FIRST_QUARTILE, {});
    expect(tracker.sendAdQuartile).not.toHaveBeenCalled();
  });

  it('does not report a quartile arriving after the ad completed', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    sm._emit(StreamEventType.COMPLETE, {});
    jest.spyOn(tracker, 'sendAdQuartile');
    sm._emit(StreamEventType.THIRD_QUARTILE, {});
    expect(tracker.sendAdQuartile).not.toHaveBeenCalled();
  });

  it('COMPLETE calls sendEnd() and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.COMPLETE, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith();
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('SKIPPED calls sendEnd({ skipped: true }) and clears the current ad', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.SKIPPED, {});
    expect(tracker.sendEnd).toHaveBeenCalledWith({ skipped: true });
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('PAUSED calls sendPause(), RESUMED calls sendResume()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendPause');
    jest.spyOn(tracker, 'sendResume');
    startAd(sm);
    sm._emit(StreamEventType.PAUSED, {});
    sm._emit(StreamEventType.RESUMED, {});
    expect(tracker.sendPause).toHaveBeenCalled();
    expect(tracker.sendResume).toHaveBeenCalled();
  });

  // video-core warns when the url key is absent-or-falsy, and today's DAI Ad
  // object has no clickthrough accessor at all, so sending a known null would
  // log that warning on every single click.
  it.each([StreamEventType.CLICK, StreamEventType.VIDEO_CLICKED])(
    '%s calls sendAdClick without a url the SDK cannot provide',
    (type) => {
      const sm = createMockStreamManager();
      const tracker = newTracker(sm);
      jest.spyOn(tracker, 'sendAdClick');
      startAd(sm);
      sm._emit(type, {});
      expect(tracker.sendAdClick).toHaveBeenCalledWith({});
    }
  );

  it('picks up a clickthrough url if a future SDK version provides one', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdClick');
    startAd(sm, { getClickThroughUrl: () => 'https://advertiser.example' });
    sm._emit(StreamEventType.CLICK, {});
    expect(tracker.sendAdClick).toHaveBeenCalledWith({ url: 'https://advertiser.example' });
  });

  it('does not report a click for an ad that never started', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendAdClick');
    sm._emit(StreamEventType.CLICK, {});
    expect(tracker.sendAdClick).not.toHaveBeenCalled();
  });

  // video-core gates AD_START on state.isRequested and clears that flag on
  // both AD_END and AD_BREAK_END. A single request at LOADED therefore let
  // only the session's very first ad report a start.
  it('requests before every ad start, not once per stream', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    jest.spyOn(tracker, 'sendRequest');
    sm._emit(StreamEventType.LOADED, { getStreamData: () => ({ url: 'https://x' }) });
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => 'ad1' }) });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => 'ad2' }) });
    expect(tracker.sendRequest).toHaveBeenCalledTimes(2);
  });

  // goAdBreakEnd() clears isRequested but NOT isStarted; only sendEnd() resets
  // that, so an unfinished ad would block AD_START for every later ad.
  it('ends an ad that is still in flight when its break ends', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendEnd).toHaveBeenCalledTimes(1);
    expect(tracker.getCurrentAd()).toBeNull();
  });

  it('does not double-end an ad that already completed', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm);
    sm._emit(StreamEventType.COMPLETE, {});
    jest.spyOn(tracker, 'sendEnd');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.sendEnd).not.toHaveBeenCalled();
  });

  it('a second ad break does not see stale data from the first', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    startAd(sm, { getAdId: () => 'ad1' });
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    startAd(sm, { getAdId: () => 'ad2' });
    expect(tracker.getVideoId()).toBe('ad2');
  });

  it('getPlayhead() reports progress within the ad, not the stitched stream position', () => {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager(100);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    startAd(sm);
    pm._setTime(105);
    expect(tracker.getPlayhead()).toBe(5000);
  });

  it('getPlayhead() goes back to stream time once the ad ends', () => {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager(100);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    startAd(sm);
    pm._setTime(115);
    sm._emit(StreamEventType.COMPLETE, {});
    expect(tracker.getPlayhead()).toBe(115000);
  });

  it('rebases the playhead for every ad in a pod', () => {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager(100);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    startAd(sm, { getAdId: () => 'ad1' });
    pm._setTime(115);
    sm._emit(StreamEventType.COMPLETE, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => 'ad2' }) });
    pm._setTime(118);
    expect(tracker.getPlayhead()).toBe(3000);
  });
});

describe('CAFDaiTracker — cue points, getters, bitrate', () => {
  it('CUEPOINTS_CHANGED reads cue points from StreamData', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    const cuepoints = [{ start: 0, end: 10, played: false }];
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints }) });
    expect(tracker.getAdCuePoints()).toEqual(cuepoints);
  });

  // Only CUEPOINTS_CHANGED carries them; other events report null, so a
  // missing list must leave the known one alone rather than clearing it.
  it('does not clobber known cue points when a later event carries none', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    const cuepoints = [{ start: 0, end: 10 }];
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints }) });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, { getStreamData: () => ({ cuepoints: null }) });
    expect(tracker.getAdCuePoints()).toEqual(cuepoints);
  });

  it('survives a CUEPOINTS_CHANGED event whose accessor throws', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    expect(() =>
      sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
        getStreamData: () => { throw new Error('boom'); },
      })
    ).not.toThrow();
    expect(tracker.getAdCuePoints()).toEqual([]);
  });

  // The live SDK's StreamEvent has no getType()/getData(), so a handler here
  // could only ever warn. hls.js dropped it for the same reason.
  it('does not subscribe to TIMED_METADATA', () => {
    const sm = createMockStreamManager();
    newTracker(sm);
    const subscribed = sm.addEventListener.mock.calls.map(([type]) => type);
    expect(subscribed).not.toContain(StreamEventType.TIMED_METADATA);
  });

  // The live SDK exposes no getStreamTime(); its time API only converts a time
  // it is handed. CAF's own playback position is the stitched stream's clock.
  it('getPlayhead() reports stream time from the CAF player, in ms', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, { playerManager: createMockPlayerManager(7) });
    expect(tracker.getPlayhead()).toBe(7000);
    expect(tracker.getStreamTimeMs()).toBe(7000);
  });

  it('getPlayhead() does not consult the StreamManager', () => {
    const sm = createMockStreamManager();
    sm.getStreamTime = jest.fn(() => 999);
    const tracker = newTracker(sm);
    tracker.getPlayhead();
    expect(sm.getStreamTime).not.toHaveBeenCalled();
  });

  // Cross-player parity: a dashboard filtering trackerName = 'dai-ads' must
  // not silently exclude Chromecast. video-hls-js and video-dash-js both report
  // 'dai-ads'; the platform is already carried by playerName.
  it('reports the same trackerName as the hls and dash DAI trackers', () => {
    const tracker = newTracker();
    expect(tracker.getTrackerName()).toBe('dai-ads');
    expect(tracker.getPlayerName()).toBe('caf-dai');
    expect(tracker.getAdPartner()).toBe('google-dai');
  });

  it('getPlayhead() reports 0 rather than throwing without a playerManager', () => {
    const sm = createMockStreamManager();
    const tracker = new CAFDaiTracker(sm, {});
    expect(tracker.getPlayhead()).toBe(0);
  });

  // Derived from the content tracker's isLive(), as the hls.js and dash.js DAI
  // trackers do.
  //
  // NOT from MediaInformation.streamType: that is what the SENDER declared in
  // the LOAD request, and when the sender omits it the receiver fills it in
  // from a duration test (verified in the v3 bundle:
  // `duration === -1 || duration === Infinity ? 'LIVE' : 'BUFFERED'`). A DAI
  // live stream is stitched into a finite, growing DVR window — measured at 60s
  // on the sibling DASH integration — so that test reports every live DAI
  // stream as BUFFERED. CAFTracker.isLive() reads the receiver's live seekable
  // range instead, which the media player derives from the manifest.
  it('getStreamType() derives from the content tracker', () => {
    const live = newTracker(createMockStreamManager(), {
      contentTracker: { isLive: () => true },
    });
    const vod = newTracker(createMockStreamManager(), {
      contentTracker: { isLive: () => false },
    });

    expect(live.getStreamType()).toBe('live');
    expect(live.isLiveStream()).toBe(true);
    expect(vod.getStreamType()).toBe('vod');
    expect(vod.isLiveStream()).toBe(false);
  });

  it('getStreamType() ignores the sender-declared receiver stream type', () => {
    const pm = createMockPlayerManager(3, 'BUFFERED');
    const tracker = new CAFDaiTracker(createMockStreamManager(), {
      playerManager: pm,
      contentTracker: { isLive: () => true },
    });

    expect(tracker.getStreamType()).toBe('live');
    expect(pm.getMediaInformation).not.toHaveBeenCalled();
  });

  // Unknown reports null rather than guessing 'vod' — a wrong value is worse
  // than an absent one — and only a boolean counts as an answer.
  it('getStreamType() reports unknown when liveness is not established', () => {
    expect(newTracker().getStreamType()).toBeNull();

    const unknown = newTracker(createMockStreamManager(), {
      contentTracker: { isLive: () => null },
    });
    expect(unknown.getStreamType()).toBeNull();
    expect(unknown.isLiveStream()).toBe(false);
  });

  // getStreamType() runs for every ad event, including before media is loaded.
  it('getStreamType() does not throw when the content tracker cannot answer', () => {
    const tracker = newTracker(createMockStreamManager(), {
      contentTracker: { isLive: () => { throw new Error('not loaded') } },
    });

    expect(() => tracker.getStreamType()).not.toThrow();
    expect(tracker.getStreamType()).toBeNull();
  });

  it('isMuted() delegates to options.contentTracker, null without one', () => {
    const contentTracker = { isMuted: jest.fn(() => true) };
    const tracker = newTracker(createMockStreamManager(), { contentTracker });
    expect(tracker.isMuted()).toBe(true);
    expect(newTracker().isMuted()).toBeNull();
  });

  it('getBitrate() reads playerManager.getStats().streamBandwidth', () => {
    expect(newTracker().getBitrate()).toBe(512000);
  });

  it('rendition dimensions come from playerManager.getStats()', () => {
    const tracker = newTracker();
    expect(tracker.getRenditionWidth()).toBe(1280);
    expect(tracker.getRenditionHeight()).toBe(720);
  });

  it('rendition getters return null when the player has no stats', () => {
    const tracker = new CAFDaiTracker(createMockStreamManager(), {});
    expect(tracker.getRenditionWidth()).toBeNull();
    expect(tracker.getRenditionHeight()).toBeNull();
    expect(tracker.getBitrate()).toBeNull();
  });

  it('onBitrateChanged(ev) updates _currentBitrate and calls sendRenditionChanged()', () => {
    const tracker = newTracker();
    jest.spyOn(tracker, 'sendRenditionChanged');
    tracker.onBitrateChanged({ totalBitrate: 777 });
    expect(tracker.getRenditionBitrate()).toBe(777);
    expect(tracker.sendRenditionChanged).toHaveBeenCalled();
  });

  it('reports google-dai as the ad partner', () => {
    expect(newTracker().getAdPartner()).toBe('google-dai');
  });

  // The real StreamManager has no getStreamTime (or any other shape unique to
  // it), so a detector built on one could only ever return false. hls.js
  // removed its equivalent rather than inventing a replacement.
  it('does not expose an isUsing() detector', () => {
    expect(CAFDaiTracker.isUsing).toBeUndefined();
  });
});

// CAFTracker duck-types its adsTracker: it reads `adsTracker.state.isAdBreak`
// and calls `adsTracker.onBitrateChanged(ev)` by name, plus the inherited
// send* methods, with no instanceof check anywhere (src/tracker.js:215-313).
// This asserts the real CAFDaiTracker satisfies that contract, so the surface
// cannot drift out from under tracker.js unnoticed.
describe('CAFDaiTracker — interface CAFTracker depends on', () => {
  const REQUIRED_METHODS = [
    'sendPause',
    'sendResume',
    'sendBufferStart',
    'sendBufferEnd',
    'sendSeekStart',
    'sendSeekEnd',
    'sendError',
    'onBitrateChanged',
  ];

  it('exposes a state object carrying the ad-break flag', () => {
    const tracker = newTracker();
    expect(typeof tracker.state).toBe('object');
    expect(tracker.state).not.toBeNull();
    expect('isAdBreak' in tracker.state).toBe(true);
  });

  it.each(REQUIRED_METHODS)('exposes %s() as a function', (method) => {
    expect(typeof newTracker()[method]).toBe('function');
  });

  // The guard reads video-core's own isAdBreak flag, which only the base
  // class's sendAdBreakStart()/sendAdBreakEnd() can move — overriding either
  // here would silently decouple the flag from the DAI break.
  it('does not override the inherited methods that drive the ad-break flag', () => {
    const own = Object.getOwnPropertyNames(CAFDaiTracker.prototype);
    expect(own).not.toContain('sendAdBreakStart');
    expect(own).not.toContain('sendAdBreakEnd');
  });
});

// Under SSAI the stitched clock includes every ad played so far, so the content
// tracker cannot report it as content progress. The SDK's own conversion is the
// only thing that knows the offset; CAFTracker asks for it through here.
describe('CAFDaiTracker — stream time to content time', () => {
  it('converts through the StreamManager', () => {
    const sm = createMockStreamManager();
    sm.contentTimeForStreamTime = jest.fn(() => 10.5);
    const tracker = newTracker(sm);

    expect(tracker.contentTimeForStreamTime(20.51)).toBe(10.5);
    expect(sm.contentTimeForStreamTime).toHaveBeenCalledWith(20.51);
  });

  // undefined, not a number: the caller then keeps reporting stream time rather
  // than a wrong one.
  it('returns undefined when the SDK cannot convert', () => {
    const sm = createMockStreamManager();
    sm.contentTimeForStreamTime = jest.fn(() => { throw new Error('nope') });

    expect(newTracker(sm).contentTimeForStreamTime(5)).toBeUndefined();
  });

  it('returns undefined on a disposed tracker instead of throwing', () => {
    const tracker = newTracker();
    tracker.dispose();

    expect(tracker.contentTimeForStreamTime(5)).toBeUndefined();
  });
});

describe('CAFDaiTracker — isAdPlaying', () => {
  const cuePoints = [
    { start: 0, end: 10.01, played: false },
    { start: 310.012, end: 320.022, played: false },
  ];

  function withCuePoints(currentTime, points = cuePoints) {
    const sm = createMockStreamManager();
    const pm = createMockPlayerManager(currentTime);
    const tracker = new CAFDaiTracker(sm, { playerManager: pm });
    sm._emit(StreamEventType.CUEPOINTS_CHANGED, {
      getStreamData: () => ({ cuepoints: points.map((c) => ({ ...c })) }),
    });
    return { sm, pm, tracker };
  }

  // AD_BREAK_STARTED arrives only after playback has already entered the ad, so
  // the break object alone misses the first moments of a pre-roll. Cue points,
  // known ahead of playback, cover that window.
  it('matches cue points against stream time', () => {
    expect(withCuePoints(5).tracker.isAdPlaying()).toBe(true);
    expect(withCuePoints(315).tracker.isAdPlaying()).toBe(true);
    expect(withCuePoints(100).tracker.isAdPlaying()).toBe(false);
    // End is exclusive.
    expect(withCuePoints(10.01).tracker.isAdPlaying()).toBe(false);
  });

  // Seeking back into a watched pre-roll gets no fresh ad telemetry, so
  // suppressing content there would lose it outright.
  it('skips cue point windows already played', () => {
    const { tracker } = withCuePoints(5, [{ start: 0, end: 10.01, played: true }]);
    expect(tracker.isAdPlaying()).toBe(false);
  });

  // Cue points are a VOD-only facility in DAI — the live asset reported none on
  // the sibling DASH integration — so this fallback is the path ALL live
  // traffic takes, and it is the entire content guard on live.
  it('returns true from the break object alone when there are no cue points', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    expect(tracker.getAdCuePoints()).toEqual([]);

    expect(tracker.isAdPlaying()).toBe(false);
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.isAdPlaying()).toBe(true);
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});
    expect(tracker.isAdPlaying()).toBe(false);
  });

  // isAdPlaying reads getStreamTimeMs(), NOT getPlayhead(): cue point windows
  // are stream times, and the ad-relative value would never fall inside a
  // mid-roll's window.
  it('uses stream time, not the ad-relative playhead', () => {
    const { sm, tracker } = withCuePoints(315, [
      { start: 310.012, end: 320.022, played: false },
    ]);
    // The ad started 1s into the window, so getPlayhead() reads 1000ms — which
    // falls outside the 310-320 window and would report false.
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(tracker.getPlayhead()).toBe(315000);
    expect(tracker.isAdPlaying()).toBe(true);
  });

  // video-core's disposeAdsTracker() calls dispose(), which nulls this
  // tracker's player and tag, but never clears the PARENT's adsTracker
  // reference — verified in 5.1.1 source. So the content guard keeps calling in
  // after setAdsTracker(null).
  it('stays inert after being disposed instead of throwing', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    expect(tracker.isAdPlaying()).toBe(true);

    tracker.dispose();

    expect(tracker.isAdPlaying()).toBe(false);
    expect(() => tracker.getPlayhead()).not.toThrow();
  });
});

// FOUND IN THE BROWSER ON THE DASH SIBLING. Every handler here runs inside the
// IMA DAI SDK's own event dispatch, so an exception escaping one does not just
// lose an event — it reaches the SDK, which aborts the stream request and emits
// an empty ERROR. Nothing played at all.
//
// The reachable chain on CAF is onStreamError -> contentTracker.sendError() ->
// CAFTracker.getAttributes(), which reads the receiver and the PlayerManager.
// The individual getters are hardened in CAFTracker, but this contains the
// whole class: the thrown value comes from a third-party player through
// video-core's attribute collection, so the next such throw would break the
// customer's playback the same way.
describe('CAFDaiTracker — never throws into the SDK dispatch', () => {
  it('swallows and logs an exception from any handler', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);

    // Exactly what was observed on dash.js: a bare string, not an Error, so
    // `error.message` is undefined.
    tracker.sendDownload = () => {
      throw 'You must first call initialize() and set a valid source';
    };

    expect(() => sm._emit(StreamEventType.STREAM_INITIALIZED, {})).not.toThrow();
    expect(nrvideo.Log.error).toHaveBeenCalled();
  });

  it('keeps handling later events after one handler threw', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    tracker.sendAdBreakStart = () => {
      throw new Error('attribute collection exploded');
    };

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    // The break still opened: state is updated before the send.
    expect(tracker.getCurrentAdBreak()).not.toBeNull();

    tracker.sendAdQuartile = jest.fn();
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.FIRST_QUARTILE, {});
    expect(tracker.sendAdQuartile).toHaveBeenCalledWith({ quartile: 1 });
  });

  // The wrapper has to be stored, not recomputed: the StreamManager removes by
  // handler reference, so unregistering the unwrapped functions would leave
  // every listener attached for the life of the receiver.
  it('still removes the wrapped listeners on unregisterListeners()', () => {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    tracker.unregisterListeners();

    expect(sm._listenerCount()).toBe(0);
    sm.removeEventListener.mock.calls.forEach(([type, handler]) => {
      expect(sm.addEventListener).toHaveBeenCalledWith(type, handler);
    });
  });
});

describe("CAFDaiTracker — against video-core's real event gating", () => {
  function gatedTracker() {
    const sm = createMockStreamManager();
    const tracker = newTracker(sm);
    const state = { isRequested: false, isStarted: false, isAdBreak: false };
    const reported = [];

    tracker.sendRequest = () => {
      if (state.isRequested) return;
      state.isRequested = true;
      reported.push('AD_REQUEST');
    };
    tracker.sendStart = () => {
      if (!state.isRequested || state.isStarted) return;
      state.isStarted = true;
      reported.push('AD_START');
    };
    tracker.sendEnd = () => {
      if (!state.isRequested) return;
      state.isRequested = false;
      state.isStarted = false;
      reported.push('AD_END');
    };
    tracker.sendAdBreakStart = () => {
      if (state.isAdBreak) return;
      state.isAdBreak = true;
      reported.push('AD_BREAK_START');
    };
    tracker.sendAdBreakEnd = () => {
      if (!state.isAdBreak) return;
      state.isAdBreak = false;
      state.isRequested = false;
      reported.push('AD_BREAK_END');
    };
    tracker.sendAdQuartile = ({ quartile }) => reported.push(`AD_QUARTILE${quartile}`);

    return { sm, tracker, reported };
  }

  function playAd(sm, adId) {
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd({ getAdId: () => adId }) });
    sm._emit(StreamEventType.FIRST_QUARTILE, {});
    sm._emit(StreamEventType.COMPLETE, {});
  }

  it('still reports later ads when an earlier ad never completed', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    sm._emit(StreamEventType.STARTED, { getAd: () => makeAd() });
    sm._emit(StreamEventType.AD_BREAK_ENDED, {}); // no COMPLETE for ad1
    const mark = reported.length;

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    const second = reported.slice(mark);
    expect(second).toContain('AD_START');
    expect(second.indexOf('AD_START')).toBeLessThan(second.indexOf('AD_QUARTILE1'));
  });

  it('reports a start and an end for every ad in a multi-ad pod', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(reported.filter((e) => e === 'AD_START')).toHaveLength(2);
    expect(reported.filter((e) => e === 'AD_END')).toHaveLength(2);
  });

  it('still reports ads in a later break after the first break ended', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    expect(reported).toEqual([
      'AD_BREAK_START', 'AD_REQUEST', 'AD_START', 'AD_QUARTILE1', 'AD_END', 'AD_BREAK_END',
      'AD_BREAK_START', 'AD_REQUEST', 'AD_START', 'AD_QUARTILE1', 'AD_END', 'AD_BREAK_END',
    ]);
  });

  it('never emits a quartile for an ad that never reported a start', () => {
    const { sm, reported } = gatedTracker();
    sm._emit(StreamEventType.AD_BREAK_STARTED, {});
    playAd(sm, 'ad1');
    playAd(sm, 'ad2');
    sm._emit(StreamEventType.AD_BREAK_ENDED, {});

    const starts = reported.filter((e) => e === 'AD_START').length;
    const quartiles = reported.filter((e) => e.startsWith('AD_QUARTILE')).length;
    expect(quartiles).toBe(starts);
  });
});
