# Calendar Integration Issue Report for GNOME At A Glance Extension

## Executive Summary

This document provides a comprehensive analysis of calendar integration challenges in the GNOME At A Glance extension, specifically for feeding calendar data to Claude AI for intelligent contextual decision-making. The primary goal is reliable extraction of calendar events from GNOME's calendar infrastructure, with UI display being secondary.

## Primary Objective

**Main Goal**: Extract calendar data to feed Claude AI for intelligent prioritization and contextual information display.

**Secondary Goal**: Display next calendar event in extension dropdown with time, or "all done for today!" if no events remain.

**Specific Requirements**:
1. Show next event on calendar for today with time
2. Display "all done for today!" when no events remain for the day
3. Prioritize by time proximity
4. Exclude holidays and birthdays/anniversaries
5. Feed contextual data to Claude AI for decision-making

## Technical Context

### Project Architecture
- **GNOME Shell Extension**: JavaScript-based extension for GNOME Shell 48
- **Calendar Sources**: Google Calendar, local calendars, CalDAV sources synced through GNOME Online Accounts
- **Data Flow**: Calendar → Extension → Claude AI → Prioritized Display
- **Build System**: Nix Flakes with NixOS integration

### Current Implementation State
- **File**: `calendar-integration.js` - Contains calendar integration logic
- **Main Extension**: `extension.js` - Coordinates data collection from multiple sources
- **Status**: Non-functional - calendar events not being retrieved

## Technical Approaches Attempted

### Approach 1: Direct Evolution Data Server (EDS) Integration
**Method**: Direct ECal library integration with S-expression queries
**Status**: Failed due to query format errors

**Code Pattern**:
```javascript
const ECal = imports.gi.ECal;
const calendar = ECal.Calendar.new(source, ECal.CalClientSourceType.EVENTS);
const query = "(occur-in-time-range? (make-time \"2024-12-10T00:00:00Z\") (make-time \"2024-12-10T23:59:59Z\"))";
```

**Errors Encountered**:
- `"make-time" expects the first argument to be an ISO 8601 date/time string`
- S-expression syntax validation failures
- EDS backend connection issues

### Approach 2: GNOME Shell CalendarServer D-Bus Integration (Current)
**Method**: D-Bus proxy to GNOME Shell's internal CalendarServer
**Status**: Partially implemented but with module loading errors

**Current Implementation**:
```javascript
const CalendarServerIface = `
<node>
    <interface name="org.gnome.Shell.CalendarServer">
        <method name="SetTimeRange">
            <arg type="x" name="since" direction="in"/>
            <arg type="x" name="until" direction="in"/>
            <arg type="b" name="force_reload" direction="in"/>
        </method>
        <signal name="EventsAddedOrUpdated">
            <arg type="a(ssxxa{sv})" name="events" direction="out"/>
        </signal>
    </interface>
</node>`;
```

**Current Error**: `ReferenceError: DataCollector is not defined` in extension.js:1

## Module Loading Architecture

### Current File Structure
- **extension.js**: Main extension with DataCollector object
- **calendar-integration.js**: Separate module for calendar integration
- **Import Pattern**: `calendar-integration.js` is imported into `extension.js`

### Module Loading Error Details
**Error**: `ReferenceError: DataCollector is not defined`
**Location**: extension.js:1
**Context**: Module loading order issue where calendar-integration.js attempts to reference DataCollector before it's defined

### Integration Pattern
The extension uses a DataCollector object pattern:
```javascript
const DataCollector = {
    async getCalendarEvents() {
        // Fallback implementation
        return [];
    },
    // Other data collection methods...
};
```

Calendar integration is supposed to override this method but fails due to module loading issues.

## Research Findings from External Agents

Based on research from other agents, the recommended approach is:
1. **Use GNOME Shell's CalendarServer D-Bus interface** rather than direct EDS integration
2. **Leverage existing GNOME Calendar infrastructure** for data access
3. **Follow GNOME Shell extension best practices** for calendar integration

## Dependencies and Environment

### Required System Packages
- evolution-data-server
- gnome-calendar
- gnome-online-accounts
- glib-networking
- libsoup_2_4
- json-glib
- libsecret

