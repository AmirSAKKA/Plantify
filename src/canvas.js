import { formatHectares, formatMeters, formatSquareMeters, toLocalMeters } from './measure.js';

const PAPER = '#f3f0e8';
const INK = '#1e3a2f';
const MUTED = '#5e6b64';
const GROUND = '#e6e0d4';
const TOP = '#d5e4d8';
const ROW = '#246b45';
const PLANT = '#143d28';
const FENCE_ROW = '#b8612d';
const FENCE_PLANT = '#8a3f12';
const SNAP_DEGREES = 5;

export function createPlotView(canvas) {
  const pointers = new Map();
  let pinchDistance = 0;
  let model = null;
  let frame = null;
  let planting = { x: 0, y: 0, angle: 0, gap: 0, fenceOffset: 0, fenceSpacing: 0 };
  let bed = [];
  let openEdges = new Set();
  let plantingListener = () => {};
  let orientation = { angle: 0, parallelEdge: null };
  let plants = [];
  let fencePlants = [];
  let fenceSegments = [];
  const view = {
    yaw: 0.6,
    pitch: 0.95,
    distance: 1,
    panX: 0,
    panY: 0,
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) canvas.style.cursor = '';
  });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('dblclick', () => {
    resetView();
    draw();
  });

  return {
    setMeasurement,
    setPlanting,
    draw,
    resetView,
    onChange(listener) {
      plantingListener = listener;
    },
  };

  function setPlanting(next) {
    planting = {
      x: positiveMeters(next?.x),
      y: positiveMeters(next?.y),
      angle: normalizeBearing(next?.angle),
      gap: positiveMeters(next?.gap),
      fenceOffset: positiveMeters(next?.fenceOffset),
      fenceSpacing: positiveMeters(next?.fenceSpacing),
    };
    bed = insetPolygon(model?.top, planting.gap, openEdges);
    orientation = orientPlanting(model?.top, planting.angle);
    plants = plantPositions(model?.top, bed, planting, orientation.angle);
    const fence = fenceParallelLayer(model?.top, planting, openEdges);
    fencePlants = fence.plants;
    fenceSegments = fence.segments;
    return { ...orientation, count: plants.length, fenceCount: fencePlants.length, openEdges: openEdges.size };
  }

  function setMeasurement(measurement) {
    if (!measurement?.vertices || measurement.vertices.length < 3) {
      model = null;
      openEdges.clear();
      return;
    }
    if (!sameVertices(model?.measurement?.vertices, measurement.vertices)) openEdges.clear();
    model = buildModel(measurement);
    resetView();
  }

  function resetView() {
    if (!model) return;
    view.yaw = 0.6;
    view.pitch = 0.95;
    view.panX = 0;
    view.panY = 0;
    view.distance = model.fitDistance;
  }

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 10 || height < 10 || !model) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    const spacingReady = planting.x > 0 && planting.y > 0;
    const legendBottom = drawLegend(ctx, model.measurement, {
      plants: spacingReady ? plants.length : null,
      fence: planting.fenceOffset > 0 && planting.fenceSpacing > 0 ? fencePlants.length : null,
    }, planting.gap > 0);
    const viewHeight = Math.max(height - legendBottom, 40);
    frame = {
      width,
      height,
      viewHeight,
      originX: width / 2,
      originY: legendBottom + viewHeight / 2,
      focal: Math.min(width, viewHeight) * 1.05,
    };
    const nextFit = fitDistance(model, frame);
    if (!model.fitDistance) {
      model.fitDistance = nextFit;
      view.distance = nextFit;
    } else if (model.frameKey !== `${width}x${height}`) {
      view.distance *= nextFit / model.fitDistance;
      model.fitDistance = nextFit;
    }
    model.frameKey = `${width}x${height}`;

    const camera = buildCamera();
    paintFlat(ctx, projectRing(model.ground, camera), GROUND);
    paintFlat(ctx, projectRing(model.top, camera), TOP);
    const planted = drawPlanting(ctx, camera);
    drawGap(ctx, camera);
    drawFenceLines(ctx, camera);
    if (planted) drawPlants(ctx, camera);
    drawFencePlants(ctx, camera);

    const top = projectRing(model.top, camera).filter(Boolean);
    if (top.length === model.top.length) {
      strokeRing(ctx, top);
      drawOpenEdges(ctx, camera);
      drawCorners(ctx, top);
      drawSideLabels(ctx, top, model.measurement.sides);
      if (planted) drawParallelEdge(ctx, camera, orientation.parallelEdge);
    }
    drawNorth(ctx, camera);
  }

  function drawPlanting(ctx, camera) {
    const segments = plantingSegments(model.top, bed, planting, orientation.angle);
    if (!segments.length) return false;
    ctx.strokeStyle = ROW;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    for (const [start, end] of segments) {
      const projectedStart = project(start, camera);
      const projectedEnd = project(end, camera);
      if (!projectedStart || !projectedEnd) continue;
      ctx.moveTo(projectedStart.x, projectedStart.y);
      ctx.lineTo(projectedEnd.x, projectedEnd.y);
    }
    ctx.stroke();
    return true;
  }

  function drawPlants(ctx, camera) {
    drawPlantDots(ctx, camera, plants, PLANT, 2.6);
  }

  function drawFenceLines(ctx, camera) {
    if (!fenceSegments.length) return;
    ctx.strokeStyle = FENCE_ROW;
    ctx.lineWidth = 1.35;
    ctx.beginPath();
    for (const [start, end] of fenceSegments) {
      const projectedStart = project(start, camera);
      const projectedEnd = project(end, camera);
      if (!projectedStart || !projectedEnd) continue;
      ctx.moveTo(projectedStart.x, projectedStart.y);
      ctx.lineTo(projectedEnd.x, projectedEnd.y);
    }
    ctx.stroke();
  }

  function drawFencePlants(ctx, camera) {
    drawPlantDots(ctx, camera, fencePlants, FENCE_PLANT, 3);
  }

  function drawPlantDots(ctx, camera, points, color, radius) {
    if (!points.length) return;
    ctx.fillStyle = color;
    for (const plant of points) {
      const projected = project(plant, camera);
      if (!projected) continue;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGap(ctx, camera) {
    if (!(planting.gap > 0) || bed.length < 3) return;
    const ring = projectRing(bed, camera);
    if (ring.some((point) => !point)) return;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = ROW;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    for (let index = 0; index < bed.length; index += 1) {
      const next = (index + 1) % bed.length;
      const midpoint = {
        x: (bed[index].x + bed[next].x) / 2,
        y: (bed[index].y + bed[next].y) / 2,
      };
      if (distanceToPolygon(midpoint, model.top) < 0.2) continue;
      ctx.moveTo(ring[index].x, ring[index].y);
      ctx.lineTo(ring[next].x, ring[next].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawOpenEdges(ctx, camera) {
    if (!(planting.gap > 0) || openEdges.size === 0) return;
    const ring = projectRing(model.top, camera);
    if (ring.some((point) => !point)) return;
    ctx.lineCap = 'round';
    for (const index of openEdges) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      if (!start || !end) continue;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = ROW;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
  }

  function drawParallelEdge(ctx, camera, edgeIndex) {
    if (edgeIndex == null) return;
    const start = model.top[edgeIndex];
    const end = model.top[(edgeIndex + 1) % model.top.length];
    const projectedStart = project(start, camera);
    const projectedEnd = project(end, camera);
    if (!projectedStart || !projectedEnd) return;
    ctx.strokeStyle = ROW;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(projectedStart.x, projectedStart.y);
    ctx.lineTo(projectedEnd.x, projectedEnd.y);
    ctx.stroke();
  }

  function drawNorth(ctx, camera) {
    const [base, tip] = model.north.map((point) => project(point, camera));
    if (!base || !tip) return;
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.font = '600 13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MUTED;
    ctx.fillText('N', tip.x, tip.y - 12);
  }

  function onPointerDown(event) {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* This pointer cannot be captured. */
    }
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      button: event.button,
      moved: false,
    });
    pinchDistance = 0;
  }

  function onPointerMove(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) {
      updateHover(event);
      return;
    }
    if (!model) return;
    const travel = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
    if (!pointer.moved && travel < 6 && pointers.size < 2) return;
    pointer.moved = true;

    if (pointers.size >= 2) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const [first, second] = pointers.values();
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinchDistance > 0) {
        view.distance = clampDistance((view.distance * pinchDistance) / distance);
        draw();
      }
      pinchDistance = distance;
      return;
    }

    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.button === 1 || pointer.button === 2 || event.shiftKey) move(dx, dy);
    else orbit(dx, dy);
    draw();
  }

  function onPointerUp(event) {
    const pointer = pointers.get(event.pointerId);
    const alone = pointers.size === 1;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (!pointer || !alone || pointer.moved || pointer.button !== 0 || event.shiftKey) return;
    if (!(planting.gap > 0)) return;
    const edge = edgeAt(event.clientX, event.clientY);
    if (edge == null) return;
    if (openEdges.has(edge)) openEdges.delete(edge);
    else openEdges.add(edge);
    plantingListener();
  }

  function updateHover(event) {
    if (!model || !(planting.gap > 0)) {
      canvas.style.cursor = '';
      return;
    }
    canvas.style.cursor = edgeAt(event.clientX, event.clientY) == null ? '' : 'pointer';
  }

  function edgeAt(clientX, clientY) {
    if (!model || !frame) return null;
    const rect = canvas.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    const ring = projectRing(model.top, buildCamera());
    let best = null;
    let bestDistance = 22;
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      if (!start || !end) continue;
      const distance = distanceToSegment(point, start, end);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  function onWheel(event) {
    if (!model) return;
    event.preventDefault();
    const amount = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    view.distance = clampDistance(view.distance * Math.exp(amount * 0.0012));
    draw();
  }

  function orbit(dx, dy) {
    view.yaw -= dx * 0.007;
    view.pitch = clamp(view.pitch + dy * 0.007, 0.2, 1.48);
  }

  function move(dx, dy) {
    const camera = buildCamera();
    const scale = view.distance / (frame?.focal || 600);
    view.panX += (dx * camera.right.x - dy * camera.up.x) * scale;
    view.panY += (dx * camera.right.y - dy * camera.up.y) * scale;
  }

  function buildCamera() {
    const target = {
      x: model.center.x + view.panX,
      y: model.center.y + view.panY,
      z: 0,
    };
    const cosPitch = Math.cos(view.pitch);
    const sinPitch = Math.sin(view.pitch);
    const cosYaw = Math.cos(view.yaw);
    const sinYaw = Math.sin(view.yaw);
    const eye = {
      x: target.x + view.distance * cosPitch * sinYaw,
      y: target.y - view.distance * cosPitch * cosYaw,
      z: target.z + view.distance * sinPitch,
    };
    const forward = normalize(sub(target, eye));
    let right = cross(forward, { x: 0, y: 0, z: 1 });
    if (length(right) < 1e-4) right = { x: 1, y: 0, z: 0 };
    else right = normalize(right);
    const up = cross(right, forward);
    return { eye, right, up, forward };
  }

  function project(point, camera) {
    const relative = sub(point, camera.eye);
    const x = dot(relative, camera.right);
    const y = dot(relative, camera.up);
    const depth = dot(relative, camera.forward);
    if (depth < 0.5) return null;
    return {
      x: frame.originX + (x / depth) * frame.focal,
      y: frame.originY - (y / depth) * frame.focal,
      depth,
    };
  }

  function projectRing(points, camera) {
    return points.map((point) => project(point, camera));
  }

  function clampDistance(distance) {
    const fit = model.fitDistance || distance;
    return clamp(distance, fit * 0.18, fit * 8);
  }
}

