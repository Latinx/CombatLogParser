import parseDateTime from './parseDateTime';

describe('parseDateTime', () => {
  it('parses dates properly with year and timezone', () => {
    // WoW combat log format: M/D/YYYY HH:MM:SS.mmm±TZ
    expect(parseDateTime('7/10/2026 18:13:53.145-4')).toEqual(new Date(Date.UTC(2026, 6, 10, 22, 13, 53, 145)));
    expect(parseDateTime('12/13/2026 21:58:49.757-5')).toEqual(new Date(Date.UTC(2026, 11, 13, 26, 58, 49, 757)));
    expect(parseDateTime('1/13/2026 21:58:49.000+0')).toEqual(new Date(Date.UTC(2026, 0, 13, 21, 58, 49, 0)));
    expect(parseDateTime('1/1/2026 00:00:00.000-4')).toEqual(new Date(Date.UTC(2026, 0, 1, 4, 0, 0, 0)));
  });

  it('parses dates with timezone offset with minutes', () => {
    expect(parseDateTime('7/10/2026 18:13:53.145-05:00')).toEqual(new Date(Date.UTC(2026, 6, 10, 23, 13, 53, 145)));
    expect(parseDateTime('7/10/2026 18:13:53.145+02:00')).toEqual(new Date(Date.UTC(2026, 6, 10, 16, 13, 53, 145)));
  });

  it('parses dates without timezone', () => {
    expect(parseDateTime('7/10/2026 18:13:53.145')).toEqual(new Date(Date.UTC(2026, 6, 10, 18, 13, 53, 145)));
  });
});