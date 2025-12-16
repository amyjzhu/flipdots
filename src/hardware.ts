import * as fs from 'fs';
import { RowOfDiscs } from './flipdisc';
import { parseToGroupAction } from './language2';
import { Target } from './language';

export interface HardwareInterface {
    units: Unit[] // need to map these somewhere somehow
    actionDurations: Map<Action, Duration>;
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
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    filename: string = "";

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[]) {
        this.flipDurationMS = 20;
        this.actionDurations.set(Action.FLIP, this.flipDurationMS);
        this.units = units;
        this.unitIdToUnit = new Map();
        for (let u of this.units.flat()) {
            this.unitIdToUnit.set(u.id, u);
        }

        this.unitAdjacency = adjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.id).flat()).difference(new Set(ids))];
            return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.flipDurationMS)]] as [UnitId[], Time][];
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

        let adjacency = (i: UnitId) => {
            let neighbours: UnitId[] = [];
            // if we're at the edge, don't include some:

            let xCoord = i % width;
            let yCoord = Math.floor(i / width);

            for (let yPlus of [-1, 0, 1]) {
                for (let xPlus of [-1, 0, 1]) {
                    if (!(xPlus == 0 && yPlus == 0) ||
                        (xCoord + xPlus >= width || xCoord + xPlus < 0
                            || yCoord + yPlus < 0 || yCoord + yPlus >= height)) {
                        neighbours.push(i + yPlus * width + xPlus);
                    }
                }
            }
            console.log(neighbours);
            return neighbours;
        }

        return new FlipdotHardware(unitList, adjacency);
    }


}


export class FlipdotSimHardware implements HardwareInterface {
    flipDurationMS: number = 10;
    actionDurations: Map<Action, number> = new Map();
    units: Unit[];
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => [UnitId, State][];
    simulation: RowOfDiscs;
    totalNumFrames: number = 0;

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
    }

    constructor(units: Unit[], adjacency: (toCheck: UnitId) => UnitId[], dimensions?: [number, number], meshInput?: string) {
        this.flipDurationMS = 20;
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
                        if (!(xPlus == 0 && yPlus == 0) ||
                            (xCoord + xPlus >= width || xCoord + xPlus < 0
                                || yCoord + yPlus < 0 || yCoord + yPlus >= height)) {
                            neighbours.push(i + yPlus * width + xPlus);
                        }
                    }
                }
                console.log(neighbours);
                return neighbours;
            }

            this.units = unitList;
            this.unitAdjacency = adjacency;


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
                console.log("dimensions are", dimensions)
                let [height, width] = dimensions;
                idxes = [...new Array(height)].map(_ => []);
                blankIdxes = idxes.map(i => i.map(u => u));
                console.log(blankIdxes)
                ids.forEach(i => idxes[Math.floor(i / width)].push(i % width))
            } else {
                idxes = [ids];
                blankIdxes = [[]];
            }
            let originalAnim = this.simulation.nextFlipGenerator;

            let currNumFrames = this.totalNumFrames;

            // here's what I do: if this is lower than the current number, delegate
            this.simulation.resetAnimation(i => {
                console.log(`i is ${i}, currentNumFrames is ${currNumFrames}, this.totalNumFrames is ${this.totalNumFrames}, closestInterval is ${closestInterval}`)
                if (i >= currNumFrames) {
                    if (i - currNumFrames < closestInterval) {
                        console.log("returning wait")
                        console.log(blankIdxes)

                        return blankIdxes;
                    } else if (i - currNumFrames == closestInterval) {
                        console.log("returning current index")
                        return idxes;
                    } else {
                        console.log("returning wait 2")
                        console.log(blankIdxes)
                        return blankIdxes;
                    }

                } else {
                    console.log("counting up:", i, currNumFrames)
                    return originalAnim(i);
                }
            })

            this.totalNumFrames += closestInterval + 1;
            return [];
        }

    }

    compile(groupActions: GroupAction[]) {
        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        // let cumulativeTime = 0;
        let lastTime = 0;
        console.log("units before and after", this.units)

        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));
        console.log("units before and after", this.units)

        // at the very beginning, they are all available
        for (let ga of groupActions) {
            let time = this.getRealTiming(ga.tPlus);
            console.log(time)
            // cumulativeTime += time;
            // console.log("updating time!", cumulativeTime, time)
            let possibleTime // keep track.... 
            let actionSet = ga.actions;
            for (let action of actionSet) {
                let actionType: Action = action[0];
                let unitsInUse: Unit[] = action[1].map(i => this.unitIdToUnit.get(i)!);
                // first, I need to check the timing by inputting the group action and seeing 
                // if it's possible.
                // first, make sure we can do everything simultaneously


                console.log(unitAvailableAt)
                console.log(this.unitIdToUnit)

                console.log(this)
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

                        console.log(unit.actions.includes(action[0]))
                        console.log(unitAvailableAt.get(unit.id))
                        console.log(unitAvailableAt.get(unit.id)! <= time)
                        console.log(unit.id, time, time, unitAvailableAt.get(unit.id), actionType);
                        throw new Error("could not compile");

                    }
                }

                console.log(action[1], time - lastTime)
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


}

