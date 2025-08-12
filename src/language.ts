// moving rectangles
// 1. what's a language of moving rectangles that can change size?
// 2. what's a way to control the low-level hardware?

import { RowOfDiscs } from "./flipdisc";

export interface Colour { }

export interface State {
    getColour(): Colour
    eq(other: State): boolean;
}

// this is some kind of effect system?
// the TYPE of the system is the image change (image a to image b)
// the EFFECT is the motion effect

// hmm.. maybe one way to do this is to lift effect to a real rendering? like, a supersampled animation
export interface Effect {
    apply(input: Colour[][][]): Colour[][][];
}

export interface TransitionSystem {
    // 1) how quickly can you transition? what timing options exist?
    // 2) what side effects are there?
    transition(a: State): State;
    // return the states that we move through to get to desired (including desired)
    moveTo(at: State, desiredState: State): State[];
}

// what about continuous/timing components? 

export interface Hardware {
    // 1d or 2d?
    // let's say 1d for now to simplify things
    pixels: State[];
    pixelTransitions: TransitionSystem[];
    dimensions: [number, number]
    refreshingTimingMs: number;

    draw(idx: number, desiredState: State): void;
    // how to put constraints on this part?
    // todo: refresh updates the pixels, and also RESETS all pixels that have not changed state since the last call to refresh
    // draw specifies a desired state update -> indicating that we're setting the foreground pixels, basically!!!!!
    // think how drawFrame only draws the relevant pieces, but we expect the background to be updated automatically
    refresh(): void;
}

/// =============

// okay, what about flipdot-specific?

// it feels like...
// the simulation should be one backend for this language

export class FlipDotState implements State {
    side: boolean = true

    constructor(side: boolean) {
        this.side = side;
    }

    static coloured(): FlipDotState {
        return new FlipDotState(true);

    }

    static background(): FlipDotState {
        return new FlipDotState(false);
    }

    getColour(): Colour {
        return this.side;
    }

    eq(other: FlipDotState): boolean {
        return this.side == other.side;
    }

}

export class FlipDotTransition implements TransitionSystem {
    transition(a: FlipDotState): FlipDotState {
        return a.side == true ? FlipDotState.background() : FlipDotState.coloured()
    }

    moveTo(at: FlipDotState, desiredState: FlipDotState): FlipDotState[] {
        // but if I'm already there, then I think it should be empty
        // console.log(at);
        // console.log(desiredState);
        if (at.eq(desiredState)) {
            return [];
        }

        return [desiredState];
    }

}

export class SimulationHardware implements Hardware {
    pixels: FlipDotState[];
    pixelTransitions: FlipDotTransition[];
    dimensions: [number, number];

    sim: RowOfDiscs;

    transitionIdx: number[][];
    frames: number[][][] = [];
    flipSeq: (i: number) => number[][];
    touchedIdxs: number[] = [];

    flipY = true;
    refreshingTimingMs: number = 200; // TODO might make more sense as number of cycles between flips. 

    constructor(width: number, height: number) {
        this.pixels = [...Array(width * height)].map(_ => FlipDotState.background());
        this.pixelTransitions = [...Array(width * height)].map(_ => new FlipDotTransition());
        this.dimensions = [width, height];
        this.transitionIdx = [...Array(height)].map(i => []);
        console.log(this.transitionIdx)

        this.sim = new RowOfDiscs(width, height);

        // I need to create a flip instance or something

        this.flipSeq = (seqNum: number) => {
            return [...Array(height)].map(_ => []);
        };
        this.sim.resetAnimation(this.flipSeq);
    }

    // TODO: right now this is only updating the drawing area.
    // how do I set the semantics of these functions so they mean the same thing for hardware and sim? 
    // could potentially assume the same export interface for all -- so like, refresh "resets" all changes since last change state
    draw(idx: number, desiredState: FlipDotState): void {
        // need to use the transition to do this?
        let seq = this.pixelTransitions[idx].moveTo(this.pixels[idx], desiredState);
        // console.log(seq)
        // hm... this might not be right 
        // right now I'm only drawing what I want to be visible. but I also need to flip BACK anything that was visible 
        if (seq.length >= 1) {
            // should emit this somehow as visible... 
            // TODO: or - make this a side effect encoded INSIDE transition system
            // console.log(idx)
            this.setHardwarePixel(idx);
        }
        this.touchedIdxs.push(idx);
        this.pixels[idx] = desiredState;
    }

