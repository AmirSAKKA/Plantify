const SVG = 'http://www.w3.org/2000/svg';

export function createDirectionDial(root) {
  const svg = root.querySelector('svg');
  let angle = 0;
  let dragging = false;
  let listener = () => {};

  root.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try {
      root.setPointerCapture(event.pointerId);
    } catch {
      /* The pointer is already captured, or this event cannot capture. */
    }
    dragging = true;
    root.classList.add('is-dragging');
    applyPointer(event);
  });
  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    applyPointer(event);
  });
  root.addEventListener('pointerup', (event) => {
    applyPointer(event);
    endDrag(event);
  });
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.1 : 1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nudge(step, event);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nudge(-step, event);
  });
  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 1;
    nudge(Math.sign(event.deltaY) * step);
  }, { passive: false });

  return {
    get value() {
      return angle;
    },
    onChange(next) {
      listener = next;
    },
    show(state) {
      paint(state);
      const shown = normalize(state?.angle);
      root.setAttribute('aria-valuenow', String(shown));
      root.setAttribute('aria-valuetext', state?.label || `${shown} degrees`);
      root.classList.toggle('parallel', state?.parallel === true);
    },
  };

  function endDrag(event) {
    dragging = false;
    root.classList.remove('is-dragging');
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  }

  function applyPointer(event) {
    const rect = root.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (dx * dx + dy * dy < 16) return;
    const next = normalize(Math.atan2(dx, -dy) * 180 / Math.PI);
    if (next === angle) return;
    angle = next;
    listener(angle);
  }

  function nudge(step, event) {
    event?.preventDefault();
    angle = normalize(angle + step);
    listener(angle);
  }

  function paint(state) {
    const shown = normalize(state?.angle);
    const edges = state?.edges || [];
    svg.replaceChildren(
      circle(40, 40, 31, 'dial-ring'),
      ...edges.flatMap((edge) => tick(edge.degrees, edge.index === state?.parallelEdge)),
      spoke(shown + 90, 15, 'dial-cross'),
      spoke(shown, 21, 'dial-rows'),
      circle(40, 40, 2.4, 'dial-hub'),
      northMark(),
    );
  }
}

function tick(degrees, active) {
  const group = document.createElementNS(SVG, 'g');
  group.setAttribute('class', active ? 'dial-edge is-parallel' : 'dial-edge');
  group.append(mark(degrees, active ? 20 : 25, active ? 33 : 31));
  group.append(mark(degrees + 180, active ? 20 : 25, active ? 33 : 31));
  return group;
}

function mark(degrees, inner, outer) {
  const start = polar(degrees, inner);
  const end = polar(degrees, outer);
  const line = document.createElementNS(SVG, 'line');
  line.setAttribute('x1', start.x);
  line.setAttribute('y1', start.y);
  line.setAttribute('x2', end.x);
  line.setAttribute('y2', end.y);
  return line;
}

function spoke(degrees, radius, className) {
  const start = polar(degrees, radius);
  const end = polar(degrees + 180, radius);
  const line = document.createElementNS(SVG, 'line');
  line.setAttribute('class', className);
  line.setAttribute('x1', start.x);
  line.setAttribute('y1', start.y);
  line.setAttribute('x2', end.x);
  line.setAttribute('y2', end.y);
  return line;
}

function circle(cx, cy, r, className) {
  const node = document.createElementNS(SVG, 'circle');
  node.setAttribute('class', className);
  node.setAttribute('cx', cx);
  node.setAttribute('cy', cy);
  node.setAttribute('r', r);
  return node;
}

function northMark() {
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('class', 'dial-north');
  text.setAttribute('x', 40);
  text.setAttribute('y', 10);
  text.textContent = 'N';
  return text;
}

function polar(degrees, radius) {
  const theta = degrees * Math.PI / 180;
  return {
    x: 40 + Math.sin(theta) * radius,
    y: 40 - Math.cos(theta) * radius,
  };
}

function normalize(value) {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 180) + 180) % 180;
  return wrapped === 180 ? 0 : wrapped;
}