function buildModel(measurement) {
  const local = toLocalMeters(measurement.vertices);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of local) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const span = Math.max(maxX - minX, maxY - minY, 1);
  const top = local.map((point) => ({ x: point.x, y: point.y, z: 0 }));
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: 0 };
  const reach = span * 6;
  const ground = [
    { x: center.x - reach, y: center.y - reach, z: 0 },
    { x: center.x + reach, y: center.y - reach, z: 0 },
    { x: center.x + reach, y: center.y + reach, z: 0 },
    { x: center.x - reach, y: center.y + reach, z: 0 },
  ];

  const radius = Math.hypot(maxX - minX, maxY - minY) / 2;
  return {
    measurement,
    top,
    ground,
    center,
    span,
    radius,
    fitDistance: 0,
    north: [
      { x: center.x, y: maxY + span * 0.1, z: 0 },
      { x: center.x, y: maxY + span * 0.24, z: 0 },
    ],
  };
}

function fitDistance(model, frame) {
  const screenRadius = Math.min(frame.width, frame.viewHeight) * 0.33;
  return (frame.focal * Math.max(model.radius, 1)) / screenRadius;
}

function orientPlanting(polygon, angle) {
  if (!polygon?.length) return { angle: normalizeBearing(angle), parallelEdge: null, edges: [] };
  const edges = edgeBearings(polygon);
  return { ...snapBearing(angle, edges), edges };
}

