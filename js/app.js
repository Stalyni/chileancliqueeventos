import * as THREE from 'three';

const RED = 0xe92323;
const RED_STRONG = 0xff302b;

// v30: rendimiento adaptativo real.
// Mantiene calidad alta en PC/equipos potentes, y simplifica efectos solo en gama baja
// para que el scroll y los toques no deformen ni ralenticen la experiencia.
const DEVICE_MEMORY = navigator.deviceMemory || 4;
const CPU_CORES = navigator.hardwareConcurrency || 4;
const SAVE_DATA = !!navigator.connection?.saveData;
const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
const COARSE_POINTER = window.matchMedia?.('(pointer: coarse)')?.matches || false;
const VIEWPORT_MIN = Math.min(window.innerWidth, window.innerHeight);
const VIEWPORT_MAX = Math.max(window.innerWidth, window.innerHeight);

function detectPerformanceTier(){
  if (SAVE_DATA || REDUCED_MOTION || DEVICE_MEMORY <= 2 || CPU_CORES <= 2) return 'low';
  if ((COARSE_POINTER && DEVICE_MEMORY <= 4) || CPU_CORES <= 4 || VIEWPORT_MIN <= 430) return 'medium';
  if (DEVICE_MEMORY >= 8 && CPU_CORES >= 8 && VIEWPORT_MAX >= 900) return 'high';
  return 'medium';
}

const PERF_TIER = detectPerformanceTier();
const LOW_POWER = PERF_TIER === 'low';
const MID_POWER = PERF_TIER === 'medium';
const HIGH_POWER = PERF_TIER === 'high';
document.documentElement.dataset.performance = PERF_TIER;
document.documentElement.classList.toggle('perf-lite', LOW_POWER);
document.documentElement.classList.toggle('perf-medium', MID_POWER);
document.documentElement.classList.toggle('perf-high', HIGH_POWER);

const canvas = document.getElementById('planetCanvas');
const trigger = document.getElementById('planetTrigger');
const intro = document.getElementById('intro');
const mapScene = document.getElementById('mapScene');
const eventPanel = document.getElementById('eventPanel');
const countdown = document.getElementById('countdown');
const countdownGrid = document.getElementById('countdownGrid');
const chileSvgMount = document.getElementById('chileSvgMount');
const soundToggle = document.getElementById('soundToggle');
const panelStatus = document.getElementById('panelStatus');
const eventCity = document.getElementById('eventCity');

let isTransitioning = false;
let mapOpened = false;
let transitionStart = 0;
let autoTimer = null;
let activeCountdown = false;
let panelPinned = false;
let activeRegion = null;
let panelTimer = null;
let transitionState = null;
const CHILE_LAT = -33.45;
const CHILE_LON = -70.66;
// Three.js SphereGeometry pone el meridiano visible en U=.25.
// Fórmula: rotación Y destino = -(longitud + 90°).
// Así Chile queda realmente al frente antes del descenso.
const CHILE_TARGET_ROTATION_Y = THREE.MathUtils.degToRad(-(CHILE_LON + 90));
const CHILE_TARGET_ROTATION_X = THREE.MathUtils.degToRad(CHILE_LAT);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: HIGH_POWER,
  alpha: true,
  powerPreference: HIGH_POWER ? 'high-performance' : 'low-power'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, HIGH_POWER ? 1.35 : MID_POWER ? 1.1 : 1));
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 3.25);

const globeGroup = new THREE.Group();
scene.add(globeGroup);

const loader = new THREE.TextureLoader();
const worldTexture = loader.load('assets/textures/world-map-red.png');
worldTexture.colorSpace = THREE.SRGBColorSpace;
worldTexture.anisotropy = HIGH_POWER ? 4 : 1;
worldTexture.wrapS = THREE.RepeatWrapping;
worldTexture.wrapT = THREE.ClampToEdgeWrapping;

