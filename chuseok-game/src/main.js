import * as THREE from 'three';
import { STAGES } from './stages.js';

const STAGE_LEN = 20;
const HALF_W = 4.6;
const gateZ = (i) => -STAGE_LEN * (i + 1);
const lanternZ = (i) => -STAGE_LEN * i - 11;
const END_Z = gateZ(STAGES.length) - 24;

const $ = (id) => document.getElementById(id);

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121831);
scene.fog = new THREE.Fog(0x121831, 18, 70);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

scene.add(new THREE.HemisphereLight(0x8fa3e0, 0x2a2238, 0.9));
const moonLight = new THREE.DirectionalLight(0xf4e7b8, 1.1);
moonLight.position.set(-8, 20, 6);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(1024, 1024);
Object.assign(moonLight.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
scene.add(moonLight, moonLight.target);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const M = {
  ground: mat(0x5b5140),
  path: mat(0x8a7c64),
  wall: mat(0xd8cdb4),
  stone: mat(0x6c6660),
  roof: mat(0x2c2f3a, { roughness: 0.6 }),
  wood: mat(0x7a3b22),
  pine: mat(0x2f5a45),
  trunk: mat(0x4a3526),
};

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
}

// ---------- Sky: stars + moon ----------
{
  const pts = [];
  for (let i = 0; i < 700; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * Math.PI * 0.45;
    const r = 180;
    pts.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 10, r * Math.sin(ph) * Math.sin(th) - 60);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xf4e7b8, size: 0.7, fog: false })));
}
const moonMat = new THREE.MeshBasicMaterial({ color: 0x9a927a, fog: false });
const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 32), moonMat);
moon.position.set(0, 32, END_Z - 90);
scene.add(moon);
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(13, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0xf4e7b8, transparent: true, opacity: 0, fog: false }),
);
halo.position.copy(moon.position);
scene.add(halo);

// ---------- Ground, walls, trees ----------
const totalLen = -END_Z + 20;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, totalLen + 40), M.ground);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0, 0, -totalLen / 2 + 10);
ground.receiveShadow = true;
scene.add(ground);
const path = new THREE.Mesh(new THREE.PlaneGeometry(4, totalLen), M.path);
path.rotation.x = -Math.PI / 2;
path.position.set(0, 0.01, -totalLen / 2 + 10);
path.receiveShadow = true;
scene.add(path);

for (const side of [-1, 1]) {
  const x = side * (HALF_W + 0.9);
  box(0.6, 1.8, totalLen, M.wall, x, 0.9, -totalLen / 2 + 10);
  box(1.3, 0.25, totalLen, M.roof, x, 1.9, -totalLen / 2 + 10);
  for (let z = 6; z > END_Z; z -= 9) {
    const tx = side * (8 + Math.random() * 6);
    const tz = z - Math.random() * 4;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), M.trunk);
    trunk.position.set(tx, 1.5, tz);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.6, 7), M.pine);
    crown.position.set(tx, 4.2, tz);
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
  }
}

// ---------- Text labels ----------
function labelSprite(lines, width = 512) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(18,24,49,0.82)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#f4e7b8';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
  ctx.fillStyle = '#f4e7b8';
  ctx.textAlign = 'center';
  ctx.font = "28px 'Gowun Dodum', sans-serif";
  ctx.fillText(lines[0], c.width / 2, 58);
  ctx.font = "bold 44px 'Gowun Batang', serif";
  ctx.fillText(lines[1], c.width / 2, 116);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
  s.scale.set(4.2, 1.3, 1);
  return s;
}