    refresh() {
        // this.frames.push(JSON.parse(JSON.stringify(this.transitionIdx)) as number[][]);
        console.log(this.touchedIdxs)
        console.log(this.transitionIdx);
        console.log("============")
        // let's also add everything that has not been changed, but whose state is colourful
        for (let i = 0; i < this.pixels.length; i++) {
            if (!this.touchedIdxs.includes(i)) {
                let pixel = this.pixels[i]
                if (pixel.getColour()) {
                    // console.log("adding because it's colourful (why?), ", i)
                    this.transitionIdx[Math.floor(i / this.dimensions[0])].push(i % this.dimensions[0])
                    this.pixels[i] = new FlipDotState(false);
                    // console.log("add ", i)
                }
            }
        }

        this.touchedIdxs = [];

        if (this.flipY) {
            this.transitionIdx.reverse();
        }

        // console.log(this.transitionIdx)
        this.frames.push(this.transitionIdx);

        this.flipSeq = (seqNum: number) => {
            return this.frames[seqNum % this.frames.length];
        };
        console.log(this.frames)
        this.sim.resetAnimation(this.flipSeq);
        // this.sim.setFlipSequenceWithoutResetting(this.flipSeq)
        this.transitionIdx = [...Array(this.dimensions[1])].map(i => []);

    }

    clear() {
        this.frames = [];

        let [width, height] = this.dimensions;
        this.pixels = [...Array(width * height)].map(_ => FlipDotState.background());
        this.pixelTransitions = [...Array(width * height)].map(_ => new FlipDotTransition());
        this.transitionIdx = [...Array(height)].map(i => []);
        // I need to create a flip instance or something
        this.flipSeq = (seqNum: number) => {
            return [...Array(height)].map(_ => []);
        };
        this.sim.resetAnimation(this.flipSeq);
    }

    // stub - we should do something
    setHardwarePixel(idx: number) {
        this.transitionIdx[Math.floor(idx / this.dimensions[0])].push(idx % this.dimensions[0]);
        // console.log(this.transitionIdx)
    }
}

// okay, we have hardware (sort of basic anyway)
// how do I write a program over this?


export class Bitmap {
    pixels: Colour[] = [];
}

export class Movement {
    hardware: Hardware;
    a: Bitmap;
    b: Bitmap;
    // timing?

    constructor(hardware: Hardware, a: Bitmap, b: Bitmap) {
        this.hardware = hardware;
        this.a = a;
        this.b = b;
    }

    compile() {

        // for each pixel that's different, make a flip 
        // compare state with a:
        if (this.a.pixels.length != this.hardware.pixels.length ||
            this.b.pixels.length != this.hardware.pixels.length ||
            this.a.pixels.length != this.b.pixels.length) {
            throw new Error("Dimension mismatch!")
        }

        for (let i = 0; i < this.a.pixels.length; i++) {
            if (this.hardware.pixels[i].getColour() != this.a.pixels[i]) {
                // then let's store a change.
                // wait this isn't good, doesn't it not matter what the beginning is?
                throw new Error("not starting at the right spot...")
            }

            if (this.hardware.pixels[i].getColour() != this.b.pixels[i]) {
                // then let's store a change.
                // wait this isn't good, doesn't it not matter what the beginning is?
                this.hardware.draw(i, new FlipDotState(this.b.pixels[i] as boolean))
            }
        }
    }
}


/////////////////////////////////////////
export class FlipDotHardware implements Hardware {
    pixels: FlipDotState[];
    pixelTransitions: FlipDotTransition[];
    dimensions: [number, number];
    refreshingTimingMs: number = 200;
    channelsToValues: Map<number, number>;
    ON_VALUE = 253;
    OFF_VALUE = 252;

    constructor(width: number, height: number) {
        this.pixels = [...Array(width * height)].map(_ => FlipDotState.background());
        this.pixelTransitions = [...Array(width * height)].map(_ => new FlipDotTransition());
        this.dimensions = [width, height];
        this.channelsToValues = new Map();
        this.pixels.forEach((v, i) => this.channelsToValues.set(i, 0))
    }

    refresh(): void {
        for (let [key, value] of this.channelsToValues) {
            if (value != 0) {
                console.log(`channel:${key} value:${value} row:${Math.floor(key / this.dimensions[0])} col:${key % this.dimensions[0]}`);
            }
        }
        console.log(`wait:${this.refreshingTimingMs}`)
        this.pixels.forEach((v, i) => this.channelsToValues.set(i, 0))
    }


    draw(idx: number, desiredState: FlipDotState): void {
        // need to use the transition to do this?
        let seq = this.pixelTransitions[idx].moveTo(this.pixels[idx], desiredState);
        // if (seq.length >= 1) {
        // the semantics are different here because it's not a flip-sensitive type, it's like what do you show...
        this.setHardwarePixel(idx);
        // }
        this.pixels[idx] = desiredState;
    }

