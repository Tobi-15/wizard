// 3D-Modelle (glTF/GLB) als Spielfiguren: laden, auf Kneipengröße bringen, Materialien an die
// Szene anpassen und – falls das Modell kein Skelett hat – automatisch ein einfaches Skelett
// erzeugen. Die Figuren werden danach in characters.js (ModelCharacter) hingesetzt und bewegt.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const templates = new Map(); // url -> Promise<Object3D>

/** Lädt ein Modell (einmal pro Datei) und gibt eine eigene Kopie mit eigenem Skelett zurück. */
export async function loadModel(url, { height = 1.75 } = {}) {
  if (!templates.has(url)) templates.set(url, loader.loadAsync(url).then((g) => prepare(g.scene, height)));
  return SkeletonUtils.clone(await templates.get(url));
}

function prepare(scene, height) {
  scene.updateMatrixWorld(true);
  let skinned = false;
  scene.traverse((o) => {
    skinned ||= o.isSkinnedMesh;
    // Unbeleuchtete Modelle kommen oft ohne Normalen – für Kerzenlicht braucht es sie
    if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
  });
  if (!skinned) autoRig(scene);

  // Materialien wie im Rest der Kneipe: Lambert (günstig, reagiert auf Kerzenlicht und Nebel)
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const old = o.material;
    o.material = new THREE.MeshLambertMaterial({
      map: old.map ?? null,
      color: old.color ?? 0xffffff,
      transparent: old.transparent,
      opacity: old.opacity,
      alphaTest: old.alphaTest || (old.transparent ? 0.02 : 0),
      side: old.side,
    });
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // Sitzpose liegt außerhalb der Bounding Box aus der T-Pose
  });

  // Auf Kneipengröße bringen: Füße auf 0, mittig, Blick nach +z (wie alle glTF-Figuren)
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group();
  wrap.name = 'model';
  const s = height / size.y;
  scene.scale.multiplyScalar(s);
  scene.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
  wrap.add(scene);
  return wrap;
}

// ---------- Knochen nach Rolle finden ----------
const ROLE_NAMES = {
  hips: ['hips', 'hip', 'pelvis'],
  head: ['head'],
  shoulderL: ['leftshoulder', 'shoulder_l', 'clavicle_l'],
  shoulderR: ['rightshoulder', 'shoulder_r', 'clavicle_r'],
  upperArmL: ['leftarm', 'upper_arm_l', 'upperarm_l'],
  upperArmR: ['rightarm', 'upper_arm_r', 'upperarm_r'],
  foreArmL: ['leftforearm', 'lower_arm_l', 'forearm_l'],
  foreArmR: ['rightforearm', 'lower_arm_r', 'forearm_r'],
  handL: ['lefthand', 'hand_l'],
  handR: ['righthand', 'hand_r'],
  upLegL: ['leftupleg', 'upper_leg_l', 'thigh_l'],
  upLegR: ['rightupleg', 'upper_leg_r', 'thigh_r'],
  legL: ['leftleg', 'lower_leg_l', 'calf_l', 'shin_l'],
  legR: ['rightleg', 'lower_leg_r', 'calf_r', 'shin_r'],
  footL: ['leftfoot', 'foot_l'],
  footR: ['rightfoot', 'foot_r'],
};

/** Sketchfab hängt Nummern an („LeftArm_013“), Mixamo ein Präfix – beides weg. */
function boneKey(name) {
  return name.toLowerCase().replace(/^mixamorig:?/, '').replace(/_\d+$/, '');
}

/** Rollen → Knochen. Wirbelsäule und Hals sind Ketten (spine, spine1, … bzw. neck, neck1, …). */
export function findBones(root) {
  const byKey = new Map();
  const depth = new Map();
  root.traverse((o) => {
    if (!o.isBone) return;
    const k = boneKey(o.name);
    if (!byKey.has(k)) byKey.set(k, o);
    let d = 0;
    for (let p = o.parent; p; p = p.parent) d++;
    depth.set(o, d);
  });
  const bones = {};
  for (const [role, names] of Object.entries(ROLE_NAMES)) bones[role] = names.map((n) => byKey.get(n)).find(Boolean) ?? null;
  const chain = (re) => [...byKey.entries()].filter(([k]) => re.test(k)).map(([, b]) => b).sort((a, b) => depth.get(a) - depth.get(b));
  bones.spine = chain(/^(spine[_]?\d*|chest|upperchest)$/);
  bones.neck = chain(/^neck[_]?\d*$/);
  const missing = ['hips', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'upLegL', 'upLegR', 'legL', 'legR', 'footL', 'footR'].filter((r) => !bones[r]);
  return { bones, missing };
}