// ---------- Stages: lantern + gate ----------
const stageObjs = STAGES.map((st, i) => {
  // stone pedestal + floating lantern orb
  const lz = lanternZ(i);
  const lx = i % 2 === 0 ? 2.2 : -2.2;
  box(0.9, 1, 0.9, M.stone, lx, 0.5, lz);
  const orbMat = new THREE.MeshStandardMaterial({ color: st.color, emissive: st.color, emissiveIntensity: 1.4 });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 24), orbMat);
  orb.position.set(lx, 1.8, lz);
  scene.add(orb);
  const light = new THREE.PointLight(st.color, 12, 9, 1.6);
  light.position.set(lx, 2, lz);
  scene.add(light);

  const label = labelSprite([`${i + 1}번째 관문`, st.title]);
  label.position.set(lx, 3.1, lz);
  scene.add(label);

  // gate: posts, roof, two swinging door panels
  const gz = gateZ(i);
  box(0.5, 4, 0.5, M.wood, -2.6, 2, gz);
  box(0.5, 4, 0.5, M.wood, 2.6, 2, gz);
  box(6.4, 0.4, 1.4, M.roof, 0, 4.2, gz);
  box(2.6, 1.8, 0.4, M.wall, -3.9, 0.9, gz);
  box(2.6, 1.8, 0.4, M.wall, 3.9, 0.9, gz);
  const doors = [-1, 1].map((side) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * 2.35, 0, gz);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.3, 3.6, 0.18), M.wood);
    panel.position.set(-side * 1.15, 1.8, 0);
    panel.castShadow = true;
    const knob = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 16), mat(0xd9b54a, { metalness: 0.7 }));
    knob.position.set(-side * 2.0, 1.7, 0.12);
    hinge.add(panel, knob);
    scene.add(hinge);
    return { hinge, side };
  });

  return { orb, orbMat, light, lx, lz, doors, open: 0 };
});

// final courtyard lanterns
for (let k = 0; k < 6; k++) {
  const x = k % 2 ? 3.4 : -3.4;
  const z = gateZ(STAGES.length) - 4 - Math.floor(k / 2) * 6;
  box(0.4, 1.2, 0.4, M.stone, x, 0.6, z);
  const l = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12),
    new THREE.MeshStandardMaterial({ color: 0xc8402c, emissive: 0xc8402c, emissiveIntensity: 1.2 }),
  );
  l.position.set(x, 1.5, z);
  scene.add(l);
}

// ---------- Player ----------
const player = new THREE.Group();
{
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 16), mat(0x2f6f8f));
  skirt.position.y = 0.55;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.5, 12), mat(0xf0d9a0));
  top.position.y = 1.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 20), mat(0xf1d2b3));
  head.position.y = 1.72;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.29, 20, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1c1a1a));
  hair.position.y = 1.74;
  hair.rotation.x = -0.25;
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.05), mat(0xc8402c));
  ribbon.position.set(0, 1.6, -0.28);
  for (const m of [skirt, top, head, hair, ribbon]) { m.castShadow = true; player.add(m); }
}
scene.add(player);

// ---------- State ----------
const state = {
  solved: [false, false, false, false, false],
  mode: 'intro', // intro | play | quiz | ending
  near: -1,
  endingShown: false,
};

function currentStage() {
  const i = state.solved.indexOf(false);
  return i === -1 ? STAGES.length : i;
}

// ---------- HUD ----------
const moonsEl = $('moons');
STAGES.forEach((s) => {
  const d = document.createElement('span');
  d.title = s.title;
  moonsEl.appendChild(d);
});
function updateHud() {
  const cur = currentStage();
  [...moonsEl.children].forEach((d, i) => d.classList.toggle('on', state.solved[i]));
  if (cur >= STAGES.length) {
    $('stage-no').textContent = '모든 관문 통과';
    $('stage-title').textContent = '보름달 마당으로';
  } else {
    $('stage-no').textContent = `${cur + 1} / ${STAGES.length} 관문`;
    $('stage-title').textContent = STAGES[cur].title;
  }
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- Quiz ----------
let quizIdx = -1;
function openQuiz(i) {
  if (state.solved[i]) { toast('이미 통과한 관문이에요. 대문으로 가세요.'); return; }
  if (i !== currentStage()) return;
  quizIdx = i;
  const st = STAGES[i];
  state.mode = 'quiz';
  keys.clear();
  $('q-stage').textContent = `${i + 1}번째 관문 · ${st.title}`;
  $('q-text').textContent = st.question;
  $('q-feedback').hidden = true;
  $('q-next').hidden = true;
  const box = $('q-opts');
  box.innerHTML = '';
  st.options.forEach((o, k) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.innerHTML = `<b>${'가나다라'[k]}</b><span></span>`;
    b.lastChild.textContent = o;
    b.addEventListener('click', () => answer(k, b));
    box.appendChild(b);
  });
  $('quiz').hidden = false;
  box.firstChild.focus();
}

