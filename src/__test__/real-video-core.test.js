/**
 * The ONLY suite that runs against the real video-core.
 *
 * jest.config.js maps @newrelic/video-core to a vendor stub, and every other
 * suite layers its own inline jest.mock on top. Those fakes are MORE PERMISSIVE
 * than the real base: their send* methods have no preconditions, sendEnd() does
 * not reset flags, and sendAdBreakEnd() leaves isRequested alone. So the whole
 * suite counts INVOCATIONS and cannot see video-core's gating — which is the
 * entire class of bug this integration is about. A review named eleven tests
 * that pass regardless of production correctness for this reason.
 *
 * This file bypasses the mapper by requiring a different specifier, and asserts
 * on events that were actually EMITTED, not on calls that were made.
 */
jest.mock('@newrelic/video-core', () => require('@newrelic/video-core/browser'));

import nrvideo from '@newrelic/video-core';
import CAFTracker from '../tracker';
import CAFDaiTracker from '../dai';

const SE = {
  AD_BREAK_STARTED: 'adBreakStarted', AD_BREAK_ENDED: 'adBreakEnded',
  AD_PERIOD_STARTED: 'adPeriodStarted', AD_PERIOD_ENDED: 'adPeriodEnded',
  LOADED: 'loaded', STREAM_INITIALIZED: 'streamInitialized', ERROR: 'error',
  STARTED: 'started', FIRST_QUARTILE: 'firstQuartile', MIDPOINT: 'midpoint',
  THIRD_QUARTILE: 'thirdQuartile', COMPLETE: 'complete', SKIPPED: 'skipped',
  PAUSED: 'paused', RESUMED: 'resumed', CLICK: 'click', VIDEO_CLICKED: 'videoClicked',
  CUEPOINTS_CHANGED: 'cuepointsChanged',
};

beforeEach(() => {
  // Real Core would start harvesting and a heartbeat; neither is under test.
  nrvideo.Core.addTracker = jest.fn();
  global.google = { ima: { dai: { api: { StreamEvent: { Type: SE } } } } };
  global.cast = {
    framework: {
      events: {
        EventType: {
          REQUEST_FOCUS_STATE: 'requestFocusState', PLAYER_LOADING: 'playerLoading',
          LOADED_METADATA: 'loadedMetadata', REQUEST_PLAY: 'requestPlay',
          PLAYING: 'playing', PLAY: 'play', PAUSE: 'pause', BUFFERING: 'buffering',
          BITRATE_CHANGED: 'bitrateChanged', SEEKING: 'seeking', SEEKED: 'seeked',
          ERROR: 'error', MEDIA_STATUS: 'mediaStatus', MEDIA_FINISHED: 'mediaFinished',
          BREAK_STARTED: 'breakStarted', BREAK_ENDED: 'breakEnded',
          BREAK_CLIP_LOADING: 'breakClipLoading', BREAK_CLIP_STARTED: 'breakClipStarted',
          BREAK_CLIP_ENDED: 'breakClipEnded', TIME_UPDATE: 'timeUpdate',
        },
        DetailedErrorCode: {},
      },
    },
    player: { api: { VERSION: 'test' } },
  };
});

function streamManager() {
  const l = {};
  return {
    addEventListener: (t, cb) => { l[t] = cb; },
    removeEventListener: (t, cb) => { if (l[t] === cb) delete l[t]; },
    contentTimeForStreamTime: (t) => t,
    emit: (t, e) => { if (l[t]) l[t](e); },
  };
}

const playerManager = () => ({
  addEventListener: () => {}, removeEventListener: () => {},
  getCurrentTimeSec: () => 10, getDurationSec: () => 600,
  getStats: () => ({ streamBandwidth: 512000 }),
  getPlayerState: () => 'PLAYING', getLiveSeekableRange: () => null,
  getPlaybackRate: () => 1, getPreferredTextLanguage: () => 'en',
  getMediaInformation: () => ({}),
});

const ad = (id) => ({
  getAdId: () => id, getCreativeId: () => 'c-' + id, getDuration: () => 15,
  getTitle: () => 'ad ' + id,
  getAdPodInfo: () => ({ getPodIndex: () => 0, getTotalAds: () => 2 }),
});

