import CAFTracker, { CAFDaiTracker } from '../index';

describe('CAFDaiTracker Index Export', () => {
  it('should export CAFDaiTracker as a named export', () => {
    expect(CAFDaiTracker).toBeDefined();
    expect(typeof CAFDaiTracker).toBe('function');
  });

  // The UMD bundle exposes only the default export (webpack `libraryExport:
  // 'default'`), so this static is the only way a browser-global consumer can
  // reach the DAI tracker — as window.CAFTracker.CAFDaiTracker.
  it('should attach CAFDaiTracker to the default export for UMD consumers', () => {
    expect(CAFTracker.CAFDaiTracker).toBe(CAFDaiTracker);
  });
});