function answer(k, btn) {
  const st = STAGES[quizIdx];
  const fb = $('q-feedback');
  fb.hidden = false;
  if (k === st.answer) {
    btn.classList.add('right');
    [...$('q-opts').children].forEach((b) => (b.disabled = true));
    fb.className = 'feedback good';
    fb.textContent = `정답! ${st.explain}`;
    $('q-next').hidden = false;
    $('q-next').focus();
  } else {
    btn.classList.add('wrong');
    btn.disabled = true;
    fb.className = 'feedback bad';
    fb.textContent = '아쉬워요. 어제 라이브 내용을 떠올리며 다른 답을 골라 보세요.';
  }
}

function closeQuiz() {
  $('quiz').hidden = true;
  state.mode = 'play';
  renderer.domElement.focus?.();
}

$('q-next').addEventListener('click', () => {
  state.solved[quizIdx] = true;
  const o = stageObjs[quizIdx];
  o.orbMat.color.set(0xf4e7b8);
  o.orbMat.emissive.set(0xf4e7b8);
  o.light.color.set(0xf4e7b8);
  closeQuiz();
  updateHud();
  toast(quizIdx === STAGES.length - 1 ? '마지막 대문이 열렸어요. 보름달 마당으로!' : '대문이 열렸어요. 다음 관문으로!');
});
$('q-close').addEventListener('click', closeQuiz);

// ---------- Input ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (state.mode === 'quiz' && e.key === 'Escape') { closeQuiz(); return; }
  if (state.mode !== 'play') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if ((k === 'e' || k === ' ' || k === 'enter') && state.near >= 0) { openQuiz(state.near); return; }
  keys.add(k);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// touch joystick
const stick = { x: 0, y: 0, id: null };
const stickEl = $('stick');
const knobEl = $('knob');
function stickMove(e) {
  const r = stickEl.getBoundingClientRect();
  let dx = e.clientX - (r.left + r.width / 2);
  let dy = e.clientY - (r.top + r.height / 2);
  const max = r.width / 2;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx *= max / len; dy *= max / len; }
  stick.x = dx / max;
  stick.y = dy / max;
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}
function stickEnd(e) {
  if (e.pointerId !== stick.id) return;
  stick.id = null;
  stick.x = stick.y = 0;
  knobEl.style.transform = '';
}
stickEl.addEventListener('pointerdown', (e) => {
  stick.id = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  stickMove(e);
});
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) stickMove(e); });
stickEl.addEventListener('pointerup', stickEnd);
stickEl.addEventListener('pointercancel', stickEnd);

$('act').addEventListener('click', () => {
  if (state.mode !== 'play') return;
  if (state.near >= 0) openQuiz(state.near);
  else toast('빛나는 등불 가까이 가면 퀴즈를 받을 수 있어요.');
});
$('prompt').addEventListener('click', () => { if (state.near >= 0) openQuiz(state.near); });

const markTouch = () => document.body.classList.add('is-touch');
if (window.matchMedia('(pointer: coarse)').matches) markTouch();
window.addEventListener('touchstart', markTouch, { once: true, passive: true });

// ---------- Flow ----------
function resetPlayer() {
  player.position.set(0, 0, 4);
  player.rotation.y = Math.PI;
}

$('start').addEventListener('click', () => {
  $('intro').hidden = true;
  state.mode = 'play';
  toast('빛나는 등불을 찾아가세요.');
});
$('restart').addEventListener('click', () => {
  state.solved.fill(false);
  state.endingShown = false;
  stageObjs.forEach((o, i) => {
    o.orbMat.color.set(STAGES[i].color);
    o.orbMat.emissive.set(STAGES[i].color);
    o.light.color.set(STAGES[i].color);
  });
  resetPlayer();
  updateHud();
  $('ending').hidden = true;
  state.mode = 'play';
});
$('stay').addEventListener('click', () => {
  $('ending').hidden = true;
  state.mode = 'play';
});

// ---------- Loop ----------
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const move = new THREE.Vector3();
const SPEED = 6;

