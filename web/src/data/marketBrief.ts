import september16 from './briefs/2026-09-16.md?raw';
import september7 from './briefs/2026-09-07.md?raw';
import september5 from './briefs/2026-09-05.md?raw';
import august25 from './briefs/2026-08-25.md?raw';
import { parseDailyBrief } from '../lib/dailyBrief';

// Dated offline fallbacks. New daily publications load from the public brief feed.
export const dailyBriefs = [
  parseDailyBrief('The Fed restarts tightening; breadth weakens.', september16),
  parseDailyBrief('Inflation pressure, resilient AI hardware', september7),
  parseDailyBrief('Strong jobs. Higher oil. Narrow leadership.', september5),
  parseDailyBrief('Relief in rates and oil. The next test is earnings.', august25),
].sort((a, b) => b.generated.localeCompare(a.generated));