    setHardwarePixel(index: number) {
        // if this is just between 0-31 then we're good
        // if this is 32, 33, 34 we need to do something special 
        if (index < 32) {
            this.channelsToValues.set(index + 4, this.ON_VALUE)
        } else {
            // hmm, tricky. 
            let first = this.pixels[31];
            let second = this.pixels[32];
            let third = this.pixels[33];
            let fourth = this.pixels[34];
            // we can only control the last three using channels 34 and 35 (ie 33 and 34)
            // if it's just first and not the others, we're all good.

            // combos? 0001 0010 0011 0100 0101 0110 0111 1000 1001 1010 1011 1100 1101 1110 1111
            // 1000, 1100, 0100, - just set 35

            let colToStr = (colour: boolean) => colour ? "1" : "0";
            let switchVal = colToStr(first.getColour() as boolean) + colToStr(second.getColour() as boolean) + colToStr(third.getColour() as boolean) + colToStr(fourth.getColour() as boolean);
            switch (switchVal) {
                case "0001":
                    // need 010 and pushed over two
                    this.channelsToValues.set(24, 219) // 000 and pushes 2
                    this.channelsToValues.set(35, 235) // 010
                    break;
                case "0010":
                    this.channelsToValues.set(24, 243) // 000 and pushes 1
                    this.channelsToValues.set(35, 235) // 010
                    break;
                case "0011":
                    this.channelsToValues.set(35, 243) // 000 and push 1
                    this.channelsToValues.set(35, 75) // 011 (allegedly)
                    break;
                case "0100":
                    this.channelsToValues.set(35, 235) // 010
                    break;
                case "0101":
                    this.channelsToValues.set(34, 243) // 000 and push 1
                    this.channelsToValues.set(35, 89) // 101
                    break;
                case "0110":
                    this.channelsToValues.set(34, 246) // 000, no offset
                    this.channelsToValues.set(35, 210) // 110
                    break;
                case "0111":
                    this.channelsToValues.set(34, 91) // 001 and push it over two 
                    this.channelsToValues.set(35, 210) // 110
                    break;
                case "1000":
                    this.channelsToValues.set(35, this.ON_VALUE)
                    break;
                case "1001":
                    this.channelsToValues.set(34, 203) // 010 push 2 
                    this.channelsToValues.set(35, 235) // 010 (i.e 00100)
                    break;
                case "1010":
                    this.channelsToValues.set(34, 237) // 100 push 1
                    this.channelsToValues.set(35, 235) // 010
                case "1011":
                    this.channelsToValues.set(35, 237) // 100 and push 1
                    this.channelsToValues.set(35, 75) // 011 (allegedly)
                case "1100":
                    this.channelsToValues.set(35, 233) // is just 110
                    break;
                case "1101":
                    this.channelsToValues.set(34, 75) // 011 push 2 
                    this.channelsToValues.set(35, 235) // 010 
                case "1110":
                    this.channelsToValues.set(34, 75) // 011 push 2 
                    this.channelsToValues.set(35, 237) // 100 
                case "1111":
                case "1110":
                    this.channelsToValues.set(34, 75) // 011 push 2 
                    this.channelsToValues.set(35, 233) // 110
            }

        }
    }
}

export interface Timing {
    // not exactly sure what to do 
    // is this just how frequently I call refresh?
    // like calls to refresh are mediated by time?
}


export interface AnimationStrategy {
    numFrames: number;
    hardware: Hardware;

    generateFrames(obj: Target, startAt: [number, number], endAt: [number, number]): Colour[][][];

    convertColourToUpdateIdx(frames: Colour[][][]): number[][];
}

export class UniformInterpolateStrategy implements AnimationStrategy {
    numFrames: number;
    hardware: Hardware;

    constructor(numFrames: number, hardware: Hardware) {
        this.numFrames = numFrames;
        this.hardware = hardware;
    }


    // potentially genericize... 
    convertColourToUpdateIdx(frames: boolean[][][]): number[][] {
        let updatedFrames: number[][] = [];
        for (let frame of frames) {
            let newFrame: number[] = frame.map((r, i) => r.reduce((acc: number[], curr: boolean, idx: number) => {
                if (curr) {
                    acc.push(i * this.hardware.dimensions[0] + idx)
                }
                return acc;
            }, [] as number[])).reduce((o, n) => o.concat(n), []);
            updatedFrames.push(newFrame);
        }

        return updatedFrames;
    }