function edgeBearings(polygon) {
  return polygon.map((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return {
      index,
      degrees: normalizeBearing(Math.atan2(end.x - start.x, end.y - start.y) * 180 / Math.PI),
      length: Math.hypot(end.x - start.x, end.y - start.y),
    };
  });
}

function snapBearing(angle, edges) {
  const target = normalizeBearing(angle);
  let best = null;
  for (const edge of edges) {
    const delta = Math.min(Math.abs(target - edge.degrees), 180 - Math.abs(target - edge.degrees));
    const closer = !best || delta < best.delta - 0.05 || (Math.abs(delta - best.delta) <= 0.05 && edge.length > best.length);
    if (delta <= SNAP_DEGREES && closer) best = { ...edge, delta };
  }
  if (!best) return { angle: target, parallelEdge: null };
  return { angle: best.degrees, parallelEdge: best.index };
}

function plantingSegments(fence, bed, spacing, angle) {
  if (!fence?.length || bed.length < 3) return [];
  const frame = plantingFrame(fence, angle);
  const clip = gridRing(bed, frame.origin, frame.theta);
  const segments = [];
  for (const position of linePositions(frame.minV, frame.maxV, spacing.x, 0)) {
    for (const segment of clippedSegments(clip, 'x', position)) {
      segments.push(segment.map((point) => gridToWorld(point.y, point.x, frame.origin, frame.theta)));
    }
  }
  for (const position of linePositions(frame.minU, frame.maxU, spacing.y, 0)) {
    for (const segment of clippedSegments(clip, 'y', position)) {
      segments.push(segment.map((point) => gridToWorld(point.y, point.x, frame.origin, frame.theta)));
    }
  }
  return segments;
}

