import forwardDaiMetadata, {
  DAI_SCHEME_ID_URI,
  TIMED_METADATA_CHANGED,
  extractDaiPayload,
} from '../forwardDaiMetadata';
import nrvideo from '@newrelic/video-core';

jest.mock('@newrelic/video-core', () => ({
  __esModule: true,
  default: { Log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } },
}));

/**
 * The exact payload CAF delivered for a live DAI DASH stream, captured from
 * cast.framework.events.EventType.TIMED_METADATA_CHANGED on CAF 3.0.0157 with
 * Shaka 4.15.56. Every field below was observed, not invented — the tests are
 * only as good as this fixture's fidelity to the real event.
 */
const realEvent = (overrides = {}) => ({
  type: 'TIMED_METADATA_CHANGED',
  timedMetadataInfo: {
    id: '0',
    startTime: 179480506.107,
    endTime: 179480506.107,
    dashTimedMetadata: {
      schemeIdUri: 'urn:google:dai:2018',
      value: '',
      eventElement: {},
      eventNode: {
        tagName: 'Event',
        attributes: {
          presentationTime: '100',
          duration: '0',
          id: '0',
          messageData: 'google_3495521836947441448',
        },
        children: [],
      },
    },
    ...overrides,
  },
});

const makePlayerManager = () => {
  const listeners = {};
  return {
    listeners,
    addEventListener: jest.fn((type, fn) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }),
    removeEventListener: jest.fn((type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    }),
    emit: (type, event) => (listeners[type] || []).forEach((f) => f(event)),
  };
};

const makeStreamManager = () => ({ processMetadata: jest.fn() });

beforeEach(() => jest.clearAllMocks());

describe('extractDaiPayload', () => {
  it('reads messageData from eventNode.attributes, not from timedMetadataInfo', () => {
    // Guards trap (1): messageData is three levels down. A reader that looks at
    // timedMetadataInfo.messageData gets undefined and forwards nothing.
    expect(extractDaiPayload(realEvent())).toEqual({
      messageData: 'google_3495521836947441448',
      timestamp: 179480506.107,
    });
  });

  it('uses startTime, not the MPD-relative presentationTime', () => {
    // Guards trap (2): presentationTime is '100'; the SDK needs stream seconds.
    expect(extractDaiPayload(realEvent()).timestamp).toBe(179480506.107);
    expect(extractDaiPayload(realEvent()).timestamp).not.toBe(100);
  });

  it('ignores timed metadata from another scheme', () => {
    const event = realEvent();
    event.timedMetadataInfo.dashTimedMetadata.schemeIdUri = 'urn:scte:dash:utc-time';
    expect(extractDaiPayload(event)).toBeNull();
  });

  it('ignores an HLS timed-metadata event, which carries no dashTimedMetadata', () => {
    expect(extractDaiPayload({ timedMetadataInfo: { startTime: 12, hlsTimedMetadata: {} } })).toBeNull();
  });

  it.each([
    ['no event', undefined],
    ['no timedMetadataInfo', {}],
    ['no dashTimedMetadata', { timedMetadataInfo: { startTime: 1 } }],
  ])('returns null for %s', (_label, event) => {
    expect(extractDaiPayload(event)).toBeNull();
  });

  it('returns null when messageData is absent or empty', () => {
    const missing = realEvent();
    delete missing.timedMetadataInfo.dashTimedMetadata.eventNode.attributes.messageData;
    expect(extractDaiPayload(missing)).toBeNull();

    const empty = realEvent();
    empty.timedMetadataInfo.dashTimedMetadata.eventNode.attributes.messageData = '';
    expect(extractDaiPayload(empty)).toBeNull();
  });

  it('returns null when startTime is not a finite number', () => {
    const nan = realEvent({ startTime: NaN });
    expect(extractDaiPayload(nan)).toBeNull();

    const missing = realEvent();
    delete missing.timedMetadataInfo.startTime;
    expect(extractDaiPayload(missing)).toBeNull();
  });
});