    generateFrames(obj: DrawableTarget, startAt: [number, number], endAt: [number, number]): boolean[][][] {
        let xInc = (endAt[0] - startAt[0]) / this.numFrames;
        let yInc = (endAt[1] - startAt[1]) / this.numFrames;

        let frames: boolean[][][] = [];
        for (let i = 0; i < this.numFrames; i++) {
            // drawFrame(rectSize, [, ], hardware);

            let x = Math.round(startAt[0] + xInc * i);
            let y = Math.round(startAt[1] + yInc * i);

            console.log([x, y])

            obj.setStartAt([x, y])
            let frame = obj.draw();
            console.log(frame)


            frames.push(frame);
        }
        return frames;
    }
}

export class AccelerateInterpolationStrategy implements AnimationStrategy {
    numFrames: number;
    hardware: Hardware;
    accelerationRate = 1.3

    constructor(numFrames: number, hardware: Hardware) {
        this.numFrames = numFrames;
        this.hardware = hardware;
    }

    // potentially genericize... 
    convertColourToUpdateIdx(frames: boolean[][][]): number[][] {
        let updatedFrames: number[][] = [];
        for (let frame of frames) {
            let newFrame: number[] = frame.map((r, i) => r.reduce((acc: number[], curr: boolean, idx: number) => {
                if (curr) {
                    acc.push(i * this.hardware.dimensions[0] + idx)
                }
                return acc;
            }, [] as number[])).reduce((o, n) => o.concat(n), []);
            updatedFrames.push(newFrame);
        }

        return updatedFrames;
    }

    generateFrames(obj: DrawableTarget, startAt: [number, number], endAt: [number, number]): boolean[][][] {
        let xIncs = [...new Array(this.numFrames)].map((_, i) => Math.round((endAt[0] - startAt[0]) * Math.pow(i / (this.numFrames - 1), this.accelerationRate)));
        let yIncs = [...new Array(this.numFrames)].map((_, i) => Math.round((endAt[1] - startAt[1]) * Math.pow(i / (this.numFrames - 1), this.accelerationRate)));

        console.log(xIncs)
        console.log(yIncs)
        let frames: boolean[][][] = [];
        for (let i = 0; i < this.numFrames; i++) {
            // drawFrame(rectSize, [, ], hardware);

            obj.setStartAt([startAt[0] + xIncs[i], startAt[1] + yIncs[i]])
            let frame = obj.draw();

            // filter the positions 


            frames.push(frame);
        }
        return frames;
    }
}


export interface Target {
    size: number[];
    dimensions: [number, number];
    style: Effect | undefined;

    draw(): boolean[][];
}

export interface DrawableTarget extends Target {
    startAt: undefined | [number, number];
    setStartAt(startAt: [number, number]): void;
}

export class Rect implements DrawableTarget {
    size: number[];
    dimensions: [number, number];
    startAt: [number, number] | undefined;
    style: Effect | undefined;


    constructor(size: number, dimensions: [number, number]) {
        this.size = [size];
        this.dimensions = dimensions;
    }

    setStartAt(startAt: [number, number]): void {
        this.startAt = startAt;
    }

    draw(): boolean[][] {
        if (this.startAt == undefined) {
            throw new Error("Start at has not been defined")
        }
        let frame: boolean[][] = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0])].map(_ => false));
        console.log(this.startAt)
        console.log(this.size)

        for (let y = this.startAt[1]; y < this.startAt[1] + this.size[0]; y++) {
            for (let x = this.startAt[0]; x < this.startAt[0] + this.size[0]; x++) {
                if (x < this.dimensions[0] && y < this.dimensions[1]) {
                    frame[y][x] = true;
                }
            }

        }

        console.log(frame)
        return frame;
    }
}

let inBounds = (coord: [number, number], bounds: [number, number]): boolean => {
    let [x, y] = coord;
    return (x >= 0 && x < bounds[0] && y >= 0 && y < bounds[1]);
}

export class PixelArtTarget implements DrawableTarget {
    colourAt: [number, number][];
    size: number[];
    dimensions: [number, number];
    style: Effect | undefined;

    constructor(colourAt: [number, number][], size: [number, number], dimensions: [number, number]) {
        this.colourAt = colourAt;
        this.size = size; // could take bounding box though
        this.dimensions = dimensions;
    }

    startAt: [number, number] | undefined;

    setStartAt(startAt: [number, number]): void {
        this.startAt = startAt;
    }


    draw(): boolean[][] {
        let frame = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0])].map(_ => false));

        if (this.startAt == undefined) {
            throw new Error("Starting point was not set");
        }

        console.log(this.colourAt)
        // actually just 
        for (let obj of this.colourAt) {
            let x = obj[0] + this.startAt[0];
            let y = obj[1] + this.startAt[1];
            // console.log(x, y)
            if (inBounds([x,y], this.dimensions)) {
                frame[y][x] = true;
            }
        }
        // for (let y = this.startAt[1]; y < this.startAt[1]+this.size[1]; y++) {
        //     for (let x = this.startAt[0]; x < this.startAt[0]+this.size[0]; x++) {
        //             console.log([x - this.startAt[0], y - this.startAt[1]])
        //             if (this.colourAt.includes([x - this.startAt[0], y - this.startAt[1]])) {
        //                 frame[y][x] = true;
        //         }
        //     }

        // }

        return frame
    }

}


