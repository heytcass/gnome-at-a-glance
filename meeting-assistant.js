// meeting-assistant.js - Intelligent meeting assistance for GNOME At A Glance
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class MeetingAssistant {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 15 * 60 * 1000; // 15 minutes
        this.meetingLinkPatterns = [
            // Zoom patterns
            /https?:\/\/(?:[\w-]+\.)?zoom\.us\/j\/[\w?=-]+/gi,
            /https?:\/\/(?:[\w-]+\.)?zoom\.us\/meeting\/[\w?=-]+/gi,
            
            // Google Meet patterns
            /https?:\/\/meet\.google\.com\/[\w-]+/gi,
            
            // Microsoft Teams patterns
            /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[\w%?=-]+/gi,
            /https?:\/\/teams\.live\.com\/meet\/[\w%?=-]+/gi,
            
            // WebEx patterns
            /https?:\/\/[\w-]+\.webex\.com\/meet\/[\w.-]+/gi,
            /https?:\/\/[\w-]+\.webex\.com\/join\/[\w.-]+/gi,
            
            // Generic meeting URLs (common patterns)
            /https?:\/\/[\w.-]+\/(?:meet|join|meeting|call)\/[\w.-]+/gi,
            
            // Jitsi Meet patterns
            /https?:\/\/meet\.jit\.si\/[\w-]+/gi,
            
            // GoToMeeting patterns
            /https?:\/\/(?:www\.)?gotomeeting\.com\/join\/[\w-]+/gi
        ];
        
        this.urgentKeywords = [
            'urgent', 'asap', 'emergency', 'critical', 'immediate',
            '1:1', 'one-on-one', 'interview', 'all-hands', 'standup',
            'deadline', 'review', 'demo', 'presentation', 'client'
        ];
        
        this.preparationKeywords = [
            'agenda', 'materials', 'slides', 'document', 'prep',
            'review', 'read', 'prepare', 'bring', 'requirements'
        ];
    }

    extractMeetingLinks(event) {
        const text = `${event.title || ''} ${event.description || ''}`;
        const links = [];
        
        for (const pattern of this.meetingLinkPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                links.push(...matches.map(link => ({
                    url: link,
                    type: this.detectMeetingPlatform(link),
                    confidence: this.calculateLinkConfidence(link, text)
                })));
            }
        }
        
        // Sort by confidence and remove duplicates
        return links
            .filter((link, index, self) => 
                index === self.findIndex(l => l.url === link.url))
            .sort((a, b) => b.confidence - a.confidence);
    }

    detectMeetingPlatform(url) {
        const lowerUrl = url.toLowerCase();
        
        if (lowerUrl.includes('zoom.us')) return 'zoom';
        if (lowerUrl.includes('meet.google.com')) return 'google-meet';
        if (lowerUrl.includes('teams.microsoft.com') || lowerUrl.includes('teams.live.com')) return 'teams';
        if (lowerUrl.includes('webex.com')) return 'webex';
        if (lowerUrl.includes('meet.jit.si')) return 'jitsi';
        if (lowerUrl.includes('gotomeeting.com')) return 'gotomeeting';
        
        return 'generic';
    }

    calculateLinkConfidence(url, context) {
        let confidence = 0.5; // Base confidence
        
        // Higher confidence for well-known platforms
        const platform = this.detectMeetingPlatform(url);
        const platformConfidence = {
            'zoom': 0.9,
            'google-meet': 0.9,
            'teams': 0.9,
            'webex': 0.8,
            'jitsi': 0.7,
            'gotomeeting': 0.7,
            'generic': 0.6
        };
        
        confidence = Math.max(confidence, platformConfidence[platform] || 0.5);
        
        // Boost confidence if surrounded by meeting-related context
        const meetingContext = ['meeting', 'call', 'conference', 'join', 'dial-in'].some(
            keyword => context.toLowerCase().includes(keyword)
        );
        if (meetingContext) confidence += 0.1;
        
        return Math.min(confidence, 1.0);
    }

    calculateMeetingUrgency(event) {
        const text = `${event.title || ''} ${event.description || ''}`.toLowerCase();
        let urgency = 'medium';
        
        // Check for urgent keywords
        const hasUrgentKeyword = this.urgentKeywords.some(keyword => 
            text.includes(keyword.toLowerCase())
        );
        
        if (hasUrgentKeyword) urgency = 'high';
        
        // Check meeting duration and attendee count (if available)
        const duration = event.duration || 0;
        if (duration > 2 * 60 * 60) { // > 2 hours
            urgency = urgency === 'high' ? 'high' : 'medium-high';
        } else if (duration < 15 * 60) { // < 15 minutes
            urgency = urgency === 'high' ? 'high' : 'low';
        }
        
        return urgency;
    }

    generatePreparationTasks(event) {
        const text = `${event.title || ''} ${event.description || ''}`;
        const tasks = [];
        
        // Extract preparation-related content
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            
            // Check if line contains preparation keywords
            const hasPreparationKeyword = this.preparationKeywords.some(keyword =>
                lowerLine.includes(keyword)
            );
            
            if (hasPreparationKeyword) {
                tasks.push({
                    task: line.trim(),
                    type: 'preparation',
                    priority: this.calculateTaskPriority(line)
                });
            }
            
            // Extract URLs for documents/resources
            const urlMatches = line.match(/https?:\/\/[^\s]+/g);
            if (urlMatches) {
                urlMatches.forEach(url => {
                    if (!this.meetingLinkPatterns.some(pattern => pattern.test(url))) {
                        tasks.push({
                            task: `Review document: ${url}`,
                            type: 'document',
                            priority: 'medium',
                            url: url
                        });
                    }
                });
            }
        }
        
        // Add default preparation tasks based on meeting type
        const meetingType = this.detectMeetingType(event);
        const defaultTasks = this.getDefaultPreparationTasks(meetingType);
        tasks.push(...defaultTasks);
        
        return tasks.slice(0, 5); // Limit to 5 tasks to avoid overwhelming
    }

    detectMeetingType(event) {
        const text = `${event.title || ''} ${event.description || ''}`.toLowerCase();
        
        if (text.includes('standup') || text.includes('daily')) return 'standup';
        if (text.includes('1:1') || text.includes('one-on-one')) return 'one-on-one';
        if (text.includes('interview')) return 'interview';
        if (text.includes('all-hands') || text.includes('town hall')) return 'all-hands';
        if (text.includes('demo') || text.includes('presentation')) return 'presentation';
        if (text.includes('review')) return 'review';
        if (text.includes('client') || text.includes('customer')) return 'client';
        
        return 'general';
    }

    getDefaultPreparationTasks(meetingType) {
        const defaultTasks = {
            'standup': [
                { task: 'Review yesterday\'s work progress', type: 'preparation', priority: 'high' },
                { task: 'Prepare today\'s priorities', type: 'preparation', priority: 'high' }
            ],
            'one-on-one': [
                { task: 'Review recent work and feedback', type: 'preparation', priority: 'medium' },
                { task: 'Prepare discussion points', type: 'preparation', priority: 'medium' }
            ],
            'interview': [
                { task: 'Research company and role', type: 'preparation', priority: 'high' },
                { task: 'Prepare questions to ask', type: 'preparation', priority: 'high' },
                { task: 'Review resume and examples', type: 'preparation', priority: 'high' }
            ],
            'presentation': [
                { task: 'Test slides and technical setup', type: 'preparation', priority: 'high' },
                { task: 'Prepare for Q&A session', type: 'preparation', priority: 'medium' }
            ],
            'client': [
                { task: 'Review client account history', type: 'preparation', priority: 'high' },
                { task: 'Prepare project updates', type: 'preparation', priority: 'medium' }
            ],
            'general': [
                { task: 'Review meeting agenda', type: 'preparation', priority: 'medium' }
            ]
        };
        
        return defaultTasks[meetingType] || defaultTasks['general'];
    }

    calculateTaskPriority(taskText) {
        const text = taskText.toLowerCase();
        
        if (text.includes('urgent') || text.includes('critical') || text.includes('required')) {
            return 'high';
        }
        if (text.includes('recommended') || text.includes('helpful') || text.includes('optional')) {
            return 'low';
        }
        
        return 'medium';
    }

    calculatePreparationTime(event) {
        const meetingType = this.detectMeetingType(event);
        const urgency = this.calculateMeetingUrgency(event);
        const duration = event.duration || 60 * 60; // Default 1 hour
        
        // Base preparation time based on meeting type
        const baseTime = {
            'standup': 2,
            'one-on-one': 5,
            'interview': 30,
            'all-hands': 0,
            'presentation': 15,
            'review': 10,
            'client': 15,
            'general': 5
        };
        
        let prepTime = baseTime[meetingType] || 5;
        
        // Adjust based on urgency
        if (urgency === 'high') prepTime *= 1.5;
        if (urgency === 'low') prepTime *= 0.5;
        
        // Adjust based on duration
        if (duration > 2 * 60 * 60) prepTime *= 1.5; // Long meetings need more prep
        if (duration < 15 * 60) prepTime *= 0.5; // Short meetings need less prep
        
        return Math.max(2, Math.min(30, Math.round(prepTime))); // Between 2-30 minutes
    }

    generateMeetingContext(event) {
        const cacheKey = `meeting_context_${event.id || event.title}_${event.start}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;
        
        const links = this.extractMeetingLinks(event);
        const urgency = this.calculateMeetingUrgency(event);
        const preparationTasks = this.generatePreparationTasks(event);
        const preparationTime = this.calculatePreparationTime(event);
        const meetingType = this.detectMeetingType(event);
        
        const context = {
            event: event,
            links: links,
            urgency: urgency,
            preparationTasks: preparationTasks,
            preparationTime: preparationTime,
            meetingType: meetingType,
            primaryLink: links.length > 0 ? links[0] : null,
            hasPreparation: preparationTasks.length > 0,
            timestamp: Date.now()
        };
        
        this.setCached(cacheKey, context);
        return context;
    }

    getUpcomingMeetingsWithContext(events) {
        const now = new Date();
        const next4Hours = new Date(now.getTime() + 4 * 60 * 60 * 1000);
        
        return events
            .filter(event => {
                const eventStart = new Date(event.start);
                return eventStart >= now && eventStart <= next4Hours;
            })
            .map(event => this.generateMeetingContext(event))
            .sort((a, b) => new Date(a.event.start) - new Date(b.event.start));
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < this.cacheTimeout) {
                return cached.data;
            } else {
                this.cache.delete(key);
            }
        }
        return null;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    // Method to get the most important meeting information for Claude AI
    getMeetingContextForAI(events) {
        const upcomingMeetings = this.getUpcomingMeetingsWithContext(events);
        
        if (upcomingMeetings.length === 0) {
            return {
                hasMeetings: false,
                summary: 'No meetings in next 4 hours'
            };
        }
        
        const nextMeeting = upcomingMeetings[0];
        const timeUntil = Math.round((new Date(nextMeeting.event.start) - new Date()) / (1000 * 60));
        
        return {
            hasMeetings: true,
            nextMeeting: {
                title: nextMeeting.event.title || 'Untitled Meeting',
                timeUntil: timeUntil,
                urgency: nextMeeting.urgency,
                hasLink: nextMeeting.links.length > 0,
                hasPreparation: nextMeeting.hasPreparation,
                preparationTime: nextMeeting.preparationTime,
                meetingType: nextMeeting.meetingType
            },
            totalUpcoming: upcomingMeetings.length,
            summary: this.generateMeetingSummary(upcomingMeetings)
        };
    }

    generateMeetingSummary(meetings) {
        if (meetings.length === 0) return 'No meetings scheduled';
        if (meetings.length === 1) {
            const meeting = meetings[0];
            const timeUntil = Math.round((new Date(meeting.event.start) - new Date()) / (1000 * 60));
            return `${meeting.event.title} in ${timeUntil}min`;
        }
        
        const highUrgency = meetings.filter(m => m.urgency === 'high').length;
        if (highUrgency > 0) {
            return `${meetings.length} meetings (${highUrgency} urgent)`;
        }
        
        return `${meetings.length} meetings upcoming`;
    }
}