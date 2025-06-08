// todoist-integration.js - Todoist API integration for At A Glance extension
const { Soup, GLib } = imports.gi;

const TodoistIntegration = {
    API_BASE_URL: 'https://api.todoist.com/rest/v2',
    API_TOKEN: '', // Will be loaded from config
    
    // Cache for API responses
    cache: {
        tasks: null,
        projects: null,
        labels: null,
        lastUpdate: 0
    },
    
    // Cache duration: 5 minutes (Todoist has generous rate limits)
    CACHE_DURATION: 300,

    async initialize(apiToken) {
        this.API_TOKEN = apiToken;
        
        // Create HTTP session for API requests
        this.httpSession = new Soup.Session();
        
        // Fetch initial data
        await this.refreshCache();
    },

    async makeRequest(endpoint, method = 'GET', data = null) {
        const url = `${this.API_BASE_URL}/${endpoint}`;
        const message = Soup.Message.new(method, url);
        
        // Add authentication header
        message.request_headers.append('Authorization', `Bearer ${this.API_TOKEN}`);
        message.request_headers.append('Content-Type', 'application/json');
        
        if (data) {
            message.set_request('application/json', Soup.MemoryUse.COPY, JSON.stringify(data));
        }
        
        return new Promise((resolve, reject) => {
            this.httpSession.queue_message(message, (session, message) => {
                if (message.status_code === 200) {
                    try {
                        const response = JSON.parse(message.response_body.data);
                        resolve(response);
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`Todoist API error: ${message.status_code}`));
                }
            });
        });
    },

    async refreshCache() {
        const now = Date.now();
        
        if (this.cache.lastUpdate && (now - this.cache.lastUpdate) < this.CACHE_DURATION * 1000) {
            return; // Cache is still valid
        }
        
        try {
            // Fetch all active tasks
            const tasks = await this.makeRequest('tasks');
            
            // Fetch projects for context
            const projects = await this.makeRequest('projects');
            
            // Fetch labels
            const labels = await this.makeRequest('labels');
            
            // Update cache
            this.cache = {
                tasks: tasks,
                projects: projects,
                labels: labels,
                lastUpdate: now
            };
            
            log(`Todoist cache updated: ${tasks.length} tasks, ${projects.length} projects`);
        } catch (e) {
            log(`Failed to update Todoist cache: ${e}`);
        }
    },

    async getTodaysTasks() {
        await this.refreshCache();
        
        if (!this.cache.tasks) return [];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        return this.cache.tasks.filter(task => {
            if (!task.due) return false;
            
            const dueDate = new Date(task.due.date);
            return dueDate >= today && dueDate < tomorrow;
        }).map(task => this._enrichTask(task));
    },

    async getUpcomingTasks(days = 7) {
        await this.refreshCache();
        
        if (!this.cache.tasks) return [];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const future = new Date(today);
        future.setDate(future.getDate() + days);
        
        return this.cache.tasks.filter(task => {
            if (!task.due) return false;
            
            const dueDate = new Date(task.due.date);
            return dueDate >= today && dueDate < future;
        }).sort((a, b) => {
            const dateA = new Date(a.due.date);
            const dateB = new Date(b.due.date);
            return dateA - dateB;
        }).map(task => this._enrichTask(task));
    },

    async getOverdueTasks() {
        await this.refreshCache();
        
        if (!this.cache.tasks) return [];
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        return this.cache.tasks.filter(task => {
            if (!task.due) return false;
            
            const dueDate = new Date(task.due.date);
            return dueDate < today;
        }).map(task => this._enrichTask(task));
    },

    async getHighPriorityTasks() {
        await this.refreshCache();
        
        if (!this.cache.tasks) return [];
        
        // Priority 4 = P1 (highest), Priority 1 = P4 (lowest)
        return this.cache.tasks.filter(task => task.priority >= 3)
            .map(task => this._enrichTask(task));
    },

    _enrichTask(task) {
        // Add project name
        const project = this.cache.projects.find(p => p.id === task.project_id);
        
        // Add label names
        const labelNames = task.label_ids.map(labelId => {
            const label = this.cache.labels.find(l => l.id === labelId);
            return label ? label.name : null;
        }).filter(Boolean);
        
        // Parse due date/time
        let dueString = '';
        let isOverdue = false;
        
        if (task.due) {
            const dueDate = new Date(task.due.date);
            const now = new Date();
            
            if (task.due.datetime) {
                // Has specific time
                const dueDateTime = new Date(task.due.datetime);
                const hoursUntil = (dueDateTime - now) / (1000 * 60 * 60);
                
                if (hoursUntil < 0) {
                    isOverdue = true;
                    dueString = 'Overdue';
                } else if (hoursUntil < 1) {
                    dueString = `${Math.round(hoursUntil * 60)}m`;
                } else if (hoursUntil < 24) {
                    dueString = dueDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } else {
                    dueString = dueDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                }
            } else {
                // All day task
                const daysUntil = Math.floor((dueDate - now) / (1000 * 60 * 60 * 24));
                
                if (daysUntil < 0) {
                    isOverdue = true;
                    dueString = 'Overdue';
                } else if (daysUntil === 0) {
                    dueString = 'Today';
                } else if (daysUntil === 1) {
                    dueString = 'Tomorrow';
                } else if (daysUntil < 7) {
                    dueString = dueDate.toLocaleDateString([], { weekday: 'short' });
                } else {
                    dueString = dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }
            }
        }
        
        return {
            id: task.id,
            content: task.content,
            description: task.description,
            priority: task.priority,
            priorityName: this._getPriorityName(task.priority),
            project: project ? project.name : null,
            projectColor: project ? project.color : null,
            labels: labelNames,
            due: dueString,
            isOverdue: isOverdue,
            isToday: task.due && task.due.date === new Date().toISOString().split('T')[0],
            hasTime: task.due && task.due.datetime,
            url: task.url,
            commentCount: task.comment_count
        };
    },

    _getPriorityName(priority) {
        switch (priority) {
            case 4: return 'P1';
            case 3: return 'P2';
            case 2: return 'P3';
            case 1: return 'P4';
            default: return null;
        }
    },

    async completeTask(taskId) {
        try {
            await this.makeRequest(`tasks/${taskId}/close`, 'POST');
            
            // Remove from cache
            if (this.cache.tasks) {
                this.cache.tasks = this.cache.tasks.filter(t => t.id !== taskId);
            }
            
            return true;
        } catch (e) {
            log(`Failed to complete task: ${e}`);
            return false;
        }
    },

    // Quick add task (for future enhancement)
    async quickAddTask(content, due = null) {
        try {
            const taskData = {
                content: content,
                due_string: due // Natural language like "tomorrow at 2pm"
            };
            
            const newTask = await this.makeRequest('tasks', 'POST', taskData);
            
            // Add to cache
            if (this.cache.tasks) {
                this.cache.tasks.push(newTask);
            }
            
            return newTask;
        } catch (e) {
            log(`Failed to add task: ${e}`);
            return null;
        }
    },

    // Format tasks for display
    formatTasksForDisplay(tasks, maxTasks = 3) {
        const formatted = tasks.slice(0, maxTasks).map(task => {
            let displayText = task.content;
            
            if (task.priority >= 3) {
                displayText = `[${task.priorityName}] ${displayText}`;
            }
            
            if (task.due && task.due !== 'Today') {
                displayText += ` (${task.due})`;
            }
            
            return {
                short: displayText,
                full: `${task.content}${task.project ? ` - ${task.project}` : ''}`,
                task: task
            };
        });
        
        return formatted;
    },

    // Get summary statistics
    async getTaskStats() {
        await this.refreshCache();
        
        if (!this.cache.tasks) return null;
        
        const todayTasks = await this.getTodaysTasks();
        const overdueTasks = await this.getOverdueTasks();
        const highPriorityTasks = this.cache.tasks.filter(t => t.priority >= 3);
        
        return {
            total: this.cache.tasks.length,
            today: todayTasks.length,
            overdue: overdueTasks.length,
            highPriority: highPriorityTasks.length,
            projects: this.cache.projects.length
        };
    }
};

