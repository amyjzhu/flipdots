/**
 * hardware-refactored.ts
 *
 * Drop-in refactoring of hardware.ts. Shared helpers extracted:
 *   - actionToStr           merged duplicate getActionStr / actionToString
 *   - rectangularAdjacency  Moore-neighbourhood adjacency (6 sites → 1)
 *   - buildRectangularGrid  unit list + indexToCoord (5 sites → 1)
 *   - coordToIndexFromMap   reverse-lookup coordToIndex (5 sites → 1)
 *   - makeTimeFrontier      memoised timeFrontier closure (5 sites → 1)
 *   - makeAllowedNextActive standard "others free now, active locked" policy
 *   - compileSchedule       validate → onAction → update-availability scaffold
 *   - realTiming            inline helper for the getRealTiming ternary
 *
 * Bugs fixed vs. original:
 *   - FlipdotHardware.Rectangular used `i * height + j`; corrected to `i * width + j`.
 *   - Removed dead `possibleTime` / `violations` declarations in compile().
 *   - Duplicate top-level computeFlipDistance free function removed (was same as method).
 *   - Unused imports cleaned up.
 */

import * as fs from 'fs';
import { RynxDisplay, StepSchedule, deBruijn, WINDOW_ROWS } from './rynx';
import { RowOfDiscs } from './flipdisc';
import { RowOfDiscsAsync } from './flipdisc-3';
import { BrixelDisplay } from './brixel';
import { SplitFlapDisplay } from './splitflap';
import { FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING } from './constants';
import { generateDirection } from './transitions';

// ── Primitive types ────────────────────────────────────────────────────────────

export type Time = number;
export type Duration = number;
export type UnitId = number;
export type StateId = number | string;

export class State {
    id: StateId;
    constructor(id: StateId) { this.id = id; }
    getId() { return this.id; }
}

export enum Action {
    FLIP,
    SET,
    FLUTTER,
    INCREMENT,
    DECREMENT,
}

/** Single source of truth for action → string (replaces duplicate getActionStr / actionToString). */
export function actionToStr(action: Action): string {
    switch (action) {
        case Action.FLIP:      return 'flip';
        case Action.SET:       return 'set';
        case Action.FLUTTER:   return 'flutter';
        case Action.INCREMENT: return 'increment';
        case Action.DECREMENT: return 'decrement';
    }
}

export interface Unit {
    id: UnitId;
    actions: Action[];
    actionTiming: [Action, Duration][];
    states: [Action, State[]][];
    clone(): Unit;
}

export interface HardwareInterface {
    units: Unit[];
    actionDurations: Map<Action, Duration>;
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    compile(groupActions: GroupAction[]): void;
}

export class GroupAction {
    tPlus: Time = 0;
    actions: [Action, UnitId[]][] = [];
    constructor(time: Time, actions: [Action, UnitId[]][]) {
        this.tPlus = time;
        this.actions = actions;
    }
}

export let delayGroupActions = (input: GroupAction[], delay: number) =>
    input.map(ga => new GroupAction(ga.tPlus + delay, ga.actions));

export let scaleGroupActions = (input: GroupAction[], factor: number) =>
    input.map(ga => new GroupAction(ga.tPlus * factor, ga.actions));

// ── Shared grid helpers ────────────────────────────────────────────────────────

/**
 * Moore-neighbourhood (8-directional) adjacency for a width×height row-major grid.
 * Replaces the identical nested-loop block repeated 6 times across hardware types.
 */
export function rectangularAdjacency(width: number, height: number): (i: UnitId) => UnitId[] {
    return (i: UnitId) => {
        const x = i % width;
        const y = Math.floor(i / width);
        const neighbours: UnitId[] = [];
        for (const dy of [-1, 0, 1]) {
            for (const dx of [-1, 0, 1]) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                neighbours.push(ny * width + nx);
            }
        }
        return neighbours;
    };
}

/**
 * Build a flat row-major unit list and indexToCoord for a width×height grid.
 *
 * @param coordOf  Maps (x, y) to the stored coord tuple. Default is [x, y].
 *                 Pass `(x, y) => [y, x]` for hardware types that store [row, col].
 */
export function buildRectangularGrid<U extends Unit>(
    width: number,
    height: number,
    makeUnit: (id: number, x: number, y: number) => U,
    coordOf: (x: number, y: number) => [number, number] = (x, y) => [x, y],
): { units: U[]; indexToCoord: Map<number, [number, number]> } {
    const indexToCoord = new Map<number, [number, number]>();
    const units: U[] = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const id = y * width + x;
            units.push(makeUnit(id, x, y));
            indexToCoord.set(id, coordOf(x, y));
        }
    }
    return { units, indexToCoord };
}

