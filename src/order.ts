import { UnitId } from "./hardware";


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
    startAt: [number, number];
    growBy: (x: number, y: number) => [number, number][];
    stepTiming: number[]; // need to figure out what type to make this.. maybe just a list that cycles?

    constructor(startAt: [number, number], growBy: (x: number, y: number) => [number, number][], stepTiming: number[] = [1]) {
        super();
        this.startAt = startAt;
        this.growBy = growBy;
        this.stepTiming = stepTiming;
    }

    generateGrid(width: number, height: number): OrderedGrid {
        let frontier: Set<string> = new Set();
        frontier.add(`${this.startAt[0]}|${this.startAt[1]}`);

        let grid = [...new Array(height)].map(_ => [... new Array(width)]);
        let counter = 0;
        let stepTimingIdx = 0;
        grid[this.startAt[1]][this.startAt[0]] = 0;


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


export class GrowFromCentre extends GrowFromPoint {
    constructor(startAt: [number, number], stepTiming: number[] = [1]) {
        super(startAt, (x: number, y: number) => [[x+1,y+1],[x+1,y],[x,y+1],[x-1,y],[x-1,y+1],[x-1,y-1],[x,y-1],[x+1,y-1]], stepTiming);
        
    }

}

// what if we had a transformer on the grid ordering 
export let StutterOrder = (originalOrder: GridOrder): ((shape: boolean[][], projection: Projection) => [OrderedGrid, number[]]) => {
    // can it modify the method itself? 
    // 
    return (shape: boolean[][], projection: Projection) => {
        console.log(shape)
        let [grid, times] = originalOrder.applyMask(shape);

        // randomly swap some of the orders
        const
            swapProbability = 0.15,
            windowSize = 6,
            biasFn = (i: number, n: number) => Math.sin(Math.PI * i / n);



        const cells: { order: number; x: number; y: number }[] = []

        for (let y = 0; y < grid.length; y++) {
            for (let x = 0; x < grid[0].length; x++) {
                cells.push({ order: grid[y][x], x, y })
            }
        }

        cells.sort((a, b) => a.order - b.order)
        let orderedCells = cells.map(({ x, y }) => ({ x, y }))
        const n = orderedCells.length

        // Copy for swapping
        const permuted = [...orderedCells]

        for (let i = 0; i < n; i++) {
            if (Math.random() > swapProbability * biasFn(i, n)) continue

            const min = Math.max(0, i - windowSize)
            const max = Math.min(n - 1, i + windowSize)
            const j = min + Math.floor(Math.random() * (max - min + 1))

            if (j === i) continue
                ;[permuted[i], permuted[j]] = [permuted[j], permuted[i]]
        }

        // Create result time grid
        const h = grid.length
        const w = grid[0].length
        const result: number[][] = Array.from({ length: h }, () =>
            Array(w).fill(0)
        )

        // Monotonic time assignment (guarantees completion at t = 1)
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 1 : i / (n - 1)
            const { x, y } = permuted[i]
            result[y][x] = t
        }

        return [result, times]

    }

}

