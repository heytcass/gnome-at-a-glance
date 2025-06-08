# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GNOME At A Glance is an intelligent contextual information widget for GNOME Shell inspired by Android's At A Glance widget. It provides a unified view of calendar events, Todoist tasks, weather, and system information with smart prioritization that only surfaces relevant information when you need it. The extension uses Claude AI for intelligent contextual summaries while maintaining cost-effective operation through smart caching.

## Core Architecture

- **extension.js**: Main extension entry point and widget controller. Contains the primary AtAGlanceIndicator class that manages the panel button and popup menu.
- **calendar-integration.js**: Integrates with Evolution Data Server (EDS) to access Google Calendar, local calendars, and CalDAV sources synced to GNOME.
- **todoist-integration.js**: Handles Todoist API integration with caching, task management, and completion functionality.
- **prefs.js**: GNOME preferences dialog for configuring API keys and settings.
- **config.json**: Configuration template containing API keys, update intervals, and feature toggles.

## Key Components

### Data Collection System
The DataCollector object in extension.js coordinates data from multiple sources:
- Weather via OpenWeatherMap API
- Calendar events via EDS integration
- Todoist tasks via REST API
- System information (battery, updates, notifications)

### Claude AI Integration
The ClaudeAssistant module provides intelligent summarization with:
- Rate limiting (24 requests/day by default)
- Smart caching (1-hour duration)
- Fallback summaries when API is unavailable
- Cost control mechanisms to keep usage under $0.30/month

### Interactive Task Management
Tasks from Todoist can be completed directly from the extension popup menu. The interface shows priority indicators, due dates, and overdue status.

## Configuration

### API Key Storage
API keys are securely stored in GNOME Keyring instead of plain text files. The extension includes:
- **keyring-manager.js**: Handles secure storage/retrieval of API keys using libsecret
- **Automatic migration**: Moves API keys from config files to keyring on first run
- **Preferences UI**: Secure interface for entering and managing API keys

Required API keys:
- `claude`: Anthropic Claude API key (for AI insights)
- `todoist`: Todoist API token (for task management)
- `openweather`: OpenWeatherMap API key (for weather data)

### Configuration Files
- **Preferences**: Use `gnome-extensions prefs at-a-glance@gnome-extension` to configure API keys
- **Config file**: `~/.config/at-a-glance/config.json` stores non-sensitive settings
- **Keyring**: API keys stored securely in GNOME Keyring with schema `com.gnome.at-a-glance.api-keys`

The extension gracefully handles missing API keys by disabling the relevant features and providing helpful fallback functionality.

## Development Commands

This project uses Nix flakes for reproducible builds and easy installation on NixOS:

### Nix Flake Commands
- **Build extension**: `nix build`
- **Install locally**: `nix run .#install` (installs to ~/.local/share/gnome-shell/extensions/)
- **Install and enable**: `nix run .#install` (attempts to enable the extension)
- **Development shell**: `nix develop` (includes all dependencies and dev tools)

### Traditional GNOME Extension Commands
- **Enable extension**: `gnome-extensions enable at-a-glance@gnome-extension`
- **Disable extension**: `gnome-extensions disable at-a-glance@gnome-extension`
- **View logs**: `journalctl -f -o cat /usr/bin/gnome-shell` or `dbus-run-session -- gnome-shell --nested --wayland`
- **Reload extension**: `gnome-extensions disable at-a-glance@gnome-extension && gnome-extensions enable at-a-glance@gnome-extension`
- **Test preferences**: `gnome-extensions prefs at-a-glance@gnome-extension`

## Dependencies

### NixOS System Integration
The flake provides a NixOS module for system-wide installation:
```nix
{
  inputs.gnome-at-a-glance.url = "github:heytcass/gnome-at-a-glance";
  
  # In your NixOS configuration:
  services.gnome-at-a-glance.enable = true;
}
```

### Required System Packages
- evolution-data-server (calendar integration)
- gnome-calendar (calendar data access)
- gnome-online-accounts (Google/CalDAV accounts)
- glib-networking (secure HTTP)
- libsoup_2_4 (HTTP client library)
- json-glib (JSON parsing)
- libsecret (GNOME Keyring access)

The extension uses GJS imports for GNOME libraries (St, Clutter, GLib, Gio, Soup, Secret, EDataServer, ECal, ICalGLib).

## Integration Points

Calendar integration requires Evolution Data Server to be properly configured with online accounts (Google, CalDAV, etc.) through GNOME Settings. The extension automatically discovers all enabled calendar sources.

Todoist integration is optional and gracefully degrades if no API key is provided. Tasks support priority levels (P1-P4), due dates/times, projects, and labels.

Weather integration uses OpenWeatherMap's free tier with smart location detection:
1. User override in `location_override` config (if set)
2. Automatic IP-based location detection
3. Default fallback to Detroit, MI (where this extension was developed!)