{
  description = "GNOME At A Glance - Intelligent contextual information widget";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        
        # Extension UUID - should match metadata.json
        extensionUuid = "at-a-glance@gnome-extension";
        
        # Extension source files
        extensionFiles = [
          "extension.js"
          "metadata.json"
          "prefs.js"
          "stylesheet.css"
          "calendar-integration.js"
          "todoist-integration.js"
          "email-integration.js"
          "config.json"
        ];

        gnome-at-a-glance = pkgs.stdenv.mkDerivation rec {
          pname = "gnome-at-a-glance";
          version = "1.0.0";

          src = ./.;

          nativeBuildInputs = with pkgs; [
            glib
            gettext
          ];

          buildInputs = with pkgs; [
            gnome-shell
            evolution-data-server
            gnome-calendar
            gnome-online-accounts
            glib-networking
            libsoup_2_4
            json-glib
            libsecret
            sqlite
          ];

          # No build phase needed for GNOME shell extensions
          dontBuild = true;
          dontConfigure = true;

          installPhase = ''
            runHook preInstall
            
            # Create extension directory
            mkdir -p $out/share/gnome-shell/extensions/${extensionUuid}
            
            # Copy extension files
            cp extension.js $out/share/gnome-shell/extensions/${extensionUuid}/
            cp metadata.json $out/share/gnome-shell/extensions/${extensionUuid}/
            cp prefs.js $out/share/gnome-shell/extensions/${extensionUuid}/
            cp stylesheet.css $out/share/gnome-shell/extensions/${extensionUuid}/
            cp calendar-integration.js $out/share/gnome-shell/extensions/${extensionUuid}/
            cp todoist-integration.js $out/share/gnome-shell/extensions/${extensionUuid}/
            cp email-integration.js $out/share/gnome-shell/extensions/${extensionUuid}/
            cp config.json $out/share/gnome-shell/extensions/${extensionUuid}/config.json.example
            
            # Copy README for reference
            cp README.md $out/share/gnome-shell/extensions/${extensionUuid}/
            
            runHook postInstall
          '';

          # Validate the extension structure
          doCheck = true;
          checkPhase = ''
            echo "Current directory: $(pwd)"
            echo "Directory contents:"
            ls -la
            
            # Verify all required files exist
            for file in ${builtins.concatStringsSep " " extensionFiles}; do
              if [ ! -f "$file" ]; then
                echo "Missing required file: $file"
                exit 1
              fi
            done
            
            # Validate metadata.json
            ${pkgs.jq}/bin/jq . metadata.json > /dev/null
            
            # Check that UUID matches
            uuid=$(${pkgs.jq}/bin/jq -r '.uuid' metadata.json)
            if [ "$uuid" != "${extensionUuid}" ]; then
              echo "UUID mismatch: expected ${extensionUuid}, got $uuid"
              exit 1
            fi
          '';

          meta = with pkgs.lib; {
            description = "Intelligent contextual information widget for GNOME, powered by Claude AI";
            longDescription = ''
              An intelligent contextual information widget for GNOME that provides:
              - Google Calendar integration via Evolution Data Server
              - Todoist task management with interactive completion
              - Weather information from OpenWeatherMap
              - Claude AI insights for intelligent prioritization
              - Cost-effective operation with smart caching
            '';
            homepage = "https://github.com/heytcass/gnome-at-a-glance";
            license = licenses.gpl3Plus;
            maintainers = [ ];
            platforms = platforms.linux;
          };
        };

      in {
        packages = {
          default = gnome-at-a-glance;
          gnome-at-a-glance = gnome-at-a-glance;
        };

        # Development shell with all dependencies
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            gnome-shell
            evolution-data-server
            gnome-calendar
            gnome-online-accounts
            glib-networking
            libsoup_2_4
            json-glib
            libsecret
            sqlite
            
            # Development tools
            jq
            glib
            gettext
            
            # Extension development tools
            gnome-extensions-cli
            
            # API key management
            libsecret # provides secret-tool
          ];

          shellHook = ''
            echo "GNOME At A Glance development environment"
            echo ""
            echo "Available commands:"
            echo "  nix build           - Build the extension"
            echo "  nix run             - Install and enable extension (dev mode)"
            echo "  gnome-extensions    - Manage extensions"
            echo ""
            echo "Extension UUID: ${extensionUuid}"
            echo "Local install: ~/.local/share/gnome-shell/extensions/${extensionUuid}/"
          '';
        };

        # Apps for easy installation and management
        apps = {
          default = flake-utils.lib.mkApp {
            drv = pkgs.writeShellScriptBin "install-extension" ''
              set -e
              
              EXTENSION_UUID="${extensionUuid}"
              EXTENSION_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"
              BUILD_DIR="${gnome-at-a-glance}/share/gnome-shell/extensions/$EXTENSION_UUID"
              
              echo "Installing GNOME At A Glance extension..."
              
              # Create extension directory
              mkdir -p "$EXTENSION_DIR"
              
              # Copy extension files and make them writable
              cp -r "$BUILD_DIR"/* "$EXTENSION_DIR/"
              chmod -R u+w "$EXTENSION_DIR"
              
              # Copy config template if user config doesn't exist
              CONFIG_DIR="$HOME/.config/at-a-glance"
              if [ ! -f "$CONFIG_DIR/config.json" ]; then
                echo "Creating config directory..."
                mkdir -p "$CONFIG_DIR"
                cp "$EXTENSION_DIR/config.json.example" "$CONFIG_DIR/config.json"
                echo "Config template created at $CONFIG_DIR/config.json"
                echo "Please edit this file with your API keys."
              fi
              
              echo "Extension installed to: $EXTENSION_DIR"
              echo ""
              echo "To enable the extension:"
              echo "  gnome-extensions enable $EXTENSION_UUID"
              echo ""
              echo "To configure API keys, edit:"
              echo "  $CONFIG_DIR/config.json"
            '';
          };

          install = flake-utils.lib.mkApp {
            drv = pkgs.writeShellScriptBin "install-and-enable" ''
              set -e
              
              # Install the extension
              ${self.apps.${system}.default.program}
              
              # Enable the extension
              echo "Enabling extension..."
              gnome-extensions enable ${extensionUuid} || echo "Please enable manually or restart GNOME Shell"
              
              echo "Installation complete!"
            '';
          };
        };

        # NixOS module for system-wide installation
        nixosModules.default = { config, lib, pkgs, ... }:
          with lib;
          let
            cfg = config.services.gnome-at-a-glance;
          in {
            options.services.gnome-at-a-glance = {
              enable = mkEnableOption "GNOME At A Glance extension";
              
              package = mkOption {
                type = types.package;
                default = gnome-at-a-glance;
                description = "The GNOME At A Glance package to use";
              };
            };

            config = mkIf cfg.enable {
              environment.systemPackages = [
                cfg.package
                
                # Required system dependencies
                pkgs.evolution-data-server
                pkgs.gnome-calendar
                pkgs.gnome-online-accounts
                pkgs.glib-networking
                pkgs.libsoup_2_4
                pkgs.json-glib
                pkgs.libsecret
                pkgs.sqlite
              ];

              # Ensure required services are enabled
              services.gnome.evolution-data-server.enable = mkDefault true;
              services.gnome.gnome-online-accounts.enable = mkDefault true;
            };
          };
      });
}