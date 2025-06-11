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

// Data collection object
const DataCollector = {
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

    async getClaudeInsights(data) {
        try {
            const apiKey = getApiKey('claude');
            if (!apiKey) {
                return {
                    summary: 'Configure Claude API key for AI insights',
                    priority: 'Configure APIs for smart analysis'
                };
            }

            const now = new Date();
            const hour = now.getHours();
            const timeContext = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            
            const hasEvents = data.calendar.length > 0;
            const urgentTasks = data.tasks.filter(task => task.priority === 'high');
            const urgentTaskTitles = urgentTasks.slice(0, 2).map(t => t.title).join(', ');
            const weatherTemp = data.weather.temp;
            const weatherCondition = data.weather.condition;
            
            const prompt = `You are an AI assistant providing contextual insights. Based on this ${timeContext} situation, give ONE actionable insight (max 60 chars):

Context:
- Weather: ${weatherTemp}°F, ${weatherCondition}
- Calendar: ${hasEvents ? 'Has scheduled events' : 'No events scheduled'}  
- Tasks: ${urgentTasks.length > 0 ? `Urgent: ${urgentTaskTitles}` : data.tasks.length + ' tasks pending'}
- Time: ${timeContext}

Provide ONE smart suggestion or observation. Examples:
"Focus on: [task name] this morning"
"Perfect weather for outdoor meetings"
"Light schedule - ideal for focused work"
"Rainy day - stay productive indoors"

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

            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const result = JSON.parse(responseText);
                const content = result.content[0].text.trim();
                return {
                    summary: content,
                    priority: '🤖 AI Analysis Complete'
                };
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
            
            const prompt = `You are an AI assistant that decides what's most important to display on a GNOME desktop panel button. 

Current Context (${timeContext}):
• Calendar: ${calendarContext}
• Tasks: ${tasksContext}
• Weather: ${data.weather.temp}°F, ${data.weather.condition}
• System: ${data.system.nixosStatus}, ${data.system.battery}% battery

Instructions:
1. Choose the SINGLE most important thing to display right now
2. Consider: urgency (time-sensitive), importance, and user context
3. Format as a panel button display (emoji + brief text, max 35 characters)
4. Use appropriate emoji: 🚨 (urgent), ⚡ (high priority), 📅 (calendar), 📋 (tasks), 🌤️ (weather)

Examples:
"🚨 Meeting in 5min"
"⚡ Complete project proposal"
"📅 Lunch @ 12:30"
"📋 3 urgent tasks"
"🌤️ 72°F Sunny"

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

            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() === 200) {
                const decoder = new TextDecoder('utf-8');
                const responseText = decoder.decode(response.get_data());
                const result = JSON.parse(responseText);
                const content = result.content[0].text.trim();
                
                // Remove quotes if AI added them
                const cleanContent = content.replace(/^["']|["']$/g, '');
                
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