const SPHERE_SEGMENTS = HIGH_POWER ? 96 : MID_POWER ? 64 : 42;
const CLOUD_SEGMENTS = HIGH_POWER ? 72 : MID_POWER ? 52 : 32;
const earthGeo = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
const earthMat = new THREE.MeshStandardMaterial({
  color: 0x180303,
  map: worldTexture,
  roughness: 0.82,
  metalness: 0.04,
  emissive: 0x220000,
  emissiveMap: worldTexture,
  emissiveIntensity: 1.35
});
const earth = new THREE.Mesh(earthGeo, earthMat);
earth.rotation.y = -1.72;
earth.rotation.x = -0.08;
globeGroup.add(earth);

// Marcador interno desactivado visualmente: Chile se usa como destino de cámara, no como objeto visible sobre el planeta.
const chileMarker = new THREE.Group();
function latLonToVector3(latDeg, lonDeg, radius = 1.018){
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon) * radius,
    Math.sin(lat) * radius,
    Math.cos(lat) * Math.cos(lon) * radius
  );
}
function createChileMarker(){
  const g = new THREE.Group();
  g.position.copy(latLonToVector3(CHILE_LAT, CHILE_LON));
  g.lookAt(new THREE.Vector3(0,0,0));
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, LOW_POWER ? 12 : 24),
    new THREE.MeshBasicMaterial({ color: RED_STRONG, transparent:true, opacity:.96, blending:THREE.AdditiveBlending })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.032, 0.052, LOW_POWER ? 24 : 48),
    new THREE.MeshBasicMaterial({ color: RED_STRONG, transparent:true, opacity:.7, side:THREE.DoubleSide, blending:THREE.AdditiveBlending })
  );
  ring.rotation.x = Math.PI / 2;
  g.add(dot, ring);
  return g;
}

const cloudTexture = createCloudTexture();
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.012, CLOUD_SEGMENTS, CLOUD_SEGMENTS),
  new THREE.MeshBasicMaterial({ map: cloudTexture, transparent: true, opacity: HIGH_POWER ? 0.16 : MID_POWER ? 0.11 : 0.07, depthWrite: false, blending: THREE.AdditiveBlending })
);
globeGroup.add(clouds);

const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.04, SPHERE_SEGMENTS, SPHERE_SEGMENTS),
  new THREE.MeshBasicMaterial({ color: RED_STRONG, transparent: true, opacity: HIGH_POWER ? 0.13 : MID_POWER ? 0.09 : 0.06, side: THREE.BackSide, blending: THREE.AdditiveBlending })
);
globeGroup.add(atmosphere);

const rim = new THREE.Mesh(
  new THREE.SphereGeometry(1.025, SPHERE_SEGMENTS, SPHERE_SEGMENTS),
  new THREE.MeshBasicMaterial({ color: RED_STRONG, transparent: true, opacity: HIGH_POWER ? 0.055 : MID_POWER ? 0.035 : 0.02, wireframe: false, blending: THREE.AdditiveBlending })
);
globeGroup.add(rim);

const stars = createStars();
scene.add(stars);

const keyLight = new THREE.PointLight(RED_STRONG, HIGH_POWER ? 38 : MID_POWER ? 28 : 18, 9);
keyLight.position.set(2.5, 1.1, 2.5);
scene.add(keyLight);
const fillLight = new THREE.AmbientLight(0x3a0505, HIGH_POWER ? 2.2 : MID_POWER ? 1.8 : 1.45);
scene.add(fillLight);

