// calendar-integration.js - Calendar data collection for GNOME At A Glance
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Event filter for categorizing and filtering events
export class EventFilter {
    constructor() {
        this.holidayPattern = /\b(holiday|christmas|thanksgiving|easter|new year|memorial day|labor day|independence day|veterans day)\b/i;
        this.birthdayPattern = /\b(birthday|born|b-day|bday)\b/i;
        this.anniversaryPattern = /\b(anniversary|wedding|married)\b/i;
    }

    shouldExclude(event) {
        const title = event.title || event.summary || '';
        const description = event.description || '';
        const text = `${title} ${description}`.toLowerCase();
        
        return this.holidayPattern.test(text) || 
               this.birthdayPattern.test(text) || 
               this.anniversaryPattern.test(text);
    }

    categorizeEvent(event) {
        const title = event.title || event.summary || '';
        const description = event.description || '';
        const text = `${title} ${description}`.toLowerCase();
        
        // Work-related keywords
        const workKeywords = ['meeting', 'conference', 'call', 'standup', 'interview', 'presentation', 'deadline', 'project', 'work', 'office'];
        const hasWorkKeyword = workKeywords.some(keyword => text.includes(keyword));
        
        if (hasWorkKeyword) return 'work';
        
        // Personal keywords
        const personalKeywords = ['doctor', 'appointment', 'dentist', 'personal', 'family', 'dinner', 'lunch', 'gym', 'workout'];
        const hasPersonalKeyword = personalKeywords.some(keyword => text.includes(keyword));
        
        if (hasPersonalKeyword) return 'personal';
        
        return 'general';
    }
}

