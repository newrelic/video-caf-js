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
  const castPresent = typeof cast !== 'undefined'
  const type = castPresent
    ? cast?.framework?.events?.EventType?.TIMED_METADATA_CHANGED
    : undefined

  if (typeof type === 'string' && type) return type

  // No `cast` at all is a legitimate quiet case (unit tests, a non-receiver
  // host). `cast` present but the constant gone is NOT: it means CAF renamed
  // the event, and the literal below would subscribe to something that never
  // fires — silently reporting no live ads forever.
  if (castPresent) {
    nrvideo.Log.warn(
      'forwardDaiMetadata: cast.framework.events.EventType.TIMED_METADATA_CHANGED is missing. ' +
      `Falling back to '${TIMED_METADATA_CHANGED}'; if CAF renamed it, no live ad events will be reported.`
    )
  }

  return TIMED_METADATA_CHANGED
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
 * **HLS is not covered, so the stream request must ask for DASH.** CAF exposes
 * `EventType.ID3` and an `hlsTimedMetadata` sibling for HLS streams, but
 * neither could be measured: DAI's HLS output does not play under Shaka
 * 4.15.56, so the whole CAF lane was exercised on DASH. Rather than guess at a
 * payload shape, this handles the measured DASH path only.
 *
 * That makes `streamRequest.format = 'dash'` a REQUIREMENT for live, not a
 * preference — IMA DAI defaults to HLS, and an HLS stream matches nothing
 * here. After seeing `NO_MATCH_THRESHOLD` timed-metadata events with no DAI
 * match, this logs one warning saying so, because the symptom otherwise is
 * simply an absence of ad events. A receiver serving live DAI **HLS** needs
 * the ID3 arm written against a real device.
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

  // Without these counters, three very different states are one indistinguishable
  // silence: "the stream signalled no ads", "this stream is HLS so nothing ever
  // matches", and "CAF moved the payload and every match now fails". All three
  // look like a stream that served no ads, which is the exact condition this
  // module exists to prevent being invisible.
  let seen = 0
  let forwarded = 0
  let warnedNoMatch = false

  // Enough events to be past stream startup without waiting for a break. The
  // live asset emits roughly one per second.
  const NO_MATCH_THRESHOLD = 20

  const handler = (event) => {
    seen += 1

    // The extract is INSIDE the try: it walks four levels of a third-party
    // payload, and this runs inside CAF's event dispatch, where an escaping
    // exception reaches the player and can abort playback outright.
    try {
      const payload = extractDaiPayload(event)

      if (payload) {
        forwarded += 1
        streamManager.processMetadata(
          DAI_SCHEME_ID_URI,
          payload.messageData,
          payload.timestamp
        )
        return
      }

      if (!warnedNoMatch && forwarded === 0 && seen >= NO_MATCH_THRESHOLD) {
        warnedNoMatch = true
        nrvideo.Log.warn(
          `forwardDaiMetadata: saw ${seen} timed-metadata events and matched no DAI payloads, ` +
          'so no live ad events will be reported. The likeliest cause is an HLS stream — this ' +
          'helper handles the DASH EventStream only — or a change to CAF\'s payload shape.'
        )
      }
    } catch (error) {
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
