import { HardwareInterface, GroupAction, Action, Duration, Time, UnitId, SplitflapState, SplitflapHardware, isSplitflapHardware, SplitflapUnit } from "./hardware";
import { Colour } from "./language";
import { Target } from "./language2";
import { AllAtOnce, GridOrder, StutterOrder } from "./order";

export interface Transition {
    // just curry these later 
    generateGroupActions: (o1: Target, o2: Target, t: Duration, h: HardwareInterface) => GroupAction[];
}



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

export let generateDirection = (startId: UnitId, vec: [number, number], h: HardwareInterface): {
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
    // this probably needs an order as well
    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        console.log("generating flips... ", t);
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


export class OffsetFlipImage implements Transition {
    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        // okay:
        // I'm going to flip everything, but I'm going to flip the off ones at a slight offset 
        let oddFlips = new Set(diffIndices(o1, o2, h));
        // the first flips are this, but the subsequent flips should just be the same as o1.
        let subsequent = [];
        let others = [];
        let o2Flips = o2.draw();
        for (let i = 0; i < o2Flips.length; i++) {
            for (let j = 0; j < o2Flips[0].length; j++) {
                if (o2Flips[i][j]) {
                    subsequent.push(h.coordToIndex([i, j]));
                } else {
                    others.push(h.coordToIndex([i, j]));
                }
            }
        }

        console.log(others)

        // how many flips should I do?
        let flipTiming = h.actionDurations.get(Action.FLIP)!;
        let maxFlips = Math.floor(t / flipTiming);
        let oddCount = maxFlips % 2 == 0 ? maxFlips - 1 : maxFlips;
        let evenCount = maxFlips % 2 == 1 ? maxFlips : maxFlips - 1;
        let delta = flipTiming / 2;
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
            // let's push another one that's slightly offset!
            if (i != 0) {
                groupActions.push(new GroupAction(time + delta, [[Action.FLIP, [...others]]]));
            }
        }

        return groupActions;
        // one extra at the end 
    }
    // just keep flipping
}


export class StochasticTransition implements Transition {
    order: GridOrder;
    // startingId: UnitId;

    constructor(order: GridOrder) {
        this.order = order;
    }

    // I want to give an ordering to the 
    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        let unitsToFlap = diffIndices(o1, o2, h);

        let [grid, x, y] = generateMaskFromCoords(unitsToFlap, h);
        console.log("generated circle grid is", grid);
        // does it have something to do with offsetting here? 
        let [timeGrid, times] = StutterOrder(this.order)(grid as boolean[][], (i: [number, number]) => h.coordToIndex(i)!);

        console.log(timeGrid, times)
        let actions: GroupAction[] = []

        for (let t of times) {
            let units = timeGrid.map((r, ri) => r.reduce((acc: number[], c: number, ci: number) => {
                if (c == t) {
                    // acc.push(h.coordToIndex([ci, ri]));
                    acc.push(h.coordToIndex([ci + (x as number), ri + (y as number)]));
                }

                return acc;
            }, [] as number[])).flat();

            console.log(units)
            actions.push(new GroupAction(t, [[Action.FLIP, units]]));
        }

        return actions;
    }


}

export let generateMaskFromCoords = (units: UnitId[], h: HardwareInterface) => {
    let coords = [...units].map(u => h.indexToCoord.get(u)!);

    let minX = Math.min(...coords.map(u => u[0]))
    let maxX = Math.max(...coords.map(u => u[0]))
    let minY = Math.min(...coords.map(u => u[1]))
    let maxY = Math.max(...coords.map(u => u[1]))

    let spanX = maxX - minX;
    let spanY = maxY - minY;

    let grid = [...new Array(spanY + 1)].map(_ => new Array(spanX + 1).map(_ => false));
    console.log(spanX, spanY, minX, minY)
    console.log(coords)
    coords.forEach(c => {
        let x = c[0] - minX;
        let y = c[1] - minY;
        // console.log(x, y)
        grid[y][x] = true;
    })

    return [grid, minX, minY];
}

export class WaveTransition implements Transition {
    order: GridOrder;

    constructor(order: GridOrder) {
        this.order = order;
    }

    generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
        // how many steps do I get though?
        // let flipTiming = h.actionDurations.get(Action.FLIP)!;

