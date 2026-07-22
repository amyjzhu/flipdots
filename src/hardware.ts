import * as fs from 'fs';
import { RynxDisplay, StepSchedule, deBruijn, WINDOW_ROWS } from './rynx';
import { RowOfDiscs } from './flipdisc';
import { RowOfDiscsAsync } from './flipdisc-3';
import { BrixelDisplay } from './brixel';
import { SplitFlapDisplay } from './splitflap';
import { getImages } from './util';
import { ALPHABET_WITH_EXCLAMATION, FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING } from './constants';
import { start } from 'repl';
import { generateDirection } from './transitions';
import { parseToGroupAction, Target, CircleTarget } from './language2';
import type { DotField, Dot } from './uvdots';



export interface HardwareInterface {
    units: Unit[] // need to map these somewhere somehow
    actionDurations: Map<Action, Duration>;
    coordToIndex: (coord: [number, number]) => number;
    indexToCoord: Map<number, [number, number]>;
    timeFrontier: (start: number, dir: [number, number]) => (t: Time) => UnitId[];
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];

    compile(groupActions: GroupAction[]): void;
}

export type Time = number;
export type Duration = number;
// type Time = number | [number, Action, number];
export type UnitId = number;
export type StateId = number | string;

export class State {
    id: StateId;

    constructor(id: StateId) {
        this.id = id;
    }

    getId() {
        return this.id;
    }
}

let incrementTime = (t: Time, inc: number) => {
    return t + inc;
}

export interface Unit {
    id: UnitId;
    actions: Action[];
    actionTiming: [Action, Duration][];
    states: [Action, State[]][];

    clone: () => Unit;
}

export enum Action {
    FLIP,
    SET,
    FLUTTER,
    INCREMENT,
    DECREMENT
}

let getActionStr = (action: Action): string => {
    switch (action) {
        case Action.FLIP:
            return "flip";
        case Action.SET:
            return "set";
        case Action.FLUTTER:
            return "flutter";
        case Action.INCREMENT:
            return "increment";
        case Action.DECREMENT:
            return "decrement";
    }
}

let actionToString = (action: Action) => {
    switch (action) {
        case Action.FLIP:
            return "flip";
        case Action.SET:
            return "set";
        case Action.FLUTTER:
            return "flutter";
        default:
            return "unknown";
    }
}




export class GroupAction {
    tPlus: Time = 0;
    actions: [Action, UnitId[]][] = [];

    constructor(time: Time, actions: [Action, UnitId[]][]) {
        this.tPlus = time;
        this.actions = actions;
    }
}

/////


export class SplitflapState implements State {
    id: string;
    getId(): StateId {
        return this.id;
    }

    constructor(description: string) {
        this.id = description;
    }
}

export class SplitflapUnit implements Unit {
    id: number;
    actions: Action[];
    actionTiming: [Action, number][];
    states: [Action, State[]][];
    currentIndex: number

    constructor(id: number, reel: SplitflapState[], currIndex: number = 0) {
        this.id = id;
        this.actions = [Action.FLIP];
        this.actionTiming = [[Action.FLIP, 1]];
        this.states = [[Action.FLIP, reel]]; // I should use this instead...
        this.currentIndex = currIndex;
    }

    clone(): SplitflapUnit {
        return new SplitflapUnit(this.id, this.states[0][1] as SplitflapState[])
    }
}

export let delayGroupActions = (input: GroupAction[], delay: number) => {
    return input.map(ga => new GroupAction(ga.tPlus + delay, ga.actions));
}

export let scaleGroupActions = (input: GroupAction[], factor: number) =>
    input.map(ga => new GroupAction(ga.tPlus * factor, ga.actions));

