/**
 * How far to move a line of the bar so that its digits, not its font's box, sit in the middle, level with
 * the icons. React Native lays a line out from its font's ascent and descent, and some system fonts are far
 * from even there: after ZUI 17.0.254 on a Lenovo Tab M11 the battery percent stood 8 pixels above the
 * battery and Wi-Fi icons. Digits stand on the baseline and reach the cap height.
 */
export function digitsShift(line: { y: number; height: number; baseline: number; capHeight: number }): number {
  if (!(line.height > 0) || !(line.capHeight > 0)) return 0;
  const middle = line.y + line.height / 2;
  const digitsMiddle = line.baseline - line.capHeight / 2;
  return Math.round((middle - digitsMiddle) * 10) / 10;
}
