# Evolution Data Server (EDS) API Research Findings

## Summary
Research conducted to fix calendar event retrieval issues in GNOME Shell extension. The main issue was using an undefined variable `until` instead of properly defined time range variables, plus timezone handling improvements.

## Key Issues Identified

### 1. **Primary Bug: Undefined Variable**
- **Problem**: Line 52 used undefined variable `until` instead of properly calculated `endOfDay`
- **Error**: "make-time" expects the first argument to be an ISO 8601 date/time string
- **Fix**: Corrected variable references and time range calculation

### 2. **Timezone Handling**
- **Problem**: Direct ISO8601 formatting without UTC conversion
- **Fix**: Use `.to_utc().format_iso8601()` for proper timezone handling
- **Reasoning**: EDS expects UTC timestamps in the make-time function

### 3. **Error Handling**
- **Problem**: No fallback when S-expression queries fail
- **Fix**: Added fallback using "#t" query with JavaScript filtering

## Correct EDS API Usage for GNOME Shell Extensions

### 1. **Query Format (S-Expressions)**
```javascript
// Time range query (preferred)
const query = `(occur-in-time-range? (make-time "${startISO}") (make-time "${endISO}"))`;

// Get all events (fallback)
const query = "#t";
```

**Source**: Based on official GNOME Shell calendar server implementation:
```c
query = g_strdup_printf("occur-in-time-range? (make-time \"%s\") "
                        "(make-time \"%s\")",
                        since_iso8601,
                        until_iso8601);
```

### 2. **Time Handling Best Practices**
```javascript
// Correct approach
const now = GLib.DateTime.new_now_local();
const until = now.add_hours(24);
const startISO = now.to_utc().format_iso8601().split('.')[0] + 'Z';
const endISO = until.to_utc().format_iso8601().split('.')[0] + 'Z';
```

**Key Points**:
- Always convert to UTC before formatting
- Remove microseconds from ISO string (split on '.')
- Add 'Z' suffix for UTC designation

### 3. **API Method Usage**
```javascript
// Primary method
client.get_object_list(query, null, callback)

// Alternative for synchronous operations
client.get_object_list_as_comps_sync(query, null)
```

### 4. **S-Expression Functions Available**
Based on EDS source code analysis:
- `make-time "ISO8601_STRING"` - Convert ISO8601 string to time
- `occur-in-time-range? START_TIME END_TIME` - Check if event occurs in range
- `time-now` - Current time
- `time-day-begin TIME` - Beginning of day for given time
- `time-day-end TIME` - End of day for given time
- `time-add-day TIME DAYS` - Add days to time

## Common Pitfalls and Solutions

### 1. **Timezone Issues**
- **Problem**: Using local time directly in make-time
- **Solution**: Always convert to UTC first
- **Example**: `dateTime.to_utc().format_iso8601()`

### 2. **Microsecond Precision**
- **Problem**: EDS may not handle microseconds in ISO strings
- **Solution**: Strip microseconds with `.split('.')[0] + 'Z'`

### 3. **Error Handling**
- **Problem**: S-expression queries can fail silently
- **Solution**: Implement fallback with "#t" query and JavaScript filtering

### 4. **Variable Naming**
- **Problem**: Using undefined variables in complex async functions
- **Solution**: Careful variable scoping and consistent naming

## Alternative Approaches

### 1. **Simple Query with JavaScript Filtering**
```javascript
// Get all events, filter in JavaScript
const query = "#t";
// Then filter events by time range in JavaScript
const nowUnix = now.to_unix();
const untilUnix = until.to_unix();
const filteredEvents = events.filter(event => 
    event.startTime < untilUnix && event.endTime > nowUnix
);
```

### 2. **Relative Time Queries**
```javascript
// Use EDS built-in time functions
const query = "(occur-in-time-range? (time-now) (time-add-day (time-now) 1))";
```

## Working Example Implementation

The updated `/home/tom/git/gnome-at-a-glance/calendar-integration.js` now includes:

1. **Fixed variable references** (using `until` instead of undefined variable)
2. **Proper UTC conversion** for timestamps
3. **Fallback error handling** with "#t" query
4. **JavaScript filtering** for fallback case
5. **Enhanced logging** for debugging

## Integration Points for GNOME Shell Extensions

### Required Dependencies
```javascript
const EDataServer = imports.gi.EDataServer;
const ECal = imports.gi.ECal;
const ICalGLib = imports.gi.ICalGLib;
```

### System Requirements
- evolution-data-server package
- gnome-calendar (for calendar data access)
- gnome-online-accounts (for Google/CalDAV accounts)

### Error Handling Strategy
1. Try S-expression time range query first
2. Fall back to "#t" query if S-expression fails
3. Filter results in JavaScript for fallback case
4. Provide meaningful error logging at each step

## Testing Recommendations

1. **Test with different calendar sources**: Google Calendar, local calendars, CalDAV
2. **Test timezone edge cases**: Events across timezone boundaries
3. **Test error conditions**: Network failures, disabled calendars
4. **Test with recurring events**: Ensure recurrence is handled properly
5. **Test performance**: Large calendars with many events

This implementation should resolve the "make-time" expects ISO 8601 date/time string error and provide robust calendar event retrieval for the GNOME At A Glance extension.