# Fluid

**INTERACTIVE WATER STUDY**

*a digital study of water, light, and motion*

---

## Concept

Fluid is a full-screen browser experience that treats water as both subject and interface. It is a calm, tactile study of light and motion—not a simulator, game, or conventional web app. The user is invited to touch, tune, and linger; there is nothing to complete.

Code is used here as a visual and interactive medium. Quality of feeling matters more than technical completeness.

---

## Core Question

> Can a browser interaction feel calming without asking the user to accomplish anything?

---

## Product Principles

1. **Water is the interface** — The surface fills the screen; UI stays secondary and intentional.
2. **Calm over spectacle** — Prefer gentle presence over dramatic effects.
3. **Interaction without objectives** — Response is sensory, never task-driven.
4. **Visual quality over feature quantity** — One beautiful surface beats many incomplete techniques.
5. **Subtlety over simulation complexity** — Believable feel first; physical accuracy only if it serves feeling.
6. **Responsive but not hyperactive** — Motion answers the user, then settles; never frantic.
7. **Performance is part of the experience** — Stutter breaks calm; frame stability is aesthetic.
8. **Controls should feel sensory, not technical** — Human-readable language; no raw shader jargon in production UI.

---

## Visual Direction

### Reference image observations

Two primary references (shallow pool water, top-down, no environment):

- **Shared:** Full-frame water; cyan/blue/turquoise range; luminous caustic networks; soft rippling distortion; glassy highlights; no horizon, skybox, floor tiles, foam, or scenery.
- **Reference A (cooler):** Deeper cerulean with navy troughs; sharper white caustic web; clear specular glints; faint concentric ripple suggesting localized disturbance.
- **Reference B (brighter):** Turquoise / aqua luminosity; denser, slightly softer caustic mesh; same edge-to-edge abstract composition.

**Default lean:** cooler deep blue (Reference A), while keeping overall mood a balanced blend—not extremely dark and not extremely turquoise.

### Style blend (binding)

- **Realistic light behavior**, but **artistic and stylized** overall—not photo-real ocean rendering.
- Caustics: **start softer**; introduce **sharper caustic webs** in a later visual phase once the surface is stable.
- Lighting: **crisp caustic behavior** combined with otherwise **soft lighting**.

### Color direction

- Base palette: cool blues / deep cyan with luminous white highlights.
- Public control: **warm ↔ cool** plus a **full hex-code color picker** (not presets-only).
- Subtle chromatic variation is desirable; avoid tropical beach clichés.

### Lighting

- Soft ambient fill + directional contribution for form.
- Specular / glassy highlights where the surface catches light.
- Caustic-like luminous streaks as a defining character trait (soft first, sharper later).

### Surface behavior

- Gently alive idle motion (soft overlapping ripples).
- Organic, non-repeating patterns—avoid flag/fabric wave look.
- Infinite, edge-to-edge field; no pool walls or world edges.

### Camera angle

- **Strict top-down.**
- Prefer orthographic (or equivalent top-down framing) so the surface reads as a continuous plane.
- Water fills the viewport completely.

### Caustics

- Essential to the look; secondary to calm motion early on.
- Progression: soft luminous hints → sharper web-like structure when approved.
- Should feel pool-like, not disco or noisy.

### Reflectivity / translucency

- Glassy regions and view-angle–dependent brightness.
- Public axis: **reflective ↔ translucent**.
- No environment map of scenery; reflections stay abstract / self-contained.

### Distortion

- Soft refractive / liquid-glass distortion of subsurface light patterns.
- Gentle, not warping or nauseating.

### What to avoid

- Hyper-realistic ocean simulation
- Horizons, skyboxes, environment scenery
- Foam, boats, rocks, tropical beach aesthetics
- Heavy UI chrome / “tech demo” styling
- Rapid flashing or intense motion
- Feature creep disguised as visual polish

---

## UX Principles

