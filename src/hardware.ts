import * as fs from 'fs';
import { RowOfDiscs } from './flipdisc';
import { parseToGroupAction, Target, CircleTarget } from './language2';
import { BrixelDisplay } from './brixel';
import { SplitFlapDisplay } from './splitflap';
import { getImages } from './util';
import { ALPHABET_WITH_EXCLAMATION } from './constants';


type Vec2 = { x: number; y: number }

function toVec2(n: [number, number]): Vec2 { return { x: n[0], y: n[1] } };


function normalize(v: Vec2): Vec2 {
    const len = Math.hypot(v.x, v.y)
    return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len }
}

function dot(a: Vec2, b: Vec2): number {
    return a.x * b.x + a.y * b.y
}

function sub(a: Vec2, b: Vec2): Vec2 {
    return { x: a.x - b.x, y: a.y - b.y }
}

let generateDirection = (startId: UnitId, vec: [number, number], h: HardwareInterface): {
    atTime: (t: number) => number[],
    timeOf: (unitId: number) => number | undefined
} => {
    let direction: Vec2 = toVec2(vec);

    function computeFrontierMax(
        startId: number,
        direction: Vec2,
        getAdjacent: (id: number) => number[],
        getPosition: (id: number) => Vec2,
        maxSteps: number,
        minDot = 0.5
    ): number {
        const dir = normalize(direction)
        const visited = new Set<number>()

        let current = startId
        let maxS = dot(getPosition(current), dir)

        for (let step = 0; step < maxSteps; step++) {
            if (visited.has(current)) break
            visited.add(current)
            const currPos = getPosition(current)
            let bestNext: number | null = null
            let bestScore = -Infinity

            for (const n of getAdjacent(current)) {
                const v = sub(getPosition(n), currPos)
                const vNorm = normalize(v)
                const score = dot(dir, vNorm)

                if (score > bestScore && score >= minDot) {
                    bestScore = score
                    bestNext = n
                }
            }

            if (bestNext === null) break

            current = bestNext
            maxS = Math.max(maxS, dot(getPosition(current), dir))
        }

        return maxS
    }

    function cellsBehindFrontier(
        startId: number,
        direction: Vec2,
        getAdjacent: (id: number) => number[],
        getPosition: (id: number) => Vec2,
        epsilon = 1e-6
    ): Set<number> {
        const dir = normalize(direction)



        const frontierMax = computeFrontierMax(
            startId,
            direction,
            getAdjacent,
            getPosition,
            h.units.length,
        )

        const result = new Set<number>()
        const queue: number[] = [startId]
        result.add(startId)

        while (queue.length > 0) {
            const current = queue.shift()!
            const currS = dot(getPosition(current), dir)

            for (const n of getAdjacent(current)) {
                if (result.has(n)) continue

                const s = dot(getPosition(n), dir)

                // Behind or on the frontier
                if (s <= frontierMax + epsilon) {
                    result.add(n)
                    queue.push(n)
                }
            }
        }

        return result
    }


    console.log(h.indexToCoord)
    let getPosition = (i: UnitId) => {
        // console.log(i);
        // console.log(h.indexToCoord.get(i)!)
        return toVec2(h.indexToCoord.get(i)!)
    };
    const dir = normalize(direction)

    const maxSteps = h.units.length

    const allCells = cellsBehindFrontier(
        startId,
        dir,
        h.unitAdjacency,
        getPosition
    )

    const s0 = dot(getPosition(startId), dir)

    const sMax = computeFrontierMax(
        startId,
        dir,
        h.unitAdjacency,
        getPosition,
        maxSteps
    )

    const denom = Math.max(1e-9, sMax - s0)

    const normalized = new Map<number, number>()
    for (const id of allCells) {
        const s = dot(getPosition(id), dir)
        normalized.set(id, (s - s0) / denom)
    }

    const timeMap = new Map<number, number>()
    for (const id of allCells) {
        const s = dot(getPosition(id), dir)
        timeMap.set(id, (s - s0) / denom)
    }

    return {
        atTime: (t: number) => {
            const clamped = Math.max(0, Math.min(1, t))
            const result = new Set<number>()

            for (const [id, u] of timeMap) {
                if (u <= clamped) result.add(id)
            }

            return [...result]
        },

        timeOf: (unitId: number) => {
            return timeMap.get(unitId)
        }
    }

}

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

