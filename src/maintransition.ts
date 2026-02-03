import { GroupAction, Time, FlipdotSimHardware } from "./hardware";
import { parseToGroupAction } from "./language2";

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

    parseToGroupAction(teapot2Example);


    let wipeExample = "timing: [15,15]\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 1 -> wipe -> rectangle 0";

    // parseToGroupAction(wipeExample);


    let sparkleExample = "timing: [15,15]\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 1 -> sparkle -> rectangle 0";
    // there's an element of randomness here, which cannot be good. maybe one of assumptions violated 
    // parseToGroupAction(sparkleExample);


    let logoExample = "timing: [15,15]\n\
    filepath: /animations/text-logo${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 0 -> sparkle -> rectangle 1";

    // parseToGroupAction(logoExample) ;

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

    // let threed = new FlipdotSimHardware([], i => [], undefined, "public/lowpolybunny.stl");
    // threed.finalize3D().then(_ => {
    //     console.log("got it")
    //     console.log(threed.simulation.getProjectionFor3DHardware([0, 0, -1]));
    // });

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