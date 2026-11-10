import CAFTracker, { CAFAdsTracker } from './tracker'
import CAFDaiTracker from './dai'
import forwardDaiMetadata from './forwardDaiMetadata'

// The UMD bundle is built from this entry with `libraryExport: 'default'`, so
// window.CAFTracker IS this class and named exports are unreachable there.
// Attaching these to it is what makes window.CAFTracker.CAFDaiTracker and
// window.CAFTracker.forwardDaiMetadata work for browser-global consumers.
CAFTracker.CAFDaiTracker = CAFDaiTracker
CAFTracker.forwardDaiMetadata = forwardDaiMetadata

export default CAFTracker
export { CAFTracker, CAFAdsTracker, CAFDaiTracker, forwardDaiMetadata }
