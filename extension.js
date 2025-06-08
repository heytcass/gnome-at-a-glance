import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup';
import Secret from 'gi://Secret';

// Try to import EDS - it might not be available in all environments
let EDataServer, ECal, ICalGLib;
try {
    EDataServer = imports.gi.EDataServer;
    ECal = imports.gi.ECal;  
    ICalGLib = imports.gi.ICalGLib;
} catch (e) {
    console.log('At A Glance: EDS not available, using mock calendar data');
}
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Helper function to get API key from config file (simpler approach)
function getApiKey(service) {
    try {
        const configPath = GLib.get_home_dir() + '/.config/at-a-glance/config.json';
        const configFile = Gio.File.new_for_path(configPath);
        
        if (configFile.query_exists(null)) {
            const [success, contents] = configFile.load_contents(null);
            if (success) {
                const config = JSON.parse(contents);
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

// Simple data collector without API integration for now
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
        
        // 2. Try IP-based geolocation (simple and privacy-friendly)
        try {
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', 'http://ip-api.com/json/?fields=city,regionName,countryCode');
            
            const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.status_code === 200) {
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
        
        // 3. Default to Detroit (where this extension was developed!)
        console.log('At A Glance: Using default location: Detroit, MI');
        return 'Detroit,MI,US';
    },
    async getWeather() {
        try {
            // Get API key from config
            const apiKey = getApiKey('openweather');

            if (!apiKey) {
                return { 
                    temp: '--', 
                    condition: 'No API Key', 
                    description: 'Store OpenWeather API key to view weather' 
                };
            }

            // OpenWeatherMap API call with smart location detection
            const city = await DataCollector.getSmartLocation();
            const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=imperial`;
            
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            
            try {
                const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
                if (message.status_code === 200) {
                    const decoder = new TextDecoder('utf-8');
                    const responseText = decoder.decode(response.get_data());
                    const data = JSON.parse(responseText);
                    const weatherData = {
                        temp: Math.round(data.main.temp),
                        condition: data.weather[0].main,
                        description: data.weather[0].description,
                        humidity: data.main.humidity,
                        windSpeed: Math.round(data.wind?.speed || 0)
                    };
                    return weatherData;
                } else {
                    return { temp: '--', condition: 'Error', description: `API Error: ${message.status_code}` };
                }
            } catch (e) {
                return { temp: '--', condition: 'Error', description: 'Failed to parse weather data' };
            }
        } catch (error) {
            console.error('Weather API error:', error);
            return { temp: '--', condition: 'Error', description: 'Weather service unavailable' };
        }
    },

    async getCalendarEvents() {
        try {
            // Try to get real calendar events from Evolution Data Server
            if (EDataServer && ECal && ICalGLib) {
                try {
                    // Check for calendar data files
                    const calendarDir = GLib.get_home_dir() + '/.local/share/evolution/calendar';
                    const dir = Gio.File.new_for_path(calendarDir);
                    
                    if (dir.query_exists(null)) {
                        // Check if there's actual calendar data
                        const calFile = Gio.File.new_for_path(calendarDir + '/system/calendar.ics');
                        if (calFile.query_exists(null)) {
                            const [success, contents] = calFile.load_contents(null);
                            if (success) {
                                const calendarData = new TextDecoder().decode(contents);
                                // Check if there are any VEVENT entries
                                if (calendarData.includes('BEGIN:VEVENT')) {
                                    return [{
                                        time: 'Sync',
                                        title: 'Calendar events found',
                                        location: 'Evolution integration active'
                                    }];
                                }
                            }
                        }
                        
                        // Calendar system exists but no events
                        return [{
                            time: 'Empty',
                            title: 'No calendar events scheduled',
                            location: 'Add events in GNOME Calendar'
                        }];
                    }
                } catch (e) {
                    console.log('At A Glance: Could not access calendar data:', e);
                }
            }
            
            // No calendar system detected
            return [{
                time: 'Setup',
                title: 'Calendar integration unavailable',
                location: 'Install GNOME Calendar for events'
            }];
        } catch (error) {
            console.error('Calendar error:', error);
            return [{ time: 'Error', title: 'Calendar unavailable', location: '' }];
        }
    },

    async getTasks() {
        try {
            // Get Todoist API key from config
            const apiKey = getApiKey('todoist');
            
            if (!apiKey) {
                return [
                    { title: 'Configure Todoist API key for task sync', priority: 'high' },
                    { title: 'Set up integrations', priority: 'medium' }
                ];
            }

            // Fetch tasks from Todoist API
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', 'https://api.todoist.com/rest/v2/tasks');
            
            message.request_headers.append('Authorization', `Bearer ${apiKey}`);
            
            try {
                const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
                if (message.status_code === 200) {
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
                    return [{ title: `Todoist API error: ${message.status_code}`, priority: 'high' }];
                }
            } catch (e) {
                return [{ title: 'Error parsing Todoist data', priority: 'high' }];
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
            // Get Claude API key from config
            const apiKey = getApiKey('claude');

            if (!apiKey) {
                return {
                    summary: 'Configure Claude API key for AI insights',
                    priority: 'Configure APIs for smart analysis'
                };
            }

            // Create a contextual prompt for Claude
            const now = new Date();
            const hour = now.getHours();
            const timeContext = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            
            // Extract meaningful context from the data
            const hasEvents = data.calendar.length > 0 && !data.calendar[0].title.includes('No calendar events');
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
            
            message.request_headers.append('Content-Type', 'application/json');
            message.request_headers.append('anthropic-version', '2023-06-01');
            message.request_headers.append('x-api-key', apiKey);
            
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

            try {
                const response = await httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
                if (message.status_code === 200) {
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
                        summary: `Claude API error: ${message.status_code}`,
                        priority: 'Check API key and credits'
                    };
                }
            } catch (e) {
                return {
                    summary: 'Claude API response error',
                    priority: 'Check API configuration'
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

    async getSystemInfo() {
        try {
            // Get battery information
            let batteryLevel = 'N/A';
            try {
                const upowerPath = '/org/freedesktop/UPower/devices/battery_BAT0';
                const upowerBus = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SYSTEM,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    'org.freedesktop.UPower',
                    upowerPath,
                    'org.freedesktop.UPower.Device',
                    null
                );
                
                const percentage = upowerBus.get_cached_property('Percentage');
                if (percentage) {
                    batteryLevel = Math.round(percentage.unpack());
                }
            } catch (e) {
                try {
                    const batteryFile = Gio.File.new_for_path('/sys/class/power_supply/BAT0/capacity');
                    if (batteryFile.query_exists(null)) {
                        const [success, contents] = batteryFile.load_contents(null);
                        if (success) {
                            batteryLevel = parseInt(new TextDecoder().decode(contents).trim());
                        }
                    }
                } catch (e2) {
                    console.log('At A Glance: Could not read battery info:', e2);
                }
            }
            
            // NixOS-specific system checks
            let nixosIssues = 0;
            let nixosStatus = 'OK';
            
            // Check failed systemd services
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
            
            // Check Nix store disk usage
            try {
                const proc = Gio.Subprocess.new(['df', '/nix/store'], Gio.SubprocessFlags.STDOUT_PIPE);
                const [, stdout] = proc.communicate_utf8(null, null);
                const lines = stdout.trim().split('\n');
                if (lines.length > 1) {
                    const usage = lines[1].split(/\s+/)[4];
                    const usagePercent = parseInt(usage.replace('%', ''));
                    if (usagePercent > 85) {
                        nixosIssues++;
                        nixosStatus = `Nix store ${usagePercent}% full`;
                    }
                }
            } catch (e) {
                console.log('At A Glance: Could not check Nix store usage:', e);
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

        // Create the main widget display with contextual icons
        this.buttonText = new St.Label({
            text: '📊',  // Default icon, will be updated based on context
            y_align: Clutter.ActorAlign.CENTER
        });

        this.add_child(this.buttonText);

        // Track if we're showing detailed view
        this._showingDetails = false;

        // Create AI summary as primary content (clickable to expand)
        this._aiSummaryItem = new PopupMenu.PopupMenuItem('🤖 Loading insights...');
        this._aiSummaryItem.connect('activate', () => {
            this._toggleDetailedView();
        });
        this.menu.addMenuItem(this._aiSummaryItem);
        
        // Create detailed sections (initially hidden)
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
        
        // Add click handlers for interactive functionality
        this._weatherItem.connect('activate', () => {
            this._handleWeatherClick();
        });
        
        this._calendarItem.connect('activate', () => {
            this._handleCalendarClick();
        });
        
        this._tasksItem.connect('activate', () => {
            this._handleTasksClick();
        });
        
        this._systemItem.connect('activate', () => {
            this._handleSystemClick();
        });

        // Settings menu
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsItem = new PopupMenu.PopupMenuItem('⚙️ Settings');
        settingsItem.connect('activate', () => {
            try {
                const ExtensionUtils = imports.misc.extensionUtils;
                ExtensionUtils.openPrefs();
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
        // Update AI summary to show expand arrow
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
        // Update AI summary to show collapse arrow
        if (this._aiSummaryItem.label.text) {
            this._aiSummaryItem.label.text = '🔽 ' + this._aiSummaryItem.label.text.replace('▶️ ', '');
        }
    }

    async _updateData() {
        try {
            // Collect all data
            const data = {
                weather: await DataCollector.getWeather(),
                calendar: await DataCollector.getCalendarEvents(),
                tasks: await DataCollector.getTasks(),
                system: await DataCollector.getSystemInfo()
            };

            // Get Claude insights
            const insights = await DataCollector.getClaudeInsights(data);
            data.insights = insights;

            // Store data for click handlers
            this._lastData = data;

            // Update display
            this._updateDisplay(data);
        } catch (error) {
            console.error('At A Glance: Error updating data:', error);
            this.buttonText.set_text('At A Glance: Error');
        }
    }

    _updateDisplay(data) {
        // Update main button with most urgent item
        const urgentDisplay = this._getMostUrgentDisplay(data);
        this.buttonText.set_text(urgentDisplay);

        // Update AI summary as primary content
        const aiText = data.insights.summary || 'Loading insights...';
        const expandIcon = this._showingDetails ? '🔽' : '▶️';
        this._aiSummaryItem.label.set_text(`${expandIcon} ${aiText}`);
        
        // Update detailed sections (shown when expanded)
        this._weatherItem.label.set_text(`🌤️ Weather: ${data.weather.temp}°F, ${data.weather.description}`);
        
        const nextEvent = data.calendar[0];
        const hasRealEvents = nextEvent && !nextEvent.title.includes('No calendar events');
        
        if (hasRealEvents) {
            this._calendarItem.label.set_text(`📅 Next: ${nextEvent.title} @ ${nextEvent.time}`);
            this._calendarItem.actor.show();
        } else {
            // Hide calendar section when no events scheduled
            this._calendarItem.actor.hide();
        }
        
        const urgentTasks = data.tasks.filter(t => t.priority === 'high');
        let taskText = '';
        if (urgentTasks.length > 0) {
            // Show actual high priority task titles
            const urgentTitles = urgentTasks.slice(0, 2).map(t => t.title).join(', ');
            const moreCount = urgentTasks.length > 2 ? ` (+${urgentTasks.length - 2} more)` : '';
            taskText = `📝 Urgent: ${urgentTitles}${moreCount}`;
        } else if (data.tasks.length > 0) {
            // Show regular tasks if no urgent ones
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

    _getMostUrgentDisplay(data) {
        // Priority order: System critical > Imminent events > Urgent tasks > Weather > Regular items
        
        // 1. System Critical Issues
        const lowBattery = data.system.battery !== 'N/A' && data.system.battery < 20;
        if (lowBattery) {
            return `🔋 ${data.system.battery}% battery`;
        }
        
        if (data.system.nixosIssues > 0) {
            return `⚠️ ${data.system.nixosStatus}`;
        }
        
        // 2. Imminent Calendar Events (< 15 minutes)
        const nextEvent = data.calendar[0];
        if (nextEvent && !nextEvent.title.includes('No calendar events')) {
            // Check if event is starting soon (simplified time check)
            const eventTime = nextEvent.time;
            if (eventTime && eventTime.includes('min')) {
                return `🚨 ${nextEvent.title} in ${eventTime}`;
            } else if (eventTime && (eventTime.includes('Now') || eventTime.includes('Soon'))) {
                return `🚨 ${nextEvent.title} starting`;
            } else if (nextEvent.location && nextEvent.location.includes('Virtual')) {
                return `🎥 ${nextEvent.title} @ ${eventTime}`;
            } else if (nextEvent.location) {
                return `📍 ${nextEvent.title} @ ${eventTime}`;
            } else {
                return `📅 ${nextEvent.title} @ ${eventTime}`;
            }
        }
        
        // 3. Urgent Tasks (high priority only)
        const urgentTasks = data.tasks.filter(t => t.priority === 'high');
        if (urgentTasks.length > 0) {
            const firstUrgent = urgentTasks[0].title;
            const icon = urgentTasks.length > 1 ? '🎯' : '⚡';
            const suffix = urgentTasks.length > 1 ? ` (+${urgentTasks.length - 1})` : '';
            return `${icon} ${firstUrgent}${suffix}`;
        }
        
        // 4. Tasks with due dates (today or overdue only)
        const todayTasks = data.tasks.filter(t => {
            if (!t.due) return false;
            const dueDate = t.due.toLowerCase();
            return dueDate.includes('today') || dueDate.includes('overdue') || 
                   dueDate.includes('hour') || dueDate.includes('min');
        });
        
        if (todayTasks.length > 0) {
            const nextTask = todayTasks[0].title;
            return `⏰ ${nextTask}`;
        }
        
        // 5. Weather (with appropriate icon)
        const temp = data.weather.temp;
        const condition = data.weather.condition;
        let weatherIcon = '📊'; // default
        
        if (condition.includes('Thunder')) weatherIcon = '⛈️';
        else if (condition.includes('Rain')) weatherIcon = '🌧️';
        else if (condition.includes('Snow')) weatherIcon = '🌨️';
        else if (condition.includes('Fog')) weatherIcon = '🌫️';
        else if (condition.includes('Cloud')) weatherIcon = '☁️';
        else if (condition.includes('Clear') || condition.includes('Sunny')) weatherIcon = '☀️';
        else weatherIcon = '⛅'; // partly cloudy default
        
        return `${weatherIcon} ${temp}°F ${condition}`;
    }

    _handleWeatherClick() {
        // Open Rochester Hills weather details  
        try {
            Gio.AppInfo.launch_default_for_uri('https://openweathermap.org/city/5007402', null);
        } catch (e) {
            Main.notify('At A Glance', 'Opening weather details...');
        }
    }

    _handleCalendarClick() {
        // Try to open GNOME Calendar
        try {
            const calendar = Gio.AppInfo.create_from_commandline('gnome-calendar', 'Calendar', Gio.AppInfoCreateFlags.NONE);
            calendar.launch([], null);
        } catch (e) {
            Main.notify('At A Glance', 'Could not open calendar app');
        }
    }

    _handleTasksClick() {
        // Show task completion options or open Todoist
        const urgentTasks = this._lastData?.tasks?.filter(t => t.priority === 'high') || [];
        
        if (urgentTasks.length > 0) {
            // For now, just show a notification with the urgent task
            const task = urgentTasks[0];
            Main.notify('At A Glance', `Urgent: ${task.title}`);
            
            // Future: Could add task completion functionality here
            // or open Todoist web app
        } else {
            // Open Todoist
            try {
                Gio.AppInfo.launch_default_for_uri('https://todoist.com/app', null);
            } catch (e) {
                Main.notify('At A Glance', 'Could not open Todoist');
            }
        }
    }

    _handleSystemClick() {
        // Open system monitor or show system info
        try {
            const monitor = Gio.AppInfo.create_from_commandline('gnome-system-monitor', 'System Monitor', Gio.AppInfoCreateFlags.NONE);
            monitor.launch([], null);
        } catch (e) {
            // Fallback: show system info notification
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