export let isSplitflapHardware = (x: HardwareInterface): x is SplitflapHardware => {
    return (<SplitflapHardware>x).computeFlipDistance != undefined;
}

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
    estimatedDurationMs: number = 0;

    constructor(units: SplitflapUnit[], indexToCoord: Map<number, [number, number]>, unitAdjacency: (toCheck: UnitId) => UnitId[], sim: SplitFlapDisplay | null) {
        this.units = units;
        this.actionDurations = new Map();
        this.actionDurations.set(units[0].actionTiming[0][0], units[0].actionTiming[0][1]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = (coord: [number, number]) => this.indexToCoord.entries().find(([k, v]) => v[0] == coord[0] && v[1] == coord[1])![0];
        this.unitAdjacency = unitAdjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];

            return [[otherIds, time],
            // return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.actionDurations.get(Action.FLIP)!)]] as [UnitId[], Time][];
        }

        this.idsToStates = new Map(units.map(u => [u.id, u.states[0][1][u.currentIndex] as State]));


        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        }

        this.actionsToHardwareAction = (action: Action, id: UnitId[], time: Time): [UnitId, State][] => {
            // generate a new set of actions.
            let actions: [UnitId, State][] = [];
            for (let i of id) {
                let unit: SplitflapUnit = this.units.find(u => u.id == i)! as SplitflapUnit;
                // what's the next thing? I guess it's actually what's on the roll... s
                let newState = unit.states[0][1][unit.currentIndex + 1];
                // need to figure out how to actually make this...
                actions.push([i, newState])
            }

            return actions;
        }

        this.sim = sim;

    }

    computeFlipDistance(unit: SplitflapUnit, target: SplitflapState): number {
        const states = unit.states[0][1];
        const start = unit.currentIndex;
        const end = states.findIndex(s => s.id == target.id);

        // console.log(target, states)
        if (start === -1 || end === -1) {
            throw new Error(`Invalid state for unit ${unit.id}`);
        }

        // console.log((end - start + states.length) % states.length)

        return (end - start + states.length) % states.length;
    }

    static Rectangular(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[], container?: HTMLElement) {
        let indexToCoord = new Map<number, [number, number]>();

        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => {
            let reel = reelConfig(j, i);
            let newUnit = new SplitflapUnit(i * width + j, reel);
            indexToCoord.set(i * width + j, [j, i])
            return newUnit;
        }).flat()).flat();


        // unitList.forEach(u => indexToCoord.set(u.id, [u.id % width, Math.floor(u.id / width)]))
        console.log(indexToCoord)
        let adjacency = (i: UnitId) => {
            let neighbours: UnitId[] = [];
            // if we're at the edge, don't include some:

            let xCoord = i % width;
            let yCoord = Math.floor(i / width);

            for (let yPlus of [-1, 0, 1]) {
                for (let xPlus of [-1, 0, 1]) {
                    if (!((xPlus == 0 && yPlus == 0) ||
                        (xCoord + xPlus >= width || xCoord + xPlus < 0
                            || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                        neighbours.push(i + yPlus * width + xPlus);
                    }
                }
            }
            console.log(neighbours);
            return neighbours;
        }

        // let coordToIndex = (n: [number, number]) => {
        //     // console.log("check: ", width);
        //     // console.log("check: ", n[0], n[1])
        //     return n[0] * width + n[1]
        // };


        const firstReel = reelConfig(0, 0).map(s => String(s.id));
        return new SplitflapHardware(unitList, indexToCoord, adjacency, new SplitFlapDisplay(width, height, undefined, undefined, container, firstReel));
    }

    static Headless(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[]) {
        let indexToCoord = new Map<number, [number, number]>();
        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => {
            let reel = reelConfig(j, i);
            let newUnit = new SplitflapUnit(i * width + j, reel);
            indexToCoord.set(i * width + j, [j, i]);
            return newUnit;
        }).flat()).flat();

        let adjacency = (i: UnitId) => {
            let neighbours: UnitId[] = [];
            let xCoord = i % width;
            let yCoord = Math.floor(i / width);
            for (let yPlus of [-1, 0, 1]) {
                for (let xPlus of [-1, 0, 1]) {
                    if (!((xPlus == 0 && yPlus == 0) ||
                        (xCoord + xPlus >= width || xCoord + xPlus < 0
                            || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                        neighbours.push(i + yPlus * width + xPlus);
                    }
                }
            }
            return neighbours;
        };

        return new SplitflapHardware(unitList, indexToCoord, adjacency, null);
    }

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.actionDurations.get(Action.INCREMENT)! + time[2];
        }
    }

    /**
     * Turn a GroupAction schedule (in logical flip-time units) into the per-unit
     * hold/delay arrays that `SplitFlapDisplay.animate()` consumes.
     *
     * Timing model — there are three time bases that must stay consistent:
     *
     *   - Logical flip-time units: the times carried on GroupAction.tPlus (e.g.
     *     `t * dt` from the transitions). One unit is the schedule's notion of
     *     "one flip slot".
     *   - Ticks: animation frames inside `animate()` (one per requestAnimationFrame).
     *   - The conversion is `framesPerMs` ticks per logical unit (logical units are
     *     treated as milliseconds, msPerTick = 1 / framesPerMs).
     *
     * The critical invariant: ONE FULL FLIP IN animate() TAKES (numFramesRotating +
     * riseFrames) TICKS — fall (numFramesRotating) then rise (riseFrames), run
     * sequentially; see SplitFlapDisplay.animate(). Two values below must both reflect
     * that, or flips drift late / don't physically fit and units desync:
     *
     *   - `framesPerMs = numFramesRotating + riseFrames` so one logical flip-time unit
     *     spans exactly one full flip. If framesPerMs were smaller than the flip
     *     length, back-to-back flips (1 logical unit apart) couldn't finish in their
     *     slot — the "not enough time" throw below. Tied to the flip length so it
     *     adapts to any rotation speed (e.g. NUM_FRAMES_ROTATING = slowishFrames).
     *   - `animationDurationMs = (numFramesRotating + riseFrames) * msPerTick` so the
     *     delay between consecutive flips reserves the whole fall+rise motion.
     *
     * With both set, a scheduled gap of g logical units produces
     *   hold = (g - 1) * (numFramesRotating + riseFrames) ticks,
     * and the realized per-flip period is hold + (fall + rise) = g * (numFramesRotating
     * + riseFrames) ticks = exactly g logical units — no cumulative drift.
     */
    compile(groupActions: GroupAction[]) {
        if (!this.sim) throw new Error('Cannot compile: use SplitflapHardware.Rectangular() to get a hardware with a display.');
        console.log(groupActions)
        // framesPerMs ticks per logical flip-time unit = one full flip (fall + rise),
        // so it tracks the rotation speed and a flip always fits its slot. See doc above.
        // let framesPerMs = this.sim.numFramesRotating + this.sim.riseFrames;
        let framesPerMs = 10;

        let allStates: number[][] = [];

        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        // let cumulativeTime = 0;
        let lastTime = 0;
        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));

        let unitsUsedAtTimes: [UnitId, number][] = [];


        // at the very beginning, they are all available
        for (let ga of groupActions) {
            
            let time = this.getRealTiming(ga.tPlus);
            console.log("executing groupaction at time", ga.tPlus, time)
            const frame = Math.round(ga.tPlus);
            // console.log(time, frame)

            // cumulativeTime += time;
            // console.log("updating time!", cumulativeTime, time)
            let possibleTime // keep track.... 
            let actionSet = ga.actions;
            for (let action of actionSet) {
                let actionType: Action = action[0];
                let units: Unit[] = action[1].map(i => this.units.find(u => u.id == i)!);

                // first, I need to check the timing by inputting the group action and seeing 
                // if it's possible.
                // first, make sure we can do everything simultaneously


                // console.log(unitAvailableAt)
                let violations = false;
                for (let unit of units) {
                    // do we actually know what the action is?
                    if (!(unit.actions.includes(action[0]) &&
                        // and is current time at least later than next available time?
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= time))) {

                        console.log("unit can perform action: ", unit.actions.includes(action[0]))
                        console.log("unit is available at ", unitAvailableAt.get(unit.id))
                        console.log("and this is less than current time? ", unitAvailableAt.get(unit.id)! <= time)
                        // console.log(unitAvailableAt.get(unit.id), time)
                        console.log("id, time, availableAt, action", unit.id, time, unitAvailableAt.get(unit.id), getActionStr(actionType));
                        throw new Error("could not compile");

                    }

                    unitsUsedAtTimes.push([unit.id, frame]);
                }

                // how did I actually do this?







                /*
                // time - lastTime should ctually be last time this one was activated!!!!!!!
                let states = this.actionsToHardwareAction(actionType, action[1], time - lastTime);
                // just need a number[][] - every tick, every unit frame that's activating 
                allStates.push(states.map(i => i[0]));
                // allStates = allStates.concat(states.map(tuple => [tuple[0], time, tuple[1].getId()] as [Time, UnitId, number]));
                console.log(allStates)
                console.log(groupActions)


                */
                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                // console.log(nextAvailable)
                // console.log("updating to ", nextAvailable);
                for (let [ids, interval] of nextAvailable) {
                    // console.log(cumulativeTime + this.getRealTiming(interval))

                    ids.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }

            }




            lastTime = time;


            // I do actually need to fix this, time-wise
            // let sequence = convertSyncedSequence(allStates, allStates.map(_ =>  this.units.map(u => this.sim.numFramesRotating / 3)), allStates.map(_ =>  this.units.map(u => this.sim.numFramesRotating)));
            // this.sim.resetAnimation(sequence);
        }

        const byUnit = new Map<UnitId, number[]>();

        console.log(unitsUsedAtTimes)
        for (const a of unitsUsedAtTimes) {
            if (!byUnit.has(a[0])) {
                byUnit.set(a[0], []);
            }
            byUnit.get(a[0])!.push(a[1]);
        }
        console.log(byUnit)

        const scheduled = new Map<UnitId, [[number, number][], number]>();

        for (const [unitId, acts] of byUnit) {
            acts.sort((a, b) => a - b);

            let lastEnd = -Infinity;
            const timeline: [number, number][] = [];

            for (const act of acts) {
                const start = Math.max(act, lastEnd);
                const end = start + this.actionDurations.get(Action.FLIP)!;
                // const end = start + this.sim.numFramesRotating;

                timeline.push([start, end]);
                lastEnd = end;
            }

            scheduled.set(unitId, [timeline, lastEnd]);
        }
        console.log(scheduled);

        let PAUSE_DEFAULT = this.sim.numFramesRotating / 3;
        // I need to figure out what the "time" spent for one rotation is 

        //////

        let tickSchedule = new Map<UnitId, number[]>();
        for (let [i, timeline] of scheduled.entries()) {
            const msPerTick = 1 / framesPerMs;
            // Reserve exactly the motion animate() spends per flip: fall (numFramesRotating)
            // + rise (riseFrames). Matching this kills the per-flip drift. Must stay
            // <= framesPerMs so back-to-back flips fit one logical slot without throwing.
            const animationDurationMs = (this.sim.numFramesRotating + this.sim.riseFrames) * msPerTick;

            let timelineMs = timeline[0];
            // Precompute delays (fail fast if invalid)
            const delaysInTicks: number[] = [];

            let previousAnimationEndMs = 0;

            for (let i = 0; i < timelineMs.length; i++) {
                const startMs = timelineMs[i][0];

                if (i > 0 && startMs < previousAnimationEndMs) {
                    throw new Error(
                        `Timeline error at index ${i}: ` +
                        `not enough time to finish previous animation`
                    );
                }

                const delayMs = startMs - previousAnimationEndMs;
                const delayTicks = Math.round(delayMs / msPerTick);

                delaysInTicks.push(delayTicks);
                previousAnimationEndMs = startMs + animationDurationMs;

            }
            tickSchedule.set(i, delaysInTicks);

        }

        console.log("schedule is ", [...tickSchedule.entries().map(e => `${e[0]}:${e[1]}`)]);
        console.log("schedule is ", scheduled);
        let schedule = (f: number) => {
            return (i: number): [number | undefined, number | undefined] => {
                // console.log("for frame ", f, " unit ", i, " we are getting ", tickSchedule.get(i), scheduled.get(i))
                let delaysInTicks = tickSchedule.get(i)!;

                const timeline = scheduled.get(i);
                if (!timeline) return [undefined, 0];
                if (f > timeline[1]) return [undefined, 0];

                if (f < 0 || f >= delaysInTicks.length) {
                    return [undefined, 0];
                }
                return [delaysInTicks[f], 0];
            }
        }

        let _schedule = (f: number) => {
            return (i: number): [number | undefined, number | undefined] => {

                const timeline = scheduled.get(i);
                if (!timeline) return [undefined, 0];
                if (f > timeline[1]) return [undefined, 0];

                for (const act of timeline[0]) {
                    if (act[0] >= f) {
                        // this isn't quite the right number, because the pause... 
                        // I need something like, 
                        let seconds = act[0] - f;
                        let frames = framesPerMs * seconds;
                        // subtract...
                        let newTime = frames - PAUSE_DEFAULT;
                        if (newTime < 0) {
                            throw new Error("not enough time to rotate")
                        }
                        return [newTime, 0];
                    } else {
                        console.log(act, f, i)
                    }
                }



                return [undefined, 0];
            };
        };

        // Estimate wall-clock duration: last logical end time × framesPerMs ticks/unit ÷ 60fps
        const maxLogicalEnd = Math.max(...[...scheduled.values()].map(([, lastEnd]) => lastEnd), 0);
        this.estimatedDurationMs = (maxLogicalEnd * framesPerMs + this.sim!.numFramesRotating * 2) / 60 * 1000;

        this.sim.resetAnimation(schedule);

    }

}