- **Full-screen experience** — Canvas is the page; water is primary.
- **No onboarding** — No “touch the water” hint; discovery is natural.
- **Minimal UI** — Controls hidden/collapsed by default; revealed via small corner icon and keyboard shortcut.
- **Discoverable interactions** — Subtle proximity response + stronger move/click/tap response.
- **Idle state** — Gently alive baseline; after interaction, return to calm gradually and organically (**no obvious fixed timer**).
- **Pointer behavior** — Proximity influence; velocity strengthens disturbance; click/tap ripple; hold behavior **undecided** (do not lock in).
- **Touch behavior** — **Single-touch only for MVP**; gestures should feel natural; portrait composition adapted carefully (not naive crop).
- **Reduced motion** — Honor `prefers-reduced-motion` as a default hint, but **let the user choose** the reduced-motion behavior rather than forcing a single policy.
- **Keyboard** — Opens and tunes controls only; **no keyboard-triggered ripple**.
- **Mobile expectations** — Graceful visual downgrade; same calm intent; single touch; portrait-aware framing.
- **Settings persistence** — Controls **reset every visit**; do **not** persist to `localStorage`.
- **Browser title** — `Fluid`
- **Audio** — Future possibility only; **not MVP**.

---

## MVP Scope

### MVP (deliberately small)

- Full-screen WebGL water surface (Vite + Three.js + custom GLSL)
- Strict top-down, edge-to-edge infinite feel
- Custom vertex + fragment shaders with slow procedural motion
- Believable soft lighting and highlights; soft caustic-like luminosity (sharp caustics later)
- Cooler deep-blue default palette with balanced mood
- Simple pointer influence (proximity + velocity)
- Click / tap ripple
- Idle calming that feels organic (no hard countdown UX)
- Public tunable parameters (human-readable):
  - calm ↔ restless
  - glassy ↔ turbulent
  - warm ↔ cool
  - reflective ↔ translucent
  - light
  - full hex-code color selection
- Custom minimal control panel (corner icon + keyboard shortcut); reset on each visit
- Responsive desktop / mobile canvas with portrait-aware composition
- User-selectable reduced-motion behavior
- Desktop-first quality; graceful mobile downgrade; drop expensive effects before falling below ~30fps on mid-range mobile
- Pause rendering when tab is hidden
- Static Vercel deployment

### Nice-to-have

- Sharper, web-like caustics closer to references
- Hold-to-disturb (once behavior is decided)
- Soft fade-in / polished control transitions
- Social preview image / richer metadata
- Low-power explicit fallback mode beyond automatic downgrades
- Subtle chromatic aberration or optical nuance (only if calm is preserved)

### Future experiments

- Audio (ambient / water-responsive)
- Multi-touch influence
- Splash-like moments (evaluate by feel)
- GPGPU / ping-pong heightfield simulation (only if simple math ripples fail to feel right)
- Additional sensory macro controls
- Persistence of settings (explicitly out of current product decision)

---

## Technical Architecture

### Stack (confirmed)

| Layer | Choice | Notes |
|-------|--------|--------|
| Build | Vite | Static site; fast HMR; Vercel-friendly |
| Runtime | Vanilla JavaScript | No React unless a clear need appears later |
| Renderer | Three.js `WebGLRenderer` | Scene, camera, resize, animation loop |
| Material | `ShaderMaterial` + custom GLSL | Vertex + fragment as separate modules |
| Dev controls | Tweakpane (temporary) | Swap for custom minimal UI before production polish |
| Deploy | Vercel | Static Vite output only |

**Avoid unless scope changes:** backend, serverless functions, databases, auth, external APIs, heavy postprocessing stacks, physics engines.

### Suggested project structure

```text
fluid/
  PROJECT.md
  index.html
  package.json
  vite.config.js
  public/
    favicon.svg
    og-image.png          # later (Phase 10)
  src/
    main.js               # bootstrap
    app/
      createApp.js        # scene / camera / renderer / loop
      resize.js
      visibility.js       # pause when tab hidden
    render/
      createWaterMesh.js  # plane + ShaderMaterial wiring
      camera.js           # top-down setup
    shaders/
      water.vert.glsl
      water.frag.glsl
    interaction/
      pointer.js          # proximity, velocity, click/tap
      idleCalm.js         # organic return toward calm
    controls/
      devGui.js           # Tweakpane (dev phases)
      panel.js            # custom production panel
      params.js           # centralized tunable state
    style.css
```

