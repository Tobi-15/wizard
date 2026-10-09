// Nachbearbeitung im Stil von Liar's Bar: Bloom für Lampen, Glut und Neon, dann Farbgebung
// (kühle Schatten, warme Lichter, mehr Kontrast), Vignette, Farbsäume am Rand und Filmkorn.
// Die eigenen Handkarten (Ebene HAND_LAYER) werden danach unverändert darübergezeichnet,
// damit sie scharf und lesbar bleiben.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const HAND_LAYER = 1;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    ego: { value: 0 },
    grain: { value: 0.045 },
    ca: { value: 0.0028 },
    res: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, ego, grain, ca; uniform vec2 res;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * ca * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Farbgebung: Schatten kühl-grünlich, Lichter warm
      col *= mix(vec3(0.9, 1.0, 1.05), vec3(1.05, 0.99, 0.9), smoothstep(0.05, 0.7, l));
      // Kontrast (weiche S-Kurve) und etwas mehr Sättigung
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.28);
      l = dot(col, vec3(0.299, 0.587, 0.114));
      col = max(mix(vec3(l), col, 1.08), 0.0);
      // Vignette (in der Ego-Perspektive stärker)
      float v = smoothstep(0.95, 0.25, length(d * vec2(1.05, 1.25)));
      col *= mix(1.0, v, 0.6 + 0.2 * ego);
      // Filmkorn, in dunklen Bereichen stärker
      float n = hash(vUv * res + fract(time * 7.13) * 311.0) - 0.5;
      col += n * grain * (1.1 - l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const dpr = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, {
    type: THREE.HalfFloatType,
    samples: dpr > 1.25 ? 2 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(dpr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.45, 1.7);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);

  const post = {
    composer,
    bloom,
    final,
    enabled: true,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      final.uniforms.res.value.set(w * pr, h * pr);
    },
    render(t) {
      final.uniforms.time.value = t;
      // 1. Szene ohne Handkarten mit allen Effekten
      camera.layers.set(0);
      composer.render();
      // 2. Handkarten direkt darüber (ohne Schatten neu zu berechnen)
      camera.layers.set(HAND_LAYER);
      const auto = renderer.autoClear;
      const shadows = renderer.shadowMap.autoUpdate;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      const bg = scene.background; // eine Hintergrundfarbe würde das Bild sonst löschen
      scene.background = null;
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(scene, camera);
      scene.background = bg;
      renderer.autoClear = auto;
      renderer.shadowMap.autoUpdate = shadows;
      camera.layers.set(0);
    },
  };
  post.setSize(innerWidth, innerHeight, dpr);
  return post;
}