export class FlipdotState extends State { }

export class FlipdotUnit implements Unit {
    id: UnitId;
    actionTiming: [Action, number] = [Action.FLIP, 10];
    actions: Action[];
    states: [Action, State[]][];

    constructor(id: UnitId) {
        this.id = id;
        this.actions = [Action.FLIP];
        this.states = [[Action.FLIP, [new FlipdotState(0), new FlipdotState(1)]]];
    }
}



function diffIndices(a: boolean[][], b: boolean[][]): number[] {
    const differences: number[] = [];

    // Basic safety checks — dimensions should match
    if (a.length !== b.length) {
        throw new Error("Arrays differ in number of rows.");
    }

    let index = 0;

    for (let row = 0; row < a.length; row++) {
        if (a[row].length !== b[row].length) {
            throw new Error(`Row ${row} differs in length.`);
        }

        for (let col = 0; col < a[row].length; col++) {
            if (a[row][col] !== b[row][col]) {
                differences.push(index);
            }
            index++;
        }
    }

    return differences;
}


// let's implement a transition...


export class SnapTransition implements Transition {
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let generateAnimationBetweenFrames = (start: boolean[][], end: boolean[][], time: number): GroupAction => {
            // let's just assume it's an instantaneous action... but we can create more of these later and hook it up properly 
            let flip = diffIndices(start as boolean[][], end as boolean[][]);
            return new GroupAction(time, [[Action.FLIP, flip]]);
        }

        let groupAction = generateAnimationBetweenFrames(o1.draw(), o2.draw(), t);


        return [groupAction];
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
        let oddFlips = new Set(diffIndices(o1.draw(), o2.draw()));
        let evenFlips = new Set(o2.draw()).difference(oddFlips);

        // how many flips should I do?
        let flipTiming = h.actionDurations.get(Action.FLIP)!;
        let maxFlips = Math.floor(t / flipTiming);
        let oddCount = maxFlips % 2 == 0 ? maxFlips - 1 : maxFlips;
        let evenCount = maxFlips % 2 == 1 ? maxFlips : maxFlips - 1;

        let groupActions: GroupAction[] = [];
        
        for (let i = 0; i < oddCount; i++) {
            let time = i * flipTiming;
            let action = new GroupAction(time, [[Action.FLIP, [...oddFlips]]])
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



export class WaveTransition implements Transition {
    direction: (t: Time) => number[];
    // I guess a time vector field?

    // how do I specify this.........
    constructor(direction: (t: Time) => number[]) {
        this.direction = direction;
    }

    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        // how many steps do I get though?
        // let flipTiming = h.actionDurations.get(Action.FLIP)!;

        let unitsToFlap = new Set(diffIndices(o1.draw(), o2.draw()));
        // let steps = t / flipTiming;
        // what's the "width" of the units, so to speak?

        let first = this.direction(0);
        let last = this.direction(1);

        let maxDistance = maxL1Distance(first, last, h);

        // in the time that I have, how much distance must I cover? 
        let timePerRow = maxDistance / t; // number of rows divided by time
        
        let actions: GroupAction[] = [];

        for (let time = 0; time < t; t += timePerRow) {
            // now we are going to make each step with time
            // drawFrame(rectSize, [, ], hardware);

            // time is from 0 to 1
            let unitsPassedOver = new Set(this.direction(time / t));
            let draw = unitsPassedOver.intersection(unitsToFlap);
            let action = new GroupAction(time, [[Action.FLIP, [...draw]]]);

            actions.push(action);
        }
        

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

    parseToGroupAction(teapotExample);
}

// now I need to compile an example INTO group actions.
// so... let me pop over to main and try to borrow one of those compilers? 