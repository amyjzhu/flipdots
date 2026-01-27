import * as fs from 'fs';
import { RowOfDiscs } from './flipdisc';
import { parseToGroupAction, Target, CircleTarget } from './language2';
import { BrixelDisplay } from './brixel';
import { SplitFlapDisplay } from './splitflap';
import { getImages } from './util';
import { ALPHABET_WITH_EXCLAMATION } from './constants';
import { start } from 'repl';
import { generateDirection } from './transitions';


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
    sim: SplitFlapDisplay;

    constructor(units: SplitflapUnit[], indexToCoord: Map<number, [number, number]>, unitAdjacency: (toCheck: UnitId) => UnitId[], sim: SplitFlapDisplay) {
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

    static Rectangular(width: number, height: number, reelConfig: (x: number, y: number) => SplitflapState[]) {

        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => {
            let reel = reelConfig(j, i);
            return new SplitflapUnit(i * width + j, reel)
        }).flat()).flat();

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


        return new SplitflapHardware(unitList, indexToCoord, adjacency, new SplitFlapDisplay(width, height));
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
            const frame = Math.round(ga.tPlus);
            console.log(time, frame)

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

                console.log(nextAvailable)
                console.log("updating to ", nextAvailable);
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
            const animationDurationMs = this.sim.numFramesRotating * msPerTick;

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

        console.log("schedule is ", tickSchedule);
        console.log("schedule is ", scheduled);
        let schedule = (f: number) => {
            return (i: number): [number | undefined, number | undefined] => {
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

            return [[otherIds, time],
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

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], dimensions?: [number, number], meshInput?: string) {
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
            this.indexToCoord = new Map(unitList.map(u => [u.id, [Math.floor(u.id / width), u.id % width]]));
            this.unitAdjacency = adjacency;


            this.coordToIndex = (n: [number, number]) => {
                // console.log("check: ", width);
                // console.log("check: ", n[0], n[1], n[0] * width + n[1])
                // console.log(n)
                return n[0] * width + n[1]
            };

            this.simulation = new RowOfDiscs(width, height);


        } else {
            console.log("in the other constructor half");
            this.units = units;
            this.unitAdjacency = adjacency;
            this.simulation = new RowOfDiscs(1, 1, false);
            if (meshInput == undefined) {
                throw new Error("No mesh input and not flat");
            }
            this.meshLocationStr = meshInput;
            this.coordToIndex = i => i[0] // need to fix this
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
            return [[otherIds, incrementTime(time, 1)],
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
        console.log(groupActions)
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
                let actionType: Action = action[0];
                let unitsInUse: Unit[] = action[1].map(i => this.unitIdToUnit.get(i)!);
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
                    if (!(unit.actions.includes(action[0]) &&
                        // and is current time at least later than next available time?
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= time))) {

                        console.log(action)
                        console.log("Actions is part of the unit's action set?", unit.actions.includes(action[0]));
                        console.log("Unit is able to act? (Defined acting time)", unitAvailableAt.get(unit.id));
                        console.log("Acting time precedes current time?", unitAvailableAt.get(unit.id)! <= time);
                        console.log(`id ${unit.id} is trying to ${actionType} at ${time} but is available at ${unitAvailableAt.get(unit.id)}`);

                        throw new Error("could not compile");

                    }
                }

                // console.log(action[1], time - lastTime)
                this.actionsToHardwareAction(actionType, action[1], time - lastTime);


                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                // console.log(nextAvailable)
                for (let [ids, interval] of nextAvailable) {
                    // console.log(cumulativeTime + this.getRealTiming(interval))
                    console.log("updating ids!")
                    ids.forEach(id => unitAvailableAt.set(id, this.getRealTiming(interval)));
                }

            }
            lastTime = time;

        }
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