        let unitsToFlap = new Set(diffIndices(o1, o2, h));

        let [grid, x, y] = generateMaskFromCoords([...unitsToFlap], h);

        let [timeGrid, times] = this.order.applyMask(grid as boolean[][]);
        // I need to remember that the SHAPE INDEX != global index! 
        console.log(timeGrid, times);
        let timeFunction = this.order.getTimeFunction(timeGrid, i => h.coordToIndex(i));


        let actions: GroupAction[] = [];

        let unitsSoFar: Set<UnitId> = new Set();

        // maybe ti should give you a time list ike Adriana suggested 
        for (let ti = 0; ti < times.length; ti += 1) {
            let time = times[ti];

            let draw = new Set(timeFunction(time));

            let update = draw.difference(unitsSoFar);
            unitsSoFar = unitsSoFar.union(update);
            console.log(update)
            let updateList = [...update].map(c => h.coordToIndex([h.indexToCoord.get(c)![0] + (x as number), h.indexToCoord.get(c)![1] + (y as number)]));
            let action = new GroupAction(time, [[Action.FLIP, updateList]]);

            actions.push(action);
        }


        console.log(actions)
        return actions;

    }
}


// export class WaveTransitionOld implements Transition {
//     dir: [number, number];
//     direction: (t: Time) => number[];
//     // I guess a time vector field?
//     start: UnitId

//     // how do I specify this.........
//     constructor(direction: (t: Time) => number[], dir: [number, number], start: UnitId) {
//         this.direction = direction;
//         this.dir = dir;
//         this.start = start;
//     }


//     generateGroupActions(o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] {
//         // how many steps do I get though?
//         // let flipTiming = h.actionDurations.get(Action.FLIP)!;

//         console.log(o1.draw())
//         console.log(o2.draw())
//         let unitsToFlap = new Set(diffIndices(o1, o2, h));
//         console.log(unitsToFlap);
//         // let steps = t / flipTiming;
//         // what's the "width" of the units, so to speak?

//         let first = this.direction(0);
//         let last = this.direction(1);

//         // console.log(first);
//         // console.log(last);
//         let maxDistance2 = maxL1Distance(first, last, h);
//         // TODO: max distance actually depends on the drawing shape

//         let max = maxDirectionalGraphDistance([...unitsToFlap], (i: number) => h.indexToCoord.get(i)!, h.unitAdjacency, this.dir)!

//         // let maxDistance = 5
//         console.log("max dist is", max, maxDistance2)
//         // TODO: why isn't it the full 15 frames? 

//         // you know what forget it. I'm calling this function again.
//         // TODO: OPTIMIZE/DECIDE WHERE THIS SHOULD LIVE!
//         let fn = generateDirection(this.start, this.dir, h);
//         let smallest = fn.timeOf(max.start)!;
//         let largest = fn.timeOf(max.end)!;
//         // console.log(`min is ${max.start} at time ${smallest}, max is ${max.end} at time ${largest}, giving ${smallest-largest} maxDistance2);

//         // let maxDistance = largest - smallest;
//         let maxDistance = max.distance

//         // in the time that I have, how much distance must I cover? 
//         let timePerRow = maxDistance / t; // number of rows divided by time
//         // TODO: time should actually only start AT the first unit... 
//         console.log(timePerRow)

//         let actions: GroupAction[] = [];

//         let unitsSoFar: Set<UnitId> = new Set();

//         for (let time = 0; time < t; time += timePerRow) {

//             // now we are going to make each step with time
//             // drawFrame(rectSize, [, ], hardware);

//             // time is from 0 to 1
//             // console.log("bbbbb")
//             let unitsPassedOver = new Set(this.direction(time / t));
//             console.log(unitsPassedOver)
//             let draw = unitsPassedOver.intersection(unitsToFlap);
//             console.log(unitsToFlap)
//             console.log(draw);

//             let update = draw.difference(unitsSoFar);
//             unitsSoFar = unitsSoFar.union(update);
//             let action = new GroupAction(time, [[Action.FLIP, [...update]]]);

//             actions.push(action);
//         }


//         console.log(actions)
//         return actions;

//     }

//     // what's the difference between effect and transition?
//     // transiton can perform 
// }


export class CascadeImage implements Transition {

