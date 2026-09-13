import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BALANCE,
  SNAPSHOT_STRIDE,
  TOTAL_BLOCKS,
  TOWER,
  clamp,
  round,
  slotTransform,
  type TowerSnapshot,
} from '@topple/shared';

/**
 * Rapier is unhappy with objects a couple of centimetres across, and a real
 * Jenga block is 7.5cm long. Simulating ten times larger with ten times the
 * gravity is dimensionally identical - the same motion, at the same speed, in
 * numbers the solver likes. Snapshots divide it back out so the wire format
 * stays in metres.
 */
const SIM = 10;
const GRAVITY = -9.81 * SIM;

const BLOCK_L = TOWER.BLOCK_LENGTH * SIM;
const BLOCK_H = TOWER.BLOCK_HEIGHT * SIM;
const BLOCK_W = TOWER.BLOCK_WIDTH * SIM;

/** A block whose centre is this far off the tower axis has left the tower. */
const EXTRACTED_RADIUS = BLOCK_L * 0.85;
/** Top speed the grab can drag a block, so a pull cannot punch through. */
const GRAB_SPEED = BLOCK_L * 9;
const GRAB_STIFFNESS = 14;

/** Collapse thresholds, in block heights. */
const COLLAPSE_HEIGHT_DROP = 1.25;
const COLLAPSE_SETTLED_DROP = 0.7;
const COLLAPSE_SETTLED_COUNT = 2;

export interface TowerReport {
  blocks: number;
  collapsed: boolean;
  snapshot: TowerSnapshot;
  pullsLeft: number;
}

export interface TowerOptions {
  canvas: HTMLCanvasElement;
  color: string;
  /** Live transforms for the TV mirror, already throttled. */
  onStream(snapshot: TowerSnapshot): void;
  /** One pull resolved, or the tower fell. */
  onResolve(report: TowerReport): void;
  onStatus(text: string): void;
  haptic(pattern: number[]): void;
}

interface Block {
  id: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  /** Height before the current pull, used to judge a collapse. */
  restY: number;
}

type Phase = 'idle' | 'pulling' | 'settling' | 'done';

/**
 * The per-player Jenga tower, simulated on the phone that owns it.
 *
 * Running this on the phone rather than the host is the core architectural
 * bet of the game: eight independent 27-body simulations would be the single
 * most expensive thing on the TV, and every one of them is a private, tactile
 * thing that belongs in the player's hands anyway. The host only ever sees
 * transforms and a verdict.
 */
export class JengaTower {
  private api: typeof RAPIER | null = null;
  private world: RAPIER.World | null = null;
  private readonly blocks: Block[] = [];
  private readonly byCollider = new Map<number, Block>();

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly dragPlane = new THREE.Plane();
  private readonly dragPoint = new THREE.Vector3();

  private phase: Phase = 'idle';
  private pullsLeft = 0;
  private grabbed: Block | null = null;
  private grabPointer: number | null = null;
  private orbitPointer: number | null = null;
  private orbitLast = { x: 0, y: 0 };
  private yaw = 0.6;
  private pitch = 0.32;
  private distance = BLOCK_L * 6.2;
  private settleTimer = 0;
  private heightBeforePull = 0;
  private streamAccumulator = 0;
  private raf = 0;
  private lastFrameAt = 0;
  private accumulator = 0;
  private disposed = false;

