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

echo ""

# Step 5: Launch Claude Code
log_info "Launching Claude Code to begin interactive setup..."
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  🎉 Installation complete!"
echo ""
echo "  Next: Claude Code will guide you through:"
echo "    1. Discovering your documentation"
echo "    2. Selecting which docs to monitor"
echo "    3. Configuring DocAlign"
echo "    4. Annotating your docs with claims"
echo "    5. Running initial verification"
echo ""
echo "  Estimated time: 3-5 minutes"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Launch Claude Code
exec claude