function createCloudTexture(){
  const c = document.createElement('canvas'); c.width = HIGH_POWER ? 1024 : 512; c.height = HIGH_POWER ? 512 : 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0,0,c.width,c.height);
  for(let i=0;i<(HIGH_POWER ? 100 : MID_POWER ? 56 : 30);i++){
    const x=Math.random()*c.width, y=Math.random()*c.height, rx=40+Math.random()*130, ry=8+Math.random()*22;
    const g=ctx.createRadialGradient(x,y,0,x,y,rx);
    g.addColorStop(0,'rgba(255,210,210,.22)'); g.addColorStop(1,'rgba(255,210,210,0)');
    ctx.fillStyle=g; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,Math.random()*Math.PI,0,Math.PI*2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function createStars(){
  const count = HIGH_POWER ? 620 : MID_POWER ? 360 : 180;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for(let i=0;i<count;i++){
    pos[i*3] = (Math.random()-.5)*12;
    pos[i*3+1] = (Math.random()-.5)*7;
    pos[i*3+2] = -2 - Math.random()*6;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const mat = new THREE.PointsMaterial({ color: RED_STRONG, size: .012, transparent:true, opacity:.7, blending:THREE.AdditiveBlending });
  return new THREE.Points(geo, mat);
}

function resize(){
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width); const h = Math.max(1, rect.height);
  renderer.setSize(w,h,false); camera.aspect = w/h; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize, { passive:true });
resize();

function easeInOutCubic(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }
function lerp(a,b,t){ return a + (b-a)*t; }
function normalizeAngle(a){ return Math.atan2(Math.sin(a), Math.cos(a)); }
function closestEquivalentAngle(from, target){
  const delta = normalizeAngle(target - from);
  return from + delta;
}
function lerpAngle(a,b,t){ return a + (b-a)*t; }

function animate(time){
  if(mapOpened && !isTransitioning) return;
  requestAnimationFrame(animate);
  const t = time * 0.001;

  if(!isTransitioning && !mapOpened){
    earth.rotation.y += 0.0017;
    clouds.rotation.y += 0.0028;
    if(!LOW_POWER) stars.rotation.z += 0.00005;
  }

  if(isTransitioning && transitionState){
    const duration = 6400;
    const p = Math.min(1, (performance.now() - transitionStart) / duration);

    // 1) primero gira el globo hasta dejar Chile al frente; 2) recién después desciende/zoom.
    const turnP = Math.min(1, p / 0.42);
    const zoomP = Math.max(0, (p - 0.42) / 0.58);
    const turnEase = easeInOutCubic(turnP);
    const zoomEase = easeInOutCubic(zoomP);

    earth.rotation.y = lerpAngle(transitionState.earthY, transitionState.targetEarthY, turnEase);
    earth.rotation.x = lerp(transitionState.earthX, CHILE_TARGET_ROTATION_X, turnEase);
    clouds.rotation.y = lerpAngle(transitionState.cloudY, transitionState.targetCloudY, turnEase) + Math.sin(p * Math.PI) * 0.02;

    camera.position.z = lerp(transitionState.cameraZ, 0.78, zoomEase);
    camera.position.x = lerp(transitionState.cameraX, 0.00, zoomEase);
    camera.position.y = lerp(transitionState.cameraY, 0.00, zoomEase);
    globeGroup.scale.setScalar(lerp(transitionState.scale, 2.58, zoomEase));
    globeGroup.position.x = lerp(transitionState.groupX, 0.00, zoomEase);
    globeGroup.position.y = lerp(transitionState.groupY, 0.00, zoomEase);

    if(p > 0.80){
      mapScene.classList.add('is-visible');
  requestAnimationFrame(() => { resizeSky(true); setTimeout(() => resizeSky(true), 250); });
    }
    if(p > 0.90){
      intro.classList.add('is-leaving');
    }
    if(p >= 1){
      isTransitioning = false;
      mapOpened = true;
      intro.style.display = 'none';
      mapScene.classList.add('map-ready');
      document.body.classList.add('map-active');
      playSound('whoosh');
    }
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);

autoTimer = setTimeout(startZoomToChile, 20000);
trigger.addEventListener('click', startZoomToChile);
trigger.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' ') startZoomToChile(); });

