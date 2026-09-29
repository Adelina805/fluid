// Full-screen quad: a 2×2 plane already spans clip space, so no camera transform.
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
