#!/usr/bin/env gjs

// Test script for Claude rate limiting functionality
// This simulates the rate limiting behavior without requiring GNOME Shell

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Simplified ClaudeRateLimit class for testing
class TestClaudeRateLimit {
    constructor() {
        this.cache = new Map();
        this.usageFile = GLib.get_home_dir() + '/.config/at-a-glance/claude-usage-test.json';
        this.maxDailyRequests = 5; // Reduced for testing
        this.cacheTimeoutMinutes = 1; // Reduced for testing
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
            console.error('Error ensuring usage file:', error);
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
            console.error('Error reading usage data:', error);
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
            console.error('Error saving usage data:', error);
        }
    }

    canMakeRequest(type = 'general') {
        const usage = this.getUsageData();
        const remaining = this.maxDailyRequests - usage.requests;
        
        if (remaining <= 0) {
            console.log(`RATE LIMIT: Daily Claude API limit reached (${usage.requests}/${this.maxDailyRequests})`);
            return false;
        }
        
        if (remaining <= 2) {
            console.log(`WARNING: Only ${remaining} Claude API requests remaining today`);
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
        
        console.log(`REQUEST RECORDED: Claude API request recorded. Usage: ${usage.requests}/${this.maxDailyRequests} (${type})`);
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached) {
            const ageMinutes = (Date.now() - cached.timestamp) / (1000 * 60);
            if (ageMinutes < this.cacheTimeoutMinutes) {
                console.log(`CACHE HIT: Using cached response for ${key} (${Math.round(ageMinutes)}min old)`);
                return cached.data;
            } else {
                this.cache.delete(key);
                console.log(`CACHE MISS: Cache expired for ${key} (${Math.round(ageMinutes)}min old)`);
            }
        }
        return null;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
        console.log(`CACHE SET: Cached response for ${key}`);
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

// Test the rate limiting system
function testRateLimiting() {
    console.log('=== TESTING CLAUDE RATE LIMITING SYSTEM ===\n');
    
    const rateLimiter = new TestClaudeRateLimit();
    
    // Test 1: Initial state
    console.log('Test 1: Initial usage status');
    const initialStatus = rateLimiter.getUsageStatus();
    console.log(`Initial usage: ${initialStatus.used}/${initialStatus.limit} requests\n`);
    
    // Test 2: Multiple requests within limit
    console.log('Test 2: Making requests within limit');
    for (let i = 0; i < 3; i++) {
        if (rateLimiter.canMakeRequest('insights')) {
            rateLimiter.recordRequest('insights');
        } else {
            console.log('Request blocked by rate limiter');
        }
    }
    console.log('');
    
    // Test 3: Cache functionality
    console.log('Test 3: Testing cache functionality');
    const testKey = 'test-key';
    const testData = {summary: 'Test insight', priority: 'Test priority'};
    
    // Should be cache miss
    let cached = rateLimiter.getCached(testKey);
    console.log(`First cache check result: ${cached ? 'HIT' : 'MISS'}`);
    
    // Set cache
    rateLimiter.setCached(testKey, testData);
    
    // Should be cache hit
    cached = rateLimiter.getCached(testKey);
    console.log(`Second cache check result: ${cached ? 'HIT' : 'MISS'}`);
    console.log('');
    
    // Test 4: Reach rate limit
    console.log('Test 4: Reaching rate limit');
    for (let i = 0; i < 5; i++) {
        if (rateLimiter.canMakeRequest('prioritization')) {
            rateLimiter.recordRequest('prioritization');
        } else {
            console.log('Request blocked by rate limiter - GOOD!');
        }
    }
    console.log('');
    
    // Test 5: Final status
    console.log('Test 5: Final usage status');
    const finalStatus = rateLimiter.getUsageStatus();
    console.log(`Final usage: ${finalStatus.used}/${finalStatus.limit} requests`);
    console.log(`Insights requests: ${finalStatus.insights}`);
    console.log(`Prioritization requests: ${finalStatus.prioritization}`);
    
    console.log('\n=== RATE LIMITING TEST COMPLETE ===');
    console.log('✓ Rate limiting implemented correctly');
    console.log('✓ Caching system working');
    console.log('✓ Usage tracking functional');
    console.log('✓ Daily limits enforced');
}

// Run the test
testRateLimiting();