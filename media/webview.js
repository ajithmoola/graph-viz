import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const vscodeApi = acquireVsCodeApi();

const canvas = document.getElementById('canvas');
const tooltip = document.getElementById('tooltip');
const statusBar = document.getElementById('status');
const errorBox = document.getElementById('error');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
const bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
scene.background = new THREE.Color(bg || '#1e1e1e');

const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
camera.position.set(0, 0, 160);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1, 1, 2);
scene.add(dirLight);

let graphGroup = null;
let nodeMesh = null;
let nodes = [];
let nodeComponents = [];
let firstLoad = true;

// categorical palette (validated for CVD safety), fixed slot order; overflow -> muted gray
const PALETTE_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const PALETTE_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OVERFLOW_COLOR = '#898781';

function palette() {
  const c = new THREE.Color(scene.background);
  const luma = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return luma < 0.5 ? PALETTE_DARK : PALETTE_LIGHT;
}

// deterministic fallback layout for nodes without pos: points on a fibonacci sphere
function fallbackPos(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = n === 1 ? 0 : 1 - (2 * i) / (n - 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  return [Math.cos(golden * i) * r * 50, y * 50, Math.sin(golden * i) * r * 50];
}

function disposeGraph() {
  if (!graphGroup) return;
  graphGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
  scene.remove(graphGroup);
  graphGroup = null;
  nodeMesh = null;
}

function buildGraph(data) {
  disposeGraph();
  errorBox.style.display = 'none';

  nodes = data.nodes || [];
  const links = data.links || data.edges || [];
  const n = nodes.length;
  if (n === 0) {
    statusBar.textContent = '0 nodes';
    return;
  }

  const indexOf = new Map();
  nodes.forEach((node, i) => indexOf.set(node.id, i));

  // connected components via union-find
  const ufParent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (ufParent[x] !== x) { ufParent[x] = ufParent[ufParent[x]]; x = ufParent[x]; }
    return x;
  };
  for (const e of links) {
    const a = indexOf.get(e.source);
    const b = indexOf.get(e.target);
    if (a === undefined || b === undefined) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) ufParent[ra] = rb;
  }
  const compSize = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    compSize.set(r, (compSize.get(r) || 0) + 1);
  }
  // component 1 = largest, ties broken by first appearance
  const roots = [...compSize.keys()].sort((a, b) => compSize.get(b) - compSize.get(a));
  const compIndex = new Map(roots.map((r, k) => [r, k]));
  const componentOf = new Array(n);
  for (let i = 0; i < n; i++) componentOf[i] = compIndex.get(find(i));
  nodeComponents = componentOf;
  const nComponents = roots.length;
  const pal = palette();
  const compColor = roots.map((_, k) =>
    new THREE.Color(k < pal.length ? pal[k] : OVERFLOW_COLOR)
  );

  // resolve raw positions (in original units, e.g. mm)
  const raw = nodes.map((node, i) => {
    const p = node.pos;
    if (Array.isArray(p) && p.length >= 2) {
      return [Number(p[0]), Number(p[1]), p.length > 2 ? Number(p[2]) : 0];
    }
    return fallbackPos(i, n);
  });

  // center and scale so the largest extent is ~100 scene units
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of raw) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = 100 / extent;
  const pts = raw.map((p) => [
    (p[0] - center[0]) * s,
    (p[1] - center[1]) * s,
    (p[2] - center[2]) * s,
  ]);

  // node sphere radii: physical if the graph carries a numeric `radius`, else uniform
  const radii = nodes.map((node) => (typeof node.radius === 'number' ? node.radius : null));
  const uniform = Math.max(0.6, 100 / Math.max(20, Math.sqrt(n) * 8));
  const sphereR = radii.map((r) => {
    if (r === null) return uniform;
    const scaled = r * s;
    return Math.max(scaled, 0.35); // keep tiny vessels visible
  });

  graphGroup = new THREE.Group();

  const geom = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshLambertMaterial();
  nodeMesh = new THREE.InstancedMesh(geom, mat, n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeScale(sphereR[i], sphereR[i], sphereR[i]);
    m.setPosition(pts[i][0], pts[i][1], pts[i][2]);
    nodeMesh.setMatrixAt(i, m);
    nodeMesh.setColorAt(i, compColor[componentOf[i]]);
  }
  nodeMesh.instanceMatrix.needsUpdate = true;
  if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true;
  graphGroup.add(nodeMesh);

  const edgePos = [];
  let skipped = 0;
  for (const e of links) {
    const a = indexOf.get(e.source);
    const b = indexOf.get(e.target);
    if (a === undefined || b === undefined) { skipped++; continue; }
    edgePos.push(...pts[a], ...pts[b]);
  }
  if (edgePos.length) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    const em = new THREE.LineBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.55 });
    graphGroup.add(new THREE.LineSegments(eg, em));
  }

  scene.add(graphGroup);
  statusBar.textContent =
    `${n} nodes, ${links.length - skipped} edges, ` +
    `${nComponents} component${nComponents === 1 ? '' : 's'} — color: component` +
    (nComponents > pal.length ? ` (components beyond ${pal.length} shown gray)` : '') +
    (skipped ? ` (${skipped} edges skipped)` : '');

  if (firstLoad) {
    camera.position.set(0, 0, 160);
    controls.target.set(0, 0, 0);
    controls.update();
    firstLoad = false;
  }
}

// hover tooltip
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function formatAttrs(node, component) {
  const lines = [`id: ${node.id}`, `component: ${component + 1}`];
  for (const [k, v] of Object.entries(node)) {
    if (k === 'id') continue;
    let text;
    if (Array.isArray(v)) {
      text = v.length > 6
        ? `[${v.length} items]`
        : `[${v.map((x) => (typeof x === 'number' ? +x.toFixed(3) : x)).join(', ')}]`;
    } else if (typeof v === 'number') {
      text = String(+v.toFixed(4));
    } else {
      text = String(v);
      if (text.length > 60) text = text.slice(0, 57) + '...';
    }
    lines.push(`${k}: ${text}`);
  }
  return lines.join('\n');
}

canvas.addEventListener('pointermove', (ev) => {
  if (!nodeMesh) { tooltip.style.display = 'none'; return; }
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(nodeMesh);
  if (hits.length && hits[0].instanceId !== undefined) {
    tooltip.textContent = formatAttrs(nodes[hits[0].instanceId], nodeComponents[hits[0].instanceId]);
    tooltip.style.display = 'block';
    const x = Math.min(ev.clientX + 14, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(ev.clientY + 14, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  } else {
    tooltip.style.display = 'none';
  }
});

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === 'graph') {
    try {
      buildGraph(msg.data);
    } catch (e) {
      errorBox.textContent = 'Failed to render graph: ' + e.message;
      errorBox.style.display = 'block';
    }
  } else if (msg.type === 'error') {
    errorBox.textContent = msg.message;
    errorBox.style.display = 'block';
  }
});

vscodeApi.postMessage({ type: 'ready' });
