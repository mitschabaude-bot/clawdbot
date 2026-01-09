// Renderer is intentionally minimal (no bundler).
// It receives status updates from the main process.

const stateEl = document.getElementById('state');
const nodeIdEl = document.getElementById('nodeId');
const gatewayEl = document.getElementById('gateway');
const detailsEl = document.getElementById('details');

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

console.log('[renderer] setting up listeners');
console.log('[renderer] API available:', !!window.clawdbotLinuxNode);
console.log('[renderer] API methods:', Object.keys(window.clawdbotLinuxNode || {}));

window.clawdbotLinuxNode?.onStatus?.((status) => {
  console.log('[renderer] onStatus', status.state);
  setText(stateEl, status.state);
  setText(nodeIdEl, status.nodeId);
  setText(gatewayEl, `${status.host}:${status.port}`);
  setText(detailsEl, status.message || '');
});

window.clawdbotLinuxNode?.getInitialStatus?.().then((status) => {
  console.log('[renderer] getInitialStatus', status.state);
  setText(stateEl, status.state);
  setText(nodeIdEl, status.nodeId);
  setText(gatewayEl, `${status.host}:${status.port}`);
  setText(detailsEl, status.message || '');
});