export function countPlants(polygon, spacing, angle, gap = 0, openEdges = []) {
  const bed = insetPolygon(polygon, positiveMeters(gap), openEdges);
  return plantPositions(polygon, bed, {
    x: positiveMeters(spacing?.x),
    y: positiveMeters(spacing?.y),
  }, Number(angle) || 0).length;
}

export function countFencePlants(polygon, spacing, offset = 0, openEdges = []) {
  return fenceParallelLayer(polygon, {
    fenceOffset: positiveMeters(offset),
    fenceSpacing: positiveMeters(spacing),
  }, openEdges).plants.length;
}

function fenceParallelLayer(polygon, planting, openEdges = []) {
  const offset = planting?.fenceOffset;
  const spacing = planting?.fenceSpacing;
  if (!polygon || polygon.length < 3 || !(offset > 0) || !(spacing > 0)) {
    return { plants: [], segments: [] };
  }
  if (offset > 500 || spacing > 500 || polygon.length * (1 / spacing) > 8000) {
    return { plants: [], segments: [] };
  }
  const open = openEdges instanceof Set ? openEdges : new Set(openEdges);
  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-6) return { plants: [], segments: [] };
  const ccw = area > 0;
  const plants = [];
  const segments = [];

  for (let index = 0; index < polygon.length; index += 1) {
    if (open.has(index)) continue;
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength < 0.3) continue;
    const normal = inwardNormal(start, end, ccw);
    const lineFrom = Math.min(offset, edgeLength / 2);
    const lineTo = Math.max(lineFrom, edgeLength - offset);
    if (lineTo - lineFrom >= 0.2) {
      segments.push(...clipOutsideBed(
        pointOnEdge(start, dx, dy, edgeLength, lineFrom, normal, offset),
        pointOnEdge(start, dx, dy, edgeLength, lineTo, normal, offset),
        polygon,
        [],
      ));
    }
    for (const distance of alongFence(edgeLength, spacing)) {
      const point = pointOnEdge(start, dx, dy, edgeLength, distance, normal, offset);
      if (acceptFencePlant(point, polygon, index)) plants.push(point);
    }
  }

  return {
    plants: dedupePoints(plants, spacing * 0.35),
    segments,
  };
}

