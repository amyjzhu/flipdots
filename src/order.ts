import { UnitId } from "./hardware";
import { frameDisplay } from "./util";


type OrderedGrid = number[][];
type Projection = (maskGridIdx: [number, number]) => UnitId;



export abstract class GridOrder {
    getTimeFunction(ordered: OrderedGrid, projection: Projection): (t: number) => UnitId[] {
        return (t: number) => {
            return ordered.map((row, i) => row.map((c, j) =>
                c != -1 && c <= t ? [j, i] : undefined))
                .flat().filter(i => i != undefined).map(item => projection(item as [number, number])) as UnitId[];
        }
    }

    // return times that change
    applyMask(shape: boolean[][]): [OrderedGrid, number[]] {
        // I generate the grid from the mask anyway... 
        let ordered = this.generateGrid(shape[0].length, shape.length);
        console.log(shape);
        console.log(ordered);
        let masked = shape.map((row, i) => row.map((c, j) => c ? ordered[i][j] : -1));

        let times: number[] = masked.flat().filter(t => t != -1);
        times.sort((a, b) => a - b);
        times = [... new Set(times)];

        return [masked, times]
    }

    abstract generateGrid(width: number, height: number): OrderedGrid;
}

export class AllAtOnce extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)].map(_ => 0));
        return grid;
    }
}

export class BottomUp extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        // TODO: direction is flipped here, need to look into the whole flipping 
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                grid[i][j] = height - i;
            }
        }

        return grid;
    }
}

export class LeftToRight extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        // TODO: direction is flipped here, need to look into the whole flipping 
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                grid[i][j] = j;
            }
        }

        console.log("left to right grid is", grid)
        return grid;
    }
}


export class BottomLeftWildfire extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                grid[i][j] = Math.max(i, j);
            }
        }

        return grid;
    }
}

// we actually want the time to represent something though 
export class GrowFromPoint extends GridOrder {
    startAt: (width: number, height: number) => [number, number];
    growBy: (x: number, y: number) => [number, number][];
    stepTiming: number[]; // need to figure out what type to make this.. maybe just a list that cycles?

    constructor(startAt: (width: number, height: number) => [number, number], growBy: (x: number, y: number) => [number, number][], stepTiming: number[] = [1]) {
        super();
        this.startAt = startAt;
        this.growBy = growBy;
        this.stepTiming = stepTiming;
    }

    generateGrid(width: number, height: number): OrderedGrid {
        let frontier: Set<string> = new Set();
        let startAt = this.startAt(width, height);
        console.log(this.startAt);
        frontier.add(`${startAt[0]}|${startAt[1]}`);

        let grid = [...new Array(height)].map(_ => [... new Array(width)]);
        let counter = 0;
        let stepTimingIdx = 0;
        console.log("why fail?", grid.length, grid[0].length, this.startAt)
        grid[startAt[1]][startAt[0]] = 0;


        while (grid.some(x => x == undefined) || counter <= width * height) {
            let newFrontier: Set<string> = new Set();

            let currentFrontier = frontier;


            let pareto = [...new Set(currentFrontier)]
            // console.log("pareto:", pareto)

            // console.log("new poins before adding", newFrontier)
            for (let point of pareto) {
                let x = parseInt(point.split("|")[0]);
                let y = parseInt(point.split("|")[1]);

                let newPts = this.growBy(x, y);

                for (let pt of newPts) {
                    let u = pt[0];
                    let v = pt[1];
                    if (u < width && u >= 0 && v < height && v >= 0) {
                        // console.log(u, v, width, height)
                        if (grid[v][u] == undefined) {
                            let ptStr = `${u}|${v}`;
                            try {
                                newFrontier.add(ptStr);
                            } catch (e) {
                                console.log(pt);
                                console.log(newFrontier.size);
                                console.log(newPts.length);

                            }
                        }
                        // console.log(newFrontier)
                    }
                }

            }

            frontier = newFrontier;
            for (let point of [...newFrontier]) {
                grid[parseInt(point.split("|")[1])][parseInt(point.split("|")[0])] = counter;
            }

            // need to index into steptiming 
            counter += this.stepTiming[stepTimingIdx]
            stepTimingIdx = (stepTimingIdx + 1) % this.stepTiming.length;
        }

        return grid;
    }
}

