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


export class TopDown extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        // TODO: direction is flipped here, need to look into the whole flipping 
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                grid[i][j] = i;
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


export class RightToLeft extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        const grid = [...new Array(height)].map(_ => [...new Array(width)]);
        for (let i = 0; i < height; i++)
            for (let j = 0; j < width; j++)
                grid[i][j] = width - 1 - j;
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

export class BackAndForth extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        let forwards = true;
        let count = 0;
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                if (forwards) {
                    grid[i][j] = count++;
                } else {
                    grid[i][width - 1 - j] = count++;
                }
            }
            forwards = !forwards;
        }

        return grid;
    }
}
///// GO ChatGPT!

export class OutFromCentre extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let mid = Math.floor(width / 2);

        for (let i = 0; i < height; i++) {
            let frame = 0;
            grid[i][mid] = frame++;

            for (let offset = 1; offset < width; offset++) {
                if (mid - offset >= 0) {
                    grid[i][mid - offset] = frame;
                }
                if (mid + offset < width) {
                    grid[i][mid + offset] = frame;
                }
                frame++;
            }
        }

        return grid;
    }
}

export class StaggeredRow extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        const grid = Array.from({ length: height }, () => Array(width).fill(0));

        for (let i = 0; i < height; i++) {
            const leftToRight = i % 2 === 0;

            for (let j = 0; j < width; j++) {
                if (leftToRight) {
                    grid[i][j] = j;
                } else {
                    grid[i][j] = width - 1 - j;
                }
            }
        }

        return grid;
    }
}

export class SpiralIn extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let top = 0;
        let bottom = height - 1;
        let left = 0;
        let right = width - 1;
        let frame = 0;

        while (top <= bottom && left <= right) {

            for (let j = left; j <= right; j++)
                grid[top][j] = frame++;
            top++;

            for (let i = top; i <= bottom; i++)
                grid[i][right] = frame++;
            right--;

            if (top <= bottom) {
                for (let j = right; j >= left; j--)
                    grid[bottom][j] = frame++;
                bottom--;
            }

            if (left <= right) {
                for (let i = bottom; i >= top; i--)
                    grid[i][left] = frame++;
                left++;
            }
        }

        return grid;
    }
}

export class RowByRowOverlap extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let half = Math.floor(width / 2);

        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                let reversedIndex = width - 1 - j;
                grid[i][reversedIndex] = i * half + j;
            }
        }

        return grid;
    }
}

export class RandomOrder extends GridOrder {
    constructor(private maxPerFrame: number = 3) {
        super();
    }

    generateGrid(width: number, height: number): OrderedGrid {
        const grid = Array.from({ length: height }, () => Array(width).fill(0));

        const cells: [number, number][] = [];

        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                cells.push([i, j]);
            }
        }

        // Fisher–Yates shuffle
        for (let k = cells.length - 1; k > 0; k--) {
            const r = Math.floor(Math.random() * (k + 1));
            [cells[k], cells[r]] = [cells[r], cells[k]];
        }

        let frame = 0;
        for (let i = 0; i < cells.length; i += this.maxPerFrame) {
            for (let k = 0; k < this.maxPerFrame && i + k < cells.length; k++) {
                const [row, col] = cells[i + k];
                grid[row][col] = frame;
            }
            frame++;
        }

        return grid;
    }
}

export class Diagonal extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let frame = 0;

        for (let sum = 0; sum <= width + height - 2; sum++) {
            for (let i = 0; i < height; i++) {
                let j = sum - i;
                if (j >= 0 && j < width) {
                    grid[i][j] = frame++;
                }
            }
        }

        return grid;
    }
}