/** Reverse-lookup coordToIndex from an indexToCoord map. */
export function coordToIndexFromMap(
    indexToCoord: Map<number, [number, number]>,
): (coord: [number, number]) => number {
    return ([cx, cy]: [number, number]) => {
        for (const [k, [vx, vy]] of indexToCoord) {
            if (vx === cx && vy === cy) return k;
        }
        throw new Error(`coord [${cx},${cy}] not found in indexToCoord`);
    };
}

/** Memoised timeFrontier — identical boilerplate in every hardware constructor. */
export function makeTimeFrontier(
    dirsToTime: Map<string, (t: Time) => number[]>,
    hw: HardwareInterface,
): (start: number, dir: [number, number]) => (t: Time) => UnitId[] {
    return (start, dir) => {
        const key = `${start}|${dir[0]}|${dir[1]}`;
        if (!dirsToTime.has(key)) {
            dirsToTime.set(key, generateDirection(start, dir, hw).atTime);
        }
        return dirsToTime.get(key)!;
    };
}

/**
 * Standard availability policy: other units stay available at the current time;
 * active units become available again after `duration()` logical time units.
 * (Not suitable for Brixel or FlipdotHardware, which use different policies.)
 */
export function makeAllowedNextActive(
    units: Unit[],
    duration: () => Duration,
): (action: Action, ids: UnitId[], time: Time) => [UnitId[], Time][] {
    return (_action, ids, time) => {
        const otherIds = [...new Set(units.map(u => u.id)).difference(new Set(ids))];
        return [[otherIds, time], [ids, time + duration()]] as [UnitId[], Time][];
    };
}

/** Shared getRealTiming pattern — time is always a plain number in current usage. */
function realTiming(time: Time, unitDuration: number): number {
    return typeof time === 'number' ? time : (time as any)[0] * unitDuration + (time as any)[2];
}

// ── Shared compile scaffold ────────────────────────────────────────────────────

/**
 * Core compile loop shared by all hardware types.
 *
 * For each GroupAction (in order), validates that every unit is available,
 * calls `onAction`, then advances `unitAvailableAt` via `allowedNextActive`.
 * `afterGroupAction` fires once per GroupAction, after all its inner actions —
 * useful for updating `lastTime` or flushing a simulation batch.
 */
export function compileSchedule(
    hw: HardwareInterface & { getRealTiming(t: Time): number },
    groupActions: GroupAction[],
    onAction: (actionType: Action, ids: UnitId[], time: number) => void,
    afterGroupAction?: (time: number) => void,
): void {
    const unitAvailableAt = new Map<UnitId, number | undefined>(
        hw.units.map(u => [u.id, 0 as number | undefined]),
    );

    for (const ga of groupActions) {
        const time = hw.getRealTiming(ga.tPlus);

        for (const [actionType, ids] of ga.actions) {
            // Resolve units, fail fast if any id is unknown
            const units = ids.map(id => {
                const u = hw.units.find(u => u.id === id);
                if (!u) throw new Error(`undefined unit ${id} used in action`);
                return u;
            });

            // Validate timing & action support
            for (const unit of units) {
                const available = unitAvailableAt.get(unit.id);
                if (!(unit.actions.includes(actionType) && available != null && available <= time)) {
                    console.log(
                        `id ${unit.id}: tried to ${actionToStr(actionType)} at t=${time}` +
                        `, available at ${available}`,
                    );
                    throw new Error('could not compile');
                }
            }

            onAction(actionType, ids, time);

            // Advance availability — reset all to undefined first (matches original semantics)
            for (const k of unitAvailableAt.keys()) unitAvailableAt.set(k, undefined);
            for (const [nextIds, interval] of hw.allowedNextActive(actionType, ids, time)) {
                nextIds.forEach(id => unitAvailableAt.set(id, hw.getRealTiming(interval)));
            }
        }

        afterGroupAction?.(time);
    }
}

// ── SplitFlap ─────────────────────────────────────────────────────────────────

export class SplitflapState implements State {
    id: string;
    getId(): StateId { return this.id; }
    constructor(description: string) { this.id = description; }
}

export class SplitflapUnit implements Unit {
    id: number;
    actions: Action[] = [Action.FLIP];
    actionTiming: [Action, number][] = [[Action.FLIP, 1]];
    states: [Action, State[]][];
    currentIndex: number;

    constructor(id: number, reel: SplitflapState[], currIndex = 0) {
        this.id = id;
        this.states = [[Action.FLIP, reel]];
        this.currentIndex = currIndex;
    }

    clone(): SplitflapUnit {
        return new SplitflapUnit(this.id, this.states[0][1] as SplitflapState[], this.currentIndex);
    }
}

export let isSplitflapHardware = (x: HardwareInterface): x is SplitflapHardware =>
    (<SplitflapHardware>x).computeFlipDistance !== undefined;

export class SplitflapHardware implements HardwareInterface {
    units: Unit[];
    actionDurations: Map<Action, number>;
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    idsToStates: Map<UnitId, State>;
    sim: SplitFlapDisplay | null;
    estimatedDurationMs = 0;

