// moving rectangles
// 1. what's a language of moving rectangles that can change size?
// 2. what's a way to control the low-level hardware?

import { RowOfDiscs } from "./flipdisc";

interface Colour {}

interface State {
    getColour(): Colour
    eq(other: State): boolean;
}

// this is some kind of effect system?
// the TYPE of the system is the image change (image a to image b)
// the EFFECT is the motion effect

// hmm.. maybe one way to do this is to lift effect to a real rendering? like, a supersampled animation
interface Effect {}

interface TransitionSystem {
    // 1) how quickly can you transition? what timing options exist?
    // 2) what side effects are there?
    transition(a: State): State;
    // return the states that we move through to get to desired (including desired)
    moveTo(at: State, desiredState: State): State[];
}

// what about continuous/timing components? 

interface Hardware {
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

class FlipDotState implements State {
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

class FlipDotTransition implements TransitionSystem {
    transition(a: FlipDotState): FlipDotState {
        return a.side == true? FlipDotState.background() : FlipDotState.coloured()
    }

    moveTo(at: FlipDotState, desiredState: FlipDotState): FlipDotState[] {
        // but if I'm already there, then I think it should be empty
        console.log(at);
        console.log(desiredState);
        if (at.eq(desiredState)) {
            return [];
        }

        return [desiredState];
    }
    
}

class SimulationHardware implements Hardware {
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
        this.dimensions = [height, width];
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
    // could potentially assume the same interface for all -- so like, refresh "resets" all changes since last change state
    draw(idx: number, desiredState: FlipDotState): void {
        // need to use the transition to do this?
        let seq = this.pixelTransitions[idx].moveTo(this.pixels[idx], desiredState);
        // console.log(seq)
        // hm... this might not be right 
        // right now I'm only drawing what I want to be visible. but I also need to flip BACK anything that was visible 
        if (seq.length >= 1) {
            // should emit this somehow as visible... 
            // TODO: or - make this a side effect encoded INSIDE transition system
            console.log(idx)
            this.setHardwarePixel(idx);
        }
        this.touchedIdxs.push(idx);
        this.pixels[idx] = desiredState;
    }

