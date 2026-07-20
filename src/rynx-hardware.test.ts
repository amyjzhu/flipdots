import { expect, test } from 'vitest';
import { Action, GroupAction, RynxHardware, RynxUnit, rynxReel, rynxStateFor } from './hardware';
import { deBruijn, textToColumns, SEGMENTS_PER_WHEEL, WINDOW_ROWS } from './rynx';
import { FlipConstantSpeed, FlipDirectional, FlipSyncEnd, FlipSyncLastFlipTogether, Transition } from './transitions';
import { LeftToRight } from './order';
import { PixelArtTarget } from './language2';

const BLANK_COL = '0'.repeat(WINDOW_ROWS);

// 1-row grid of 5-bit window strings, matching what the eval feeds the transitions
function rynxTarget(text: string, numWheels: number): { target: PixelArtTarget; columns: string[] } {
    const cols = textToColumns(text);
    const pad = Math.max(0, Math.floor((numWheels - cols.length) / 2));
    const row = Array.from({ length: numWheels }, (_, i) => {
        const col = cols[i - pad];
        return col ? col.join('') : BLANK_COL;
    });
    return { target: new PixelArtTarget([row], BLANK_COL), columns: row };
}

// total FLIP events scheduled for each unit across all group actions
function flipCounts(actions: GroupAction[], numWheels: number): number[] {
    const counts = new Array(numWheels).fill(0);
    for (const ga of actions)
        for (const [action, ids] of ga.actions)
            if (action === Action.FLIP)
                for (const id of ids) counts[id]++;
    return counts;
}

// Each of the four flip transitions should land every wheel on its target
// column: starting from home (state 0), N steps show reel state N % 32, which
// must equal the target's 5-bit string for that wheel.
test.each<[string, () => Transition]>([
    ['FlipConstantSpeed',          () => new FlipConstantSpeed()],
    ['FlipDirectional',            () => new FlipDirectional(new LeftToRight())],
    ['FlipSyncEnd',                () => new FlipSyncEnd()],
    ['FlipSyncLastFlipTogether',   () => new FlipSyncLastFlipTogether()],
])('%s drives Rynx to the target columns', (_name, make) => {
    const numWheels = 24;
    const hw = RynxHardware.Headless(numWheels);
    const { target, columns } = rynxTarget('RYNX!', numWheels);
    const blank = new PixelArtTarget([Array(numWheels).fill(BLANK_COL)], BLANK_COL);

    const actions = make().generateGroupActions(blank, target, 1, hw);
    expect(actions.length).toBeGreaterThan(0);

    const reel = (hw.units[0] as RynxUnit).states[0][1];
    const counts = flipCounts(actions, numWheels);
    for (let i = 0; i < numWheels; i++) {
        expect(reel[counts[i] % SEGMENTS_PER_WHEEL].getId()).toBe(columns[i]);
    }
});

test('reel states are the windows of the wheel pattern', () => {
    const pattern = deBruijn(2, WINDOW_ROWS);
    const reel = rynxReel(pattern);

    expect(reel.length).toBe(SEGMENTS_PER_WHEEL);
    // state k reads the 5 segments starting at k, top row first
    expect(reel[0].id).toBe(pattern.slice(0, WINDOW_ROWS).join(''));
    // wraps around the end of the wheel
    expect(reel[30].id).toBe(
        [pattern[30], pattern[31], pattern[0], pattern[1], pattern[2]].join(''));
    // de Bruijn: every 5-bit window appears exactly once
    expect(new Set(reel.map(s => s.id)).size).toBe(SEGMENTS_PER_WHEEL);
});

test('computeFlipDistance is the forward distance around the reel', () => {
    const hw = RynxHardware.Headless(3);
    const unit = hw.units[0] as RynxUnit;
    const reel = unit.states[0][1];

    expect(hw.computeFlipDistance(unit, rynxStateFor([0, 0, 0, 0, 0]))).toBe(0);
    expect(hw.computeFlipDistance(unit, reel[5] as never)).toBe(5);

    // from index 5, an earlier state is reached by wrapping forward
    unit.currentIndex = 5;
    expect(hw.computeFlipDistance(unit, reel[2] as never)).toBe(SEGMENTS_PER_WHEEL - 3);
});

test('every text column is a reachable state', () => {
    const hw = RynxHardware.Headless(1);
    const unit = hw.units[0] as RynxUnit;
    for (const column of textToColumns('RYNX! 09:87')) {
        expect(() => hw.computeFlipDistance(unit, rynxStateFor(column))).not.toThrow();
    }
});

test('actionsToHardwareAction walks the reel and tracks state', () => {
    const hw = RynxHardware.Headless(2);
    const unit = hw.units[1] as RynxUnit;
    const reel = unit.states[0][1];

    const [[id, state]] = hw.actionsToHardwareAction(0 /* FLIP */, [1], 0);
    expect(id).toBe(1);
    expect(state.getId()).toBe(reel[1].getId());
    expect(unit.currentIndex).toBe(1);
    expect(hw.idsToStates.get(1)!.getId()).toBe(reel[1].getId());

    // 31 more flips wraps back to the start
    for (let n = 0; n < 31; n++) hw.actionsToHardwareAction(0, [1], 0);
    expect(unit.currentIndex).toBe(0);
});
