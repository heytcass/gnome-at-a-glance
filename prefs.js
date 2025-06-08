import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AtAGlancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // Create a preferences page
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        // Create a preferences group
        const group = new Adw.PreferencesGroup({
            title: 'API Configuration',
            description: 'Configure API keys for GNOME At A Glance',
        });
        page.add(group);

        // Info row
        const infoRow = new Adw.ActionRow({
            title: 'API Key Storage',
            subtitle: 'API keys are securely stored in GNOME Keyring'
        });
        group.add(infoRow);

        // Instructions row
        const instructionsRow = new Adw.ActionRow({
            title: 'Configuration Instructions',
            subtitle: 'Use the command line to configure API keys:\n\nsecret-tool store --label="Claude API Key" service claude\nsecret-tool store --label="Todoist API Key" service todoist\nsecret-tool store --label="OpenWeather API Key" service openweather'
        });
        group.add(instructionsRow);

        // Create another group for viewing keys
        const viewGroup = new Adw.PreferencesGroup({
            title: 'View Stored Keys',
            description: 'Commands to check your stored API keys',
        });
        page.add(viewGroup);

        const viewRow = new Adw.ActionRow({
            title: 'View Commands',
            subtitle: 'secret-tool lookup service claude\nsecret-tool lookup service todoist\nsecret-tool lookup service openweather'
        });
        viewGroup.add(viewRow);
    }
}