function pointOnEdge(start, dx, dy, edgeLength, distance, normal, offset) {
  return {
    x: start.x + (dx / edgeLength) * distance + normal.x * offset,
    y: start.y + (dy / edgeLength) * distance + normal.y * offset,
    z: 0,
  };
}

function alongFence(edgeLength, spacing) {
  if (edgeLength < spacing * 0.4) return [edgeLength / 2];
  const inner = edgeLength - spacing;
  if (inner < 0) return [edgeLength / 2];
  const steps = Math.floor(inner / spacing) + 1;
  const used = (steps - 1) * spacing;
  const start = (edgeLength - used) / 2;
  const positions = [];
  for (let step = 0; step < steps; step += 1) positions.push(start + step * spacing);
  return positions;
}

function acceptFencePlant(point, polygon, edgeIndex) {
  if (!strictlyInside(point, polygon)) return false;
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    const distance = distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]);
    if (distance < nearestDistance - 1e-6) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest === edgeIndex;
}

function clipOutsideBed(start, end, polygon, bed) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const params = [0, 1];
  collectCrossings(start, end, polygon, params);
  if (bed.length >= 3) collectCrossings(start, end, bed, params);
  params.sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index + 1 < params.length; index += 1) {
    const from = params[index];
    const to = params[index + 1];
    if (to - from < 1e-4) continue;
    const mid = {
      x: start.x + dx * ((from + to) / 2),
      y: start.y + dy * ((from + to) / 2),
    };
    if (!pointInPolygon(mid, polygon)) continue;
    if (bed.length >= 3 && (pointInPolygon(mid, bed) || distanceToPolygon(mid, bed) <= 0.05)) continue;
    const length = Math.hypot(dx * (to - from), dy * (to - from));
    if (length < 0.2) continue;
    segments.push([
      { x: start.x + dx * from, y: start.y + dy * from, z: 0 },
      { x: start.x + dx * to, y: start.y + dy * to, z: 0 },
    ]);
  }
  return segments;
}

function collectCrossings(start, end, polygon, params) {
  for (let index = 0; index < polygon.length; index += 1) {
    const crossing = segmentCrossing(start, end, polygon[index], polygon[(index + 1) % polygon.length]);
    if (crossing != null && crossing > 1e-6 && crossing < 1 - 1e-6) params.push(crossing);
  }
}

