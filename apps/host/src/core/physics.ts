import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GEOMETRY, material, type GeometryKind } from './materials.js';

export type RapierApi = typeof RAPIER;

let rapier: RapierApi | null = null;

/** Call once at boot. The wasm is fetched and compiled exactly one time. */
export async function initPhysics(): Promise<RapierApi> {
  if (rapier) return rapier;
  const module = await import('@dimforge/rapier3d-compat');
  await module.default.init();
  rapier = module.default;
  return rapier;
}

export function R(): RapierApi {
  if (!rapier) throw new Error('initPhysics() has not finished');
  return rapier;
}

export type BodyKind = 'dynamic' | 'fixed' | 'kinematic';

export type Shape =
  | { kind: 'box'; hx: number; hy: number; hz: number }
  | { kind: 'ball'; r: number }
  | { kind: 'cylinder'; r: number; hh: number };

export interface SpawnOptions {
  shape: Shape;
  kind?: BodyKind;
  position?: THREE.Vector3Like;
  rotation?: THREE.QuaternionLike;
  color?: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  opacity?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  linearDamping?: number;
  angularDamping?: number;
  /** Continuous collision detection. Worth it for fast small objects only. */
  ccd?: boolean;
  sensor?: boolean;
  /** Locks rotation to keep upright pawns upright without a joint. */
  lockRotation?: boolean;
  /** Set false for invisible geometry such as arena bounds. */
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Free-form tag so collision handlers can identify what they hit. */
  tag?: string;
  /**
   * Use this object instead of a generated primitive. Pawns are built from a
   * dozen small parts, so they arrive here as a finished group and still get
   * free interpolation from `sync()`.
   */
  mesh?: THREE.Object3D;
}

/**
 * A rigid body and its mesh, with the previous transform kept so rendering can
 * interpolate between fixed steps instead of stuttering at non-60Hz refresh.
 */
export class Entity {
  readonly prevPosition = new THREE.Vector3();
  readonly prevQuaternion = new THREE.Quaternion();
  readonly currPosition = new THREE.Vector3();
  readonly currQuaternion = new THREE.Quaternion();
  dead = false;

  constructor(
    readonly body: RAPIER.RigidBody,
    readonly collider: RAPIER.Collider,
    readonly mesh: THREE.Object3D | null,
    readonly tag: string,
  ) {
    this.readBack();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
  }

  readBack(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.currPosition.set(t.x, t.y, t.z);
    this.currQuaternion.set(r.x, r.y, r.z, r.w);
  }

  get position(): THREE.Vector3 {
    return this.currPosition;
  }

  setPosition(x: number, y: number, z: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.readBack();
    this.prevPosition.copy(this.currPosition);
  }

  setLinvel(x: number, y: number, z: number): void {
    this.body.setLinvel({ x, y, z }, true);
  }

  get linvel(): RAPIER.Vector {
    return this.body.linvel();
  }

  impulse(x: number, y: number, z: number): void {
    this.body.applyImpulse({ x, y, z }, true);
  }

  force(x: number, y: number, z: number): void {
    this.body.addForce({ x, y, z }, true);
  }
}

export interface WorldOptions {
  gravity?: number;
  /** Enable if a minigame needs begin/end contact callbacks. */
  events?: boolean;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly entities: Entity[] = [];
  readonly root = new THREE.Group();
  private readonly queue: RAPIER.EventQueue | null;
  private readonly byHandle = new Map<number, Entity>();
  private onContact: ((a: Entity, b: Entity, started: boolean) => void) | null = null;

  constructor(options: WorldOptions = {}) {
    const api = R();
    this.world = new api.World({ x: 0, y: options.gravity ?? -19.6, z: 0 });
    this.world.timestep = 1 / 60;
    this.queue = options.events ? new api.EventQueue(true) : null;
    this.root.name = 'physics';
  }

