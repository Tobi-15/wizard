// Sketchfab-glTF → kleines GLB für die 3D-Kneipe: Normal-/PBR-Maps raus, Geometrie vereinfachen,
// Texturen auf max. 1024 px als WebP, Geometrie mit Meshopt komprimiert (der 3D-Client
// entpackt das mit dem MeshoptDecoder).
//
// Die Pakete sind bewusst keine Projekt-Abhängigkeiten (sharp ist groß, Render braucht sie nicht):
//   npm install --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node scripts/model.mjs ~/Downloads/xyz/scene.gltf public/3d/models/xyz.glb [anteil=1] [texturgröße=1024]
// anteil < 1 vereinfacht die Geometrie (z. B. 0.25 bei 100k Dreiecken), Ziel: unter ~35k Dreiecke.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, meshopt, resample } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [input, output, ratioArg, sizeArg] = process.argv.slice(2);
const ratio = Number(ratioArg ?? 1);
const size = Number(sizeArg ?? 1024);
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
for (const m of root.listMaterials()) {
  m.setNormalTexture(null);
  m.setOcclusionTexture(null);
  m.setMetallicRoughnessTexture(null);
  m.setEmissiveTexture(null);
  // Material-Erweiterungen (Specular, Clearcoat, …) bringen nur weitere Texturen; die Kneipe nutzt Lambert
  for (const ext of m.listExtensions()) ext.dispose();
}
// Texturen, die jetzt kein Material mehr benutzt, entfernen (prune erwischt sie nicht immer)
for (const t of root.listTextures()) {
  if (t.listParents().every((p) => p.propertyType === 'Root')) t.dispose();
}
const tris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
console.log('vorher', Math.round(tris()), 'Dreiecke');
const steps = [prune(), dedup(), weld()];
if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004 }));
steps.push(resample(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await doc.transform(...steps);
console.log('nachher', Math.round(tris()), 'Dreiecke,', root.listTextures().length, 'Texturen,', root.listSkins().length, 'Skins,', root.listNodes().length, 'Knoten');
await io.write(output, doc);