function segmentCrossing(start, end, otherStart, otherEnd) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const otherDx = otherEnd.x - otherStart.x;
  const otherDy = otherEnd.y - otherStart.y;
  const denom = dx * otherDy - dy * otherDx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((otherStart.x - start.x) * otherDy - (otherStart.y - start.y) * otherDx) / denom;
  const u = ((otherStart.x - start.x) * dy - (otherStart.y - start.y) * dx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

function dedupePoints(points, radius) {
  const kept = [];
  const limit = radius * radius;
  for (const point of points) {
    const duplicate = kept.some((other) => {
      const dx = point.x - other.x;
      const dy = point.y - other.y;
      return dx * dx + dy * dy < limit;
    });
    if (!duplicate) kept.push(point);
  }
  return kept;
}

function plantPositions(fence, bed, spacing, angle) {
  if (!fence?.length || bed.length < 3 || !(spacing.x > 0) || !(spacing.y > 0)) return [];
  const frame = plantingFrame(fence, angle);
  const across = linePositions(frame.minV, frame.maxV, spacing.x, 0);
  const along = linePositions(frame.minU, frame.maxU, spacing.y, 0);
  const positions = [];
  for (const v of across) {
    for (const u of along) {
      const point = gridToWorld(u, v, frame.origin, frame.theta);
      if (strictlyInside(point, bed)) positions.push(point);
    }
  }
  return positions;
}

function insetPolygon(polygon, distance, openEdges = []) {
  if (!polygon || polygon.length < 3) return [];
  const open = openEdges instanceof Set ? openEdges : new Set(openEdges);
  const clearances = polygon.map((_, index) => (distance > 0 && !open.has(index) ? distance : 0));
  if (clearances.every((value) => value === 0)) {
    return polygon.map((point) => ({ x: point.x, y: point.y, z: 0 }));
  }
  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-6) return [];
  const ccw = area > 0;
  const inset = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const incoming = clearances[(index + polygon.length - 1) % polygon.length];
    inset.push(...insetCorner(previous, current, next, incoming, clearances[index], ccw, polygon));
  }
  const cleaned = dedupeRing(inset);
  if (cleaned.length < 3) return [];
  const nextArea = signedArea(cleaned);
  if (nextArea * area <= 0 || Math.abs(nextArea) < 1 || Math.abs(nextArea) >= Math.abs(area)) return [];
  if (cleaned.some((point) => !insideOrOn(point, polygon))) return [];
  if (!keepsClearance(cleaned, polygon, clearances)) return [];
  return cleaned;
}

function keepsClearance(inset, polygon, clearances) {
  for (let index = 0; index < inset.length; index += 1) {
    const start = inset[index];
    const end = inset[(index + 1) % inset.length];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (!insideOrOn(midpoint, polygon)) return false;
  }
  const ccw = signedArea(polygon) > 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const inward = inwardNormal(start, end, ccw);
    const required = clearances[index];
    if (required === 0) {
      if (distanceToPolygon(midpoint, inset) > 0.05) return false;
      continue;
    }
    const gapPoint = offsetPoint(midpoint, inward, required * 0.5);
    const bedPoint = offsetPoint(midpoint, inward, required + 0.4);
    if (pointInPolygon(gapPoint, inset)) return false;
    if (!pointInPolygon(bedPoint, inset)) return false;
  }
  return true;
}

function distanceToPolygon(point, polygon) {
  let nearest = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    nearest = Math.min(nearest, distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return nearest;
}

function insetCorner(previous, current, next, before, after, ccw, polygon) {
  const firstNormal = inwardNormal(previous, current, ccw);
  const secondNormal = inwardNormal(current, next, ccw);
  const alongFirst = offsetPoint(current, firstNormal, before);
  const alongSecond = offsetPoint(current, secondNormal, after);
  if (before === 0 && after === 0) return [{ x: current.x, y: current.y, z: 0 }];
  const hit = lineIntersection(
    offsetPoint(previous, firstNormal, before),
    alongFirst,
    alongSecond,
    offsetPoint(next, secondNormal, after),
  );
  const span = Math.max(before, after, 0.001);
  const miter = hit ? Math.hypot(hit.x - current.x, hit.y - current.y) : Infinity;
  if (!hit || miter > span * 4 || !insideOrOn(hit, polygon)) return [alongFirst, alongSecond];
  return [{ x: hit.x, y: hit.y, z: 0 }];
}

function inwardNormal(start, end, ccw) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  return ccw
    ? { x: -dy / length, y: dx / length }
    : { x: dy / length, y: -dx / length };
}