  /** Gravity is doubled from real-world by default: party physics reads snappier. */
  spawn(options: SpawnOptions): Entity {
    const api = R();
    const kind = options.kind ?? 'dynamic';
    const desc =
      kind === 'dynamic'
        ? api.RigidBodyDesc.dynamic()
        : kind === 'fixed'
          ? api.RigidBodyDesc.fixed()
          : api.RigidBodyDesc.kinematicPositionBased();

    const p = options.position ?? { x: 0, y: 0, z: 0 };
    desc.setTranslation(p.x, p.y, p.z);
    if (options.rotation) desc.setRotation(options.rotation);
    if (options.linearDamping !== undefined) desc.setLinearDamping(options.linearDamping);
    if (options.angularDamping !== undefined) desc.setAngularDamping(options.angularDamping);
    if (options.ccd) desc.setCcdEnabled(true);
    if (options.lockRotation) desc.lockRotations();

    const body = this.world.createRigidBody(desc);
    const colliderDesc = describeCollider(api, options.shape);
    if (options.density !== undefined) colliderDesc.setDensity(options.density);
    colliderDesc.setFriction(options.friction ?? 0.7);
    colliderDesc.setRestitution(options.restitution ?? 0.15);
    if (options.sensor) colliderDesc.setSensor(true);
    if (this.queue) colliderDesc.setActiveEvents(api.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);

    const mesh = options.visible === false ? null : (options.mesh ?? buildMesh(options));
    if (mesh) this.root.add(mesh);

    const entity = new Entity(body, collider, mesh, options.tag ?? '');
    this.entities.push(entity);
    this.byHandle.set(collider.handle, entity);
    return entity;
  }

  remove(entity: Entity): void {
    if (entity.dead) return;
    entity.dead = true;
    this.byHandle.delete(entity.collider.handle);
    if (entity.mesh) {
      this.root.remove(entity.mesh);
    }
    this.world.removeRigidBody(entity.body);
    const index = this.entities.indexOf(entity);
    if (index >= 0) this.entities.splice(index, 1);
  }

  contacts(handler: (a: Entity, b: Entity, started: boolean) => void): void {
    this.onContact = handler;
  }

  step(): void {
    for (const entity of this.entities) {
      entity.prevPosition.copy(entity.currPosition);
      entity.prevQuaternion.copy(entity.currQuaternion);
    }
    this.world.step(this.queue ?? undefined);
    for (const entity of this.entities) entity.readBack();

    if (this.queue && this.onContact) {
      this.queue.drainCollisionEvents((h1, h2, started) => {
        const a = this.byHandle.get(h1);
        const b = this.byHandle.get(h2);
        if (a && b) this.onContact?.(a, b, started);
      });
    }
  }

  /** `alpha` is the fraction of a step we are into the next one, 0..1. */
  sync(alpha: number): void {
    for (const entity of this.entities) {
      const mesh = entity.mesh;
      if (!mesh) continue;
      mesh.position.lerpVectors(entity.prevPosition, entity.currPosition, alpha);
      mesh.quaternion.slerpQuaternions(entity.prevQuaternion, entity.currQuaternion, alpha);
    }
  }

  dispose(): void {
    for (const entity of this.entities.slice()) this.remove(entity);
    this.queue?.free();
    this.world.free();
    this.root.removeFromParent();
  }
}

function describeCollider(api: RapierApi, shape: Shape): RAPIER.ColliderDesc {
  switch (shape.kind) {
    case 'box':
      return api.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
    case 'ball':
      return api.ColliderDesc.ball(shape.r);
    case 'cylinder':
      return api.ColliderDesc.cylinder(shape.hh, shape.r);
  }
}

function buildMesh(options: SpawnOptions): THREE.Object3D {
  const kind: GeometryKind =
    options.shape.kind === 'box' ? 'box' : options.shape.kind === 'ball' ? 'ball' : 'cylinder';
  const mesh = new THREE.Mesh(
    GEOMETRY[kind],
    material(options.color ?? 0x8aa0c8, {
      emissive: options.emissive,
      emissiveIntensity: options.emissiveIntensity,
      opacity: options.opacity,
    }),
  );
  const shape = options.shape;
  if (shape.kind === 'box') mesh.scale.set(shape.hx * 2, shape.hy * 2, shape.hz * 2);
  else if (shape.kind === 'ball') mesh.scale.setScalar(shape.r * 2);
  else mesh.scale.set(shape.r * 2, shape.hh * 2, shape.r * 2);
  mesh.castShadow = options.castShadow ?? (options.kind ?? 'dynamic') === 'dynamic';
  mesh.receiveShadow = options.receiveShadow ?? true;
  return mesh;
}