function startZoomToChile(){
  if(isTransitioning || mapOpened) return;
  clearTimeout(autoTimer);

  const currentEarthY = earth.rotation.y;
  const targetEarthY = closestEquivalentAngle(currentEarthY, CHILE_TARGET_ROTATION_Y);
  const currentCloudY = clouds.rotation.y;
  const targetCloudY = closestEquivalentAngle(currentCloudY, CHILE_TARGET_ROTATION_Y + 0.08);

  transitionState = {
    earthY: currentEarthY,
    earthX: earth.rotation.x,
    cloudY: currentCloudY,
    targetEarthY,
    targetCloudY,
    cameraX: camera.position.x,
    cameraY: camera.position.y,
    cameraZ: camera.position.z,
    scale: globeGroup.scale.x,
    groupX: globeGroup.position.x,
    groupY: globeGroup.position.y
  };

  isTransitioning = true;
  transitionStart = performance.now();
}

async function loadChileSvg(){
  const res = await fetch('assets/svg/chile_clancy_ciudades.svg');
  const svgText = await res.text();
  chileSvgMount.innerHTML = svgText;
  const svg = chileSvgMount.querySelector('svg');
  if(svg){
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    if(!svg.getAttribute('viewBox') && w && h){
      svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    }
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  }
  const paths = [...chileSvgMount.querySelectorAll('path')];
  paths.forEach(p => {
    p.removeAttribute('style');
    p.setAttribute('tabindex','-1');
    p.setAttribute('aria-label', p.getAttribute('title') || p.id || 'Región de Chile');
  });
  const santiago = paths.find(p => ['CL-RM','RM','santiago','metropolitana'].some(id => (p.id || '').toLowerCase().includes(id.toLowerCase())) ) || paths.find(p => (p.getAttribute('title') || '').toLowerCase().includes('metropolitana'));
  if(santiago){
    santiago.dataset.event = 'true';
    santiago.id = santiago.id || 'CL-RM';
    santiago.setAttribute('tabindex','0');
    santiago.addEventListener('mouseenter', openEvent);
    santiago.addEventListener('mouseleave', closeEvent);
    santiago.addEventListener('click', toggleEvent);
    santiago.addEventListener('focus', openEvent);
    santiago.addEventListener('blur', closeEvent);
  }
}
loadChileSvg();

function openEvent(e){
  activeRegion = e.currentTarget;
  activeRegion.classList.add('is-active');
  eventPanel.classList.add('is-open');
  countdown.hidden = false;
  activeCountdown = true;
  updateCountdown();

  // v24: no redimensionar el cielo al abrir panel; evita parpadeos y cambios de escala.
}
function closeEvent(e){
  if(panelPinned) return;
  const region = e?.currentTarget || activeRegion;
  if(region) region.classList.remove('is-active');
  eventPanel.classList.remove('is-open');
  countdown.hidden = true;
  activeCountdown = false;
  // v24: no redimensionar el cielo al cerrar panel.
}
function hidePinnedEvent(){
  panelPinned = false;
  if(activeRegion) activeRegion.classList.remove('is-active');
  eventPanel.classList.remove('is-open');
  countdown.hidden = true;
  activeCountdown = false;
}
function toggleEvent(e){
  const region = e.currentTarget;

  // Si la ciudad ya estaba marcada por click, el segundo click la desmarca al tiro.
  if (panelPinned && activeRegion === region && eventPanel.classList.contains('is-open')) {
    clearTimeout(panelTimer);
    hidePinnedEvent();
    playSound('tick');
    return;
  }

  openEvent(e);
  playSound('tick');
  panelPinned = true;
  clearTimeout(panelTimer);

  // En móviles y ventanas pequeñas queda visible 40 segundos y luego se desvanece.
  panelTimer = setTimeout(hidePinnedEvent, 40000);
}