function offsetPoint(point, normal, distance) {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance, z: 0 };
}

function lineIntersection(start, end, otherStart, otherEnd) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const otherDx = otherEnd.x - otherStart.x;
  const otherDy = otherEnd.y - otherStart.y;
  const denom = dx * otherDy - dy * otherDx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((otherStart.x - start.x) * otherDy - (otherStart.y - start.y) * otherDx) / denom;
  return { x: start.x + t * dx, y: start.y + t * dy, z: 0 };
}

function signedArea(polygon) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = polygon[(index + 1) % polygon.length];
    sum += polygon[index].x * next.y - next.x * polygon[index].y;
  }
  return sum / 2;
}

function dedupeRing(points) {
  const cleaned = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.001) continue;
    cleaned.push(point);
  }
  if (cleaned.length > 1 && Math.hypot(cleaned[0].x - cleaned.at(-1).x, cleaned[0].y - cleaned.at(-1).y) < 0.001) {
    cleaned.pop();
  }
  return cleaned;
}

function insideOrOn(point, polygon) {
  if (pointInPolygon(point, polygon)) return true;
  for (let index = 0; index < polygon.length; index += 1) {
    if (distanceToSegment(point, polygon[index], polygon[(index + 1) % polygon.length]) <= 0.02) return true;
  }
  return false;
}

function gridRing(polygon, origin, theta) {
  return polygon.map((point) => {
    const local = worldToGrid(point, origin, theta);
    return { x: local.v, y: local.u, z: 0 };
  });
}

function plantingFrame(polygon, angle) {
  const theta = angle * Math.PI / 180;
  const origin = polygonCenter(polygon);
  const grid = polygon.map((point) => {
    const local = worldToGrid(point, origin, theta);
    return { x: local.v, y: local.u, z: 0 };
  });
  let minV = Infinity;
  let minU = Infinity;
  let maxV = -Infinity;
  let maxU = -Infinity;
  for (const point of grid) {
    minV = Math.min(minV, point.x);
    minU = Math.min(minU, point.y);
    maxV = Math.max(maxV, point.x);
    maxU = Math.max(maxU, point.y);
  }
  return { theta, origin, grid, minV, minU, maxV, maxU };
}

function strictlyInside(point, polygon) {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (distanceToSegment(point, start, end) <= 0.001) return false;
  }
  return pointInPolygon(point, polygon);
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function polygonCenter(polygon) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function worldToGrid(point, origin, theta) {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return {
    u: dx * sin + dy * cos,
    v: dx * cos - dy * sin,
  };
}

function gridToWorld(u, v, origin, theta) {
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  return {
    x: origin.x + u * sin + v * cos,
    y: origin.y + u * cos - v * sin,
    z: 0,
  };
}

function normalizeBearing(value) {
  const degrees = Number(value);
  if (!Number.isFinite(degrees)) return 0;
  const wrapped = ((degrees % 180) + 180) % 180;
  return wrapped === 180 ? 0 : wrapped;
}

function linePositions(min, max, spacing, origin) {
  if (!(spacing > 0)) return [];
  if ((max - min) / spacing > 400) return [];
  const positions = [];
  const start = origin - Math.ceil((origin - min) / spacing) * spacing;
  for (let value = start; value <= max + spacing * 1e-6; value += spacing) {
    if (value >= min - 1e-6 && value <= max + 1e-6) positions.push(value);
  }
  return positions;
}