  constructor(private readonly options: TowerOptions) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  }

  async init(snapshot?: TowerSnapshot): Promise<void> {
    const module = await import('@dimforge/rapier3d-compat');
    await module.default.init();
    if (this.disposed) return;
    this.api = module.default;

    this.world = new this.api.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = 1 / BALANCE.TICK_HZ;

    this.buildScene();
    this.buildGround();
    if (snapshot && snapshot.length >= SNAPSHOT_STRIDE) this.restore(snapshot);
    else this.buildFresh();

    this.attachPointerHandlers();
    this.lastFrameAt = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Opens the tower for `pulls` extractions. */
  begin(pulls: number): void {
    this.pullsLeft = pulls;
    this.phase = 'pulling';
    this.options.onStatus(this.pullPrompt());
  }

  get blockCount(): number {
    return this.blocks.length;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachPointerHandlers();
    this.world?.free();
    this.world = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.blocks.length = 0;
    this.byCollider.clear();
  }

  /* ---------------------------------------------------------------- *
   * Construction
   * ---------------------------------------------------------------- */

  private buildScene(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.options.canvas,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x0b1020);
    this.scene.fog = new THREE.Fog(0x0b1020, this.distance * 1.6, this.distance * 4);

    const hemi = new THREE.HemisphereLight(0xc8dcff, 0x241f38, 1.1);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff0d4, 2.2);
    key.position.set(BLOCK_L * 2, BLOCK_L * 5, BLOCK_L * 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = BLOCK_L * 14;
    const shadowBox = key.shadow.camera;
    shadowBox.left = -BLOCK_L * 2.4;
    shadowBox.right = BLOCK_L * 2.4;
    shadowBox.top = BLOCK_L * 3.4;
    shadowBox.bottom = -BLOCK_L * 0.6;
    shadowBox.updateProjectionMatrix();
    this.scene.add(key);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private buildGround(): void {
    const api = this.requireApi();
    const world = this.requireWorld();

    const body = world.createRigidBody(api.RigidBodyDesc.fixed().setTranslation(0, -BLOCK_H, 0));
    world.createCollider(
      api.ColliderDesc.cuboid(BLOCK_L * 4, BLOCK_H, BLOCK_L * 4).setFriction(0.95).setRestitution(0.02),
      body,
    );

    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(BLOCK_L * 2.4, BLOCK_L * 2.4, BLOCK_H * 0.6, 40),
      new THREE.MeshStandardMaterial({ color: 0x18233f, roughness: 0.98 }),
    );
    table.position.y = -BLOCK_H * 0.3;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private blockMaterial(id: number): THREE.MeshStandardMaterial {
    const tint = new THREE.Color(this.options.color);
    const hsl = { h: 0, s: 0, l: 0 };
    tint.getHSL(hsl);
    // Alternating shades make the courses readable when the tower twists.
    const lightness = clamp(hsl.l * 0.6 + (id % 2 === 0 ? 0.34 : 0.27), 0, 1);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hsl.h, clamp(hsl.s * 0.55, 0, 1), lightness),
      roughness: 0.72,
      metalness: 0.02,
    });
  }

  private spawnBlock(id: number, position: THREE.Vector3Like, rotation: THREE.QuaternionLike): Block {
    const api = this.requireApi();
    const world = this.requireWorld();

    const body = world.createRigidBody(
      api.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(rotation)
        .setLinearDamping(0.22)
        .setAngularDamping(0.42),
    );
    const collider = world.createCollider(
      api.ColliderDesc.cuboid(BLOCK_L / 2, BLOCK_H / 2, BLOCK_W / 2)
        .setDensity(1.4)
        .setFriction(0.74)
        .setRestitution(0.02),
      body,
    );

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_L, BLOCK_H, BLOCK_W), this.blockMaterial(id));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const block: Block = { id, body, collider, mesh, restY: position.y };
    this.blocks.push(block);
    this.byCollider.set(collider.handle, block);
    return block;
  }

  private buildFresh(): void {
    const axis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < TOTAL_BLOCKS; i++) {
      const slot = slotTransform(i);
      quaternion.setFromAxisAngle(axis, slot.rotated ? Math.PI / 2 : 0);
      this.spawnBlock(i, { x: slot.x * SIM, y: slot.y * SIM, z: slot.z * SIM }, quaternion);
    }
  }

  private restore(snapshot: TowerSnapshot): void {
    const count = Math.floor(snapshot.length / SNAPSHOT_STRIDE);
    for (let i = 0; i < count; i++) {
      const offset = i * SNAPSHOT_STRIDE;
      this.spawnBlock(
        snapshot[offset] ?? i,
        {
          x: (snapshot[offset + 1] ?? 0) * SIM,
          y: (snapshot[offset + 2] ?? 0) * SIM,
          z: (snapshot[offset + 3] ?? 0) * SIM,
        },
        {
          x: snapshot[offset + 4] ?? 0,
          y: snapshot[offset + 5] ?? 0,
          z: snapshot[offset + 6] ?? 0,
          w: snapshot[offset + 7] ?? 1,
        },
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * Simulation
   * ---------------------------------------------------------------- */

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);

    const elapsed = Math.min((now - this.lastFrameAt) / 1000, 0.2);
    this.lastFrameAt = now;

    const step = 1 / BALANCE.TICK_HZ;
    this.accumulator += elapsed;
    let steps = 0;
    while (this.accumulator >= step && steps < 4) {
      this.simulate(step);
      this.accumulator -= step;
      steps++;
    }
    if (this.accumulator > step * 4) this.accumulator = 0;

    this.syncMeshes();
    this.updateCamera();
    this.renderer?.render(this.scene, this.camera);

    this.streamAccumulator += elapsed;
    const streamInterval = 1 / BALANCE.TOWER_STREAM_HZ;
    if (this.phase !== 'idle' && this.streamAccumulator >= streamInterval) {
      this.streamAccumulator = 0;
      this.options.onStream(this.snapshot());
    }
  };

  private simulate(dt: number): void {
    const world = this.requireWorld();

    if (this.grabbed) this.driveGrab();
    world.step();

    if (this.phase !== 'settling') return;
    this.settleTimer -= dt;
    if (this.settleTimer <= 0) this.judge();
  }

  /**
   * Velocity control rather than teleporting: the grabbed block still collides
   * with its neighbours, so a careless pull drags the course with it.
   */
  private driveGrab(): void {
    const block = this.grabbed;
    if (!block) return;
    const at = block.body.translation();
    const dx = this.dragPoint.x - at.x;
    const dy = this.dragPoint.y - at.y;
    const dz = this.dragPoint.z - at.z;

    const vx = clamp(dx * GRAB_STIFFNESS, -GRAB_SPEED, GRAB_SPEED);
    const vy = clamp(dy * GRAB_STIFFNESS, -GRAB_SPEED, GRAB_SPEED);
    const vz = clamp(dz * GRAB_STIFFNESS, -GRAB_SPEED, GRAB_SPEED);
    block.body.setLinvel({ x: vx, y: vy, z: vz }, true);

    // Bleed spin so the block does not windmill out of the player's control.
    const spin = block.body.angvel();
    block.body.setAngvel({ x: spin.x * 0.55, y: spin.y * 0.55, z: spin.z * 0.55 }, true);
  }

  private syncMeshes(): void {
    for (const block of this.blocks) {
      const t = block.body.translation();
      const r = block.body.rotation();
      block.mesh.position.set(t.x, t.y, t.z);
      block.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  private updateCamera(): void {
    const height = this.towerHeight();
    const focus = Math.max(height * 0.55, BLOCK_H * 3);
    const radius = this.distance;
    this.camera.position.set(
      Math.sin(this.yaw) * Math.cos(this.pitch) * radius,
      focus + Math.sin(this.pitch) * radius,
      Math.cos(this.yaw) * Math.cos(this.pitch) * radius,
    );
    this.camera.lookAt(0, focus, 0);
  }

  private towerHeight(): number {
    let top = 0;
    for (const block of this.blocks) top = Math.max(top, block.body.translation().y);
    return top;
  }

  /* ---------------------------------------------------------------- *
   * Pull lifecycle
   * ---------------------------------------------------------------- */

  private extract(block: Block): void {
    const world = this.requireWorld();
    this.byCollider.delete(block.collider.handle);
    world.removeRigidBody(block.body);
    this.scene.remove(block.mesh);
    block.mesh.geometry.dispose();
    const index = this.blocks.indexOf(block);
    if (index >= 0) this.blocks.splice(index, 1);

    this.pullsLeft = Math.max(0, this.pullsLeft - 1);
    this.phase = 'settling';
    this.settleTimer = BALANCE.SETTLE_SECONDS;
    this.options.haptic([30, 40, 30]);
    this.options.onStatus('Hold your breath...');
  }

  /** Decides whether the tower survived, then reports upstream. */
  private judge(): void {
    const height = this.towerHeight();
    const dropped = this.blocks.filter(
      (block) => block.restY - block.body.translation().y > BLOCK_H * COLLAPSE_SETTLED_DROP,
    ).length;

    const collapsed =
      this.heightBeforePull - height > BLOCK_H * COLLAPSE_HEIGHT_DROP ||
      dropped >= COLLAPSE_SETTLED_COUNT ||
      this.blocks.length === 0;

    if (collapsed) {
      this.phase = 'done';
      this.options.haptic([90, 60, 90, 60, 160]);
      this.options.onStatus('Your tower came down.');
      this.options.onResolve({
        blocks: this.blocks.length,
        collapsed: true,
        snapshot: this.snapshot(),
        pullsLeft: 0,
      });
      return;
    }

    // Survived: this settled position becomes the new baseline.
    for (const block of this.blocks) block.restY = block.body.translation().y;

    this.options.onResolve({
      blocks: this.blocks.length,
      collapsed: false,
      snapshot: this.snapshot(),
      pullsLeft: this.pullsLeft,
    });

    if (this.pullsLeft > 0) {
      this.phase = 'pulling';
      this.options.onStatus(this.pullPrompt());
    } else {
      this.phase = 'done';
      this.options.onStatus('Still standing. ' + this.blocks.length + ' blocks left.');
    }
  }

  private pullPrompt(): string {
    return this.pullsLeft > 1
      ? 'Pull ' + this.pullsLeft + ' blocks. Drag one out.'
      : 'Pull one block. Drag it out.';
  }

  /** Packed transforms in shared units. Rounded: 4dp is sub-millimetre here. */
  snapshot(): TowerSnapshot {
    const out: TowerSnapshot = [];
    for (const block of this.blocks) {
      const t = block.body.translation();
      const r = block.body.rotation();
      out.push(
        block.id,
        round(t.x / SIM, 4),
        round(t.y / SIM, 4),
        round(t.z / SIM, 4),
        round(r.x, 3),
        round(r.y, 3),
        round(r.z, 3),
        round(r.w, 3),
      );
    }
    return out;
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private attachPointerHandlers(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private detachPointerHandlers(): void {
    const canvas = this.options.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.resize);
  }

  private setPointer(event: PointerEvent): void {
    const bounds = this.options.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.options.canvas.setPointerCapture(event.pointerId);
    this.setPointer(event);

    // A touch that lands on a block grabs it; anything else orbits the camera.
    const block = this.phase === 'pulling' ? this.pick() : null;
    if (block && this.grabPointer === null) {
      this.grabPointer = event.pointerId;
      this.grabbed = block;
      this.heightBeforePull = this.towerHeight();
      // Drag happens on the horizontal plane through the block, which is how
      // a block actually comes out of a Jenga tower.
      const at = block.body.translation();
      this.dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(at.x, at.y, at.z));
      this.updateDragPoint();
      this.options.haptic([12]);
      return;
    }

    if (this.orbitPointer === null) {
      this.orbitPointer = event.pointerId;
      this.orbitLast = { x: event.clientX, y: event.clientY };
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.grabPointer) {
      this.setPointer(event);
      this.updateDragPoint();
      return;
    }
    if (event.pointerId !== this.orbitPointer) return;

    const dx = event.clientX - this.orbitLast.x;
    const dy = event.clientY - this.orbitLast.y;
    this.orbitLast = { x: event.clientX, y: event.clientY };
    this.yaw -= dx * 0.008;
    this.pitch = clamp(this.pitch + dy * 0.005, -0.12, 1.15);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.orbitPointer) this.orbitPointer = null;
    if (event.pointerId !== this.grabPointer) return;

    this.grabPointer = null;
    const block = this.grabbed;
    this.grabbed = null;
    if (!block) return;

    const at = block.body.translation();
    if (Math.hypot(at.x, at.z) > EXTRACTED_RADIUS) {
      this.extract(block);
    } else {
      // Put it back down gently and let the tower settle without spending a pull.
      block.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.options.onStatus('Not out yet - drag it clear of the tower.');
    }
  };

  private updateDragPoint(): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint);
    if (!hit) return;
    // Stop a wild drag from flinging the block to the horizon.
    const limit = BLOCK_L * 3;
    this.dragPoint.x = clamp(this.dragPoint.x, -limit, limit);
    this.dragPoint.z = clamp(this.dragPoint.z, -limit, limit);
  }

  private pick(): Block | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.blocks.map((block) => block.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    const first = hits[0];
    if (!first) return null;
    return this.blocks.find((block) => block.mesh === first.object) ?? null;
  }

  private readonly resize = (): void => {
    const canvas = this.options.canvas;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    this.renderer?.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private requireApi(): typeof RAPIER {
    if (!this.api) throw new Error('tower physics not initialised');
    return this.api;
  }

  private requireWorld(): RAPIER.World {
    if (!this.world) throw new Error('tower world not initialised');
    return this.world;
  }
}
