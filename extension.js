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
        try {
            // Import EDS libraries dynamically when needed
            const ECal = await import('gi://ECal?version=2.0').then(m => m.default);
            const EDataServer = await import('gi://EDataServer?version=1.2').then(m => m.default);
            const ICalGLib = await import('gi://ICalGLib?version=3.0').then(m => m.default);
            
            console.log('At A Glance: EDS libraries loaded successfully');
            
            // Create registry with Promise wrapper
            const registry = await new Promise((resolve, reject) => {
                const cancellable = new Gio.Cancellable();
                EDataServer.SourceRegistry.new(cancellable, (source, result) => {
                    try {
                        const registry = EDataServer.SourceRegistry.new_finish(result);
                        resolve(registry);
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            
            const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
            console.log(`At A Glance: Found ${sources.length} calendar sources`);
            
            const events = [];
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const todayEnd = new Date(todayStart);
            todayEnd.setDate(todayEnd.getDate() + 1);
            
            for (const source of sources) {
                try {
                    if (!source.get_enabled()) continue;
                    
                    console.log(`At A Glance: Connecting to calendar: ${source.get_display_name()}`);
                    
                    // Connect to calendar client with Promise wrapper
                    const client = await new Promise((resolve, reject) => {
                        const cancellable = new Gio.Cancellable();
                        ECal.Client.connect(
                            source,
                            ECal.ClientSourceType.EVENTS,
                            30,
                            cancellable,
                            (source, result) => {
                                try {
                                    const client = ECal.Client.connect_finish(result);
                                    resolve(client);
                                } catch (error) {
                                    resolve(null); // Don't reject, just skip this source
                                }
                            }
                        );
                    });
                    
                    if (!client) continue;
                    
                    // Get events with Promise wrapper
                    const components = await new Promise((resolve, reject) => {
                        const cancellable = new Gio.Cancellable();
                        const startTime = Math.floor(todayStart.getTime() / 1000);
                        const endTime = Math.floor(todayEnd.getTime() / 1000);
                        const query = `(occur-in-time-range? (make-time \"${startTime}\") (make-time \"${endTime}\"))`;
                        
                        client.get_object_list_as_comps(query, cancellable, (client, result) => {
                            try {
                                const [success, comps] = client.get_object_list_as_comps_finish(result);
                                resolve(success ? comps || [] : []);
                            } catch (error) {
                                resolve([]);
                            }
                        });
                    });
                    
                    // Process events
                    for (const comp of components) {
                        try {
                            const event = comp.get_first_component(ICalGLib.ComponentKind.VEVENT);
                            if (event) {
                                const summary = event.get_summary();
                                const dtstart = event.get_dtstart();
                                const location = event.get_location();
                                
                                if (summary && dtstart) {
                                    const startDate = new Date(
                                        dtstart.get_year(),
                                        dtstart.get_month() - 1,
                                        dtstart.get_day(),
                                        dtstart.get_hour(),
                                        dtstart.get_minute()
                                    );
                                    
                                    const timeDiff = startDate - now;
                                    const minutesUntil = Math.round(timeDiff / (1000 * 60));
                                    
                                    let timeDisplay;
                                    if (minutesUntil < -60) {
                                        timeDisplay = 'Past';
                                    } else if (minutesUntil < 0) {
                                        timeDisplay = 'Now';
                                    } else if (minutesUntil < 60) {
                                        timeDisplay = `${minutesUntil}m`;
                                    } else {
                                        timeDisplay = startDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    }
                                    
                                    events.push({
                                        time: timeDisplay,
                                        title: summary,
                                        location: location || '',
                                        startTime: startDate,
                                        minutesUntil: minutesUntil
                                    });
                                }
                            }
                        } catch (e) {
                            console.log('At A Glance: Error parsing event:', e);
                        }
                    }
                    
                } catch (e) {
                    console.log(`At A Glance: Error accessing calendar ${source.get_display_name()}:`, e);
                }
            }
            
            // Sort events by start time
            events.sort((a, b) => a.startTime - b.startTime);
            
            if (events.length > 0) {
                console.log(`At A Glance: Successfully retrieved ${events.length} events`);
                return events.slice(0, 3);
            } else {
                console.log('At A Glance: No events found for today');
                return [];
            }
            
        } catch (error) {
            console.error('At A Glance: Calendar integration failed:', error);
            // Fallback to show calendar is available but had issues
            return [{
                time: 'Setup',
                title: 'Calendar integration available',
                location: 'Add events in GNOME Calendar'
            }];
        }
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
            const data = {
                weather: await DataCollector.getWeather(),
                calendar: await DataCollector.getCalendarEvents(),
                tasks: await DataCollector.getTasks(),
                system: await DataCollector.getSystemInfo()
            };

            const insights = await DataCollector.getClaudeInsights(data);
            data.insights = insights;

            this._lastData = data;
            this._updateDisplay(data);
        } catch (error) {
            console.error('At A Glance: Error updating data:', error);
            this.buttonText.set_text('📊 Error');
        }
    }

    _updateDisplay(data) {
        const urgentDisplay = this._getMostUrgentDisplay(data);
        this.buttonText.set_text(urgentDisplay);

        const aiText = data.insights.summary || 'Loading insights...';
        const expandIcon = this._showingDetails ? '🔽' : '▶️';
        this._aiSummaryItem.label.set_text(`${expandIcon} ${aiText}`);
        
        this._weatherItem.label.set_text(`🌤️ Weather: ${data.weather.temp}°F, ${data.weather.description}`);
        
        const nextEvent = data.calendar[0];
        if (nextEvent && data.calendar.length > 0) {
            this._calendarItem.label.set_text(`📅 Next: ${nextEvent.title} @ ${nextEvent.time}`);
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

    _getMostUrgentDisplay(data) {
        // System critical issues
        const lowBattery = data.system.battery !== 'N/A' && data.system.battery < 20;
        if (lowBattery) {
            return `🔋 ${data.system.battery}% battery`;
        }
        
        if (data.system.nixosIssues > 0) {
            return `⚠️ ${data.system.nixosStatus}`;
        }
        
        // Imminent calendar events
        const nextEvent = data.calendar[0];
        if (nextEvent && data.calendar.length > 0) {
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
        
        // Urgent tasks
        const urgentTasks = data.tasks.filter(t => t.priority === 'high');
        if (urgentTasks.length > 0) {
            const firstUrgent = urgentTasks[0].title;
            const icon = urgentTasks.length > 1 ? '🎯' : '⚡';
            const suffix = urgentTasks.length > 1 ? ` (+${urgentTasks.length - 1})` : '';
            return `${icon} ${firstUrgent}${suffix}`;
        }
        
        // Weather display
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