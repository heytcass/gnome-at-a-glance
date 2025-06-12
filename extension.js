import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Import calendar integration
import { CalendarDataCollector } from './calendar-integration.js';
// Import meeting assistant
import { MeetingAssistant } from './meeting-assistant.js';
// Import email integration (disabled for now)
// import { EmailIntegration } from './email-integration.js';

// Helper function to get API key from config file
function getApiKey(service) {
    try {
        const configPath = GLib.get_home_dir() + '/.config/at-a-glance/config.json';
        const configFile = Gio.File.new_for_path(configPath);
        
        if (configFile.query_exists(null)) {
            const [success, contents] = configFile.load_contents(null);
            if (success) {
                const config = JSON.parse(new TextDecoder().decode(contents));
                const keyMap = {
                    'claude': 'claude_api_key',
                    'openweather': 'openweather_api_key', 
                    'todoist': 'todoist_api_key'
                };
                return config[keyMap[service]] || null;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error reading config for ${service}:`, error);
        return null;
    }
}

// Claude API rate limiting and caching system
class ClaudeRateLimit {
    constructor() {
        this.cache = new Map();
        this.usageFile = GLib.get_home_dir() + '/.config/at-a-glance/claude-usage.json';
        this.maxDailyRequests = 100;
        this.cacheTimeoutMinutes = 60;
        this.ensureUsageFile();
    }

    ensureUsageFile() {
        try {
            const configDir = GLib.get_home_dir() + '/.config/at-a-glance';
            const dir = Gio.File.new_for_path(configDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            
            const usageFile = Gio.File.new_for_path(this.usageFile);
            if (!usageFile.query_exists(null)) {
                const initialData = {
                    date: new Date().toDateString(),
                    requests: 0,
                    insights: 0,
                    prioritization: 0
                };
                usageFile.replace_contents(
                    JSON.stringify(initialData, null, 2),
                    null, false,
                    Gio.FileCreateFlags.NONE,
                    null
                );
            }
        } catch (error) {
            console.error('At A Glance: Error ensuring usage file:', error);
        }
    }

    getUsageData() {
        try {
            const usageFile = Gio.File.new_for_path(this.usageFile);
            if (usageFile.query_exists(null)) {
                const [success, contents] = usageFile.load_contents(null);
                if (success) {
                    const data = JSON.parse(new TextDecoder().decode(contents));
                    const today = new Date().toDateString();
                    
                    // Reset if new day
                    if (data.date !== today) {
                        return {
                            date: today,
                            requests: 0,
                            insights: 0,
                            prioritization: 0
                        };
                    }
                    return data;
                }
            }
        } catch (error) {
            console.error('At A Glance: Error reading usage data:', error);
        }
        return {
            date: new Date().toDateString(),
            requests: 0,
            insights: 0,
            prioritization: 0
        };
    }

    saveUsageData(data) {
        try {
            const usageFile = Gio.File.new_for_path(this.usageFile);
            usageFile.replace_contents(
                JSON.stringify(data, null, 2),
                null, false,
                Gio.FileCreateFlags.NONE,
                null
            );
        } catch (error) {
            console.error('At A Glance: Error saving usage data:', error);
        }
    }

    canMakeRequest(type = 'general') {
        const usage = this.getUsageData();
        const remaining = this.maxDailyRequests - usage.requests;
        
        if (remaining <= 0) {
            console.log(`At A Glance: Daily Claude API limit reached (${usage.requests}/${this.maxDailyRequests})`);
            return false;
        }
        
        if (remaining <= 3) {
            console.log(`At A Glance: Warning - Only ${remaining} Claude API requests remaining today`);
        }
        
        return true;
    }

    recordRequest(type = 'general') {
        const usage = this.getUsageData();
        usage.requests++;
        if (type === 'insights') usage.insights++;
        if (type === 'prioritization') usage.prioritization++;
        usage.date = new Date().toDateString();
        this.saveUsageData(usage);
        
        console.log(`At A Glance: Claude API request recorded. Usage: ${usage.requests}/${this.maxDailyRequests} (${type})`);
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached) {
            const ageMinutes = (Date.now() - cached.timestamp) / (1000 * 60);
            if (ageMinutes < this.cacheTimeoutMinutes) {
                console.log(`At A Glance: Using cached Claude response for ${key} (${Math.round(ageMinutes)}min old)`);
                return cached.data;
            } else {
                this.cache.delete(key);
                console.log(`At A Glance: Cache expired for ${key} (${Math.round(ageMinutes)}min old)`);
            }
        }
        return null;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        console.log(`At A Glance: Cached Claude response for ${key}`);
    }

    getUsageStatus() {
        const usage = this.getUsageData();
        const remaining = this.maxDailyRequests - usage.requests;
        return {
            used: usage.requests,
            remaining: remaining,
            limit: this.maxDailyRequests,
            insights: usage.insights,
            prioritization: usage.prioritization,
            resetTime: 'midnight'
        };
    }
}

// Global rate limiter instance
const claudeRateLimit = new ClaudeRateLimit();

// Global meeting assistant instance
const meetingAssistant = new MeetingAssistant();

// Data collection object
const DataCollector = {
    // emailCollector: null, // Disabled for now
    async getSmartLocation() {
        // 1. Check user config override first
        try {
            const configPath = GLib.get_home_dir() + '/.config/at-a-glance/config.json';
            const configFile = Gio.File.new_for_path(configPath);
            if (configFile.query_exists(null)) {
                const [success, contents] = configFile.load_contents(null);
                if (success) {
                    const config = JSON.parse(new TextDecoder().decode(contents));
                    if (config.location_override) {
                        console.log(`At A Glance: Using location override: ${config.location_override}`);
                        return config.location_override;
                    }
                }
            }
        } catch (e) {
            console.log('At A Glance: Could not read config for location override:', e);
        }
        
        // 2. Try IP-based geolocation
        try {
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', 'http://ip-api.com/json/?fields=city,regionName,countryCode');
            
            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const location = JSON.parse(responseText);
                
                if (location.city && location.countryCode) {
                    const city = `${location.city},${location.regionName},${location.countryCode}`;
                    console.log(`At A Glance: Detected location: ${city}`);
                    return city;
                }
            }
        } catch (e) {
            console.log('At A Glance: Could not detect location via IP:', e);
        }
        
        // 3. Default to Detroit
        console.log('At A Glance: Using default location: Detroit, MI');
        return 'Detroit,MI,US';
    },

    async getWeather() {
        try {
            const apiKey = getApiKey('openweather');
            if (!apiKey) {
                return { 
                    temp: '--', 
                    condition: 'No API Key', 
                    description: 'Store OpenWeather API key to view weather' 
                };
            }

            const city = await DataCollector.getSmartLocation();
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=imperial`;
            
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            
            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const data = JSON.parse(responseText);
                return {
                    temp: Math.round(data.main.temp),
                    condition: data.weather[0].main,
                    description: data.weather[0].description,
                    humidity: data.main.humidity,
                    windSpeed: Math.round(data.wind?.speed || 0)
                };
            } else {
                return { temp: '--', condition: 'Error', description: `API Error: ${message.get_status()}` };
            }
        } catch (error) {
            console.error('Weather API error:', error);
            return { temp: '--', condition: 'Error', description: 'Weather service unavailable' };
        }
    },

    async getCalendarEvents() {
        console.log('At A Glance: DataCollector.getCalendarEvents() called');
        if (!this.calendarCollector) {
            console.log('At A Glance: Creating new CalendarDataCollector');
            this.calendarCollector = new CalendarDataCollector();
        }
        console.log('At A Glance: Calling calendarCollector.getCalendarEvents()');
        return await this.calendarCollector.getCalendarEvents();
    },

    async getTasks() {
        try {
            const apiKey = getApiKey('todoist');
            if (!apiKey) {
                return [
                    { title: 'Configure Todoist API key for task sync', priority: 'high' },
                    { title: 'Set up integrations', priority: 'medium' }
                ];
            }

            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', 'https://api.todoist.com/rest/v2/tasks');
            message.get_request_headers().append('Authorization', `Bearer ${apiKey}`);
            
            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const data = JSON.parse(responseText);
                const formattedTasks = data.slice(0, 5).map(task => ({
                    title: task.content,
                    priority: task.priority >= 3 ? 'high' : task.priority === 2 ? 'medium' : 'low',
                    due: task.due ? task.due.string : null,
                    project: task.project_id,
                    id: task.id
                }));
                return formattedTasks.length > 0 ? formattedTasks : [{ title: 'No tasks found', priority: 'low' }];
            } else {
                return [{ title: `Todoist API error: ${message.get_status()}`, priority: 'high' }];
            }
        } catch (error) {
            console.error('Todoist API error:', error);
            return [
                { title: 'Todoist service unavailable', priority: 'medium' },
                { title: 'Using offline mode', priority: 'low' }
            ];
        }
    },

    // Email integration disabled for now - too complex for initial implementation
    /*
    async getEmailData() {
        try {
            if (!this.emailCollector) {
                console.log('At A Glance: Creating new EmailIntegration');
                this.emailCollector = new EmailIntegration();
            }
            
            console.log('At A Glance: Collecting email data...');
            const emailSummary = await this.emailCollector.getEmailSummary();
            console.log('At A Glance: Email data collected:', emailSummary);
            
            return emailSummary;
        } catch (error) {
            console.error('At A Glance: Email collection error:', error);
            return {
                total: 0,
                vip: 0,
                urgent: 0,
                mostUrgent: null,
                status: 'Email service unavailable'
            };
        }
    },
    */

    async getClaudeInsights(data) {
        try {
            const apiKey = getApiKey('claude');
            if (!apiKey) {
                return {
                    summary: 'Configure Claude API key for AI insights',
                    priority: 'Configure APIs for smart analysis'
                };
            }

            // Create cache key based on current context
            const now = new Date();
            const hour = now.getHours();
            const timeContext = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            
            const hasEvents = data.calendar.length > 0;
            const urgentTasks = data.tasks.filter(task => task.priority === 'high');
            const urgentTaskTitles = urgentTasks.slice(0, 2).map(t => t.title).join(', ');
            const weatherTemp = data.weather.temp;
            const weatherCondition = data.weather.condition;
            
            // Create a cache key based on current context (rounded to nearest 10 minutes for better caching)
            const roundedMinutes = Math.floor(now.getMinutes() / 10) * 10;
            const cacheKey = `insights-${timeContext}-${hasEvents}-${urgentTasks.length}-${weatherTemp}-${now.toDateString()}-${hour}:${roundedMinutes}`;
            
            // Check cache first
            const cached = claudeRateLimit.getCached(cacheKey);
            if (cached) {
                return cached;
            }
            
            // Check rate limit
            if (!claudeRateLimit.canMakeRequest('insights')) {
                const usage = claudeRateLimit.getUsageStatus();
                return {
                    summary: `Daily AI limit reached (${usage.used}/${usage.limit})`,
                    priority: 'Rate limited - resets at midnight'
                };
            }
            
            // Enhanced meeting context for better insights
            const meetingContext = data.meetings?.hasMeetings 
                ? `${data.meetings.summary}${data.meetings.nextMeeting?.hasPreparation ? ' (prep needed)' : ''}`
                : 'No meetings scheduled';

            const prompt = `You are an AI assistant providing contextual insights for a desktop widget. Based on this ${timeContext} situation, provide ONE actionable insight or observation (max 60 characters):

Context:
- Weather: ${weatherTemp}°F, ${weatherCondition}
- Calendar: ${hasEvents ? 'Has scheduled events' : 'No events scheduled'}
- Meetings: ${meetingContext}
- Tasks: ${urgentTasks.length > 0 ? `Urgent: ${urgentTaskTitles}` : data.tasks.length + ' tasks pending'}
- Time: ${timeContext}

Be creative and contextual. Consider patterns like:
- Productivity suggestions based on schedule/weather
- Time management advice
- Weather-influenced recommendations  
- Priority guidance based on tasks
- Motivational insights
- Contextual observations

Your response should be helpful, concise, and relevant to the current situation. Avoid being repetitive or overly formulaic.

Response:`;

            const httpSession = new Soup.Session();
            const message = Soup.Message.new('POST', 'https://api.anthropic.com/v1/messages');
            
            message.get_request_headers().append('Content-Type', 'application/json');
            message.get_request_headers().append('anthropic-version', '2023-06-01');
            message.get_request_headers().append('x-api-key', apiKey);
            
            const body = JSON.stringify({
                model: 'claude-3-haiku-20240307',
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 100
            });
            
            const bodyBytes = new TextEncoder().encode(body);
            message.set_request_body_from_bytes('application/json', GLib.Bytes.new(bodyBytes));

            // Record the request before making it
            claudeRateLimit.recordRequest('insights');

            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const result = JSON.parse(responseText);
                const content = result.content[0].text.trim();
                
                const responseData = {
                    summary: content,
                    priority: '🤖 AI Analysis Complete'
                };
                
                // Cache the successful response
                claudeRateLimit.setCached(cacheKey, responseData);
                
                return responseData;
            } else {
                return {
                    summary: `Claude API error: ${message.get_status()}`,
                    priority: 'Check API key and credits'
                };
            }
        } catch (error) {
            console.error('Claude API error:', error);
            return {
                summary: 'Claude service unavailable',
                priority: 'AI insights disabled'
            };
        }
    },

    async getClaudePrioritization(data) {
        try {
            const apiKey = getApiKey('claude');
            if (!apiKey) {
                return null; // Will trigger fallback logic
            }

            const now = new Date();
            const hour = now.getHours();
            const timeContext = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            
            // Prepare detailed context for prioritization
            let calendarContext = 'No upcoming events';
            if (data.calendar.length > 0) {
                const nextEvent = data.calendar[0];
                const eventTime = new Date(nextEvent.start);
                const minutesUntil = Math.floor((eventTime - now) / (1000 * 60));
                const timeString = eventTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                
                if (minutesUntil <= 15) {
                    calendarContext = `URGENT: "${nextEvent.title}" starting in ${minutesUntil} minutes`;
                } else if (minutesUntil <= 240) { // 4 hours
                    calendarContext = `Next: "${nextEvent.title}" at ${timeString} (${Math.floor(minutesUntil/60)}h ${minutesUntil%60}m away)`;
                } else {
                    calendarContext = `Later today: "${nextEvent.title}" at ${timeString}`;
                }
                
                if (nextEvent.location) {
                    calendarContext += ` at ${nextEvent.location}`;
                }
            }
            
            let tasksContext = 'No tasks';
            if (data.tasks.length > 0) {
                const urgentTasks = data.tasks.filter(t => t.priority === 'high');
                const mediumTasks = data.tasks.filter(t => t.priority === 'medium');
                
                if (urgentTasks.length > 0) {
                    tasksContext = `URGENT: ${urgentTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')}`;
                    if (urgentTasks.length > 2) tasksContext += ` (+${urgentTasks.length - 2} more urgent)`;
                } else if (mediumTasks.length > 0) {
                    tasksContext = `Medium priority: ${mediumTasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')}`;
                } else {
                    tasksContext = `${data.tasks.length} tasks: ${data.tasks.slice(0, 2).map(t => `"${t.title}"`).join(', ')}`;
                }
            }
            
            // Create cache key for prioritization (more frequent updates than insights)
            const roundedMinutes = Math.floor(now.getMinutes() / 5) * 5; // 5-minute windows for prioritization
            const urgentCount = data.tasks.filter(t => t.priority === 'high').length;
            const cacheKey = `priority-${timeContext}-${data.calendar.length}-${urgentCount}-${data.weather.temp}-${now.toDateString()}-${hour}:${roundedMinutes}`;
            
            // Check cache first
            const cached = claudeRateLimit.getCached(cacheKey);
            if (cached) {
                return cached;
            }
            
            // Check rate limit
            if (!claudeRateLimit.canMakeRequest('prioritization')) {
                console.log('At A Glance: Rate limit reached for prioritization, using fallback');
                return null; // Will trigger fallback logic
            }
            
            // Enhanced meeting context for prioritization
            const meetingPriorityContext = data.meetings?.hasMeetings 
                ? `${data.meetings.summary} (${data.meetings.nextMeeting?.urgency || 'medium'} urgency${data.meetings.nextMeeting?.hasPreparation ? ', needs prep' : ''})`
                : 'No upcoming meetings';

            const prompt = `You are an AI assistant that decides what's most important to display on a GNOME desktop panel button.

Current Context (${timeContext}):
• Calendar: ${calendarContext}
• Meetings: ${meetingPriorityContext}
• Tasks: ${tasksContext}
• Weather: ${data.weather.temp}°F, ${data.weather.condition}
• System: ${data.system.nixosStatus}, ${data.system.battery}% battery

Choose the SINGLE most important thing to display right now based on:
- Time sensitivity and urgency
- User context and priorities
- Relevance to current situation

Format: emoji + brief text (max 35 characters)
Use contextually appropriate emojis and be creative with your choices.

Focus on what would be most helpful for the user to see at a glance right now.

Response (just the display text):`;

            const httpSession = new Soup.Session();
            const message = Soup.Message.new('POST', 'https://api.anthropic.com/v1/messages');
            
            message.get_request_headers().append('Content-Type', 'application/json');
            message.get_request_headers().append('anthropic-version', '2023-06-01');
            message.get_request_headers().append('x-api-key', apiKey);
            
            const body = JSON.stringify({
                model: 'claude-3-haiku-20240307',
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                max_tokens: 50
            });
            
            const bodyBytes = new TextEncoder().encode(body);
            message.set_request_body_from_bytes('application/json', GLib.Bytes.new(bodyBytes));

            // Record the request before making it
            claudeRateLimit.recordRequest('prioritization');

            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const result = JSON.parse(responseText);
                const content = result.content[0].text.trim();
                
                // Remove quotes if AI added them
                const cleanContent = content.replace(/^["']|["']$/g, '');
                
                // Cache the successful response
                claudeRateLimit.setCached(cacheKey, cleanContent);
                
                return cleanContent;
            } else {
                console.error('At A Glance: Claude API error:', message.get_status());
                return null; // Will trigger fallback logic
            }
        } catch (error) {
            console.error('At A Glance: Claude prioritization error:', error);
            return null; // Will trigger fallback logic
        }
    },

    async getSystemInfo() {
        try {
            let batteryLevel = 'N/A';
            try {
                const batteryFile = Gio.File.new_for_path('/sys/class/power_supply/BAT0/capacity');
                if (batteryFile.query_exists(null)) {
                    const [success, contents] = batteryFile.load_contents(null);
                    if (success) {
                        batteryLevel = parseInt(new TextDecoder().decode(contents).trim());
                    }
                }
            } catch (e) {
                console.log('At A Glance: Could not read battery info:', e);
            }
            
            let nixosIssues = 0;
            let nixosStatus = 'OK';
            
            try {
                const proc = Gio.Subprocess.new(['systemctl', '--failed', '--no-legend'], Gio.SubprocessFlags.STDOUT_PIPE);
                const [, stdout] = proc.communicate_utf8(null, null);
                const failedServices = stdout.trim().split('\n').filter(line => line.length > 0).length;
                if (failedServices > 0) {
                    nixosIssues += failedServices;
                    nixosStatus = `${failedServices} failed services`;
                }
            } catch (e) {
                console.log('At A Glance: Could not check systemd services:', e);
            }
            
            return {
                nixosIssues: nixosIssues,
                nixosStatus: nixosStatus,
                battery: batteryLevel,
                notifications: 0
            };
        } catch (error) {
            console.error('System info error:', error);
            return {
                nixosIssues: 0,
                nixosStatus: 'Error',
                battery: 'Error',
                notifications: 0
            };
        }
    }
};

