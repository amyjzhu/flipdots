/**
 * Differential test: run identical inputs through the ORIGINAL hardware.ts and
 * the refactored hardware-refactored.ts, and assert the observable outputs are
 * byte-for-byte identical. This is the empirical complement to the static
 * change-by-change equivalence analysis.
 *
 * Only headless-reachable paths are exercised (no display sim needed):
 *   - rectangular adjacency (2D Moore neighbourhood)
 *   - indexToCoord / coordToIndex round-trips
 *   - RynxHardware reel walking + computeFlipDistance
 *   - FlipdotHardware.compileToFile — exercises the shared compile scaffold
 *     (validation + availability advancement + time-since-last-action) end to
 *     end as text output
 *   - the schedule* planning helpers
 */
import { expect, test } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import * as Orig from './hardware';
import * as Ref from './hardware-refactored';

// ── 2D adjacency: every id on a non-square grid ────────────────────────────────
test('rectangular adjacency matches on a non-square grid', () => {
    const reel = () => [new Orig.SplitflapState('a'), new Orig.SplitflapState('b')];
    const reelR = () => [new Ref.SplitflapState('a'), new Ref.SplitflapState('b')];

    const W = 5, H = 3;
    const o = Orig.SplitflapHardware.Headless(W, H, reel);
    const r = Ref.SplitflapHardware.Headless(W, H, reelR);

    for (let id = 0; id < W * H; id++) {
        expect(r.unitAdjacency(id)).toEqual(o.unitAdjacency(id));
    }
});

// ── indexToCoord + coordToIndex round-trips ────────────────────────────────────
test('indexToCoord and coordToIndex match (splitflap [x,y] convention)', () => {
    const W = 5, H = 3;
    const o = Orig.SplitflapHardware.Headless(W, H, () => [new Orig.SplitflapState('a')]);
    const r = Ref.SplitflapHardware.Headless(W, H, () => [new Ref.SplitflapState('a')]);

    for (let id = 0; id < W * H; id++) {
        expect(r.indexToCoord.get(id)).toEqual(o.indexToCoord.get(id));
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            expect(r.coordToIndex([x, y])).toBe(o.coordToIndex([x, y]));
        }
    }
});

// ── Rynx reel walking + computeFlipDistance ────────────────────────────────────
test('Rynx computeFlipDistance matches across the reel', () => {
    const o = Orig.RynxHardware.Headless(3);
    const r = Ref.RynxHardware.Headless(3);
    const oUnit = o.units[0] as Orig.RynxUnit;
    const rUnit = r.units[0] as Ref.RynxUnit;
    const oReel = oUnit.states[0][1];

    for (let k = 0; k < oReel.length; k++) {
        const target = oReel[k] as Orig.RynxState;
        const rTarget = new Ref.RynxState(target.id);
        expect(r.computeFlipDistance(rUnit, rTarget)).toBe(o.computeFlipDistance(oUnit, target));
    }
});

test('Rynx actionsToHardwareAction walks the reel identically', () => {
    const o = Orig.RynxHardware.Headless(2);
    const r = Ref.RynxHardware.Headless(2);

    for (let n = 0; n < 40; n++) {
        const [[oid, ostate]] = o.actionsToHardwareAction(Orig.Action.FLIP, [1], 0);
        const [[rid, rstate]] = r.actionsToHardwareAction(Ref.Action.FLIP, [1], 0);
        expect(rid).toBe(oid);
        expect(rstate.getId()).toBe(ostate.getId());
        expect((r.units[1] as Ref.RynxUnit).currentIndex)
            .toBe((o.units[1] as Orig.RynxUnit).currentIndex);
    }
});

// ── FlipdotHardware.compileToFile: the compile scaffold as observable text ──────
function compileToString(HardwareCtor: typeof Orig.FlipdotHardware | typeof Ref.FlipdotHardware,
                         gas: any[], tag: string): string {
    // square grid so the (intentional) i*width+j vs i*height+j fix is not a confound
    const hw = (HardwareCtor as any).Rectangular(4, 4);
    const file = path.join(os.tmpdir(), `flipdot-diff-${tag}.txt`);
    hw.compileToFile(gas, file);
    const out = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(file);
    return out;
}

