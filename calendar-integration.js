// calendar-integration.js - GNOME Shell Calendar Server integration
const { Gio, GLib } = imports.gi;

// D-Bus interface for GNOME Shell Calendar Server
const CalendarServerIface = `
<interface name="org.gnome.Shell.CalendarServer">
    <method name="SetTimeRange">
        <arg type="x" name="since" direction="in"/>
        <arg type="x" name="until" direction="in"/>
        <arg type="b" name="force_reload" direction="in"/>
    </method>
    <signal name="EventsAddedOrUpdated">
        <arg type="a(ssxxa{sv})" name="events" direction="out"/>
    </signal>
    <signal name="EventsRemoved">
        <arg type="as" name="event_ids" direction="out"/>
    </signal>
    <property name="HasCalendars" type="b" access="read"/>
</interface>`;

const CalendarServerProxy = Gio.DBusProxy.makeProxyWrapper(CalendarServerIface);

const CalendarIntegration = {
    initialize() {
        try {
            log('At A Glance: Initializing GNOME Shell Calendar Server integration');
            
            // Connect to GNOME Shell Calendar Server
            this.calendarProxy = new CalendarServerProxy(
                Gio.DBus.session,
                'org.gnome.Shell.CalendarServer',
                '/org/gnome/Shell/CalendarServer'
            );
            
            // Connect to events signal
            this.eventsSignalId = this.calendarProxy.connectSignal(
                'EventsAddedOrUpdated',
                this._onEventsUpdated.bind(this)
            );
            
            // Store events cache
            this.cachedEvents = [];
            
            log('At A Glance: Calendar server connected successfully');
            return true;
            
        } catch (e) {
            log(`At A Glance: Failed to initialize calendar server: ${e}`);
            return false;
        }
    },

    async getUpcomingEvents(hoursAhead = 24) {
        if (!this.calendarProxy) {
            log('At A Glance: Calendar proxy not initialized');
            return [];
        }
        
        try {
            // Set time range for the calendar server
            const now = GLib.DateTime.new_now_local();
            const until = now.add_hours(hoursAhead);
            
            const sinceUnix = now.to_unix();
            const untilUnix = until.to_unix();
            
            log(`At A Glance: Setting calendar time range: ${sinceUnix} to ${untilUnix}`);
            
            // Request events for the time range
            await new Promise((resolve, reject) => {
                this.calendarProxy.SetTimeRangeRemote(
                    sinceUnix,
                    untilUnix, 
                    true, // force_reload
                    (result, error) => {
                        if (error) {
                            log(`At A Glance: Calendar SetTimeRange error: ${error}`);
                            reject(error);
                        } else {
                            log('At A Glance: Calendar time range set successfully');
                            resolve(result);
                        }
                    }
                );
            });
            
            // Return cached events (will be updated via signal)
            return this._filterEventsByTimeRange(this.cachedEvents, sinceUnix, untilUnix);
            
        } catch (e) {
            log(`At A Glance: Error getting calendar events: ${e}`);
            return [];
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

    _onEventsUpdated(proxy, sender, [events]) {
        try {
            log(`At A Glance: Received ${events.length} calendar events`);
            
            // Parse events from D-Bus format
            this.cachedEvents = events.map(event => this._parseEventFromDbus(event));
            
            // Log events for debugging
            this.cachedEvents.forEach(event => {
                log(`At A Glance: Calendar Event: ${event.summary} at ${event.timeString}`);
            });
            
        } catch (e) {
            log(`At A Glance: Error processing calendar events: ${e}`);
        }
    },

    _parseEventFromDbus(eventData) {
        try {
            // D-Bus event format: (string uid, string summary, int64 start_time, int64 end_time, GVariant extra_info)
            const [uid, summary, startTime, endTime, extraInfo] = eventData;
            
            // Parse extra info (properties)
            const properties = extraInfo || {};
            const location = properties['location'] ? properties['location'].unpack() : '';
            const description = properties['description'] ? properties['description'].unpack() : '';
            const isAllDay = properties['is-all-day'] ? properties['is-all-day'].unpack() : false;
            
            // Format times
            const startDateTime = GLib.DateTime.new_from_unix_local(startTime);
            const endDateTime = GLib.DateTime.new_from_unix_local(endTime);
            
            return {
                uid: uid,
                summary: summary,
                location: location,
                description: description,
                startTime: startTime,
                endTime: endTime,
                isAllDay: isAllDay,
                timeString: isAllDay ? 'All day' : startDateTime.format('%l:%M %p'),
                dateString: startDateTime.format('%A, %B %e'),
                duration: Math.round((endTime - startTime) / 60), // duration in minutes
            };
        } catch (e) {
            log(`At A Glance: Error parsing event: ${e}`);
            return null;
        }
    },

    _filterEventsByTimeRange(events, sinceUnix, untilUnix) {
        return events.filter(event => {
            // Event overlaps with time range if it starts before range ends and ends after range starts
            return event.startTime < untilUnix && event.endTime > sinceUnix;
        });
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
                duration: event.duration
            }
        };
    },

    destroy() {
        if (this.eventsSignalId) {
            this.calendarProxy.disconnectSignal(this.eventsSignalId);
            this.eventsSignalId = null;
        }
        this.calendarProxy = null;
        this.cachedEvents = [];
    }
};

// Updated DataCollector.getCalendarEvents() for the main extension
DataCollector.getCalendarEvents = async function() {
    try {
        // Initialize calendar integration if not already done
        if (!CalendarIntegration.calendarProxy) {
            const success = CalendarIntegration.initialize();
            if (!success) {
                log('At A Glance: Failed to initialize calendar integration');
                return [];
            }
        }
        
        // Get today's events
        const events = await CalendarIntegration.getTodaysEvents();
        
        log(`At A Glance: Found ${events.length} events for today`);
        
        // Format for the extension
        return events.map(event => ({
            time: event.timeString,
            title: event.summary,
            location: event.location,
            isAllDay: event.isAllDay,
            raw: event // Keep raw data for Claude
        }));
    } catch (e) {
        log(`At A Glance: Error getting calendar events: ${e}`);
        // Return empty array as fallback
        return [];
    }
};