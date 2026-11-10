import CAFTracker from './tracker'
import CAFDaiTracker from './dai'
import forwardDaiMetadata from './forwardDaiMetadata'

// Same static attach as src/index.js, so a consumer that only takes the
// default export finds the DAI tracker at CAFTracker.CAFDaiTracker and the
// live-metadata forwarder at CAFTracker.forwardDaiMetadata here too.
CAFTracker.CAFDaiTracker = CAFDaiTracker
CAFTracker.forwardDaiMetadata = forwardDaiMetadata

export default CAFTracker
export { CAFTracker, CAFDaiTracker, forwardDaiMetadata }
