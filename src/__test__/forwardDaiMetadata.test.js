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