    constructor(
        units: SplitflapUnit[],
        indexToCoord: Map<number, [number, number]>,
        unitAdjacency: (toCheck: UnitId) => UnitId[],
        sim: SplitFlapDisplay | null,
    ) {
        this.units = units;
        this.actionDurations = new Map([[Action.FLIP, units[0].actionTiming[0][1]]]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = coordToIndexFromMap(indexToCoord);
        this.unitAdjacency = unitAdjacency;
        this.idsToStates = new Map(units.map(u => [u.id, u.states[0][1][u.currentIndex]]));
        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);
        this.allowedNextActive = makeAllowedNextActive(units, () => this.actionDurations.get(Action.FLIP)!);

        this.actionsToHardwareAction = (_action, ids, _time) =>
            ids.map(i => {
                const unit = units.find(u => u.id === i)! as SplitflapUnit;
                const newState = unit.states[0][1][unit.currentIndex + 1];
                return [i, newState] as [UnitId, State];
            });

        this.sim = sim;
    }

    getRealTiming(time: Time): number {
        return realTiming(time, this.actionDurations.get(Action.FLIP)!);
    }

    computeFlipDistance(unit: SplitflapUnit, target: SplitflapState): number {
        const states = unit.states[0][1];
        const end = states.findIndex(s => s.id === target.id);
        if (end === -1) throw new Error(`Invalid state for unit ${unit.id}`);
        return (end - unit.currentIndex + states.length) % states.length;
    }

    /** Shared grid builder for Rectangular and Headless factories. */
    private static buildGrid(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[]) {
        const { units, indexToCoord } = buildRectangularGrid(
            width, height, (id, x, y) => new SplitflapUnit(id, reelConfig(x, y)),
        );
        return { units, indexToCoord, adjacency: rectangularAdjacency(width, height) };
    }

    static Rectangular(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[], container?: HTMLElement) {
        const { units, indexToCoord, adjacency } = SplitflapHardware.buildGrid(width, height, reelConfig);
        const firstReel = reelConfig(0, 0).map(s => String(s.id));
        return new SplitflapHardware(units, indexToCoord, adjacency,
            new SplitFlapDisplay(width, height, undefined, undefined, container, firstReel));
    }

    static Headless(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[]) {
        const { units, indexToCoord, adjacency } = SplitflapHardware.buildGrid(width, height, reelConfig);
        return new SplitflapHardware(units, indexToCoord, adjacency, null);
    }

    /**
     * Compile GroupActions into a per-unit tick-delay schedule for SplitFlapDisplay.animate().
     * See original hardware.ts for the full timing model documentation.
     */
    compile(groupActions: GroupAction[]) {
        if (!this.sim) throw new Error('Cannot compile: use SplitflapHardware.Rectangular().');

        const framesPerMs = 10;
        const unitsUsedAtTimes: [UnitId, number][] = [];

        compileSchedule(this, groupActions, (_actionType, ids, time) => {
            const frame = Math.round(time);
            ids.forEach(id => unitsUsedAtTimes.push([id, frame]));
        });

        // Collect per-unit frame-sorted timelines
        const byUnit = new Map<UnitId, number[]>();
        for (const [id, frame] of unitsUsedAtTimes) {
            if (!byUnit.has(id)) byUnit.set(id, []);
            byUnit.get(id)!.push(frame);
        }

        const scheduled = new Map<UnitId, [[number, number][], number]>();
        for (const [unitId, acts] of byUnit) {
            acts.sort((a, b) => a - b);
            let lastEnd = -Infinity;
            const timeline: [number, number][] = [];
            for (const act of acts) {
                const start = Math.max(act, lastEnd);
                const end = start + this.actionDurations.get(Action.FLIP)!;
                timeline.push([start, end]);
                lastEnd = end;
            }
            scheduled.set(unitId, [timeline, lastEnd]);
        }

        // Convert logical frame ranges to animation tick-delay arrays
        const msPerTick = 1 / framesPerMs;
        const animDurationMs = (this.sim.numFramesRotating + this.sim.riseFrames) * msPerTick;
        const tickSchedule = new Map<UnitId, number[]>();

        for (const [id, [timelineMs]] of scheduled) {
            const delays: number[] = [];
            let prevEnd = 0;
            for (const [startMs] of timelineMs) {
                if (delays.length > 0 && startMs < prevEnd)
                    throw new Error(`Timeline error: not enough time to finish previous animation`);
                delays.push(Math.round((startMs - prevEnd) / msPerTick));
                prevEnd = startMs + animDurationMs;
            }
            tickSchedule.set(id, delays);
        }

        const schedule = (f: number) => (i: number): [number | undefined, number | undefined] => {
            const timeline = scheduled.get(i);
            if (!timeline || f > timeline[1]) return [undefined, 0];
            const delays = tickSchedule.get(i)!;
            if (f < 0 || f >= delays.length) return [undefined, 0];
            return [delays[f], 0];
        };

        const maxLogicalEnd = Math.max(...[...scheduled.values()].map(([, end]) => end), 0);
        this.estimatedDurationMs = (maxLogicalEnd * framesPerMs + this.sim.numFramesRotating * 2) / 60 * 1000;
        this.sim.resetAnimation(schedule);
    }
}

