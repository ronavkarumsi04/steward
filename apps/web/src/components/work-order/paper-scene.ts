import {
  ACESFilmicToneMapping, BoxGeometry, CircleGeometry, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera,
  PCFSoftShadowMap, PlaneGeometry, Scene, ShadowMaterial, SRGBColorSpace,
  WebGLRenderer, type BufferGeometry, type Material, type Texture,
} from "three";
import { storyPoses } from "@/lib/landing-story";
import { paperTexture, type PaperKind } from "./paper-texture";

export type PaperScene = {
  render: (progress: number, pointer: { x: number; y: number }) => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

/** A complete self-hosted scene. Only its caller schedules frames; there is no animation loop. */
export function createPaperScene(canvas: HTMLCanvasElement): PaperScene {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.debug.onShaderError = () => { throw new Error("Paper shader could not compile"); };
  const scene = new Scene();
  const camera = new OrthographicCamera(-2.5, 2.5, 3, -3, .1, 30);
  camera.position.set(0, 0, 10);
  const assembly = new Group();
  scene.add(assembly);
  const resources = new Set<BufferGeometry | Material | Texture>();
  const own = <T extends BufferGeometry | Material | Texture>(value: T): T => { resources.add(value); return value; };
  let disposed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastRatio = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const resource of resources) resource.dispose();
    scene.clear();
    renderer.dispose();
  };

  try {
    scene.add(new HemisphereLight(0xfffcf2, 0xc5c6cf, 2.4));
    const key = new DirectionalLight(0xfffcf5, 3.1);
    key.position.set(-1.5, 2.5, 12);
    key.castShadow = true;
    const shadowSize = window.innerWidth < 700 ? 512 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = key.shadow.camera.bottom = -4;
    key.shadow.camera.right = key.shadow.camera.top = 4;
    key.shadow.camera.near = .1;
    key.shadow.camera.far = 20;
    key.shadow.normalBias = .018;
    key.shadow.bias = -.0001;
    scene.add(key);
    const fill = new DirectionalLight(0xdce2ff, .6);
    fill.position.set(4, -1, 3);
    scene.add(fill);

    const backdrop = new Mesh(own(new PlaneGeometry(20, 20)), own(new ShadowMaterial({ opacity: .055 })));
    backdrop.position.z = -2.65;
    backdrop.receiveShadow = true;
    scene.add(backdrop);

    const style = getComputedStyle(canvas);
    const quiet = document.documentElement.dataset.publicDesign === "quiet";
    const token = (name: string) => style.getPropertyValue(name).trim();
    const fonts = {
      editorial: style.getPropertyValue("--font-editorial").trim() || "Georgia, serif",
      mono: style.getPropertyValue("--font-mono").trim() || "monospace",
    };
    const blue = own(new MeshStandardMaterial({ color: quiet ? token("--accent") : 0x2b3990, roughness: .8 }));
    const hole = own(new MeshBasicMaterial({ color: quiet ? token("--bg") : 0xebe7dc }));
    const barGeometry = own(new BoxGeometry(2.06, .13, .028));
    const holeGeometry = own(new CircleGeometry(.018, 12));
    const kinds: PaperKind[] = ["work", "approval", "record"];
    const sheets = kinds.map((kind) => {
      const group = new Group();
      assembly.add(group);
      const geometry = own(new BoxGeometry(2.06, 2.9, .016, 12, 18, 1));
      const original = Float32Array.from(geometry.attributes.position!.array);
      const stockColor = quiet ? token(kind === "work" ? "--panel" : kind === "approval" ? "--accent-soft" : "--panel-3") : kind === "work" ? 0xfbfaf5 : kind === "approval" ? 0xf3e48f : 0xf2c4cc;
      const texture = own(paperTexture(kind, fonts, quiet ? { stock: String(stockColor), ink: token("--fg") } : undefined));
      const front = own(new MeshStandardMaterial({ map: texture, roughness: .96, metalness: 0 }));
      const stock = own(new MeshStandardMaterial({ color: stockColor, roughness: .96 }));
      const body = new Mesh(geometry, [stock, stock, stock, stock, front, stock]);
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      const binding = new Mesh(barGeometry, blue);
      binding.position.set(0, 1.375, .022);
      binding.castShadow = true;
      group.add(binding);
      for (let i = 0; i < 17; i++) {
        const perforation = new Mesh(holeGeometry, hole);
        perforation.position.set(-.93 + i * .116, 1.258, .01);
        group.add(perforation);
      }
      return { group, geometry, original };
    });

    return {
      resize(width, height) {
        const ratio = Math.min(window.devicePixelRatio || 1, width < 500 ? 1.5 : 2);
        if (!width || !height || (width === lastWidth && height === lastHeight && ratio === lastRatio)) return;
        lastWidth = width;
        lastHeight = height;
        lastRatio = ratio;
        renderer.setPixelRatio(ratio);
        renderer.setSize(width, height, false);
        const aspect = width / height;
        const halfHeight = Math.max(4.5, 4.05 / aspect) / 2;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.left = -halfHeight * aspect;
        camera.right = halfHeight * aspect;
        camera.updateProjectionMatrix();
      },
      render(progress, pointer) {
        if (disposed) return;
        assembly.rotation.set(pointer.y * .045, pointer.x * .065, 0);
        storyPoses(progress).forEach((pose, index) => {
          const sheet = sheets[index]!;
          sheet.group.position.set(pose.position.x, pose.position.y, pose.position.z);
          sheet.group.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
          const position = sheet.geometry.attributes.position!;
          for (let i = 0; i < position.count; i++) {
            const x = sheet.original[i * 3]!;
            const y = sheet.original[i * 3 + 1]!;
            position.setZ(i, sheet.original[i * 3 + 2]! + pose.curl * (x / 2.06 + .5) ** 2 * (.5 - y / 2.9) ** 2);
          }
          position.needsUpdate = true;
          sheet.geometry.computeVertexNormals();
        });
        renderer.render(scene, camera);
        // Exposed only as diagnostics for manual/performance QA, never product state.
        canvas.dataset.renderedProgress = progress.toFixed(4);
      },
      dispose() {
        key.shadow.dispose();
        dispose();
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