///////////////
// Rynx: a row of 32-segment wheels behind 5-pixel windows. One FLIP = one
// one-segment step of a wheel (the bottom window pixel moves up, a new one
// enters from below). A unit's states are the 32 window contents readable
// off the wheel's painted reel — with the default de Bruijn pattern every
// 5-bit column appears exactly once, so all 32 states are distinct and any
// column is reachable.

export class RynxState implements State {
    // the window content, top row first, e.g. "10110"
    id: string;
    getId(): StateId {
        return this.id;
    }

    constructor(description: string) {
        this.id = description;
    }
}

// the state whose window shows `column` (5 bits, top row first)
export let rynxStateFor = (column: number[]): RynxState => new RynxState(column.join(''));

// The reel of states a wheel steps through: state k is the window visible
// when segment k sits at the top row. This is where the underlying reel
// sequence turns into hardware states.
export let rynxReel = (wheelPattern: number[]): RynxState[] =>
    wheelPattern.map((_, k) =>
        new RynxState([...new Array(WINDOW_ROWS).keys()]
            .map(r => wheelPattern[(k + r) % wheelPattern.length]).join('')));

export class RynxUnit implements Unit {
    id: number;
    actions: Action[];
    actionTiming: [Action, number][];
    states: [Action, State[]][];
    currentIndex: number;

    constructor(id: number, reel: RynxState[], currIndex: number = 0) {
        this.id = id;
        this.actions = [Action.FLIP];
        this.actionTiming = [[Action.FLIP, 1]];
        this.states = [[Action.FLIP, reel]];
        this.currentIndex = currIndex;
    }

    clone(): RynxUnit {
        return new RynxUnit(this.id, this.states[0][1] as RynxState[], this.currentIndex);
    }
}

export let isRynxHardware = (x: HardwareInterface): x is RynxHardware => {
    return x instanceof RynxHardware;
}

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
    estimatedDurationMs: number = 0;

    constructor(units: RynxUnit[], indexToCoord: Map<number, [number, number]>, unitAdjacency: (toCheck: UnitId) => UnitId[], sim: RynxDisplay | null) {
        this.units = units;
        this.actionDurations = new Map();
        this.actionDurations.set(units[0].actionTiming[0][0], units[0].actionTiming[0][1]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = (coord: [number, number]) => this.indexToCoord.entries().find(([k, v]) => v[0] == coord[0] && v[1] == coord[1])![0];
        this.unitAdjacency = unitAdjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];
            return [[otherIds, time],
            [ids, incrementTime(time, this.actionDurations.get(Action.FLIP)!)]] as [UnitId[], Time][];
        }

        this.idsToStates = new Map(units.map(u => [u.id, u.states[0][1][u.currentIndex] as State]));

        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        }

        this.actionsToHardwareAction = (_action: Action, id: UnitId[], _time: Time): [UnitId, State][] => {
            // one FLIP advances the wheel one segment: the next state is simply
            // the next window along the reel, wrapping at the end
            let actions: [UnitId, State][] = [];
            for (let i of id) {
                let unit: RynxUnit = this.units.find(u => u.id == i)! as RynxUnit;
                const reel = unit.states[0][1];
                unit.currentIndex = (unit.currentIndex + 1) % reel.length;
                const newState = reel[unit.currentIndex];
                this.idsToStates.set(i, newState);
                actions.push([i, newState]);
            }
            return actions;
        }

        this.sim = sim;
    }

    // FLIPs needed to spin from the current window to `target` — wheels only
    // spin forward, so this is the forward distance around the reel. Named to
    // match SplitflapHardware so the flip-based transitions (which gate on
    // isSplitflapHardware and call computeFlipDistance) drive Rynx unchanged.
    computeFlipDistance(unit: RynxUnit, target: RynxState): number {
        const states = unit.states[0][1];
        const end = states.findIndex(s => s.id == target.id);
        if (end === -1) {
            throw new Error(`state ${target.id} is not on unit ${unit.id}'s reel`);
        }
        return (end - unit.currentIndex + states.length) % states.length;
    }

    // a Rynx display is one row of wheels (each wheel is a 1x5 column of pixels)
    static Row(numWheels: number, container?: HTMLElement, wheelPattern?: number[]) {
        const pattern = wheelPattern ?? deBruijn(2, WINDOW_ROWS);
        const reel = rynxReel(pattern);
        const indexToCoord = new Map<number, [number, number]>();
        const unitList = [...new Array(numWheels).keys()].map(i => {
            indexToCoord.set(i, [i, 0]);
            return new RynxUnit(i, reel);
        });

        const adjacency = (i: UnitId) =>
            [i - 1, i + 1].filter(n => n >= 0 && n < numWheels);

        return new RynxHardware(unitList, indexToCoord, adjacency,
            new RynxDisplay({ numWheels, container, wheelPattern: pattern }));
    }

    static Headless(numWheels: number, wheelPattern?: number[]) {
        const pattern = wheelPattern ?? deBruijn(2, WINDOW_ROWS);
        const reel = rynxReel(pattern);
        const indexToCoord = new Map<number, [number, number]>();
        const unitList = [...new Array(numWheels).keys()].map(i => {
            indexToCoord.set(i, [i, 0]);
            return new RynxUnit(i, reel);
        });
        const adjacency = (i: UnitId) =>
            [i - 1, i + 1].filter(n => n >= 0 && n < numWheels);

        return new RynxHardware(unitList, indexToCoord, adjacency, null);
    }

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.actionDurations.get(Action.FLIP)! + time[2];
        }
    }

    /**
     * Turn a GroupAction schedule (logical flip-time units on tPlus) into the
     * StepSchedule that RynxDisplay.animate() consumes.
     *
     * Timing model, following SplitflapHardware.compile: one logical time unit
     * spans exactly one full step, i.e. framesPerStep animation ticks. So FLIPs
     * scheduled 1 unit apart run back to back (hold 0), and a gap of g units
     * becomes a hold of (g - 1) * framesPerStep ticks — the realized period is
     * exactly g logical units, with no cumulative drift.
     */
    compile(groupActions: GroupAction[]) {
        if (!this.sim) throw new Error('Cannot compile: use RynxHardware.Row() to get a hardware with a display.');

        const flipDuration = this.actionDurations.get(Action.FLIP)!; // logical units per step
        const ticksPerUnit = this.sim.framesPerStep;

        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        this.units.forEach(u => unitAvailableAt.set(u.id, 0));

        // when each unit flips, in logical time
        const flipTimes = new Map<UnitId, number[]>();

        const sorted = [...groupActions].sort((a, b) => a.tPlus - b.tPlus);
        for (const ga of sorted) {
            const time = this.getRealTiming(ga.tPlus);
            for (const [actionType, ids] of ga.actions) {
                for (const id of ids) {
                    const unit = this.units.find(u => u.id == id)! as RynxUnit;
                    if (!(unit.actions.includes(actionType) &&
                        unitAvailableAt.get(id) != undefined && unitAvailableAt.get(id)! <= time)) {
                        console.log("id, time, availableAt, action", id, time, unitAvailableAt.get(id), getActionStr(actionType));
                        throw new Error("could not compile");
                    }
                    if (!flipTimes.has(id)) flipTimes.set(id, []);
                    flipTimes.get(id)!.push(time);
                }

                // advance the reel bookkeeping so idsToStates tracks what the
                // display will show after this action
                this.actionsToHardwareAction(actionType, ids, time);

                let nextAvailable = this.allowedNextActive(actionType, ids, time);
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));
                for (let [nextIds, interval] of nextAvailable) {
                    nextIds.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }
            }
        }

        // per-unit holds before each step, in animation ticks
        const tickSchedule = new Map<UnitId, number[]>();
        let lastEnd = 0;
        for (const [id, times] of flipTimes) {
            times.sort((a, b) => a - b);
            const holds: number[] = [];
            let prevEnd = 0; // logical time the previous step's motion finishes
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
            if (!holds || s >= holds.length) return undefined;
            return holds[s];
        };

        // last logical end × ticks/unit ÷ 60fps
        this.estimatedDurationMs = lastEnd * ticksPerUnit / 60 * 1000;

        this.sim.resetAnimation(schedule);
    }
}

