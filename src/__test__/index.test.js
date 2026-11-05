import { CAFDaiTracker } from '../index';

describe('CAFDaiTracker Index Export', () => {
  it('should export CAFDaiTracker as a named export', () => {
    expect(CAFDaiTracker).toBeDefined();
    expect(typeof CAFDaiTracker).toBe('function');
  });
});