    order: GridOrder;

    constructor(order: GridOrder) {
        this.order = order;
    }

    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        // What I should do is: 
        // establish frames that units are going to start flipping FASTER/SLOWER (let's say slower.)
        let flip = diffIndices(o1, o2, h);
        let [mask, x, y] = generateMaskFromCoords(flip, h);
        let [maskTime, times] = this.order.applyMask(mask as boolean[][]);

        console.log(maskTime)
        let result = [];
        const rows = maskTime.length;
        const cols = maskTime[0].length;

        // Flatten grid → unit IDs
        const unitIds: UnitId[] = h.units.map(i => i.id);
        const frameMap = new Map<number, UnitId[]>();

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const frame = maskTime[r][c];

                let id = h.coordToIndex([c + (x as number), r + (y as number)]);
                

                if (!frameMap.has(frame)) {
                    frameMap.set(frame, []);
                }
                
                frameMap.get(frame)!.push(id);
            }
        }

        const allFrames = Array.from(frameMap.keys()).sort((a, b) => a - b);

        let flipTime = h.actionDurations.get(Action.FLIP)! * 3;
        let currentTime: Time = 0;

        for (const frame of allFrames) {
            const activeUnits = new Set(frameMap.get(frame)!);

            const backgroundUnits = unitIds.filter(u => !activeUnits.has(u));

            // 4 ticks per frame
            for (let tick = 0; tick < 4; tick++) {
                const actions: [Action, UnitId[]][] = [];

                // Background always flips
                if (backgroundUnits.length > 0) {
                    actions.push([Action.FLIP, backgroundUnits]);
                }

                // Active flips only on ticks 0 and 2 (half speed)
                if ((tick === 0 || tick === 2) && activeUnits.size > 0) {
                    actions.push([Action.FLIP, Array.from(activeUnits)]);
                }

                result.push(new GroupAction(currentTime, actions));
                currentTime += flipTime;
            }
        }

        return result;


    }
}

export class MotionImage implements Transition {
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        // okay:
        // I'm going to flip everything, but I'm going to flip the off ones at a slight offset 
        let oddFlips = new Set(diffIndices(o1, o2, h));
        // the first flips are this, but the subsequent flips should just be the same as o1.
        let subsequent = [];
        let others = [];
        let o2Flips = o2.draw();
        for (let i = 0; i < o2Flips.length; i++) {
            for (let j = 0; j < o2Flips[0].length; j++) {
                if (o2Flips[i][j]) {
                    subsequent.push(h.coordToIndex([i, j]));
                } else {
                    // console.log(i, j)
                    others.push(h.coordToIndex([i, j]));
                }
            }
        }

        console.log(subsequent)
        console.log(others)

        // how many flips should I do?
        let flipTiming = h.actionDurations.get(Action.FLIP)!;
        console.log(flipTiming)
        let maxFlips = Math.floor(t / flipTiming);
        let oddCount = maxFlips % 2 == 0 ? maxFlips - 1 : maxFlips;
        let evenCount = maxFlips % 2 == 1 ? maxFlips : maxFlips - 1;
        let delta = flipTiming / 2;
        let groupActions: GroupAction[] = [];

        console.log(oddCount)
        for (let i = 0; i < oddCount; i++) {
            let time = i * flipTiming;
            console.log("time is ", time)
            let idxes = [...oddFlips];
            if (i != 0) {
                idxes = subsequent;
            }
            let action = new GroupAction(time, [[Action.FLIP, idxes]])
            groupActions.push(action);
            // let's push another one that's slightly offset!
            if (i != 0) {
                // groupActions = groupActions.concat([...new Array(180).keys()].map(i => new GroupAction(t / 180 * i + time + delta, [[Action.INCREMENT, [...others]]])));

                groupActions.push(new GroupAction(time + delta, [[Action.FLIP, [...others]]]));
            }
        }

        console.log(groupActions)
        return groupActions;
        // one extra at the end 

    }
}


export class OverrotateRevealTransition implements Transition {
    order: GridOrder;
    overrotateAt: (unit: UnitId) => Time = _ => 0.8;
    overrotateDeg: (unit: UnitId) => number = _ => 15;

    constructor(order: GridOrder = new AllAtOnce()) {
        // todo: this order actually specifies the beginning time.
        this.order = order;
    }

