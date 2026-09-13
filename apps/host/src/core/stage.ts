import * as THREE from 'three';
import { damp } from '@topple/shared';

/**
 * Owns the renderer, the camera rig and the permanent lighting. Scenes add and
 * remove their own groups; nothing here is ever rebuilt between rounds.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;

  private readonly desiredPosition = new THREE.Vector3(0, 14, 18);
  private readonly desiredTarget = new THREE.Vector3(0, 0, 0);
  private readonly currentTarget = new THREE.Vector3(0, 0, 0);
  private readonly shake = new THREE.Vector3();
  private shakeAmount = 0;
  private follow = 6;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Capping DPR at 2 costs nothing visible on a TV and saves ~40% fill on 4K.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(0x0b1020);
    this.scene.fog = new THREE.Fog(0x0b1020, 40, 110);

    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.1, 400);
    this.camera.position.copy(this.desiredPosition);

    const hemi = new THREE.HemisphereLight(0xbcd6ff, 0x2a2340, 1.15);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.1);
    this.sun.position.set(9, 18, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 70;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    const box = this.sun.shadow.camera;
    box.left = -22;
    box.right = 22;
    box.top = 22;
    box.bottom = -22;
    box.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);

    const rim = new THREE.DirectionalLight(0x6ba8ff, 0.55);
    rim.position.set(-10, 8, -12);
    this.scene.add(rim);

    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /** Move the camera. `snap` teleports instead of easing - use on scene entry. */
  look(position: THREE.Vector3Like, target: THREE.Vector3Like, snap = false, follow = 6): void {
    this.desiredPosition.set(position.x, position.y, position.z);
    this.desiredTarget.set(target.x, target.y, target.z);
    this.follow = follow;
    if (snap) {
      this.camera.position.copy(this.desiredPosition);
      this.currentTarget.copy(this.desiredTarget);
      this.camera.lookAt(this.currentTarget);
    }
  }

  punch(amount = 0.35): void {
    this.shakeAmount = Math.min(1.2, this.shakeAmount + amount);
  }

  frame(dt: number): void {
    this.camera.position.x = damp(this.camera.position.x, this.desiredPosition.x, this.follow, dt);
    this.camera.position.y = damp(this.camera.position.y, this.desiredPosition.y, this.follow, dt);
    this.camera.position.z = damp(this.camera.position.z, this.desiredPosition.z, this.follow, dt);
    this.currentTarget.x = damp(this.currentTarget.x, this.desiredTarget.x, this.follow, dt);
    this.currentTarget.y = damp(this.currentTarget.y, this.desiredTarget.y, this.follow, dt);
    this.currentTarget.z = damp(this.currentTarget.z, this.desiredTarget.z, this.follow, dt);

    if (this.shakeAmount > 0.001) {
      this.shakeAmount = damp(this.shakeAmount, 0, 7, dt);
      this.shake.set(
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
        (Math.random() - 0.5) * this.shakeAmount,
      );
      this.camera.position.add(this.shake);
    }

    this.camera.lookAt(this.currentTarget);
    this.sun.target.position.copy(this.currentTarget);
    this.sun.target.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };
}
