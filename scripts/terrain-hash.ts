// Prints the terrain hash of some worlds. Every JavaScript engine must print the same numbers:
//   node scripts/terrain-hash.ts            (V8)
//   bun scripts/terrain-hash.ts             (JavaScriptCore, the engine in Safari)
// The e2e tests make the same check in Chromium. See "Natural terrain" in docs/PLAN.md.
import { terrainHash, worldSeed } from '../packages/shared/src/index.ts';

const worlds = process.argv.length > 2 ? process.argv.slice(2) : ['golden', 'terra', 'vista'];
console.log(worlds.map((w) => `${w}=${terrainHash(worldSeed(w))}`).join(' '));