function floatAttr(a) {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
  return new THREE.BufferAttribute(out, a.itemSize);
}

// ---------- Automatisches Skelett für Modelle ohne Rig (T- oder A-Pose) ----------
// Gelenke aus Körperproportionen und der Geometrie (Beinmitten, Handspitzen); jeder Vertex
// hängt an den zwei nächstgelegenen Knochen. Reicht für Sitzen, Kopfdrehen und Arme.
function autoRig(scene) {
  const meshes = [];
  scene.traverse((o) => o.isMesh && meshes.push(o));
  // Geometrie in Szenenkoordinaten backen
  const pts = [];
  for (const m of meshes) {
    const rel = new THREE.Matrix4().copy(scene.matrixWorld).invert().multiply(m.matrixWorld);
    m.geometry = m.geometry.clone();
    // komprimierte (normierte Ganzzahl-)Attribute erst in Float wandeln, sonst läuft das Einbacken über
    for (const name of ['position', 'normal']) {
      const a = m.geometry.attributes[name];
      if (a && !(a.array instanceof Float32Array)) m.geometry.setAttribute(name, floatAttr(a));
    }
    m.geometry.applyMatrix4(rel);
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  }
  const box = new THREE.Box3().setFromPoints(pts);
  const H = box.max.y - box.min.y;
  const y0 = box.min.y;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const at = (fy) => y0 + fy * H;
  // Beinmitten auf Kniehöhe
  const legX = (side) => {
    const xs = pts.filter((p) => Math.abs(p.y - at(0.28)) < H * 0.03 && Math.sign(p.x - cx) === side).map((p) => p.x);
    return xs.length ? xs.reduce((a, b) => a + b) / xs.length : cx + side * 0.055 * H;
  };
  // Handspitzen: äußerste Punkte links/rechts oberhalb der Hüfte
  const tip = (side) => pts.filter((p) => p.y > at(0.35)).reduce((best, p) => (side * (p.x - cx) > side * (best.x - cx) ? p : best));
  const J = {};
  J.hips = new THREE.Vector3(cx, at(0.53), cz);
  J.spine = new THREE.Vector3(cx, at(0.63), cz);
  J.chest = new THREE.Vector3(cx, at(0.73), cz);
  J.neck = new THREE.Vector3(cx, at(0.835), cz);
  J.head = new THREE.Vector3(cx, at(0.875), cz);
  J.headTop = new THREE.Vector3(cx, at(1.0), cz);
  for (const [s, side] of [['L', 1], ['R', -1]]) {
    // glTF-Figuren schauen nach +z, ihre linke Seite ist +x
    J[`shoulder${s}`] = new THREE.Vector3(cx + side * 0.04 * H, at(0.8), cz);
    J[`upperArm${s}`] = new THREE.Vector3(cx + side * 0.11 * H, at(0.8), cz);
    const t = tip(side);
    J[`handTip${s}`] = t.clone();
    J[`hand${s}`] = t.clone().lerp(J[`upperArm${s}`], (0.1 * H) / t.distanceTo(J[`upperArm${s}`]));
    J[`foreArm${s}`] = J[`upperArm${s}`].clone().lerp(J[`hand${s}`], 0.5);
    const lx = legX(side);
    J[`upLeg${s}`] = new THREE.Vector3(lx, at(0.5), cz);
    J[`leg${s}`] = new THREE.Vector3(lx, at(0.285), cz);
    J[`foot${s}`] = new THREE.Vector3(lx, at(0.045), cz);
    J[`toe${s}`] = new THREE.Vector3(lx, at(0.01), cz + 0.07 * H);
  }
  // Hierarchie: Name, Eltern, Gelenk, Endpunkt (für den Abstand Vertex → Knochen)
  const defs = [
    ['hips', null, 'hips', 'spine'], ['spine', 'hips', 'spine', 'chest'], ['chest', 'spine', 'chest', 'neck'],
    ['neck', 'chest', 'neck', 'head'], ['head', 'neck', 'head', 'headTop'],
  ];
  for (const [s, n] of [['L', 'left'], ['R', 'right']]) {
    defs.push(
      [`${n}shoulder`, 'chest', `shoulder${s}`, `upperArm${s}`], [`${n}arm`, `${n}shoulder`, `upperArm${s}`, `foreArm${s}`],
      [`${n}forearm`, `${n}arm`, `foreArm${s}`, `hand${s}`], [`${n}hand`, `${n}forearm`, `hand${s}`, `handTip${s}`],
      [`${n}upleg`, 'hips', `upLeg${s}`, `leg${s}`], [`${n}leg`, `${n}upleg`, `leg${s}`, `foot${s}`], [`${n}foot`, `${n}leg`, `foot${s}`, `toe${s}`],
    );
  }
  const bones = [];
  const byName = {};
  for (const [name, parent, j] of defs) {
    const b = new THREE.Bone();
    b.name = name;
    const p = parent ? byName[parent] : null;
    b.position.copy(J[j]).sub(p ? J[defs.find((d) => d[0] === parent)[2]] : new THREE.Vector3());
    (p ?? scene).add(b);
    byName[name] = b;
    bones.push(b);
  }
  const side = (name) => (name.startsWith('left') ? 1 : name.startsWith('right') ? -1 : 0);
  const segs = defs.map(([name, , a, b], i) => ({ i, side: side(name), a: J[a], b: J[b] }));
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const _p = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const seg = new THREE.Line3();
  for (const m of meshes) {
    const geo = m.geometry;
    const pos = geo.attributes.position;
    const idx = new Uint16Array(pos.count * 4);
    const wts = new Float32Array(pos.count * 4);
    for (let v = 0; v < pos.count; v++) {
      _p.fromBufferAttribute(pos, v);
      const s = Math.abs(_p.x - cx) < 0.02 * H ? 0 : Math.sign(_p.x - cx);
      let b1 = -1;
      let d1 = Infinity;
      let b2 = -1;
      let d2 = Infinity;
      for (const g of segs) {
        if (g.side && s && g.side !== s) continue; // nie an Knochen der anderen Körperseite
        seg.set(g.a, g.b).closestPointToPoint(_p, true, _c);
        const d = _c.distanceTo(_p);
        if (d < d1) [b2, d2, b1, d1] = [b1, d1, g.i, d];
        else if (d < d2) [b2, d2] = [g.i, d];
      }
      const w1 = 1 / (d1 + 0.01 * H) ** 4;
      const w2 = b2 >= 0 ? 1 / (d2 + 0.01 * H) ** 4 : 0;
      idx[v * 4] = b1;
      idx[v * 4 + 1] = Math.max(b2, 0);
      wts[v * 4] = w1 / (w1 + w2);
      wts[v * 4 + 1] = w2 / (w1 + w2);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const sm = new THREE.SkinnedMesh(geo, m.material);
    sm.name = m.name;
    scene.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton);
    m.removeFromParent();
  }
}

// ---------- Pose über Knochen ----------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const ID = new THREE.Quaternion();

/** Dreht einen Knochen um eine Rotation im Weltraum (Kinder gehen mit). */
export function rotateWorld(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_bq);
  bone.quaternion.copy(_pq.invert().multiply(q).multiply(_bq));
  bone.updateMatrixWorld(true);
}

/** Dreht einen Knochen so, dass die Strecke zu `end` (nächstes Gelenk) in Richtung `dir` (Welt) zeigt. */
export function aimBone(bone, end, dir) {
  bone.getWorldPosition(_a);
  end.getWorldPosition(_b);
  _q.setFromUnitVectors(_b.sub(_a).normalize(), dir);
  rotateWorld(bone, _q);
}

/** Anteil einer Rotation (0 … 1), für Ketten wie Wirbelsäule und Hals. */
export function partOf(q, k, out = new THREE.Quaternion()) {
  return out.slerpQuaternions(ID, q, k);
}