describe('forwardDaiMetadata', () => {
  it('forwards scheme, messageData and stream time to processMetadata', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();

    forwardDaiMetadata(pm, sm);
    pm.emit(TIMED_METADATA_CHANGED, realEvent());

    expect(sm.processMetadata).toHaveBeenCalledWith(
      DAI_SCHEME_ID_URI,
      'google_3495521836947441448',
      179480506.107
    );
  });

  it('subscribes to TIMED_METADATA_CHANGED exactly once', () => {
    // Registering twice would hand the SDK every event twice and double every
    // AD_QUARTILE reaching New Relic — the failure the dash.js helper exists
    // to prevent. One subscription, one mode.
    const pm = makePlayerManager();
    forwardDaiMetadata(pm, makeStreamManager());

    expect(pm.addEventListener).toHaveBeenCalledTimes(1);
    expect(pm.addEventListener).toHaveBeenCalledWith(TIMED_METADATA_CHANGED, expect.any(Function));
  });

  it('does not forward an event from another scheme', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();
    const event = realEvent();
    event.timedMetadataInfo.dashTimedMetadata.schemeIdUri = 'urn:scte:dash:utc-time';

    forwardDaiMetadata(pm, sm);
    pm.emit(TIMED_METADATA_CHANGED, event);

    expect(sm.processMetadata).not.toHaveBeenCalled();
  });

  it('never throws into CAF dispatch when processMetadata fails', () => {
    // An exception escaping here reaches the receiver's event dispatch and can
    // abort playback — the same class of defect that broke the dash sample.
    const pm = makePlayerManager();
    const sm = { processMetadata: jest.fn(() => { throw new Error('boom'); }) };

    forwardDaiMetadata(pm, sm);

    expect(() => pm.emit(TIMED_METADATA_CHANGED, realEvent())).not.toThrow();
    expect(nrvideo.Log.warn).toHaveBeenCalledWith(
      'forwardDaiMetadata: processMetadata failed',
      expect.any(Error)
    );
  });

  it('removes the subscription when disposed, and is safe to dispose twice', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();

    const dispose = forwardDaiMetadata(pm, sm);
    dispose();
    pm.emit(TIMED_METADATA_CHANGED, realEvent());

    expect(sm.processMetadata).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it('warns and returns a noop when there is no PlayerManager', () => {
    const dispose = forwardDaiMetadata(null, makeStreamManager());

    expect(nrvideo.Log.warn).toHaveBeenCalledWith(expect.stringContaining('no PlayerManager'));
    expect(() => dispose()).not.toThrow();
  });

  it('warns and returns a noop when the StreamManager cannot take metadata', () => {
    const pm = makePlayerManager();
    const dispose = forwardDaiMetadata(pm, {});

    expect(nrvideo.Log.warn).toHaveBeenCalledWith(expect.stringContaining('no StreamManager'));
    expect(pm.addEventListener).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it('falls back to the measured event-type string when the cast global is absent', () => {
    // The module must not import the CAF SDK, so it has to work when `cast` was
    // never declared — `typeof` guard, not optional chaining.
    expect(typeof cast).toBe('undefined');
    const pm = makePlayerManager();

    forwardDaiMetadata(pm, makeStreamManager());

    expect(pm.addEventListener).toHaveBeenCalledWith('TIMED_METADATA_CHANGED', expect.any(Function));
  });
});

/**
 * The failure this module exists to prevent is an ABSENCE of ad events, which
 * is indistinguishable from a stream that served no ads. An HLS stream matches
 * nothing here, and before this detector existed the only symptom was silence —
 * which is exactly how the shipped sample came to request HLS while the
 * forwarder read DASH, and nothing caught it.
 */
describe('forwardDaiMetadata — telling "no ads" apart from "matching nothing"', () => {
  const hlsEvent = () => ({
    type: 'TIMED_METADATA_CHANGED',
    timedMetadataInfo: { id: '0', startTime: 123.4, hlsTimedMetadata: { /* no dashTimedMetadata */ } },
  });

  it('warns once after enough unmatched events, naming HLS as the likely cause', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();
    forwardDaiMetadata(pm, sm);

    for (let i = 0; i < 25; i += 1) pm.emit(TIMED_METADATA_CHANGED, hlsEvent());

    expect(sm.processMetadata).not.toHaveBeenCalled();
    const warnings = nrvideo.Log.warn.mock.calls
      .map(([first]) => String(first))
      .filter((m) => m.includes('matched no DAI payloads'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/HLS/);
  });

  it('stays quiet while only a few events have been seen', () => {
    // Below the threshold this is indistinguishable from stream startup.
    const pm = makePlayerManager();
    forwardDaiMetadata(pm, makeStreamManager());

    for (let i = 0; i < 5; i += 1) pm.emit(TIMED_METADATA_CHANGED, hlsEvent());

    expect(nrvideo.Log.warn).not.toHaveBeenCalled();
  });

  it('never warns once anything has matched', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();
    forwardDaiMetadata(pm, sm);

    pm.emit(TIMED_METADATA_CHANGED, realEvent());
    for (let i = 0; i < 40; i += 1) pm.emit(TIMED_METADATA_CHANGED, hlsEvent());

    expect(sm.processMetadata).toHaveBeenCalledTimes(1);
    expect(nrvideo.Log.warn).not.toHaveBeenCalled();
  });

  it('does not throw into CAF dispatch when the payload shape is unexpected', () => {
    // extractDaiPayload walks four levels of a third-party object, so it has
    // to sit inside the try, not outside it.
    const pm = makePlayerManager();
    forwardDaiMetadata(pm, makeStreamManager());

    const hostile = { get timedMetadataInfo () { throw new Error('getter exploded'); } };
    expect(() => pm.emit(TIMED_METADATA_CHANGED, hostile)).not.toThrow();
  });
});

describe('forwardDaiMetadata is NOT idempotent', () => {
  // Registering twice hands the SDK every event twice and doubles every
  // AD_QUARTILE reaching New Relic — the failure this helper exists to prevent.
  // It does not guard against that, so the behaviour is pinned here rather than
  // left to be discovered: callers must register exactly once per
  // StreamManager, as samples/dai/index.html does inside `if (!daiTracker)`.
  it('registers a second handler when called twice, doubling every forward', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();

    forwardDaiMetadata(pm, sm);
    forwardDaiMetadata(pm, sm);
    pm.emit(TIMED_METADATA_CHANGED, realEvent());

    expect(sm.processMetadata).toHaveBeenCalledTimes(2);
  });

  it('disposing one registration leaves the other forwarding', () => {
    const pm = makePlayerManager();
    const sm = makeStreamManager();

    const disposeFirst = forwardDaiMetadata(pm, sm);
    forwardDaiMetadata(pm, sm);
    disposeFirst();
    pm.emit(TIMED_METADATA_CHANGED, realEvent());

    expect(sm.processMetadata).toHaveBeenCalledTimes(1);
  });
});
