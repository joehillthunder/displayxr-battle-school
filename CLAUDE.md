# Battle School 3D

A browser game inspired by Ender's Game, in three modes: the Battle Room (zero-g first person), Ender's console (the fleet battle as a hologram above the simulator table) and In the War (fly a fighter in the same battle; `Tab` switches between the cockpit and the console). It is glasses-free 3D in the DisplayXR Browser on a Leia panel, and 2D in any other browser.

Live at https://joehillthunder.github.io/displayxr-battle-school/. GitHub Pages serves the `main` branch root (`.nojekyll`, no Actions workflow: the `gh` token has no `workflow` scope). Pushing to `main` deploys.

## Stack

- Plain ES modules with no build step and no package.json. three.js `0.161.0` and `@displayxr/inline3d` `1.45.1` load from jsDelivr through the import map in `index.html`. Keep versions pinned.
- There is no Node or Python on the demo PC. Serve locally with a PowerShell `HttpListener` script (quote the `-File` and `-Root` paths, or it returns 404s; port 8791 is taken).

## Files

| File | What it does |
| --- | --- |
| `js/main.js` | App shell: menu, HUD (`hud.*`), mode switching (`app.go(mode, level)`, `app.menu()`), Quality and Depth controls, the attract-mode battle behind the menu. Exposes `window.battleSchool` for tests. |
| `js/stage.js` | One persistent canvas. Camera rig with the attach pattern; each mode sets `stage.focusDist` (the convergence target). Renders every eye through `post.js`. Logs `[battleschool]` lines (firstWoven, frames, wovenState). |
| `js/post.js` | Per-eye HDR composer: MSAA, then a NaN/Inf sanitize pass, bloom and OutputPass. `QUALITY` presets: ultra, high, low. |
| `js/battleroom.js` | Battle Room: glass sphere of radius 22 m, zero-g physics, flash-gun hit tests, AI soldiers. `ROOM_BATTLES` defines the levels. |
| `js/fleet.js` | Fleet simulation in battle units: squadrons, formic clusters, the Little Doctor chain reaction, instanced hull and glow meshes, trails, lasers, shockwaves. `FLEET_LEVELS` defines the levels. |
| `js/campaign.js` | Command room and space scenery; console orders (right-click: move or attack); cockpit flight and guns; end and reveal screens. |
| `js/space.js` | Procedural Earth and formic-world textures, nebula sky, sun, fresnel `atmosphere()`, PMREM environment maps. |
| `js/fx.js` | Spark particles: a pooled point shader with a clamped size. |
| `js/input.js`, `js/audio.js`, `js/util.js` | Keyboard and mouse with pointer lock; synthesized sound effects; math helpers. |

URL options: `?mode=room|console|war&level=<n>`, `?mono` (force 2D), `?depth=0-2`, `?quality=ultra|high|low`.

## Rules and gotchas

- **Keep the clear colour black and `scene.background` null.** The composer would convert a non-black clear twice (grey haze). Use sky meshes for colour.
- **Never let a shader emit NaN.** Bloom smears one NaN pixel into large black screen blocks. Clamp before `pow()` (see the `atmosphere()` fresnel term). The sanitize pass tests exponent bits with `floatBitsToUint` because ANGLE's D3D compiler can optimise `isnan()` away. Keep that pass.
- **Bloom works off brightness above 1.** Make something glow with an HDR colour (`hdr(color, k)` with k > 1), not by turning up bloom. The user wants it bright but not blown out: the exposure is 1.1 and bloom thresholds are about 0.85-0.92.
- **Each mode sets `cam.near` and `cam.far` itself** when it enters. A far plane left over from another mode once clipped the Battle Room walls.
- **Nothing close to the eyes.** There is no first-person gun model: something that close to the eyes has far too much depth on the panel.
- `Fleet.root` is in battle units. `campaign.js` parents it under `holoRoot` (scaled 1/430 above the table) or under `space` at full size. In hologram mode the ships draw at `shipScale` 3.2.
- Formic hulls carry the Little Doctor chain on to other ships; a human fighter caught by it is lost but doesn't pass it on. Keep that, or the MD wipes out your own fleet.
- All game text is original. Don't paste text from the novel or the film.

## Checking changes

1. **Headless screenshots:** Chrome `--headless=new --use-angle=d3d11 --enable-unsafe-swiftshader --virtual-time-budget=10000 --enable-logging=stderr --screenshot=...` on `?mono&mode=...`. Read the log for `CONSOLE` errors.
2. **Gameplay over CDP:** headless Chrome with `--remote-debugging-port`, then `Runtime.evaluate` against `window.battleSchool`:
   - Step `campaign.fleet.update(1/30)` with scripted orders and the MD. Levels 1-3 should be winnable with guns or the MD; the final level only with the MD.
   - Drive `app.input` (`down`, `buttons`) through `stage.onTick` to confirm that shooting freezes or kills enemies.
   - Don't eval `location.reload()`: it hangs the socket.
3. **Real 3D on the panel:** `C:\Program Files\DisplayXR\Browser\chrome.exe --user-data-dir=<scratch> --enable-logging --v=0 --start-fullscreen <url>`, then grep `<user-data-dir>\chrome_debug.log` for `[battleschool]`. Expect `wovenState=woven`, with monoFrames only at startup. The panel runs at 30 fps; Ultra holds it. Don't add `--remote-debugging-port` to the DisplayXR Browser: it exits.

## Related

The DisplayXR HQ homepage (`joehillthunder/joehillthunder.github.io`) has a `battle-school` room in its Arcade wing (`home/demos.js` plus a set piece in `home/office.js`). Update its card if the game's description changes.
