# Battle School 3D

A 3D browser game inspired by Orson Scott Card's novel *Ender's Game*. In the DisplayXR Browser on a Leia display it is glasses-free 3D; in any other browser it plays in 2D.

**Play:** https://joehillthunder.github.io/displayxr-battle-school/

## Three ways to play

| Mode | You are | What you do |
| --- | --- | --- |
| **The Battle Room** | Dragon Army's commander, first person | Zero-g battles in a 40 m cube. Push off the stars, freeze the enemy with your flash gun, and reach their gate (it opens once half their army is frozen). Three battles: Salamander, Rattlesnake, then Griffin and Tiger at once. |
| **Ender's Console** | Ender at the simulator | The fleet battle is a hologram above the table. Select a squadron (Bean, Petra, Alai, Dink, Crazy Tom, Hot Soup), right-click to move or attack, and fire the Little Doctor into a packed swarm. Four simulations, ending with the Final Examination. |
| **In the War** | A fighter pilot in the same battles | Fly the lead fighter of a squadron while your wingmen follow orders. Press `Tab` any time to switch between the cockpit and the console. |

### Controls

- **Battle Room:** click to capture the mouse and aim · hold `Space` (or right mouse) to charge a push-off, then release · click or `F` fires · `Q`/`E` roll
- **Console:** `1`-`6` select a squadron · right-click a formic to attack it, or empty space to move there · `R`/`F` raise or lower the move point · `D` Little Doctor · `G` all squadrons attack · drag to walk round the table · wheel to zoom
- **Cockpit:** mouse steers · `W`/`S` throttle · `Shift` boost · `A`/`D` roll · click or `Space` fire · `D` fires the Little Doctor at what's ahead · `Tab` back to the console

URL options: `?mode=room|console|war&level=<n>` skips the menu, `?mono` forces 2D, `?depth=0-2` sets the depth.

## How it's built

Plain ES modules with no build step. three.js 0.161 and `@displayxr/inline3d` 1.45.1 load from jsDelivr.

- `js/stage.js`: one persistent canvas with a DisplayXR camera rig (attach pattern). Each mode sets the convergence distance: the star ahead of you, the fighter you're chasing, or the table.
- `js/battleroom.js`: zero-g physics, flash-gun hit tests, AI soldiers.
- `js/fleet.js`: the fleet simulation (squadrons, formic swarms, Little Doctor chain reactions) drawn with instanced meshes. The same simulation draws as a hologram or as full-size ships in space.
- `js/campaign.js`: the command room, the console orders and the cockpit flight.

This is a fan-made tribute. It isn't affiliated with or endorsed by the author or the publisher, and all of the game's text is original.
