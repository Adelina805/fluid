import { Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

/**
 * Phase 0 placeholder: a plain full-field plane (no water shaders yet).
 * Color is a cool deep blue so the canvas reads as intentional, not broken.
 */
export function createTestPlane() {
  const geometry = new PlaneGeometry(2, 2, 1, 1);
  const material = new MeshBasicMaterial({
    color: 0x0367A6,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'testPlane';
  return mesh;
}
