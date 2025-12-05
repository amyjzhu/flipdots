export interface HardwareInterface {
    units: Unit[][] // need to map these somewhere somehow
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => void;
}

type Time = number | [number, Action, number];
type UnitId = number;
type StateId = number;

let incrementTime = (t: Time, inc: number) => {
    if (typeof t == "number") {
        return t + inc;
    } else {
        return [t[0], t[1], t[2] + inc]
    }
}

export interface Unit {
    id: UnitId;
    actions: Action[];
    states: [Action, [StateId, State][]][];
}

export enum Action {
    FLIP,
    SET,
    FLUTTER
}

export class Colour {
    rgb: [number, number, number] = [0, 0, 0];
}

export class State {
    image: Colour[][] = [];
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
    generateGroupAction: (o1: Object, o2: Object, h: HardwareInterface) => GroupAction;
}



///////////////


export class FlipdotHardware implements HardwareInterface {
    flipDurationMS: number;
    units: Unit[][];
    unitIdToUnit: Map<UnitId, Unit>;
    unitAdjacency: (toCheck: UnitId) => UnitId[];
    allowedNextActive: (action: Action, id: UnitId[], time: Time) => [UnitId[], Time][];
    actionsToHardwareAction: (action: Action, id: UnitId[], time: Time) => void;

    getRealTiming(time: Time): number {
        if (typeof time == "number") {
            return time;
        } else {
            return time[0] * this.flipDurationMS + time[2];
        }
    }

    constructor(units: Unit[][], adjacency: (toCheck: UnitId) => UnitId[]) {
        this.flipDurationMS = 20;
        this.units = units;
        this.unitIdToUnit = new Map();
        for (let u of this.units.flat()) {
            this.unitIdToUnit.set(u.id, u);
        }

        this.unitAdjacency = adjacency;
        this.allowedNextActive = (action: Action, ids: UnitId[], time: Time) => {
            // is this true?
            // surely it takes some time for units to flip!
            let otherIds = [...new Set(this.units.map(r => r.map(u => u.id)).flat()).difference(new Set(ids))];
            return [[otherIds, incrementTime(time, 1)],
            [ids, incrementTime(time, this.flipDurationMS)]] as [UnitId[], Time][];
        }



        this.actionsToHardwareAction = (action: Action, ids: UnitId[], time: Time) => {
            ids.forEach(id => console.log(`${action}, ${id}`));
            console.log(`wait ${time}`);
        }

    }
    compile(groupActions: GroupAction[]) {
        let unitAvailableAt: Map<UnitId, number | undefined> = new Map();
        let cumulativeTime = 0;
        this.units.flat().map(u => unitAvailableAt.set(u.id, 0));

        // at the very beginning, they are all available
        for (let ga of groupActions) {
            let time = this.getRealTiming(ga.tPlus);
            cumulativeTime += time;
            console.log("updating time!", cumulativeTime)
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
                        (unitAvailableAt.get(unit.id) != undefined && unitAvailableAt.get(unit.id)! <= cumulativeTime))) {

                        console.log(unit.actions.includes(action[0]))
                        console.log(unitAvailableAt.get(unit.id))
                        console.log(unitAvailableAt.get(unit.id)! <= cumulativeTime)
                        console.log(unit.id, time, cumulativeTime, unitAvailableAt.get(unit.id), actionType);
                        throw new Error("could not compile");

                    }
                }

                this.actionsToHardwareAction(actionType, action[1], time);

            
                // should this actually be like, when are each of the next available elements available?
                // some thigns won't be available until another move is made.
                let nextAvailable = this.allowedNextActive(actionType, action[1], time);
                // remember, if we didn't set it, it must not be possible to use!!
                unitAvailableAt.keys().map(k => unitAvailableAt.set(k, undefined));

                console.log(nextAvailable)
                for (let [ids, interval] of nextAvailable) {
                    console.log(cumulativeTime + this.getRealTiming(interval))
                    ids.forEach(id => unitAvailableAt.set(id, cumulativeTime + this.getRealTiming(interval)));
                }

            }




        }
    }

    static Rectangular(width: number, height: number, backCol: Colour, frontCol: Colour) {
        let unitList = [...new Array(height).keys()].map(i => [...new Array(width).keys()].map(j => new FlipdotUnit(backCol, frontCol, i * height + j)));

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

export class FlipdotUnit implements Unit {
    id: UnitId;
    actions: Action[];
    states: [Action, [StateId, State][]][];

    constructor(backCol: Colour, frontCol: Colour, id: UnitId) {
        this.id = id;
        this.actions = [Action.FLIP];
        this.states = [[Action.FLIP, [[0, new FlipdotState(backCol)], [1, new FlipdotState(frontCol)]]]];
    }
}


export class FlipdotState implements State {
    image: Colour[][];
    constructor(col: Colour) {
        this.image = [[col]];
    }
}

// let's set up some test cases...

