// Palco 3D do Missão Tattoo: manequim paramétrico em centímetros, régua, pinos e tatuagens projetadas (decal).
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { DecalGeometry } from '../vendor/DecalGeometry.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';

const V3 = THREE.Vector3, V2 = THREE.Vector2;
const K = 0.2977;                       // 1 unidade do desenho base = 0,2977 cm (corpo base de 170 cm)
const X = x => (x - 150) * K, Y = y => (593 - y) * K;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function profileLathe(rs, len, seg = 44) {
  // perfil suave de um membro ao longo de Y (0 → len) com tampas arredondadas
  const pts = [];
  const r0 = rs[0], rn = rs[rs.length - 1];
  for (let i = 0; i <= 6; i++) { const t = i / 6 * Math.PI / 2; pts.push(new V2(Math.sin(t) * r0, -Math.cos(t) * r0 * .85)); }
  for (let i = 1; i < rs.length - 1; i++) pts.push(new V2(rs[i], len * i / (rs.length - 1)));
  for (let i = 0; i <= 6; i++) { const t = i / 6 * Math.PI / 2; pts.push(new V2(Math.cos(t) * rn, len + Math.sin(t) * rn * .85)); }
  const curve = new THREE.SplineCurve(pts);
  const sm = curve.getPoints(70).map(p => new V2(Math.max(0, p.x), p.y));
  sm[0].x = 0; sm[sm.length - 1].x = 0;
  return new THREE.LatheGeometry(sm, seg);
}
function orient(mesh, a, b) {
  const d = new V3().subVectors(b, a); const len = d.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  return len;
}
function limb(name, a, b, rs, mat, depth = 1, twist = 0) {
  const len = a.distanceTo(b);
  const g = profileLathe(rs, len);
  if (depth !== 1) g.scale(1, 1, depth);
  if (twist) g.rotateY(twist);
  const m = new THREE.Mesh(g, mat); orient(m, a, b); m.name = name;
  m.userData.thick = Math.max(...rs) * 2 * Math.min(1, depth);
  return m;
}
function ball(name, p, r, mat, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), mat);
  m.scale.set(sx, sy, sz); m.position.copy(p); m.name = name; m.userData.thick = r * 2 * Math.min(sx, sy, sz);
  return m;
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;

    this.camera = new THREE.PerspectiveCamera(26, 1, 1, 3000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: .08, enablePan: false, rotateSpeed: .7,
      minPolarAngle: Math.PI / 2 - .45, maxPolarAngle: Math.PI / 2 + .12, minDistance: 45, maxDistance: 900 });

    const hemi = new THREE.HemisphereLight('#ffffff', '#3b25b8', .55); this.scene.add(hemi);
    const key = this.key = new THREE.DirectionalLight('#fff4e8', 2.1); key.position.set(120, 260, 200); key.castShadow = true;
    Object.assign(key.shadow.camera, { left: -90, right: 90, top: 210, bottom: -10, near: 10, far: 700 });
    key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6; key.shadow.bias = -.0005; this.scene.add(key);
    const rim = new THREE.DirectionalLight('#b9a8ff', 1.5); rim.position.set(-180, 160, -220); this.scene.add(rim);
    const fill = new THREE.DirectionalLight('#ffffff', .35); fill.position.set(-160, 80, 160); this.scene.add(fill);

    // chão: disco e sombra de contato
    const ground = new THREE.Mesh(new THREE.CircleGeometry(130, 64), new THREE.ShadowMaterial({ opacity: .32 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; this.scene.add(ground);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(46, 64), new THREE.MeshStandardMaterial({ color: '#2f1b96', roughness: .9 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = .05; disc.receiveShadow = true; this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(46, 47.2, 96), new THREE.MeshBasicMaterial({ color: '#cfc6ff', transparent: true, opacity: .55 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .1; this.scene.add(ring);

    this.group = new THREE.Group(); this.scene.add(this.group);
    this.parts = []; this.decals = new Map(); this.pins = new THREE.Group(); this.group.add(this.pins);
    this.rulerObj = null; this.params = null; this.viewRot = 0; this.anim = null;
    this.raycaster = new THREE.Raycaster();
    this.resize(); addEventListener('resize', () => this.resize());
    this.home(true);
    const loop = () => { this.tick(); this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
  }
  resize() {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  // ---------- corpo (malha CC0 do MakeHuman, 8 variações pré-calculadas) ----------
  async load(url = './models/') {
    const [meta, bin] = await Promise.all([fetch(url + 'corpo.json').then(r => r.json()), fetch(url + 'corpo.bin').then(r => r.arrayBuffer())]);
    this.mh = { meta, bin };
    if (this.pending) { const p = this.pending; this.pending = null; this.bodyKey = null; this.setBody(p); }
    return this;
  }
  setBody(p) {
    if (!this.mh) { this.pending = p; return; }
    const key = JSON.stringify([p.corpo, p.build, p.skin, p.altura, p.hair, p.holo]);
    if (key === this.bodyKey) return; this.bodyKey = key; this.params = p;
    for (const m of this.parts) { this.group.remove(m); if (m.geometry.index) m.geometry.setIndex(null); }
    this.parts = [];
    const { meta, bin } = this.mh, N = meta.n, A = p.corpo !== 'B';
    const raw = new Int16Array(bin, meta.bodies[(A ? 0 : 4) + p.build], N * 3), pos = new Float32Array(N * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = raw[i] / meta.scale;
    const lab = new Uint8Array(bin, meta.labels, N), mask = new Uint8Array(bin, A ? meta.maskA : meta.maskB, N);
    const all = [];
    for (const k in meta.tris) { const [off, cnt] = meta.tris[k]; if (k === 'eye' || k === 'hair') continue; all.push(new Uint16Array(bin, off, cnt)); }
    const full = new THREE.BufferGeometry(); full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idxAll = new Uint32Array(all.reduce((a, b) => a + b.length, 0)); let o = 0; for (const a of all) { idxAll.set(a, o); o += a.length; }
    full.setIndex(new THREE.BufferAttribute(idxAll, 1)); full.computeVertexNormals();
    const posA = full.getAttribute('position'), nrmA = full.getAttribute('normal');
    const col = new Float32Array(N * 3), skinC = new THREE.Color(p.holo ? '#ffffff' : p.skinColor), wearC = new THREE.Color('#2b2350');
    const P = meta.parts, iT = P.indexOf('torso'), iTd = P.indexOf('thigh_dir'), iTe = P.indexOf('thigh_esq');
    let crotch = 999; for (let i = 0; i < N; i++) if (lab[i] === iT) crotch = Math.min(crotch, pos[i * 3 + 1]);
    const briefTop = crotch + 15.5, legCut = crotch - 1.2;
    for (let i = 0; i < N; i++) {
      const y = pos[i * 3 + 1], L = lab[i];
      let wear = (L === iT && y < briefTop) || ((L === iTd || L === iTe) && y > legCut && y < briefTop);
      if (!A && L === iT && y > crotch + 33 && y < crotch + 47) wear = true;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 1;
    }
    const colA = new THREE.BufferAttribute(col, 3);
    const skin = p.holo
      ? new THREE.MeshPhysicalMaterial({ color: '#6b55ec', roughness: .3, metalness: .05, clearcoat: .6, clearcoatRoughness: .3, emissive: '#2a1690', emissiveIntensity: .45 })
      : new THREE.MeshPhysicalMaterial({ color: p.skinColor, roughness: .52, metalness: 0, clearcoat: .05, sheen: .55, sheenRoughness: .6, sheenColor: new THREE.Color('#ffcfb8') });
    if (!p.holo) {
      let crotch = 999; const iT = meta.parts.indexOf('torso'); for (let i = 0; i < N; i++) if (lab[i] === iT) crotch = Math.min(crotch, pos[i * 3 + 1]);
      const U = { uCrotch: { value: crotch }, uFem: { value: A ? 0 : 1 }, uWear: { value: new THREE.Color('#2b2350') } };
      skin.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = 'varying vec3 vLoc;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
        sh.fragmentShader = 'varying vec3 vLoc;\nuniform float uCrotch;\nuniform float uFem;\nuniform vec3 uWear;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float ax = abs(vLoc.x), y = vLoc.y - uCrotch, e = .35;
          float leg = -1.4 + max(0., ax - 3.5) * .55;
          float brief = smoothstep(leg - e, leg + e, y) * (1. - smoothstep(14.5 - e, 14.5 + e, y)) * (1. - smoothstep(21., 22., ax));
          float top = uFem * smoothstep(34.5 - e, 34.5 + e, y) * (1. - smoothstep(51. - e, 51. + e, y)) * (1. - smoothstep(16.5, 17.5, ax));
          diffuseColor.rgb = mix(diffuseColor.rgb, uWear, clamp(brief + top, 0., 1.));`);
      };
      skin.customProgramCacheKey = () => 'wear' + (A ? 'A' : 'B');
    }
    this.skinMat = skin;
    const groups = {};
    for (const k in meta.tris) { const name = k.startsWith('shoulder_') ? 'upper_' + k.split('_')[1] : k; (groups[name] = groups[name] || []).push(k); }
    for (const name in groups) {
      const arrs = groups[name].map(k => new Uint16Array(bin, meta.tris[k][0], meta.tris[k][1]));
      const idx = new Uint32Array(arrs.reduce((a, b) => a + b.length, 0)); let q = 0; for (const a of arrs) { idx.set(a, q); q += a.length; }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', posA); g.setAttribute('normal', nrmA); g.setAttribute('color', colA);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const pbox = new THREE.Box3(), tv = new V3(); for (let q2 = 0; q2 < idx.length; q2++) { tv.fromBufferAttribute(posA, idx[q2]); pbox.expandByPoint(tv); }
      g.boundingBox = pbox.clone(); g.boundingSphere = pbox.getBoundingSphere(new THREE.Sphere());
      let mat = skin;
      if (name === 'eye') mat = new THREE.MeshPhysicalMaterial({ color: '#1d1410', roughness: .15, clearcoat: 1 });
      if (name === 'hair') continue;
      const m = new THREE.Mesh(g, mat); m.name = name; m.userData.part = name; m.castShadow = true; m.receiveShadow = true;
      const bb = g.boundingBox, sz = bb.getSize(new V3()); m.userData.thick = Math.min(sz.x, sz.z) * 1.0; m.userData.box = bb.clone();
      this.group.add(m); this.parts.push(m);
    }
    // cabelo: casca deslocada sobre o couro cabeludo; no corpo B, mais uma mecha longa atrás
    if (!p.holo && p.hair) {
      const head = this.parts.find(m => m.name === 'head'), hb = head.userData.box, hc = hb.getCenter(new V3()), hh = hb.max.y - hb.min.y, hd = hb.max.z - hb.min.z;
      const HI = head.geometry.index.array, keep = [];
      const okV = i => { const y = posA.getY(i), z = posA.getZ(i); const top = y > hb.min.y + hh * .62; const face = z > hc.z + hd * .12 && y < hb.min.y + hh * .86; const nape = y > hb.min.y + hh * (z < hc.z ? .38 : .62); return top && !face && nape || (z < hc.z - hd * .05 && y > hb.min.y + hh * .4); };
      for (let k = 0; k < HI.length; k += 3) if (okV(HI[k]) && okV(HI[k + 1]) && okV(HI[k + 2])) keep.push(HI[k], HI[k + 1], HI[k + 2]);
      const used = [...new Set(keep)], map = new Map(used.map((v, j) => [v, j])), hp = new Float32Array(used.length * 3);
      used.forEach((v, j) => { const off = .55; hp[j * 3] = posA.getX(v) + nrmA.getX(v) * off; hp[j * 3 + 1] = posA.getY(v) + nrmA.getY(v) * off; hp[j * 3 + 2] = posA.getZ(v) + nrmA.getZ(v) * off; });
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setIndex(keep.map(v => map.get(v))); hg.computeVertexNormals();
      const hmat = new THREE.MeshStandardMaterial({ color: p.hairColor || '#3a2618', roughness: .86, side: THREE.DoubleSide });
      const cap = new THREE.Mesh(hg, hmat); cap.name = 'hair'; cap.userData.part = 'hair'; cap.castShadow = true; this.group.add(cap); this.parts.push(cap);
    }
    if (!p.holo && p.hair === 2) {
      const hb = this.parts.find(m => m.name === 'head').userData.box, c = hb.getCenter(new V3()), hh = hb.max.y - hb.min.y;
      const hm = new THREE.MeshStandardMaterial({ color: p.hairColor || '#3a2618', roughness: .82 });
      const back = new THREE.Mesh(profileLathe([6.4, 8.6, 8.2, 7, 5.2, 2.6], hh * 1.25), hm);
      back.scale.set(1, 1, .42); back.rotation.x = Math.PI; back.position.set(c.x, hb.max.y - hh * .12, hb.min.z + 2.6);
      back.castShadow = true; back.userData.part = 'hair'; back.name = 'hair'; this.group.add(back); this.parts.push(back);
    }
    const bb = new THREE.Box3(); this.parts.forEach(m => bb.expandByObject(m)); this.bodyBox = bb;
    this.group.scale.setScalar((p.altura || 170) / 170);
    this.setRuler(p.altura || 170);
    this.reapplyDecals();
  }
  partBox(part) { const m = this.parts.find(x => x.userData.part === part); return m ? m.userData.box : null; }
  setRuler(H) {
    if (this.rulerH === H) return; this.rulerH = H;
    if (this.rulerObj) { this.scene.remove(this.rulerObj); }
    const c = document.createElement('canvas'); c.width = 128; c.height = 2048; const x = c.getContext('2d');
    x.fillStyle = '#f5f3ff'; x.fillRect(0, 0, 128, 2048);
    x.fillStyle = '#17131f'; x.font = '600 40px "JetBrains Mono", monospace'; x.textAlign = 'left'; x.textBaseline = 'middle';
    for (let cm = 0; cm <= H; cm++) {
      const y = 2048 - cm / H * 2048, len = cm % 10 === 0 ? 46 : cm % 5 === 0 ? 30 : 16;
      x.fillRect(0, y - 2, len, 4);
      if (cm % 20 === 0 && cm > 0 && cm < H - 4) x.fillText(String(cm), 54, y);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const geo = new THREE.BoxGeometry(4.4, H, 1.4);
    const mats = [new THREE.MeshStandardMaterial({ color: '#d9d2ff', roughness: .6 }), new THREE.MeshStandardMaterial({ color: '#d9d2ff' }), new THREE.MeshStandardMaterial({ color: '#d9d2ff' }), new THREE.MeshStandardMaterial({ color: '#d9d2ff' }), new THREE.MeshStandardMaterial({ map: tex, roughness: .55 }), new THREE.MeshStandardMaterial({ color: '#d9d2ff' })];
    const half = this.bodyBox ? Math.max(-this.bodyBox.min.x, this.bodyBox.max.x) * (H / 170) : 40;
    const post = new THREE.Mesh(geo, mats); post.position.set(-(half + 12), H / 2, -4);
    this.rulerObj = post; this.scene.add(post);
  }
  // ---------- câmera ----------
  fitFull(aspect = this.camera.aspect, tight) {
    const sc = (this.params?.altura || 170) / 170, bb = this.bodyBox;
    const H = (bb ? bb.max.y : 170) * sc * (tight ? 1.04 : 1.08), Wd = ((bb ? Math.max(-bb.min.x, bb.max.x) * 2 : 95) * sc + (tight ? 4 : 34)) * 1.04, fov = this.camera.fov * Math.PI / 180;
    const dV = (H / 2) / Math.tan(fov / 2), dH = (Wd / 2) / (Math.tan(fov / 2) * aspect);
    return { target: new V3(0, H / 2.12, 0), dist: Math.max(dV, dH) };
  }
  home(instant) {
    const { target, dist } = this.fitFull();
    this.flyTo(target, new V3(0, target.y + dist * .1, dist), instant);
  }
  flyTo(target, pos, instant) {
    if (instant || REDUCED) { this.controls.target.copy(target); this.camera.position.copy(pos); this.anim = null; return; }
    this.anim = { t0: performance.now(), d: 900, fT: this.controls.target.clone(), fP: this.camera.position.clone(), tT: target, tP: pos };
  }
  tick() {
    const a = this.anim; if (a) {
      const p = Math.min(1, (performance.now() - a.t0) / a.d), e = 1 - Math.pow(1 - p, 4);
      this.controls.target.lerpVectors(a.fT, a.tT, e); this.camera.position.lerpVectors(a.fP, a.tP, e);
      if (p >= 1) this.anim = null;
    }
    const r = this.rot; if (r) {
      const p = Math.min(1, (performance.now() - r.t0) / r.d), e = 1 - Math.pow(1 - p, 4);
      this.group.rotation.y = r.from + (r.to - r.from) * e; if (p >= 1) this.rot = null;
    }
    if (this.idle && !this.anim) this.group.rotation.y += .0035;
  }
  setIdle(on) { this.idle = on && !REDUCED; if (!on) this.setView(this.view || 'front', true); }
  setView(v, animate) {
    this.view = v; const to = v === 'back' ? Math.PI : 0;
    let from = this.group.rotation.y % (Math.PI * 2); if (from < 0) from += Math.PI * 2;
    let target = to; if (Math.abs(target - from) > Math.PI) target += target < from ? Math.PI * 2 : -Math.PI * 2;
    if (!animate || REDUCED) { this.group.rotation.y = to; this.rot = null; }
    else this.rot = { t0: performance.now(), d: 800, from, to: target };
  }
  focusLocal(pLocal, nLocal, size = 12) {
    this.group.updateMatrixWorld(true);
    const targetRot = this.rot ? this.rot.to : this.group.rotation.y;
    const mtx = new THREE.Matrix4().makeRotationY(targetRot).scale(new V3().setScalar(this.group.scale.x));
    const p = new V3(...pLocal).applyMatrix4(mtx), n = new V3(...nLocal).applyMatrix4(new THREE.Matrix4().makeRotationY(targetRot)).normalize();
    n.y *= .35; n.normalize();
    const dist = Math.max(70, size * 4.2 + 40);
    this.flyTo(p, p.clone().add(n.multiplyScalar(dist)).add(new V3(0, 6, 0)));
  }
  // ---------- seleção ----------
  pick(cx, cy) {
    // tenta o ponto exato e, se o raio passar pela costura do meio da malha, alguns pixels ao lado
    for (const [dx, dy] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [3, 0], [-3, 0]]) { const h = this.pick1(cx + dx, cy + dy); if (h) return h; }
    return null;
  }
  pick1(cx, cy) {
    const rc = this.canvas.getBoundingClientRect();
    const ndc = new V2(((cx - rc.left) / rc.width) * 2 - 1, -((cy - rc.top) / rc.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.parts, false);
    const h = hits.find(x => x.object.userData.part !== 'hair'); if (!h) return null;
    return this.toLocal(h);
  }
  toLocal(h) {
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const p = h.point.clone().applyMatrix4(inv);
    const nm = new THREE.Matrix3().getNormalMatrix(h.object.matrixWorld);
    const n = h.face.normal.clone().applyMatrix3(nm).normalize();
    const nl = n.applyMatrix3(new THREE.Matrix3().getNormalMatrix(inv)).normalize();
    return { part: h.object.userData.part, p: p.toArray(), n: nl.toArray() };
  }
  // raio a partir da frente ou de trás do corpo até um ponto do corpo (para escolher pela lista)
  anchor(part, yCm, xCm, back, yFrac = .5) {
    // escolhe o vértice da parte que olha para a frente (ou para trás) mais perto do alvo
    const m = this.parts.find(x => x.userData.part === part); if (!m) return null;
    const g = m.geometry, P = g.getAttribute('position'), Nn = g.getAttribute('normal'), I = g.index.array, bb = m.userData.box;
    const yt = yCm != null ? yCm : bb.min.y + (bb.max.y - bb.min.y) * yFrac, dir = back ? -1 : 1;
    let best = -1, bs = Infinity; const seen = new Set();
    for (let k = 0; k < I.length; k++) {
      const i = I[k]; if (seen.has(i)) continue; seen.add(i);
      const nz = Nn.getZ(i) * dir; if (nz < .55) continue;
      const sc = Math.abs(P.getY(i) - yt) + (xCm != null ? Math.abs(P.getX(i) - xCm) : 0) - nz * .8;
      if (sc < bs) { bs = sc; best = i; }
    }
    if (best < 0) return null;
    const n = new V3(Nn.getX(best), Nn.getY(best), Nn.getZ(best)).normalize();
    return { part, p: [P.getX(best), P.getY(best), P.getZ(best)], n: n.toArray() };
  }
  // ---------- pinos ----------
  setPins(list) {
    for (const c of [...this.pins.children]) { this.pins.remove(c); c.material.map.dispose(); c.material.dispose(); }
    for (const { num, p, n, active } of list) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      x.fillStyle = active ? '#ffffff' : '#f2cd3a'; x.beginPath(); x.arc(64, 64, 52, 0, Math.PI * 2); x.fill();
      x.lineWidth = 9; x.strokeStyle = '#17131f'; x.stroke();
      x.fillStyle = '#17131f'; x.font = '700 64px "JetBrains Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(num), 64, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
      sp.renderOrder = 10; sp.scale.set(4.6, 4.6, 1);
      sp.position.set(...p).add(new V3(...n).multiplyScalar(4.5)); this.pins.add(sp);
    }
  }
  // ---------- tatuagens ----------
  setDecal(id, d) { this.decals.set(id, { ...d, mesh: this.decals.get(id)?.mesh }); this.buildDecal(id); }
  removeDecal(id) { const d = this.decals.get(id); if (d?.mesh) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); } this.decals.delete(id); }
  clearDecals() { for (const id of [...this.decals.keys()]) this.removeDecal(id); }
  reapplyDecals() { for (const id of this.decals.keys()) this.buildDecal(id); }
  texFor(d) {
    const key = d.canvas.__k || (d.canvas.__k = Math.random().toString(36).slice(2));
    const ck = key + (d.flip ? 'f' : '');
    this.texCache = this.texCache || new Map();
    if (!this.texCache.has(ck)) {
      const t = new THREE.CanvasTexture(d.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      if (d.flip) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; t.offset.x = 1; }
      this.texCache.set(ck, t);
    }
    return this.texCache.get(ck);
  }
  buildDecal(id) {
    const d = this.decals.get(id); if (!d) return;
    if (d.mesh) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh = null; }
    const meshes = this.parts.filter(m => m.userData.part === d.part); if (!meshes.length) return;
    this.group.updateMatrixWorld(true);
    const s = this.group.scale.x;
    const wp = new V3(...d.p).applyMatrix4(this.group.matrixWorld);
    const wn = new V3(...d.n).transformDirection(this.group.matrixWorld);
    const helper = new THREE.Object3D(); helper.position.copy(wp); helper.lookAt(wp.clone().add(wn)); helper.rotateZ(-(d.rot || 0) * Math.PI / 180);
    const w = d.w, h = d.w * d.ratio;
    const thick = Math.max(...meshes.map(m => m.userData.thick || 10)) * s;
    const size = new V3(w, h, Math.min(Math.max(w, h) * .9, thick * .9));
    const geos = meshes.map(m => new DecalGeometry(m, wp, helper.rotation, size));
    const mat = new THREE.MeshStandardMaterial({ map: this.texFor(d), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: .55, metalness: 0 });
    const grp = new THREE.Group();
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    for (const g of geos) { if (!g.attributes.position || !g.attributes.position.count) continue; g.applyMatrix4(inv); const m = new THREE.Mesh(g, mat); m.renderOrder = 2; grp.add(m); }
    grp.geometry = { dispose() { grp.children.forEach(c => c.geometry.dispose()); } };
    this.group.add(grp); d.mesh = grp;
  }
  // ---------- imagens para a ficha ----------
  withCamera(fn) {
    const save = { pos: this.camera.position.clone(), tgt: this.controls.target.clone(), rot: this.group.rotation.y, aspect: this.camera.aspect, pins: this.pins.visible, anim: this.anim, r: this.rot, idle: this.idle };
    this.anim = null; this.rot = null; this.idle = false;
    try { return fn(); } finally {
      this.camera.position.copy(save.pos); this.controls.target.copy(save.tgt); this.group.rotation.y = save.rot; this.pins.visible = save.pins;
      this.anim = save.anim; this.rot = save.r; this.idle = save.idle;
      this.resize(); this.camera.lookAt(this.controls.target);
    }
  }
  renderTo(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(this.renderer.domElement, 0, 0, w, h);
    this.renderer.setPixelRatio(pr);
    return c;
  }
  snapshot(view, w, h, pts = []) {
    return this.withCamera(() => {
      this.group.rotation.y = view === 'back' ? Math.PI : 0; this.pins.visible = false; if (this.rulerObj) this.rulerObj.visible = false;
      const { target, dist } = this.fitFull(w / h, true);
      this.camera.position.set(0, target.y + dist * .04, dist); this.controls.target.copy(target); this.camera.lookAt(target);
      this.group.updateMatrixWorld(true);
      const canvas = this.renderTo(w, h);
      const proj = pts.map(p => { const v = new V3(...p).applyMatrix4(this.group.matrixWorld).project(this.camera); return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h]; });
      if (this.rulerObj) this.rulerObj.visible = true;
      return { canvas, proj };
    });
  }
  closeup(id, w, h) {
    const d = this.decals.get(id); if (!d) return null;
    return this.withCamera(() => {
      const view = d.n[2] < 0 ? 'back' : 'front';
      this.group.rotation.y = view === 'back' ? Math.PI : 0; this.pins.visible = false; this.group.updateMatrixWorld(true);
      const p = new V3(...d.p).applyMatrix4(this.group.matrixWorld), n = new V3(...d.n).transformDirection(this.group.matrixWorld);
      n.y *= .3; n.normalize();
      const size = Math.max(d.w, d.w * d.ratio);
      this.camera.position.copy(p.clone().add(n.multiplyScalar(size * 3 + 22))); this.camera.lookAt(p);
      return this.renderTo(w, h);
    });
  }
  thumb(params, w, h, crop) {
    const prev = this.params, prevKey = this.bodyKey, dec = this.decals; this.decals = new Map();
    const hide = this.decalsHidden(dec);
    this.setBody(params);
    const out = this.withCamera(() => {
      this.group.rotation.y = 0; this.pins.visible = false; if (this.rulerObj) this.rulerObj.visible = false;
      const t = crop === 'head' ? new V3(0, (params.altura || 170) * .86, 0) : this.fitFull(w / h).target;
      const dist = crop === 'head' ? 90 : this.fitFull(w / h).dist * .92;
      this.camera.position.set(0, t.y + 6, dist); this.camera.lookAt(t);
      const c = this.renderTo(w, h); if (this.rulerObj) this.rulerObj.visible = true; return c;
    });
    this.decals = dec; hide();
    if (prev) { this.bodyKey = null; this.setBody(prev); } else this.bodyKey = prevKey;
    return out;
  }
  decalsHidden(dec) { const vis = []; for (const d of dec.values()) if (d.mesh) { vis.push(d.mesh); d.mesh.visible = false; } return () => vis.forEach(m => m.visible = true); }
}
