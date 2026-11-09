const EARTH_RADIUS = 6378137;

export function toLocalMeters(vertices) {
  const lat0 = vertices.reduce((sum, vertex) => sum + vertex.lat, 0) / vertices.length;
  const lng0 = vertices.reduce((sum, vertex) => sum + vertex.lng, 0) / vertices.length;
  const cos = Math.cos((lat0 * Math.PI) / 180);

  return vertices.map((vertex) => ({
    x: ((vertex.lng - lng0) * Math.PI) / 180 * cos * EARTH_RADIUS,
    y: ((vertex.lat - lat0) * Math.PI) / 180 * EARTH_RADIUS,
  }));
}

export function measureOutline(vertices) {
  const local = toLocalMeters(vertices);
  const sides = local.map((point, index) => {
    const next = local[(index + 1) % local.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  let shoelace = 0;
  for (let index = 0; index < local.length; index += 1) {
    const next = local[(index + 1) % local.length];
    shoelace += local[index].x * next.y - next.x * local[index].y;
  }
  return {
    vertices: vertices.map((vertex) => ({ lat: vertex.lat, lng: vertex.lng })),
    sides,
    area: Math.abs(shoelace / 2),
    perimeter: sides.reduce((sum, side) => sum + side, 0),
  };
}

export function measureVertices(vertices, spherical) {
  const sides = vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return spherical.computeDistanceBetween(vertex, next);
  });
  const area = Math.abs(spherical.computeArea(vertices));
  const perimeter = sides.reduce((sum, side) => sum + side, 0);

  return {
    vertices: vertices.map((vertex) => ({ lat: vertex.lat, lng: vertex.lng })),
    sides,
    area,
    perimeter,
  };
}

export function formatMeters(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(1)} m`;
}

export function formatSquareMeters(squareMeters) {
  if (!Number.isFinite(squareMeters)) return '—';
  return `${Math.round(squareMeters).toLocaleString('en-US')} m²`;
}

export function formatHectares(squareMeters) {
  if (!Number.isFinite(squareMeters) || squareMeters < 10000) return null;
  return `${(squareMeters / 10000).toFixed(2)} ha`;
}
