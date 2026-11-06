import CAFTracker from './tracker'
import CAFDaiTracker from './dai'

// Same static attach as src/index.js, so a consumer that only takes the
// default export finds the DAI tracker at CAFTracker.CAFDaiTracker here too.
CAFTracker.CAFDaiTracker = CAFDaiTracker

export default CAFTracker
export { CAFTracker, CAFDaiTracker }
