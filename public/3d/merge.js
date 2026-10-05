// Weniger Draw Calls: unbewegte Teile einer Gruppe, die dasselbe Material haben, werden zu
// einem Mesh verschmolzen. Wichtig für schwache Grafikchips (Figuren und Raum bestehen aus
// Hunderten Grundkörpern).

import * as THREE from 'three';

/**
 * Verschmilzt in jeder Gruppe unter `root` die direkten Kinder-Meshes mit gleichem Material.
 * Meshes in `keep` (animiert, umgeschaltet oder als Anker benutzt) bleiben einzeln, ebenso
 * transparente Meshes und solche mit eigenen Kindern.
 */
export function mergeStatic(root, keep = new Set()) {
  const groups = [];
  root.traverse((o) => {
    if (o.children.length > 1) groups.push(o);
  });
  for (const g of groups) {
    const buckets = new Map();
    for (const c of g.children) {
      if (!c.isMesh || c.children.length || keep.has(c) || Array.isArray(c.material)) continue;
      if (!c.visible || c.material.transparent || c.renderOrder) continue;
      const key = `${c.material.uuid}|${c.castShadow}|${c.receiveShadow}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      const parts = list.map((m) => {
        m.updateMatrix();
        const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        return geo.applyMatrix4(m.matrix);
      });
      const mesh = new THREE.Mesh(concat(parts), list[0].material);
      mesh.castShadow = list[0].castShadow;
      mesh.receiveShadow = list[0].receiveShadow;
      for (const m of list) g.remove(m);
      for (const p of parts) p.dispose();
      g.add(mesh);
    }
  }
}

function concat(geos) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    if (!geos.every((g) => g.attributes[name])) continue;
    const total = geos.reduce((n, g) => n + g.attributes[name].array.length, 0);
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, off);
      off += g.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, geos[0].attributes[name].itemSize));
  }
  out.computeBoundingSphere();
  return out;
}