type Time = number;
type Duration = number;
// type Time = number | [number, Action, number];
type UnitId = number;
type StateId = number | string;

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

export interface Transition {
    // just curry these later 
    generateGroupActions: (o1: Target, o2: Target, t: Duration, h: HardwareInterface) => GroupAction[];
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
            const frame = Math.round(ga.tPlus * framesPerMs);
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

        const byUnit = new Map<UnitId, [UnitId, number][]>();

        for (const a of unitsUsedAtTimes) {
            if (!byUnit.has(a[0])) {
                byUnit.set(a[0], []);
            }
            byUnit.get(a[0])!.push(a as [number, number]);
        }

        const scheduled = new Map<UnitId, [[number, number][], number]>();

        for (const [unitId, acts] of byUnit) {
            acts.sort((a, b) => a[0] - b[0]);

            let lastEnd = -Infinity;
            const timeline: [number, number][] = [];

            for (const act of acts) {
                const start = Math.max(act[0], lastEnd);
                const end = start + this.sim.numFramesRotating;

                timeline.push([start, end]);
                lastEnd = end;
            }

            scheduled.set(unitId, [timeline, lastEnd]);
        }

        let schedule = (f: number) => {
            return (i: number): [number | undefined, number | undefined] => {
                const timeline = scheduled.get(i);
                if (!timeline) return [undefined, 0];

                if (f >= timeline[1]) return [undefined, 0];

                for (const act of timeline[0]) {
                    if (act[0] >= f) {
                        return [act[0] - f, 0];
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

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
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
            this.simulation.makeArbitraryMeshDiscSetup(meshInput);
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


function diffIndices(at: Target, bt: Target, h: HardwareInterface): number[] {
    const result: [number, number][] = [];

    // const [aCol0, aRow0] = at.position;
    // const [bCol0, bRow0] = bt.position;

    const [aCol0, aRow0] = [0, 0];
    const [bCol0, bRow0] = [0, 0];

    console.log(aCol0, aRow0, bCol0, bRow0);


    let a = at.draw();
    let b = bt.draw();

    console.log(a.length, b.length)

    const aRows = a.length;
    const aCols = a[0]?.length ?? 0;
    const bRows = b.length;
    const bCols = b[0]?.length ?? 0;

    // Global bounds
    const aRow1 = aRow0 + aRows;
    const aCol1 = aCol0 + aCols;
    const bRow1 = bRow0 + bRows;
    const bCol1 = bCol0 + bCols;

    // Union bounds (everything either array touches)
    const rowStart = Math.min(aRow0, bRow0);
    const rowEnd = Math.max(aRow1, bRow1);
    const colStart = Math.min(aCol0, bCol0);
    const colEnd = Math.max(aCol1, bCol1);

    console.log(rowStart, rowEnd, colStart, colEnd);
    for (let r = rowStart; r < rowEnd; r++) {
        for (let c = colStart; c < colEnd; c++) {
            // console.log(rowStart, rowEnd)
            // console.log(colStart, colEnd)
            // console.log(at.position)
            // console.log(bt.position)
            // console.log(r,c)
            // console.log(i++)
            // if (i > 50) return []

            const inA =
                r >= aRow0 && r < aRow1 &&
                c >= aCol0 && c < aCol1;

            const inB =
                r >= bRow0 && r < bRow1 &&
                c >= bCol0 && c < bCol1;

            // I want to flip it 
            const aVal = inA ? a[r - aRow0][c - aCol0] : false;
            const bVal = inB ? b[r - bRow0][c - bCol0] : false;

            // Rules:
            // - both present → include if different
            // - only one present → include if true
            if (
                (inA && inB && aVal !== bVal) ||
                (inA && !inB && aVal) ||
                (!inA && inB && bVal)
            ) {
                result.push([r, c]);
            }
        }
    }

    console.log(result)
    return result.map(c => h.coordToIndex(c));
}



// let's implement a transition...


// oh I know the problem. the background isn't drawn.
// didn't I do something about this before...?

export class SnapTransition implements Transition {
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let flip = diffIndices(o1, o2, h);
        console.log(flip)
        return [new GroupAction(t, [[Action.FLIP, flip]])];


    }

}

// DITHERING IN MOTION - what does it mean?
// different effects are like... 
// how do I squeeze MORE MOTION out ofthings

export class FlipTransition implements Transition {
    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {

        // o1 and o2 - for things not 
        // the difference is things that must get flipped.
        // everything else must stay the same
        let oddFlips = new Set(diffIndices(o1, o2, h));
        // the first flips are this, but the subsequent flips should just be the same as o1.
        let subsequent = [];
        let o2Flips = o2.draw();
        for (let i = 0; i < o2Flips.length; i++) {
            for (let j = 0; j < o2Flips[0].length; j++) {
                if (o2Flips[i][j]) {
                    subsequent.push(h.coordToIndex([i, j]));
                }
            }
        }

        // how many flips should I do?
        let flipTiming = h.actionDurations.get(Action.FLIP)!;
        let maxFlips = Math.floor(t / flipTiming);
        let oddCount = maxFlips % 2 == 0 ? maxFlips - 1 : maxFlips;
        let evenCount = maxFlips % 2 == 1 ? maxFlips : maxFlips - 1;

        let groupActions: GroupAction[] = [];

        for (let i = 0; i < oddCount; i++) {
            let time = i * flipTiming;
            console.log("time is ", time)
            let idxes = [...oddFlips];
            if (i != 0) {
                idxes = subsequent;
            }
            let action = new GroupAction(time, [[Action.FLIP, idxes]])
            groupActions.push(action);
        }

        return groupActions;
        // one extra at the end 
    }
    // just keep flipping
}


/**
 * Compute the maximum L1 (graph) distance between any start cell
 * and any end cell using BFS over adjacency edges.
 *
 * @param startCells - indices of starting cells
 * @param endCells   - indices of ending cells
 * @param getAdj     - function returning adjacent cell indices
 * @returns number   - furthest shortest-path distance
 */
export function maxL1Distance(startCells: number[], endCells: number[], h: HardwareInterface): number {
    if (startCells.length === 0 || endCells.length === 0) {
        return -1; // or throw new Error(...)
    }

    const endSet = new Set(endCells);

    // BFS queue initialized with all start cells
    const queue: number[] = [];
    const dist = new Map<number, number>();

    for (const s of startCells) {
        queue.push(s);
        dist.set(s, 0);
    }

    let maxDistance = -1;

    while (queue.length > 0) {
        const cell = queue.shift()!;
        const d = dist.get(cell)!;

        // If this cell is an end cell, update the max
        if (endSet.has(cell)) {
            if (d > maxDistance) maxDistance = d;
        }

        // Explore neighbors
        for (const nxt of h.unitAdjacency(cell)) {
            if (!dist.has(nxt)) {
                dist.set(nxt, d + 1);
                queue.push(nxt);
            }
        }
    }

    return maxDistance;
}

export function maxDirectionalGraphDistance(
    units: number[],
    getPos: (id: number) => [number, number],
    getNeighbors: (id: number) => number[],
    _dir: [number, number],
    eps = 1e-6
): { distance: number; start: number; end: number } | null {
    let dir = toVec2(_dir);

    if (units.length < 2) return { distance: 0, start: units[0], end: units[0] };

    // Normalize direction
    const len = Math.hypot(dir.x, dir.y);
    const ndir = { x: dir.x / len, y: dir.y / len };

    // Step A: find projection extremes
    let minProj = Infinity;
    let maxProj = -Infinity;
    const proj = new Map<number, number>();

    for (const u of units) {
        const p = dot(toVec2(getPos(u)), ndir);
        proj.set(u, p);
        if (p < minProj) minProj = p;
        if (p > maxProj) maxProj = p;
    }

    const startSet: number[] = [];
    const endSet = new Set<number>();

    for (const u of units) {
        const p = proj.get(u)!;
        if (p <= minProj + eps) startSet.push(u);
        if (p >= maxProj - eps) endSet.add(u);
    }

    // Step B: multi-source BFS with tracking
    const queue: number[] = [];
    const dist = new Map<number, number>();
    const sourceMap = new Map<number, number>(); // maps node -> originating start ID

    for (const s of startSet) {
        queue.push(s);
        dist.set(s, 0);
        sourceMap.set(s, s);
    }

    let maxDist = -1;
    let maxStart = -1;
    let maxEnd = -1;
    let remainingTargets = endSet.size;

    while (queue.length && remainingTargets > 0) {
        const u = queue.shift()!;
        const d = dist.get(u)!;

        if (endSet.has(u)) {
            if (d > maxDist) {
                maxDist = d;
                maxStart = sourceMap.get(u)!;
                maxEnd = u;
            }
            remainingTargets--;
        }

        for (const v of getNeighbors(u)) {
            if (!dist.has(v)) {
                dist.set(v, d + 1);
                sourceMap.set(v, sourceMap.get(u)!);
                queue.push(v);
            }
        }
    }

    if (maxDist === -1) throw new Error("distance not right?");

    return { distance: maxDist, start: maxStart, end: maxEnd };
}



type NoiseFn = (tBase: number) => number

function generateActivationSequence(units: UnitId[], startId: UnitId, h: HardwareInterface,
    options: {
        centralBias?: number        // default 0.8
        radiusFn?: (t: number) => number
        radiusInvFn?: (r: number) => number
        localNoise?: NoiseFn
        globalNoise?: NoiseFn
    } = {}): [Time, UnitId][] {

    const {
        centralBias = 0.8,
        radiusFn = t => t,
        radiusInvFn = r => r,
        localNoise = () => (Math.random() - 0.5) * 0.1,
        globalNoise = tBase => Math.random() - tBase
    } = options


    let cells = units.map(u => {
        let coord = h.indexToCoord.get(u)!;
        return { id: u, x: coord[0], y: coord[1] };
    })

    console.log(startId)
    let startCoord = h.indexToCoord.get(startId)!;
    const start = { id: startId, x: startCoord[0], y: startCoord[1] }
    // how can the start id not be part of the cells?
    console.log(start)

    // distances
    const distances = cells.map(c =>
        Math.hypot(c.x - start.x, c.y - start.y)
    )
    const maxD = Math.max(...distances)

    // assign times
    let activations: [Time, UnitId][] = cells.map((cell, i) => {
        const r = maxD === 0 ? 0 : distances[i] / maxD
        const tBase = radiusInvFn(r)

        const noise =
            Math.random() < centralBias
                ? localNoise(tBase)
                : globalNoise(tBase)

        const t = Math.min(1, Math.max(0, tBase + noise))
        return [t, cell.id]
    })

    // normalize so last activation is exactly at t = 1
    const maxT = Math.max(...activations.map(a => a[0]))
    activations = activations.map(([t, id]) => [t / maxT, id])

    // sort by activation time
    activations.sort((a, b) => a[0] - b[0])

    return activations
}


export class StochasticTransition implements Transition {
    startingId: UnitId;

    constructor(starting: UnitId) {
        this.startingId = starting;
    }

    // I want to give an ordering to the 
    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        let unitsToFlap = diffIndices(o1, o2, h);

        let activations = generateActivationSequence(unitsToFlap, this.startingId, h);

        // round up
        // want to clamp to 
        let minClamp = 1;
        let maxClamp = t - 1
        activations = activations.map(a => [Math.round(a[0] * (maxClamp - minClamp)) + minClamp, a[1]])
        console.log(activations)
        let actions: GroupAction[] = []
        let time = activations[0][0];
        let groupActUnits = [];
        for (let act of activations) {
            let t = act[0];
            console.log(t)
            if (time == t) {
                groupActUnits.push(act[1]);
            } else {
                actions.push(new GroupAction(time, [[Action.FLIP, groupActUnits]]));
                time = act[0];
                groupActUnits = [];
            }
        }

        actions.push(new GroupAction(time, [[Action.FLIP, groupActUnits]]));


        return actions;
    }


}

export class WaveTransition implements Transition {
    dir: [number, number];
    direction: (t: Time) => number[];
    // I guess a time vector field?
    start: UnitId

    // how do I specify this.........
    constructor(direction: (t: Time) => number[], dir: [number, number], start: UnitId) {
        this.direction = direction;
        this.dir = dir;
        this.start = start;
    }


    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        // how many steps do I get though?
        // let flipTiming = h.actionDurations.get(Action.FLIP)!;

        console.log(o1.draw())
        console.log(o2.draw())
        let unitsToFlap = new Set(diffIndices(o1, o2, h));
        console.log(unitsToFlap);
        // let steps = t / flipTiming;
        // what's the "width" of the units, so to speak?

        let first = this.direction(0);
        let last = this.direction(1);

        // console.log(first);
        // console.log(last);
        let maxDistance2 = maxL1Distance(first, last, h);
        // TODO: max distance actually depends on the drawing shape

        let max = maxDirectionalGraphDistance([...unitsToFlap], (i: number) => h.indexToCoord.get(i)!, h.unitAdjacency, this.dir)!

        // let maxDistance = 5
        console.log("max dist is", max, maxDistance2)
        // TODO: why isn't it the full 15 frames? 

        // you know what forget it. I'm calling this function again.
        // TODO: OPTIMIZE/DECIDE WHERE THIS SHOULD LIVE!
        let fn = generateDirection(this.start, this.dir, h);
        let smallest = fn.timeOf(max.start)!;
        let largest = fn.timeOf(max.end)!;
        // console.log(`min is ${max.start} at time ${smallest}, max is ${max.end} at time ${largest}, giving ${smallest-largest} maxDistance2);

        // let maxDistance = largest - smallest;
        let maxDistance = max.distance

        // in the time that I have, how much distance must I cover? 
        let timePerRow = maxDistance / t; // number of rows divided by time
        // TODO: time should actually only start AT the first unit... 
        console.log(timePerRow)

        let actions: GroupAction[] = [];

        let unitsSoFar: Set<UnitId> = new Set();

        for (let time = 0; time < t; time += timePerRow) {

            // now we are going to make each step with time
            // drawFrame(rectSize, [, ], hardware);

            // time is from 0 to 1
            // console.log("bbbbb")
            let unitsPassedOver = new Set(this.direction(time / t));
            console.log(unitsPassedOver)
            let draw = unitsPassedOver.intersection(unitsToFlap);
            console.log(unitsToFlap)
            console.log(draw);

            let update = draw.difference(unitsSoFar);
            unitsSoFar = unitsSoFar.union(update);
            let action = new GroupAction(time, [[Action.FLIP, [...update]]]);

            actions.push(action);
        }


        console.log(actions)
        return actions;

    }

    // what's the difference between effect and transition?
    // transiton can perform 
}


export class OverrotateRevealTransition implements Transition {
    overrotateAt: (unit: UnitId) => Time = _ => 0.8;
    overrotateDeg: (unit: UnitId) => number = _ => 15;

    // wavefront target -> it's a pixel path
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let flip = diffIndices(o1, o2, h);
        // I need to actually generate enough of these that this flips 180 in the specified target duration
        // or put another way.... it's 180 at the time.
        console.log(o1.draw(), o2.draw())
        console.log(flip)
        // but I can't generate the state.... 

        // this is the way to rotate, but what I need to do is like, reach


        let groupActions: Map<number, GroupAction> = new Map();
        for (let id of flip) {
            let ora = this.overrotateAt(id);
            let ord = this.overrotateDeg(id);

            let reachBy = t * ora;
            let overrotateDuration = t * (1 - ora) / 2;
            let startToReturn = reachBy + overrotateDuration;

            console.log(ora, ord)
            console.log(t, reachBy, startToReturn);

            // so first, generate the initial rotation
            [...new Array(180).keys()].forEach(i => {
                let time = reachBy / 180 * i;
                let ga = groupActions.has(time) ? groupActions.get(time)! : new GroupAction(time, [[Action.INCREMENT, []]]);
                // maybe I should use the multiplicity feature
                if (ga.actions.find(a => a[0] == Action.INCREMENT) == undefined) {
                    ga.actions.push([Action.INCREMENT, []]);
                }
                ga.actions.find(a => a[0] == Action.INCREMENT)![1].push(id);

                groupActions.set(time, ga);
            });

            // don't need zero
            // how long does it take to rotate one degree? well, I have overotateDuration time to do it. 
            [...new Array(ord - 1).keys()].map(i => i + 1).forEach(i => {
                let time = reachBy + (overrotateDuration / ord) * i;
                let ga = groupActions.has(time) ? groupActions.get(time)! : new GroupAction(time, [[Action.INCREMENT, []]]);
                // maybe I should use the multiplicity feature
                if (ga.actions.find(a => a[0] == Action.INCREMENT) == undefined) {
                    ga.actions.push([Action.INCREMENT, []]);
                }
                ga.actions.find(a => a[0] == Action.INCREMENT)![1].push(id);

                groupActions.set(time, ga);
            });
            // omg lol I can't rotate back? 
            // don't need zero either
            [...new Array(ord - 1).keys()].map(i => i + 1).forEach(i => {
                let time = startToReturn + (overrotateDuration / ord) * i;
                let ga = groupActions.has(time) ? groupActions.get(time)! : new GroupAction(time, [[Action.DECREMENT, []]]);
                // maybe I should use the multiplicity feature
                if (ga.actions.find(a => a[0] == Action.DECREMENT) == undefined) {
                    ga.actions.push([Action.DECREMENT, []]);
                }
                ga.actions.find(a => a[0] == Action.DECREMENT)![1].push(id);
                groupActions.set(time, ga);
            });

        }

        let actions = [...groupActions.values()];
        actions.sort((a, b) => a.tPlus - b.tPlus);
        return actions;
        // console.log(t, reachBy, startToReturn)
        // console.log(firstRotation);
        // console.log(overRotate);
        // console.log(returnToPos)
        // return firstRotation.concat(overRotate).concat(returnToPos);

    }
}

export class RotateRevealTransition implements Transition {
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let flip = diffIndices(o1, o2, h);
        // I need to actually generate enough of these that this flips 180 in the specified target duration
        // or put another way.... it's 180 at the time.
        console.log(o1.draw(), o2.draw())
        console.log(flip)
        // but I can't generate the state.... 
        return [...new Array(180).keys()].map(i => new GroupAction(t / 180 * i, [[Action.INCREMENT, flip]]));


    }
}


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

    parseToGroupAction(logoExample);

    let logoBasicExample = "timing: [15,15]\n\
    filepath: /animations/text-logo${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 0 -> instantaneous -> rectangle 1";

    parseToGroupAction(logoBasicExample);

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


    
    // let brixels = new BrixelDisplay(10, 20);
    // brixels.setAnimationSequence([[1, 10, 60], [2, 20, 90], [5, 30,60], [2, 30, 15]])
    let brixelHw = BrixelSimHardware.Rectangular(10, 20);

    let actions = new RotateRevealTransition().generateGroupActions(new CircleTarget(1, [5, 5], [10, 20]), new CircleTarget(3, [4, 4], [10, 20]), 200, brixelHw)

    let orrt = new OverrotateRevealTransition();
    orrt.overrotateAt = id => {
        let row = brixelHw.indexToCoord.get(id)![0];
        console.log(row)
        return row == 4 ? 0.7 : row == 6 ? 0.9 : 0.8;
        // return 0.7
    }
    let actions2 = orrt.generateGroupActions(new CircleTarget(1, [5, 5], [10, 20]), new CircleTarget(3, [4, 4], [10, 20]), 300, brixelHw)
    // console.log(actions)
    // now, how do I do it so that it takes more time depending on its location?
    brixelHw.compile(actions);




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
    let frame1 = new GroupAction(0, [[Action.FLIP, frameUnitId]]);
    console.log(frame1);


    let finalMessage = "cheese".split("").map(c => new SplitflapState(c));
    // the message should be from like 12 to 20 in row 7
    let finalState = [...new Array(h * w)].map(j => new SplitflapState(" "));
    [...new Array("cheese".length).keys()].forEach(i => finalState[6 * w + i + 13] = finalMessage[i]);

    // let schedule = scheduleDirectional(
    //     sfhw.units as SplitflapUnit[],
    //     finalState,
    //     1,
    //     sfhw,
    //     "LEFT_TO_RIGHT"
    // );

    let schedule = scheduleConstantSpeed(sfhw.units as SplitflapUnit[], finalState, 1)
    console.log(schedule)
    let restGA = buildTimeline(schedule);
    sfhw.compile([frame1, ...restGA]);
    // now I want the position of the text.
    // row 7 from 12 to 20


}

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
    flipSchedule: Map<UnitId, Time[]>
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
                new GroupAction(t, [[Action.FLIP, ids]])
        );
}

function scheduleConstantSpeed(
    units: SplitflapUnit[],
    targets: SplitflapState[],
    flipsPerSecond: number,
    maxSimultaneousFinishes = Infinity
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