Preserve clear separation: **app setup · rendering · shaders · interactions · controls**.

### Three.js scene

- One full-screen (or oversized) plane; water is the only subject.
- Strict top-down camera; framing keeps the surface edge-to-edge at all aspect ratios.
- Portrait: adapt plane scale / camera framing carefully so composition still feels like continuous water (not a cropped desktop shot).

### Geometry

- `PlaneGeometry` with modest segment count—enough for vertex displacement, not excessive.
- Prefer fragment-driven detail (normals, caustics, color) over huge meshes.

### Shaders & uniforms

- Vertex: displacement / wave contribution.
- Fragment: color, lighting, Fresnel-like terms, distortion, caustic-like highlights.
- Uniforms clearly named and documented; experimental values centralized in `params.js` (or equivalent).

### Animation loop

- `requestAnimationFrame` via Three.js or thin wrapper.
- Pass time, pointer state, and params into uniforms each frame.
- Pause when `document.visibilityState === 'hidden'`.

### Pointer input

- Normalized device / UV-space coordinates.
- Track position, velocity, down/up for click-tap ripples.
- Single-touch path on mobile for MVP.
- Hold behavior left open in code design (pluggable, not committed).

### Responsive resize

- Update renderer size, camera, and any aspect-dependent uniforms.
- Cap `devicePixelRatio` (e.g. 1.5–2 on desktop; lower on mobile as needed).

### Performance strategy

- Target **60fps** where practical; accept **30–60fps** on mobile.
- Desktop visual quality first; **drop expensive effects** before sustained sub-30fps on mid mobile.
- Adaptive pixel ratio; visibility pause; avoid oversized geometry and unjustified textures/postprocessing.

### Control panel architecture

- **Development:** Tweakpane bound to centralized params.
- **Production:** Custom minimal panel; same params object; corner icon + keyboard shortcut; no `localStorage`.

### Vercel deployment

- Standard Vite static build (`vite build` → `dist`).
- No server-side architecture.

---

## Shader Strategy

Progress incrementally. **Do not attempt all steps at once.**

1. Simple sine-wave displacement  
2. Layered wave functions / careful noise  
3. Procedural normals  
4. Height-based color  
5. View-angle calculations  
6. Directional light  
7. Specular highlights  
8. Fresnel  
9. Refraction / distortion  
10. Soft caustic-like highlights → later sharper caustic webs  

Each roadmap phase maps to a subset of this ladder. Prefer readable shader code over clever abstractions.

---

## Interaction Strategy

**Start simple (mathematical / CPU-side influence into uniforms):**

- Pointer coordinate influence (including subtle proximity)
- Fake mathematical ripple on click/tap
- Velocity-based disturbance strength
- Organic idle calming (continuous easing toward baseline—not a visible timer)

**Only consider later if simple approach cannot achieve the desired feel:**

- Framebuffer simulation  
- Ping-pong FBO  
- `GPUComputationRenderer` / GPGPU heightfields  

Hold behavior remains an **open question**; do not implement a locked hold model until decided.

---

## Controls Strategy

### Development

- Temporary **Tweakpane** (or equivalent) for rapid tuning.
- May expose more parameters than production.

### Production (binding)

| Control | Intent |
|---------|--------|
| calm ↔ restless | Overall motion energy |
| glassy ↔ turbulent | Surface character / roughness of motion |
| warm ↔ cool | Temperature shift of palette |
| reflective ↔ translucent | Optical balance |
| light | Illumination intensity / presence |
| hex color | Full color input/picker (base water hue) |

- Small, unobtrusive, collapsed by default  
- Reveal: **corner icon + keyboard shortcut**  
- Labels human-readable; no raw shader variable names  
- **Reset every visit** (no persistence)  
- Visually secondary to the water  

---

## Performance Budget