export class LineDiagonal extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let N = 0;
        // let N = 1000;
        // let grid = [
        //     [N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N],
        //     [N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N],
        //     [N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 0, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N],
        //     [N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N],
        //     [N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N],
        //     [5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5]
        // ]


        let grid = [
            [N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N],
            [N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N],
            [N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 0, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N],
            [N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N],
            [N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N],
            [N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N]
        ]


        // grid = [
        //     [N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N].map(i => i == N ? N : i + 10),
        //     [N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N].map(i => i == N ? N : i + 5),
        //     [N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 0, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N],
        //     [N, N, N, N, N, N, N, N, N, N, N, 5, 4, 3, 2, 1, N, 1, 2, 3, 4, 5, N, N, N, N, N, N, N, N, N, N].map(i => i == N ? N : i + 5),
        //     [N, N, N, N, N, N, 5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5, N, N, N, N, N].map(i => i == N ? N : i + 10),
        //     [5, 4, 3, 2, 1, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, N, 1, 2, 3, 4, 5].map(i => i == N ? N : i + 15),
        // ]


        grid.reverse();
        return grid;
    }

    generateGridX(width: number, height: number): OrderedGrid {
        const grid = Array.from({ length: height }, () =>
            Array(width).fill(-1)
        );

        const centerRow = Math.floor(height / 2);
        const centerCol = Math.floor(width / 2);

        grid[centerRow][centerCol] = 0;

        for (let r = 0; r < height; r++) {
            const d = Math.abs(r - centerRow);
            if (d === 0) continue;

            const shift = (d - 1) * 5;

            const isAbove = r < centerRow;

            // LEFT SIDE
            for (let i = 0; i < 5; i++) {
                const c = centerCol - shift - 5 + i;
                if (c >= 0 && c < width) {
                    grid[r][c] = isAbove
                        ? i + 1        // 1 → 5 (reversed)
                        : 5 - i;       // 5 → 1 (original)
                }
            }

            // RIGHT SIDE (unchanged)
            for (let i = 0; i < 5; i++) {
                const c = centerCol + shift + 1 + i;
                if (c >= 0 && c < width) {
                    grid[r][c] = i + 1;
                }
            }
        }

        return grid;
    }
}

export class SpiralOut extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(-1));

        let cx = Math.floor(width / 2);
        let cy = Math.floor(height / 2);

        let x = cx;
        let y = cy;
        let dx = 1;
        let dy = 0;

        let segmentLength = 1;
        let segmentPassed = 0;
        let segmentCount = 0;

        let frame = 0;
        grid[y][x] = frame++;

        while (frame < width * height) {
            x += dx;
            y += dy;

            if (x >= 0 && x < width && y >= 0 && y < height) {
                grid[y][x] = frame++;
            }

            segmentPassed++;
            if (segmentPassed === segmentLength) {
                segmentPassed = 0;

                // rotate right
                [dx, dy] = [-dy, dx];
                segmentCount++;

                if (segmentCount % 2 === 0) {
                    segmentLength++;
                }
            }
        }

        return grid;
    }
}


export class CentrePulse extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let cx = (width - 1) / 2;
        let cy = (height - 1) / 2;

        let cells: { x: number; y: number; d: number }[] = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let dx = x - cx;
                let dy = y - cy;
                let dist = Math.sqrt(dx * dx + dy * dy);
                cells.push({ x, y, d: dist });
            }
        }

        cells.sort((a, b) => a.d - b.d);

        cells.forEach((cell, index) => {
            grid[cell.y][cell.x] = index;
        });

        return grid;
    }
}

export class OrganicRipple extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let cx = (width - 1) / 2;
        let cy = (height - 1) / 2;

        let cells: { x: number; y: number; value: number }[] = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {

                let dx = x - cx;
                let dy = y - cy;
                let dist = Math.sqrt(dx * dx + dy * dy);

                // Smooth noise distortion
                let noise =
                    Math.sin(x * 0.6) * 0.5 +
                    Math.sin(y * 0.6) * 0.5 +
                    Math.sin((x + y) * 0.3) * 0.5;

                let value = dist + noise;

                cells.push({ x, y, value });
            }
        }

        cells.sort((a, b) => a.value - b.value);

        cells.forEach((cell, index) => {
            grid[cell.y][cell.x] = index;
        });

        return grid;
    }
}



/////

