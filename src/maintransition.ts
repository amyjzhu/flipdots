import { STLLoader } from "three/addons/loaders/STLLoader";
import { ALPHABET_WITH_EXCLAMATION } from "./constants";
import { GroupAction, Time, FlipdotSimHardware, Action, BrixelSimHardware, SplitflapHardware, SplitflapState, SplitflapUnit, scheduleConstantSpeed, scheduleDirectional, scheduleSyncEnd, buildTimeline, delayGroupActions } from "./hardware";
import { CircleTarget, LineBoil, LineTarget, parseToGroupAction, PixelArtTarget, RectangleTarget } from "./language2";
import { AllAtOnce, BackAndForth, BottomLeftWildfire, BottomUp, CentrePulse, Diagonal, GrowFromCentre, GrowFromPoint, LeftToRight, LineDiagonal, MatrixDown, MiddleOutDiagonal, OrganicRipple, OutFromCentre, PingPong, RandomOrder, RowByRowOverlap, ShallowDiagonal, SpiralIn, SpiralOrder, SpiralOut, StaggeredRow } from "./order";
import { RotateRevealTransition, OverrotateRevealTransition, FlipConstantSpeed, FlipDirectional, FlipSyncEnd, MotionImage, CascadeImage, SnapTransition, WaveTransition, OneByOne, OneByOneKeepFlipping, WaveTransition3D, AndThenFlipTo, LayerForeBackTransition } from "./transitions";
import { getImages } from "./util";

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

    let flipExample = "timing: [1,30]\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 1 -> flip -> rectangle 1";

    // parseToGroupAction(flipExample);


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

    parseToGroupAction(logoExample) ;

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

    // console.log(new LineBoil(new RectangleTarget(5, 5, [0, 0], [10, 10])).draw());

    let rectLineBoil = "timing: {\"frames\": [2,4], \"additional\":[6]}\n\
    filepath: /animations/wipe${i}.png \n\
    objects: [#000000 rectangle] \n\
    lineboil(rectangle 1) 0 -> instantaneous -> lineboil(rectangle 1) 1 -> instantaneous -> lineboil(rectangle 1) 2";

    // collision: collision(water 5, fish 5) 5 -> instantaneous -> collision(water 5, fish 5) 6";
    // parseToGroupAction(rectLineBoil);


    let logoBoilExample = "timing: {\"frames\": [2,4], \"additional\":[6, 8, 10, 12, 14, 16]}\n\
    filepath: /animations/text-logo${i}.png \n\
    objects: [#000000 rectangle] \n\
    lineboil(rectangle 0) 0 -> instantaneous -> lineboil(rectangle 1) 1 -> instantaneous -> lineboil(rectangle 1) 2 -> instantaneous -> lineboil(rectangle 1) 3 -> instantaneous -> lineboil(rectangle 1) 4  -> instantaneous -> lineboil(rectangle 1) 5  -> instantaneous -> lineboil(rectangle 1) 6  -> instantaneous -> lineboil(rectangle 1) 7";

    // parseToGroupAction(logoBoilExample);


    let headExample = "timing: [60,62]\n\
    filepath: /animations/squiggle${i}.png \n\
    objects: [#000000 rectangle] \n\
    rectangle 0 -> drawingHead -> rectangle 1";
    // parseToGroupAction(headExample);




    let golfPathExample = "timing: [2,4,6,8,10,12,14,16,18]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 8\n\
golfer 0 ->* instantaneous ->* golfer 8\n\
ball 3 ->* move ->* ball 8"
    // ball 4 ->* path -> ball 8"
    // path1: ball 5 -> path -> ball 6\n\
    // path2: path1 6 -> path -> ball 7\n\"
    // parseToGroupAction(golfPathExample);

    let offsetGroupActions = (ga: GroupAction[], t: Time): GroupAction[] => {
        return ga.map(g => new GroupAction(g.tPlus + t, g.actions));
    }


    // // let brixels = new BrixelDisplay(10, 20);
    // // brixels.setAnimationSequence([[1, 10, 60], [2, 20, 90], [5, 30,60], [2, 30, 15]])
    // let brixelHw = BrixelSimHardware.Rectangular(10, 20);

    // let actions = new RotateRevealTransition().generateGroupActions(new CircleTarget(1, [5, 5], [10, 20]), new CircleTarget(3, [4, 4], [10, 20]), 200, brixelHw)

    // let orrt = new OverrotateRevealTransition();
    // orrt.overrotateAt = id => {
    //     let row = brixelHw.indexToCoord.get(id)![0];
    //     console.log(row)
    //     return row == 2 ? 0.6 : row == 3 ? 0.7 : row == 4 ? 0.8 : row == 5 ? 0.9 : 1;
    //     // return row == 4 ? 0.7 : row == 6 ? 0.9 : 0.8;
    //     // return 0.7
    // }

    //
    /*
        let s = new CircleTarget(0, [4, 4], [10, 20]);
        let t1 = new CircleTarget(1, [4, 4], [10, 20]);
        let t2 = new CircleTarget(3, [3, 3], [10, 20]);
        let t3 = new CircleTarget(5, [2, 2], [10, 20])
    
        let actions1 = orrt.generateGroupActions(s, t1, 300, brixelHw)
        let actions2 = orrt.generateGroupActions(t1, t2, 300, brixelHw);
        let actions3 = orrt.generateGroupActions(t2, t3, 300, brixelHw);
        // console.log(actions)
        // now, how do I do it so that it takes more time depending on its location?
    
        let actionsTogether = actions1.concat(offsetGroupActions(actions2, actions1[actions1.length-1].tPlus).concat(offsetGroupActions(actions3, actions2[actions2.length-1].tPlus + actions1[actions1.length-1].tPlus)));
        // let actionsTogether = actions1.concat(offsetGroupActions(actions2, actions1[actions1.length-1].tPlus).concat(offsetGroupActions(actions3, actions2[actions2.length-1].tPlus + actions1[actions1.length-1].tPlus)));
        brixelHw.compile(actionsTogether);
    */

    // // what about a wave vs a set of rows flipping.
    // let w1 = new RectangleTarget(10, 0, [0,0], [10,20]);
    // let w2 = new RectangleTarget(10, 2, [0,0], [10,20]);
    // let w3 = new RectangleTarget(10, 4, [0,0], [10,20]);
    // let w4 = new RectangleTarget(10, 6, [0,0], [10,20]);
    // let w5 = new RectangleTarget(10, 8, [0,0], [10,20]);
    // let w6 = new RectangleTarget(10, 10, [0,0], [10,20]);
    // let w7 = new RectangleTarget(10, 12, [0,0], [10,20]);
    // let w8 = new RectangleTarget(10, 14, [0,0], [10,20]);
    // let w9 = new RectangleTarget(10, 16, [0,0], [10,20]);
    // let w10 = new RectangleTarget(10, 18, [0,0], [10,20]);
    // let w11 = new RectangleTarget(10, 20, [0,0], [10,20]);

    // let rectTargets = [...new Array(11).keys()].map(i => new RectangleTarget(10, i * 2, [0,0], [10,20]));
    // let incrementalActions = [];
    // for (let i = 0; i < 10; i++) {
    //     incrementalActions.push(new OverrotateRevealTransition().generateGroupActions(rectTargets[i], rectTargets[i+1], 300, brixelHw));
    //     // incrementalActions.push(new RotateRevealTransition().generateGroupActions(rectTargets[i], rectTargets[i+1], 300, brixelHw));
    // }
    // let compiledActions: GroupAction[] = [];
    // let count = 0;
    // for (let i = 0; i < 10; i++) {
    //     compiledActions = compiledActions.concat(offsetGroupActions(incrementalActions[i], count));

    //     count += 150;
    //     console.log("count is", count)
    // }
    // console.log("compiled actions ", compiledActions)

    // brixelHw.compile(compiledActions)


    // how can I write programs for brixel hardware?

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


    if (false) {
        let sfhw = SplitflapHardware.Rectangular(w, h, (x: number, y: number) => (ALPHABET_WITH_EXCLAMATION).split("").map(s => new SplitflapState(s)));
        console.log(frameUnitId)

        // start by taking this and converting the image to flips.
        let frame1 = new GroupAction(1, [[Action.FLIP, frameUnitId]]);
        let frame2 = new GroupAction(2, [[Action.FLIP, frameUnitId]]);
        // keeping it at zero breaks first frame
        // let frame1 = new GroupAction(0, [[Action.FLIP, frameUnitId]]);
        console.log(frame1);


        let msgString = "cheese!";
        msgString = "ejggug*"
        let finalMessage = msgString.split("").map(c => new SplitflapState(c));
        // the message should be from like 12 to 20 in row 7
        let finalState = [...new Array(h * w)].map(j => new SplitflapState(" "));
        [...new Array(msgString.length).keys()].forEach(i => finalState[6 * w + i + 13] = finalMessage[i]);

        // I basically need it to be...
        // an array with that deployed in the middle
        let msgArray = [...new Array(h).keys()].map(r => [...new Array(w).keys()].map(c => {
            if (r == 6 && c > 12 && c <= 12 + msgString.length) {
                return msgString.split("")[c - 13];
            }
            return " ";
        }))

        console.log(msgArray)
        let msgTarget = new PixelArtTarget(msgArray, " ");
        console.log(msgTarget.draw())


        // let schedule = scheduleDirectional(
        //     sfhw.units as SplitflapUnit[],
        //     finalState,
        //     1,
        //     sfhw,
        //     "LEFT_TO_RIGHT"
        // );

        // let schedule = scheduleConstantSpeed(sfhw.units as SplitflapUnit[], finalState, 1)
        // let schedule2 = scheduleDirectional(sfhw.units as SplitflapUnit[], finalState, 1, sfhw, "LEFT_TO_RIGHT");
        // let schedule3 = scheduleSyncEnd(sfhw.units as SplitflapUnit[], finalState, 1)
        // // console.log(schedule)

        // let restGA = buildTimeline(schedule3, 4);
        // console.log("frame 1 is ", frame1);
        // console.log("other schedule is ", restGA);



        let groupActionsFromTransition = new FlipConstantSpeed().generateGroupActions(new PixelArtTarget([], ""), msgTarget, 1, sfhw);
        // groupActionsFromTransition = new FlipDirectional(new GrowFromCentre((h, w) => [0,0])).generateGroupActions(new PixelArtTarget([], ""), msgTarget, 1, sfhw);
        groupActionsFromTransition = new FlipDirectional(new LeftToRight()).generateGroupActions(new PixelArtTarget([], ""), msgTarget, 1, sfhw);
        groupActionsFromTransition = new FlipSyncEnd().generateGroupActions(new PixelArtTarget([], ""), msgTarget, 1, sfhw);
        // sfhw.compile([frame1]);
        console.log(groupActionsFromTransition)
        groupActionsFromTransition
        sfhw.compile([frame1, frame2, ...delayGroupActions(groupActionsFromTransition, 4)]);
        // sfhw.compile([frame1, frame2, ...restGA]);
        // now I want the position of the text.
        // row 7 from 12 to 20



        // let rectangle = new RectangleTarget(8,6,[3, 7,], [h,w]);
        let rectangle = new RectangleTarget(4, 4, [5, 5,], [h, w]);
        // let rectangle = new RectangleTarget(w-1,h-1,[0,0], [w,h]);
        console.log(rectangle.draw())
        // some kind of 0,10 problerm 
        // let flipAnimation = new CascadeImage(new SpiralOrder()).generateGroupActions(new PixelArtTarget([], ""), rectangle, 30, sfhw);
        // let cross = new LineTarget([0,0,],[3,7], [h,w]);
        // let cross2 = new LineTarget([7,0],[0,7],[h,w]);
        // console.log(cross.draw())
        // let flipAnimation = new MotionImage().generateGroupActions(new PixelArtTarget([], ""), cross, 60, sfhw);
        let flipAnimation = new MotionImage().generateGroupActions(new PixelArtTarget([], ""), rectangle, 60, sfhw);
        console.log(sfhw.indexToCoord);
        sfhw.compile(flipAnimation);
    }

    let sh = 6;
    let sw = 32;
    
    let smallSfhw = SplitflapHardware.Rectangular(sw, sh, (x: number, y: number) => (ALPHABET_WITH_EXCLAMATION).split("").map(s => new SplitflapState(s)));
    let srectangle = new RectangleTarget(sw, sh, [0, 0], [sw, sh]);

    let msg = "up next\nmatrix";
    // msg = "ocvtkz\nwrbpgzv";
    msg = "matrix\nup next"
    msg = "bugs?\nis shrimps"
    msg = "giddyup\nthese are my horse"
    // AGAIN: HAS PROBLEMS WITH NOT FLIPPING ENOUGH TIMES IF IT'S LAST FEW!!!!!!!!
    // let state = new PixelArtTarget(generateSplitflapState(sh, sw, msg), " ");
    // let sflipAnimation = new OneByOneKeepFlipping(new MatrixDown()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new BackAndForth()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new LeftToRight()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new OutFromCentre()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new StaggeredRow()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new SpiralIn()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // this one has a pretty cool spiral effect
    // let sflipAnimation = new OneByOneKeepFlipping(new RowByRowOverlap()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new RandomOrder()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new Diagonal()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // bonus: suggested by chatgpt
    // let sflipAnimation = new OneByOneKeepFlipping(new SpiralOut()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new OrganicRipple()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // this one isn't bad actually (first two... eh) -> programmatic -> rhythmic 
    // let sflipAnimation = new OneByOneKeepFlipping(new CentrePulse()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new PingPong()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new MiddleOutDiagonal()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);
    // let sflipAnimation = new OneByOneKeepFlipping(new ShallowDiagonal()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 50, smallSfhw);

    let sflipAnimation = new OneByOneKeepFlipping(new LineDiagonal()).generateGroupActions(new PixelArtTarget([], ""), srectangle, 200, smallSfhw);

    console.log(new LineDiagonal().generateGrid(21,5));

    // let thenFlipTo = new AndThenFlipTo(sflipAnimation).generateGroupActions(srectangle, state, 30, smallSfhw);



    let square = new RectangleTarget(3, 3, [Math.round(w/2)+2, 2], [w, h]);
    // let square2 = new RectangleTarget(3, 3, [Math.round(w/2)+3, 3], [w, h]);
    let order1 = new AllAtOnce();
    let order2 = new LineDiagonal();
    sflipAnimation = new LayerForeBackTransition(order1, order2, 
        srectangle, 
        new OneByOneKeepFlipping(order1), 
        new OneByOneKeepFlipping(order2))
        .generateGroupActions(new PixelArtTarget([], ""), square, 200, smallSfhw);

    // sflipAnimation = new OneByOneKeepFlipping(new AllAtOnce()).generateGroupActions(new PixelArtTarget([], ""), square, 200, smallSfhw);
    // try this background layering thing

    
    // sflipAnimation = new LayerForeBackTransition(order1, order2, 
    //     srectangle, 
    //     new OneByOne(order1), 
    //     new OneByOneKeepFlipping(order2))
    //     .generateGroupActions(new PixelArtTarget([], ""), square, 200, smallSfhw);


    // sflipAnimation = new OneByOne(order1).generateGroupActions(new PixelArtTarget([], ""), square, 200, smallSfhw);

    // console.log(sflipAnimation)
    // smallSfhw.compile(sflipAnimation);
    // sflipAnimation.push(new GroupAction(sflipAnimation[sflipAnimation.length-1].tPlus+1, [[Action.FLIP, []]]))
    // console.log(thenFlipTo);
    // smallSfhw.compile(thenFlipTo);
    // why would it keep flipping

    smallSfhw.compile([...sflipAnimation]);
    // smallSfhw.compile([...sflipAnimation, ...delayGroupActions(thenFlipTo, sflipAnimation[sflipAnimation.length-1].tPlus+1)]);

    // what if I just try this...?
    // let allFlipManyTimes = [...new Array(50).keys()].map(i => new GroupAction(i, [[Action.FLIP, [...new Array(sh*sw).keys()]]]));
    // console.log(allFlipManyTimes)
    // smallSfhw.compile(allFlipManyTimes);

    // let fdshw2 = new FlipdotSimHardware([], i => [], [height, width]);
    // let flipAnimation3 = new OneByOne(new SpiralOrder()).generateGroupActions(new PixelArtTarget([], ""), new RectangleTarget(2,2,[3, 7,], [h,w]), 30, sfhw)
    // fdshw2.compile([...flipAnimation3, ...delayGroupActions(flipAnimation3, 4), ...delayGroupActions(flipAnimation3, 8)]);


    // let fdshw = new FlipdotSimHardware([], i => [], [height, width]);
    // let flipAnimation2 = new OneByOne(new SpiralOrder()).generateGroupActions(new PixelArtTarget([], ""), rectangle, 30, sfhw)
    // fdshw.compile(flipAnimation2);

    if (false) {
    let threed = new FlipdotSimHardware([], i => [], undefined, "public/troika.stl");
    // let threed = new FlipdotSimHardware([], i => [], undefined, "public/lowpolybunny.stl");
    threed.finalize3D().then(_ => {
        console.log("got it")

        let basic = new WaveTransition3D(new BottomUp()).generateGroupActions(new RectangleTarget(0, 0, [0, 0], [20, 20]), new CircleTarget(5, [0, 0], [20, 20]), 40, threed);

        threed.compile(basic);
        // new STLLoader().load("public/troika.stl", (geometry) => {

        // let geometryStripes = rowOfDiscs.computeGeomStripes(geometry);
        // rowOfDiscs.resetAnimation(i => [[geometryStripes[numfaces - (i % numfaces)]]])
        // let rowOfDiscs = threed.simulation;
        // let ring = rowOfDiscs.moveCircleAcrossMesh(geometry);
        // console.log(ring)
        // let diffed = computeFlips(ring);


        // threed.compile();
        // console.log(diffed)
        // rowOfDiscs.resetAnimation(i => [diffed[i % 6]]);
        // });
    });
    }

}