///////////////

export class BrixelState implements State {
    id: StateId;
    getId(): StateId {
        return this.id;
    }

    constructor(angleDeg: number) {
        this.id = angleDeg;
    }
}

export class BrixelUnit implements Unit {
    id: number;
    actions: Action[];
    actionTiming: [Action, number][];
    states: [Action, State[]][];

    constructor(id: number) {
        this.id = id;
        this.actions = [Action.INCREMENT, Action.DECREMENT];
        this.actionTiming = [[Action.INCREMENT, 1], [Action.DECREMENT, 1]];
        this.states = [[Action.INCREMENT, [...new Array(360)].map(i => new BrixelState(i))],
        [Action.DECREMENT, [...new Array(360)].map(i => new BrixelState(360 - i))]]; // I should use this instead...
    }

    clone(): BrixelUnit {
        return new BrixelUnit(this.id);
    }
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


    constructor(units: Unit[], indexToCoord: Map<number, [number, number]>, unitAdjacency: (toCheck: UnitId) => UnitId[], sim: BrixelDisplay) {
        this.units = units;
        this.actionDurations = new Map();
        this.actionDurations.set(units[0].actionTiming[0][0], units[0].actionTiming[0][1]);
        this.actionDurations.set(units[0].actionTiming[1][0], units[0].actionTiming[1][1]);
        this.indexToCoord = indexToCoord;
        this.coordToIndex = (coord: [number, number]) => this.indexToCoord.entries().find(([k, v]) => v[0] == coord[0] && v[1] == coord[1])![0];
        this.unitAdjacency = unitAdjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];
            console.log("time, otherTime, incDuration", time, time, incrementTime(time, this.actionDurations.get(Action.INCREMENT)!));

            
            // I think I see the problem... each increment is forcing action to change.
            console.log("new time for otherids is ", time, otherIds)
            return [[otherIds, 0],
            // return [[otherIds, time],
            // return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.actionDurations.get(Action.INCREMENT)!)]] as [UnitId[], Time][];
        }