- Smooth **60fps** target on typical desktop  
- Acceptable **30–60fps** on mobile; prefer dropping effects over prolonged sub-30fps on mid-range devices  
- Adaptive / capped `devicePixelRatio`  
- Pause rendering when tab is hidden  
- Avoid oversized geometry  
- Avoid unnecessary postprocessing  
- No huge textures unless justified  
- Lazy-load anything nonessential  
- Low-power / reduced-effect fallback path as needed for mobile gracefulness  

---

## Accessibility

- Respect `prefers-reduced-motion` as an initial signal, but **allow the user to choose** reduced-motion behavior in the UI  
- Keyboard access for opening and operating controls  
- Readable control labels  
- Sufficient contrast on UI chrome (water itself may be low-contrast by nature)  
- No essential experience path that requires pointer-only **for controls**; water play may remain pointer/touch-primary  
- Avoid rapid flashing / intense motion  
- Provide a way to reduce motion intensity (via calm control and/or reduced-motion choice)  
- No keyboard-triggered ripple required  

---

## Development Roadmap

Highly incremental. **Never implement multiple phases without approval.**  
At the start of every coding session: **read this file first.**  
After each phase: summarize changes, explain important shader math in plain English, list what to evaluate manually, and ask whether to tune or proceed.

### PHASE 0 — Setup

**Goal:** Project foundation only.

**Tasks:** Vite, Three.js, basic canvas, resize handling, scene/camera/renderer, plain test plane, Vercel sanity deploy.

**Exit criteria:** Empty Three.js scene renders; responsive canvas works; deployment works; **no water visuals yet**.

**STOP** — ask for approval.

### PHASE 1 — Basic Water Surface

**Goal:** First visual water study.

**Tasks:** Plane + custom `ShaderMaterial`; simple vertex displacement; 2–3 layered sine waves; slow movement; basic blue/cyan gradient (cooler deep-blue lean).

**Exit criteria:** Water-like calm motion; no pointer interaction; no Fresnel / refraction / caustics / controls.

**STOP** — ask for visual feedback.

### PHASE 2 — Surface Character

**Goal:** More organic surface.

**Tasks:** Layered procedural motion; careful noise; improved procedural normals; height-based color; tune scale/frequency.

**Exit criteria:** No longer flag/fabric-like; begins to resemble references; still calm.

**STOP** — ask for visual feedback.

### PHASE 3 — Lighting

**Goal:** Light defines the surface.

**Tasks:** Directional lighting; specular highlights; view-dependent brightness; **soft** caustic-like streaks if feasible (sharp webs later).

**Exit criteria:** Luminous depth; pool-inspired highlights without noise.

**STOP** — ask for visual feedback.

### PHASE 4 — Fresnel + Optical Effects

**Goal:** Liquid / glass character.

**Tasks:** Fresnel; reflective ↔ translucent balance groundwork; subtle refraction/distortion; color depth adjustments.

**Exit criteria:** More liquid/glassy; believable view-angle behavior; no expensive effects without justification.

**STOP** — ask for visual feedback.

### PHASE 5 — Pointer Interaction

**Goal:** Water responds to the user (simple math first).

**Tasks:** Normalized pointer coords; proximity influence; velocity detection; click/tap ripple; organic idle calming. **Do not lock hold behavior.**

**Exit criteria:** Organic, subtle response; not game-like; single-touch mobile works.

**STOP** — ask for interaction feedback.

### PHASE 6 — Controls

**Goal:** Tunable experience.

**Tasks:** Dev controls first for motion, optical, light, color axes; then custom minimal UI with the binding public set (including hex color); corner icon + keyboard shortcut; no persistence.

**Exit criteria:** Only useful public parameters; human-readable labels; UI does not overpower water.

**STOP** — ask for UX feedback.

### PHASE 7 — Calm / Idle Behavior

**Goal:** Inactivity is part of the experience.

**Tasks:** Detect idle in a soft way; gradually reduce disturbance; return toward calm baseline organically; refine calm ↔ restless as macro if needed.

**STOP** — ask for feedback.

### PHASE 8 — Mobile + Accessibility

**Tasks:** Touch tuning; user-selectable reduced motion; keyboard control access; viewport / portrait framing; DPR strategy; orientation testing; mobile effect downgrades.