    refresh() {
        // this.frames.push(JSON.parse(JSON.stringify(this.transitionIdx)) as number[][]);
        
        // let's also add everything that has not been changed, but whose state is colourful
        for (let i = 0; i < this.pixels.length; i++) {
            if (!this.touchedIdxs.includes(i)) {
                let pixel = this.pixels[i]
                if (pixel.getColour()) {
                    this.transitionIdx[Math.floor(i / this.dimensions[1])].push(i % this.dimensions[1])
                    this.pixels[i] = new FlipDotState(false);
                    console.log("add ", i)
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
        this.sim.resetAnimation(this.flipSeq);
        this.transitionIdx = [...Array(this.dimensions[0])].map(i => []);
        
    }
    
    // stub - we should do something
    setHardwarePixel(idx: number) {
        this.transitionIdx[Math.floor(idx / this.dimensions[1])].push(idx % this.dimensions[1]);
        // console.log(this.transitionIdx)
    }
}

// okay, we have hardware (sort of basic anyway)
// how do I write a program over this?


class Bitmap {
    pixels: Colour[] = [];
}

class Movement {
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
class FlipDotHardware implements Hardware {
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
        this.dimensions = [height, width];
        this.channelsToValues = new Map();
        this.pixels.forEach((v,i) => this.channelsToValues.set(i,0))
    }

    refresh(): void {
        for (let [key,value] of this.channelsToValues) {
            if (value != 0) {
                console.log(`channel:${key} value:${value} row:${Math.floor(key / this.dimensions[1])} col:${key % this.dimensions[1]}`);
            }
        }
        console.log(`wait:${this.refreshingTimingMs}`)
        this.pixels.forEach((v,i) => this.channelsToValues.set(i,0))
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

interface Timing {
    // not exactly sure what to do 
    // is this just how frequently I call refresh?
    // like calls to refresh are mediated by time?
}


interface AnimationStrategy {
    numFrames: number;

    generateFrames(size: number, startAt:[number, number], endAt: [number, number], hardware: Hardware): number[][];
}

class UniformInterpolateStrategy implements AnimationStrategy {
    numFrames: number;

    constructor(numFrames: number) {
        this.numFrames = numFrames;
    }

    generateFrames(size: number, startAt:[number, number], endAt: [number, number], hardware: Hardware): number[][] {
        let xInc = (endAt[0] - startAt[0]) / this.numFrames;
        let yInc = (endAt[1] - startAt[1]) / this.numFrames;
    
        let frames: number[][] = [];
        for (let i = 0; i < this.numFrames; i++) {
            // drawFrame(rectSize, [, ], hardware);
            let updateFrames: number[] = [];
        
            for (let x = startAt[0] + xInc * i; x < (startAt[0] + xInc * i)+size; x++) {
                for (let y = startAt[1] + yInc * i; y < (startAt[1] + yInc * i)+size; y++) {
                    if (x < hardware.dimensions[1] && y < hardware.dimensions[0]) {
                        // console.log(y * hardware.dimensions[1] + x)
                        // console.log(x,y)
                        // hardware.draw(y * hardware.dimensions[1] + x, FlipDotState.coloured())
                        updateFrames.push(Math.round(y) * hardware.dimensions[1] + Math.round(x));
                    }
                }
            }
            
            frames.push(updateFrames);
        
        }
        return frames;
    }
}

class AccelerateInterpolationStrategy {
    numFrames: number;
    accelerationRate = 1.3

    constructor(numFrames: number) {
        this.numFrames = numFrames;
    }

    generateFrames(size: number, startAt:[number, number], endAt: [number, number], hardware: Hardware): number[][] {
        let xIncs = [...new Array(this.numFrames)].map((_, i) => Math.round((endAt[0] - startAt[0]) * Math.pow(i / (this.numFrames - 1),this.accelerationRate)));
        let yIncs = [...new Array(this.numFrames)].map((_, i) => Math.round((endAt[1] - startAt[1]) * Math.pow(i / (this.numFrames - 1),this.accelerationRate)));
    
        console.log(xIncs)
        console.log(yIncs)
        let frames: number[][] = [];
        for (let i = 0; i < this.numFrames; i++) {
            // drawFrame(rectSize, [, ], hardware);
            let updateFrames: number[] = [];
        
            for (let x = startAt[0] + xIncs[i]; x < (startAt[0] + xIncs[i])+size; x++) {
                for (let y = startAt[1] + yIncs[i]; y < (startAt[1] + yIncs[i])+size; y++) {
                    if (x < hardware.dimensions[1] && y < hardware.dimensions[0]) {
                        // console.log(y * hardware.dimensions[1] + x)
                        console.log(x,y)
                        // hardware.draw(y * hardware.dimensions[1] + x, FlipDotState.coloured())
                        updateFrames.push(y * hardware.dimensions[1] + x);
                    } else {
                        console.log("too big", x, y)
                        console.log(hardware.dimensions)
                    }
                }
            }
            
            frames.push(updateFrames);
        
        }
        return frames;
    }
}

    


/////////////////////////////////////////
/// now I want to make like, a rectangle language...
// and I want to apply different effects when moving.

function moveRectangle(rectSize: number, startAt:[number, number], endAt: [number, number], hardware: Hardware) {
    // how to interpolate?
    // choose different starting points
    let numFrames = 3;

    let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(rectSize, startAt, endAt, hardware);

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


// moveRectangle(2, [0,0],[5,5], new SimulationHardware(5,7));
moveRectangle(2, [0,0],[4,4], new SimulationHardware(5,7));
// moveRectangle(2, [0,0],[5,5], new FlipDotHardware(5,7));

// npx vite-node language.ts

// q: how do I set the timing?
// it's kind of like, dependent on the refresh.
// maybe how many seconds should it take to complete the animation?