        this.idsToStates = new Map(this.units.map(u => u.id).map(u => [u, new BrixelState(0)]));


        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        }

        this.actionsToHardwareAction = (action: Action, id: UnitId[], time: Time): [UnitId, State][] => {
            // generate a new set of actions.
            let actions: [UnitId, State][] = [];
            for (let i of id) {
                let currState = this.idsToStates.get(i)!;
                let newState = new BrixelState(currState.getId() as number + (action == Action.INCREMENT ? 1 : -1));
                actions.push([i, newState])
                this.idsToStates.set(i, newState);
            }

            return actions;
        }

        this.sim = sim;

    }

    static Rectangular(width: number, height: number) {
        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => new BrixelUnit(i * width + j)).flat()).flat();

        let indexToCoord = new Map<number, [number, number]>();

        unitList.forEach(u => indexToCoord.set(u.id, [Math.floor(u.id / width), u.id % width]))
        console.log(indexToCoord)
        let adjacency = (i: UnitId) => {
            let neighbours: UnitId[] = [];
            // if we're at the edge, don't include some:

            let xCoord = i % width;
            let yCoord = Math.floor(i / width);

            for (let yPlus of [-1, 0, 1]) {
                for (let xPlus of [-1, 0, 1]) {
                    if (!((xPlus == 0 && yPlus == 0) ||
                        (xCoord + xPlus >= width || xCoord + xPlus < 0
                            || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                        neighbours.push(i + yPlus * width + xPlus);
                    }
                }
            }
            console.log(neighbours);
            return neighbours;
        }

        // let coordToIndex = (n: [number, number]) => {
        //     // console.log("check: ", width);
        //     // console.log("check: ", n[0], n[1])
        //     return n[0] * width + n[1]
        // };


        return new BrixelSimHardware(unitList, indexToCoord, adjacency, new BrixelDisplay(width, height));
    }

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.actionDurations.get(Action.INCREMENT)! + time[2];
        }
    }

    compile(groupActions: GroupAction[]) {
        console.log(groupActions)

        let allStates: [Time, UnitId, number][] = [];

        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        // let cumulativeTime = 0;
        let lastTime = 0;
        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));

        // at the very beginning, they are all available
        for (let ga of groupActions) {
            let time = this.getRealTiming(ga.tPlus);
            // cumulativeTime += time;
            // console.log("updating time!", cumulativeTime, time)
            let possibleTime // keep track.... 
            let actionSet = ga.actions;
            for (let action of actionSet) {
                let actionType: Action = action[0];
                let units: Unit[] = action[1].map(i => this.units.find(u => u.id == i)!);

                // first, I need to check the timing by inputting the group action and seeing 
                // if it's possible.
                // first, make sure we can do everything simultaneously


                console.log(unitAvailableAt)
                let violations = false;
                for (let unit of units) {
                    // do we actually know what the action is?
                    if (!(unit.actions.includes(action[0]) &&
                        // and is current time at least later than next available time?
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= time))) {

                        console.log("unit can perform action: ", unit.actions.includes(action[0]))
                        console.log("unit is available at ", unitAvailableAt.get(unit.id))
                        console.log("and this is less than current time? ", unitAvailableAt.get(unit.id)! <= time)
                        console.log("id, time, availableAt, action", unit.id, time, unitAvailableAt.get(unit.id), getActionStr(actionType));
                        throw new Error("could not compile");

                    }
                }

                let states = this.actionsToHardwareAction(actionType, action[1], time - lastTime);
                allStates = allStates.concat(states.map(tuple => [tuple[0], time, tuple[1].getId()] as [Time, UnitId, number]));
                console.log(allStates)
                console.log(groupActions)

                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                console.log("otherids ", units.map(u => u.id), time)
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                console.log(nextAvailable)
                console.log("updating to ", nextAvailable);
                for (let [ids, interval] of nextAvailable) {
                    // console.log(cumulativeTime + this.getRealTiming(interval))

                    ids.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }

            }
            lastTime = time;


            this.sim.setAnimationSequence(allStates);
        }
    }
}


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
    filename: string = "";

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], indexToCoord: Map<number, [number, number]>) {
        this.flipDurationMS = 1;
        this.actionDurations.set(Action.FLIP, this.flipDurationMS);
        this.units = units;
        this.unitIdToUnit = new Map();
        for (let u of this.units.flat()) {
            this.unitIdToUnit.set(u.id, u);
        }

        this.indexToCoord = indexToCoord;
        this.coordToIndex = (coord: [number, number]) => this.indexToCoord.entries().find(([k, v]) => v[0] == coord[0] && v[1] == coord[1])![0];
        this.unitAdjacency = adjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];
            return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.flipDurationMS)]] as [UnitId[], Time][];
        }


        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        }

        this.actionsToHardwareAction = (action: Action, ids: UnitId[], time: Time): [UnitId, State][] => {
            if (this.filename) {
                let str = "";
                if (this.getRealTiming(time) != 0) {
                    str += `wait ${time}\n`;
                }
                str += (ids.map(id => `${actionToString(action)} ${id}`)).join("\n") + "\n";
                fs.appendFileSync(this.filename, str);
            } else {
                ids.forEach(id => console.log(`${action}, ${id}`));
                console.log(`wait ${time}`);
            }

            // unimplemented
            return [];
        }

    }

    compileToFile(groupActions: GroupAction[], fileName: string) {
        this.filename = fileName;
        fs.writeFileSync(this.filename, "");
        this.compile(groupActions);
    }

    compile(groupActions: GroupAction[]) {
        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        // let cumulativeTime = 0;
        let lastTime = 0;
        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));

        // at the very beginning, they are all available
        for (let ga of groupActions) {
            let time = this.getRealTiming(ga.tPlus);
            // cumulativeTime += time;
            // console.log("updating time!", cumulativeTime, time)
            let possibleTime // keep track.... 
            let actionSet = ga.actions;
            for (let action of actionSet) {
                let actionType: Action = action[0];
                let units: Unit[] = action[1].map(i => this.unitIdToUnit.get(i)!);

                // first, I need to check the timing by inputting the group action and seeing 
                // if it's possible.
                // first, make sure we can do everything simultaneously


                console.log(unitAvailableAt)
                let violations = false;
                for (let unit of units) {
                    // do we actually know what the action is?
                    if (!(unit.actions.includes(action[0]) &&
                        // and is current time at least later than next available time?
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= time))) {

                        console.log(unit.actions.includes(action[0]))
                        console.log(unitAvailableAt.get(unit.id))
                        console.log(unitAvailableAt.get(unit.id)! <= time)
                        console.log(unit.id, time, time, unitAvailableAt.get(unit.id), actionType);
                        throw new Error("could not compile");

                    }
                }

                this.actionsToHardwareAction(actionType, action[1], time - lastTime);


                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                console.log(nextAvailable)
                for (let [ids, interval] of nextAvailable) {
                    // console.log(cumulativeTime + this.getRealTiming(interval))
                    ids.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }

            }
            lastTime = time;

        }
    }

    static Rectangular(width: number, height: number) {
        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => new FlipdotUnit(i * height + j)).flat()).flat();

        let indexToCoord = new Map<number, [number, number]>();

        unitList.forEach(u => indexToCoord.set(u.id, [Math.floor(u.id / width), u.id % width]))

        let adjacency = (i: UnitId) => {
            let neighbours: UnitId[] = [];
            // if we're at the edge, don't include some:

            let xCoord = i % width;
            let yCoord = Math.floor(i / width);

            for (let yPlus of [-1, 0, 1]) {
                for (let xPlus of [-1, 0, 1]) {
                    if (!((xPlus == 0 && yPlus == 0) ||
                        (xCoord + xPlus >= width || xCoord + xPlus < 0
                            || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                        neighbours.push(i + yPlus * width + xPlus);
                    }
                }
            }
            console.log(neighbours);
            return neighbours;
        }

        // let coordToIndex = (n: [number, number]) => {
        //     // console.log("check: ", width);
        //     // console.log("check: ", n[0], n[1])
        //     return n[0] * width + n[1]
        // };


        return new FlipdotHardware(unitList, adjacency, indexToCoord);
    }


}


export class FlipdotSimHardware implements HardwareInterface {
    flipDurationMS: number = 1;
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
    totalNumFrames: number = 0;