**STOP** — ask for approval.

### PHASE 9 — Performance

**Tasks:** Measure frame/GPU cost; optimize geometry/shader work; adaptive DPR; visibility pause; test integrated GPU / mobile; **report findings before cutting visual quality**.

**STOP** — report findings.

### PHASE 10 — Polish

**Tasks:** Soft fade-in; control transitions; favicon/title/metadata (`Fluid`); loading only if needed; screenshot / social preview; final responsive pass; production Vercel deploy.

**Optional later (post-MVP):** sharper caustics; hold behavior; audio experiments.

---

## Development Rules

1. Never implement multiple roadmap phases without asking.  
2. At the beginning of every coding session, read `PROJECT.md` first.  
3. Before coding, state: current phase, goal, files expected to modify.  
4. Smallest possible implementation for that phase.  
5. Do not “improve” unrelated parts.  
6. Do not add dependencies without explaining why.  
7. Do not silently change visual direction.  
8. After each phase: summarize; plain-English shader notes; evaluation checklist; ask tune vs proceed.  
9. If complexity spikes, stop and explain tradeoffs.  
10. Prefer understandable shader code over clever abstractions.  
11. Keep shader uniforms clearly named and documented.  
12. Keep experimental values centralized for easy tuning.  
13. Preserve separation: rendering · shaders · interactions · controls · app setup.  

---

## Version Control

- Git is initialized in this repository.  
- **The project owner manages all commits.**  
- Do **not** suggest commit messages or automate commits unless explicitly asked.

---

## Deployment

- Target: **Vercel**  
- Normal static Vite deployment  
- No backend, serverless, database, auth, or external APIs unless scope is explicitly changed later  

---

## Decision Log

| Date | Decision |
|------|----------|
| 2026-09-19 | Stack: Vite, Three.js, WebGLRenderer, custom GLSL, vanilla JS, Vercel. No React by default. |
| 2026-09-19 | Visual blend: realistic light behavior, artistic/stylized overall. Soft caustics first; sharper later. |
| 2026-09-19 | Default palette leans cooler deep blue; overall mood balanced (not extreme dark or turquoise). |
| 2026-09-19 | Camera: strict top-down; infinite edge-to-edge water. |
| 2026-09-19 | Lighting: crisp caustic character + otherwise soft lighting. |
| 2026-09-19 | Idle: gently alive; return to calm gradual/organic, no obvious fixed timer. |
| 2026-09-19 | Interaction: proximity + stronger move/click; hold undecided; no hard exclusions yet. |
| 2026-09-19 | Controls: corner icon + keyboard; public set includes hex color picker; reset every visit; custom minimal production UI. |
| 2026-09-19 | Mobile: portrait-aware composition; single-touch MVP; no discovery hint. |
| 2026-09-19 | a11y: user chooses reduced-motion behavior; keyboard for controls only (no ripple). |
| 2026-09-19 | Performance: desktop-first with mobile grace; drop effects before sustained &lt;~30fps mid mobile; 60fps target where practical. |
| 2026-09-19 | Title: `Fluid`. Audio future-only. Owner manages Git; no unsolicited commit automation. |
| 2026-09-19 | Dev GUI: Tweakpane acceptable temporarily. |
| 2026-09-19 | Phase 0 complete: Vite + Three.js foundation, top-down orthographic camera, plain test plane, resize + visibility pause, local production build verified. Live Vercel deploy left for the project owner to run. |
| 2026-09-20 | Phase 2 complete: compact 2D value-noise FBM modulates sine phase/frequency + tiny height; finite-difference procedural normals; three-stop cool height/slope color. No lighting, caustics, interaction, or geometry density change. |
| 2026-09-20 | Phase 3 complete: Blinn-Phong directional lighting on Phase 2 normals; soft diffuse + pale-cyan specular; subtle top-down view lift; soft slope/NdotL caustic-like streaks. No Fresnel, refraction, reflection maps, pointer, or postprocessing. |
| 2026-09-20 | Phase 3 lighting refinement: dual-lobe specular (soft + narrow); streak variation from normal tilt align/cross + existing height/noise gates; slightly stronger directional contrast; soft caustic hints less parallel. Phase 2 displacement unchanged. |
| 2026-09-20 | **Phase 3 approved.** Directional lighting, specular response, luminous depth, and view-dependent surface definition are established. Remaining soft blue-gel quality is treated as **structural** (broad Phase 2 forms → broad lit ridges), not a lighting-strength problem. **Do not** endlessly sharpen or increase specular to chase the gel away. Preserve calm motion and the current organic foundation. Future phases should pursue missing water optics via Fresnel, reflectivity/translucency, refraction/distortion, and eventually more convincing caustic structure. |
| 2026-09-20 | **Surface frequency vs reference optics (pre–Phase 4 review):** Phase 2 is intentionally mid-to-broad (wave freqs ~5.5–21.5; noise scales ~0.58 / 1.55 / 3.6; 2-octave FBM; fine height muted). That supports calm organic motion and Phase 4 Fresnel / reflective–translucent / soft refraction well enough. It is **unlikely** to alone support the finer interconnected caustic webs in the references without a later dedicated high-frequency optical / caustic field and/or a controlled Phase 2 fine-scale normal refinement. **Flag only — do not rewrite Phase 2 surface now.** |
| 2026-09-20 | Phase 4 implemented: Schlick Fresnel on Phase 2 normals; internal `uOpticalBalance` reflective↔translucent blend; normal-tied analytic color distortion (no RTT); optical color depth. Phase 3 `viewLift` removed. No env maps, multipass refraction, pointer, controls, or camera change. Awaiting visual approval. |
| 2026-09-20 | Phase 4 diagnostic/tuning: initial Fresnel was visually flat (~0.025 everywhere) because top-down N·V≈0.96–1.0 makes `(1−N·V)^3.2` ≈ 0. Added `uFresnelViewContrast` to expand that band before Schlick; raised distortion / color-depth separation; slightly reduced Phase 3 specular + soft streaks so optics can read. Internal `uDebugOptics` (0–4) for isolation; default 0. Still awaiting visual approval. |
| 2026-09-20 | Phase 4 balancing pass: reduced Fresnel strength/contrast, pale sheen mix, and highlight contribution after overcorrection (too bright / frosted cyan). Restored mid/deep blue body under glass; `paleMask` gates near-white to stronger Fresnel only. Distortion left at 0.30. No Phase 2 surface changes. Still awaiting visual approval. |