// ── Rynx ──────────────────────────────────────────────────────────────────────

export class RynxState implements State {
    id: string;
    getId(): StateId { return this.id; }
    constructor(description: string) { this.id = description; }
}

export let rynxStateFor = (column: number[]): RynxState => new RynxState(column.join(''));

export let rynxReel = (wheelPattern: number[]): RynxState[] =>
    wheelPattern.map((_, k) =>
        new RynxState([...new Array(WINDOW_ROWS).keys()]
            .map(r => wheelPattern[(k + r) % wheelPattern.length]).join('')));

export class RynxUnit implements Unit {
    id: number;
    actions: Action[] = [Action.FLIP];
    actionTiming: [Action, number][] = [[Action.FLIP, 1]];
    states: [Action, State[]][];
    currentIndex: number;

    constructor(id: number, reel: RynxState[], currIndex = 0) {
        this.id = id;
        this.states = [[Action.FLIP, reel]];
        this.currentIndex = currIndex;
    }

    clone(): RynxUnit {
        return new RynxUnit(this.id, this.states[0][1] as RynxState[], this.currentIndex);
    }
}

export let isRynxHardware = (x: HardwareInterface): x is RynxHardware =>
    (<RynxHardware>x).computeStepDistance !== undefined;

export class RynxHardware implements HardwareInterface {
    units: Unit[];
    actionDurations: Map<Action, number>;
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    idsToStates: Map<UnitId, State>;
    sim: RynxDisplay | null;
    estimatedDurationMs = 0;

    constructor(
        units: RynxUnit[],
        indexToCoord: Map<number, [number, number]>,
        unitAdjacency: (toCheck: UnitId) => UnitId[],
        sim: RynxDisplay | null,
    ) {
        this.units = units;
        this.actionDurations = new Map([[Action.FLIP, units[0].actionTiming[0][1]]]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = coordToIndexFromMap(indexToCoord);
        this.unitAdjacency = unitAdjacency;
        this.idsToStates = new Map(units.map(u => [u.id, u.states[0][1][u.currentIndex]]));
        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);
        this.allowedNextActive = makeAllowedNextActive(units, () => this.actionDurations.get(Action.FLIP)!);

        this.actionsToHardwareAction = (_action, ids, _time) =>
            ids.map(i => {
                const unit = units.find(u => u.id === i)! as RynxUnit;
                const reel = unit.states[0][1];
                unit.currentIndex = (unit.currentIndex + 1) % reel.length;
                const newState = reel[unit.currentIndex];
                this.idsToStates.set(i, newState);
                return [i, newState] as [UnitId, State];
            });

        this.sim = sim;
    }

    getRealTiming(time: Time): number {
        return realTiming(time, this.actionDurations.get(Action.FLIP)!);
    }

    computeStepDistance(unit: RynxUnit, target: RynxState): number {
        const states = unit.states[0][1];
        const end = states.findIndex(s => s.id === target.id);
        if (end === -1) throw new Error(`state ${target.id} not on unit ${unit.id}'s reel`);
        return (end - unit.currentIndex + states.length) % states.length;
    }

    /** Shared builder for Row and Headless factories. */
    private static buildRow(numWheels: number, pattern: number[]) {
        const reel = rynxReel(pattern);
        const indexToCoord = new Map<number, [number, number]>(
            [...new Array(numWheels).keys()].map(i => [i, [i, 0] as [number, number]]),
        );
        const units = [...new Array(numWheels).keys()].map(i => new RynxUnit(i, reel));
        const adjacency = (i: UnitId) => [i - 1, i + 1].filter(n => n >= 0 && n < numWheels);
        return { units, indexToCoord, adjacency };
    }

    static Row(numWheels: number, container?: HTMLElement, wheelPattern?: number[]) {
        const pattern = wheelPattern ?? deBruijn(2, WINDOW_ROWS);
        const { units, indexToCoord, adjacency } = RynxHardware.buildRow(numWheels, pattern);
        return new RynxHardware(units, indexToCoord, adjacency,
            new RynxDisplay({ numWheels, container, wheelPattern: pattern }));
    }

    static Headless(numWheels: number, wheelPattern?: number[]) {
        const pattern = wheelPattern ?? deBruijn(2, WINDOW_ROWS);
        const { units, indexToCoord, adjacency } = RynxHardware.buildRow(numWheels, pattern);
        return new RynxHardware(units, indexToCoord, adjacency, null);
    }