    dirsToTime: Map<string, (t: Time) => number[]> = new Map();
    meshLocationStr: string = "";
    estimatedDurationMs: number = 0;

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
    }

    async finalize3D() {
        console.log("start")
        this.simulation.makeArbitraryMeshDiscSetup(this.meshLocationStr).catch(_ => {
            console.log("done")
            return new Promise(i => i);
        });

    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], dimensions?: [number, number], meshInput?: string, frontColour?: string, backColour?: string) {
        this.flipDurationMS = 1;
        this.actionDurations.set(Action.FLIP, this.flipDurationMS);
        console.log(dimensions)
        if (dimensions != undefined) {
            console.log("this half", dimensions)
            let [height, width] = dimensions;
            let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => new FlipdotUnit(i * width + j)).flat()).flat();

            let adjacency = (i: UnitId) => {
                let neighbours: UnitId[] = [];
                // if we're at the edge, don't include some:

                let xCoord = i % width;
                let yCoord = Math.floor(i / width);

                for (let yPlus of [-1, 0, 1]) {
                    for (let xPlus of [-1, 0, 1]) {
                        if (!((xPlus == 0 && yPlus == 0) ||
                            (xCoord + xPlus >= width || xCoord + xPlus < 0
                                || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                            neighbours.push(i + yPlus * width + xPlus);
                        }
                    }
                }
                // console.log(neighbours);
                return neighbours;
            }

            this.units = unitList;
            this.indexToCoord = new Map(unitList.map(u => [u.id, [u.id % width, Math.floor(u.id / width)]]));
            // this.indexToCoord = new Map(unitList.map(u => [u.id, [Math.floor(u.id / width), u.id % width]]));
            this.unitAdjacency = adjacency;


            this.coordToIndex = (n: [number, number]) => {
                // console.log("check: ", width);
                // console.log("check: ", n[0], n[1], n[0] * width + n[1])
                // console.log(n)
                return n[1] * width + n[0]
                // return n[0] * width + n[1]
            };

            this.simulation = new RowOfDiscs(width, height, true, undefined, frontColour, backColour);


        } else {
            console.log("in the other constructor half");
            this.units = units;
            this.unitAdjacency = adjacency;
            this.simulation = new RowOfDiscs(1, 1, false, meshInput);
            if (meshInput == undefined) {
                throw new Error("No mesh input and not flat");
            }
            this.meshLocationStr = meshInput;
            this.coordToIndex = i => i[0] // need to fix this
            // I need this to look like a UV map basically 
            this.indexToCoord = new Map(); // need to fix this 
        }

        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        }

        this.unitIdToUnit = new Map();
        console.log(this.units)
        for (let u of this.units) {
            this.unitIdToUnit.set(u.id, u);
        }


        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];
            return [[otherIds, incrementTime(time, 0)],
            // return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.flipDurationMS)]] as [UnitId[], Time][];
        }

        // this is time over which you complete the action? what is the MEANING of time 
        // how long does it take to do this basically
        this.actionsToHardwareAction = (action: Action, ids: UnitId[], time: Time): [UnitId, State][] => {
            // do this and then wait some cycles...
            // I think I just do this but, the simulation can't do arbitrary setups.
            let closestInterval = this.getRealTiming(time) == 0 ? 0 : Math.round(this.getRealTiming(time) / this.flipDurationMS);
            // so I need to insert this much "dead time"
            let idxes: number[][] = [];
            let blankIdxes: number[][] = [];
            if (dimensions) {
                // console.log("dimensions are", dimensions)
                let [height, width] = dimensions;
                idxes = [...new Array(height)].map(_ => []);
                blankIdxes = idxes.map(i => i.map(u => u));
                // console.log(blankIdxes)
                ids.forEach(i => idxes[Math.floor(i / width)].push(i % width))
            } else {
                idxes = [ids];
                blankIdxes = [[]];
            }
            let originalAnim = this.simulation.nextFlipGenerator;

            let currNumFrames = this.totalNumFrames;

            // here's what I do: if this is lower than the current number, delegate
            this.simulation.resetAnimation(i => {
                // console.log(`i is ${i}, currentNumFrames is ${currNumFrames}, this.totalNumFrames is ${this.totalNumFrames}, closestInterval is ${closestInterval}`)
                if (i >= currNumFrames) {
                    if (i - currNumFrames < closestInterval) {
                        // console.log("returning wait")
                        // console.log(blankIdxes)

                        return blankIdxes;
                    } else if (i - currNumFrames == closestInterval) {
                        // console.log("returning current index")
                        return idxes;
                    } else {
                        // console.log("returning wait 2")
                        // console.log(blankIdxes)
                        return blankIdxes;
                    }

                } else {
                    // console.log("counting up:", i, currNumFrames)
                    return originalAnim(i);
                }
            })

            this.totalNumFrames += closestInterval + 1;
            return [];
        }

    }


    compile(groupActions: GroupAction[]) {
        //// just sort group actions first?
        
        groupActions.sort((a, b) => a.tPlus - b.tPlus);

        console.log(groupActions)
        console.log(groupActions.map(ga => ga.tPlus + " " + ga.actions.map(a => a[1])))
        
        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        // let cumulativeTime = 0;
        let lastTime = 0;
        // console.log("units before and after", this.units)

        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));
        console.log(unitAvailableAt)

        // console.log("units before and after", this.units)


        // at the very beginning, they are all available
        for (let ga of groupActions) {
            console.log(ga)
            let time = this.getRealTiming(ga.tPlus);
            // console.log(time)
            // cumulativeTime += time;
            // console.log("updating time!", cumulativeTime, time)
            let possibleTime // keep track.... 
            let actionSet = ga.actions;

            for (let action of actionSet) {
                // console.log(action)
                let actionType: Action = action[0];
                let unitsInUse: Unit[] = action[1].map(i => this.unitIdToUnit.get(i)!);

                if (unitsInUse.some(u => u == undefined)) {
                    action[1].forEach(i => console.log(i, this.unitIdToUnit.get(i)!))
                    throw new Error("undefined units used in action")
                }
                // console.log(action[1]);
                // console.log(this.units.map(u => u.id))
                // console.log(unitsInUse)
                // first, I need to check the timing by inputting the group action and seeing 
                // if it's possible.
                // first, make sure we can do everything simultaneously


                // console.log(unitAvailableAt)
                // console.log(this.unitIdToUnit)

                // console.log(this)
                for (let unit of unitsInUse) {
                    // console.log(action[1])
                    let all = [...this.unitIdToUnit.keys()];
                    all.sort((a, b) => b - a)
                    // console.log(all)
                    // console.log(unit)
                    // do we actually know what the action is?
                    // console.log(unitsInUse)
                    if (!(unit.actions.includes(action[0]) &&
                        // and is current time at least later than next available time?
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= time))) {

                        console.log("issue!", time, ga.tPlus)
                        console.log(unitsInUse)
                        console.log(unit)
                        console.log(groupActions)
                        console.log(action)
                        console.log("Actions is part of the unit's action set?", unit.actions.includes(action[0]));
                        console.log("Unit is able to act? (Defined acting time)", unitAvailableAt.get(unit.id));
                        console.log("Acting time precedes current time?", unitAvailableAt.get(unit.id)! <= time);
                        console.log(`id ${unit.id} is trying to ${actionType} at ${time} but is available at ${unitAvailableAt.get(unit.id)}`);
                        console.log(unitAvailableAt)

                        throw new Error("could not compile");

                    }
                }

                console.log(action[1], time - lastTime)
                this.actionsToHardwareAction(actionType, action[1], time - lastTime);


                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // console.log(nextAvailable)
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                // console.log(nextAvailable)
                for (let [ids, interval] of nextAvailable) {
                    // console.log(cumulativeTime + this.getRealTiming(interval))
                    // console.log("updating ids!")
                    ids.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }

            }
            lastTime = time;

        }

        // Estimate wall-clock duration: totalNumFrames flip-cycles × FULL_CYCLE_LENGTH RAF frames ÷ 60fps
        this.estimatedDurationMs = this.totalNumFrames * FULL_CYCLE_LENGTH / 60 * 1000;
    }


}

