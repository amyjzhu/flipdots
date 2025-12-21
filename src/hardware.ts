import * as fs from 'fs';
import { RowOfDiscs } from './flipdisc';
import { parseToGroupAction, Target } from './language2';

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
    actionTiming: [Action, Duration];
    states: [Action, State[]][];
}

export enum Action {
    FLIP,
    SET,
    FLUTTER
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



///////////////


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
                console.log(n)
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
    actionTiming: [Action, number] = [Action.FLIP, 1];
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

    const start = cells.find(c => c.id === startId)!

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
        let maxClamp = t-1
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
    teapot 0 ->* motion ->* teapot 9"
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
    rectangle 0 -> sparkle -> rectangle 1"; 
    // TODO: the opposite doesn't work - you can't sparkle OUT 

    parseToGroupAction(sparkleExample);


}

// now I need to compile an example INTO group actions.
// so... let me pop over to main and try to borrow one of those compilers? 