test('FlipdotHardware.compileToFile produces identical output', () => {
    // A program with gaps (tests wait-time / time-since-last-action) and
    // multiple units per action (tests availability advancement).
    // NB: each group action must leave enough time for the previous flips to
    // finish (allowedNextActive locks every unit for 1 step after any flip), so
    // the tPlus values are spaced apart. A tighter program would legitimately
    // throw "could not compile" in BOTH implementations.
    const mk = (A: typeof Orig.Action | typeof Ref.Action, G: typeof Orig.GroupAction | typeof Ref.GroupAction) => ([
        new G(0, [[A.FLIP, [0, 1, 2]]]),
        new G(1, [[A.FLIP, [3, 4]]]),
        new G(3, [[A.FLIP, [0, 5]]]),
        new G(7, [[A.FLIP, [7, 8, 9]]]),
    ]);

    const oOut = compileToString(Orig.FlipdotHardware, mk(Orig.Action, Orig.GroupAction), 'orig');
    const rOut = compileToString(Ref.FlipdotHardware, mk(Ref.Action, Ref.GroupAction), 'ref');
    expect(rOut).toBe(oOut);
});

test('FlipdotHardware.compile throws identically on a timing violation', () => {
    // unit 0 flips at t=0 (locked until t=1) then again at t=0 → must fail in both
    const bad = (A: any, G: any) => [new G(0, [[A.FLIP, [0]]]), new G(0, [[A.FLIP, [0]]])];
    const o = Orig.FlipdotHardware.Rectangular(4, 4);
    const r = Ref.FlipdotHardware.Rectangular(4, 4);
    expect(() => o.compile(bad(Orig.Action, Orig.GroupAction) as any)).toThrow();
    expect(() => r.compile(bad(Ref.Action, Ref.GroupAction) as any)).toThrow();
});

// ── Scheduling helpers ─────────────────────────────────────────────────────────
function splitUnits(mod: typeof Orig | typeof Ref, ids: number[]) {
    const reel = 'ABCDEF'.split('').map(s => new mod.SplitflapState(s));
    return ids.map(id => new mod.SplitflapUnit(id, reel));
}
function targetsFor(mod: typeof Orig | typeof Ref, chars: string[]) {
    return chars.map(c => new mod.SplitflapState(c));
}

test('scheduleConstantSpeed / SyncEnd match', () => {
    const chars = ['C', 'A', 'E', 'B'];
    const ids = [0, 1, 2, 3];

    const oCS = Orig.scheduleConstantSpeed(splitUnits(Orig, ids), targetsFor(Orig, chars), 2);
    const rCS = Ref.scheduleConstantSpeed(splitUnits(Ref, ids), targetsFor(Ref, chars), 2);
    expect([...rCS.entries()]).toEqual([...oCS.entries()]);

    const oSE = Orig.scheduleSyncEnd(splitUnits(Orig, ids), targetsFor(Orig, chars), 2);
    const rSE = Ref.scheduleSyncEnd(splitUnits(Ref, ids), targetsFor(Ref, chars), 2);
    expect([...rSE.entries()]).toEqual([...oSE.entries()]);
});

test('scheduleDirectional matches for every direction', () => {
    const chars = ['C', 'A', 'E', 'B', 'F', 'D'];
    const ids = [0, 1, 2, 3, 4, 5];
    const oHw = Orig.SplitflapHardware.Headless(3, 2, () => targetsFor(Orig, 'ABCDEF'.split('')));
    const rHw = Ref.SplitflapHardware.Headless(3, 2, () => targetsFor(Ref, 'ABCDEF'.split('')));

    for (const dir of ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP']) {
        const o = Orig.scheduleDirectional(splitUnits(Orig, ids), targetsFor(Orig, chars), 2, oHw, dir);
        const r = Ref.scheduleDirectional(splitUnits(Ref, ids), targetsFor(Ref, chars), 2, rHw, dir);
        expect([...r.entries()]).toEqual([...o.entries()]);
    }
});

test('buildTimeline matches', () => {
    const sched = new Map<number, number[]>([[0, [0, 1, 2]], [1, [0, 2]], [3, [5]]]);
    const o = Orig.buildTimeline(sched, 10);
    const r = Ref.buildTimeline(sched, 10);
    expect(r.map(g => [g.tPlus, g.actions])).toEqual(o.map(g => [g.tPlus, g.actions]));
});