// Build a FlipdotSimHardware from a UV DotField, using the UV grid coordinates
// directly as the unit coordinate space.
//
// This is HEADLESS: it does NOT create a RowOfDiscs (whose constructor spins up
// its own WebGLRenderer and appends a canvas to #render). The caller owns the
// visual -- e.g. the 3d.ts viewer renders the discs itself. The returned
// instance carries the mapping + timing logic (indexToCoord, coordToIndex,
// unitAdjacency, timeFrontier), which is all the order/transition machinery
// needs. simulation-driven methods (actionsToHardwareAction) are stubbed.
//
// Unit ids are indices into field.dots (== the InstancedMesh instance order),
// so a UnitId from an order maps straight to a disc to light up.
export function hardwareFromDotField(field: DotField): FlipdotSimHardware {
    const dots = field.dots;
    const dotId = new Map<Dot, number>();
    dots.forEach((d, i) => dotId.set(d, i));

    const units = dots.map((_, i) => new FlipdotUnit(i));

    // indexToCoord: disc -> its UV grid cell. Merged discs use their
    // representative cell's coord (a valid UV grid location).
    const indexToCoord = new Map<number, [number, number]>(
        dots.map((d, i) => [i, [d.gx, d.gy]] as [number, [number, number]])
    );

    // coordToIndex: UV grid cell -> disc id (-1 for gaps). Merged cells resolve
    // to their shared disc automatically because grid[y][x] points at it.
    const coordToIndex = ([x, y]: [number, number]): number => {
        const row = field.grid[y];
        const cell = row ? row[x] : undefined;
        if (!cell) return -1;
        const id = dotId.get(cell);
        return id === undefined ? -1 : id;
    };

    // Adjacency: 8-neighbours on the UV grid, mapped to disc ids. Built by
    // scanning the grid so edges from every cell of a merged disc are unioned.
    const adj = new Map<number, Set<number>>();
    units.forEach((u) => adj.set(u.id, new Set()));
    for (let y = 0; y < field.height; y++) {
        for (let x = 0; x < field.width; x++) {
            const cell = field.grid[y][x];
            if (!cell) continue;
            const a = dotId.get(cell)!;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const ny = y + dy, nx = x + dx;
                    if (ny < 0 || nx < 0 || ny >= field.height || nx >= field.width) continue;
                    const ncell = field.grid[ny][nx];
                    if (!ncell) continue;
                    const b = dotId.get(ncell)!;
                    if (b !== a) adj.get(a)!.add(b);
                }
            }
        }
    }
    const unitAdjacency = (id: UnitId): UnitId[] => [...(adj.get(id) ?? [])];

    // Assemble without running the heavy constructor (which would build a
    // RowOfDiscs). We set every field the mapping/timing paths touch.
    const hw: FlipdotSimHardware = Object.create(FlipdotSimHardware.prototype);
    hw.flipDurationMS = 1;
    hw.actionDurations = new Map([[Action.FLIP, 1]]);
    hw.units = units;
    hw.unitIdToUnit = new Map(units.map((u) => [u.id, u]));
    hw.unitAdjacency = unitAdjacency;
    hw.indexToCoord = indexToCoord;
    hw.coordToIndex = coordToIndex;
    hw.dirsToTime = new Map();
    hw.totalNumFrames = 0;
    hw.meshLocationStr = "";
    hw.estimatedDurationMs = 0;
    // Headless: no RowOfDiscs. Never dereferenced unless simulation-driven
    // methods are called, which the viewer/order path does not do.
    hw.simulation = null as unknown as RowOfDiscs;

    hw.timeFrontier = (start: number, dir: [number, number]) => {
        const key = `${start}|${dir[0]}|${dir[1]}`;
        const cached = hw.dirsToTime.get(key);
        if (cached) return cached;
        const fn = generateDirection(start, dir, hw);
        hw.dirsToTime.set(key, fn.atTime);
        return fn.atTime;
    };
    hw.allowedNextActive = (_action: Action, ids: UnitId[], time: Time) => {
        const otherIds = [...new Set(units.map((u) => u.id)).difference(new Set(ids))];
        return [[otherIds, incrementTime(time, 0)],
                [ids, incrementTime(time, hw.flipDurationMS)]] as [UnitId[], Time][];
    };
    hw.actionsToHardwareAction = () => []; // headless: no simulation to drive

    return hw;
}

// Async counterpart of FlipdotSimHardware. Drives a RowOfDiscsAsync where
// every disc owns its animation, so we can dispatch flips at any frame
// rather than aligning to FULL_CYCLE_LENGTH boundaries.
//
// `framesPerMs` is the conversion from GroupAction.tPlus to simulation
// frames. Default of NUM_FRAMES_ROTATING means one tPlus unit equals one
// flip-rotation duration (≈100ms wall clock at 60fps with the default
// constants). Lower it to stretch programs out in time, raise it for
// tighter packing.
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
    meshLocationStr: string = "";
    estimatedDurationMs: number = 0;

    private dims?: [number, number];

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.framesPerMs + time[2];
        }
    }

    async finalize3D() {
        this.simulation.makeArbitraryMeshDiscSetup(this.meshLocationStr).catch(_ => {
            return new Promise(i => i);
        });
    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], dimensions?: [number, number], meshInput?: string) {
        this.actionDurations.set(Action.FLIP, 1);

        if (dimensions != undefined) {
            this.dims = dimensions;
            let [height, width] = dimensions;
            let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => new FlipdotUnit(i * width + j)).flat()).flat();

            let adj = (i: UnitId) => {
                let neighbours: UnitId[] = [];
                let xCoord = i % width;
                let yCoord = Math.floor(i / width);
                for (let yPlus of [-1, 0, 1]) {
                    for (let xPlus of [-1, 0, 1]) {
                        if (!((xPlus == 0 && yPlus == 0) ||
                            (xCoord + xPlus >= width || xCoord + xPlus < 0
                                || yCoord + yPlus < 0 || yCoord + yPlus >= height))) {
                            neighbours.push(i + yPlus * width + xPlus);
                        }
                    }
                }
                return neighbours;
            };

            this.units = unitList;
            this.indexToCoord = new Map(unitList.map(u => [u.id, [u.id % width, Math.floor(u.id / width)] as [number, number]]));
            this.unitAdjacency = adj;
            this.coordToIndex = (n: [number, number]) => n[1] * width + n[0];
            this.simulation = new RowOfDiscsAsync(width, height);
        } else {
            this.units = units;
            this.unitAdjacency = adjacency;
            this.simulation = new RowOfDiscsAsync(1, 1, false, meshInput);
            if (meshInput == undefined) {
                throw new Error("No mesh input and not flat");
            }
            this.meshLocationStr = meshInput;
            this.coordToIndex = i => i[0];
            this.indexToCoord = new Map();
        }

        this.timeFrontier = (start: number, dir: [number, number]): (t: Time) => UnitId[] => {
            let key = `${start}|${dir[0]}|${dir[1]}`;
            if (this.dirsToTime.has(key)) {
                return this.dirsToTime.get(key)!;
            } else {
                let fn = generateDirection(start, dir, this);
                this.dirsToTime.set(key, fn.atTime);
                return fn.atTime;
            }
        };

        this.unitIdToUnit = new Map();
        for (let u of this.units) {
            this.unitIdToUnit.set(u.id, u);
        }

        // Kept for HardwareInterface conformance; the async pipeline pre-builds
        // its schedule in compile() rather than going through these hooks.
        this.allowedNextActive = (_action: Action, ids: UnitId[], time: Time) => {
            let otherIds = [...new Set(this.units.map(r => r.id)).difference(new Set(ids))];
            return [[otherIds, time as number],
                    [ids, (time as number) + 1]] as [UnitId[], Time][];
        };

        this.actionsToHardwareAction = (_action: Action, _ids: UnitId[], _time: Time): [UnitId, State][] => {
            return [];
        };
    }

    compile(groupActions: GroupAction[]) {
        let sorted = [...groupActions].sort((a, b) => a.tPlus - b.tPlus);
        let height = this.dims ? this.dims[0] : 1;
        let width = this.dims ? this.dims[1] : this.units.length;

        // Pre-build the full timeline: frame -> per-row indices to start
        // flipping at that frame. We snapshot framesPerMs at compile time
        // so later changes to that property don't retroactively retime
        // already-scheduled flips.
        let framesPerMs = this.framesPerMs;
        let schedule: Map<number, number[][]> = new Map();
        let lastFrame = 0;

        let emptyRows = (): number[][] => [...Array(height)].map(_ => []);

        for (let ga of sorted) {
            let frame = Math.round(this.getRealTiming(ga.tPlus) * framesPerMs);

            let entry = schedule.get(frame);
            if (!entry) {
                entry = emptyRows();
                schedule.set(frame, entry);
            }

            for (let action of ga.actions) {
                if (action[0] !== Action.FLIP) continue;
                for (let id of action[1]) {
                    let row = this.dims ? Math.floor(id / width) : 0;
                    let col = this.dims ? id % width : id;
                    entry[row].push(col);
                }
            }

            if (frame > lastFrame) lastFrame = frame;
        }

        this.simulation.resetAnimation((frame: number) => {
            return schedule.get(frame) ?? emptyRows();
        });

        // Last scheduled start + a full rotation tail, converted to ms at 60fps.
        this.estimatedDurationMs = (lastFrame + this.simulation.numFramesRotating) / 60 * 1000;
    }
}

export class FlipdotState extends State { }