const AtAGlanceIndicator = GObject.registerClass(
class AtAGlanceIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'At A Glance');

        this.buttonText = new St.Label({
            text: '📊',
            y_align: Clutter.ActorAlign.CENTER
        });

        this.add_child(this.buttonText);
        this._showingDetails = false;

        // Create AI summary as primary content
        this._aiSummaryItem = new PopupMenu.PopupMenuItem('🤖 Loading insights...');
        this._aiSummaryItem.connect('activate', () => {
            this._toggleDetailedView();
        });
        this.menu.addMenuItem(this._aiSummaryItem);
        
        // Create detailed sections
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._detailsLabel = new PopupMenu.PopupMenuItem('📋 Detailed Information:');
        this._detailsLabel.setSensitive(false);
        this.menu.addMenuItem(this._detailsLabel);
        
        this._weatherItem = new PopupMenu.PopupMenuItem('🌤️ Weather: Loading...');
        this._calendarItem = new PopupMenu.PopupMenuItem('📅 Calendar: Loading...');
        this._tasksItem = new PopupMenu.PopupMenuItem('📝 Tasks: Loading...');
        this._systemItem = new PopupMenu.PopupMenuItem('💻 System: Loading...');
        
        this.menu.addMenuItem(this._weatherItem);
        this.menu.addMenuItem(this._calendarItem);
        this.menu.addMenuItem(this._tasksItem);
        this.menu.addMenuItem(this._systemItem);
        
        // Add click handlers
        this._weatherItem.connect('activate', () => this._handleWeatherClick());
        this._calendarItem.connect('activate', () => this._handleCalendarClick());
        this._tasksItem.connect('activate', () => this._handleTasksClick());
        this._systemItem.connect('activate', () => this._handleSystemClick());

        // Settings menu
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('⚙️ Settings');
        settingsItem.connect('activate', () => {
            try {
                Gio.Subprocess.new(
                    ['gnome-extensions', 'prefs', 'at-a-glance@gnome-extension'],
                    Gio.SubprocessFlags.NONE
                );
            } catch (e) {
                Main.notify('At A Glance', 'Use: gnome-extensions prefs at-a-glance@gnome-extension');
            }
        });
        this.menu.addMenuItem(settingsItem);

        // Initially hide detailed sections
        this._hideDetailedView();

        // Start update cycle
        this._updateData();
        this._updateTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._updateData();
            return GLib.SOURCE_CONTINUE;
        });

        console.log('At A Glance: Widget created with menu');
    }

    _toggleDetailedView() {
        if (this._showingDetails) {
            this._hideDetailedView();
        } else {
            this._showDetailedView();
        }
    }

    _hideDetailedView() {
        this._showingDetails = false;
        this._detailsLabel.actor.hide();
        this._weatherItem.actor.hide();
        this._calendarItem.actor.hide();
        this._tasksItem.actor.hide();
        this._systemItem.actor.hide();
        if (this._aiSummaryItem.label.text && !this._aiSummaryItem.label.text.includes('▶️')) {
            this._aiSummaryItem.label.text = '▶️ ' + this._aiSummaryItem.label.text.replace('🔽 ', '');
        }
    }

    _showDetailedView() {
        this._showingDetails = true;
        this._detailsLabel.actor.show();
        this._weatherItem.actor.show();
        this._calendarItem.actor.show();
        this._tasksItem.actor.show();
        this._systemItem.actor.show();
        if (this._aiSummaryItem.label.text) {
            this._aiSummaryItem.label.text = '🔽 ' + this._aiSummaryItem.label.text.replace('▶️ ', '');
        }
    }

    async _updateData() {
        try {
            console.log('At A Glance: Starting _updateData()');
            const data = {
                weather: await DataCollector.getWeather(),
                calendar: await DataCollector.getCalendarEvents(),
                tasks: await DataCollector.getTasks(),
                system: await DataCollector.getSystemInfo()
            };
            
            // Add meeting context to calendar events
            data.meetings = meetingAssistant.getMeetingContextForAI(data.calendar);
            console.log('At A Glance: Data collection complete:', { 
                weather: data.weather.temp,
                calendar: data.calendar.length,
                tasks: data.tasks.length,
                system: data.system.nixosStatus
            });

            const insights = await DataCollector.getClaudeInsights(data);
            data.insights = insights;

            this._lastData = data;
            await this._updateDisplay(data);
        } catch (error) {
            console.error('At A Glance: Error updating data:', error);
            this.buttonText.set_text('📊 Error');
        }
    }

    async _updateDisplay(data) {
        const urgentDisplay = await this._getMostUrgentDisplay(data);
        this.buttonText.set_text(urgentDisplay);

        const aiText = data.insights.summary || 'Loading insights...';
        const expandIcon = this._showingDetails ? '🔽' : '▶️';
        this._aiSummaryItem.label.set_text(`${expandIcon} ${aiText}`);
        
        this._weatherItem.label.set_text(`🌤️ Weather: ${data.weather.temp}°F, ${data.weather.description}`);
        
        const nextEvent = data.calendar[0];
        if (nextEvent && data.calendar.length > 0) {
            const startTime = new Date(nextEvent.start);
            const timeString = startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            this._calendarItem.label.set_text(`📅 Next: ${nextEvent.title} @ ${timeString}`);
            this._calendarItem.actor.show();
        } else {
            this._calendarItem.actor.hide();
        }
        
        const urgentTasks = data.tasks.filter(t => t.priority === 'high');
        let taskText = '';
        if (urgentTasks.length > 0) {
            const urgentTitles = urgentTasks.slice(0, 2).map(t => t.title).join(', ');
            const moreCount = urgentTasks.length > 2 ? ` (+${urgentTasks.length - 2} more)` : '';
            taskText = `📝 Urgent: ${urgentTitles}${moreCount}`;
        } else if (data.tasks.length > 0) {
            const nextTask = data.tasks[0].title;
            taskText = `📝 Next: ${nextTask}${data.tasks.length > 1 ? ` (+${data.tasks.length - 1} more)` : ''}`;
        } else {
            taskText = '📝 No tasks scheduled';
        }
        this._tasksItem.label.set_text(taskText);
        
        this._systemItem.label.set_text(
            `💻 System: ${data.system.nixosStatus}, ${data.system.battery}% battery`
        );
    }

    async _getMostUrgentDisplay(data) {
        // ALWAYS check for critical system issues first (immediate display, no AI needed)
        const lowBattery = data.system.battery !== 'N/A' && data.system.battery < 20;
        if (lowBattery) {
            return `🔋 ${data.system.battery}% battery`;
        }
        
        if (data.system.nixosIssues > 0) {
            return `⚠️ ${data.system.nixosStatus}`;
        }
        
        // Try AI-driven prioritization for everything else
        try {
            const aiResult = await DataCollector.getClaudePrioritization(data);
            if (aiResult) {
                return aiResult;
            }
        } catch (error) {
            console.log('At A Glance: AI prioritization failed, using fallback logic:', error);
        }
        
        // Fallback logic when AI is unavailable
        return this._getFallbackDisplay(data);
    }

    _getFallbackDisplay(data) {
        // Imminent calendar events (starting or within 15 minutes)
        const nextEvent = data.calendar[0];
        if (nextEvent && data.calendar.length > 0) {
            const startTime = new Date(nextEvent.start);
            const now = new Date();
            const minutesUntil = Math.floor((startTime - now) / (1000 * 60));
            const timeString = startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            if (minutesUntil <= 0) {
                return `🚨 ${nextEvent.title} starting`;
            } else if (minutesUntil <= 15) {
                return `🚨 ${nextEvent.title} in ${minutesUntil}min`;
            }
        }
        
        // Urgent tasks (P1/P2 priority or overdue)
        const urgentTasks = data.tasks.filter(t => t.priority === 'high');
        if (urgentTasks.length > 0) {
            const firstUrgent = urgentTasks[0].title;
            const icon = urgentTasks.length > 1 ? '🎯' : '⚡';
            const suffix = urgentTasks.length > 1 ? ` (+${urgentTasks.length - 1})` : '';
            return `${icon} ${firstUrgent}${suffix}`;
        }
        
        // Calendar events within next 4 hours (less urgent than tasks)
        if (nextEvent && data.calendar.length > 0) {
            const startTime = new Date(nextEvent.start);
            const now = new Date();
            const minutesUntil = Math.floor((startTime - now) / (1000 * 60));
            const timeString = startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            if (minutesUntil <= 240) { // Within 4 hours
                if (nextEvent.location && nextEvent.location.toLowerCase().includes('virtual')) {
                    return `🎥 ${nextEvent.title} @ ${timeString}`;
                } else if (nextEvent.location) {
                    return `📍 ${nextEvent.title} @ ${timeString}`;
                } else {
                    return `📅 ${nextEvent.title} @ ${timeString}`;
                }
            }
        }
        
        // Medium priority tasks if no urgent events/tasks
        const mediumTasks = data.tasks.filter(t => t.priority === 'medium');
        if (mediumTasks.length > 0) {
            const firstMedium = mediumTasks[0].title;
            const suffix = mediumTasks.length > 1 ? ` (+${mediumTasks.length - 1})` : '';
            return `📋 ${firstMedium}${suffix}`;
        }
        
        // Calendar events later today (after 4 hours)
        if (nextEvent && data.calendar.length > 0) {
            const startTime = new Date(nextEvent.start);
            const now = new Date();
            const timeString = startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            // Check if it's today
            const isToday = startTime.toDateString() === now.toDateString();
            if (isToday) {
                return `📅 ${nextEvent.title} @ ${timeString}`;
            }
        }
        
        // Weather display (fallback)
        const temp = data.weather.temp;
        const condition = data.weather.condition;
        let weatherIcon = '📊';
        
        if (condition.includes('Thunder')) weatherIcon = '⛈️';
        else if (condition.includes('Rain')) weatherIcon = '🌧️';
        else if (condition.includes('Snow')) weatherIcon = '🌨️';
        else if (condition.includes('Fog')) weatherIcon = '🌫️';
        else if (condition.includes('Cloud')) weatherIcon = '☁️';
        else if (condition.includes('Clear') || condition.includes('Sunny')) weatherIcon = '☀️';
        else weatherIcon = '⛅';
        
        return `${weatherIcon} ${temp}°F ${condition}`;
    }

    _handleWeatherClick() {
        try {
            Gio.AppInfo.launch_default_for_uri('https://openweathermap.org/city/5007402', null);
        } catch (e) {
            Main.notify('At A Glance', 'Opening weather details...');
        }
    }

    _handleCalendarClick() {
        try {
            const calendar = Gio.AppInfo.create_from_commandline('gnome-calendar', 'Calendar', Gio.AppInfoCreateFlags.NONE);
            calendar.launch([], null);
        } catch (e) {
            Main.notify('At A Glance', 'Could not open calendar app');
        }
    }

    _handleTasksClick() {
        const urgentTasks = this._lastData?.tasks?.filter(t => t.priority === 'high') || [];
        
        if (urgentTasks.length > 0) {
            const task = urgentTasks[0];
            Main.notify('At A Glance', `Urgent: ${task.title}`);
        } else {
            try {
                Gio.AppInfo.launch_default_for_uri('https://todoist.com/app', null);
            } catch (e) {
                Main.notify('At A Glance', 'Could not open Todoist');
            }
        }
    }

    _handleSystemClick() {
        try {
            const monitor = Gio.AppInfo.create_from_commandline('gnome-system-monitor', 'System Monitor', Gio.AppInfoCreateFlags.NONE);
            monitor.launch([], null);
        } catch (e) {
            const battery = this._lastData?.system?.battery || 'Unknown';
            const status = this._lastData?.system?.nixosStatus || 'Unknown';
            Main.notify('At A Glance', `System: ${status}, ${battery}% battery`);
        }
    }

    destroy() {
        if (this._updateTimer) {
            GLib.source_remove(this._updateTimer);
            this._updateTimer = null;
        }
        if (DataCollector.calendarCollector) {
            DataCollector.calendarCollector.destroy();
            DataCollector.calendarCollector = null;
        }
        console.log('At A Glance: Widget destroyed');
        super.destroy();
    }
});

export default class AtAGlanceExtension extends Extension {
    enable() {
        console.log('At A Glance: Extension enabled');
        this._indicator = new AtAGlanceIndicator();
        Main.panel.addToStatusArea('at-a-glance-indicator', this._indicator);
    }

    disable() {
        console.log('At A Glance: Extension disabled');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}