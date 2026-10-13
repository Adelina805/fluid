# Fluid

An interactive digital study of water, light, and motion.

**[Live project](https://fluid-three-theta.vercel.app/)** · **[Technical documentation (PROJECT.md)](PROJECT.md)**

![Fluid on desktop](src/images/current-desktop.png)

## Overview

Fluid is a full-screen, top-down view of water that you can touch. There are no goals, scores, or tasks; the surface responds to your pointer or finger, then gradually settles back to calm. The project explores whether a browser interaction can feel calming and tactile without asking the user to accomplish anything.

## Current implementation

- **GPU water simulation.** The surface is a low-resolution heightfield simulated on the GPU with a damped wave equation, stepped at a fixed 60 Hz using ping-pong half-float render targets. Because the water has persistent state, ripples propagate outward, interfere with each other and with the gentle idle motion, and decay naturally. An absorbing margin outside the visible area keeps waves from bouncing off the screen edges.
- **Custom GLSL shading.** A full-resolution shader derives normals from the simulated height and applies the palette, depth-based color, soft directional lighting, specular highlights, Fresnel, and subtle refractive distortion.
- **Procedural caustics.** A Worley-noise caustic network is computed partly at half resolution, bent and brightened by the simulated surface, and slowly drifts over time.
- **Interaction.** Moving the pointer leaves a wake whose strength follows speed; clicking or tapping drops a ripple. Works with mouse on desktop and single touch on mobile, with portrait-aware framing.
- **Controls.** A minimal panel, collapsed by default, opens from the corner icon or the `C` key. It offers **Calm ↔ Restless**, **Low light ↔ Bright**, and a **hex color** picker. Settings reset on every visit.
- **Runtime behavior.** Respects `prefers-reduced-motion`, pauses rendering when the tab is hidden, caps device pixel ratio at 2, and shows a static placeholder if WebGL2 half-float render targets are unavailable.

<p>
  <img src="src/images/current-mobile.png" alt="Fluid on a phone in portrait" width="240" />
  &nbsp;&nbsp;
  <img src="src/images/current-controls-panel.png" alt="Fluid controls panel" width="300" />
</p>

*Left: portrait layout on a phone. Right: the controls panel.*

**Built with:** Vite, Three.js, WebGL2, GLSL, and vanilla JavaScript.

## Running locally

Requires Node.js.

```bash
npm install
npm run dev       # start the Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```



## Development evolution

Fluid was built in visual phases against two reference photographs of pool water, then rebuilt around a GPU simulation once the original approach reached its limits.

### Reference water

![Reference A](src/images/water-1.jpg)

**Reference A (cooler)** — deep cerulean with navy troughs, sharp white caustic web, a faint ripple.

![Reference B](src/images/water-2.jpg)

**Reference B (brighter)** — turquoise/aqua, denser and softer caustic mesh.

### Phase 1 — Basic surface

![Phase 1](src/images/phase-1.png)

Layered sine-wave displacement with a flat blue/cyan gradient. Calm but reads like fabric.

### Phase 2 — Surface character

![Phase 2](src/images/phase-2.png)

Noise (FBM) breaks up the sine waves; procedural normals and height-based color make it more organic.

### Phase 3 — Lighting

![Phase 3](src/images/phase-3.png)

Directional light, dual-lobe specular, soft caustic-like streaks. Adds depth, but the surface still looks like soft gel.

### Phase 4 — Fresnel + optics

![Phase 4](src/images/phase-4.png)

Fresnel, reflective/translucent balance, subtle color distortion. A more glassy, liquid look.

### Phase 5 + 6 — Interaction + controls

![Phase 5](src/images/phase-5.png)

Pointer wakes and tap ripples, plus a first version of the Fluid control panel. Its early axes (calm/restless, glassy/turbulent, reflective/translucent, light, hex color) were later reduced to the three controls that ship today.

### Phase 6.5 — Caustic study

![Phase 6](src/images/phase-6.png)

Dedicated procedural caustic field (domain-warped Worley ridges) that gives the fine, branching light network seen in the references.

### Architectural pivot — GPU simulation

Phases 1–6.5 computed the water as a pure function of position and time: every frame was drawn from scratch, with nothing carried over. That made the look achievable but limited the feel. A touch could not leave a lasting trail, ripples could not travel or interact with one another, and the surface could not settle on its own. Pointer effects were also faint next to the idle waves, and the full-resolution caustics accounted for most of the GPU cost.

The water core was replaced rather than the whole project. Vite, Three.js, the top-down camera, the palette, the lighting ideas, and the control panel concept were kept. The stateless surface and analytic ripples gave way to a low-resolution GPU heightfield simulation, rendered through a full-resolution shading pass, with a cheaper caustic field driven by the simulated surface. The result is water that holds energy, spreads and interferes naturally, and returns to calm gradually, at a lower rendering cost than the original caustics.

![Pointer drags in the GPU simulation](src/images/e2-drags-desktop.png)

*Pointer drags during development of the simulation: each stroke leaves a wake that keeps spreading and fading after the pointer moves on, which the stateless version could not do.*

The legacy procedural version is still available at `?legacy` for comparison. See [PROJECT.md](PROJECT.md) for the full design notes, profiling, and decision log.