export class PingPong extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = Array.from({ length: height }, () => Array(width).fill(0));

        let mid = Math.floor(width / 2);

        for (let i = 0; i < height; i++) {
            let frame = 0;
            grid[i][mid] = frame++;

            for (let offset = 1; offset < width; offset++) {
                if (mid - offset >= 0) {
                    grid[i][mid - offset] = frame++;
                }
                if (mid + offset < width) {
                    grid[i][mid + offset] = frame++;
                }
            }
        }

        return grid;
    }
}

export class MiddleOutDiagonal extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let mid = Math.floor(width / 2);
        let mid2 = width - mid;
        let grid1 = new Diagonal().generateGrid(mid, height);
        let grid2 = new Diagonal().generateGrid(mid2, height);
        // transpose grid2
        grid2.forEach(row => row.reverse());

        let both = grid1.map((r1, i) => r1.concat(grid2[i]));

        return both;
    }
}


export class ShallowDiagonal extends GridOrder {
    generateGrid(width: number, height: number): OrderedGrid {
        let compressedGrid = new Diagonal().generateGrid(Math.floor(width / 2) + 1, height);
        let grid = compressedGrid.map(r => r.map(c => [c, c]).flat());

        if (width % 2 == 1) {
            // drop the last column
            grid = grid.map(r => r.slice(0, -1))
        }

        return grid;
    }
}

export class MatrixDown extends GridOrder {
    // maybe we need more fine-grained operators to help make order generation easier? 
    generateGrid(width: number, height: number): OrderedGrid {
        let grid = [...new Array(height)].map(_ => [... new Array(width)]);

        // let's just randomly assign each column a start time. first, randomly order 
        let colStartTimes = [...new Array(width).keys()].map((a) => ({ sort: Math.random(), value: a }))
            .sort((a, b) => a.sort - b.sort)
            .map((a) => a.value);

        // extrapolate orders from smaller grids
        // also, need to combine orders and transitions to make building blocks - like matrix PLUS text reveal 
        let count = 0;
        for (let j of colStartTimes) {
            for (let i = 0; i < height; i++) {
                grid[i][j] = count + (height - 1 - i);
            }
            count++;

            // unless this is the last one, I don't want to go twice.
            if (Math.random() < 0.3 && j == colStartTimes[colStartTimes.length - 1]) {
                count++;
            }
        }

        // TODO: it's something like.... the total number must be divisible by four... 
        // because what happens is: we move in groups of 4 which means that sometimes frames get skipped
        // 
        return grid;
    }
}