// Calendar data collector
export class CalendarDataCollector {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.eventFilter = new EventFilter();
    }

    async getCalendarEvents() {
        console.log('At A Glance: getCalendarEvents() called');
        const cacheKey = 'calendar_events';
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            console.log(`At A Glance: Using cached calendar data (${cached.data.length} events)`);
            return cached.data;
        }

        try {
            console.log('At A Glance: Starting calendar data collection...');
            const events = await this._collectCalendarData();
            console.log(`At A Glance: Collected ${events.length} raw events`);
            
            // Log all discovered events before filtering
            console.log(`At A Glance: === ALL DISCOVERED EVENTS ===`);
            for (const event of events) {
                console.log(`At A Glance: RAW EVENT: "${event.title}" | ${event.start} | ${event.source}`);
            }
            
            const filteredEvents = this._filterAndProcessEvents(events);
            console.log(`At A Glance: Filtered to ${filteredEvents.length} events`);
            
            // Log final filtered events
            console.log(`At A Glance: === FINAL FILTERED EVENTS ===`);
            for (const event of filteredEvents) {
                console.log(`At A Glance: FINAL EVENT: "${event.title}" | ${event.start} | ${event.source}`);
            }
            
            this.cache.set(cacheKey, {
                data: filteredEvents,
                timestamp: Date.now()
            });
            
            return filteredEvents;
        } catch (error) {
            console.error('At A Glance: Calendar collection error:', error);
            return [];
        }
    }

    async _collectCalendarData() {
        const events = [];
        
        // Method 1: GNOME Shell Calendar Server D-Bus (preferred)
        try {
            console.log('At A Glance: Attempting GNOME Shell Calendar Server integration...');
            const calendarServerEvents = await this._readCalendarServerData();
            events.push(...calendarServerEvents);
            console.log(`At A Glance: Calendar Server found ${calendarServerEvents.length} events`);
        } catch (error) {
            console.log('At A Glance: Calendar Server integration failed:', error);
        }
        
        // Method 2: SQLite fallback (if Calendar Server fails)
        if (events.length === 0) {
            try {
                console.log('At A Glance: Falling back to SQLite method...');
                const sqliteEvents = await this._readGnomeCalendarData();
                events.push(...sqliteEvents);
            } catch (error) {
                console.log('At A Glance: SQLite fallback failed:', error);
            }
        }
        
        return events;
    }

    async _readCalendarServerData() {
        const events = [];
        
        return new Promise((resolve, reject) => {
            try {
                console.log('At A Glance: Connecting to GNOME Shell Calendar Server...');
                
                // Create D-Bus proxy for calendar server
                const proxy = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SESSION,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    'org.gnome.Shell.CalendarServer',
                    '/org/gnome/Shell/CalendarServer',
                    'org.gnome.Shell.CalendarServer',
                    null
                );
                
                if (!proxy) {
                    throw new Error('Failed to create D-Bus proxy for calendar server');
                }
                
                console.log('At A Glance: Calendar Server proxy created successfully');
                
                // Check if calendar server has calendars available
                const hasCalendars = proxy.get_cached_property('HasCalendars');
                console.log(`At A Glance: Calendar Server HasCalendars: ${hasCalendars ? hasCalendars.unpack() : 'unknown'}`);
                
                // Set up time range (next 30 days)
                const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
                const thirtyDaysLater = now + (30 * 24 * 60 * 60);
                
                console.log(`At A Glance: Setting time range from ${now} to ${thirtyDaysLater}`);
                
                // Listen for events before setting time range
                const eventAddedSignalId = proxy.connectSignal('EventsAddedOrUpdated', (proxy, sender, [eventArray]) => {
                    console.log(`At A Glance: Received ${eventArray.length} events from Calendar Server`);
                    
                    for (const eventData of eventArray) {
                        try {
                            const event = this._processCalendarServerEvent(eventData);
                            if (event) {
                                events.push(event);
                                console.log(`At A Glance: Processed event: ${event.title}`);
                            }
                        } catch (error) {
                            console.log('At A Glance: Error processing calendar server event:', error);
                        }
                    }
                    
                    // Disconnect signal and resolve
                    proxy.disconnectSignal(eventAddedSignalId);
                    console.log(`At A Glance: Calendar Server integration complete - found ${events.length} events`);
                    resolve(events);
                });
                
                // Set time range to trigger event loading
                proxy.call(
                    'SetTimeRange',
                    GLib.Variant.new('(xxb)', [now, thirtyDaysLater, true]),
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (source, result) => {
                        try {
                            proxy.call_finish(result);
                            console.log('At A Glance: SetTimeRange call successful');
                            
                            // If no events are received within 2 seconds, resolve with empty array
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                                proxy.disconnectSignal(eventAddedSignalId);
                                console.log('At A Glance: Timeout reached, resolving with current events');
                                resolve(events);
                                return GLib.SOURCE_REMOVE;
                            });
                        } catch (error) {
                            console.log('At A Glance: SetTimeRange call failed:', error);
                            proxy.disconnectSignal(eventAddedSignalId);
                            reject(error);
                        }
                    }
                );
                
            } catch (error) {
                console.log('At A Glance: Calendar Server integration error:', error);
                reject(error);
            }
        });
    }

    _processCalendarServerEvent(eventData) {
        try {
            // Calendar server event structure: (uid, summary, start_time, end_time, properties)
            const [uid, summary, startTime, endTime, properties] = eventData;
            
            if (!summary || summary.trim() === '') {
                return null; // Skip events without summary
            }
            
            // Convert Unix timestamps to JavaScript dates
            const start = new Date(startTime * 1000);
            const end = new Date(endTime * 1000);
            const now = new Date();
            
            // Extract additional properties
            const description = properties.description ? properties.description.unpack() : '';
            const location = properties.location ? properties.location.unpack() : null;
            const isAllDay = properties.allDay ? properties.allDay.unpack() : false;
            
            // Create processed event object
            const event = {
                id: uid || `calendar_server_${Date.now()}`,
                title: summary,
                description: description,
                start: start.toISOString(),
                end: end.toISOString(),
                location: location,
                source: 'GNOME Calendar Server',
                features: {
                    isAllDay: isAllDay,
                    hasAttendees: false,
                    categories: [this.eventFilter.categorizeEvent({
                        title: summary,
                        description: description
                    })],
                    timeFeatures: {
                        isToday: this._isSameDay(start, now),
                        isTomorrow: this._isTomorrow(start, now),
                        isUpcoming: start > now,
                        minutesUntil: Math.floor((start - now) / (1000 * 60))
                    },
                    confidence: 1.0 // Highest confidence for calendar server data
                },
                processed: new Date().toISOString()
            };
            
            return event;
            
        } catch (error) {
            console.log('At A Glance: Error processing calendar server event:', error);
            return null;
        }
    }

    async _readEvolutionICS() {
        const events = [];
        const homeDir = GLib.get_home_dir();
        const calendarPath = `${homeDir}/.local/share/evolution/calendar/system/calendar.ics`;
        
        try {
            const file = Gio.File.new_for_path(calendarPath);
            if (!file.query_exists(null)) {
                console.log('At A Glance: Evolution calendar file not found');
                return events;
            }
            
            const [success, contents] = file.load_contents(null);
            if (!success) {
                console.log('At A Glance: Could not read Evolution calendar file');
                return events;
            }
            
            const icsContent = new TextDecoder().decode(contents);
            const parsedEvents = this._parseICSContent(icsContent);
            events.push(...parsedEvents);
            
            console.log(`At A Glance: Found ${parsedEvents.length} events in Evolution calendar`);
        } catch (error) {
            console.log('At A Glance: Error reading Evolution calendar:', error);
        }
        
        return events;
    }

    async _readGnomeCalendarData() {
        const events = [];
        const homeDir = GLib.get_home_dir();
        
        // Try to read from Evolution sources configuration
        const sourcesDir = `${homeDir}/.config/evolution/sources`;
        
        try {
            const sourcesDirectory = Gio.File.new_for_path(sourcesDir);
            if (!sourcesDirectory.query_exists(null)) {
                console.log('At A Glance: Evolution sources directory not found');
                return events;
            }
            
            const enumerator = sourcesDirectory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            
            while ((info = enumerator.next_file(null)) !== null) {
                const fileName = info.get_name();
                if (fileName.endsWith('.source')) {
                    const sourceEvents = await this._readSourceFile(sourcesDir, fileName);
                    events.push(...sourceEvents);
                }
            }
        } catch (error) {
            console.log('At A Glance: Error reading Evolution sources:', error);
        }
        
        return events;
    }

    async _readSourceFile(sourcesDir, fileName) {
        const events = [];
        
        try {
            const sourceFile = Gio.File.new_for_path(`${sourcesDir}/${fileName}`);
            const [success, contents] = sourceFile.load_contents(null);
            
            if (success) {
                const sourceContent = new TextDecoder().decode(contents);
                
                // Check if this is a calendar source
                if (sourceContent.includes('[Calendar]') && sourceContent.includes('Enabled=true')) {
                    console.log(`At A Glance: Found calendar source: ${fileName}`);
                    
                    // Try to find corresponding calendar data
                    const sourceEvents = await this._findCalendarDataForSource(fileName);
                    events.push(...sourceEvents);
                }
            }
        } catch (error) {
            console.log(`At A Glance: Error reading source ${fileName}:`, error);
        }
        
        return events;
    }

    async _findCalendarDataForSource(sourceFileName) {
        const events = [];
        const homeDir = GLib.get_home_dir();
        
        // Remove .source extension to get the source ID
        const sourceId = sourceFileName.replace('.source', '');
        
        // Try multiple potential locations for calendar data
        const possiblePaths = [
            `${homeDir}/.local/share/evolution/calendar/${sourceId}/calendar.ics`,
            `${homeDir}/.cache/evolution/calendar/${sourceId}/cache.db`,
            `${homeDir}/.local/share/evolution/calendar/${sourceId}.ics`
        ];
        
        // Also check all cache directories for any calendar data
        try {
            const cacheDir = `${homeDir}/.cache/evolution/calendar`;
            const cacheDirectory = Gio.File.new_for_path(cacheDir);
            if (cacheDirectory.query_exists(null)) {
                const enumerator = cacheDirectory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const dirName = info.get_name();
                    if (info.get_file_type() === Gio.FileType.DIRECTORY && dirName !== 'trash') {
                        possiblePaths.push(`${cacheDir}/${dirName}/cache.db`);
                    }
                }
            }
        } catch (error) {
            console.log('At A Glance: Error scanning cache directories:', error);
        }
        
        for (const path of possiblePaths) {
            try {
                const file = Gio.File.new_for_path(path);
                if (file.query_exists(null)) {
                    console.log(`At A Glance: Found calendar data at: ${path}`);
                    
                    if (path.endsWith('.ics')) {
                        const [success, contents] = file.load_contents(null);
                        if (success) {
                            const icsContent = new TextDecoder().decode(contents);
                            const parsedEvents = this._parseICSContent(icsContent);
                            events.push(...parsedEvents);
                            console.log(`At A Glance: Parsed ${parsedEvents.length} events from ${path}`);
                        }
                    } else if (path.endsWith('cache.db')) {
                        // Try to read SQLite database using subprocess
                        const dbEvents = await this._readSQLiteCalendarCache(path);
                        events.push(...dbEvents);
                        console.log(`At A Glance: Found ${dbEvents.length} events in SQLite cache ${path}`);
                    }
                }
            } catch (error) {
                console.log(`At A Glance: Error reading ${path}:`, error);
            }
        }
        
        return events;
    }

    _parseICSContent(icsContent) {
        const events = [];
        const lines = icsContent.split('\n');
        let currentEvent = null;
        
        console.log(`At A Glance: Parsing ICS content with ${lines.length} lines`);
        
        for (let line of lines) {
            line = line.trim();
            
            if (line === 'BEGIN:VEVENT') {
                currentEvent = {};
                console.log('At A Glance: Found BEGIN:VEVENT');
            } else if (line === 'END:VEVENT' && currentEvent) {
                console.log(`At A Glance: Found END:VEVENT - summary: ${currentEvent.summary}, dtstart: ${currentEvent.dtstart}`);
                if (currentEvent.summary && currentEvent.dtstart) {
                    events.push(this._processICSEvent(currentEvent));
                    console.log(`At A Glance: Successfully processed event: ${currentEvent.summary}`);
                } else {
                    console.log(`At A Glance: Skipping event - missing summary or dtstart`);
                }
                currentEvent = null;
            } else if (currentEvent && line.includes(':')) {
                const [keyPart, ...valueParts] = line.split(':');
                const value = valueParts.join(':');
                // Handle ICS properties with parameters like "DTSTART;VALUE=DATE"
                const key = keyPart.split(';')[0];
                
                switch (key) {
                    case 'SUMMARY':
                        currentEvent.summary = value;
                        break;
                    case 'DESCRIPTION':
                        currentEvent.description = value;
                        break;
                    case 'DTSTART':
                        currentEvent.dtstart = value;
                        break;
                    case 'DTEND':
                        currentEvent.dtend = value;
                        break;
                    case 'LOCATION':
                        currentEvent.location = value;
                        break;
                    case 'UID':
                        currentEvent.uid = value;
                        break;
                }
            }
        }
        
        console.log(`At A Glance: Parsed ${events.length} events from ICS content`);
        return events;
    }

    _processICSEvent(icsEvent) {
        const startTime = this._parseICSDateTime(icsEvent.dtstart);
        const endTime = this._parseICSDateTime(icsEvent.dtend || icsEvent.dtstart);
        const now = new Date();
        
        return {
            id: icsEvent.uid || `event_${Date.now()}`,
            title: icsEvent.summary,
            description: icsEvent.description || '',
            start: startTime.toISOString(),
            end: endTime.toISOString(),
            location: icsEvent.location || null,
            features: {
                isAllDay: icsEvent.dtstart.length === 8, // YYYYMMDD format for all-day
                hasAttendees: false,
                categories: [this.eventFilter.categorizeEvent(icsEvent)],
                timeFeatures: {
                    isToday: this._isSameDay(startTime, now),
                    isTomorrow: this._isTomorrow(startTime, now),
                    isUpcoming: startTime > now,
                    minutesUntil: Math.floor((startTime - now) / (1000 * 60))
                },
                confidence: 0.8
            },
            processed: new Date().toISOString()
        };
    }

    _parseICSDateTime(dateTimeString) {
        // Handle different ICS datetime formats
        if (dateTimeString.length === 8) {
            // YYYYMMDD format (all-day event)
            const year = parseInt(dateTimeString.substring(0, 4));
            const month = parseInt(dateTimeString.substring(4, 6)) - 1; // Month is 0-based
            const day = parseInt(dateTimeString.substring(6, 8));
            return new Date(year, month, day);
        } else if (dateTimeString.includes('T')) {
            // YYYYMMDDTHHMMSS format
            const dateTime = dateTimeString.replace(/[TZ]/g, '');
            const year = parseInt(dateTime.substring(0, 4));
            const month = parseInt(dateTime.substring(4, 6)) - 1;
            const day = parseInt(dateTime.substring(6, 8));
            const hour = parseInt(dateTime.substring(8, 10));
            const minute = parseInt(dateTime.substring(10, 12));
            const second = parseInt(dateTime.substring(12, 14)) || 0;
            return new Date(year, month, day, hour, minute, second);
        }
        
        // Fallback to current date
        return new Date();
    }

    _isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
    }

    _isTomorrow(date, today) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return this._isSameDay(date, tomorrow);
    }

    _filterAndProcessEvents(events) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        
        return events
            .filter(event => {
                const shouldExclude = this.eventFilter.shouldExclude(event);
                if (!shouldExclude) {
                    console.log(`At A Glance: KEEPING event after exclusion filter: "${event.title}" on ${event.start}`);
                }
                return !shouldExclude;
            })
            .filter(event => {
                const eventDate = new Date(event.start);
                const isAfterToday = eventDate >= today;
                if (isAfterToday) {
                    console.log(`At A Glance: KEEPING event after date filter: "${event.title}" on ${event.start}`);
                }
                return isAfterToday;
            })
            .sort((a, b) => {
                const dateA = new Date(a.start);
                const dateB = new Date(b.start);
                
                // Prioritize today's events, then tomorrow's, then this week's
                const isAToday = dateA >= today && dateA < tomorrow;
                const isBToday = dateB >= today && dateB < tomorrow;
                const isATomorrow = dateA >= tomorrow && dateA < new Date(tomorrow.getTime() + 24*60*60*1000);
                const isBTomorrow = dateB >= tomorrow && dateB < new Date(tomorrow.getTime() + 24*60*60*1000);
                
                if (isAToday && !isBToday) return -1;
                if (isBToday && !isAToday) return 1;
                if (isATomorrow && !isBTomorrow && !isBToday) return -1;
                if (isBTomorrow && !isATomorrow && !isAToday) return 1;
                
                // Within same priority group, sort by time
                return dateA - dateB;
            })
            .slice(0, 15); // Increase limit to 15 events
    }

    async _readSQLiteCalendarCache(dbPath) {
        const events = [];
        
        try {
            console.log(`At A Glance: Attempting to read SQLite database: ${dbPath}`);
            
            // Use the Nix store path for sqlite3 since it's not in the system PATH
            const sqlitePath = '/nix/store/b83kagl3d98zf8dbvh52lw4xg881bhkf-sqlite-3.48.0-bin/bin/sqlite3';
            
            // Check if sqlite3 exists at the Nix store path
            const sqliteFile = Gio.File.new_for_path(sqlitePath);
            if (!sqliteFile.query_exists(null)) {
                console.log(`At A Glance: sqlite3 not available at ${sqlitePath}, skipping database ${dbPath}`);
                return events;
            }
            
            console.log(`At A Glance: Using sqlite3 from Nix store: ${sqlitePath}`);
            
            // Use sqlite3 command with separator to properly handle multi-line results
            // Get current date to filter for upcoming events
            const today = new Date();
            const todayStr = today.toISOString().substring(0, 10).replace(/-/g, ''); // YYYYMMDD format
            
            const sqliteCommand = `${sqlitePath} "${dbPath}" "SELECT '=====EVENT_SEPARATOR=====' || ECacheOBJ || '=====EVENT_SEPARATOR=====' FROM ECacheObjects WHERE ECacheOBJ LIKE '%VEVENT%' AND (ECacheOBJ LIKE '%DTSTART%${todayStr}%' OR ECacheOBJ LIKE '%DTSTART:${todayStr}%' OR ECacheOBJ NOT LIKE '%DTSTART%2024%') ORDER BY ECacheOBJ LIMIT 25;"`;
            console.log(`At A Glance: Running SQLite command for events from ${todayStr} onwards with separators`);
            
            const [success, stdout, stderr] = GLib.spawn_command_line_sync(sqliteCommand);
            
            if (success && stdout) {
                const output = new TextDecoder().decode(stdout);
                console.log(`At A Glance: Raw SQLite output length: ${output.length} characters`);
                
                // Split by event separators to get individual events
                const eventBlocks = output.split('=====EVENT_SEPARATOR=====').filter(block => block.trim().length > 0);
                console.log(`At A Glance: Found ${eventBlocks.length} event blocks from ${dbPath}`);
                
                for (const eventBlock of eventBlocks) {
                    try {
                        const icsData = eventBlock.trim();
                        if (icsData && icsData.includes('VEVENT')) {
                            console.log(`At A Glance: Processing event block with ${icsData.split('\n').length} lines`);
                            const parsedEvents = this._parseICSContent(icsData);
                            events.push(...parsedEvents);
                            console.log(`At A Glance: Parsed ${parsedEvents.length} events from event block`);
                            
                            // Log each found event for debugging
                            for (const event of parsedEvents) {
                                console.log(`At A Glance: Found event: "${event.title}" on ${event.start} from ${event.source}`);
                            }
                        }
                    } catch (error) {
                        console.log(`At A Glance: Error parsing event block:`, error);
                    }
                }
            } else {
                const errorOutput = stderr ? new TextDecoder().decode(stderr) : 'Unknown error';
                console.log(`At A Glance: SQLite query failed for ${dbPath}: ${errorOutput}`);
            }
        } catch (error) {
            console.log(`At A Glance: Error accessing SQLite database ${dbPath}:`, error);
        }
        
        return events;
    }

    destroy() {
        this.cache.clear();
    }
}

// Legacy support for extension.js DataCollector
export function createCalendarDataCollector() {
    return new CalendarDataCollector();
}