const targetDate = new Date('2026-08-22T15:00:00-04:00');
function updateCountdown(){
  if(!activeCountdown) return;
  const diff = Math.max(0, targetDate.getTime() - Date.now());
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if(diff === 0){
    mapScene.classList.add('is-now-playing');
    if(panelStatus) panelStatus.textContent = 'EVENTO EN CURSO';
    if(eventCity) eventCity.textContent = 'NOW PLAYING';
  }else{
    mapScene.classList.remove('is-now-playing');
    if(panelStatus) panelStatus.textContent = 'CIUDAD CON EVENTO';
    if(eventCity) eventCity.textContent = 'SANTIAGO';
  }
  const units = days >= 1
    ? [['DÍA', days], ['HORAS', hours], ['MINUTOS', minutes], ['SEGUNDOS', seconds]]
    : [['HORAS', hours], ['MINUTOS', minutes], ['SEGUNDOS', seconds]];
  countdownGrid.innerHTML = units.map(([label, value]) => `<div class="time-box"><strong>${String(value).padStart(2,'0')}</strong><span>${label}</span></div>`).join('');
}
setInterval(updateCountdown, 1000);


// ------------------------------------------------------------
// Cielo Chilean Clique: estrellas estáticas con parpadeo,
// constelaciones que se dibujan lento, se desvanecen y vuelven a nacer.
// ------------------------------------------------------------
const skyCanvas = document.getElementById('skyCanvas');
const skyCtx = skyCanvas?.getContext('2d');
let skyStars = [];
let shootingStars = [];
let skyStartTime = null;
let lastShootingStar = 0;
let lastSkyDraw = 0;
let skySize = { w: Math.max(1, window.innerWidth || 1), h: Math.max(1, window.innerHeight || 1), dpr: 1 };
let scrollFreezeUntil = 0;
let skyResizeRaf = null;
const SKY_FPS = HIGH_POWER ? 30 : MID_POWER ? 24 : 18;
const SKY_STAR_COUNT = HIGH_POWER ? 760 : MID_POWER ? 480 : 260;
const constellationDrawDuration = 30000;
const constellationHoldDuration = 4500;
const constellationFadeDuration = 6500;
const constellationCycleDuration = constellationDrawDuration + constellationHoldDuration + constellationFadeDuration;

const constellations = [
  {
    name:'ORION',
    points:[[0.16,0.22],[0.21,0.30],[0.27,0.27],[0.31,0.37],[0.25,0.43],[0.19,0.39],[0.21,0.30],[0.25,0.34],[0.28,0.37]],
    lines:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,1],[1,6],[6,7],[7,8]]
  },
  {
    name:'CAN MAYOR',
    points:[[0.14,0.58],[0.20,0.54],[0.27,0.57],[0.31,0.64],[0.23,0.70],[0.16,0.66]],
    lines:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[1,4]]
  },
  {
    name:'CRUZ DEL SUR',
    points:[[0.70,0.25],[0.73,0.33],[0.76,0.41],[0.66,0.36],[0.80,0.32]],
    lines:[[0,1],[1,2],[3,1],[1,4]]
  },
  {
    name:'CARINA',
    points:[[0.58,0.58],[0.64,0.52],[0.72,0.55],[0.78,0.63],[0.70,0.70],[0.61,0.67]],
    lines:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[1,5]]
  },
  {
    name:'VELA',
    points:[[0.76,0.18],[0.84,0.22],[0.90,0.30],[0.86,0.40],[0.78,0.36]],
    lines:[[0,1],[1,2],[2,3],[3,4],[4,0]]
  },
  {
    name:'ERIDANUS',
    points:[[0.36,0.16],[0.42,0.24],[0.39,0.33],[0.45,0.41],[0.43,0.51],[0.49,0.62],[0.47,0.75]],
    lines:[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]]
  }
];

