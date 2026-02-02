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
        console.log(this.startAt);
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

        let newGrid = grid.map(r => r.map(c => c));
        // randomly swap some of the orders
        const
            swapProbability = 0.15,
            windowSize = 6,
            biasFn = (i: number, n: number) => Math.sin(Math.PI * i / n);

        /// this effect isn't really the same as the "expanding" effect since there's no radius falloff likelihood 
            let coords = grid.map((row, j) => row.map((c, i) => [i, j])).flat();
            let numSwaps = Math.ceil(swapProbability * coords.length);
            let swappedAlready: number[] = []
            for (let n = 0; n < numSwaps; n++) {
                let s1 = Math.round(Math.random() * coords.length);
                while (swappedAlready.includes(s1)) {
                    s1 = Math.round(Math.random() * coords.length);
                }
                swappedAlready.push(s1);
                let s2 = Math.round(Math.random() * coords.length);
                while (swappedAlready.includes(s2)) {
                    s2 = Math.round(Math.random() * coords.length);
                }
                swappedAlready.push(s2);
                
                
                let coord1 = coords[s1];
                let coord2 = coords[s2];
                let intermediate = newGrid[coord1[1]][coord1[0]];
                newGrid[coord1[1]][coord1[0]] = newGrid[coord2[1]][coord2[0]];
                newGrid[coord2[1]][coord2[0]] = intermediate;
            }

            return [newGrid, times];
    }

}