export class FlipdotUnit implements Unit {
    id: UnitId;
    actionTiming: [Action, number][] = [[Action.FLIP, 1]];
    actions: Action[];
    states: [Action, State[]][];

    constructor(id: UnitId) {
        this.id = id;
        this.actions = [Action.FLIP];
        this.states = [[Action.FLIP, [new FlipdotState(0), new FlipdotState(1)]]];
    }

    clone(): Unit {
        return new FlipdotUnit(this.id);
    }
}



// function diffIndices(a: Target, b: Target, h: HardwareInterface): number[] {
//     // todo: need to check the matching on the GLOBAL grid.
//     let shapeA = a.draw();
//     let shapeB = b.draw();
//     let [ax, ay] = a.position;
//     let [bx, by] = b.position;

//     let coords: [number, number][] = [];

//     let startRealRow = ay < by ? ay : by;
//     let startRealCol = ax < bx ? ax : bx;
//     for (let i = 0; i < Math.max(shapeA.length, shapeB.length); i++) {
//         let realRow = startRealRow + i;

//         let shapeARowLength = i < shapeA.length ? shapeA[i].length : 0;
//         let shapeBRowLength = i < shapeB.length ? shapeB[i].length : 0;

//         for (let j = 0; j < Math.max(shapeARowLength, shapeBRowLength); j++) {
//             // everything that falls outside the shapes should count right.... argh
//             let realCol = startRealCol + j;

//             // first, if I'm outside the bounds of one or the other, let me just add everything.
//             if (shapeARowLength == 0 || shapeBRowLength == 0 || j >= shapeARowLength || j >= shapeBRowLength) {
//                 coords.push([i, j]);
//             }

//             // second, let's compare.
//             let compA = shapeA[realRow - ay][realCol - ax];
//             let compB = shapeB[realRow - by][realCol - bx];

//             if (compA != compB) {
//                 coords.push([i,j])
//             }
//             // great. now, I ask: do they match?


//         }
//     }

//     let differences: number[] = coords.map(c => h.coordToIndex(c));

//     return differences;
// }



let convertSyncedSequence = (frames: number[][], pauses: number[][], cycles: number[][]): (f: number) => (i: number) => [number | undefined, number | undefined] => {

    let countSinceLastFrame: number[] = pauses[0].map(_ => 0);

    // maybe I don't need undefined, it's just the end of the list?
    // this one is arranged OBJECT then FRAME
    let perPixelReturn: number[][] = pauses[0].map(_ => []);
    let cyclesReturn: number[][] = pauses[0].map(_ => []);

    for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
        for (let i = 0; i < pauses[frameIdx].length; i++) {
            // console.log(frameIdx)
            // console.log(i)
            if (frames[frameIdx].includes(i)) {
                // each thing that appears should reset the count...
                // let count = i > 0 ? countSinceLastFrame[i - 1] : countSinceLastFrame[i];
                let count = countSinceLastFrame[i];
                // or should this be according to the previous one?

                console.log(frames)
                console.log(frameIdx, count)
                console.log(countSinceLastFrame)
                perPixelReturn[i].push((count + 1) * pauses[frameIdx - count][i]);
                cyclesReturn[i].push((count + 1) * cycles[frameIdx - count][i]);
                countSinceLastFrame[i] = 0;
            } else {
                // console.log("no included in: ", i, frames[frameIdx]);
                countSinceLastFrame[i] += 1;
            }
        }
    }

    console.log(perPixelReturn);
    console.log(cyclesReturn)

    // this only lets things loop once!
    let fn = (f: number) => (i: number) => [f < perPixelReturn[i].length ? perPixelReturn[i][f] : undefined, f < cyclesReturn[i].length ? cyclesReturn[i][f] : undefined] as [number | undefined, number | undefined];

    return fn;
}

// let's set up some test cases...


function computeFlipDistance(unit: SplitflapUnit, target: SplitflapState): number {
        const states = unit.states[0][1];
        const start = unit.currentIndex;
        const end = states.findIndex(s => s.id == target.id);

        // console.log(target, states)
        if (start === -1 || end === -1) {
            throw new Error(`Invalid state for unit ${unit.id}`);
        }

        console.log((end - start + states.length) % states.length)

        return (end - start + states.length) % states.length;
    }


export function buildTimeline(
    flipSchedule: Map<UnitId, Time[]>,
    startAt: Time = 0
): GroupAction[] {
    const timeMap = new Map<Time, UnitId[]>();

    for (const [id, times] of flipSchedule) {
        for (const t of times) {
            if (!timeMap.has(t)) timeMap.set(t, []);
            timeMap.get(t)!.push(id);
        }
    }

    return [...timeMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(
            ([t, ids]) =>
                new GroupAction(t + startAt, [[Action.FLIP, ids]])
        );
}

export function scheduleConstantSpeed(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    maxSimultaneousFinishes = Infinity,
): Map<UnitId, Time[]> {
    const schedule = new Map<UnitId, Time[]>();
    const finishBuckets = new Map<Time, UnitId[]>();
    const dt = 1 / flipsPerSecond;

    for (let i = 0; i < units.length; i++) {
        let unit = units[i];
        console.log(unit, targets[i])
        const flips = computeFlipDistance(unit, targets[i]);
        const times: Time[] = [];

        for (let i = 0; i < flips; i++) {
            times.push(i * dt);
        }

        schedule.set(unit.id, times);

        if (times.length === 0) continue;

        const finishTime = times[times.length - 1];

        if (!finishBuckets.has(finishTime)) {
            finishBuckets.set(finishTime, []);
        }
        finishBuckets.get(finishTime)!.push(unit.id);
    }

    // Offset collisions
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
    initializationDelay = 0
): Map<UnitId, Time[]> {
    const schedule = new Map<UnitId, Time[]>();
    const dt = 1 / flipsPerSecond;
    console.log(dt)

    const maxFlips = Math.max(
        ...units.map((u, i) => computeFlipDistance(u, targets[i]))
    );

    const endTime = initializationDelay + maxFlips * dt;

    for (let i = 0; i < units.length; i++) {
        let unit = units[i]
        const flips = computeFlipDistance(unit, targets[i]);
        const startTime = endTime - flips * dt;
        const times: Time[] = [];

        for (let i = 0; i < flips; i++) {
            times.push(startTime + i * dt);
        }

        schedule.set(unit.id, times);
    }

    return schedule;
}

export function scheduleDirectional(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    hardware: SplitflapHardware,
    direction: string
): Map<UnitId, Time[]> {
    const dt = 1 / flipsPerSecond;
    console.log(dt)

    const ordered = [...units].sort((a, b) => {
        const ca = hardware.indexToCoord.get(a.id)!;
        const cb = hardware.indexToCoord.get(b.id)!;

        switch (direction) {
            case "LEFT_TO_RIGHT":
                return ca[0] - cb[0];
            case "RIGHT_TO_LEFT":
                return cb[0] - ca[0];
            case "TOP_TO_BOTTOM":
                return ca[1] - cb[1];
            case "BOTTOM_TO_TOP":
                return cb[1] - ca[1];
        }

        throw new Error("????");
    });

    const schedule = new Map<UnitId, Time[]>();
    let currentEnd = 0;

    for (let i = 0; i < ordered.length; i++) {
        let unit = ordered[i];
        const flips = computeFlipDistance(unit, targets[i]);
        const times: Time[] = [];

        for (let i = 0; i < flips; i++) {
            times.push(currentEnd + i * dt);
            console.log(currentEnd, i, dt, currentEnd + i * dt)
        }

        console.log(times)
        if (times.length > 0) {
            currentEnd = times[times.length - 1] + dt;
        }
        schedule.set(unit.id, times);
    }

    console.log(schedule)

    return schedule;
}