    compile(groupActions: GroupAction[]) {
        if (!this.sim) throw new Error('Cannot compile: use RynxHardware.Row().');

        const flipDuration = this.actionDurations.get(Action.FLIP)!;
        const ticksPerUnit = this.sim.framesPerStep;
        const flipTimes = new Map<UnitId, number[]>();

        compileSchedule(this, [...groupActions].sort((a, b) => a.tPlus - b.tPlus),
            (actionType, ids, time) => {
                this.actionsToHardwareAction(actionType, ids, time); // advance reel state
                for (const id of ids) {
                    if (!flipTimes.has(id)) flipTimes.set(id, []);
                    flipTimes.get(id)!.push(time);
                }
            },
        );

        const tickSchedule = new Map<UnitId, number[]>();
        let lastEnd = 0;
        for (const [id, times] of flipTimes) {
            times.sort((a, b) => a - b);
            const holds: number[] = [];
            let prevEnd = 0;
            for (const t of times) {
                const start = Math.max(t, prevEnd);
                holds.push(Math.round((start - prevEnd) * ticksPerUnit));
                prevEnd = start + flipDuration;
            }
            tickSchedule.set(id, holds);
            lastEnd = Math.max(lastEnd, prevEnd);
        }

        const schedule: StepSchedule = s => i => {
            const holds = tickSchedule.get(i);
            return !holds || s >= holds.length ? undefined : holds[s];
        };

        this.estimatedDurationMs = lastEnd * ticksPerUnit / 60 * 1000;
        this.sim.resetAnimation(schedule);
    }
}

// ── Brixel ────────────────────────────────────────────────────────────────────

export class BrixelState implements State {
    id: StateId;
    getId(): StateId { return this.id; }
    constructor(angleDeg: number) { this.id = angleDeg; }
}

export class BrixelUnit implements Unit {
    id: number;
    actions: Action[] = [Action.INCREMENT, Action.DECREMENT];
    actionTiming: [Action, number][] = [[Action.INCREMENT, 1], [Action.DECREMENT, 1]];
    states: [Action, State[]][];

    constructor(id: number) {
        this.id = id;
        this.states = [
            [Action.INCREMENT, [...new Array(360)].map((_, i) => new BrixelState(i))],
            [Action.DECREMENT, [...new Array(360)].map((_, i) => new BrixelState(360 - i))],
        ];
    }

    clone(): BrixelUnit { return new BrixelUnit(this.id); }
}

export class BrixelSimHardware implements HardwareInterface {
    units: Unit[];
    actionDurations: Map<Action, number>;
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    idsToStates: Map<UnitId, State>;
    sim: BrixelDisplay;

    constructor(
        units: Unit[],
        indexToCoord: Map<number, [number, number]>,
        unitAdjacency: (toCheck: UnitId) => UnitId[],
        sim: BrixelDisplay,
    ) {
        this.units = units;
        this.actionDurations = new Map([
            [Action.INCREMENT, units[0].actionTiming[0][1]],
            [Action.DECREMENT, units[0].actionTiming[1][1]],
        ]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = coordToIndexFromMap(indexToCoord);
        this.unitAdjacency = unitAdjacency;
        this.idsToStates = new Map(units.map(u => [u.id, new BrixelState(0)]));
        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);

        // Brixel policy: other units are always available at t=0 (angle increments
        // are independent); only the unit that just moved is locked for one step.
        this.allowedNextActive = (_action, ids, time) => {
            const otherIds = [...new Set(units.map(u => u.id)).difference(new Set(ids))];
            return [
                [otherIds, 0],
                [ids, time + this.actionDurations.get(Action.INCREMENT)!],
            ] as [UnitId[], Time][];
        };

        this.actionsToHardwareAction = (action, ids, _time) =>
            ids.map(i => {
                const currState = this.idsToStates.get(i)!;
                const delta = action === Action.INCREMENT ? 1 : -1;
                const newState = new BrixelState(currState.getId() as number + delta);
                this.idsToStates.set(i, newState);
                return [i, newState] as [UnitId, State];
            });

        this.sim = sim;
    }

    getRealTiming(time: Time): number {
        return realTiming(time, this.actionDurations.get(Action.INCREMENT)!);
    }

    // BrixelSimHardware uses [row, col] coord convention (y-first) to match the original.
    static Rectangular(width: number, height: number) {
        const { units, indexToCoord } = buildRectangularGrid(
            width, height, (id) => new BrixelUnit(id), (x, y) => [y, x],
        );
        return new BrixelSimHardware(units, indexToCoord, rectangularAdjacency(width, height),
            new BrixelDisplay(width, height));
    }

    compile(groupActions: GroupAction[]) {
        const allStates: [UnitId, Time, number][] = [];

        compileSchedule(this, groupActions,
            (actionType, ids, time) => {
                const states = this.actionsToHardwareAction(actionType, ids, time);
                for (const [id, state] of states) {
                    allStates.push([id, time, state.getId() as number]);
                }
            },
            () => { this.sim.setAnimationSequence(allStates); },
        );
    }
}

