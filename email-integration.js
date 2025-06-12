// email-integration.js - Smart email integration for GNOME At A Glance
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Email integration with VIP filtering to minimize API usage
export class EmailIntegration {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.vipSenders = this.loadVipSenders();
        this.urgentKeywords = [
            'urgent', 'asap', 'immediate', 'action required', 'deadline',
            'meeting request', 'interview', 'important', 'critical',
            'time sensitive', 'please respond', 'response needed'
        ];
    }

    loadVipSenders() {
        try {
            const configPath = GLib.get_home_dir() + '/.config/at-a-glance/config.json';
            const configFile = Gio.File.new_for_path(configPath);
            
            if (configFile.query_exists(null)) {
                const [success, contents] = configFile.load_contents(null);
                if (success) {
                    const config = JSON.parse(new TextDecoder().decode(contents));
                    return config.vip_email_senders || [];
                }
            }
        } catch (error) {
            console.log('At A Glance: Could not load VIP senders, using defaults');
        }
        
        // Default VIP patterns - commonly important sender domains
        return [
            '@company.com', // Replace with actual company domain
            'noreply@calendar.google.com',
            'noreply@github.com',
            'no-reply@calendly.com',
            'calendar@',
            'meeting@',
            'hr@',
            'admin@',
            'security@'
        ];
    }

    isVipSender(fromAddress) {
        if (!fromAddress) return false;
        
        const normalizedFrom = fromAddress.toLowerCase();
        return this.vipSenders.some(pattern => {
            if (pattern.startsWith('@')) {
                return normalizedFrom.includes(pattern);
            } else {
                return normalizedFrom.includes(pattern.toLowerCase());
            }
        });
    }

    hasUrgentKeywords(subject, body = '') {
        const text = `${subject || ''} ${body || ''}`.toLowerCase();
        return this.urgentKeywords.some(keyword => text.includes(keyword));
    }

    async getEmailSummary() {
        const cacheKey = 'email_summary';
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const summary = await this._collectEmailData();
            
            this.cache.set(cacheKey, {
                data: summary,
                timestamp: Date.now()
            });
            
            return summary;
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
    }

    async _collectEmailData() {
        // Try multiple email collection methods
        const methods = [
            () => this._tryEvolutionDBus(),
            () => this._tryEvolutionCache(),
            () => this._tryNotmuchMail(),
            () => this._tryMailCommand()
        ];

        for (const method of methods) {
            try {
                const result = await method();
                if (result && result.total >= 0) {
                    console.log(`At A Glance: Email data collected via ${method.name}`);
                    return result;
                }
            } catch (error) {
                console.log(`At A Glance: Email method ${method.name} failed:`, error);
                continue;
            }
        }

        // If all methods fail, return minimal data
        return {
            total: 0,
            vip: 0,
            urgent: 0,
            mostUrgent: null,
            status: 'No email access available'
        };
    }

    async _tryEvolutionDBus() {
        // Try to get unread count via Evolution D-Bus interface
        try {
            // This is a simplified approach - Evolution's D-Bus interface is complex
            // In practice, you'd need to enumerate accounts and folders
            const proc = Gio.Subprocess.new(
                ['qdbus', 'org.gnome.evolution.dataserver', '/org/gnome/evolution/dataserver'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            
            const [, stdout] = proc.communicate_utf8(null, null);
            if (proc.get_successful()) {
                // Parse D-Bus response for unread counts
                // This is a placeholder - real implementation would parse Evolution data
                return {
                    total: 0,
                    vip: 0,
                    urgent: 0,
                    mostUrgent: null,
                    status: 'Evolution D-Bus access (limited)'
                };
            }
        } catch (error) {
            throw new Error('Evolution D-Bus failed');
        }
        
        throw new Error('Evolution D-Bus not available');
    }

    async _tryEvolutionCache() {
        // Try to read Evolution's SQLite cache files
        try {
            const evolutionDir = GLib.get_home_dir() + '/.local/share/evolution';
            const dir = Gio.File.new_for_path(evolutionDir);
            
            if (!dir.query_exists(null)) {
                throw new Error('Evolution directory not found');
            }

            // Look for Evolution's cache databases
            // This is a simplified approach - would need to parse SQLite properly
            const proc = Gio.Subprocess.new(
                ['find', evolutionDir, '-name', '*.db', '-type', 'f'],
                Gio.SubprocessFlags.STDOUT_PIPE
            );
            
            const [, stdout] = proc.communicate_utf8(null, null);
            if (proc.get_successful() && stdout.trim()) {
                // Found database files - could parse for unread counts
                // This is a placeholder for actual SQLite parsing
                return {
                    total: 0,
                    vip: 0,
                    urgent: 0,
                    mostUrgent: null,
                    status: 'Evolution cache access (limited)'
                };
            }
        } catch (error) {
            throw new Error('Evolution cache read failed');
        }
        
        throw new Error('Evolution cache not accessible');
    }

    async _tryNotmuchMail() {
        // Try notmuch if available (popular command-line email indexer)
        try {
            const proc = Gio.Subprocess.new(
                ['notmuch', 'count', 'tag:unread'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            
            const [, stdout] = proc.communicate_utf8(null, null);
            if (proc.get_successful()) {
                const total = parseInt(stdout.trim()) || 0;
                
                // Get VIP count
                let vipCount = 0;
                try {
                    const vipPatterns = this.vipSenders.map(pattern => 
                        pattern.startsWith('@') ? `from:${pattern.slice(1)}` : `from:${pattern}`
                    ).join(' OR ');
                    
                    const vipProc = Gio.Subprocess.new(
                        ['notmuch', 'count', `tag:unread AND (${vipPatterns})`],
                        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                    );
                    
                    const [, vipStdout] = vipProc.communicate_utf8(null, null);
                    if (vipProc.get_successful()) {
                        vipCount = parseInt(vipStdout.trim()) || 0;
                    }
                } catch (vipError) {
                    console.log('At A Glance: VIP count failed:', vipError);
                }

                return {
                    total: total,
                    vip: vipCount,
                    urgent: Math.min(vipCount, 3), // Assume VIP emails are urgent
                    mostUrgent: vipCount > 0 ? 'VIP email requiring attention' : null,
                    status: 'Notmuch integration active'
                };
            }
        } catch (error) {
            throw new Error('Notmuch not available');
        }
        
        throw new Error('Notmuch command failed');
    }

    async _tryMailCommand() {
        // Try basic mail command for unread count
        try {
            const proc = Gio.Subprocess.new(
                ['mail', '-H'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            
            const [, stdout] = proc.communicate_utf8(null, null);
            if (proc.get_successful()) {
                const lines = stdout.trim().split('\n');
                const unreadLines = lines.filter(line => line.includes('N ') || line.includes('U '));
                
                return {
                    total: unreadLines.length,
                    vip: 0, // Can't determine VIP from basic mail command
                    urgent: 0,
                    mostUrgent: unreadLines.length > 0 ? `${unreadLines.length} unread emails` : null,
                    status: 'Basic mail command'
                };
            }
        } catch (error) {
            throw new Error('Mail command not available');
        }
        
        throw new Error('Mail command failed');
    }

    // Helper method to get email context for Claude (minimal data to preserve API budget)
    getEmailContextForAI(emailSummary) {
        if (emailSummary.total === 0) {
            return 'No unread emails';
        }
        
        if (emailSummary.urgent > 0) {
            return `${emailSummary.urgent} urgent emails need attention`;
        }
        
        if (emailSummary.vip > 0) {
            return `${emailSummary.vip} VIP emails waiting`;
        }
        
        if (emailSummary.total > 10) {
            return `${emailSummary.total} emails (busy inbox)`;
        }
        
        return `${emailSummary.total} unread emails`;
    }

    // Get display text for panel button
    getPanelDisplayText(emailSummary) {
        if (emailSummary.urgent > 0) {
            return `📧 ${emailSummary.urgent} urgent email${emailSummary.urgent > 1 ? 's' : ''}`;
        }
        
        if (emailSummary.vip > 0) {
            return `📬 ${emailSummary.vip} VIP email${emailSummary.vip > 1 ? 's' : ''}`;
        }
        
        if (emailSummary.total > 15) {
            return `📮 ${emailSummary.total} emails (busy)`;
        }
        
        return null; // Don't show regular email counts in panel
    }

    // Get detailed text for dropdown menu
    getMenuDisplayText(emailSummary) {
        if (emailSummary.total === 0) {
            return '📧 Email: No unread messages';
        }
        
        let text = `📧 Email: ${emailSummary.total} unread`;
        
        if (emailSummary.urgent > 0) {
            text += ` (${emailSummary.urgent} urgent)`;
        } else if (emailSummary.vip > 0) {
            text += ` (${emailSummary.vip} VIP)`;
        }
        
        return text;
    }

    destroy() {
        // Cleanup if needed
        this.cache.clear();
    }
}