function initSky(){
  if(!skyCanvas || !skyCtx) return;
  resizeSky(true);
  // Estrellas distribuidas en toda la pantalla.
  // Se evita solo el último borde inferior para que no aparezca el efecto tipo "pincel".
  skyStars = Array.from({length: SKY_STAR_COUNT}, () => ({
    // Distribución full-screen real: cubre también bordes y esquina inferior derecha.
    x: Math.random(),
    y: Math.random(),
    r: Math.random() < .055 ? 1.28 : .32 + Math.random() * .82,
    phase: Math.random() * Math.PI * 2,
    speed: .34 + Math.random() * 1.05,
    alpha: .12 + Math.random() * .46,
    hot: Math.random() < .10
  }));
  requestAnimationFrame(drawSky);
}

function getSkySize(){
  return skySize;
}

function resizeSky(force = false){
  if(!skyCanvas || !skyCtx) return;
  const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

  // En móviles, al hacer scroll el navegador cambia levemente la altura visible por la barra superior.
  // Si redimensionamos el canvas en cada microcambio, el cielo se deforma y el scroll se vuelve lento.
  // Por eso se ignoran cambios pequeños de altura mientras la escena de Chile está activa.
  const widthChanged = Math.abs(vw - skySize.w) > 2;
  const heightChanged = Math.abs(vh - skySize.h) > (document.body.classList.contains('map-active') ? 110 : 2);
  if(!force && !widthChanged && !heightChanged) return;

  const dpr = Math.min(window.devicePixelRatio || 1, HIGH_POWER ? 1.5 : MID_POWER ? 1.2 : 1);
  skySize = { w: vw, h: vh, dpr };
  skyCanvas.style.width = `${vw}px`;
  skyCanvas.style.height = `${vh}px`;
  skyCanvas.width = Math.floor(vw * dpr);
  skyCanvas.height = Math.floor(vh * dpr);
  skyCtx.setTransform(dpr,0,0,dpr,0,0);
}
function scheduleSkyResize(force = false){
  if(skyResizeRaf) cancelAnimationFrame(skyResizeRaf);
  skyResizeRaf = requestAnimationFrame(() => { resizeSky(force); skyResizeRaf = null; });
}
window.addEventListener('resize', () => scheduleSkyResize(false), { passive:true });
window.addEventListener('orientationchange', () => setTimeout(() => resizeSky(true), 220), { passive:true });
window.addEventListener('scroll', () => { scrollFreezeUntil = performance.now() + 180; }, { passive:true });

function drawSky(now){
  requestAnimationFrame(drawSky);
  if(!skyCanvas || !skyCtx) return;
  if(now - lastSkyDraw < 1000 / SKY_FPS) return;
  lastSkyDraw = now;
  const size = getSkySize();
  const w = size.w;
  const h = size.h;
  skyCtx.clearRect(0,0,w,h);

  if(!mapScene.classList.contains('is-visible')){
    skyStartTime = null;
    shootingStars = [];
    return;
  }
  if(LOW_POWER && performance.now() < scrollFreezeUntil){
    return;
  }
  if(!skyStartTime) skyStartTime = now;
  const elapsed = now - skyStartTime;
  const cycleElapsed = elapsed % constellationCycleDuration;

  let drawProgress = 0;
  let constellationOpacity = 1;
  if(cycleElapsed <= constellationDrawDuration){
    drawProgress = cycleElapsed / constellationDrawDuration;
    constellationOpacity = 1;
  }else if(cycleElapsed <= constellationDrawDuration + constellationHoldDuration){
    drawProgress = 1;
    constellationOpacity = 1;
  }else{
    drawProgress = 1;
    const fadeElapsed = cycleElapsed - constellationDrawDuration - constellationHoldDuration;
    constellationOpacity = 1 - Math.min(1, fadeElapsed / constellationFadeDuration);
  }

  const bg = skyCtx.createRadialGradient(w*.55,h*.45,0,w*.55,h*.45,Math.max(w,h)*.66);
  bg.addColorStop(0,'rgba(233,35,35,.12)');
  bg.addColorStop(.42,'rgba(70,5,5,.08)');
  bg.addColorStop(1,'rgba(0,0,0,0)');
  skyCtx.fillStyle = bg;
  skyCtx.fillRect(0,0,w,h);

  drawStaticNebula(w,h);

  // Estrellas fijas: no se desplazan; solo parpadean suave.
  for(const s of skyStars){
    const twinkle = (Math.sin(elapsed * 0.001 * s.speed + s.phase) + 1) / 2;
    const a = s.alpha * (.32 + twinkle * .78);
    const radius = s.r * (.86 + twinkle * .30);
    skyCtx.beginPath();
    skyCtx.fillStyle = s.hot ? `rgba(255,70,54,${a})` : `rgba(255,160,150,${a*.80})`;
    skyCtx.shadowColor = 'rgba(255,48,43,.55)';
    skyCtx.shadowBlur = s.hot ? 10 : 4;
    skyCtx.arc(s.x*w, s.y*h, radius, 0, Math.PI*2);
    skyCtx.fill();
  }
  skyCtx.shadowBlur = 0;

  drawConstellations(w,h,drawProgress,elapsed,constellationOpacity);
  updateShootingStars(elapsed,w,h);
}

