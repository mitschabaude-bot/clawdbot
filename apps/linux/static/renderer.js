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

window.clawdbotLinuxNode?.onStatus?.((status) => {
  setText(stateEl, status.state);
  setText(nodeIdEl, status.nodeId);
  setText(gatewayEl, `${status.host}:${status.port}`);
  setText(detailsEl, status.message || '');
});

window.clawdbotLinuxNode?.getInitialStatus?.().then((status) => {
  setText(stateEl, status.state);
  setText(nodeIdEl, status.nodeId);
  setText(gatewayEl, `${status.host}:${status.port}`);
  setText(detailsEl, status.message || '');
});