resetPlayer();
updateHud();
camera.position.set(0, 6, 13);

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // movement
  move.set(0, 0, 0);
  if (state.mode === 'play') {
    if (keys.has('w') || keys.has('arrowup')) move.z -= 1;
    if (keys.has('s') || keys.has('arrowdown')) move.z += 1;
    if (keys.has('a') || keys.has('arrowleft')) move.x -= 1;
    if (keys.has('d') || keys.has('arrowright')) move.x += 1;
    move.x += stick.x;
    move.z += stick.y;
  }
  const mlen = Math.min(move.length(), 1);
  if (mlen > 0.05) {
    move.normalize().multiplyScalar(SPEED * mlen * dt);
    player.position.add(move);
    const targetRot = Math.atan2(move.x, move.z);
    let d = targetRot - player.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    player.rotation.y += d * Math.min(1, dt * 12);
    player.position.y = Math.abs(Math.sin(t * 12)) * 0.08;
  } else {
    player.position.y *= 0.8;
  }

  // collisions: side walls, closed gate, ends
  const p = player.position;
  const cur = currentStage();
  p.x = THREE.MathUtils.clamp(p.x, -HALF_W, HALF_W);
  const minZ = cur < STAGES.length ? gateZ(cur) + 0.7 : END_Z;
  p.z = THREE.MathUtils.clamp(p.z, minZ, 6);
  // gate posts/walls when passing through open gates
  for (let i = 0; i < STAGES.length; i++) {
    if (Math.abs(p.z - gateZ(i)) < 0.6 && Math.abs(p.x) > 2.1) p.x = Math.sign(p.x) * 2.1;
  }
  // pedestal
  stageObjs.forEach((o) => {
    const dx = p.x - o.lx, dz = p.z - o.lz;
    const d = Math.hypot(dx, dz);
    if (d < 0.95) { p.x = o.lx + (dx / d) * 0.95; p.z = o.lz + (dz / d) * 0.95; }
  });

  // proximity to current lantern
  state.near = -1;
  if (cur < STAGES.length && state.mode === 'play') {
    const o = stageObjs[cur];
    if (Math.hypot(p.x - o.lx, p.z - o.lz) < 3.2) state.near = cur;
  }
  $('prompt').hidden = state.near < 0;
  $('act').style.opacity = state.near >= 0 ? '1' : '0.45';

  // animate lanterns and gates
  stageObjs.forEach((o, i) => {
    o.orb.position.y = 1.8 + Math.sin(t * 2 + i) * 0.12;
    const target = state.solved[i] ? 1 : 0;
    o.open += (target - o.open) * Math.min(1, dt * 2.5);
    o.doors.forEach(({ hinge, side }) => (hinge.rotation.y = side * o.open * 1.75));
    o.light.intensity = 10 + Math.sin(t * 3 + i) * 2;
  });

  // moon brightens with progress
  const solvedCount = state.solved.filter(Boolean).length;
  const k = solvedCount / STAGES.length;
  moonMat.color.lerp(new THREE.Color(0x9a927a).lerp(new THREE.Color(0xfff4cc), k), 0.05);
  halo.material.opacity += (k * 0.22 - halo.material.opacity) * 0.05;

  // ending
  if (cur >= STAGES.length && p.z < gateZ(STAGES.length) - 8 && !state.endingShown) {
    state.endingShown = true;
    state.mode = 'ending';
    keys.clear();
    $('ending').hidden = false;
  }

  // camera follow
  camTarget.set(p.x * 0.6, 1.4, p.z - 4);
  camPos.set(p.x * 0.5, 5.5, p.z + 8.5);
  camera.position.lerp(camPos, Math.min(1, dt * 4));
  camera.lookAt(camTarget);
  moonLight.position.set(p.x - 8, 20, p.z + 6);
  moonLight.target.position.set(p.x, 0, p.z);

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Redraw labels once web fonts arrive so Korean text uses the intended faces.
document.fonts?.ready.then(() => {
  scene.children
    .filter((c) => c.isSprite)
    .forEach((s, i) => {
      const fresh = labelSprite([`${i + 1}번째 관문`, STAGES[i].title]);
      s.material.map.dispose();
      s.material.map = fresh.material.map;
      s.material.needsUpdate = true;
    });
});

requestAnimationFrame(tick);
