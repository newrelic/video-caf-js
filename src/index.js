import CAFTracker, { CAFAdsTracker } from './tracker'
import CAFDaiTracker from './dai'

// The UMD bundle is built from this entry with `libraryExport: 'default'`, so
// window.CAFTracker IS this class and named exports are unreachable there.
// Attaching the DAI tracker to it is what makes window.CAFTracker.CAFDaiTracker
// work for browser-global consumers.
CAFTracker.CAFDaiTracker = CAFDaiTracker

export default CAFTracker
export { CAFTracker, CAFAdsTracker, CAFDaiTracker }