export class Path implements Target {
    size: number[];
    dimensions: [number, number];
    targetFrames: boolean[][][] | undefined;
    style: Effect | undefined;

    constructor(dimensions: [number, number],) {
        this.size = [];
        this.dimensions = dimensions;
    }

    setTargetFrames(targetFrames: boolean[][][]) {
        this.targetFrames = targetFrames;
    }

    draw(): boolean[][] {
        if (!this.targetFrames) {
            throw new Error("target frames not set");
        }
        let updatedFrame = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0])].map(_ => false));
        let newFrame = this.targetFrames.reduce((acc, f) => {
            f.forEach((r, ri) => r.forEach((c, ci) => {
                if (c) {
                    acc[ri][ci] = true
                }
            }));
            return acc
        }, updatedFrame);

        return newFrame;
    }

    /// hmm... this doesn't work because there's no interpolation, annoyingly 
    //
    drawSequence(): boolean[][][] {
        if (!this.targetFrames) {
            throw new Error("target frames not set");
        }

        let updatedFrames = this.targetFrames.map(f => f.map(r => r.map(c => c)));
        // for each frame, I need to put on the previous frame's path 

        for (let fIdx = 0; fIdx < this.targetFrames.length; fIdx++) {
            let prevFrame = fIdx - 1;
            if (prevFrame == -1) {
                continue;
            }

            for (let r = 0; r < this.targetFrames[fIdx].length; r++) {
                for (let c = 0; c < this.targetFrames[fIdx][0].length; c++) {
                    // just take the previous frame and copy it
                    if (updatedFrames[prevFrame][r][c]) {
                        updatedFrames[fIdx][r][c] = true;
                    }
                }
            }
        }


        return updatedFrames;
    }

    drawSequenceInterpolate(drawableStart: DrawableTarget, drawableEnd: DrawableTarget): boolean[][][] {
        let startCorner = drawableStart.startAt;
        /// hmmm
        // need to have the end, then draw a line...
        // maybe this is better to have inside Rectangle?
        // draw a shape between them?
        return [];
    }

}

export class AnticipatedPath implements Target {
    size: number[];
    dimensions: [number, number];
    nextFrames: boolean[][][] | undefined;
    style: Effect | undefined;

    constructor(dimensions: [number, number],) {
        this.size = [];
        this.dimensions = dimensions;
    }

    setTargetFrames(targetFrames: boolean[][][]) {
        this.nextFrames = targetFrames;
    }

    draw(): boolean[][] {
        if (!this.nextFrames) {
            throw new Error("target frames not set");
        }

        let updatedFrame = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0])].map(_ => false));
        let newFrame = this.nextFrames.reduce((acc, f) => {
            f.forEach((r, ri) => r.forEach((c, ci) => {
                if (c) {
                    acc[ri][ci] = true
                }
            }));
            return acc
        }, updatedFrame);

        return newFrame;
    }

    /// hmm... this doesn't work because there's no interpolation, annoyingly 
    //
    drawSequence(): boolean[][][] {
        if (!this.nextFrames) {
            throw new Error("target frames not set");
        }

        let updatedFrames = this.nextFrames.map(f => f.map(r => r.map(c => c)));
        // for each frame, I need to put on the previous frame's path 

        for (let fIdx = 0; fIdx < this.nextFrames.length; fIdx++) {
            // go in opposite direction!
            let prevFrame = fIdx + 1;
            if (prevFrame >= this.nextFrames.length) {
                break;
            }

            for (let r = 0; r < this.nextFrames[fIdx].length; r++) {
                for (let c = 0; c < this.nextFrames[fIdx][0].length; c++) {
                    // just take the previous frame and copy it
                    if (updatedFrames[prevFrame][r][c]) {
                        updatedFrames[fIdx][r][c] = true;
                    }
                }
            }
        }


        return updatedFrames;
    }

}

export class AreaEffect implements Target {
    size: number[];
    dimensions: [number, number];
    target: boolean[][] | undefined;
    style: Effect | undefined;

    constructor(size: number[], dimensions: [number, number]) {
        this.size = size;
        this.dimensions = dimensions;
    }

    setDrawableTarget(target: boolean[][]) {
        this.target = target;
    }

