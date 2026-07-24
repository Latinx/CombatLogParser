export default function parseDateTime(dateTime) {
  // Example input: 7/10/2026 18:13:53.145-4
  // Date format: M/D/YYYY or MM/DD/YYYY
  // Time format: HH:MM:SS.mmm±TZ (timezone offset like -4, -05:00, +02:00)
  const dateTimeSeparatorIndex = dateTime.indexOf(' ');
  const date = dateTime.substr(0, dateTimeSeparatorIndex);
  const time = dateTime.substr(dateTimeSeparatorIndex + 1);

  const dateParts = date.split('/');
  const month = parseInt(dateParts[0], 10);
  const day = parseInt(dateParts[1], 10);
  const year = parseInt(dateParts[2], 10);

  // Time has timezone offset at the end, find where the milliseconds end
  // Time format: HH:MM:SS.mmm±TZ or HH:MM:SS.mmm
  const timeMatch = time.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-]\d{1,2}(?::?\d{2})?)?$/);
  if (!timeMatch) {
    throw new Error(`Invalid time format: ${time}`);
  }

  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const second = parseInt(timeMatch[3], 10);
  const millisecond = parseInt(timeMatch[4], 10);
  const tzOffset = timeMatch[5];

  // Create date in UTC then adjust for timezone offset
  const dateObj = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));

  if (tzOffset) {
    // Parse timezone offset (e.g., -4, -05:00, +02:00)
    const sign = tzOffset[0] === '-' ? -1 : 1;
    const offsetParts = tzOffset.substring(1).split(':');
    const offsetHours = parseInt(offsetParts[0], 10);
    const offsetMinutes = offsetParts[1] ? parseInt(offsetParts[1], 10) : 0;
    const totalOffsetMinutes = sign * (offsetHours * 60 + offsetMinutes);
    // Adjust date by timezone offset to get UTC
    dateObj.setMinutes(dateObj.getMinutes() - totalOffsetMinutes);
  }

  return dateObj;
}