if (typeof window != 'undefined') {
    // semantics of timing have changed 
    let teapotExample = "timing: [1,2,3,4,5,6,7,8,9,10]\n\
    filepath: /animations/teapot${i}.png \n\
    objects: [#000000 teapot] \n\
    teapot 0 ->* instantaneous ->* teapot 9"
    // parser(teapotExample);

    // parseToGroupAction(teapotExample);

    let teapot2Example = "timing: [3,6,9,12,16,19,22,26,29,32]\n\
    filepath: /animations/teapot${i}.png \n\
    objects: [#000000 teapot] \n\
    teapot 0 ->* sparkle ->* teapot 9"
    // parser(teapotExample);

    // parseToGroupAction(teapot2Example);


    let wipeExample = "timing: [15,15]\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 1 -> wipe -> rectangle 0";

    // parseToGroupAction(wipeExample);


    let sparkleExample = "timing: [15,15]\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 1 -> sparkle -> rectangle 0";
    // parseToGroupAction(sparkleExample);


    let logoExample = "timing: [15,15]\n\
    filepath: /animations/text-logo${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 0 -> sparkle -> rectangle 1";

    // parseToGroupAction(logoExample);

    let logoBasicExample = "timing: [15,15]\n\
    filepath: /animations/text-logo${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 0 -> instantaneous -> rectangle 1";

    // parseToGroupAction(logoBasicExample);

    let dandelion = "timing: [15,15]\n\
    filepath: /animations/dandelion${i}.png \n\
    objects: [#222034 head] [#d77bba stem] \n\
    head 0 -> sparkle -> head 1";
    // TODO: error with multiple objcts?
    // TODO: the opposite doesn't work - you can't sparkle OUT 
    // parseToGroupAction(dandelion);

    let dandelion_basic = "timing: [15,15]\n\
    filepath: /animations/dandelion${i}.png \n\
    objects: [#222034 head] [#d77bba stem] \n\
    head 0 -> instantaneous -> head 1";
    // TODO: I need some way to bootstrap this
    // TODO: the opposite doesn't work - you can't sparkle OUT 
    // parseToGroupAction(dandelion_basic);


    let offsetGroupActions = (ga: GroupAction[], t: Time): GroupAction[] => {
        return ga.map(g => new GroupAction(g.tPlus + t, g.actions));
    }


    /*
    // let brixels = new BrixelDisplay(10, 20);
    // brixels.setAnimationSequence([[1, 10, 60], [2, 20, 90], [5, 30,60], [2, 30, 15]])
    let brixelHw = BrixelSimHardware.Rectangular(10, 20);

    let actions = new RotateRevealTransition().generateGroupActions(new CircleTarget(1, [5, 5], [10, 20]), new CircleTarget(3, [4, 4], [10, 20]), 200, brixelHw)

    let orrt = new OverrotateRevealTransition();
    orrt.overrotateAt = id => {
        let row = brixelHw.indexToCoord.get(id)![0];
        console.log(row)
        return row == 2 ? 0.6 : row == 3 ? 0.7 : row == 4 ? 0.8 : row == 5 ? 0.9 : 1;
        // return row == 4 ? 0.7 : row == 6 ? 0.9 : 0.8;
        // return 0.7
    }
    let actions1 = orrt.generateGroupActions(new CircleTarget(0, [4, 4], [10, 20]), new CircleTarget(1, [4, 4], [10, 20]), 300, brixelHw);
    let actions2 = orrt.generateGroupActions(new CircleTarget(1, [4, 4], [10, 20]), new CircleTarget(3, [3, 3], [10, 20]), 300, brixelHw);
    let actions3 = orrt.generateGroupActions(new CircleTarget(3, [3, 3], [10, 20]), new CircleTarget(5, [2, 2], [10, 20]), 300, brixelHw);
    // console.log(actions)
    // now, how do I do it so that it takes more time depending on its location?
    let actionsTogether = actions1.concat(offsetGroupActions(actions2, actions1[actions1.length-1].tPlus).concat(offsetGroupActions(actions3, actions2[actions2.length-1].tPlus + actions1[actions1.length-1].tPlus)));
    brixelHw.compile(actionsTogether);

    // let's try to make a splash outwards..
    // I think this is like a 
    // rotate centre, rotate outer ring, rotate even outer ring



    let data = await getImages(["/animations/thinking.png"]);
    let [width, height, rgbFrames] = data;
    let w = width;
    let h = height;
    let frame: boolean[][] = rgbFrames[0].map(row => row.map(c => c[0] != 255 && c[1] != 255 && c[2] != 255));
    let frameUnitId = frame.map((row, i) => row.reduce((soFar: number[], cellVal: boolean, j: number) => {
        if (cellVal) {
            soFar.push(i * width + j);
        }
        return soFar;
    }, [] as number[])).flat();


    let sfhw = SplitflapHardware.Rectangular(w, h, (x: number, y: number) => (ALPHABET_WITH_EXCLAMATION).split("").map(s => new SplitflapState(s)));
    console.log(frameUnitId)

    // start by taking this and converting the image to flips.
    let frame1 = new GroupAction(1, [[Action.FLIP, frameUnitId]]);
    let frame2 = new GroupAction(2, [[Action.FLIP, frameUnitId]]);
    // keeping it at zero breaks first frame
    // let frame1 = new GroupAction(0, [[Action.FLIP, frameUnitId]]);
    console.log(frame1);


    let msgString = "cheese";
    msgString = "ejggug"
    let finalMessage = msgString.split("").map(c => new SplitflapState(c));
    // the message should be from like 12 to 20 in row 7
    let finalState = [...new Array(h * w)].map(j => new SplitflapState(" "));
    [...new Array(msgString.length).keys()].forEach(i => finalState[6 * w + i + 13] = finalMessage[i]);

    // let schedule = scheduleDirectional(
    //     sfhw.units as SplitflapUnit[],
    //     finalState,
    //     1,
    //     sfhw,
    //     "LEFT_TO_RIGHT"
    // );

    let schedule = scheduleConstantSpeed(sfhw.units as SplitflapUnit[], finalState, 1)
    let schedule2 = scheduleDirectional(sfhw.units as SplitflapUnit[], finalState, 1, sfhw, "LEFT_TO_RIGHT");
    let schedule3 = scheduleSyncEnd(sfhw.units as SplitflapUnit[], finalState, 1)
    // console.log(schedule)

    let restGA = buildTimeline(schedule3, 4);
    console.log("frame 1 is ", frame1);
    console.log("other schedule is ", restGA);
    // sfhw.compile([frame1]);
    sfhw.compile([frame1, frame2, ...restGA]);
    // now I want the position of the text.
    // row 7 from 12 to 20
*/

    let threed = new FlipdotSimHardware([], i => [], undefined, "public/lowpolybunny.stl");
    threed.finalize3D().then(_ => {
        console.log("got it")
        console.log(threed.simulation.getProjectionFor3DHardware([0, 0, -1]));
    });

}

