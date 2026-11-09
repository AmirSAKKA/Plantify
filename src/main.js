import { createPlotView } from './canvas.js';
import { createDirectionDial } from './dial.js';
import { createBasemap, createDrawer, installGoogleMaps, loadMapLibraries } from './map.js';
import { measureOutline, measureVertices } from './measure.js';
import { SAMPLE_PLOT } from './sample-plot.js';

const boot = document.querySelector('#boot');
const setup = document.querySelector('#setup');
const workspace = document.querySelector('#workspace');
const mapView = document.querySelector('#map-view');
const canvasView = document.querySelector('#canvas-view');
const hint = document.querySelector('#hint');
const notice = document.querySelector('#notice');
const undoButton = document.querySelector('#undo');
const closeButton = document.querySelector('#close-shape');
const clearButton = document.querySelector('#clear');
const toCanvasButton = document.querySelector('#to-canvas');
const locateButton = document.querySelector('#locate');
const backButton = document.querySelector('#back');
const sheet = document.querySelector('#sheet');
const canvas = document.querySelector('#plot');
const resetButton = document.querySelector('#reset-view');
const spacingX = document.querySelector('#spacing-x');
const spacingY = document.querySelector('#spacing-y');
const plantingGap = document.querySelector('#planting-gap');
const fenceOffset = document.querySelector('#fence-offset');
const fenceSpacing = document.querySelector('#fence-spacing');
const rowAngleReadout = document.querySelector('#row-angle-readout');
const dial = createDirectionDial(document.querySelector('#row-dial'));
const plantCount = document.querySelector('#plant-count');
const fieldCount = document.querySelector('#field-count');
const fenceCount = document.querySelector('#fence-count');
const plantingForm = document.querySelector('#planting');
const plotView = createPlotView(canvas);
plotView.onChange(() => applyPlanting());

let spherical = null;
let drawer = null;
let measurement = null;
let dirty = false;

undoButton.addEventListener('click', () => drawer?.undo());
closeButton.addEventListener('click', () => drawer?.closeShape());
clearButton.addEventListener('click', () => {
  drawer?.clear();
  measurement = null;
  dirty = false;
  showMap();
});
toCanvasButton.addEventListener('click', () => publishDrawing());
locateButton.addEventListener('click', () => drawer?.locate());
backButton.addEventListener('click', showMap);
resetButton.addEventListener('click', () => {
  plotView.resetView();
  paint();
});
plantingForm.addEventListener('submit', (event) => event.preventDefault());
spacingX.addEventListener('input', applyPlanting);
spacingY.addEventListener('input', applyPlanting);
plantingGap.addEventListener('input', applyPlanting);
fenceOffset.addEventListener('input', applyPlanting);
fenceSpacing.addEventListener('input', applyPlanting);
dial.onChange(() => applyPlanting());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !canvasView.hidden) {
    showMap();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && canvasView.hidden) {
    event.preventDefault();
    drawer?.undo();
  }
});

new ResizeObserver(() => {
  if (!canvasView.hidden) paint();
}).observe(sheet);

document.fonts?.ready.then(() => {
  if (!canvasView.hidden) paint();
});

measurement = measureOutline(SAMPLE_PLOT);
boot.hidden = true;
workspace.hidden = false;
showCanvas();

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
if (apiKey) {
  window.gm_authFailure = () => {
    setNotice('Google Maps rejected the API key. Check that the Maps JavaScript API is enabled and billing is on.');
  };
  startMap(apiKey);
}

async function startMap(key) {
  try {
    installGoogleMaps(key);
    const libraries = await loadMapLibraries();
    spherical = libraries.spherical;
    const map = createBasemap(libraries.Map, document.querySelector('#map'));
    drawer = createDrawer(map, {
      onChange: renderMapState,
      onClosed: () => publishDrawing(),
      onEdit: () => {
        dirty = true;
        toCanvasButton.textContent = 'Update drawing';
      },
      onNotice: setNotice,
    });
    drawer.loadOutline(SAMPLE_PLOT);
    boot.hidden = true;
    workspace.hidden = false;
  } catch (error) {
    setNotice(error.message || 'Google Maps could not be loaded.');
  }
}