### GJS Library Imports
```javascript
const { St, Clutter, GLib, Gio, Soup, Secret, EDataServer, ECal, ICalGLib } = imports.gi;
```

### Calendar Sources Configuration
- Google Calendar (via GNOME Online Accounts)
- Local calendars
- CalDAV sources
- Configured through GNOME Settings → Online Accounts

## Specific Technical Challenges

### 1. S-Expression Query Format
**Problem**: EDS requires specific S-expression syntax for date/time queries
**Failed Attempts**: Various ISO 8601 format attempts
**Error**: Query format validation failures

### 2. D-Bus Interface Definition
**Problem**: XML markup errors in D-Bus interface definitions
**Solution Applied**: Wrapped `<interface>` in `<node>` tags
**Status**: XML parsing resolved but integration still failing

### 3. Module Loading Order
**Problem**: DataCollector reference error during module initialization
**Impact**: Extension fails to load completely
**Current Status**: Unresolved

### 4. Event Data Processing
**Challenge**: Converting raw calendar data to AI-consumable format
**Requirement**: Filter out holidays/birthdays, prioritize by time proximity
**Status**: Not yet implemented due to data retrieval issues

## AI Integration Requirements

### Data Format for Claude AI
Calendar events should be processed into contextual information for AI analysis:
- **Event timing**: Relative to current time
- **Event priority**: Based on proximity and importance
- **Context relevance**: How events relate to current user activity
- **Scheduling implications**: Impact on availability and planning

### Cost Optimization
- Smart caching (1-hour duration)
- Rate limiting (24 requests/day)
- Fallback summaries when API unavailable
- Target: Under $0.30/month operational cost

## Immediate Technical Requirements

### 1. Resolve Module Loading Error
**Priority**: Critical
**Issue**: `ReferenceError: DataCollector is not defined`
**Required**: Fix import/initialization order in extension.js

### 2. Implement Reliable Calendar Data Extraction
**Priority**: High
**Requirement**: Working calendar event retrieval from GNOME's calendar infrastructure
**Success Criteria**: Return array of today's events with titles, times, and metadata

### 3. Event Filtering Logic
**Priority**: Medium
**Requirement**: Exclude holidays, birthdays, anniversaries
**Implementation**: Pattern matching or calendar source filtering

### 4. AI Data Formatting
**Priority**: Medium
**Requirement**: Structure calendar data for Claude AI consumption
**Format**: JSON with event context, timing, and relevance scoring

## Debugging and Testing

### Current Extension Status
- **Installation**: Local development via Nix flake
- **Loading**: Fails with module reference error
- **Logs**: Available via `journalctl -f -o cat /usr/bin/gnome-shell`
- **Restart Required**: After each code change

### Testing Requirements
- **Functional Test**: Retrieve actual calendar events from user's GNOME Calendar
- **Data Format Test**: Verify event data structure for AI consumption
- **Performance Test**: Ensure minimal impact on GNOME Shell performance
- **Error Handling**: Graceful degradation when calendar unavailable

## Research Recommendations

### Priority 1: Module Loading Resolution
Investigate GNOME Shell extension module loading patterns and resolve DataCollector reference error. This is blocking all other calendar integration work.

### Priority 2: Verified Calendar Integration Method
Research and implement a proven method for accessing GNOME Calendar data from extensions, with preference for:
1. Official GNOME Shell APIs
2. Documented D-Bus interfaces
3. Community-verified approaches

### Priority 3: Event Data Processing Pipeline
Design efficient processing of raw calendar events into AI-consumable contextual information, including filtering and prioritization logic.

## Success Criteria

1. **Functional calendar data retrieval** from user's configured calendar sources
2. **Proper event filtering** excluding holidays and birthdays
3. **Contextual data formatting** suitable for Claude AI analysis
4. **Reliable module loading** without reference errors
5. **Performance optimization** with minimal GNOME Shell impact
6. **Cost-effective operation** within AI API budget constraints

## Current Blockers

1. **Critical**: Module loading error preventing extension initialization
2. **High**: No working calendar data retrieval method
3. **Medium**: Missing event filtering and AI data formatting logic

This document serves as a comprehensive briefing for research agents to identify verified, working solutions for GNOME Calendar integration in GNOME Shell extensions, with specific focus on reliable data extraction for AI processing rather than display-only functionality.