function drawStaticNebula(w,h){
  const g1 = skyCtx.createRadialGradient(w*.18,h*.30,0,w*.18,h*.30,Math.max(w,h)*.38);
  g1.addColorStop(0,'rgba(255,48,43,.045)');
  g1.addColorStop(.55,'rgba(130,8,8,.020)');
  g1.addColorStop(1,'rgba(0,0,0,0)');
  skyCtx.fillStyle = g1;
  skyCtx.fillRect(0,0,w,h);

  const g2 = skyCtx.createRadialGradient(w*.82,h*.62,0,w*.82,h*.62,Math.max(w,h)*.42);
  g2.addColorStop(0,'rgba(255,80,64,.038)');
  g2.addColorStop(.6,'rgba(100,4,4,.016)');
  g2.addColorStop(1,'rgba(0,0,0,0)');
  skyCtx.fillStyle = g2;
  skyCtx.fillRect(0,0,w,h);
}

function drawConstellations(w,h,progress,elapsed,lineOpacity){
  const allLines = constellations.reduce((n,c)=>n+c.lines.length,0);
  let lineIndex = 0;

  // 1) Solo las líneas de constelación se crean, permanecen y se desvanecen.
  for(const c of constellations){
    for(const [a,b] of c.lines){
      const local = Math.min(1, Math.max(0, progress * allLines - lineIndex));
      if(local > 0 && lineOpacity > 0.01){
        const p1 = c.points[a];
        const p2 = c.points[b];
        const x1 = p1[0]*w, y1 = p1[1]*h;
        const x2 = p2[0]*w, y2 = p2[1]*h;
        skyCtx.beginPath();
        skyCtx.moveTo(x1,y1);
        skyCtx.lineTo(x1 + (x2-x1)*local, y1 + (y2-y1)*local);
        skyCtx.strokeStyle = `rgba(255,48,43,${(0.08 + 0.24*local) * lineOpacity})`;
        skyCtx.lineWidth = 1;
        skyCtx.shadowColor = `rgba(255,48,43,${.42 * lineOpacity})`;
        skyCtx.shadowBlur = 5;
        skyCtx.stroke();
      }
      lineIndex++;
    }
  }

  // 2) Las estrellas de las constelaciones NO se desvanecen: siguen parpadeando suave y fijo.
  for(const c of constellations){
    for(let i=0;i<c.points.length;i++){
      const [x,y] = c.points[i];
      const pulse = (Math.sin(elapsed * 0.0011 + i * 1.7 + c.name.length) + 1) / 2;
      skyCtx.beginPath();
      skyCtx.fillStyle = `rgba(255,84,68,${.34 + pulse*.34})`;
      skyCtx.shadowColor = `rgba(255,48,43,${.48 + pulse*.20})`;
      skyCtx.shadowBlur = 5 + pulse*4;
      skyCtx.arc(x*w, y*h, 1.05 + pulse*.45,0,Math.PI*2);
      skyCtx.fill();
    }
  }
  skyCtx.shadowBlur = 0;
}