// ── FlipdotState / FlipdotUnit (shared by all Flipdot hardware) ───────────────

export class FlipdotState extends State { }

export class FlipdotUnit implements Unit {
    id: UnitId;
    actionTiming: [Action, number][] = [[Action.FLIP, 1]];
    actions: Action[] = [Action.FLIP];
    states: [Action, State[]][];

    constructor(id: UnitId) {
        this.id = id;
        this.states = [[Action.FLIP, [new FlipdotState(0), new FlipdotState(1)]]];
    }

    clone(): Unit { return new FlipdotUnit(this.id); }
}

// ── FlipdotHardware (real hardware / file output) ─────────────────────────────

export class FlipdotHardware implements HardwareInterface {
    flipDurationMS: number;
    actionDurations: Map<Action, number> = new Map();
    units: Unit[];
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    filename = '';

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();

    getRealTiming(time: Time): number {
        return realTiming(time, this.flipDurationMS);
    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], indexToCoord: Map<number, [number, number]>) {
        this.flipDurationMS = 1;
        this.actionDurations.set(Action.FLIP, this.flipDurationMS);
        this.units = units;
        this.unitIdToUnit = new Map(units.map(u => [u.id, u]));
        this.indexToCoord = indexToCoord;
        this.coordToIndex = coordToIndexFromMap(indexToCoord);
        this.unitAdjacency = adjacency;
        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);

        // FlipdotHardware policy: other units become available 1 step later (not immediately).
        this.allowedNextActive = (_action, ids, time) => {
            const otherIds = [...new Set(units.map(u => u.id)).difference(new Set(ids))];
            return [
                [otherIds, time + 1],
                [ids, time + this.flipDurationMS],
            ] as [UnitId[], Time][];
        };

        this.actionsToHardwareAction = (action, ids, time) => {
            if (this.filename) {
                let str = '';
                if (this.getRealTiming(time) !== 0) str += `wait ${time}\n`;
                str += ids.map(id => `${actionToStr(action)} ${id}`).join('\n') + '\n';
                fs.appendFileSync(this.filename, str);
            } else {
                ids.forEach(id => console.log(`${action}, ${id}`));
                console.log(`wait ${time}`);
            }
            return [];
        };
    }

    compileToFile(groupActions: GroupAction[], fileName: string) {
        this.filename = fileName;
        fs.writeFileSync(this.filename, '');
        this.compile(groupActions);
    }

    compile(groupActions: GroupAction[]) {
        let lastTime = 0;
        compileSchedule(this, groupActions,
            (actionType, ids, time) => { this.actionsToHardwareAction(actionType, ids, time - lastTime); },
            (time) => { lastTime = time; },
        );
    }

    // Uses [row, col] (y-first) coord convention to match the original.
    // Bug fixed: original used `i * height + j` (wrong for non-square grids); now `i * width + j`.
    static Rectangular(width: number, height: number) {
        const { units, indexToCoord } = buildRectangularGrid(
            width, height, (id) => new FlipdotUnit(id), (x, y) => [y, x],
        );
        return new FlipdotHardware(units, rectangularAdjacency(width, height), indexToCoord);
    }
}

// ── FlipdotSimHardware (synchronous simulation) ───────────────────────────────

export class FlipdotSimHardware implements HardwareInterface {
    flipDurationMS = 1;
    actionDurations: Map<Action, number> = new Map();
    units: Unit[];
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    simulation: RowOfDiscs;
    indexToCoord: Map<number, [number, number]>;
    coordToIndex: (coord: [number, number]) => number;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    totalNumFrames = 0;

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    meshLocationStr = '';
    estimatedDurationMs = 0;

    private dims?: [number, number];

    getRealTiming(time: Time): number {
        return realTiming(time, this.flipDurationMS);
    }

    async finalize3D() {
        this.simulation.makeArbitraryMeshDiscSetup(this.meshLocationStr)
            .catch(() => new Promise(r => r(undefined)));
    }

    constructor(
        units: Unit[],
        adjacency: (toCheck: UnitId) => UnitId[],
        dimensions?: [number, number],
        meshInput?: string,
        frontColour?: string,
        backColour?: string,
    ) {
        this.actionDurations.set(Action.FLIP, this.flipDurationMS);

        if (dimensions !== undefined) {
            this.dims = dimensions;
            const [height, width] = dimensions;
            const { units: unitList, indexToCoord } = buildRectangularGrid(
                width, height, (id) => new FlipdotUnit(id),
            );
            this.units = unitList;
            this.indexToCoord = indexToCoord;
            this.unitAdjacency = rectangularAdjacency(width, height);
            // coordToIndex uses [col, row] → n[1]*width + n[0] (matches original)
            this.coordToIndex = (n: [number, number]) => n[1] * width + n[0];
            this.simulation = new RowOfDiscs(width, height, true, undefined, frontColour, backColour);
        } else {
            if (meshInput === undefined) throw new Error('No mesh input and not flat');
            this.units = units;
            this.unitAdjacency = adjacency;
            this.meshLocationStr = meshInput;
            this.simulation = new RowOfDiscs(1, 1, false, meshInput);
            this.coordToIndex = i => i[0];
            this.indexToCoord = new Map();
        }

        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);
        this.unitIdToUnit = new Map(this.units.map(u => [u.id, u]));