    draw(): boolean[][] {
        // I basically have to affect radius distance around the target, if it's posisble.
        if (this.target == undefined) {
            return [...Array(this.dimensions[1]).map(_ => [...Array(this.dimensions[0])].map(_ => false))]
        };

        let affectedCells = this.target.map(x => x.map(c => c))
        for (let row = 0; row < this.target.length; row++) {
            for (let col = 0; col < this.target[0].length; col++) {
                if (this.target[row][col]) {
                    console.log("!")
                    for (let extV = 1; extV <= this.size[0]; extV++) {
                        console.log("extv is "), extV;
                        if (row - extV >= 0) {
                            console.log("a")
                            affectedCells[row - extV][col] = true;
                        }
                        if (row + extV < this.target.length) {
                            console.log("b")
                            affectedCells[row + extV][col] = true;
                        }
                        for (let extH = 1; extH <= this.size[0]; extH++) {
                            console.log("extH is ", extH)
                            console.log("c")
                            if (col - extV >= 0) {
                                console.log("d")
                                affectedCells[row][col - extH] = true;
                                if (row - extV >= 0) {
                                    console.log("e")
                                    affectedCells[row - extV][col - extH] = true;
                                }
                                if (row + extV < this.target.length) {
                                    console.log("f")
                                    affectedCells[row + extV][col - extH] = true;
                                }
                            }
                            if (col + extV < this.target[0].length) {
                                console.log("g")
                                affectedCells[row][col + extH] = true;
                                if (row - extV >= 0) {
                                    console.log("h")
                                    affectedCells[row - extV][col + extH] = true;
                                }
                                if (row + extV < this.target.length) {
                                    console.log("i")
                                    affectedCells[row + extV][col + extH] = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        for (let row = 0; row < this.target.length; row++) {
            for (let col = 0; col < this.target[0].length; col++) {
                if (this.target[row][col]) {
                    affectedCells[row][col] = false;
                }
            }
        }
        // need to negate the actual shape 

        return affectedCells;

    }


}

export class Background implements Target {
    size: number[];
    dimensions: [number, number];
    otherObjects: boolean[][][]
    style: Effect | undefined;

    constructor(dimensions: [number, number], otherObjects: boolean[][][]) {
        this.size = dimensions;
        this.dimensions = dimensions;
        this.otherObjects = otherObjects;
    }

    drawBackground(otherObjects: boolean[][][]): boolean[][] {
        this.otherObjects = otherObjects;
        return this.draw();
    }

    draw(): boolean[][] {
        // startAt is irrelevant
        // just go through all of them and find the ones that are negative everywhere 
        // let's flatten the arrays first

        let allBackground = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0])].map(_ => true));
        let length = this.dimensions[0] * this.dimensions[1];
        if (this.otherObjects.length == 0) {
            return allBackground;
        }

        for (let e = 0; e < length; e++) {
            let y = Math.floor(e / this.dimensions[0]);
            let x = e % this.dimensions[0];

            let unoccupied = true;
            for (let o of this.otherObjects) {
                if (o[y][x]) {
                    unoccupied = false;
                }
            }
            allBackground[y][x] = unoccupied;
        }

        console.log(allBackground)
        return allBackground;
    }

    // frames of all the other objects.
    // object, frame, row, col
    compose(otherObjects: boolean[][][][], self?: boolean[][][]): boolean[][][] {
        if (otherObjects.length == 0 || otherObjects.every(o => o.length == 0)) {
            if (self != undefined) {
                return self;
            } else {
                return [[...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0]).keys().map(_ => false)])];
            }
        }

        let newFrames = [];

        for (let f = 0; f < otherObjects[0].length; f++) {
            let newFrame = [...Array(this.dimensions[1])].map(_ => [...Array(this.dimensions[0]).keys().map(_ => false)]);
            if (self != undefined) {
                newFrame = self[f].map(e => e);
            }
            console.log(newFrame)
            for (let y = 0; y < this.dimensions[1]; y++) {
                for (let x = 0; x < this.dimensions[0]; x++) {


                    for (let o of otherObjects) {
                        if (o[f][y][x]) {
                            newFrame[y][x] = true;
                            break;
                        }
                    }
                }

            }

            newFrames.push(newFrame);
        }

        return newFrames;
    }

}


// style could be genericized?
export interface Style<T> {
    // targets may have styles
    // styles impact how they are drawn!
    // but a style might impact more than just the target area...
    // what if multiple conflicting styles are applied to different targets?
    // there might be some kind of global coordination in play 
    apply(basic: T[][][]): T[][][];
}

export class MovingNoise implements Style<boolean> {
    // this type of noise moves with the object.
    target: Colour[][][];
    noiseType: string;
    animCycle: number = 0;
    pattern: boolean[][] = [];
    dimensions: [number, number];

