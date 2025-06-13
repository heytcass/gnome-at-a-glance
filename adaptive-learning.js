// adaptive-learning.js - User behavior tracking and adaptive learning for GNOME At A Glance
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class AdaptiveLearning {
    constructor() {
        this.patternsFile = GLib.get_home_dir() + '/.config/at-a-glance/user-patterns.json';
        this.learningDataFile = GLib.get_home_dir() + '/.config/at-a-glance/learning-data.json';
        this.patterns = this.loadPatterns();
        this.learningData = this.loadLearningData();
        this.sessionStart = Date.now();
        this.currentSession = {
            interactions: [],
            startTime: this.sessionStart,
            timeOfDay: this.getTimeOfDay(),
            dayOfWeek: new Date().getDay()
        };
        
        // Learning thresholds
        this.minInteractionsForPattern = 5;
        this.confidenceThreshold = 0.7;
        this.maxPatternAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        this.ensureDataFiles();
    }

    ensureDataFiles() {
        try {
            const configDir = GLib.get_home_dir() + '/.config/at-a-glance';
            const dir = Gio.File.new_for_path(configDir);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }
            
            // Initialize patterns file if it doesn't exist
            const patternsFile = Gio.File.new_for_path(this.patternsFile);
            if (!patternsFile.query_exists(null)) {
                const initialPatterns = {
                    interactionPatterns: {},
                    priorityWeights: {
                        weather: 0.3,
                        calendar: 0.4,
                        tasks: 0.5,
                        meetings: 0.6,
                        system: 0.2
                    },
                    timePreferences: {},
                    contentPreferences: {},
                    lastUpdated: Date.now()
                };
                this.savePatterns(initialPatterns);
            }
            
            // Initialize learning data file if it doesn't exist
            const learningFile = Gio.File.new_for_path(this.learningDataFile);
            if (!learningFile.query_exists(null)) {
                const initialLearning = {
                    sessions: [],
                    interactions: [],
                    preferences: {},
                    statistics: {
                        totalSessions: 0,
                        totalInteractions: 0,
                        averageSessionLength: 0,
                        mostActiveTimeOfDay: 'morning',
                        mostClickedContentType: 'unknown'
                    },
                    lastUpdated: Date.now()
                };
                this.saveLearningData(initialLearning);
            }
        } catch (error) {
            console.error('At A Glance: Error ensuring adaptive learning data files:', error);
        }
    }

    loadPatterns() {
        try {
            const patternsFile = Gio.File.new_for_path(this.patternsFile);
            if (patternsFile.query_exists(null)) {
                const [success, contents] = patternsFile.load_contents(null);
                if (success) {
                    return JSON.parse(new TextDecoder().decode(contents));
                }
            }
        } catch (error) {
            console.error('At A Glance: Error loading patterns:', error);
        }
        
        // Return default patterns
        return {
            interactionPatterns: {},
            priorityWeights: {
                weather: 0.3,
                calendar: 0.4,
                tasks: 0.5,
                meetings: 0.6,
                system: 0.2
            },
            timePreferences: {},
            contentPreferences: {},
            lastUpdated: Date.now()
        };
    }

    loadLearningData() {
        try {
            const learningFile = Gio.File.new_for_path(this.learningDataFile);
            if (learningFile.query_exists(null)) {
                const [success, contents] = learningFile.load_contents(null);
                if (success) {
                    return JSON.parse(new TextDecoder().decode(contents));
                }
            }
        } catch (error) {
            console.error('At A Glance: Error loading learning data:', error);
        }
        
        // Return default learning data
        return {
            sessions: [],
            interactions: [],
            preferences: {},
            statistics: {
                totalSessions: 0,
                totalInteractions: 0,
                averageSessionLength: 0,
                mostActiveTimeOfDay: 'morning',
                mostClickedContentType: 'unknown'
            },
            lastUpdated: Date.now()
        };
    }

    savePatterns(patterns = this.patterns) {
        try {
            const patternsFile = Gio.File.new_for_path(this.patternsFile);
            patterns.lastUpdated = Date.now();
            patternsFile.replace_contents(
                JSON.stringify(patterns, null, 2),
                null, false,
                Gio.FileCreateFlags.NONE,
                null
            );
            this.patterns = patterns;
        } catch (error) {
            console.error('At A Glance: Error saving patterns:', error);
        }
    }

    saveLearningData(data = this.learningData) {
        try {
            const learningFile = Gio.File.new_for_path(this.learningDataFile);
            data.lastUpdated = Date.now();
            this.learningData = data;
            learningFile.replace_contents(
                JSON.stringify(data, null, 2),
                null, false,
                Gio.FileCreateFlags.NONE,
                null
            );
        } catch (error) {
            console.error('At A Glance: Error saving learning data:', error);
        }
    }

    getTimeOfDay() {
        const hour = new Date().getHours();
        if (hour < 6) return 'night';
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        if (hour < 21) return 'evening';
        return 'night';
    }

    // Track user interactions
    recordInteraction(type, data = {}) {
        const interaction = {
            type: type, // 'click', 'view', 'dismiss', 'task_complete', 'weather_check', etc.
            timestamp: Date.now(),
            timeOfDay: this.getTimeOfDay(),
            dayOfWeek: new Date().getDay(),
            data: data
        };
        
        this.currentSession.interactions.push(interaction);
        this.learningData.interactions.push(interaction);
        
        console.log(`At A Glance: Recorded interaction: ${type}`, data);
        
        // Update patterns based on interaction
        this.updatePatternsFromInteraction(interaction);
        
        // Limit stored interactions to last 1000
        if (this.learningData.interactions.length > 1000) {
            this.learningData.interactions = this.learningData.interactions.slice(-1000);
        }
        
        this.saveLearningData();
    }

    updatePatternsFromInteraction(interaction) {
        const { type, timeOfDay, dayOfWeek, data } = interaction;
        
        // Update time preferences
        if (!this.patterns.timePreferences[timeOfDay]) {
            this.patterns.timePreferences[timeOfDay] = {};
        }
        if (!this.patterns.timePreferences[timeOfDay][type]) {
            this.patterns.timePreferences[timeOfDay][type] = 0;
        }
        this.patterns.timePreferences[timeOfDay][type]++;
        
        // Update content preferences based on what user clicks
        if (data.contentType) {
            if (!this.patterns.contentPreferences[data.contentType]) {
                this.patterns.contentPreferences[data.contentType] = {
                    clicks: 0,
                    views: 0,
                    dismissals: 0
                };
            }
            
            if (type === 'click') {
                this.patterns.contentPreferences[data.contentType].clicks++;
            } else if (type === 'view') {
                this.patterns.contentPreferences[data.contentType].views++;
            } else if (type === 'dismiss') {
                this.patterns.contentPreferences[data.contentType].dismissals++;
            }
        }
        
        // Update priority weights based on user behavior
        this.updatePriorityWeights(interaction);
        
        this.savePatterns();
    }

    updatePriorityWeights(interaction) {
        const { type, data } = interaction;
        
        if (type === 'click' && data.contentType) {
            const contentType = data.contentType;
            const currentWeight = this.patterns.priorityWeights[contentType] || 0.3;
            
            // Increase weight for clicked content (with diminishing returns)
            const increment = Math.max(0.01, (1 - currentWeight) * 0.1);
            this.patterns.priorityWeights[contentType] = Math.min(1.0, currentWeight + increment);
            
            // Slightly decrease weights for other content types
            for (const [type, weight] of Object.entries(this.patterns.priorityWeights)) {
                if (type !== contentType) {
                    this.patterns.priorityWeights[type] = Math.max(0.1, weight * 0.99);
                }
            }
        }
        
        if (type === 'dismiss' && data.contentType) {
            const contentType = data.contentType;
            const currentWeight = this.patterns.priorityWeights[contentType] || 0.3;
            
            // Decrease weight for dismissed content
            const decrement = currentWeight * 0.05;
            this.patterns.priorityWeights[contentType] = Math.max(0.1, currentWeight - decrement);
        }
    }

    // Get personalized priority weights
    getPersonalizedWeights() {
        const timeOfDay = this.getTimeOfDay();
        const baseWeights = { ...this.patterns.priorityWeights };
        
        // Adjust weights based on time preferences
        if (this.patterns.timePreferences[timeOfDay]) {
            const timePrefs = this.patterns.timePreferences[timeOfDay];
            const totalTimeInteractions = Object.values(timePrefs).reduce((sum, count) => sum + count, 0);
            
            if (totalTimeInteractions > this.minInteractionsForPattern) {
                for (const [contentType, count] of Object.entries(timePrefs)) {
                    const preference = count / totalTimeInteractions;
                    if (baseWeights[contentType]) {
                        // Blend base weight with time-based preference
                        baseWeights[contentType] = (baseWeights[contentType] * 0.7) + (preference * 0.3);
                    }
                }
            }
        }
        
        return baseWeights;
    }

    // Predict user interest in content type
    predictUserInterest(contentType, context = {}) {
        const weights = this.getPersonalizedWeights();
        const baseInterest = weights[contentType] || 0.3;
        
        const timeOfDay = this.getTimeOfDay();
        const dayOfWeek = new Date().getDay();
        
        // Check historical patterns for this time/day
        let timeBonus = 0;
        if (this.patterns.timePreferences[timeOfDay] && this.patterns.timePreferences[timeOfDay][contentType]) {
            const timeInteractions = this.patterns.timePreferences[timeOfDay][contentType];
            const totalTimeInteractions = Object.values(this.patterns.timePreferences[timeOfDay]).reduce((sum, count) => sum + count, 0);
            if (totalTimeInteractions > 0) {
                timeBonus = (timeInteractions / totalTimeInteractions) * 0.2;
            }
        }
        
        // Content-specific adjustments
        let contentBonus = 0;
        if (this.patterns.contentPreferences[contentType]) {
            const prefs = this.patterns.contentPreferences[contentType];
            const totalContentInteractions = prefs.clicks + prefs.views + prefs.dismissals;
            if (totalContentInteractions > 0) {
                const positiveRatio = (prefs.clicks + prefs.views) / totalContentInteractions;
                contentBonus = (positiveRatio - 0.5) * 0.3; // -0.15 to +0.15
            }
        }
        
        return Math.max(0.1, Math.min(1.0, baseInterest + timeBonus + contentBonus));
    }

    // Get contextual insights for Claude AI
    getContextualInsights() {
        const timeOfDay = this.getTimeOfDay();
        const patterns = this.analyzeRecentPatterns();
        
        return {
            timeOfDay: timeOfDay,
            preferredContentTypes: this.getTopContentPreferences(),
            recentPatterns: patterns,
            sessionLength: (Date.now() - this.sessionStart) / (1000 * 60), // minutes
            interactionCount: this.currentSession.interactions.length,
            personalizedWeights: this.getPersonalizedWeights(),
            recommendations: this.generateRecommendations()
        };
    }

    analyzeRecentPatterns() {
        const recentThreshold = Date.now() - (7 * 24 * 60 * 60 * 1000); // Last 7 days
        const recentInteractions = this.learningData.interactions.filter(
            interaction => interaction.timestamp > recentThreshold
        );
        
        const patterns = {
            mostActiveTime: this.getMostActiveTimeOfDay(recentInteractions),
            averageSessionLength: this.calculateAverageSessionLength(),
            topContentTypes: this.getTopInteractedContent(recentInteractions),
            interactionTrends: this.calculateInteractionTrends(recentInteractions)
        };
        
        return patterns;
    }

    getMostActiveTimeOfDay(interactions) {
        const timeCounts = {};
        interactions.forEach(interaction => {
            const time = interaction.timeOfDay;
            timeCounts[time] = (timeCounts[time] || 0) + 1;
        });
        
        return Object.entries(timeCounts).reduce((max, [time, count]) => 
            count > (max.count || 0) ? { time, count } : max, {}
        ).time || 'morning';
    }

    getTopContentPreferences() {
        const prefs = [];
        for (const [contentType, data] of Object.entries(this.patterns.contentPreferences)) {
            const totalInteractions = data.clicks + data.views + data.dismissals;
            if (totalInteractions > 0) {
                const score = (data.clicks * 2 + data.views - data.dismissals) / totalInteractions;
                prefs.push({ contentType, score, interactions: totalInteractions });
            }
        }
        
        return prefs
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(p => p.contentType);
    }

    getTopInteractedContent(interactions) {
        const contentCounts = {};
        interactions.forEach(interaction => {
            if (interaction.data.contentType) {
                const type = interaction.data.contentType;
                contentCounts[type] = (contentCounts[type] || 0) + 1;
            }
        });
        
        return Object.entries(contentCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([type,]) => type);
    }

    calculateAverageSessionLength() {
        const sessions = this.learningData.sessions || [];
        if (sessions.length === 0) return 0;
        
        const totalLength = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
        return totalLength / sessions.length / (1000 * 60); // minutes
    }

    calculateInteractionTrends(interactions) {
        if (interactions.length < 10) return { trend: 'insufficient_data' };
        
        const dailyCounts = {};
        interactions.forEach(interaction => {
            const date = new Date(interaction.timestamp).toDateString();
            dailyCounts[date] = (dailyCounts[date] || 0) + 1;
        });
        
        const counts = Object.values(dailyCounts);
        const recentHalf = counts.slice(-Math.floor(counts.length / 2));
        const earlierHalf = counts.slice(0, Math.floor(counts.length / 2));
        
        const recentAvg = recentHalf.reduce((sum, count) => sum + count, 0) / recentHalf.length;
        const earlierAvg = earlierHalf.reduce((sum, count) => sum + count, 0) / earlierHalf.length;
        
        if (recentAvg > earlierAvg * 1.2) return { trend: 'increasing', change: (recentAvg - earlierAvg) / earlierAvg };
        if (recentAvg < earlierAvg * 0.8) return { trend: 'decreasing', change: (earlierAvg - recentAvg) / earlierAvg };
        return { trend: 'stable', change: 0 };
    }

    generateRecommendations() {
        const timeOfDay = this.getTimeOfDay();
        const weights = this.getPersonalizedWeights();
        const recommendations = [];
        
        // Time-based recommendations
        if (timeOfDay === 'morning') {
            recommendations.push({
                type: 'time_based',
                content: 'Good morning! Check your calendar and tasks for the day.',
                confidence: 0.8
            });
        } else if (timeOfDay === 'afternoon') {
            recommendations.push({
                type: 'time_based',
                content: 'Afternoon focus time - prioritize important tasks.',
                confidence: 0.7
            });
        } else if (timeOfDay === 'evening') {
            recommendations.push({
                type: 'time_based',
                content: 'Evening wrap-up - review completed tasks and plan tomorrow.',
                confidence: 0.6
            });
        }
        
        // Content-based recommendations
        const topContent = this.getTopContentPreferences();
        if (topContent.length > 0) {
            recommendations.push({
                type: 'preference_based',
                content: `You often interact with ${topContent[0]} - there might be updates to check.`,
                confidence: weights[topContent[0]] || 0.5
            });
        }
        
        return recommendations.filter(rec => rec.confidence > this.confidenceThreshold);
    }

    // End current session and record data
    endSession() {
        const sessionData = {
            ...this.currentSession,
            endTime: Date.now(),
            duration: Date.now() - this.sessionStart
        };
        
        this.learningData.sessions.push(sessionData);
        this.learningData.statistics.totalSessions++;
        this.learningData.statistics.totalInteractions += sessionData.interactions.length;
        
        // Update statistics
        this.updateStatistics();
        
        // Limit stored sessions to last 100
        if (this.learningData.sessions.length > 100) {
            this.learningData.sessions = this.learningData.sessions.slice(-100);
        }
        
        this.saveLearningData();
        
        // Start new session
        this.sessionStart = Date.now();
        this.currentSession = {
            interactions: [],
            startTime: this.sessionStart,
            timeOfDay: this.getTimeOfDay(),
            dayOfWeek: new Date().getDay()
        };
    }

    updateStatistics() {
        const stats = this.learningData.statistics;
        
        // Calculate average session length
        const sessions = this.learningData.sessions;
        if (sessions.length > 0) {
            const totalDuration = sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
            stats.averageSessionLength = totalDuration / sessions.length / (1000 * 60); // minutes
        }
        
        // Find most active time of day
        stats.mostActiveTimeOfDay = this.getMostActiveTimeOfDay(this.learningData.interactions);
        
        // Find most clicked content type
        const contentClicks = {};
        this.learningData.interactions.forEach(interaction => {
            if (interaction.type === 'click' && interaction.data.contentType) {
                const type = interaction.data.contentType;
                contentClicks[type] = (contentClicks[type] || 0) + 1;
            }
        });
        
        stats.mostClickedContentType = Object.entries(contentClicks).reduce(
            (max, [type, count]) => count > (max.count || 0) ? { type, count } : max, {}
        ).type || 'unknown';
    }

    // Clean old data
    cleanOldData() {
        const cutoff = Date.now() - this.maxPatternAge;
        
        // Clean old interactions
        this.learningData.interactions = this.learningData.interactions.filter(
            interaction => interaction.timestamp > cutoff
        );
        
        // Clean old sessions
        this.learningData.sessions = this.learningData.sessions.filter(
            session => session.startTime > cutoff
        );
        
        this.saveLearningData();
    }

    // Get learning summary for debugging
    getLearningStatus() {
        return {
            totalInteractions: this.learningData.interactions.length,
            totalSessions: this.learningData.sessions.length,
            currentSessionLength: (Date.now() - this.sessionStart) / (1000 * 60),
            patterns: this.patterns,
            statistics: this.learningData.statistics,
            personalizedWeights: this.getPersonalizedWeights()
        };
    }
}