// need basically a set of things to generate directions

// need a v2 of this where everything is a function of gridorder
// okay, let's try again...

/*
type OrderedGrid = number[][];
type GridOrder = (width: number, height: number) => OrderedGrid;
type Mask = boolean[][];
// what does this mean? get all units UP TO this time? 
type TimeFunction = (t: number) => UnitId[];
// how do I get a projection? 
type Projection = (maskGridIdx: [number, number]) => UnitId;

// untested but w/e
export let timeFunctionFromGridAndMask = (order: GridOrder, shape: Mask, projection: Projection): TimeFunction => {

    let ordered = order(shape.length, shape[0].length);
    let masked = shape.map((row, i) => row.map((c, j) => c ? ordered[i][j] : -1));

    return (t: number) => {
        return shape.map((row, i) => row.map((c, j) =>
            masked[i][j] != -1 && masked[i][j] <= t ? [i, j] : undefined
        )).flat().filter(i => i != undefined).map(item => projection(item as [number, number])) as UnitId[];
    }
}

export let bottomLeftWildfire: GridOrder = (width: number, height: number) => {
    let grid = [...new Array(height)].map(_ => [... new Array(width)]);

    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            grid[i][j] = Math.max(i, j);
        }
    }

    return grid;
}


export let genericGrowFromPoint: (startAt: [number, number], growBy: (x: number, y: number) => [number, number][]) => GridOrder =
    (startAt: [number, number], growBy: (x: number, y: number) => [number, number][]) => {
        return (width: number, height: number) => {
            let frontier: Set<[number, number]> = new Set();
            frontier.add(startAt);

            let grid = [...new Array(height)].map(_ => [... new Array(width)]);
            let counter = 1;
            grid[startAt[1]][startAt[0]] = 0;


            while (grid.some(x => x == undefined) || counter <= width * height) {
                let newFrontier: Set<[number, number]> = new Set();

                let currentFrontier = frontier;


                let pareto = [...new Set(currentFrontier)]
                // console.log("pareto:", pareto)

                // console.log("new poins before adding", newFrontier)
                for (let point of pareto) {
                    let x = point[0];
                    let y = point[1];

                    let newPts = growBy(x, y);

                    for (let pt of newPts) {
                        let u = pt[0];
                        let v = pt[1];
                        if (u < width && u >= 0 && v < height && v >= 0) {
                            // console.log(u, v, width, height)
                            if (grid[v][u] == undefined) {
                                newFrontier.add(pt as [number, number]);
                            }
                            // console.log(newFrontier)
                        }
                    }

                }
                frontier = newFrontier;
                for (let point of [...newFrontier]) {
                    grid[point[1]][point[0]] = counter;
                }

                counter++;
            }

            return grid;
        }
    }


// wait I'm dumb... this is really a lot easier
export let wildfireTemplate: GridOrder = (width: number, height: number) => {
    let botttomleft: [number, number] = [0, 0];
    let frontier: Set<[number, number]> = new Set();
    frontier.add(botttomleft);

    let grid = [...new Array(height)].map(_ => [... new Array(width)]);
    let counter = 1;
    grid[0][0] = 0;


    while (grid.some(x => x == undefined) || counter <= width * height) {
        let newFrontier: Set<[number, number]> = new Set();


        // prune frontier
        // find the greatest coord per y value
        let currentFrontier = [...frontier].reduce((prevMaxes: [number, number][][], curr: number[]) => {
            // for each column and row, we only want to keep the lowest and rightmost parts
            let prevMaxesX = prevMaxes[0];
            let prevMaxesY = prevMaxes[1];

            let prevMaxAtThisY = prevMaxesY.findIndex(a => a[1] == curr[1]);
            if (prevMaxAtThisY == -1 || prevMaxesY[prevMaxAtThisY][0] < curr[0]) {
                // console.log(prevMaxAtThisY, " existing is ", prevMaxes[prevMaxAtThisY], " curr is ", curr)
                // only remove if we also have a better 
                if (prevMaxAtThisY != -1) {
                    prevMaxesY.splice(prevMaxAtThisY, 1);
                }
                prevMaxesY.push(curr as [number, number]);
            }

            let prevMaxAtThisX = prevMaxesX.findIndex(a => a[0] == curr[0]);
            if (prevMaxAtThisX == -1 || prevMaxesX[prevMaxAtThisX][1] < curr[1]) {
                // only remove if we also have a better 
                if (prevMaxAtThisX != -1) {
                    prevMaxesX.splice(prevMaxAtThisX, 1);
                }
                prevMaxesX.push(curr as [number, number]);
            }

            return [prevMaxesX, prevMaxesY] as [number, number][][];
        }, [[], []] as [number, number][][]);


        let pareto = [...new Set([...currentFrontier[0], ...currentFrontier[1]])]
        // console.log("pareto:", pareto)

        // console.log("new poins before adding", newFrontier)
        for (let point of pareto) {
            let x = point[0];
            let y = point[1];

            let newPts = [[x, y + 1], [x + 1, y + 1], [x + 1, y]];

            for (let pt of newPts) {
                let u = pt[0];
                let v = pt[1];
                if (u < width && v < height) {
                    // console.log(u, v, width, height)
                    newFrontier.add(pt as [number, number]);
                    // console.log(newFrontier)
                }
            }

        }
        // console.log([...newFrontier])

        frontier = newFrontier;
        // now we fill in the grid and also prune the entries that don't belong 
        // also this should be like, an actual frontier


        for (let point of [...newFrontier]) {
            console.log(point)
            grid[point[1]][point[0]] = counter;
        }

        // console.log("grid update", grid)
        counter++;
    }

    return grid;
}

*/




// now I need to compile an example INTO group actions.
// so... let me pop over to main and try to borrow one of those compilers? 


// how do I program this?

// so, I have an "image" that I will make with black and whtie 
// first grup action is - flip everything in this image...


//// testing stuff


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

function buildTimeline(
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

function scheduleConstantSpeed(
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

function scheduleSyncEnd(
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

function scheduleDirectional(
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