    constructor(noiseType: string, target: Colour[][][], dimensions: [number, number]) {
        // I don't need the target for now, but if the shape grows... what will happen? it won't expand properly
        this.noiseType = noiseType;
        this.dimensions = dimensions;
        this.target = target;
        this.generateNewPattern();
    }

    generateNewPattern() {
        let pattern = [];
        for (let y = 0; y < this.dimensions[1]; y++) {
            let row = []
            for (let x = 0; x < this.dimensions[0]; x++) {
                // const index = (y * row.length + x) * 4;
                const isWhite = Math.random() > 0.5;
                // const colour = isWhite ? 255 : 0;

                row.push(isWhite);
            }
            pattern.push(row);
        }
        this.pattern = pattern;
    }

    apply(inFrames: boolean[][][]): boolean[][][] {
        // okay!
        // each frame, as soon as I encounter the top left, I'm going to pull from that.
        let editedFrames = [];
        let animCycle = 0;
        for (let frame of inFrames) {
            
            let xMins = frame.map(r => r.indexOf(true));
            // what's the earliest position? it's actually the bounding box...
            // the first non-negative example?
            let yAndXMin = xMins.map((x, i) => [x, i]).filter(a => a[0] != -1)[0];
            let yMin = yAndXMin[1];
            let xMin = yAndXMin[0];

            // okay, now we know that xMin and yMin correspond to [0,0] on the pattern!
            
            let edited = frame.map(r => r.map(s => s));
            for (let y = 0; y < frame.length; y++) {
                let row = frame[y];
                for (let x = 0; x < row.length; x++) {
                    if (row[x]) {
                        edited[y][x] = this.pattern[y - yMin][x - xMin];
                    } else {
                        edited[y][x] = false;
                    }

                }
            }
            animCycle += 1;
            editedFrames.push(edited);
            console.log(edited)
        }
        return editedFrames
    }
    // what kind of noise?
}

export class Noise implements Style<boolean> {
    noiseType: string;
    animCycle: number = 0;
    pattern: boolean[][] = [];
    dimensions: [number, number];

    constructor(noiseType: string, dimensions: [number, number]) {
        this.noiseType = noiseType;
        this.dimensions = dimensions;
        this.generateNewPattern();
    }

    generateNewPattern() {
        let pattern = [];
        for (let y = 0; y < this.dimensions[1]; y++) {
            let row = []
            for (let x = 0; x < this.dimensions[0]; x++) {
                // const index = (y * row.length + x) * 4;
                const isWhite = Math.random() > 0.5;
                // const colour = isWhite ? 255 : 0;

                row.push(isWhite);
            }
            pattern.push(row);
        }
        this.pattern = pattern;
    }

    apply(inFrames: boolean[][][]): boolean[][][] {
        // within the space, we should alternate from frame-to-frame
        // but also, don't we need to account for where this was previously...?
        let editedFrames = [];
        let animCycle = 0;
        for (let frame of inFrames) {
            let edited = frame.map(r => r.map(s => s));
            for (let y = 0; y < frame.length; y++) {
                let row = frame[y];
                for (let x = 0; x < row.length; x++) {
                    if (row[x]) {
                        edited[y][x] = this.pattern[y][x];
                    } else {
                        edited[y][x] = false;
                    }

                }
            }
            animCycle += 1;
            editedFrames.push(edited);
            console.log(edited)
        }
        return editedFrames
    }
    // what kind of noise?
}

export class Static implements Style<boolean> {
    flutterPeriod: number = 1;
    animCycle: number = 0;

    constructor(flutterPeriod: number) {
        this.flutterPeriod = flutterPeriod;
    }

    apply(inFrames: boolean[][][]): boolean[][][] {
        // within the space, we should alternate from frame-to-frame
        // but also, don't we need to account for where this was previously...?
        let editedFrames = [];
        let animCycle = 0;
        for (let frame of inFrames) {
            let edited = frame.map(r => r.map(s => s));
            for (let y = 0; y < frame.length; y++) {
                let row = frame[y];
                for (let x = 0; x < row.length; x++) {
                    if (row[x] && ((x % 2 == y % 2 && animCycle % 2 == 0) || (x % 2 != y % 2 && animCycle % 2 != 0))) { // depends on period 
                        edited[y][x] = true;
                    } else if (row[x] && ((x % 2 == y % 2 && animCycle % 2 != 0) || (x % 2 != y % 2 && animCycle % 2 == 0))) {
                        edited[y][x] = false;
                    }
                }
            }
            animCycle += 1;
            editedFrames.push(edited);
            console.log(edited)
        }
        return editedFrames
    }
}








/////////////////////////////////////////
/// now I want to make like, a rectangle language...
// and I want to apply different effects when moving.

