import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import parseDateTime from './parseDateTime.js';

describe('parseDateTime', () => {
  it('parses dates properly with year and timezone', () => {
    // WoW combat log format: M/D/YYYY HH:MM:SS.mmm±TZ
    assert.deepEqual(parseDateTime('7/10/2026 18:13:53.145-4'), new Date(Date.UTC(2026, 6, 10, 22, 13, 53, 145)));
    assert.deepEqual(parseDateTime('12/13/2026 21:58:49.757-5'), new Date(Date.UTC(2026, 11, 13, 26, 58, 49, 757)));
    assert.deepEqual(parseDateTime('1/13/2026 21:58:49.000+0'), new Date(Date.UTC(2026, 0, 13, 21, 58, 49, 0)));
    assert.deepEqual(parseDateTime('1/1/2026 00:00:00.000-4'), new Date(Date.UTC(2026, 0, 1, 4, 0, 0, 0)));
  });

  it('parses dates with timezone offset with minutes', () => {
    assert.deepEqual(parseDateTime('7/10/2026 18:13:53.145-05:00'), new Date(Date.UTC(2026, 6, 10, 23, 13, 53, 145)));
    assert.deepEqual(parseDateTime('7/10/2026 18:13:53.145+02:00'), new Date(Date.UTC(2026, 6, 10, 16, 13, 53, 145)));
  });

  it('parses dates without timezone', () => {
    assert.deepEqual(parseDateTime('7/10/2026 18:13:53.145'), new Date(Date.UTC(2026, 6, 10, 18, 13, 53, 145)));
  });
});