function publishDrawing() {
  const vertices = drawer.readVertices();
  if (vertices.length < 3 || !spherical) return;
  measurement = measureVertices(vertices, spherical);
  dirty = false;
  toCanvasButton.textContent = 'Show drawing';
  showCanvas();
}

function renderMapState(state) {
  const closed = state.closed && state.count >= 3;
  undoButton.hidden = !state.drawing;
  undoButton.disabled = state.count === 0;
  closeButton.hidden = !state.drawing || state.count < 3;
  clearButton.disabled = state.count === 0 && !state.closed;
  toCanvasButton.hidden = !closed;
  if (!dirty) toCanvasButton.textContent = 'Show drawing';

  if (state.drawing && state.count === 0) {
    hint.textContent = 'Click each corner of the land. Drag to move around the map, and click the first corner again to close the outline.';
  } else if (state.drawing && state.count < 3) {
    hint.textContent = `${state.count} corner${state.count === 1 ? '' : 's'} placed. Add at least three, then close the outline.`;
  } else if (state.drawing) {
    hint.textContent = 'Click the first corner again to close the outline.';
  } else if (closed) {
    hint.textContent = 'Drag a corner to adjust it, or right-click a corner to remove it. Update the drawing when the outline is right.';
  } else {
    hint.textContent = 'The outline needs at least three corners.';
  }
}

function showMap() {
  canvasView.hidden = true;
  mapView.hidden = false;
  requestAnimationFrame(() => drawer?.frameOutline());
}

function showCanvas() {
  mapView.hidden = true;
  canvasView.hidden = false;
  plotView.setMeasurement(measurement);
  applyPlanting();
  requestAnimationFrame(paint);
}

function applyPlanting() {
  const orientation = plotView.setPlanting({
    x: spacingX.value,
    y: spacingY.value,
    gap: plantingGap.value,
    angle: dial.value,
    fenceOffset: fenceOffset.value,
    fenceSpacing: fenceSpacing.value,
  });
  const degrees = formatAngle(orientation.angle);
  const parallel = orientation.parallelEdge != null;
  rowAngleReadout.textContent = parallel ? `${degrees}° parallel` : `${degrees}°`;
  dial.show({
    angle: orientation.angle,
    parallel,
    parallelEdge: orientation.parallelEdge,
    edges: orientation.edges,
    label: parallel ? `${degrees} degrees, parallel to an edge` : `${degrees} degrees`,
  });
  const ready = Number(spacingX.value) > 0 && Number(spacingY.value) > 0;
  const fenceReady = Number(fenceOffset.value) > 0 && Number(fenceSpacing.value) > 0;
  plantCount.hidden = !ready && !fenceReady;
  fieldCount.hidden = !ready;
  fenceCount.hidden = !fenceReady;
  if (ready) {
    fieldCount.textContent = orientation.count === 1
      ? '1 plant'
      : `${orientation.count.toLocaleString('en-US')} plants`;
  }
  if (fenceReady) {
    fenceCount.textContent = orientation.fenceCount === 1
      ? '1 along the fences'
      : `${orientation.fenceCount.toLocaleString('en-US')} along the fences`;
  }
  paint();
}

function formatAngle(degrees) {
  const rounded = Math.round(degrees * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function paint() {
  plotView.draw();
}

function setNotice(message) {
  notice.hidden = !message;
  notice.textContent = message;
}

function showSetup(detail) {
  boot.hidden = true;
  workspace.hidden = true;
  setup.hidden = false;
  if (!detail) return;
  const lede = setup.querySelector('.lede');
  lede.textContent = detail;
}
