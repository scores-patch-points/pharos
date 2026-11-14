// world.mjs (STUB): the three synthetic slices and the engine factory, shared by selftest.mjs and the run.mjs smoke test.
import { genSlice } from './gen-log.mjs';
import { openStub } from '../engines/stub-engine.mjs';

export const slices = {
  L0: genSlice({ seed: 20261113, nClips: 14, nLeases: 6, nStmts: 5, nGizmo: 4 }),
  L1: genSlice({ seed: 20261114, nClips: 36, nLeases: 12, nStmts: 10, nGizmo: 6 }),
  L2: genSlice({ seed: 20261115, nClips: 54, nLeases: 16, nStmts: 14, nGizmo: 8 }),
};
export const makeEngine = (slice, features) => openStub({ entries: slices[slice], features });
