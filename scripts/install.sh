#!/bin/bash
#
# DocAlign Interactive Installation Script
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yourname/docalign/main/scripts/install.sh | bash
#
# This script:
#   1. Checks prerequisites (Node.js, npm)
#   2. Installs DocAlign globally
#   3. Checks for Claude Code
#   4. Runs docalign init (sets up both skills)
#   5. Launches Claude Code to begin interactive setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

log_success() {
    echo -e "${GREEN}✓${NC}  $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

log_error() {
    echo -e "${RED}✗${NC}  $1"
}

# Print banner
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║                 DocAlign Interactive Setup                   ║"
echo "║                                                              ║"
echo "║     Documentation Drift Detection for Claude Code           ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check prerequisites
log_info "Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    echo ""
    echo "Please install Node.js (version 18 or higher):"
    echo "  • macOS: brew install node"
    echo "  • Ubuntu/Debian: sudo apt-get install nodejs"
    echo "  • Or download from: https://nodejs.org/"
    echo ""
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version 18+ required (found: $(node --version))"
    exit 1
fi
log_success "Node.js $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm is not installed"
    exit 1
fi
log_success "npm $(npm --version)"

# Check git
if ! command -v git &> /dev/null; then
    log_error "Git is not installed"
    exit 1
fi
log_success "Git $(git --version | cut -d' ' -f3)"

# Check if in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not a git repository"
    echo "Please run this script from the root of your git repository:"
    echo "  cd /path/to/your/project"
    echo "  curl ... | bash"
    exit 1
fi
log_success "Git repository detected"

echo ""

# Step 2: Install DocAlign
log_info "Installing DocAlign..."

if npm install -g docalign@latest; then
    log_success "DocAlign installed successfully"
else
    log_error "Failed to install DocAlign"
    echo ""
    echo "You may need to use sudo or check your npm permissions:"
    echo "  sudo npm install -g docalign@latest"
    exit 1
fi

echo ""

# Step 3: Detect AI coding assistant (Claude Code or OpenCode)
log_info "Checking for AI coding assistant..."

HAS_CLAUDE=false
HAS_OPENCODE=false
command -v claude &>/dev/null && HAS_CLAUDE=true
command -v opencode &>/dev/null && HAS_OPENCODE=true

CHOSEN_TOOL=""

if $HAS_CLAUDE && $HAS_OPENCODE; then
    echo ""
    echo "Both Claude Code and OpenCode are installed. Which would you like to use?"
    echo ""
    echo "  1) Claude Code"
    echo "  2) OpenCode"
    echo ""
    read -r -p "Enter 1 or 2: " tool_choice </dev/tty
    case "$tool_choice" in
        2) CHOSEN_TOOL="opencode" ;;
        *) CHOSEN_TOOL="claude" ;;
    esac
elif $HAS_CLAUDE; then
    CHOSEN_TOOL="claude"
elif $HAS_OPENCODE; then
    CHOSEN_TOOL="opencode"
else
    log_warning "No AI coding assistant found"
    echo ""
    echo "Install one to enable the interactive setup wizard:"
    echo "  Claude Code:  npm install -g @anthropic-ai/claude-code"
    echo "  OpenCode:     npm install -g opencode-ai"
    echo ""
    echo "DocAlign CLI commands are still available:"
    echo "  docalign scan       # Scan all docs"
    echo "  docalign check      # Check specific file"
    echo ""
    exit 0
fi

log_success "Using: $CHOSEN_TOOL"

echo ""

# Step 4: Run docalign init
log_info "Setting up DocAlign (this creates configuration files)..."

if docalign init; then
    log_success "DocAlign configuration created"
else
    log_error "Failed to initialize DocAlign"
    exit 1
fi

# Step 4b: Repair settings.local.json written by any older published package.
# Fixes hooks.PostToolUse entries that use the old flat {matcher,command} format.
SETTINGS_FILE=".claude/settings.local.json"
if [ -f "$SETTINGS_FILE" ]; then
    node - <<'EOF'
const fs = require('fs');
const file = '.claude/settings.local.json';
const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));

// (a) Fix hooks format ---------------------------------------------------------
if (settings.hooks && settings.hooks.PostToolUse) {
  settings.hooks.PostToolUse = settings.hooks.PostToolUse
    .filter(h => h && typeof h === 'object')
    .map(h => {
      if (Array.isArray(h.hooks)) {
        return {
          matcher: typeof h.matcher === 'object' ? (h.matcher.tools?.[0] || 'Bash') : h.matcher,
          hooks: h.hooks,
        };
      }
      if (h.command) {
        return {
          matcher: typeof h.matcher === 'object' ? (h.matcher.tools?.[0] || 'Bash') : (h.matcher || 'Bash'),
          hooks: [{ type: 'command', command: h.command }],
        };
      }
      return null;
    })
    .filter(Boolean);
}