function clippedSegments(polygon, axis, value) {
  const crossings = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const startKey = axis === 'x' ? start.x : start.y;
    const endKey = axis === 'x' ? end.x : end.y;
    const startOther = axis === 'x' ? start.y : start.x;
    const endOther = axis === 'x' ? end.y : end.x;
    const crosses = (startKey <= value && endKey > value) || (endKey <= value && startKey > value);
    if (!crosses) continue;
    const ratio = (value - startKey) / (endKey - startKey);
    crossings.push(startOther + ratio * (endOther - startOther));
  }
  crossings.sort((left, right) => left - right);
  const segments = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    const from = crossings[index];
    const to = crossings[index + 1];
    if (to - from < 0.05) continue;
    segments.push(axis === 'x'
      ? [{ x: value, y: from, z: 0 }, { x: value, y: to, z: 0 }]
      : [{ x: from, y: value, z: 0 }, { x: to, y: value, z: 0 }]);
  }
  return segments;
}

function positiveMeters(value) {
  const meters = Number(value);
  return Number.isFinite(meters) && meters > 0 ? meters : 0;
}

function paintFlat(ctx, points, color) {
  if (points.some((point) => !point)) return;
  trace(ctx, points);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRing(ctx, points) {
  trace(ctx, points);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.75;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.stroke();
}

function drawCorners(ctx, points) {
  ctx.fillStyle = INK;
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.25, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSideLabels(ctx, points, sides) {
  ctx.font = '500 14px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  points.forEach((start, index) => {
    const end = points[(index + 1) % points.length];
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const edge = Math.hypot(dx, dy) || 1;
    let normalX = -dy / edge;
    let normalY = dx / edge;
    const probe = { x: midX + normalX * 12, y: midY + normalY * 12 };
    if (pointInPolygon(probe, points)) {
      normalX = -normalX;
      normalY = -normalY;
    }
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

    ctx.save();
    ctx.translate(midX + normalX * 18, midY + normalY * 18);
    ctx.rotate(angle);
    ctx.lineWidth = 5;
    ctx.strokeStyle = PAPER;
    ctx.strokeText(formatMeters(sides[index]), 0, 0);
    ctx.fillStyle = INK;
    ctx.fillText(formatMeters(sides[index]), 0, 0);
    ctx.restore();
  });
}

function drawLegend(ctx, measurement, counts, gapActive) {
  const hectares = formatHectares(measurement.area);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK;
  ctx.font = '600 28px Outfit, sans-serif';
  ctx.fillText(formatSquareMeters(measurement.area), 32, 28);

  ctx.font = '400 15px Outfit, sans-serif';
  ctx.fillStyle = MUTED;
  let y = 66;
  if (hectares) {
    ctx.fillText(hectares, 32, y);
    y += 22;
  }
  ctx.fillText(`Perimeter ${formatMeters(measurement.perimeter)}`, 32, y);
  y += 22;
  if (counts.plants != null) {
    y = drawCountLine(ctx, y, counts.plants === 1 ? '1 plant' : `${counts.plants.toLocaleString('en-US')} plants`, PLANT);
  }
  if (counts.fence != null) {
    const fenceLabel = counts.fence === 1
      ? '1 plant along the fences'
      : `${counts.fence.toLocaleString('en-US')} plants along the fences`;
    y = drawCountLine(ctx, y, fenceLabel, FENCE_PLANT);
  }
  ctx.font = '400 15px Outfit, sans-serif';
  ctx.fillStyle = MUTED;
  if (gapActive) {
    ctx.fillText('Click a side to plant up to the fence.', 32, y);
    y += 20;
  }
  ctx.fillText('Drag to turn. Scroll to zoom.', 32, y);
  y += 20;
  ctx.fillText('Right-drag to move.', 32, y);
  return y + 28;
}

function drawCountLine(ctx, y, label, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(36, y + 8, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = '600 15px Outfit, sans-serif';
  ctx.fillText(label, 48, y);
  return y + 22;
}

function sameVertices(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((point, index) => point.lat === right[index].lat && point.lng === right[index].lng);
}

function trace(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index];
    const prior = polygon[previous];
    const crosses = current.y > point.y !== prior.y > point.y;
    if (!crosses) continue;
    const xOnEdge = ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (point.x < xOnEdge) inside = !inside;
  }
  return inside;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector, amount) {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector) {
  const magnitude = length(vector) || 1;
  return scale(vector, 1 / magnitude);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
