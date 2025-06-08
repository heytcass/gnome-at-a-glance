// calendar-integration.js - Proper EDS integration for the At A Glance extension
const { Gio, GLib } = imports.gi;
const EDataServer = imports.gi.EDataServer;
const ECal = imports.gi.ECal;
const ICalGLib = imports.gi.ICalGLib;

const CalendarIntegration = {
    async initialize() {
        try {
            // Create a new source registry
            this.registry = EDataServer.SourceRegistry.new_sync(null);
            
            // Get all calendar sources (includes Google, local, CalDAV, etc.)
            this.calendarSources = this.registry.list_sources(
                EDataServer.SOURCE_EXTENSION_CALENDAR
            );
            
            log(`Found ${this.calendarSources.length} calendar sources`);
            
            // List all available calendars (for debugging)
            this.calendarSources.forEach(source => {
                log(`Calendar: ${source.get_display_name()} - ${source.get_uid()}`);
            });
            
        } catch (e) {
            log(`Failed to initialize calendar integration: ${e}`);
        }
    },

    async getUpcomingEvents(hoursAhead = 24) {
        const events = [];
        const now = GLib.DateTime.new_now_local();
        const until = now.add_hours(hoursAhead);
        
        // Convert to ICal time
        const startTime = ICalGLib.Time.new_from_timet_with_zone(
            now.to_unix(),
            false,
            ICalGLib.Timezone.get_utc_timezone()
        );
        const endTime = ICalGLib.Time.new_from_timet_with_zone(
            until.to_unix(),
            false,
            ICalGLib.Timezone.get_utc_timezone()
        );

        for (const source of this.calendarSources) {
            // Skip disabled sources
            if (!source.get_enabled()) continue;
            
            // Skip task lists and other non-calendar sources
            const extension = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
            if (!extension) continue;

            try {
                // Open the calendar
                const client = await this._openCalendarClient(source);
                if (!client) continue;

                // Create query for events in time range
                const query = `(occur-in-time-range? (make-time "${startTime.as_ical_string()}") (make-time "${endTime.as_ical_string()}"))`;
                
                // Get events
                const [success, ecalcomps] = await new Promise((resolve) => {
                    client.get_object_list_as_comps(
                        startTime.as_ical_string(),
                        endTime.as_ical_string(),
                        null, // cancellable
                        (client, result) => {
                            try {
                                const [success, comps] = client.get_object_list_as_comps_finish(result);
                                resolve([success, comps]);
                            } catch (e) {
                                resolve([false, []]);
                            }
                        }
                    );
                });

                if (success && ecalcomps) {
                    ecalcomps.forEach(ecalcomp => {
                        const event = this._parseEvent(ecalcomp, source.get_display_name());
                        if (event) events.push(event);
                    });
                }

            } catch (e) {
                log(`Error reading calendar ${source.get_display_name()}: ${e}`);
            }
        }

        // Sort events by start time
        events.sort((a, b) => a.startTime - b.startTime);
        return events;
    },

    async _openCalendarClient(source) {
        return new Promise((resolve) => {
            ECal.Client.connect(
                source,
                ECal.ClientSourceType.EVENTS,
                10, // timeout in seconds
                null, // cancellable
                (source, result) => {
                    try {
                        const client = ECal.Client.connect_finish(result);
                        resolve(client);
                    } catch (e) {
                        log(`Failed to connect to calendar: ${e}`);
                        resolve(null);
                    }
                }
            );
        });
    },

    _parseEvent(ecalcomp, calendarName) {
        try {
            const icalcomp = ecalcomp.get_icalcomponent();
            const summary = icalcomp.get_summary();
            const location = icalcomp.get_location() || '';
            const description = icalcomp.get_description() || '';
            
            // Get start and end times
            const dtstart = icalcomp.get_dtstart();
            const dtend = icalcomp.get_dtend();
            
            const startTime = dtstart.as_timet();
            const endTime = dtend.as_timet();
            
            // Check if it's an all-day event
            const isAllDay = dtstart.is_date();
            
            // Format times
            const startDateTime = GLib.DateTime.new_from_unix_local(startTime);
            const endDateTime = GLib.DateTime.new_from_unix_local(endTime);
            
            return {
                summary: summary,
                location: location,
                description: description,
                calendarName: calendarName,
                startTime: startTime,
                endTime: endTime,
                isAllDay: isAllDay,
                timeString: isAllDay ? 'All day' : startDateTime.format('%l:%M %p'),
                dateString: startDateTime.format('%A, %B %e'),
                duration: Math.round((endTime - startTime) / 60), // duration in minutes
            };
        } catch (e) {
            log(`Error parsing event: ${e}`);
            return null;
        }
    },

    async getTodaysEvents() {
        const allEvents = await this.getUpcomingEvents(24);
        const today = GLib.DateTime.new_now_local();
        
        return allEvents.filter(event => {
            const eventDate = GLib.DateTime.new_from_unix_local(event.startTime);
            return eventDate.get_year() === today.get_year() &&
                   eventDate.get_month() === today.get_month() &&
                   eventDate.get_day_of_month() === today.get_day_of_month();
        });
    },

    async getNextEvent() {
        const events = await this.getUpcomingEvents(24);
        const now = GLib.DateTime.new_now_local().to_unix();
        
        // Find the next upcoming event that hasn't started yet
        return events.find(event => event.startTime > now);
    },

    // Format event for display
    formatEventForDisplay(event) {
        if (!event) return 'No upcoming events';
        
        const now = GLib.DateTime.new_now_local().to_unix();
        const minutesUntil = Math.round((event.startTime - now) / 60);
        
        let timeString;
        if (minutesUntil < 0) {
            timeString = 'Now';
        } else if (minutesUntil < 60) {
            timeString = `in ${minutesUntil}m`;
        } else if (minutesUntil < 120) {
            timeString = 'in 1h';
        } else {
            timeString = event.timeString;
        }
        
        return {
            short: `${event.summary} ${timeString}`,
            full: `${event.summary} at ${event.timeString}${event.location ? ` - ${event.location}` : ''}`,
            details: {
                summary: event.summary,
                time: timeString,
                location: event.location,
                calendar: event.calendarName,
                duration: event.duration
            }
        };
    }
};

// Updated DataCollector.getCalendarEvents() for the main extension
DataCollector.getCalendarEvents = async function() {
    try {
        // Initialize calendar integration if not already done
        if (!CalendarIntegration.registry) {
            await CalendarIntegration.initialize();
        }
        
        // Get today's events
        const events = await CalendarIntegration.getTodaysEvents();
        
        // Format for the extension
        return events.map(event => ({
            time: event.timeString,
            title: event.summary,
            location: event.location,
            calendar: event.calendarName,
            isAllDay: event.isAllDay,
            raw: event // Keep raw data for Claude
        }));
    } catch (e) {
        log(`Error getting calendar events: ${e}`);
        // Return empty array as fallback
        return [];
    }
};

// Example usage in the extension
async function demonstrateUsage() {
    // Initialize
    await CalendarIntegration.initialize();
    
    // Get next event
    const nextEvent = await CalendarIntegration.getNextEvent();
    if (nextEvent) {
        const formatted = CalendarIntegration.formatEventForDisplay(nextEvent);
        log(`Next: ${formatted.short}`);
    }
    
    // Get all events for today
    const todaysEvents = await CalendarIntegration.getTodaysEvents();
    log(`You have ${todaysEvents.length} events today`);
    
    todaysEvents.forEach(event => {
        log(`- ${event.summary} at ${event.timeString} (${event.calendarName})`);
    });
}