export class SpiralOrder extends GridOrder {
    applyMask(shape: boolean[][]): [OrderedGrid, number[]] {
        // hmm... I should just do this?
        let activationSequence = this.spiralGridOrder(shape);
        console.log(activationSequence)
        let grid = this.generateGrid(shape[0].length, shape[1].length);

        for (let i = 0; i < activationSequence.length; i++) {
            let units = activationSequence[i];
            for (let unit of units) {
                let x: number = unit[0];
                let y: number = unit[1];
                grid[y][x] = i;
            }
        }

        let times: number[] = grid.flat().filter(t => t != -1);
        times.sort((a, b) => a - b);
        times = [... new Set(times)];

        console.log(times);
        console.log(frameDisplay(shape))
        return [grid, times];
    }

    // this returns nothing because we need the shape itself.
    generateGrid(width: number, height: number): OrderedGrid {
        return [...new Array(height)].map(_ => [... new Array(width)].map(x => -1));

    }

    spiralGridOrder = (grid: boolean[][]): [number, number][][] => {
        const rows = grid.length;
        if (rows === 0) return [];
        const cols = grid[0].length;

        // -------------------------
        // 1. Find bounding box of shape
        // -------------------------
        let minR = rows, maxR = -1, minC = cols, maxC = -1;
        let totalTrue = 0;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!grid[r][c]) continue;
                totalTrue++;
                minR = Math.min(minR, r);
                maxR = Math.max(maxR, r);
                minC = Math.min(minC, c);
                maxC = Math.max(maxC, c);
            }
        }

        if (totalTrue === 0) return [];

        // -------------------------
        // 2. Compute center of shape
        // -------------------------
        const centerR = Math.floor((minR + maxR) / 2);
        const centerC = Math.floor((minC + maxC) / 2);

        // -------------------------
        // 3. Spiral walk
        // -------------------------
        const visited = new Set<string>();
        const result: [number, number][][] = [];

        const key = (r: number, c: number) => `${r},${c}`;

        // Spiral directions: right, down, left, up
        const dirs: [number, number][] = [
            [0, 1],
            [1, 0],
            [0, -1],
            [-1, 0],
        ];

        let r = centerR;
        let c = centerC;

        let stepSize = 1;
        let dirIndex = 0;
        let visitedCount = 0;

        const tryAdd = (rr: number, cc: number, layer: [number, number][]) => {
            if (
                rr >= 0 && rr < rows &&
                cc >= 0 && cc < cols &&
                grid[rr][cc]
            ) {
                const k = key(rr, cc);
                if (!visited.has(k)) {
                    visited.add(k);
                    layer.push([rr, cc]);
                    visitedCount++;
                }
            }
        };

        // First center cell
        if (grid[r][c]) {
            visited.add(key(r, c));
            result.push([[r, c]]);
            visitedCount = 1;
        }

        while (visitedCount < totalTrue) {
            // Each loop adds one spiral "ring"
            const layer: [number, number][] = [];

            for (let turn = 0; turn < 2; turn++) {
                const [dr, dc] = dirs[dirIndex % 4];

                for (let i = 0; i < stepSize; i++) {
                    r += dr;
                    c += dc;
                    tryAdd(r, c, layer);
                }

                dirIndex++;
            }

            stepSize++;

            if (layer.length > 0) {
                result.push(layer);
            }
        }

        return result;
    }
}


export class GrowFromCentre extends GrowFromPoint {
    constructor(startAt: (width: number, height: number) => [number, number], stepTiming: number[] = [1]) {
        super(startAt, (x: number, y: number) => [[x + 1, y + 1], [x + 1, y], [x, y + 1], [x - 1, y], [x - 1, y + 1], [x - 1, y - 1], [x, y - 1], [x + 1, y - 1]], stepTiming);
    }
}

export class GrowAlongContour extends GridOrder {
    startAt: [number, number];

    constructor(startAt: [number, number]) {
        super();
        this.startAt = startAt;
    }

    applyMask(shape: boolean[][]): [OrderedGrid, number[]] {
        // hmm... I should just do this?
        let activationSequence = this.activationOrder(shape);
        console.log(activationSequence)
        let grid = this.generateGrid(shape[0].length, shape[1].length);

        for (let i = 0; i < activationSequence.length; i++) {
            let units = activationSequence[i];
            for (let unit of units) {
                let x: number = unit[0];
                let y: number = unit[1];
                grid[y][x] = i;
            }
        }

        let times: number[] = grid.flat().filter(t => t != -1);
        times.sort((a, b) => a - b);
        times = [... new Set(times)];

        console.log(times);
        console.log(frameDisplay(shape))
        return [grid, times];
    }