---

## Open Questions

- **Hold behavior** — deeper sustained ripple, local calm, or something else? Defer until after Phase 5 feedback.  
- **Keyboard shortcut** for controls — exact key (e.g. `C` / `?` / `,`) not chosen yet.  
- **Corner icon** placement and visual design (which corner, mark vs wordmark).  
- **Reduced-motion user choices** — exact options (e.g. still frame / slow drift / no wakes) to be designed in Phase 8.  
- **Sharper caustics** — when after soft caustics are approved (likely post–Phase 3 or as a polish experiment).  
- **Surface fine-scale / caustic frequency** — whether to add a dedicated high-frequency optical field and/or lightly refine Phase 2 fine normals later (flagged 2026-09-20; do not rewrite Phase 2 before Phase 4).  
- **Orthographic vs perspective** top-down implementation detail (both can read as strict top-down; choose in Phase 0/1 for simplest framing).  
- Whether any **splash**, **multi-touch**, or **audio** experiments earn a place after MVP feel tests.  
- Exact **DPR caps** and mobile effect ladder (decide with Phase 8–9 measurements).  

---

## Non-Goals

- Physically perfect water simulation  
- Ocean simulation  
- Complex environment / skybox / scenery  
- Game mechanics or objectives  
- Unnecessary UI  
- Excessive realism for its own sake  
- Feature creep  
- Persisted settings (unless explicitly revised)  
- Audio in MVP  
- React or heavy frameworks without a clear reason  
- Backend or serverless architecture  

---

## Final Reminder

This is a visual experiment, not a feature checklist.

The goal is not every possible water technique.  
The goal is a water surface that feels **beautiful, calming, tactile, and intentional**.

**Quality > complexity.**