function updateShootingStars(elapsed,w,h){
  // Estrellas fugaces ocasionales, solo en la zona alta/media para que no ensucien el borde inferior.
  if(HIGH_POWER && elapsed - lastShootingStar > 14000 + Math.random()*12000){
    lastShootingStar = elapsed;
    playSound('shoot');
    shootingStars.push({
      x: (.30 + Math.random()*.58) * w,
      y: (.06 + Math.random()*.30) * h,
      vx: -3.2 - Math.random()*2.2,
      vy: 1.35 + Math.random()*1.1,
      life: 0,
      max: 38 + Math.random()*24
    });
  }
  shootingStars = shootingStars.filter(st => st.life < st.max);
  for(const st of shootingStars){
    st.life++;
    const a = 1 - st.life / st.max;
    const x2 = st.x + st.vx * st.life;
    const y2 = st.y + st.vy * st.life;
    if(y2 > h * .78) continue;
    skyCtx.beginPath();
    skyCtx.moveTo(x2,y2);
    skyCtx.lineTo(x2 - st.vx*6.2, y2 - st.vy*6.2);
    skyCtx.strokeStyle = `rgba(255,70,54,${a*.50})`;
    skyCtx.lineWidth = 1.1;
    skyCtx.shadowColor = 'rgba(255,48,43,.65)';
    skyCtx.shadowBlur = 8;
    skyCtx.stroke();
  }
  skyCtx.shadowBlur = 0;
}


// ------------------------------------------------------------
// Sonido opcional: se crea con WebAudio, sin archivos externos.
// ------------------------------------------------------------
let audioCtx = null;
let soundEnabled = false;
function getAudioCtx(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function setSoundEnabled(value){
  soundEnabled = value;
  soundToggle?.classList.toggle('is-on', soundEnabled);
  soundToggle?.setAttribute('aria-pressed', String(soundEnabled));
  if(soundToggle) soundToggle.textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
  if(soundEnabled) getAudioCtx();
}
soundToggle?.addEventListener('click', () => setSoundEnabled(!soundEnabled));

function playSound(type){
  if(!soundEnabled) return;
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, now);

  if(type === 'whoosh'){
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.9, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * (1-i/data.length);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(460, now);
    filter.frequency.exponentialRampToValueAtTime(1600, now + .75);
    src.connect(filter); filter.connect(gain);
    gain.gain.exponentialRampToValueAtTime(0.045, now + .08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + .9);
    src.start(now); src.stop(now + .92);
  }else{
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(type === 'shoot' ? 880 : 540, now);
    osc.frequency.exponentialRampToValueAtTime(type === 'shoot' ? 260 : 780, now + (type === 'shoot' ? .45 : .08));
    osc.connect(gain);
    gain.gain.exponentialRampToValueAtTime(type === 'shoot' ? 0.032 : 0.026, now + .015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (type === 'shoot' ? .5 : .12));
    osc.start(now); osc.stop(now + (type === 'shoot' ? .52 : .14));
  }
}


initSky();

// v26: cerrar panel al presionar fuera de Santiago/panel, en cualquier tamaño de pantalla.
document.addEventListener('pointerdown', (event) => {
  if (!eventPanel || !eventPanel.classList.contains('is-open')) return;

  const target = event.target;
  const clickedPanel = eventPanel.contains(target);
  const clickedEventCity = target?.closest?.('path[data-event="true"]');

  if (!clickedPanel && !clickedEventCity) {
    clearTimeout(panelTimer);
    hidePinnedEvent();
  }
}, { passive: true });