    // wavefront target -> it's a pixel path
    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let flip = diffIndices(o1, o2, h);

        // hmm... annoying
        let [mask, x, y] = generateMaskFromCoords(flip, h);
        let [maskTime, times] = this.order.applyMask(mask as boolean[][]);
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

            // all of these should be offset by the starting time according to the order
            let coord = h.indexToCoord.get(id)!;
            console.log(coord, maskTime)
            let startAtTime = maskTime[coord[1] - (y as number)][coord[0] - (x as number)];
            let reachBy = t * ora;
            let overrotateDuration = t * (1 - ora) / 2;
            let startToReturn = reachBy + overrotateDuration;

            console.log(ora, ord)
            console.log(t, reachBy, startToReturn);

            // so first, generate the initial rotation
            [...new Array(180).keys()].forEach(i => {
                let time = reachBy / 180 * i + startAtTime;
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
                let time = reachBy + (overrotateDuration / ord) * i + startAtTime;
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
                let time = startToReturn + (overrotateDuration / ord) * i + startAtTime;
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

    }
}

// TODO: make thinking systematic
// improve way to specify brixel positions 

export class RotateRevealTransition implements Transition {
    order: GridOrder;

    constructor(order: GridOrder = new AllAtOnce()) {
        this.order = order;
    }

    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        let flip = diffIndices(o1, o2, h);
        // I need to actually generate enough of these that this flips 180 in the specified target duration
        // or put another way.... it's 180 at the time.
        console.log(o1.draw(), o2.draw())
        console.log(flip)

        let [mask, x, y] = generateMaskFromCoords(flip, h);
        let [maskTime, times] = this.order.applyMask(mask as boolean[][]);
        let getTime = (i: UnitId) => {
            // when does this unit flip? given any unit.
            let coord = h.indexToCoord.get(i)!;
            if (coord[0] >= maskTime[0].length || coord[1] >= maskTime.length) return 0
            console.log(coord)
            console.log(maskTime)
            return maskTime[coord[1]][coord[0]]
        }

        // but I can't generate the state.... 
        // I need to generate a movement for each of the ones that will flip.
        // total duration plus.... order...?
        return [...new Array(180).keys()].map(i => new GroupAction(t / 180 * i + getTime(i), [[Action.INCREMENT, flip]]));


    }
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

export class FlipConstantSpeed implements Transition {
    flipsPerSecond: number = 1;
    maxSimultaneousFinishes: number = Infinity;

    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        // what is the target made of here?
        if (!isSplitflapHardware(h)) {
            throw new Error("Cannot flip with this hardware type")
        }

        // this is going to be the target set, but I need to order it in terms of my units. 
        let d2: Colour[][] = o2.draw();

        let units = h.units;

        let d2AsUnits: [number, Colour][] = d2.map((row, i) => row.map((col, j) => [h.coordToIndex([j, i]), col] as [number, Colour])).flat();
        let unitOrder: number[] = units.map(u => u.id);
        d2AsUnits.sort((a: [number, Colour], b: [number, Colour]) => unitOrder.findIndex(c => c == a[0]) - unitOrder.findIndex(c => c == b[0]));
        let targets = d2AsUnits.map(c => new SplitflapState(`${c[1]}`));


        const schedule = new Map<UnitId, Time[]>();
        const finishBuckets = new Map<Time, UnitId[]>();
        const dt = 1 / this.flipsPerSecond;

        for (let i = 0; i < units.length; i++) {
            let unit = units[i];
            console.log(unit, targets[i])
            const flips = h.computeFlipDistance(unit as SplitflapUnit, targets[i]);
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
            if (ids.length <= this.maxSimultaneousFinishes) continue;

            ids.slice(this.maxSimultaneousFinishes).forEach((id, i) => {
                schedule.get(id)!.push(time + (i + 1) * dt);
            });
        }

        return buildTimeline(schedule);
    }

}

export class FlipDirectional implements Transition {
    flipsPerSecond: number = 1;
    order: GridOrder;
    synchronizedStart = true;

    constructor(order: GridOrder) {
        this.order = order;
    }


    startAnytime = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        if (!isSplitflapHardware(h)) {
            throw new Error("Cannot flip with this hardware type")
        }