        // FlipdotSim policy: others stay available at current time; active locked for 1 step.
        this.allowedNextActive = makeAllowedNextActive(this.units, () => this.flipDurationMS);

        const dims = this.dims;
        this.actionsToHardwareAction = (_action, ids, time) => {
            const closestInterval = this.getRealTiming(time) === 0
                ? 0
                : Math.round(this.getRealTiming(time) / this.flipDurationMS);

            let idxes: number[][];
            let blankIdxes: number[][];
            if (dims) {
                const [height, width] = dims;
                idxes = [...new Array(height)].map(() => [] as number[]);
                blankIdxes = idxes.map(() => [] as number[]);
                ids.forEach(i => idxes[Math.floor(i / width)].push(i % width));
            } else {
                idxes = [ids];
                blankIdxes = [[]];
            }

            const originalAnim = this.simulation.nextFlipGenerator;
            const currNumFrames = this.totalNumFrames;

            this.simulation.resetAnimation(i => {
                if (i < currNumFrames) return originalAnim(i);
                const offset = i - currNumFrames;
                return offset === closestInterval ? idxes : blankIdxes;
            });

            this.totalNumFrames += closestInterval + 1;
            return [];
        };
    }

    compile(groupActions: GroupAction[]) {
        groupActions.sort((a, b) => a.tPlus - b.tPlus);
        let lastTime = 0;
        compileSchedule(this, groupActions,
            (actionType, ids, time) => { this.actionsToHardwareAction(actionType, ids, time - lastTime); },
            (time) => { lastTime = time; },
        );
        this.estimatedDurationMs = this.totalNumFrames * FULL_CYCLE_LENGTH / 60 * 1000;
    }
}

// ── FlipdotSimAsyncHardware (async simulation) ────────────────────────────────

export class FlipdotSimAsyncHardware implements HardwareInterface {
    framesPerMs: number = NUM_FRAMES_ROTATING;
    actionDurations: Map<Action, number> = new Map();
    units: Unit[];
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    simulation: RowOfDiscsAsync;
    indexToCoord: Map<number, [number, number]>;
    coordToIndex: (coord: [number, number]) => number;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    meshLocationStr = '';
    estimatedDurationMs = 0;

    private dims?: [number, number];

    getRealTiming(time: Time): number {
        return realTiming(time, this.framesPerMs);
    }

    async finalize3D() {
        this.simulation.makeArbitraryMeshDiscSetup(this.meshLocationStr)
            .catch(() => new Promise(r => r(undefined)));
    }

    constructor(
        units: Unit[],
        adjacency: (toCheck: UnitId) => UnitId[],
        dimensions?: [number, number],
        meshInput?: string,
    ) {
        this.actionDurations.set(Action.FLIP, 1);

        if (dimensions !== undefined) {
            this.dims = dimensions;
            const [height, width] = dimensions;
            const { units: unitList, indexToCoord } = buildRectangularGrid(
                width, height, (id) => new FlipdotUnit(id),
            );
            this.units = unitList;
            this.indexToCoord = indexToCoord;
            this.unitAdjacency = rectangularAdjacency(width, height);
            this.coordToIndex = (n: [number, number]) => n[1] * width + n[0];
            this.simulation = new RowOfDiscsAsync(width, height);
        } else {
            if (meshInput === undefined) throw new Error('No mesh input and not flat');
            this.units = units;
            this.unitAdjacency = adjacency;
            this.meshLocationStr = meshInput;
            this.simulation = new RowOfDiscsAsync(1, 1, false, meshInput);
            this.coordToIndex = i => i[0];
            this.indexToCoord = new Map();
        }

        this.timeFrontier = makeTimeFrontier(this.dirsToTime, this);
        this.unitIdToUnit = new Map(this.units.map(u => [u.id, u]));

        // Kept for HardwareInterface conformance; async compile() builds its own schedule.
        this.allowedNextActive = (_action, ids, time) => {
            const otherIds = [...new Set(this.units.map(u => u.id)).difference(new Set(ids))];
            return [[otherIds, time as number], [ids, (time as number) + 1]] as [UnitId[], Time][];
        };

        this.actionsToHardwareAction = () => [];
    }