    // this returns nothing because we need the shape itself.
    generateGrid(width: number, height: number): OrderedGrid {
        return [...new Array(height)].map(_ => [... new Array(width)].map(x => -1));

    }


    activationOrder(shape: boolean[][]): [number, number][][] {
        let grid = shape;
        let startRow = this.startAt[1];
        let startCol = this.startAt[0];

        const rows = grid.length;
        if (rows === 0) return [];
        const cols = grid[0].length;

        // 8-direction neighbors (better for smooth shapes)
        const dirs: [number, number][] = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1],
        ];

        const inBounds = (r: number, c: number) =>
            r >= 0 && r < rows && c >= 0 && c < cols;

        // ---------------------------
        // 1. Find closest filled cell
        // ---------------------------
        let start: [number, number] | null = null;
        let bestDist = Infinity;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!grid[r][c]) continue;
                const d = (r - startRow) ** 2 + (c - startCol) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    start = [r, c];
                }
            }
        }

        if (!start) return []; // no filled cells

        // ---------------------------
        // 2. BFS along shape
        // ---------------------------
        const visited: boolean[][] = Array.from({ length: rows }, () =>
            Array(cols).fill(false)
        );

        const result: [number, number][][] = [];
        const queue: [number, number][] = [];

        queue.push(start);
        visited[start[0]][start[1]] = true;

        while (queue.length > 0) {
            console.log(queue);
            console.log(queue.length);
            const layerSize = queue.length;
            const layer: [number, number][] = [];

            for (let i = 0; i < layerSize; i++) {
                const [r, c] = queue.shift()!;
                layer.push([r, c]);

                for (const [dr, dc] of dirs) {
                    const nr = r + dr;
                    const nc = c + dc;

                    if (inBounds(nr, nc) && grid[nr][nc] && !visited[nr][nc]) {
                        visited[nr][nc] = true;
                        queue.push([nr, nc]);
                    }
                }
            }

            result.push(layer);
        }

        console.log(
            "DB Total O:",
            grid.flat().filter(v => v).length
        );

        console.log(
            "DB Visited:",
            result.flat().length
        );

        // need to shuffle nr and nc
        return result.map(time => time.map(unit => [unit[1], unit[0]]))
        // return result;
    }
}

// what if we had a transformer on the grid ordering 
export let StutterOrder = (originalOrder: GridOrder): ((shape: boolean[][], projection: Projection) => [OrderedGrid, number[]]) => {
    // can it modify the method itself? 
    // 
    return (shape: boolean[][], projection: Projection) => {
        console.log(shape)
        // why should I apply mask to shape here? 
        // how come order... hmmm 

        let [grid, times] = originalOrder.applyMask(shape);

        let newGrid = grid.map(r => r.map(c => c));
        // randomly swap some of the orders
        const
            swapProbability = 0.15,
            windowSize = 6,
            biasFn = (i: number, n: number) => Math.sin(Math.PI * i / n);

        /// this effect isn't really the same as the "expanding" effect since there's no radius falloff likelihood 
        let coords = grid.map((row, j) => row.map((c, i) => [i, j])).flat();
        let maxIdx = coords.length - 1;
        let numSwaps = Math.ceil(swapProbability * coords.length);
        let swappedAlready: number[] = []
        for (let n = 0; n < numSwaps; n++) {
            let s1 = Math.round(Math.random() * maxIdx);
            while (swappedAlready.includes(s1)) {
                s1 = Math.round(Math.random() * maxIdx);
            }
            swappedAlready.push(s1);
            let s2 = Math.round(Math.random() * maxIdx);
            while (swappedAlready.includes(s2)) {
                s2 = Math.round(Math.random() * maxIdx);
            }
            swappedAlready.push(s2);


            let coord1 = coords[s1];
            let coord2 = coords[s2];
            let intermediate = newGrid[coord1[1]][coord1[0]];
            // console.log("coords are ", coord1, coord2, "newgrid dims are ", newGrid.length, newGrid[0].length)
            let intermediate2 = newGrid[coord2[1]][coord2[0]];
            newGrid[coord1[1]][coord1[0]] = intermediate2;
            newGrid[coord2[1]][coord2[0]] = intermediate;
        }

        return [newGrid, times];
    }

}