/** A real CAFTracker with a real CAFDaiTracker funnelling into it. */
function rig() {
  const pm = playerManager();
  const content = new CAFTracker({ getPlayerManager: () => pm, getSenders: () => [] }, { info: {} });
  const sm = streamManager();
  const dai = new CAFDaiTracker(sm, { playerManager: pm, contentTracker: content });
  content.setAdsTracker(dai);

  const emitted = [];
  content.on('*', (e) => emitted.push(e.type));
  return { sm, content, dai, emitted };
}

describe('real video-core gating — per-ad request', () => {
  it('emits AD_START for EVERY ad in a pod, not just the first', () => {
    // THE headline fix of this integration. video-core's goStart() requires
    // isRequested and goEnd() clears it, so without a request per ad only the
    // first AD_START would ever be emitted. The existing test for this counts
    // sendStart() INVOCATIONS against a no-op mock and therefore cannot tell
    // "two emitted" from "two swallowed".
    const { sm, emitted } = rig();

    sm.emit(SE.AD_BREAK_STARTED, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a1') });
    sm.emit(SE.COMPLETE, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a2') });
    sm.emit(SE.COMPLETE, {});
    sm.emit(SE.AD_BREAK_ENDED, {});

    expect(emitted.filter((t) => t === 'AD_REQUEST')).toHaveLength(2);
    expect(emitted.filter((t) => t === 'AD_START')).toHaveLength(2);
    expect(emitted.filter((t) => t === 'AD_END')).toHaveLength(2);
    expect(emitted.filter((t) => t === 'AD_BREAK_START')).toHaveLength(1);
    expect(emitted.filter((t) => t === 'AD_BREAK_END')).toHaveLength(1);
  });

  it('emits exactly three quartiles per ad', () => {
    const { sm, emitted } = rig();

    sm.emit(SE.AD_BREAK_STARTED, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a1') });
    sm.emit(SE.FIRST_QUARTILE, {});
    sm.emit(SE.MIDPOINT, {});
    sm.emit(SE.THIRD_QUARTILE, {});
    sm.emit(SE.COMPLETE, {});

    expect(emitted.filter((t) => t === 'AD_QUARTILE')).toHaveLength(3);
  });

  it('emits no quartile for an ad whose start never arrived', () => {
    // Joining a live stream mid-break. Proven here against real gating rather
    // than against a no-op send.
    const { sm, emitted } = rig();

    sm.emit(SE.AD_BREAK_STARTED, {});
    sm.emit(SE.FIRST_QUARTILE, {});
    sm.emit(SE.MIDPOINT, {});

    expect(emitted.filter((t) => t === 'AD_QUARTILE')).toHaveLength(0);
  });
});

describe('real video-core gating — an open ad transition at ad end', () => {
  it('emits AD_SEEK_END before AD_END, which resetFlags() would otherwise lose', () => {
    // goEnd() calls resetFlags(), clearing isSeeking. Closing after the end
    // therefore emits NOTHING, leaving the AD_SEEK_START unpaired forever.
    // This is the defect a previous fix claimed to solve by routing the close
    // to whichever tracker held the flag — by then nobody holds it.
    const { sm, dai, emitted } = rig();

    sm.emit(SE.AD_BREAK_STARTED, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a1') });
    dai.sendSeekStart();
    expect(emitted.filter((t) => t === 'AD_SEEK_START')).toHaveLength(1);

    sm.emit(SE.COMPLETE, {});

    expect(emitted.filter((t) => t === 'AD_SEEK_END')).toHaveLength(1);
    expect(emitted.indexOf('AD_SEEK_END')).toBeLessThan(emitted.indexOf('AD_END'));
  });

  it('pairs every ad-side open with a close across a whole pod', () => {
    const { sm, dai, emitted } = rig();

    sm.emit(SE.AD_BREAK_STARTED, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a1') });
    dai.sendBufferStart();
    sm.emit(SE.COMPLETE, {});
    sm.emit(SE.STARTED, { getAd: () => ad('a2') });
    dai.sendSeekStart();
    sm.emit(SE.AD_BREAK_ENDED, {});

    const count = (t) => emitted.filter((e) => e === t).length;
    expect(count('AD_BUFFER_START')).toBe(count('AD_BUFFER_END'));
    expect(count('AD_SEEK_START')).toBe(count('AD_SEEK_END'));
  });
});