    compile(groupActions: GroupAction[]) {
        const sorted = [...groupActions].sort((a, b) => a.tPlus - b.tPlus);
        const height = this.dims ? this.dims[0] : 1;
        const width = this.dims ? this.dims[1] : this.units.length;
        const framesPerMs = this.framesPerMs;

        const schedule = new Map<number, number[][]>();
        const emptyRows = (): number[][] => [...Array(height)].map(() => []);
        let lastFrame = 0;

        for (const ga of sorted) {
            const frame = Math.round(this.getRealTiming(ga.tPlus) * framesPerMs);
            if (!schedule.has(frame)) schedule.set(frame, emptyRows());
            const entry = schedule.get(frame)!;

            for (const [actionType, ids] of ga.actions) {
                if (actionType !== Action.FLIP) continue;
                for (const id of ids) {
                    const row = this.dims ? Math.floor(id / width) : 0;
                    const col = this.dims ? id % width : id;
                    entry[row].push(col);
                }
            }
            if (frame > lastFrame) lastFrame = frame;
        }

        this.simulation.resetAnimation(frame => schedule.get(frame) ?? emptyRows());
        this.estimatedDurationMs = (lastFrame + this.simulation.numFramesRotating) / 60 * 1000;
    }
}

// ── Scheduling helpers ────────────────────────────────────────────────────────

/** Forward-only flip distance on a reel (used by all schedule* functions below). */
function flipDistance(unit: SplitflapUnit, target: SplitflapState): number {
    const states = unit.states[0][1];
    const end = states.findIndex(s => s.id === target.id);
    if (end === -1) throw new Error(`Invalid state for unit ${unit.id}`);
    return (end - unit.currentIndex + states.length) % states.length;
}

export function buildTimeline(
    flipSchedule: Map<UnitId, Time[]>,
    startAt: Time = 0,
): GroupAction[] {
    const timeMap = new Map<Time, UnitId[]>();
    for (const [id, times] of flipSchedule) {
        for (const t of times) {
            if (!timeMap.has(t)) timeMap.set(t, []);
            timeMap.get(t)!.push(id);
        }
    }
    return [...timeMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([t, ids]) => new GroupAction(t + startAt, [[Action.FLIP, ids]]));
}

export function scheduleConstantSpeed(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    maxSimultaneousFinishes = Infinity,
): Map<UnitId, Time[]> {
    const dt = 1 / flipsPerSecond;
    const schedule = new Map<UnitId, Time[]>();
    const finishBuckets = new Map<Time, UnitId[]>();

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const flips = flipDistance(unit, targets[i]);
        const times: Time[] = [...new Array(flips).keys()].map(k => k * dt);
        schedule.set(unit.id, times);

        if (times.length === 0) continue;
        const last = times[times.length - 1];
        if (!finishBuckets.has(last)) finishBuckets.set(last, []);
        finishBuckets.get(last)!.push(unit.id);
    }

    for (const [time, ids] of finishBuckets) {
        if (ids.length <= maxSimultaneousFinishes) continue;
        ids.slice(maxSimultaneousFinishes).forEach((id, i) => {
            schedule.get(id)!.push(time + (i + 1) * dt);
        });
    }

    return schedule;
}

export function scheduleSyncEnd(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    initializationDelay = 0,
): Map<UnitId, Time[]> {
    const dt = 1 / flipsPerSecond;
    const maxFlips = Math.max(...units.map((u, i) => flipDistance(u, targets[i])));
    const endTime = initializationDelay + maxFlips * dt;

    const schedule = new Map<UnitId, Time[]>();
    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const flips = flipDistance(unit, targets[i]);
        const startTime = endTime - flips * dt;
        schedule.set(unit.id, [...new Array(flips).keys()].map(k => startTime + k * dt));
    }
    return schedule;
}

export function scheduleDirectional(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    hardware: SplitflapHardware,
    direction: string,
): Map<UnitId, Time[]> {
    const dt = 1 / flipsPerSecond;
    const ordered = [...units].sort((a, b) => {
        const ca = hardware.indexToCoord.get(a.id)!;
        const cb = hardware.indexToCoord.get(b.id)!;
        switch (direction) {
            case 'LEFT_TO_RIGHT':  return ca[0] - cb[0];
            case 'RIGHT_TO_LEFT':  return cb[0] - ca[0];
            case 'TOP_TO_BOTTOM':  return ca[1] - cb[1];
            case 'BOTTOM_TO_TOP':  return cb[1] - ca[1];
        }
        throw new Error(`Unknown direction: ${direction}`);
    });

    const schedule = new Map<UnitId, Time[]>();
    let currentEnd = 0;

    for (let i = 0; i < ordered.length; i++) {
        const unit = ordered[i];
        const flips = flipDistance(unit, targets[i]);
        const times = [...new Array(flips).keys()].map(k => currentEnd + k * dt);
        if (times.length > 0) currentEnd = times[times.length - 1] + dt;
        schedule.set(unit.id, times);
    }

    return schedule;
}