export class SpiralOrder extends GridOrder {
    applyMask(shape: boolean[][]): [OrderedGrid, number[]] {
        // hmm... I should just do this?
        let activationSequence = this.spiralGridOrder(shape);
        console.log(activationSequence)
        let grid = this.generateGrid(shape[0].length, shape.length);

        for (let i = 0; i < activationSequence.length; i++) {
            let units = activationSequence[i];
            for (let unit of units) {
                // spiralGridOrder emits [row, col] tuples, so unpack accordingly.
                let [r, c] = unit;
                grid[r][c] = i;
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
        // 2. Compute center
        // -------------------------
        const centerR = Math.floor((minR + maxR) / 2);
        const centerC = Math.floor((minC + maxC) / 2);

        // -------------------------
        // 3. Spiral walk
        // -------------------------
        const visited = new Set<string>();
        const result: [number, number][][] = [];

        const key = (r: number, c: number) => `${r},${c}`;

        const dirs: [number, number][] = [
            [0, 1],  // right
            [1, 0],  // down
            [0, -1], // left
            [-1, 0], // up
        ];

        let r = centerR;
        let c = centerC;
        let stepSize = 1;
        let dirIndex = 0;
        let visitedCount = 0;

        const tryAdd = (rr: number, cc: number) => {
            if (
                rr >= 0 && rr < rows &&
                cc >= 0 && cc < cols &&
                grid[rr][cc]
            ) {
                const k = key(rr, cc);
                if (!visited.has(k)) {
                    visited.add(k);
                    result.push([[rr, cc]]); // 👈 ONE CELL PER FRAME
                    visitedCount++;
                }
            }
        };

        // Add center if valid
        tryAdd(r, c);

        while (visitedCount < totalTrue) {
            for (let turn = 0; turn < 2; turn++) {
                const [dr, dc] = dirs[dirIndex % 4];

                for (let i = 0; i < stepSize; i++) {
                    r += dr;
                    c += dc;
                    tryAdd(r, c);
                }

                dirIndex++;
            }

            stepSize++;
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
        let grid = this.generateGrid(shape[0].length, shape.length);

        for (let i = 0; i < activationSequence.length; i++) {
            let units = activationSequence[i];
            for (let unit of units) {
                // activationOrder returns [col, row] tuples (it swaps before
                // returning), so unit[0] is x and unit[1] is y.
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

// Like GrowAlongContour, but doesn't assume the shape is one connected
// component. Identifies every 8-connected component up front, picks a per-
// component seed (the cell closest to `startAt` within that component), and
// runs one BFS per component in lock-step so every component fills in
// parallel. Smaller components finish first; larger ones keep going.
export class GrowAlongContoursParallel extends GridOrder {
    startAt: [number, number];

    constructor(startAt: [number, number]) {
        super();
        this.startAt = startAt;
    }

    applyMask(shape: boolean[][]): [OrderedGrid, number[]] {
        let activationSequence = this.activationOrder(shape);
        let grid = this.generateGrid(shape[0].length, shape.length);

        for (let i = 0; i < activationSequence.length; i++) {
            for (let unit of activationSequence[i]) {
                // activationOrder returns [col, row] tuples.
                let x = unit[0];
                let y = unit[1];
                grid[y][x] = i;
            }
        }

        let times: number[] = grid.flat().filter(t => t != -1);
        times.sort((a, b) => a - b);
        times = [...new Set(times)];

        return [grid, times];
    }

    generateGrid(width: number, height: number): OrderedGrid {
        return [...new Array(height)].map(_ => [...new Array(width)].map(_ => -1));
    }

    activationOrder(shape: boolean[][]): [number, number][][] {
        const rows = shape.length;
        if (rows === 0) return [];
        const cols = shape[0].length;
        const startRow = this.startAt[1];
        const startCol = this.startAt[0];

        const dirs: [number, number][] = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1],
        ];

        const inBounds = (r: number, c: number) =>
            r >= 0 && r < rows && c >= 0 && c < cols;

        // 1. Flood-fill every 8-connected component.
        const componentId: number[][] = Array.from({ length: rows }, () =>
            Array(cols).fill(-1));
        const components: [number, number][][] = [];
        for (let r0 = 0; r0 < rows; r0++) {
            for (let c0 = 0; c0 < cols; c0++) {
                if (!shape[r0][c0] || componentId[r0][c0] !== -1) continue;
                const id = components.length;
                const comp: [number, number][] = [];
                const stack: [number, number][] = [[r0, c0]];
                componentId[r0][c0] = id;
                while (stack.length > 0) {
                    const [r, c] = stack.pop()!;
                    comp.push([r, c]);
                    for (const [dr, dc] of dirs) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (inBounds(nr, nc) && shape[nr][nc] && componentId[nr][nc] === -1) {
                            componentId[nr][nc] = id;
                            stack.push([nr, nc]);
                        }
                    }
                }
                components.push(comp);
            }
        }

        if (components.length === 0) return [];

        // 2. Per component, pick the seed cell closest (squared distance) to
        //    `startAt`. Each component grows from its own seed.
        const seeds: [number, number][] = components.map(comp => {
            let best: [number, number] = comp[0];
            let bestDist = Infinity;
            for (const [r, c] of comp) {
                const d = (r - startRow) ** 2 + (c - startCol) ** 2;
                if (d < bestDist) {
                    bestDist = d;
                    best = [r, c];
                }
            }
            return best;
        });

        // 3. Parallel BFS: each component has its own queue, all queues take
        //    one BFS step per output layer. Visited is shared but components
        //    don't overlap, so there's no contention.
        const visited: boolean[][] = Array.from({ length: rows }, () =>
            Array(cols).fill(false));
        const queues: [number, number][][] = seeds.map(seed => {
            visited[seed[0]][seed[1]] = true;
            return [seed];
        });

        const result: [number, number][][] = [];
        while (true) {
            let anyAlive = false;
            const layer: [number, number][] = [];

            for (const queue of queues) {
                if (queue.length === 0) continue;
                anyAlive = true;
                const layerSize = queue.length;
                for (let i = 0; i < layerSize; i++) {
                    const [r, c] = queue.shift()!;
                    layer.push([r, c]);
                    for (const [dr, dc] of dirs) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (inBounds(nr, nc) && shape[nr][nc] && !visited[nr][nc]) {
                            visited[nr][nc] = true;
                            queue.push([nr, nc]);
                        }
                    }
                }
            }

            if (!anyAlive) break;
            result.push(layer);
        }

        // Swap (r, c) → (x, y) to match the convention in applyMask above.
        return result.map(time => time.map(([r, c]) => [c, r]));
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



export class Ring extends GridOrder {
    generateGrid(_width: number, _height: number): number[][] {
        return [
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 0, 0, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ];
    }
}


export class BounceOrder extends GridOrder {
    generateGrid(_width: number, _height: number): number[][] {
        return [
            [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11, 11, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 0, 7, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        ].map(r => r.map(c => c == 0 ? -1 : c));
    }
}

export class BrickOrder extends GridOrder {
    generateGrid(_width: number, _height: number): number[][] {
        return [
            [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
            [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
            [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
            [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
            [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2],
            [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
        ];
    }
}

// Sweeps a crescent from the west edge inward toward the east.
// The sweep front is a circular arc centered on the east edge at refRowFraction of the
// height (row 0 = south). refRowFraction=0 → reference at NE corner, crescent starts at
// SW corner; refRowFraction=0.5 → reference at E-midpoint, whole left edge starts at once;
// refRowFraction=1 → reference at SE corner, crescent starts at NW corner.
export class CrescentOrder extends GridOrder {
    constructor(private refRowFraction: number = 0) {
        super();
    }

    generateGrid(width: number, height: number): OrderedGrid {
        const grid = Array.from({ length: height }, () => Array(width).fill(0));
        // refRow in grid coords (row 0 = south): 0 means NE corner, height-1 means SE corner
        const refRow = (height - 1) * (1 - this.refRowFraction);
        const maxDist = Math.sqrt((width - 1) ** 2 + Math.max(refRow, (height - 1) - refRow) ** 2);

        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const dx = width - 1 - j;
                const dy = refRow - i;
                grid[i][j] = Math.round(maxDist - Math.sqrt(dx * dx + dy * dy));
            }
        }

        return grid;
    }
}

// Animates the diff (cells passed via applyMask) starting from its outer
// boundary and propagating inward following the base order. The boundary cell
// with the lowest base order value anchors at time 1; cells further along in
// the order's direction get later times.
export class PropagateFromObject extends GridOrder {
    constructor(private baseOrder: GridOrder) {
        super();
    }

    generateGrid(width: number, height: number): OrderedGrid {
        return Array.from({ length: height }, () => Array(width).fill(-1));
    }

    applyMask(diff: boolean[][]): [OrderedGrid, number[]] {
        const height = diff.length;
        const width = diff[0].length;
        const base = this.baseOrder.generateGrid(width, height);
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        // Pareto front seeds: for each row and column, find the diff cell with
        // the lowest (earliest) base order value. A cell is a seed if it achieves
        // the minimum in BOTH its row and its column simultaneously.
        const rowMin = new Array(height).fill(Infinity);
        const colMin = new Array(width).fill(Infinity);
        for (let i = 0; i < height; i++)
            for (let j = 0; j < width; j++)
                if (diff[i]?.[j]) {
                    rowMin[i] = Math.min(rowMin[i], base[i][j]);
                    colMin[j] = Math.min(colMin[j], base[i][j]);
                }

        // BFS from the pareto front, propagating forward through the order
        // (only to neighbors with base >= current cell's base).
        const grid = this.generateGrid(width, height);
        const queue: [number, number][] = [];
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                if (diff[i]?.[j] && base[i][j] <= rowMin[i] && base[i][j] <= colMin[j]) {
                    grid[i][j] = 1;
                    queue.push([i, j]);
                }
            }
        }

        while (queue.length > 0) {
            const [r, c] = queue.shift()!;
            for (const [dr, dc] of dirs) {
                const nr = r + dr, nc = c + dc;
                if (nr >= 0 && nr < height && nc >= 0 && nc < width
                        && diff[nr]?.[nc] && grid[nr][nc] === -1
                        && base[nr][nc] >= base[r][c]) {
                    grid[nr][nc] = grid[r][c] + 1;
                    queue.push([nr, nc]);
                }
            }
        }

        let times: number[] = grid.flat().filter(t => t !== -1);
        times.sort((a, b) => a - b);
        times = [...new Set(times)];

        return [grid, times];
    }
}

// Assigns order values to diff cells via interpolation between the min and max
// pareto fronts of the diff under the base order. The min pareto front (cells
// whose base value is minimum in both their row and column — same logic as
// PropagateFromObject's seeds) gets t=0; the max pareto front gets t=1; every
// other diff cell is interpolated by averaging its per-row and per-column
// normalised positions in the base order (falling back to the global range for
// isolated cells where neither axis varies).
export class InterpolationOrder extends GridOrder {
    constructor(private baseOrder: GridOrder) {
        super();
    }

    generateGrid(width: number, height: number): OrderedGrid {
        return Array.from({ length: height }, () => Array(width).fill(-1));
    }

    applyMask(diff: boolean[][]): [OrderedGrid, number[]] {
        const height = diff.length;
        const width = diff[0].length;
        const base = this.baseOrder.generateGrid(width, height);

        // Per-row, per-column, and global min/max of base values within the diff.
        const rowMin = new Array(height).fill(Infinity);
        const rowMax = new Array(height).fill(-Infinity);
        const colMin = new Array(width).fill(Infinity);
        const colMax = new Array(width).fill(-Infinity);
        let vGlobalMin = Infinity, vGlobalMax = -Infinity;
        for (let i = 0; i < height; i++)
            for (let j = 0; j < width; j++)
                if (diff[i]?.[j]) {
                    const v = base[i][j];
                    rowMin[i] = Math.min(rowMin[i], v);
                    rowMax[i] = Math.max(rowMax[i], v);
                    colMin[j] = Math.min(colMin[j], v);
                    colMax[j] = Math.max(colMax[j], v);
                    vGlobalMin = Math.min(vGlobalMin, v);
                    vGlobalMax = Math.max(vGlobalMax, v);
                }
        const vGlobalSpan = Math.max(vGlobalMax - vGlobalMin, 1);

        // t=0 on the min pareto front (base = rowMin AND colMin), t=1 on the max.
        // Normalise within each row and column separately, then average the two
        // axes that vary. For isolated cells where neither axis varies, fall back
        // to the global normalisation so they still land at the right position.
        const grid = this.generateGrid(width, height);
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                if (!diff[i]?.[j]) continue;
                const v = base[i][j];
                const rSpan = rowMax[i] - rowMin[i];
                const cSpan = colMax[j] - colMin[j];
                const tRow = rSpan > 0 ? (v - rowMin[i]) / rSpan : -1;
                const tCol = cSpan > 0 ? (v - colMin[j]) / cSpan : -1;
                grid[i][j] =
                    tRow >= 0 && tCol >= 0 ? (tRow + tCol) / 2 :
                    tRow >= 0 ? tRow :
                    tCol >= 0 ? tCol :
                    (v - vGlobalMin) / vGlobalSpan;
            }
        }

        let times: number[] = grid.flat().filter(t => t !== -1);
        times.sort((a, b) => a - b);
        times = [...new Set(times)];

        return [grid, times];
    }
}