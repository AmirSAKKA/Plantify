const MAPS_BOOTSTRAP = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps.googleapis.com/maps/api/js?"+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})`;

export function installGoogleMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return;
  const start = new Function(`${MAPS_BOOTSTRAP}(${JSON.stringify({ key: apiKey, v: 'weekly' })});`);
  start();
}

export async function loadMapLibraries() {
  const maps = await withTimeout(window.google.maps.importLibrary('maps'), 'Google Maps took too long to load.');
  const geometry = await window.google.maps.importLibrary('geometry');
  return {
    Map: maps.Map,
    spherical: geometry.spherical || window.google.maps.geometry.spherical,
  };
}

export function createBasemap(Map, element) {
  return new Map(element, {
    center: { lat: 46.6, lng: 2.5 },
    zoom: 6,
    mapTypeId: 'hybrid',
    tilt: 0,
    heading: 0,
    tiltInteractionEnabled: false,
    headingInteractionEnabled: false,
    disableDoubleClickZoom: true,
    fullscreenControl: false,
    streetViewControl: false,
    mapTypeControl: true,
    mapTypeControlOptions: {
      position: window.google.maps.ControlPosition.TOP_RIGHT,
    },
    zoomControlOptions: {
      position: window.google.maps.ControlPosition.RIGHT_CENTER,
    },
    gestureHandling: 'greedy',
  });
}

export function createDrawer(map, handlers) {
  const google = window.google;
  let vertices = [];
  let markers = [];
  let polygon = null;
  let pathListeners = [];
  let drawing = true;
  let settled = '';

  const projector = new google.maps.OverlayView();
  projector.onAdd = () => {};
  projector.draw = () => {};
  projector.onRemove = () => {};
  projector.setMap(map);

  const polyline = new google.maps.Polyline({
    map,
    path: [],
    strokeColor: '#1e3a2f',
    strokeWeight: 2.5,
    clickable: false,
  });
  const preview = new google.maps.Polyline({
    strokeColor: '#1e3a2f',
    strokeOpacity: 0.45,
    strokeWeight: 2,
    clickable: false,
  });

  map.addListener('click', (event) => {
    if (!drawing || !event.latLng) return;
    const next = { lat: event.latLng.lat(), lng: event.latLng.lng() };

    if (vertices.length >= 3 && pixelDistance(projector, event.latLng, vertices[0]) <= 18) {
      closeShape();
      return;
    }
    if (vertices.length > 0 && pixelDistance(projector, event.latLng, vertices[vertices.length - 1]) <= 4) {
      return;
    }
    addVertex(next);
  });

  map.addListener('mousemove', (event) => {
    if (!drawing || vertices.length === 0 || !event.latLng) {
      preview.setMap(null);
      return;
    }
    preview.setPath([vertices[vertices.length - 1], event.latLng]);
    preview.setMap(map);
  });

  setDrawingMode(true);
  emit();

  return {
    undo,
    clear,
    closeShape,
    readVertices,
    locate,
    loadOutline,
    frameOutline,
  };

  function addVertex(vertex) {
    vertices.push(vertex);
    markers.push(new google.maps.Marker({
      map,
      position: vertex,
      clickable: false,
      icon: vertexIcon(markers.length === 0),
    }));
    refreshFirstMarker();
    polyline.setPath(vertices);
    emit();
  }

  function undo() {
    if (!drawing || vertices.length === 0) return;
    vertices.pop();
    markers.pop().setMap(null);
    refreshFirstMarker();
    polyline.setPath(vertices);
    if (vertices.length === 0) preview.setMap(null);
    emit();
  }

  function closeShape() {
    if (!drawing || vertices.length < 3) return;
    finishOutline(true);
  }

  function loadOutline(nextVertices) {
    vertices = nextVertices.map((vertex) => ({ lat: vertex.lat, lng: vertex.lng }));
    finishOutline(false);
  }

  function frameOutline() {
    if (!polygon || map.getDiv().clientWidth < 10) return;
    google.maps.event.trigger(map, 'resize');
    const bounds = new google.maps.LatLngBounds();
    readVertices().forEach((vertex) => bounds.extend(vertex));
    map.fitBounds(bounds, 72);
  }

  function finishOutline(notify) {
    if (vertices.length < 3) return;
    drawing = false;
    preview.setMap(null);
    clearMarkers();
    polyline.setPath([]);
    removePolygon();
    polygon = new google.maps.Polygon({
      map,
      paths: vertices.map((vertex) => ({ ...vertex })),
      strokeColor: '#1e3a2f',
      strokeWeight: 2.5,
      fillColor: '#2f6f4e',
      fillOpacity: 0.2,
      editable: true,
      draggable: false,
    });
    settled = JSON.stringify(vertices);
    watchPath(polygon.getPath());
    setDrawingMode(false);
    emit();
    if (notify) handlers.onClosed(readVertices());
  }

  function clear() {
    drawing = false;
    vertices = [];
    clearMarkers();
    polyline.setPath([]);
    preview.setMap(null);
    removePolygon();
    settled = '';
    drawing = true;
    setDrawingMode(true);
    emit();
  }

  function readVertices() {
    if (polygon) vertices = pathToVertices(polygon.getPath());
    return vertices.map((vertex) => ({ lat: vertex.lat, lng: vertex.lng }));
  }

  function locate() {
    if (!navigator.geolocation) {
      handlers.onNotice('Location is not available in this browser.');
      return;
    }
    handlers.onNotice('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        map.panTo({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        if (map.getZoom() < 17) map.setZoom(18);
        handlers.onNotice('');
      },
      () => {
        handlers.onNotice('Location permission was denied. Pan the map to the plot instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function watchPath(path) {
    const update = () => {
      vertices = pathToVertices(path);
      emit();
      if (JSON.stringify(vertices) !== settled) handlers.onEdit();
    };
    pathListeners = ['set_at', 'insert_at', 'remove_at'].map((name) =>
      google.maps.event.addListener(path, name, update),
    );
  }

  function removePolygon() {
    pathListeners.forEach((listener) => google.maps.event.removeListener(listener));
    pathListeners = [];
    if (polygon) {
      polygon.setMap(null);
      polygon = null;
    }
  }

  function clearMarkers() {
    markers.forEach((marker) => marker.setMap(null));
    markers = [];
  }

  function refreshFirstMarker() {
    if (markers[0]) markers[0].setIcon(vertexIcon(true));
  }

  function vertexIcon(first) {
    return {
      path: google.maps.SymbolPath.CIRCLE,
      scale: first ? 7 : 5,
      fillColor: first ? '#2f6f4e' : '#17261f',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: first ? 2 : 1.5,
    };
  }

  function setDrawingMode(on) {
    drawing = on;
    map.setOptions({
      disableDoubleClickZoom: on,
      draggableCursor: on ? 'crosshair' : null,
    });
  }

  function emit() {
    handlers.onChange({
      drawing,
      closed: Boolean(polygon),
      count: polygon ? polygon.getPath().getLength() : vertices.length,
    });
  }
}

function pathToVertices(path) {
  const vertices = [];
  for (let index = 0; index < path.getLength(); index += 1) {
    const point = path.getAt(index);
    vertices.push({ lat: point.lat(), lng: point.lng() });
  }
  return vertices;
}

function pixelDistance(projector, a, b) {
  const projection = projector.getProjection();
  if (!projection) return Infinity;
  const first = projection.fromLatLngToContainerPixel(a);
  const second = projection.fromLatLngToContainerPixel(b);
  if (!first || !second) return Infinity;
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function withTimeout(promise, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), 20000);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
