# GNOME At A Glance

**Intelligent contextual information widget for GNOME Shell, inspired by Android's At A Glance widget**

![GNOME Shell Version](https://img.shields.io/badge/GNOME%20Shell-45%2B-blue)
![License](https://img.shields.io/badge/License-GPL%202.0+-green)
![NixOS](https://img.shields.io/badge/NixOS-Ready-blue)

Brings the smart, contextual information display of Android's At A Glance widget to the GNOME desktop with AI-enhanced prioritization and desktop-specific integrations. Developed in Detroit, MI 🏙️

## ✨ Key Features

### Smart Priority Display
- **⚠️ Urgent Tasks** - Shows high-priority Todoist tasks (P1/P2 only)
- **🚨 Imminent Events** - Calendar events starting within 15 minutes  
- **🔋 System Alerts** - Low battery, failed services, disk space warnings
- **☁️ Weather Fallback** - Current conditions when nothing urgent needs attention

### AI-Powered Insights  
- **🤖 Claude AI Integration** - Contextual summaries and actionable suggestions
- **💰 Cost-Effective** - Smart caching keeps usage under $0.30/month (24 requests/day)
- **🎯 Smart Prioritization** - Only shows truly urgent or time-sensitive information

### Interactive Sections
- **📅 Calendar** - Click to open GNOME Calendar app
- **📝 Tasks** - Click to view/complete Todoist tasks or open web app
- **🌤️ Weather** - Click to view detailed forecast
- **💻 System** - Click to open System Monitor

### Location Intelligence
- **🌍 Smart Detection** - Automatic IP-based location detection
- **🏠 User Override** - Configurable location in settings
- **🏙️ Detroit Fallback** - Defaults to Detroit, MI (where this was developed!)

## 🚀 Installation

### Quick Install (NixOS)

```bash
nix run github:heytcass/gnome-at-a-glance#install
```

### Manual Installation

1. **Clone and build:**
```bash
git clone https://github.com/heytcass/gnome-at-a-glance.git
cd gnome-at-a-glance
nix build
```

2. **Install extension:**
```bash
nix run .#install
```

3. **Configure API keys:**
```bash
mkdir -p ~/.config/at-a-glance
cp config.json ~/.config/at-a-glance/config.json
# Edit config.json with your API keys
```

## ⚙️ Configuration

### Required API Keys

1. **OpenWeatherMap** (Free) - Weather data
   - Get key: https://openweathermap.org/api
   - Free tier: 1000 calls/day

2. **Claude AI** (Anthropic) - Smart insights  
   - Get key: https://console.anthropic.com/
   - Cost: ~$0.30/month with smart caching

3. **Todoist** (Optional) - Task management
   - Get token: Todoist Settings → Integrations → API token
   - Free tier available

### Configuration File

Edit `~/.config/at-a-glance/config.json`:

```json
{
  "claude_api_key": "sk-ant-api03-...",
  "openweather_api_key": "your-weather-key",
  "todoist_api_key": "your-todoist-token",
  "location_override": "Rochester Hills,MI,US",
  "features": {
    "weather": true,
    "calendar": true,
    "tasks": true,
    "claude_insights": true
  }
}
```

## 🎮 Usage

### Panel Button
The extension replaces generic text with **contextual information**:
- `⚡ Pay bills` - High priority task needs attention
- `🚨 Meeting in 5m` - Event starting soon
- `🔋 15% battery` - System needs attention  
- `☁️ 72°F Cloudy` - Weather when nothing urgent

### Dropdown Menu
- **AI Summary** (primary) - Click to expand details
- **Detailed Sections** (hidden by default) - Raw data when needed
- **Interactive Actions** - Click any section for relevant app/action

### Smart Prioritization
Only shows information when it's **actually relevant**:
- Tasks: High priority (P1/P2) or due today only
- Events: Upcoming within 15 minutes get priority
- System: Warnings only (low battery, failed services)
- Weather: Fallback when nothing urgent needs attention

## 🔧 Development

### NixOS Development Shell

```bash
nix develop
```

Includes all dependencies for extension development.

### Extension Commands

```bash
# Enable/disable extension
gnome-extensions enable at-a-glance@gnome-extension
gnome-extensions disable at-a-glance@gnome-extension

# View logs
journalctl --user -f | grep at-a-glance

# Open preferences
gnome-extensions prefs at-a-glance@gnome-extension
```

### Building

```bash
# Local build
nix build

# Install locally  
nix run .#install

# Package for distribution
nix build .#extension-zip
```

## 🏗️ Architecture

- **Smart Location Detection** - IP geolocation → user override → Detroit fallback
- **Secure API Keys** - GNOME Keyring integration with config fallback
- **NixOS Integration** - System monitoring for failed services, Nix store usage
- **Soup 3.0 Compatibility** - Modern HTTP for GNOME Shell 45+
- **Cost Control** - Smart caching and rate limiting for AI API calls

## 🎨 Inspiration

This extension brings the beloved contextual intelligence of **Android's At A Glance widget** to the GNOME desktop. Like its mobile counterpart, it surfaces the right information at the right time without overwhelming you with unnecessary details.

## 📝 License

GPL-2.0-or-later - See LICENSE file

This extension is distributed under the terms of the GNU General Public License v2.0 or later, as required by the GNOME Extensions directory.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with `nix build && nix run .#install`
5. Submit a pull request

---

**Developed in Detroit, Michigan** 🏙️ **Powered by Claude AI** 🤖