// (b) Ensure permissions.allow includes the MCP wildcard ----------------------
if (!settings.permissions) settings.permissions = {};
if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];
if (!settings.permissions.allow.includes('mcp__docalign__*')) {
  settings.permissions.allow.push('mcp__docalign__*');
}

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
EOF
    log_success "MCP server config and hooks verified"
fi

echo ""

# Step 5: Launch AI coding assistant setup wizard
log_info "Launching $CHOSEN_TOOL setup wizard..."
echo ""

PROJ_DIR="$PWD"

launch_banner() {
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  🎉 DocAlign is installed and configured!"
    echo ""
    if [ "$CHOSEN_TOOL" = "claude" ]; then
        echo "  The /docalign-setup wizard is starting. It will guide you"
        echo "  through:"
        echo ""
        echo "    1. Discovering your documentation files"
        echo "    2. Selecting which docs to monitor"
        echo "    3. Writing config + YAML headers to each doc"
        echo "    4. Extracting claims and annotating your docs"
        echo "    5. Running an initial drift scan to find stale docs"
        echo ""
        echo "  When the wizard finishes, DocAlign is fully active."
        echo "  Claude will automatically flag stale documentation"
        echo "  whenever you change code."
    else
        echo "  OpenCode is starting with the DocAlign setup prompt."
        echo "  It will guide you through discovering and annotating your docs."
    fi
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

# Initial prompt sent to OpenCode on startup so it begins setup automatically.
OPENCODE_PROMPT="Set up DocAlign for this project using the docalign_setup skill"

# Try to launch in the same terminal window using 'script', which allocates a
# fresh PTY for the child process — bypassing the broken-TTY problem that occurs
# when a TUI app is launched from inside a curl|bash pipe.
#
# macOS syntax:  script -q /dev/null <cmd> [args...]
# Linux syntax:  script -q -c '<cmd> [args...]' /dev/null

launch_same_window() {
    launch_banner
    if [ "$CHOSEN_TOOL" = "claude" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            script -q /dev/null claude "/docalign-setup" </dev/tty
        else
            script -q -c 'claude "/docalign-setup"' /dev/null </dev/tty
        fi
    else
        # Skip 'script' for OpenCode — its PTY wrapping interferes with --prompt.
        # Connect stdin+stdout directly to /dev/tty, same as a normal manual run.
        opencode --prompt "$OPENCODE_PROMPT" </dev/tty >/dev/tty
    fi
}

launch_new_window() {
    launch_banner
    if [ "$CHOSEN_TOOL" = "claude" ]; then
        if [[ "$OSTYPE" == "darwin"* ]]; then
            osascript << APPLESCRIPT
tell application "Terminal"
    activate
    do script "cd '$PROJ_DIR' && claude '/docalign-setup'"
end tell
APPLESCRIPT
            echo "  ➜  A new Terminal window is opening now."
        elif command -v gnome-terminal &>/dev/null; then
            gnome-terminal -- bash -c "cd '$PROJ_DIR' && claude '/docalign-setup'; exec bash" &
            echo "  ➜  A new gnome-terminal window is opening now."
        elif command -v xterm &>/dev/null; then
            xterm -e "bash -c \"cd '$PROJ_DIR' && claude '/docalign-setup'\"" &
            echo "  ➜  A new xterm window is opening now."
        else
            echo "  ➜  Open a new terminal in this directory, then run:"
            echo ""
            echo "         claude"
        fi
    else
        if [[ "$OSTYPE" == "darwin"* ]]; then
            osascript << APPLESCRIPT
tell application "Terminal"
    activate
    do script "cd '$PROJ_DIR' && opencode --prompt '$OPENCODE_PROMPT'"
end tell
APPLESCRIPT
            echo "  ➜  A new Terminal window is opening now."
        elif command -v gnome-terminal &>/dev/null; then
            gnome-terminal -- bash -c "cd '$PROJ_DIR' && opencode --prompt '$OPENCODE_PROMPT'; exec bash" &
            echo "  ➜  A new gnome-terminal window is opening now."
        elif command -v xterm &>/dev/null; then
            xterm -e "bash -c \"cd '$PROJ_DIR' && opencode --prompt '$OPENCODE_PROMPT'\"" &
            echo "  ➜  A new xterm window is opening now."
        else
            echo "  ➜  Open a new terminal in this directory, then run:"
            echo ""
            echo "         opencode"
        fi
    fi
    echo ""
}

if command -v script &>/dev/null; then
    launch_same_window
else
    launch_new_window
fi
