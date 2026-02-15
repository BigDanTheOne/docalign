/**
 * `docalign viz` — Generate interactive knowledge graph.
 *
 * Runs a full scan, transforms results into a Cytoscape.js graph,
 * and opens a self-contained HTML file in the browser.
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { CliPipeline, ScanResult } from '../local-pipeline';
import { countVerdicts } from '../local-pipeline';
import type { Verdict, ClaimType } from '../../shared/types';

// === Graph data types ===

export interface ClaimSummary {
  text: string;
  verdict: Verdict;
  type: ClaimType;
  line: number;
}

export interface GraphNode {
  data: {
    id: string;
    label: string;
    type: 'doc' | 'code';
    claimCount: number;
    driftedCount: number;
    verifiedCount: number;
    uncertainCount: number;
  };
}

export interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    claimCount: number;
    worstVerdict: Verdict;
    claims: ClaimSummary[];
  };
}

export interface CytoscapeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    healthPercent: number;
    totalDocs: number;
    totalCodeFiles: number;
    totalClaims: number;
    totalDrifted: number;
    totalVerified: number;
  };
}

// === Graph builder ===

export function buildGraphData(result: ScanResult): CytoscapeGraphData {
  const docNodes = new Map<string, GraphNode>();
  const codeNodes = new Map<string, GraphNode>();
  // Key: "docFile|codeFile"
  const edgeMap = new Map<string, { claims: ClaimSummary[]; source: string; target: string }>();

  for (const fileResult of result.files) {
    const docFile = fileResult.file;
    const verdicts = countVerdicts(fileResult.results);

    // Create or update doc node
    if (!docNodes.has(docFile)) {
      docNodes.set(docFile, {
        data: {
          id: `doc:${docFile}`,
          label: docFile,
          type: 'doc',
          claimCount: 0,
          driftedCount: 0,
          verifiedCount: 0,
          uncertainCount: 0,
        },
      });
    }
    const docNode = docNodes.get(docFile)!;
    docNode.data.claimCount += fileResult.claims.length;
    docNode.data.driftedCount += verdicts.drifted;
    docNode.data.verifiedCount += verdicts.verified;
    docNode.data.uncertainCount += verdicts.uncertain;

    // For each claim+result pair, find code files
    for (const vr of fileResult.results) {
      const claim = fileResult.claims.find((c) => c.id === vr.claim_id);
      if (!claim) continue;

      const claimSummary: ClaimSummary = {
        text: claim.claim_text,
        verdict: vr.verdict,
        type: claim.claim_type,
        line: claim.line_number,
      };

      // Collect code files from evidence_files and extracted_value.path
      const codeFiles = new Set<string>();
      for (const ef of vr.evidence_files) {
        codeFiles.add(ef);
      }
      const extractedPath = claim.extracted_value?.path;
      if (typeof extractedPath === 'string' && extractedPath.length > 0) {
        codeFiles.add(extractedPath);
      }

      // If no code files, the claim still contributes to the doc node but no edge
      for (const codeFile of codeFiles) {
        // Create code node if needed
        if (!codeNodes.has(codeFile)) {
          codeNodes.set(codeFile, {
            data: {
              id: `code:${codeFile}`,
              label: codeFile,
              type: 'code',
              claimCount: 0,
              driftedCount: 0,
              verifiedCount: 0,
              uncertainCount: 0,
            },
          });
        }
        const codeNode = codeNodes.get(codeFile)!;
        codeNode.data.claimCount += 1;
        if (vr.verdict === 'drifted') codeNode.data.driftedCount += 1;
        else if (vr.verdict === 'verified') codeNode.data.verifiedCount += 1;
        else codeNode.data.uncertainCount += 1;

        // Create or update edge
        const edgeKey = `${docFile}|${codeFile}`;
        if (!edgeMap.has(edgeKey)) {
          edgeMap.set(edgeKey, {
            claims: [],
            source: `doc:${docFile}`,
            target: `code:${codeFile}`,
          });
        }
        edgeMap.get(edgeKey)!.claims.push(claimSummary);
      }
    }
  }

  // Build edges with worst verdict
  const edges: GraphEdge[] = [];
  for (const [key, edge] of edgeMap) {
    const worstVerdict = getWorstVerdict(edge.claims);
    edges.push({
      data: {
        id: `edge:${key}`,
        source: edge.source,
        target: edge.target,
        claimCount: edge.claims.length,
        worstVerdict,
        claims: edge.claims,
      },
    });
  }

  // Stats
  const totalVerified = result.totalVerified;
  const totalDrifted = result.totalDrifted;
  const totalScored = totalVerified + totalDrifted;
  const healthPercent = totalScored > 0 ? Math.round((totalVerified / totalScored) * 100) : 100;

  return {
    nodes: [...docNodes.values(), ...codeNodes.values()],
    edges,
    stats: {
      healthPercent,
      totalDocs: docNodes.size,
      totalCodeFiles: codeNodes.size,
      totalClaims: result.totalClaims,
      totalDrifted,
      totalVerified,
    },
  };
}

function getWorstVerdict(claims: ClaimSummary[]): Verdict {
  let worst: Verdict = 'verified';
  for (const c of claims) {
    if (c.verdict === 'drifted') return 'drifted';
    if (c.verdict === 'uncertain') worst = 'uncertain';
  }
  return worst;
}

// === HTML template ===

export function buildHtml(data: CytoscapeGraphData): string {
  const jsonData = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DocAlign — Knowledge Graph</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; height: 100vh; background: #0d1117; color: #c9d1d9; }
#header { display: flex; align-items: center; gap: 24px; padding: 12px 20px; background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0; }
#header h1 { font-size: 16px; font-weight: 600; color: #f0f6fc; }
.stat { font-size: 13px; color: #8b949e; }
.stat b { color: #f0f6fc; }
.health-badge { padding: 4px 10px; border-radius: 12px; font-weight: 600; font-size: 13px; }
.health-good { background: #238636; color: #fff; }
.health-warn { background: #d29922; color: #000; }
.health-bad { background: #da3633; color: #fff; }
#main { display: flex; flex: 1; overflow: hidden; }
#sidebar { width: 280px; background: #161b22; border-right: 1px solid #30363d; display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto; }
.sidebar-section { padding: 14px; border-bottom: 1px solid #30363d; }
.sidebar-section h3 { font-size: 12px; text-transform: uppercase; color: #8b949e; margin-bottom: 8px; letter-spacing: 0.5px; }
.legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.legend-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
.legend-line { width: 20px; height: 3px; border-radius: 2px; flex-shrink: 0; }
label { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px; cursor: pointer; }
label input { accent-color: #58a6ff; }
#search { width: 100%; padding: 6px 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 12px; outline: none; }
#search:focus { border-color: #58a6ff; }
#detail { flex: 1; padding: 14px; overflow-y: auto; }
#detail h3 { font-size: 14px; color: #f0f6fc; margin-bottom: 10px; }
.claim-item { padding: 8px; margin-bottom: 6px; border-radius: 6px; background: #0d1117; border: 1px solid #30363d; font-size: 12px; }
.claim-item .verdict { font-weight: 600; text-transform: uppercase; font-size: 10px; margin-bottom: 4px; }
.verdict-verified { color: #3fb950; }
.verdict-drifted { color: #f85149; }
.verdict-uncertain { color: #d29922; }
.claim-item .text { color: #c9d1d9; line-height: 1.4; }
.claim-item .meta { color: #6e7681; margin-top: 4px; font-size: 11px; }
.empty-detail { color: #6e7681; font-size: 13px; font-style: italic; padding: 20px 0; }
#cy { flex: 1; }
</style>
</head>
<body>
<div id="header">
  <h1>DocAlign</h1>
  <span class="health-badge" id="health-badge"></span>
  <span class="stat"><b id="stat-docs">0</b> docs</span>
  <span class="stat"><b id="stat-code">0</b> code files</span>
  <span class="stat"><b id="stat-claims">0</b> claims</span>
</div>
<div id="main">
  <div id="sidebar">
    <div class="sidebar-section">
      <h3>Legend</h3>
      <div class="legend-item"><div class="legend-dot" style="background:#58a6ff;border-radius:4px;"></div> Doc file</div>
      <div class="legend-item"><div class="legend-dot" style="background:#6e7681;border-radius:50%;"></div> Code file</div>
      <div class="legend-item"><div class="legend-line" style="background:#3fb950;"></div> All verified</div>
      <div class="legend-item"><div class="legend-line" style="background:#f85149;"></div> Has drift</div>
      <div class="legend-item"><div class="legend-line" style="background:#d29922;"></div> Uncertain</div>
    </div>
    <div class="sidebar-section">
      <h3>Filters</h3>
      <label><input type="checkbox" id="f-verified" checked> Verified edges</label>
      <label><input type="checkbox" id="f-drifted" checked> Drifted edges</label>
      <label><input type="checkbox" id="f-uncertain" checked> Uncertain edges</label>
    </div>
    <div class="sidebar-section">
      <h3>Search</h3>
      <input type="text" id="search" placeholder="Filter by file name...">
    </div>
    <div id="detail">
      <p class="empty-detail">Click a node or edge to see claims.</p>
    </div>
  </div>
  <div id="cy"></div>
</div>
<script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"><\/script>
<script src="https://unpkg.com/cytoscape-fcose@2/cytoscape-fcose.js"><\/script>
<script>
window.__GRAPH_DATA__ = ${jsonData};
(function() {
  var gd = window.__GRAPH_DATA__;

  // Populate stats
  var hb = document.getElementById('health-badge');
  hb.textContent = gd.stats.healthPercent + '% health';
  hb.className = 'health-badge ' + (gd.stats.healthPercent >= 80 ? 'health-good' : gd.stats.healthPercent >= 50 ? 'health-warn' : 'health-bad');
  document.getElementById('stat-docs').textContent = gd.stats.totalDocs;
  document.getElementById('stat-code').textContent = gd.stats.totalCodeFiles;
  document.getElementById('stat-claims').textContent = gd.stats.totalClaims;

  // Register fcose
  if (typeof cytoscape !== 'undefined' && typeof cytoscapeFcose !== 'undefined') {
    cytoscape.use(cytoscapeFcose);
  }

  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: { nodes: gd.nodes, edges: gd.edges },
    style: [
      { selector: 'node[type="doc"]', style: {
        'shape': 'round-rectangle', 'background-color': '#58a6ff', 'label': 'data(label)',
        'font-size': '10px', 'color': '#c9d1d9', 'text-valign': 'bottom', 'text-margin-y': 6,
        'width': function(ele) { return Math.max(20, Math.min(60, 20 + ele.data('claimCount') * 4)); },
        'height': function(ele) { return Math.max(16, Math.min(40, 16 + ele.data('claimCount') * 3)); },
        'text-wrap': 'ellipsis', 'text-max-width': '100px',
        'border-width': function(ele) { return ele.data('driftedCount') > 0 ? 2 : 0; },
        'border-color': '#f85149'
      }},
      { selector: 'node[type="code"]', style: {
        'shape': 'ellipse', 'background-color': '#6e7681', 'label': 'data(label)',
        'font-size': '9px', 'color': '#8b949e', 'text-valign': 'bottom', 'text-margin-y': 5,
        'width': function(ele) { return Math.max(16, Math.min(50, 16 + ele.data('claimCount') * 3)); },
        'height': function(ele) { return Math.max(16, Math.min(50, 16 + ele.data('claimCount') * 3)); },
        'text-wrap': 'ellipsis', 'text-max-width': '90px'
      }},
      { selector: 'edge[worstVerdict="verified"]', style: {
        'line-color': '#3fb950', 'target-arrow-color': '#3fb950', 'target-arrow-shape': 'triangle',
        'width': function(ele) { return Math.max(1, Math.min(6, ele.data('claimCount'))); },
        'curve-style': 'bezier', 'opacity': 0.7
      }},
      { selector: 'edge[worstVerdict="drifted"]', style: {
        'line-color': '#f85149', 'target-arrow-color': '#f85149', 'target-arrow-shape': 'triangle',
        'width': function(ele) { return Math.max(1, Math.min(6, ele.data('claimCount'))); },
        'curve-style': 'bezier', 'opacity': 0.9
      }},
      { selector: 'edge[worstVerdict="uncertain"]', style: {
        'line-color': '#d29922', 'target-arrow-color': '#d29922', 'target-arrow-shape': 'triangle',
        'width': function(ele) { return Math.max(1, Math.min(6, ele.data('claimCount'))); },
        'curve-style': 'bezier', 'opacity': 0.6
      }},
      { selector: '.dimmed', style: { 'opacity': 0.15 }},
      { selector: ':selected', style: { 'border-width': 3, 'border-color': '#f0f6fc' }}
    ],
    layout: {
      name: typeof cytoscapeFcose !== 'undefined' ? 'fcose' : 'cose',
      nodeSeparation: 100, idealEdgeLength: 150, animate: true, animationDuration: 800,
      randomize: true, quality: 'default'
    },
    minZoom: 0.2, maxZoom: 4
  });

  // Detail panel
  var detailEl = document.getElementById('detail');

  function showClaims(title, claims) {
    var html = '<h3>' + escHtml(title) + '</h3>';
    if (!claims || claims.length === 0) {
      html += '<p class="empty-detail">No claims.</p>';
    } else {
      for (var i = 0; i < claims.length; i++) {
        var c = claims[i];
        html += '<div class="claim-item">' +
          '<div class="verdict verdict-' + c.verdict + '">' + c.verdict + '</div>' +
          '<div class="text">' + escHtml(c.text) + '</div>' +
          '<div class="meta">' + c.type + ' \u00b7 line ' + c.line + '</div>' +
          '</div>';
      }
    }
    detailEl.innerHTML = html;
  }

  cy.on('tap', 'node', function(evt) {
    var node = evt.target;
    var claims = [];
    node.connectedEdges().forEach(function(edge) {
      claims = claims.concat(edge.data('claims'));
    });
    showClaims(node.data('label'), claims);
  });

  cy.on('tap', 'edge', function(evt) {
    var edge = evt.target;
    var src = edge.source().data('label');
    var tgt = edge.target().data('label');
    showClaims(src + ' \u2192 ' + tgt, edge.data('claims'));
  });

  cy.on('tap', function(evt) {
    if (evt.target === cy) {
      detailEl.innerHTML = '<p class="empty-detail">Click a node or edge to see claims.</p>';
    }
  });

  // Filters
  function applyFilters() {
    var showV = document.getElementById('f-verified').checked;
    var showD = document.getElementById('f-drifted').checked;
    var showU = document.getElementById('f-uncertain').checked;
    cy.edges().forEach(function(edge) {
      var v = edge.data('worstVerdict');
      var visible = (v === 'verified' && showV) || (v === 'drifted' && showD) || (v === 'uncertain' && showU);
      if (visible) edge.style('display', 'element');
      else edge.style('display', 'none');
    });
  }
  document.getElementById('f-verified').addEventListener('change', applyFilters);
  document.getElementById('f-drifted').addEventListener('change', applyFilters);
  document.getElementById('f-uncertain').addEventListener('change', applyFilters);

  // Search
  document.getElementById('search').addEventListener('input', function(e) {
    var q = e.target.value.toLowerCase();
    if (!q) {
      cy.elements().removeClass('dimmed');
      return;
    }
    cy.nodes().forEach(function(node) {
      if (node.data('label').toLowerCase().includes(q)) {
        node.removeClass('dimmed');
      } else {
        node.addClass('dimmed');
      }
    });
    cy.edges().forEach(function(edge) {
      var src = edge.source();
      var tgt = edge.target();
      if (!src.hasClass('dimmed') || !tgt.hasClass('dimmed')) {
        edge.removeClass('dimmed');
      } else {
        edge.addClass('dimmed');
      }
    });
  });

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
})();
<\/script>
</body>
</html>`;
}

// === Browser opener ===

export function openInBrowser(filePath: string): void {
  const absPath = path.resolve(filePath);
  const url = `file://${absPath}`;
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') cmd = `open "${url}"`;
  else if (platform === 'win32') cmd = `start "" "${url}"`;
  else cmd = `xdg-open "${url}"`;

  exec(cmd, () => {
    // Silently ignore errors (headless, no browser, etc.)
  });
}

// === CLI command ===

export interface VizOptions {
  output?: string;
  noOpen?: boolean;
  exclude?: string[];
}

export async function runViz(
  pipeline: CliPipeline,
  options: VizOptions,
  write: (msg: string) => void = console.log,
): Promise<number> {
  try {
    write('DocAlign: Generating knowledge graph...');

    const result = await pipeline.scanRepo((current, total) => {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  Scanning: ${current}/${total}`);
      }
    }, options.exclude);

    // Clear progress
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[K');
    }

    if (result.files.length === 0) {
      write('  No documentation files found. Nothing to visualize.');
      return 0;
    }

    const graphData = buildGraphData(result);
    const html = buildHtml(graphData);

    // Write to output file
    const outputPath = options.output ?? path.join('.docalign', 'viz.html');
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, html, 'utf-8');

    write(`  Graph written to ${outputPath}`);
    write(`  ${graphData.stats.totalDocs} doc files, ${graphData.stats.totalCodeFiles} code files, ${graphData.stats.totalClaims} claims`);
    write(`  Health: ${graphData.stats.healthPercent}%`);

    if (!options.noOpen) {
      openInBrowser(outputPath);
      write('  Opened in browser.');
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    write(`Error: ${message}`);
    return 2;
  }
}
