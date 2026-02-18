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

# Step 3: Check for Claude Code
log_info "Checking for Claude Code..."

if ! command -v claude &> /dev/null; then
    log_warning "Claude Code CLI not found"
    echo ""
    echo "Claude Code is required for interactive setup. Install it:"
    echo "  npm install -g @anthropic-ai/claude-code"
    echo ""
    echo "DocAlign CLI commands are still available:"
    echo "  docalign scan       # Scan all docs"
    echo "  docalign check      # Check specific file"
    echo ""
    exit 0
fi

log_success "Claude Code found"

echo ""

# Step 4: Run docalign init
log_info "Setting up DocAlign (this creates configuration files)..."

if docalign init; then
    log_success "DocAlign configuration created"
else
    log_error "Failed to initialize DocAlign"
    exit 1
fi

# Step 4b: Fix hooks format in settings.local.json
# The published npm package may write an outdated hooks format.
# Rewrite to the format Claude Code currently requires.
SETTINGS_FILE=".claude/settings.local.json"
if [ -f "$SETTINGS_FILE" ]; then
    node - <<'EOF'
const fs = require('fs');
const file = '.claude/settings.local.json';
const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));

if (settings.hooks && settings.hooks.PostToolUse) {
  settings.hooks.PostToolUse = settings.hooks.PostToolUse
    // Drop malformed entries (missing hooks array)
    .filter(h => h && typeof h === 'object')
    .map(h => {
      // Already correct format: string matcher + hooks array
      if (Array.isArray(h.hooks)) {
        return {
          matcher: typeof h.matcher === 'object' ? (h.matcher.tools?.[0] || 'Bash') : h.matcher,
          hooks: h.hooks,
        };
      }
      // Old flat format: { matcher, pattern, command } -> new nested format
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

fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
EOF
    log_success "Hooks format verified"
fi

echo ""

# Step 5: Launch Claude Code setup wizard
log_info "Launching Claude Code setup wizard..."
echo ""

PROJ_DIR="$PWD"

launch_banner() {
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  🎉 DocAlign is installed and configured!"
    echo ""
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
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
}

# Try to launch Claude Code in the same terminal window using 'script', which
# allocates a fresh PTY for the child process. This bypasses the broken-TTY
# problem that occurs when a TUI app is launched from inside a curl|bash pipe:
# the pipe destroys the controlling terminal's interactivity, but 'script'
# allocates a new PTY so claude gets a clean, fully interactive terminal.
#
# macOS syntax:  script -q /dev/null <cmd> [args...]
# Linux syntax:  script -q -c '<cmd> [args...]' /dev/null
#
# We try same-window first; fall back to new window if script is unavailable.

launch_same_window() {
    launch_banner
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS BSD script: command and args follow the output file
        script -q /dev/null claude "/docalign-setup"
    else
        # Linux util-linux script: -c takes the command as a string
        script -q -c 'claude "/docalign-setup"' /dev/null
    fi
}

launch_new_window() {
    launch_banner
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
    echo ""
}

if command -v script &>/dev/null; then
    launch_same_window
else
    launch_new_window
fi
