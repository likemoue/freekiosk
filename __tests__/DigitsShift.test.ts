import { digitsShift } from '../src/utils/digitsShift';

describe('digitsShift', () => {
  it('leaves alone a font whose digits already sit in the middle of the line', () => {
    // A box of 16 with the baseline at 12 and digits 8 high: their middle is 8, the box's 8
    expect(digitsShift({ y: 0, height: 16, baseline: 12, capHeight: 8 })).toBe(0);
  });

  it('moves down digits a font sets high in their line', () => {
    // As on a Lenovo Tab M11 after ZUI 17.0.254: a deep descent, the digits above the middle
    expect(digitsShift({ y: 0, height: 20, baseline: 12, capHeight: 8 })).toBe(2);
  });

  it('moves up digits a font sets low', () => {
    expect(digitsShift({ y: 0, height: 16, baseline: 15, capHeight: 8 })).toBe(-3);
  });

  it('does nothing without the measures', () => {
    expect(digitsShift({ y: 0, height: 0, baseline: 12, capHeight: 8 })).toBe(0);
    expect(digitsShift({ y: 0, height: 16, baseline: 12, capHeight: 0 })).toBe(0);
  });
});