        // this is going to be the target set, but I need to order it in terms of my units. 
        let d2: Colour[][] = o2.draw();

        let units = h.units;

        let d2AsUnits: [number, Colour][] = d2.map((row, i) => row.map((col, j) => [h.coordToIndex([j, i]), col] as [number, Colour])).flat();

        let relevantUnits = d2AsUnits.filter(a => a[1] != " ");

        console.log("order", d2AsUnits.map(a => a[0]))
        // console.log("order", unitOrder)
        let targets = relevantUnits.map(c => new SplitflapState(`${c[1]}`));
        console.log("order", targets)

        // todo: this looks at all the units, but it's okay because it's relative spacing 
        let [mask, x, y] = generateMaskFromCoords(relevantUnits.map(a => a[0]), h);
        let [maskTime, times] = this.order.applyMask(mask as boolean[][]);

        const dt = 1 / this.flipsPerSecond;
        console.log(dt)

        relevantUnits.sort((a, b) => {
            let ca = h.indexToCoord.get(a[0])!;
            let cb = h.indexToCoord.get(b[0])!;

            console.log(maskTime)
            return maskTime[ca[1] - (y as number)][ca[0] - (x as number)] - maskTime[cb[1] - (y as number)][cb[0] - (x as number)];
        })

        const schedule = new Map<UnitId, Time[]>();
        let currentEnd = 0;

        // TODO this doesn't 100% follow the order specification :\ because it's not specifying pauses 
        for (let i = 0; i < relevantUnits.length; i++) {
            let unit = units[relevantUnits[i][0]];
            const flips = h.computeFlipDistance(unit as SplitflapUnit, targets[i]);
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

        console.log("order", schedule)


        return buildTimeline(schedule);
    }

    startTogether = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        if (!isSplitflapHardware(h)) {
            throw new Error("Cannot flip with this hardware type")
        }

        // this is going to be the target set, but I need to order it in terms of my units. 
        let d2: Colour[][] = o2.draw();

        let units = h.units;

        let d2AsUnits: [number, Colour][] = d2.map((row, i) => row.map((col, j) => [h.coordToIndex([j, i]), col] as [number, Colour])).flat();

        let relevantUnits = d2AsUnits.filter(a => a[1] != " ");

        console.log("order", d2AsUnits.map(a => a[0]))
        // console.log("order", unitOrder)
        let targets = relevantUnits.map(c => new SplitflapState(`${c[1]}`));
        console.log("order", targets)

        // todo: this looks at all the units, but it's okay because it's relative spacing 
        let [mask, x, y] = generateMaskFromCoords(relevantUnits.map(a => a[0]), h);
        let [maskTime, times] = this.order.applyMask(mask as boolean[][]);

        const dt = 1 / this.flipsPerSecond;

        // const required = ordered.map(u => h.computeFlipDistance(u as SplitflapUnit));


        const schedule = new Map<UnitId, Time[]>();
        let minFinishFlips = 0;

        // this needs to be given in order.
        relevantUnits.sort((a, b) => {
            let ca = h.indexToCoord.get(a[0])!;
            let cb = h.indexToCoord.get(b[0])!;

            console.log(maskTime)
            return maskTime[ca[1] - (y as number)][ca[0] - (x as number)] - maskTime[cb[1] - (y as number)][cb[0] - (x as number)];
        })


        for (const toSpin of relevantUnits) {
            let target = new SplitflapState(`${toSpin[1]}`);
            let unit = units.find(u => toSpin[0] == u.id)!;
            const need = h.computeFlipDistance(unit as SplitflapUnit, target);

            // must:
            // - reach target
            // - finish no earlier than previous
            // if we go with minFinishFlips though, that implies we need to go farther than needed
            // let's slow down then 
            // alternative: if it's really close, we should probably consider also adding a full set of flips
            let delay = 3; // could be elongated
            const flips = Math.max(need, minFinishFlips);

            // I do this the +1 is a bit slow...
            minFinishFlips = flips + delay; // enforce strict ordering
            schedule.set(
                unit.id,
                flipsFromCount(need, flips, dt)
            );
        }

        console.log(schedule)
        return buildTimeline(schedule);
    }

    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        if (this.synchronizedStart) {
            return this.startTogether(o1, o2, t, h);
        } else {
            return this.startAnytime(o1, o2, t, h);
        }
    }

}