// function moveRectangle(rectSize: number, startAt:[number, number], endAt: [number, number], hardware: Hardware) {
//     // how to interpolate?
//     // choose different starting points
//     let numFrames = 3;

//     // let frames = new UniformInterpolateStrategy(numFrames).generateFrames(rectSize, startAt, endAt, hardware);
//     let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(rectSize, startAt, endAt, hardware);

//     let drawFrame = (frame: number[]) => {
//         frame.forEach(pix => {
//             hardware.draw(pix, FlipDotState.coloured()); 
//         });
//         hardware.refresh(); 

//     }

//     frames.forEach(frame => drawFrame(frame));

//     // somehow this just works, I think it's because there have been no updates since last call 
//     hardware.refresh()
// }

function grow(obj: DrawableTarget, startSize: number, endSize: number, startAt: [number, number], hardware: Hardware) {

}

function move(obj: DrawableTarget, startAt: [number, number], endAt: [number, number], hardware: Hardware, numFrames: number = 3) {
    // how to interpolate?
    // choose different starting points

    let interp = new UniformInterpolateStrategy(numFrames, hardware);
    // let interp = new AccelerateInterpolationStrategy(numFrames, hardware);
    let framesColour = interp.generateFrames(obj, startAt, endAt);
    let bg = new Background(hardware.dimensions, framesColour);
    let bgFrames = framesColour.map(f => bg.drawBackground([f]));
    // wait, how do these things get combined...?
    let flutter = new Static(2);

    let effect = "area-flutter";
    let composed;
    let withEffect
    switch (effect) {
        case "obj-flutter":
            composed = flutter.apply(framesColour);
            break;
        case "bg-flutter":
            withEffect = flutter.apply(bgFrames);
            composed = bg.compose([framesColour], withEffect);
            break;
        case "area-flutter":
            let area = new AreaEffect([2, 2], hardware.dimensions);
            let areaFrame = framesColour.map(f => { area.setDrawableTarget(f); return area.draw() });
            console.log(areaFrame)
            withEffect = flutter.apply(areaFrame);

            composed = bg.compose([framesColour], withEffect);
            console.log(composed)
            break;
        case "path-flutter":
            let path = new Path(hardware.dimensions);
            path.setTargetFrames(framesColour);
            let pathFrames = path.drawSequence();
            console.log(pathFrames)
            withEffect = flutter.apply(pathFrames);

            composed = bg.compose([framesColour], withEffect);
            console.log(composed)
            break;
        case "anticipate-flutter":
            let antPath = new AnticipatedPath(hardware.dimensions);
            antPath.setTargetFrames(framesColour);
            let antPathFrames = antPath.drawSequence();
            console.log(antPathFrames)
            withEffect = flutter.apply(antPathFrames);

            composed = bg.compose([framesColour], withEffect);
            console.log(composed)
            break;
        default:
            composed = framesColour;
    }

    // let frames = interp.convertColourToUpdateIdx(framesColour);
    let frames = interp.convertColourToUpdateIdx(composed);


    // let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(obj, startAt, endAt, hardware);

    let drawFrame = (frame: number[]) => {
        frame.forEach(pix => {
            hardware.draw(pix, FlipDotState.coloured());
        });
        hardware.refresh();
    }

    frames.forEach(frame => drawFrame(frame));

    // somehow this just works, I think it's because there have been no updates since last call 
    hardware.refresh()
}


if (false) {

    let sim = new SimulationHardware(34, 28);
    let real = new FlipDotHardware(5, 7);



    // let rect = new Rect(2, real.dimensions);
    // rect.setStartAt([2,0])
    // let area = new AreaEffect([1,1], real.dimensions);
    // area.setDrawableTarget(rect.draw());
    // console.log(area.draw())

    // let rect = new Rect(2, real.dimensions);
    // rect.setStartAt([2,0]);
    // let interp = new AccelerateInterpolationStrategy(3, real);
    // let framesColour = interp.generateFrames(rect, [2,0], [2,5]);

    // let area = new Path([1,1], real.dimensions, framesColour);
    // let seq = area.drawSequence();
    // console.log(seq)


    move(new Rect(5, sim.dimensions), [15, 5], [15, 15], sim, 5);
}


// moveRectangle(2, [0,0],[5,5], new SimulationHardware(5,7));
// moveRectangle(2, [0,0],[4,4], new SimulationHardware(5,7));

// moveRectangle(2, [2,0],[2,5], new FlipDotHardware(5,7));
// moveRectangle(2, [0,0],[5,5], new FlipDotHardware(5,7));

// npx vite-node language.ts

// q: how do I set the timing?
// it's kind of like, dependent on the refresh.
// maybe how many seconds should it take to complete the animation?