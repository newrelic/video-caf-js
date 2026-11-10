import nrvideo from '@newrelic/video-core'

/**
 * The scheme URI Google DAI declares in the MPD's `<EventStream>`.
 *
 * Live DASH ad signalling is carried at MPD/Period level and parsed from the
 * manifest. Measured against the live asset: the MPD contains three
 * `<EventStream schemeIdUri="urn:google:dai:2018">` elements and ZERO
 * `<InbandEventStream>` tags, so there are no in-band `emsg` boxes to listen
 * for — which matches CAF never firing its EMSG event for this stream.
 */
const DAI_SCHEME_ID_URI = 'urn:google:dai:2018'

/**
 * The measured value of `EventType.TIMED_METADATA_CHANGED`. Used only as a
 * fallback when the `cast` global is not reachable — this module must not
 * import the CAF SDK, which stays receiver-provided.
 */
const TIMED_METADATA_CHANGED = 'TIMED_METADATA_CHANGED'

function resolveEventType () {
  // `typeof` first: optional chaining still throws a ReferenceError on an
  // identifier that was never declared, which is the case when this module is
  // loaded outside a receiver.
  const type =
    typeof cast === 'undefined'
      ? undefined
      : cast?.framework?.events?.EventType?.TIMED_METADATA_CHANGED

  return typeof type === 'string' && type ? type : TIMED_METADATA_CHANGED
}

/**
 * Pulls the DAI payload out of one CAF timed-metadata event.
 *
 * Measured shape (CAF 3.0.0157, Shaka 4.15.56, live DAI DASH):
 *
 *   event.timedMetadataInfo = {
 *     id: '0',
 *     startTime: 179480506.107,        // absolute STREAM time, in SECONDS
 *     endTime:   179480506.107,
 *     dashTimedMetadata: {
 *       schemeIdUri: 'urn:google:dai:2018',
 *       eventNode: { attributes: { messageData: 'google_3495521836947441448',
 *                                  presentationTime: '100', ... } }
 *     }
 *   }
 *
 * Two traps live in that shape:
 *
 *  1. `messageData` is NOT on `timedMetadataInfo`. It is three levels down, on
 *     `dashTimedMetadata.eventNode.attributes`. Forwarding the wrong level
 *     calls `processMetadata` with `undefined` and not one ad event ever
 *     fires — indistinguishable from not forwarding at all.
 *  2. `eventNode.attributes.presentationTime` is MPD-relative ('100') and is
 *     NOT the timestamp the SDK wants. The usable absolute value is
 *     `timedMetadataInfo.startTime`, already in stream seconds.
 *
 * @returns {{messageData: string, timestamp: number}|null} null when this
 *   event is not DAI's, or carries no usable data.
 */
function extractDaiPayload (event) {
  const info = event?.timedMetadataInfo
  const dash = info?.dashTimedMetadata

  if (dash?.schemeIdUri !== DAI_SCHEME_ID_URI) return null

  const messageData = dash?.eventNode?.attributes?.messageData
  if (typeof messageData !== 'string' || !messageData) return null

  const timestamp = info?.startTime
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null

  return { messageData, timestamp }
}

/**
 * Forwards CAF's DAI timed-metadata into the IMA DAI SDK.
 *
 * **Live DAI reports no ad events at all without this.** Measured on the live
 * asset: 124 s of playback with nothing forwarded produced a full content
 * lifecycle and ZERO ad events, while the manifest carried the DAI
 * `EventStream` the whole time. The signal was present and simply unconsumed —
 * `CAFDaiTracker` subscribes to StreamEvents, and the SDK only emits those once
 * it has been handed the metadata.
 *
 * On VOD this is harmless: cue points carry the breaks, so the VOD pre-roll
 * lifecycle works without it. Register it unconditionally rather than shipping
 * two integration snippets.
 *
 * Forwarding is the application's responsibility, not the library's — the
 * tracker never calls this and does not depend on it. It ships because the
 * payload shape above is easy to get wrong and SILENTLY wrong.
 *
 * **HLS is not covered.** CAF exposes `EventType.ID3` and an `hlsTimedMetadata`
 * sibling for HLS streams, but neither could be measured here: DAI's HLS output
 * does not play under Shaka 4.15.56, so the whole CAF lane was exercised on
 * DASH. Rather than guess at a payload shape, this helper handles the measured
 * DASH path only and warns when it sees nothing. A receiver serving live DAI
 * **HLS** still needs that arm written against a real device.
 *
 * @param {object} playerManager A cast.framework.player.PlayerManager.
 * @param {object} streamManager A google.ima.dai.api.StreamManager.
 * @returns {() => void} Removes the subscription. Safe to call more than once.
 */
export default function forwardDaiMetadata (playerManager, streamManager) {
  const noop = () => {}

  if (typeof playerManager?.addEventListener !== 'function') {
    nrvideo.Log.warn(
      'forwardDaiMetadata: no PlayerManager to subscribe to; DAI ad events will not be reported on live streams'
    )
    return noop
  }

  if (typeof streamManager?.processMetadata !== 'function') {
    nrvideo.Log.warn(
      'forwardDaiMetadata: no StreamManager to forward to; DAI ad events will not be reported on live streams'
    )
    return noop
  }

  const eventType = resolveEventType()

  const handler = (event) => {
    const payload = extractDaiPayload(event)
    if (!payload) return

    try {
      streamManager.processMetadata(
        DAI_SCHEME_ID_URI,
        payload.messageData,
        payload.timestamp
      )
    } catch (error) {
      // This runs inside CAF's event dispatch, so it must not throw into the
      // receiver: an exception here would reach the player and can abort
      // playback outright.
      nrvideo.Log.warn('forwardDaiMetadata: processMetadata failed', error)
    }
  }

  playerManager.addEventListener(eventType, handler)

  return () => {
    try {
      playerManager.removeEventListener(eventType, handler)
    } catch (error) {
      nrvideo.Log.warn('forwardDaiMetadata: failed to remove listener', error)
    }
  }
}

export { DAI_SCHEME_ID_URI, TIMED_METADATA_CHANGED, extractDaiPayload }