// Integration with main extension's DataCollector
DataCollector.getTasks = async function() {
    try {
        // Get API token from config
        const configFile = Gio.File.new_for_path(
            GLib.get_home_dir() + '/.config/at-a-glance/config.json'
        );
        
        const [success, contents] = configFile.load_contents(null);
        if (!success) {
            log('Todoist: No config file found');
            return [];
        }
        
        const config = JSON.parse(contents);
        if (!config.todoist_api_key) {
            log('Todoist: No API key configured');
            return [];
        }
        
        // Initialize Todoist if needed
        if (!TodoistIntegration.API_TOKEN) {
            await TodoistIntegration.initialize(config.todoist_api_key);
        }
        
        // Get today's tasks
        const todayTasks = await TodoistIntegration.getTodaysTasks();
        const overdueTasks = await TodoistIntegration.getOverdueTasks();
        
        // Combine and prioritize
        const allTasks = [...overdueTasks, ...todayTasks];
        
        // Sort by priority and due time
        allTasks.sort((a, b) => {
            if (a.isOverdue && !b.isOverdue) return -1;
            if (!a.isOverdue && b.isOverdue) return 1;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return 0;
        });
        
        // Format for the extension
        return allTasks.map(task => ({
            title: task.content,
            priority: task.priorityName || 'normal',
            project: task.project,
            labels: task.labels,
            due: task.due,
            isOverdue: task.isOverdue,
            raw: task // Keep raw data for Claude
        }));
        
    } catch (e) {
        log(`Error getting Todoist tasks: ${e}`);
        return [];
    }
};

// Example menu item for completing tasks
const TodoistMenuItem = GObject.registerClass(
class TodoistMenuItem extends PopupMenu.PopupMenuItem {
    _init(task) {
        super._init(task.content);
        this.task = task;
        
        // Add checkbox
        this.checkbox = new St.Icon({
            icon_name: 'checkbox-symbolic',
            style_class: 'popup-menu-icon'
        });
        this.insert_child_at_index(this.checkbox, 0);
        
        // Connect activation to complete task
        this.connect('activate', async () => {
            const success = await TodoistIntegration.completeTask(task.id);
            if (success) {
                this.checkbox.icon_name = 'checkbox-checked-symbolic';
                Main.notify('Task completed!', task.content);
            }
        });
    }
});