function flipsFromCount(flips: number, maxFlips: number, dt: number): Time[] {
    // let's ignore how long it takes to flip
    let div = maxFlips / flips * dt;
    const times: Time[] = [];
    for (let i = 0; i < flips; i++) {
        times.push(i * div);
    }
    return times;

}

export class FlipSyncEnd implements Transition {
    flipsPerSecond: number = 1;
    initializationDelay: number = 0;
    synchronizedStart = true;

    startAnytime = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        if (!isSplitflapHardware(h)) {
            throw new Error("Cannot flip with this hardware type")
        }

        // this is going to be the target set, but I need to order it in terms of my units. 
        let d2: Colour[][] = o2.draw();

        let units = h.units;

        let d2AsUnits: [number, Colour][] = d2.map((row, i) => row.map((col, j) => [h.coordToIndex([j, i]), col] as [number, Colour])).flat();
        let unitOrder: number[] = units.map(u => u.id);
        d2AsUnits.sort((a: [number, Colour], b: [number, Colour]) => unitOrder.findIndex(c => c == a[0]) - unitOrder.findIndex(c => c == b[0]));
        let targets = d2AsUnits.map(c => new SplitflapState(`${c[1]}`));


        const schedule = new Map<UnitId, Time[]>();
        const dt = 1 / this.flipsPerSecond;
        console.log(dt)

        const maxFlips = Math.max(
            ...units.map((u, i) => h.computeFlipDistance(u as SplitflapUnit, targets[i]))
        );

        const endTime = this.initializationDelay + maxFlips * dt;

        for (let i = 0; i < units.length; i++) {
            let unit = units[i]
            const flips = h.computeFlipDistance(unit as SplitflapUnit, targets[i]);
            const startTime = endTime - flips * dt;
            const times: Time[] = [];

            for (let i = 0; i < flips; i++) {
                times.push(startTime + i * dt);
            }

            schedule.set(unit.id, times);
        }

        return buildTimeline(schedule);

    }

    startTogether = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {
        if (!isSplitflapHardware(h)) {
            throw new Error("Cannot flip with this hardware type")
        }

        // this is going to be the target set, but I need to order it in terms of my units. 
        let d2: Colour[][] = o2.draw();

        let units = h.units;

        let d2AsUnits: [number, Colour][] = d2.map((row, i) => row.map((col, j) => [h.coordToIndex([j, i]), col] as [number, Colour])).flat();
        let unitOrder: number[] = units.map(u => u.id);
        d2AsUnits.sort((a: [number, Colour], b: [number, Colour]) => unitOrder.findIndex(c => c == a[0]) - unitOrder.findIndex(c => c == b[0]));

        let relevantUnits = d2AsUnits.filter(a => a[1] != " ");
        let targets = relevantUnits.map(c => new SplitflapState(`${c[1]}`));

        // each target is going to start spinning right away.

        const required = new Map<UnitId, number>();
        let maxRequired = 0;

        for (const toSpin of relevantUnits) {
            let target = new SplitflapState(`${toSpin[1]}`);
            let unit = units.find(u => toSpin[0] == u.id)!;
            const flips = h.computeFlipDistance(unit as SplitflapUnit, target);
            required.set(unit.id, flips);
            maxRequired = Math.max(maxRequired, flips);
        }

        const schedule = new Map<UnitId, Time[]>();
        // now I need to calculate
        // every unit needs to flip at least as many as MAX
        // I can employ one of two strategies: flip more, or slow down flipping 
        // let's slow down flipping
        for (const toSpin of relevantUnits) {
            let unit = units.find(u => toSpin[0] == u.id)!;

            const actualFlips = flipsFromCount(required.get(unit.id)!, maxRequired, 1 / this.flipsPerSecond)
            schedule.set(
                unit.id, actualFlips
            );
        }


        return buildTimeline(schedule);

    }

    generateGroupActions = (o1: Target, o2: Target, t: Duration, h: HardwareInterface): GroupAction[] => {

        if (this.synchronizedStart) {
            return this.startTogether(o1, o2, t, h);
        } else {
            return this.startAnytime(o1, o2, t, h);
        }
    }

}