function generateSplitflapState(h: number, w: number, msg: string, position?: [number, number]) {
    let rows = msg.split("\n");
    let states = rows.map(r => r.split(""));
    let rowStart = position ? position[1] : Math.round((h - rows.length)/2);

    // let states = rows.map(r => r.split("").map(c => new SplitflapState(c)));

    let bank = ALPHABET_WITH_EXCLAMATION.split("");
    // cipher it...
    states = states.map(r => r.map(c => {
        let idx = bank.findIndex(t => t == c);
        if (idx == -1) {
            throw new Error("message can't be parsed")
        }
        return bank[(idx+2) % bank.length]
    }))
    console.log(states);

    let finalState = [...new Array(h)].map(r => [...new Array(w)].map(c => "b"));
    // let finalState = [...new Array(h)].map(r => [...new Array(w)].map(c => " "));
    for (let ri = 0; ri < rows.length; ri++) {
        let row = rows[ri];
        let colStart = position ? position[0] : Math.round((w - row.length) / 2);
        for (let ci = 0; ci < row.length; ci++) {
            finalState[ri + rowStart][ci + colStart] = states[ri][ci];
        }
    }
    console.log(finalState)
    return finalState
}


export function computeFlips(frames: number[][]): number[][] {
    const flips: number[][] = [];

    if (frames.length === 0) return flips;

    // Convert frame arrays to sets for fast lookup
    const frameSets = frames.map(f => new Set(f));

    // --- Frame 1: always flip all lights that are ON ---
    flips.push([...frameSets[0]]);

    // --- Later frames: flip indices that changed state ---
    for (let i = 1; i < frameSets.length; i++) {
        const prev = frameSets[i - 1];
        const curr = frameSets[i];

        const changes: number[] = [];

        // Get all lights seen in either frame
        const allIndices = new Set([...prev, ...curr]);

        for (const light of allIndices) {
            const wasOn = prev.has(light);
            const isOn = curr.has(light);

            if (wasOn !== isOn) {
                changes.push(light);
            }
        }

        flips.push(changes);
    }

    // --- Final extra frame: flip everything OFF ---
    const lastFrame = frameSets[frameSets.length - 1];
    const finalFlips = [...lastFrame]; // all currently ON lights must flip OFF
    flips.push(finalFlips);

    return flips;
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




let starFallExample = "timing: [2,2,2,2,2,2]\n\
filepath: /animations/starfall${i}.png \n\
objects: [#639bff star] [#222034 tail]\n\
star 0 ->* instantaneous ->* star 5\n\
tail 0 ->* instantaneous ->* tail 5"
// parseToGroupAction(starFallExample);