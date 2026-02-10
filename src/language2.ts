
// objects? or frames?
// I should re-architect to make it so that it's objects 
// new setup. each frame contains objects
// we only use objects until it's time to compile
// when we compile, we convert the space between frames to a sequence of flips and the time between them.
// compiling means applying schedules to frames to get positions and shapes of objects (maybe I need like a TweenObject?)
// and applying styles
// until then, let's store all as Objects (and not sequences of objects either)
// use an effect to transition between two frames...?
// how is everything actually stored? like, how does a schedule get applied? 
// I guess it's needed to create the intermediate frames.
// so it gets supplied in the compilation part...?
// no, you can't create a frame without it? a frame must have 
// we have something called Effect which takes two frames and a time length and the transitions for each object?
// or we have something called Universe which takes the whole universe...? at each time point? 
// animation...

import { Action, FlipdotSimHardware, GroupAction, HardwareInterface } from "./hardware";
import { FlipTransition, SnapTransition, StochasticTransition, WaveTransition } from "./transitions"
import { Colour, DColour, DotFlipFrame, DotFlipInstruction, DotFlipOptions, FlipDotState, SimulationHardware } from "./language";
import { getImages, rgb2Hex } from "./util";
import { BottomLeftWildfire, BottomUp, GrowFromCentre, StutterOrder } from "./order";

let collisionStats = [4, 2];

// Arbitrary colour
class AColour extends DColour<false> {
    colour: string = "#ffffff";

    constructor(colour: string) {
        super();
        this.colour = colour;
    }
}

// or the whole thing is actually implemented as a graph where the Frames are used at compilation time? that might make the most sense.
// and we can only go from frame to frame...
// compilation is about straightening out all the frames and extracting the transitions from them 

// the specification is colour. but I feel like there should be another layer... 
// like, states have colours, but that should be separate from the colours in the specification 

// there's the position of the shape
// the shape itself 
// effects over the shape

type FrameId = number;


export interface Target {
    position: [number, number];
    draw(): Colour[][];
    clone(): Target;

    frameId: FrameId | undefined;
    effect: Effect | undefined;

    debugTag: string | undefined;
}

interface DerivedTarget extends Target {
    parentTargets: Target[];
}

interface DrawableTarget extends Target {
    shape: Colour[][];
}

interface TemporalTarget extends Target {
    parentTargets: Target[];
    parentEffects: Effect[]
}


export class CircleTarget implements DrawableTarget {
    shape: Colour[][];
    position: [number, number];
    clone(): Target {
        throw new Error("Method not implemented.");
    }
    frameId: number | undefined;
    effect: Effect | undefined;
    debugTag: string | undefined;

    extractedShape: Colour[][];
    defaultColour: Colour = false;

    
    constructor(radius: number, position: [number, number], canvasSize: [number, number]) {
        this.position = position;
        
        let centre = [this.position[0] + radius, this.position[1] + radius];

        this.shape = [...Array(canvasSize[1])].map(_ => [...Array(canvasSize[0])].map(_ => this.defaultColour));

        let extractedShape = [];

        for (let i = 0; i < radius; i++) {
            let shapeRow = [];
            for (let j = 0; j < radius; j++) {
                shapeRow.push(Math.sqrt(((centre[0] - j) ** 2) + ((centre[1] - i) ** 2)) <= radius)

                if (inBounds([i + this.position[0], j + this.position[1]], canvasSize)) {
                    this.shape[i+ this.position[0]][j+ this.position[1]] = true;
                }
            }
            extractedShape.push(shapeRow);
        }

        this.extractedShape = extractedShape;
    }

    
    draw(): Colour[][] {
        if (this.shape.length == 0) {
            return [];
        }
        return this.shape;
    }
}


export class PixelArtTarget implements DrawableTarget {
    position: [number, number];
    // this specification of shape should be the full size
    // ah, but colour can't be colourless though... 
    shape: Colour[][];
    // the problem is, I don't know which colour is the default...
    extractedShape: Colour[][];
    defaultColour: Colour;

    frameId: number | undefined;
    effect: Effect | undefined;

    debugTag: string | undefined;


    constructor(shape: Colour[][], defaultColour: Colour) {


        // this.position = position;
        this.shape = shape;
        this.defaultColour = defaultColour;
        let [pos, ex] = extractShapeAndPositionFromFrame(shape, defaultColour);
        this.position = pos;
        this.extractedShape = ex;

        console.log(frameDisplay(this.extractedShape))
        console.log(frameDisplay(shape))
        // console.log(frameDisplay(this.draw()))
        // hmmm... there's basically no way to have an "uncoloured" element override a previously-coloured element.
        // maybe I should revert to the original... because at least that scenario would be covered
    }

    draw(): Colour[][] {
        if (this.shape.length == 0) {
            return [];
        }
        let dimensions: [number, number] = [this.shape[0].length, this.shape.length];
        console.log(dimensions);
        let blank = [...Array(dimensions[1])].map(_ => [...Array(dimensions[0])].map(_ => this.defaultColour));
        console.log(frameDisplay(this.extractedShape))

        for (let i = 0; i < this.extractedShape.length; i++) {
            let row = this.extractedShape[i];
            for (let j = 0; j < row.length; j++) {
                let c = row[j];

                if (c != this.defaultColour && inBounds([j + this.position[0], i + this.position[1]], dimensions)) {
                    blank[i + this.position[1]][j + this.position[0]] = c;
                }

            }

        }

        // console.log(frameDisplay(blank));
        // console.log(this.shape)
        // console.log(this.extractedShape)
        return blank;
    }

    clone(): Target {
        let newPixelArtTarget = new PixelArtTarget(this.shape, this.defaultColour);
        newPixelArtTarget.frameId = this.frameId;
        newPixelArtTarget.effect = this.effect; // shallow copy
        return newPixelArtTarget;
    }
}

let inBounds = (coord: [number, number], bounds: [number, number]): boolean => {
    let [x, y] = coord;
    return (x >= 0 && x < bounds[0] && y >= 0 && y < bounds[1]);
}


enum EffectType {
    Complete,
    Disappearing,
    Appearing,
    Unspecified
}
// right, it's not that transitions take time, it;s that keyframes have time between them
interface Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    generateDisappearingFrames(numFrames: number): Target[];
    generateAppearingFrames(numFrames: number): Target[];
    generateCompleteFrames(numFrames: number): Target[];
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[];
}

class UniformMove implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType) {
        this.from = from;
        this.to = to;
        this.type = type;
    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        throw new Error("Method not implemented.");
    }

    // but you can only generate frames when compiling a transition graph 
    // also, you can't easily compose effects 
    // two different goals. one is to move the object and the other is to apply an effect
    // styles and schedules might interact thogh 
    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }

    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }

    generateCompleteFrames(numFrames: number): Target[] {
        // from and to have different positions.
        // what if from and to are completely different objects?
        // oh, why don't I just make a bunch of new objects where the position property is modified?
        if (!this.to || !this.from) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }

        let endAt = this.to.position;
        let startAt = this.from.position;

        let xInc = (endAt[0] - startAt[0]) / numFrames;
        let yInc = (endAt[1] - startAt[1]) / numFrames;

        let newObjects = [];
        for (let i = 0; i < numFrames; i++) {

            // drawFrame(rectSize, [, ], hardware);


            let x = Math.round(startAt[0] + xInc * i);
            let y = Math.round(startAt[1] + yInc * i);

            let obj = this.from.clone();
            console.log([x, y])

            obj.position = [x, y];

            newObjects.push(obj);

        }

        return newObjects;
    }

}


let extractShapeAndPositionFromFrame = (shape: Colour[][], defaultColour: Colour): [[number, number], Colour[][]] => {

    let allMins = shape.map(x => x.findIndex(c => c != defaultColour))
    // find the smallest entry
    let xMin = Math.min(...allMins.filter(x => x != -1));
    // the first entry that isn't -1
    let yMin = allMins.findIndex(e => e != -1);

    console.log(shape)
    let colMax = shape.map(x => Math.max(...x.map((c, i) => c != defaultColour ? i : -1)));
    let xMax = Math.max(...colMax.filter(x => x != -1));
    // let yMax = allMax.sort()[allMax.length - 1]; // it should be the index of the highest, and if there are multiple highest, start from the back.
    // so maybe... reverse the list, find index of max value. then subtract it 
    // let yMax = (allMax.length - allMax.sort((a, b) => b - a).findIndex(x => x == xMax)) - 1;
    let rowMax: number[] = shape.map((c, i) => !c.every(x => x == defaultColour) ? i : -1);
    let yMax = Math.max(...rowMax.filter(x => x != -1));
    // let yMax = allMax.length - revShape.findIndex(c => !c.every(f => f != defaultColour)) - 1;


    console.log(xMin, yMin, xMax, yMax);
    let extracted = [];
    // now, I need to move everything backwards... 
    for (let i = yMin; i < yMax + 1; i++) {
        let row = [];
        for (let j = xMin; j < xMax + 1; j++) {
            // console.log(i, j)
            row.push(shape[i][j]);
        }
        extracted.push(row);
    }

    if (xMin == Infinity && yMin == -1) {
        xMin = 0;
        yMin = 0;
    }

    console.log(xMin, yMin)
    return [[xMin, yMin], extracted]
}
// I need more transitions and more styles!

interface DerivedEffect extends Effect {

}

class TracePath implements DerivedEffect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    effect: Effect;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType, otherEffect: Effect) {
        this.from = from;
        this.to = to;
        this.type = type;
        // is it possible to get other transitions when making this?
        this.effect = otherEffect;
    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        throw new Error("Method not implemented.");
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        // how do I use the other transition? well, I just generate the frames first
        let referenceFrames = this.effect.generateCompleteFrames(numFrames);

        // for path, I actually just need to build up all the frames I've seen so far...
        // but at some point we should also interpolate 
        // also right now I don't think transitions are named

        let latestFrame = referenceFrames[0].draw();
        let allFrames: Target[] = [];

        for (let i = 0; i < numFrames; i++) {
            let currentFrame = referenceFrames[i].draw();
            let frame = latestFrame.map(r => r.map(c => c));
            for (let r = 0; r < frame.length; r++) {
                for (let c = 0; c < frame[r].length; c++) {
                    if (currentFrame[r][c]) {
                        frame[r][c] = true;
                    }
                }
            }
            // 
            // might need to change this behaviour
            let newTarget = new PixelArtTarget(frame, false);
            latestFrame = frame;
            allFrames.push(newTarget);
        }

        return allFrames;
    }

}


// ugh, linear path is weird because it 
// temporal targets should have access to _dots I have already flipped_
// also, think about a lower-level language to control dots and how to specify transitions in terms of that
// hmmm... well, just having it be like set and flush does the job, but I moved away from that 
class LinearPath implements TemporalTarget {
    parentTargets: Target[];
    position: [number, number];
    // shape: Colour[][];
    parentEffects: Effect[];
    interpolationPoint: number; // from 0 to 1

    debugTag: string | undefined;


    constructor(start: Target, end: Target, effect: Effect, interpolationPoint: number) {
        this.parentTargets = [start, end];
        this.parentEffects = [effect];
        this.interpolationPoint = interpolationPoint;

        this.position = [-1, -1]; // not super relevant... perhaps I should remove this
        // this.shape = shape;
    }

    draw(): Colour[][] {
        // I don't need the transition?
        let start = this.parentTargets[0];
        let end = this.parentTargets[1];
        // just take the two positions and calculate...
        // hmm.... uh oh
        // can I plug in some kind of pixel art calculator? 
        // maybe not...
        // well, let's start by assuming the two are the same shape.
        // then, I'll just linearly move...

        let startAt = start.position;
        let endAt = end.position;


        let xInc = (endAt[0] - startAt[0]) * this.interpolationPoint;
        let yInc = (endAt[1] - startAt[1]) * this.interpolationPoint;

        let obj = start.clone();

        let x = Math.round(startAt[0] + xInc);
        let y = Math.round(startAt[1] + yInc);

        obj.position = [x, y]
        let frame = obj.draw();
        console.log(frame)

        return frame;
    }


    clone(): LinearPath {
        return new LinearPath(this.parentTargets[0], this.parentTargets[1], this.parentEffects[0], this.interpolationPoint);
    }

    frameId: number | undefined;
    effect: Effect | undefined;

}

let stroke = (target: Colour[][], size: number): Colour[][] => {

    let affectedCells = target.map(x => x.map(c => c))
    for (let row = 0; row < target.length; row++) {
        for (let col = 0; col < target[0].length; col++) {
            if (target[row][col]) {
                for (let extV = 1; extV <= size; extV++) {
                    if (row - extV >= 0) {
                        affectedCells[row - extV][col] = true;
                    }
                    if (row + extV < target.length) {
                        affectedCells[row + extV][col] = true;
                    }
                    for (let extH = 1; extH <= size; extH++) {
                        if (col - extV >= 0) {
                            affectedCells[row][col - extH] = true;
                            if (row - extV >= 0) {
                                affectedCells[row - extV][col - extH] = true;
                            }
                            if (row + extV < target.length) {
                                affectedCells[row + extV][col - extH] = true;
                            }
                        }
                        if (col + extV < target[0].length) {
                            affectedCells[row][col + extH] = true;
                            if (row - extV >= 0) {
                                affectedCells[row - extV][col + extH] = true;
                            }
                            if (row + extV < target.length) {
                                affectedCells[row + extV][col + extH] = true;
                            }
                        }
                    }
                }
            }
        }
    }

    for (let row = 0; row < target.length; row++) {
        for (let col = 0; col < target[0].length; col++) {
            if (target[row][col]) {
                affectedCells[row][col] = false;
            }
        }
    }
    // need to negate the actual shape 

    return affectedCells;

}

function newArrayMatchingShapeOf<T, R>(arrayWithShape: R[][], defaultValue: T): T[][] {
    return [...Array(arrayWithShape.length)].map(_ => [...Array(arrayWithShape[0].length)].map(_ => defaultValue));
}

class Stroke implements DerivedTarget {
    parentTargets: Target[]
    position: [number, number];
    frameId: number | undefined;
    effect: Effect | undefined;
    debugTag: string | undefined;
    size: number;
    shape: Colour[][];

    constructor(parentTarget: Target, size: number) {
        this.parentTargets = [parentTarget];
        this.size = size;
        this.position = parentTarget.position;

        this.shape = stroke(parentTarget.draw(), size);
    }

    draw(): Colour[][] {
        return this.shape;
    }
    clone(): Target {
        throw new Error("Method not implemented.");
    }

}

class Noise implements DerivedTarget {
    parentTargets: Target[];
    position: [number, number];
    fraction: number;
    pattern: Colour[][];

    frameId: number | undefined;
    effect: Effect | undefined;
    debugTag: string | undefined;

    constructor(target: Target, fraction: number, baseTarget?: Target) {
        this.parentTargets = [target];
        this.position = target.position;
        this.fraction = fraction;
        if (baseTarget) {
            this.parentTargets.push(baseTarget);
        }

        let shape = target.draw();
        let pattern = [];

        let base: Colour[][] | undefined;
        if (this.parentTargets.length > 1) {
            console.log("base available ", this.parentTargets[1].debugTag)
            base = this.parentTargets[1].draw();
        }

        for (let y = 0; y < shape.length; y++) {
            let row = []
            for (let x = 0; x < shape[y].length; x++) {
                // const index = (y * row.length + x) * 4;

                const isWhite = shape[y][x] ? base && base[y][x] ? true : Math.random() > this.fraction : false;
                // const colour = isWhite ? 255 : 0;

                row.push(isWhite);
            }
            pattern.push(row);
        }

        this.pattern = pattern;
    }

    draw(): Colour[][] {
        return this.pattern;
    }

    clone(): Target {
        throw new Error("Method not implemented.");
    }


}

class Checkerboard implements DerivedTarget {
    parentTargets: Target[];
    position: [number, number];
    startZero: boolean;


    constructor(parentTarget: Target, startZero: boolean = false) {
        this.parentTargets = [parentTarget];
        this.position = parentTarget.position;
        this.startZero = startZero;
    }

    draw(): Colour[][] {
        // work within the shape given to make it a checkerboard
        let shape = this.parentTargets[0].draw();

        let checkerboardShape = [];
        for (let row = 0; row < shape.length; row++) {
            let checkerboardRow = [];
            for (let col = 0; col < shape[row].length; col++) {
                checkerboardRow.push(shape[row][col] && ((row % 2 == col % 2 && this.startZero) || (row % 2 != col % 2 && !this.startZero)));
            }
            checkerboardShape.push(checkerboardRow);
        }

        return checkerboardShape;
    }
    clone(): Target {
        throw new Error("Method not implemented.");
    }
    frameId: number | undefined;
    effect: Effect | undefined;
    debugTag: string | undefined;


}

class Inverted implements DerivedTarget {
    parentTargets: Target[];
    position: [number, number];
    draw(): Colour[][] {
        throw new Error("Method not implemented.");
    }
    clone(): Target {
        throw new Error("Method not implemented.");
    }
    frameId: number | undefined;
    effect: Effect | undefined;
    debugTag: string | undefined;

}

class Collision implements DerivedTarget {
    parentTargets: Target[];
    position: [number, number];
    shape: Colour[][];

    frameId: number | undefined;
    effect: Effect | undefined;
    genEffect: (selected: ([number, number][])) => Colour[][];
    defaultColour: Colour;

    debugTag: string | undefined;

    constructor(parentTargets: Target[], impactAffected: (selected: ([number, number][])) => Colour[][], defaultColour: Colour) {
        this.parentTargets = parentTargets; // how many things can be involved in a collision?
        let pos: [number, number] = [0, 0]; //this.findPosition(parentTargets);
        this.position = pos;
        this.genEffect = impactAffected;
        this.defaultColour = defaultColour;

        let collisionArea = allCollisionPoints(parentTargets.map(p => p.draw()), defaultColour);
        console.log(collisionArea);
        this.shape = impactAffected(collisionArea);
        console.log(this.shape)
    }

    draw(): Colour[][] {
        // console.log(this.shape)
        return this.shape
        // throw new Error("Method not implemented.");
    }

    clone(): Target {
        return new Collision(this.parentTargets, this.genEffect, this.defaultColour)
        throw new Error("Method not implemented.");
    }


}

function indicesToColours(input: [number, number][], dims: [number, number]): Colour[][] {
    let [width, height] = dims;

    let basic = [...Array(height)].map(_ => [...Array(width)].map(_ => false));
    for (let [x, y] of input) {
        basic[y][x] = true;
    }

    return basic;

}

// make an effect like this:
// centered around the midpoint of the input indices
// the effect begins at radius supplied
// and is size pixels thick
// but what's the best way to do this? should I get a pixel library or something? hmmm
function generateFlutterCenteredEffect(radius: number, size: number, dims: [number, number]): (input: [number, number][]) => Colour[][] {
    return (input: [number, number][]): Colour[][] => {
        let midPointX = Math.round((input.map(x => x[0]).reduce((acc, x) => acc + x, 0)) / input.length);
        let midPointY = Math.round((input.map(x => x[1]).reduce((acc, x) => acc + x, 0)) / input.length);

        // okay, so let's start with this, it's basic
        // I'll just grab a circle algorithm 
        let circlePts = makeCircle(midPointX, midPointY, radius, size);
        // this should also not affect the original targets
        // okay, now let's just try to convert this back into colours 

        circlePts = circlePts.filter(tup => inBounds(tup, dims));
        console.log(frameDisplay(indicesToColours(circlePts, dims)))
        return indicesToColours(circlePts, dims);
    }

}

function makeCircle(cx: number, cy: number, r: number, size: number): [number, number][] {
    return [...new Array(size).keys()].map(i => circleBresenham(cx, cy, r + i)).flat();
}



// Function to put pixels
// at subsequence points
function fillCirclePoints(xc: number, yc: number, x: number, y: number): [number, number][] {
    let points: [number, number][] = [];
    points.push([xc + x, yc + y]);
    points.push([xc - x, yc + y]);
    points.push([xc + x, yc - y]);
    points.push([xc - x, yc - y]);
    points.push([xc + y, yc + x]);
    points.push([xc - y, yc + x]);
    points.push([xc + y, yc - x]);
    points.push([xc - y, yc - x]);

    return points;
}

// Function for circle-generation
// using Bresenham's algorithm
function circleBresenham(xc: number, yc: number, r: number): [number, number][] {
    console.log(xc, yc)
    let x = 0, y = r;
    let d = 3 - 2 * r;
    let allPoints: [number, number][] = [];
    allPoints = allPoints.concat(fillCirclePoints(xc, yc, x, y));
    while (y >= x) {

        // check for decision parameter
        // and correspondingly 
        // update d, y
        if (d > 0) {
            y--;
            d = d + 4 * (x - y) + 10;
        }
        else
            d = d + 4 * x + 6;

        // Increment x after updating decision parameter
        x++;

        // Draw the circle using the new coordinates
        allPoints = allPoints.concat(fillCirclePoints(xc, yc, x, y));

    }

    return allPoints
}

class Interpolate {

}

// what esle?
class A {

}


function allCollisionPoints(targets: Colour[][][], defaultColour: Colour): [number, number][] {
    // need to find points touched by multiple images.
    // but since we only have one kind of signal, we actually should check if any neighbors touch, not intersections.
    // so, let's first capture all the neighbors by growing them outward.

    let neighborPixelsOfTargets = targets.map(t => stroke(t, 1));
    // okay, now for each, I'll see if the neighorbour pixels overlap me.
    // maybe this would be easiest if it was just limited to two.
    // but if there are multiple, they all have to match... 
    // what does it actually mean to collide??         
    // do I return the top corner of the collision? or all locations where collision occurred? 
    // maybe location of collision? then the shape can decide what to do e.g. centre around collision areas. 

    // for two shapes, find where the neighbor overlaps the actual shape
    // for three shapes, both neighbors must overlap a pixel 
    // then, we return ALL? pixels that match this. 

    let sumsOfNeighbors: [number, number[]][][] = neighborPixelsOfTargets.reduce((counts: [number, number[]][][], curr: Colour[][], idx: number) => {
        for (let i = 0; i < curr.length; i++) {
            for (let j = 0; j < curr[i].length; j++) {
                if (curr[i][j] != defaultColour) {
                    let [prevCount, prevContributed] = counts[i][j];
                    counts[i][j] = [prevCount + 1, prevContributed.concat([idx])];
                }
            }
        }
        return counts;
    }, newArrayMatchingShapeOf<[number, number[]], Colour>(targets[0], [0, []]));

    let indicesToCheck: [number, number, number[]][] = sumsOfNeighbors.map((r, i) => r.map((c, j) => {
        let [count, ct] = c;
        if (count == targets.length - 1) {
            return [i, j, ct] as [number, number, number[]];
        } else {
            return [-1, -1, []] as [number, number, number[]];
        }
    }).filter(x => x[0] != -1)).flat(1);


    // first: take all the ones whose sum is targets.length - 1 
    // this is because the neighbors have to touch... but if all neighbours touch they're not overlapping 
    // let final = newArrayMatchingShapeOf<Colour, Colour>(targets[0], false);

    let final: [number, number][] = [];
    for (let [i, j, targs] of indicesToCheck) {
        for (let tIdx = 0; tIdx < targets.length; tIdx++) {
            let target = targets[tIdx];
            if (target[i][j] != defaultColour && !targs.includes(tIdx)) {
                // then it's a candidate
                final.push([j, i]);
            }
        }
    }

    return final;
}


class MotionFlipTo implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType) {
        this.from = from;
        this.to = to;
        this.type = type;
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        if (!this.from || !this.to) {
            throw new Error("Effect isn't actually complete")
        }

        let transitionPoint = Math.floor(numFrames / 2);
        // if it's zero, then I don't actually have enough frames.
        // just flip to the second one
        if (transitionPoint == 0) {
            return [this.to];
        } else {
            // console.log(numFrames - transitionPoint)
            // console.log(this.to!)
            return [...Array(transitionPoint)].map(_ => this.from!).concat([...Array(numFrames - transitionPoint)].map(_ => this.to!));
        }
    }

    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        // throw new Error("Method not implemented.");
        let frames = this.generateCompleteFrames(flips) // not sure how to translate this exactly...
        // // first is actually empty...
        // let emptyFrame: Target = new PixelArtTarget([], false);
        // let emptyFrame: Target = new PixelArtTarget(frames[0].draw().map(r => r.map(c => false)), false);
        
        // console.log(frames.map(f => f.position))
        let allFrames: Target[] = [this.from!, ...frames];

        // console.log(allFrames)
        console.log(frames)
        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        // let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
 
        console.log("time is (groupaction) ", time)
        
         
        return h => {
            // the duration should be consistent.
            // but I actually want to change the time 
            console.log("time is...logging!")
            let actions = windowFrames.map(w => new FlipTransition().generateGroupActions(w[0], w[1], 3, h)).flat();
            console.log("time is (before adding) ", actions.map(a => a.tPlus))

            for (let action of actions) {
                action.tPlus = action.tPlus + time + 1;
            }
            console.log("time is (after adding) ", actions.map(a => a.tPlus))
            return actions;
        };
    }

}

class Instantaneous implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    constructor(from: Target | undefined, to: Target | undefined, type: EffectType) {
        this.from = from;
        this.to = to;
        this.type = type;
    }
    generateGroupActions(time: number, flips: number): ((h: HardwareInterface) => GroupAction[]) {
        let frames = this.generateCompleteFrames(flips) // not sure how to translate this exactly...
        // // first is actually empty...
        // let emptyFrame: Target = new PixelArtTarget([], false);
        // let emptyFrame: Target = new PixelArtTarget(frames[0].draw().map(r => r.map(c => false)), false);
        
        // console.log(frames.map(f => f.position))
        let allFrames: Target[] = [this.from!, ...frames];

        // console.log(allFrames)
        console.log(frames)
        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        // let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        
        return h => windowFrames.map(w => new SnapTransition().generateGroupActions(w[0], w[1], time, h)).flat();

    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        if (!this.from || !this.to) {
            throw new Error("Effect isn't actually complete")
        }

        let transitionPoint = Math.floor(numFrames / 2);
        // if it's zero, then I don't actually have enough frames.
        // just flip to the second one
        if (transitionPoint == 0) {
            return [this.to];
        } else {
            // console.log(numFrames - transitionPoint)
            // console.log(this.to!)
            return [...Array(transitionPoint)].map(_ => this.from!).concat([...Array(numFrames - transitionPoint)].map(_ => this.to!));
        }
    }

}

enum WipeDirection {
    LTR,
    RTL,
    TTB,
    BTT,
}


class Sparkle implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType) {
        this.to = to;
        this.from = from;
        this.type = type;
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        if (!this.to || !this.from) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }

        return [this.from, this.to];
    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        let frames = this.generateCompleteFrames(flips);
        if (!this.to || !this.from) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }

        // find the centre of the to
        let centre = this.to?.draw();
        let idxes = centre?.map((r, i) => r.map((c, j) => {
            if (c) { 
                return [i, j]
            } else {
                return undefined;
            }
    })).flat().filter(i => i != undefined);

        if (idxes.length == 0) {
            idxes = [this.from.position];
        }
        
        let midPointX = Math.round((idxes.map(x => x[0]).reduce((acc, x) => acc + x, 0)) / idxes.length);
        let midPointY = Math.round((idxes.map(x => x[1]).reduce((acc, x) => acc + x, 0)) / idxes.length);

        

        return h => {
            // it's okay since I know what kind of thing this is for...
            let dists = idxes.map(idx => Math.sqrt((midPointX - idx[0]) ** 2 + (midPointY - idx[1]) ** 2));
            let max = dists.reduce((max: [number, number], dist: number, i: number) => dist > max[1] ? [i, dist] as [number, number] : max, [0, dists[0]]);
            let closestUnit = h.coordToIndex(idxes[max[0]] as [number, number]);
            
            // return new StochasticTransition(closestUnit).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            // return new WaveTransition(new GrowFromCentre(idxes[max[0]] as [number, number])).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            // TODO: this point needs to consider that this is th global max and we work with a mask later 
            // TODO: this would be a cool way to do the density of the shape, but...
            // return new StochasticTransition(new GrowFromCentre(idxes[max[0]] as [number, number])).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            return new StochasticTransition(new GrowFromCentre((w,h) => [Math.round(w/2), Math.round(h/2)] as [number, number])).generateGroupActions(frames[0], frames[frames.length-1], time, h);
        }
    }

}

class RotateReveal implements Effect {
    
}

class Wipe implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    direction: WipeDirection;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType, direction: WipeDirection) {
        this.to = to;
        this.from = from;
        this.type = type;
        this.direction = direction;
    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        // throw new Error("Method not implemented.");
        console.log(flips)
        let frames = this.generateCompleteFrames(flips) // not sure how to translate this exactly...
        
        let allFrames: Target[] = [this.from!, this.to!];
        // let allFrames: Target[] = [this.from!, ...frames];
        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        // let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        
        
        return h => {
            // let dir: [number, number] = [1,1];
            // let dir: [number, number] = [1, 0]
            // let direction = h.timeFrontier(0, dir)
            // let direction = (t: number) => []
            
            // return [];
            return windowFrames.map(w => new WaveTransition(new BottomUp()).generateGroupActions(w[0], w[1], time, h)).flat()
        };
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        // start with the top and go to the bottom.

        if (!this.to || !this.from) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }

        let interpPositions = 1 / numFrames;
        console.log(numFrames)
        let newObjects = [];

        for (let i = 0; i < numFrames; i++) {

            // drawFrame(rectSize, [, ], hardware);

            let shape = this.to.draw();
            let point = Math.round(interpPositions * i * shape.length);

            let oldShape = this.from.draw();
            console.log(oldShape);
            console.log(shape)
            // now, I'll just take everything at interpPoint
            console.log(point)
            for (let j = point; j < shape.length; j++) {
                console.log(j)
                shape[j] = oldShape[j];
            }
            console.log(shape)

            let obj = new PixelArtTarget(shape, false); // lol.......

            newObjects.push(obj);
        }

        return newObjects;

    }

}

class DrawingHeadWipe implements Effect {
    // this should be a bit different! I need to set a frontier that I grow from rather than growing unilaterally. TODO 
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    startingPoint: [number, number] | undefined
    timeVectorField: number[][] | undefined;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType, startingPoint: [number, number]) {
        this.to = to;
        this.from = from;
        this.type = type;
        this.startingPoint = startingPoint;

    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        throw new Error("Method not implemented.");
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        // start with the top and go to the bottom.

        if (!this.to || !this.from || !this.startingPoint) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }

        let shape = this.to.draw();


        this.timeVectorField = [];
        let x = this.startingPoint[0];
        let y = this.startingPoint[1];
        console.log(x, y, "AH")


        for (let i = 0; i < shape.length; i++) {
            let row = [];
            for (let j = 0; j < shape[i].length; j++) {
                row.push(Math.max(Math.abs(i - y), Math.abs(j - x)));
            }
            this.timeVectorField.push(row);
        }

        console.log(this.timeVectorField)
        let maxDistance = Math.max(...this.timeVectorField.flat().flat());

        let interpInterval = 1 / numFrames;
        console.log(numFrames)
        let newObjects = [];
        let newShape = this.from.draw();


        for (let i = 0; i < numFrames; i++) {

            // drawFrame(rectSize, [, ], hardware);

            // let shape = this.to.draw();
            let increaseBy = Math.round(interpInterval * maxDistance);

            // how do I know how much to grow by??? 
            console.log(increaseBy)


            // go through the time vector field. if the current time is lower, take new.
            for (let a = 0; a < shape.length; a++) {
                for (let b = 0; b < shape[a].length; b++) {
                    let timeValue = this.timeVectorField[a][b];
                    // console.log(timeValue, currentTime)
                    if (timeValue <= increaseBy) {
                        newShape[a][b] = shape[a][b]
                    }
                }
            }

            console.log(newShape)

            let obj = new PixelArtTarget(newShape, false); // lol.......

            newObjects.push(obj);



            /// reset the situation
            // I want to make a new starting point each time.
            // also, I don't want to override the progress I previously made.

            // let's start by finding the next frontier point. 
            // I'll take a 2x2 survey and find the average direction.
            // maybe this is better expressed as a derivative 

            let sumX = 0, sumY = 0;
            let moveRadius = 2;
            let modesX: Map<number, number> = new Map();
            let modesY: Map<number, number> = new Map();
            let getOrZero = (i: number | undefined) => i != undefined ? i : 0;
            // the number of POTENTIAL squares is the floor(perimeter/2) -- 
            let potentialSquares = Math.floor(Math.pow(2, moveRadius + 1) / 2);
            // what if it's completely centered? hmmmm....
            for (let i = -moveRadius; i < moveRadius; i++) {
                for (let j = -moveRadius; j < moveRadius; j++) {
                    let testCoordX = x + i;
                    let testCoordY = y + j;
                    if (inBounds([testCoordX, testCoordY], [shape.length, shape[0].length]) && shape[testCoordY][testCoordX]) {
                        // I also need to make sure this isn't already covered.
                        sumX += i;
                        sumY += j;
                        modesX.set(i, getOrZero(modesX.get(i)) + 1);
                        modesY.set(i, getOrZero(modesY.get(i)) + 1);
                    }
                }
            }
            // if it's a circle around, that's 3. but another is 4. so 7 total

            // wait, I don't think this is right. If I move -2, -2, -2 three times I only want -2 in total.
            // maybe I just want the mode? 
            sumX = Math.round(sumX / potentialSquares);
            sumY = Math.round(sumY / potentialSquares);


            // try using modes?
            sumX = [...modesX.entries()].reduce((a, e) => e[1] > a[1] ? e : a, [-Infinity, -Infinity])[0];
            sumY = [...modesY.entries()].reduce((a, e) => e[1] > a[1] ? e : a, [-Infinity, -Infinity])[0];

            console.log(modesX);
            console.log(modesY)
            // x = x + sumX / 7;
            // y = y + sumY / 7;
            // the problem is, that amount of steps works if we have enough to move like 1 step at a time.
            // how do I actually figure out how many steps I am allowed...?
            // do I need to do it once first? 
            // also on average we might not make that much progress/
            // what about like a winding number approach? 
            // ahh, well this is just the direction right?


            // hmmm... this strategy doesn't work if I get trapped in a well basically 
            // I need to go back into the shape
            // I should ask Adriana for help with this one 
            if (sumX == 0 && sumY == 0 || (sumX == -Infinity && sumY == -Infinity)) {
                // I guess pick a random point?
                sumX = Math.round(Math.random() + 1);
                sumY = Math.round(Math.random() + 1);
            }
            console.log(x, y, sumX, sumY, potentialSquares)

            x = x + sumX;
            y = y = sumY;
            console.log(x, y)

            this.timeVectorField = [];
            for (let i = 0; i < shape.length; i++) {
                let row = [];
                for (let j = 0; j < shape[i].length; j++) {
                    row.push(Math.max(Math.abs(i - y), Math.abs(j - x)));
                }
                this.timeVectorField.push(row);
            }

        }

        return newObjects;

    }
}


class GrowWipe implements Effect {
    // basically, find the next n parts of the image.
    // let's take the image and a starting point 

    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    startingPoint: [number, number] | undefined
    timeVectorField: number[][] | undefined;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType, startingPoint: [number, number]) {
        this.to = to;
        this.from = from;
        this.type = type;
        this.startingPoint = startingPoint;

        // here's what I want to do
        // I need to make a time field.
        // the time field could be derived from one of two things
        // 1) the design of the to frame 
        // 2) the difference between the to and from frame
        // is there a difference...?
        // let's just go with 1) for now.        
    }
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        throw new Error("Method not implemented.");
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        // start with the top and go to the bottom.

        if (!this.to || !this.from || !this.startingPoint) {
            throw new Error("Cannot generate complete animation because one of to or from is missing");
        }


        this.timeVectorField = [];
        let x = this.startingPoint[0];
        let y = this.startingPoint[1];
        // I should be able to compute this in a straight pass right? just by calculating the distance max(vdist, hdist) from the starting point 
        // ah, I could also solve a heat equation...
        let shape = this.to.draw();
        for (let i = 0; i < shape.length; i++) {
            let row = [];
            for (let j = 0; j < shape[i].length; j++) {
                row.push(Math.max(Math.abs(i - y), Math.abs(j - x)));
            }
            this.timeVectorField.push(row);
        }

        console.log(this.timeVectorField)
        let maxDistance = Math.max(...this.timeVectorField.flat().flat());

        let interpInterval = 1 / numFrames;
        console.log(numFrames)
        let newObjects = [];

        for (let i = 0; i < numFrames; i++) {

            // drawFrame(rectSize, [, ], hardware);

            // let shape = this.to.draw();
            let currentTime = Math.round(interpInterval * i * maxDistance);
            let newShape = this.to.draw();
            let oldShape = this.from.draw();
            console.log(currentTime)


            // go through the time vector field. if the current time is lower, take new.
            for (let a = 0; a < shape.length; a++) {
                for (let b = 0; b < shape[a].length; b++) {
                    let timeValue = this.timeVectorField[a][b];
                    // console.log(timeValue, currentTime)
                    if (timeValue > currentTime) {
                        newShape[a][b] = oldShape[a][b]
                    }
                }
            }

            console.log(newShape)

            let obj = new PixelArtTarget(newShape, false); // lol.......

            newObjects.push(obj);
        }

        return newObjects;

    }


}



function hex2Rgb(hex: string): [number, number, number] | undefined {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : undefined;
}




let parseImagesIntoFrames = async (urls: string[]): Promise<[Target[][], number, number, string[]]> => {


    let [width, height, images] = await getImages(urls);

    // now I have all the images. 
    // let's find the unique colours. 
    let rgbToId: Map<number, string> = new Map();
    let allColours = images.flat(2).map(x => rgb2Hex(...x))
    let uniqueColours = [...new Set(allColours)].filter(c => c != "#ffffff");
    // for each colour...
    uniqueColours.forEach((x, i) => { rgbToId.set(i, x) });

    // now I have the ids of each shape.
    // what I should do is go and build a "mask" of each shape on each frame 
    // per frame? I guess so...
    let allFramesAllShapes = [];
    let allShapesAllFrames: Target[][] = [...rgbToId.keys()].map(_ => []);
    console.log(allShapesAllFrames)
    console.log(rgbToId);

    // frames, objects. 
    for (let image of images) {
        let eachFrameData = [];
        for (let [id, col] of rgbToId) {
            console.log(col)
            console.log(id)
            let rgbCol: [number, number, number] = hex2Rgb(col)!;

            // go through and find it...
            // I can use getShapeFrames 
            let booleanFrame = image.map(row => row.map(c => c[0] == rgbCol[0] && c[1] == rgbCol[1] && c[2] == rgbCol[2]));
            console.log(frameDisplay(booleanFrame))
            // let indices: [number, number][] = booleanFrame.map((row, i) => row.map((c, j) => c ? [j, i] as [number, number] : undefined)).flat(1).filter((i: [number, number] | undefined) => i != undefined);
            // // let shapeFrame = getShapeFrames(indices, interp);
            // // allFrameData.push(shapeFrame);
            // // okay!

            // // need to figure out boundaries 
            // let xMin = Math.min(...indices.map(x => x[0]));
            // let yMin = Math.min(...indices.map(x => x[1]));

            // console.log(xMin, yMin)
            // console.log(indices)

            // let inputShape: [number, number][] = indices.map(x => [x[0] - xMin, x[1] - yMin]);

            // let frame = [...Array(height)].map(_ => [...Array(width)].map(_ => false))
            // for (let obj of indices) {
            //     let x = obj[0] + xMin;
            //     let y = obj[1] + yMin;
            //     // console.log(x, y)
            //     if (inBounds([x, y], [width, height])) {
            //         frame[y][x] = true;
            //     }
            // }

            let target = new PixelArtTarget(booleanFrame, false);
            target.frameId = allShapesAllFrames[id].length

            eachFrameData.push(target);
            allShapesAllFrames[id].push(target);
        }
        allFramesAllShapes.push(eachFrameData);
    }

    // now I have a bunch of objects at each frame
    // let me hook them up!
    for (let i = 0; i < allShapesAllFrames.length; i++) {
        let makeEffectsFor = toWindows<Target>(allShapesAllFrames[i], 2);
        // for each id, I need to hook up stuff for each frame
        for (let [o1, o2] of makeEffectsFor) {
            let newEffect = new Instantaneous(o1, o2, EffectType.Complete);
            // let newEffect = new UniformMove(o1, o2, EffectType.Complete);
            o1.effect = newEffect;
        }
    }

    console.log(allFramesAllShapes)
    return [allShapesAllFrames, width, height, [...rgbToId.values()]]
}

export function toWindows<T>(inputArray: T[], size: number) {
    return Array.from(
        { length: inputArray.length - (size - 1) }, //get the appropriate length
        (_, index) => inputArray.slice(index, index + size) //create the windows
    )
}


let frameDisplay = (frame: Colour[][]): string => {
    let str = "";
    for (let row of frame) {
        console.log()
        let strRow = "";
        for (let col of row) {
            // console.log(col)
            strRow += ` ${col == true ? "O" : "X"}`
            // strRow + col;
            // console.log(strRow);
        }
        str += strRow + "\n"
    }
    // console.log(str);
    return str;
}

function indicesDisplay(indices: [number, Colour][], width: number, height: number) {
    let str = [...Array(height)].map(_ => [...Array(width)].map(_ => "X"));
    // console.log(indices)
    for (let [idx, col] of indices) {
        // str[Math.floor(idx / width)][idx % width] = `${col}`;
        // console.log(col)
        // console.log(str)
        // console.log(str[Math.floor(idx / width)])
        // console.log(idx)
        str[Math.floor(idx / width)][idx % width] = col == true ? "O" : "X";
    }

    return str.map(row => row.join(" ")).join("\n")
}


function frameToIndices(frames: Colour[][][], width: number) {
    // console.log(frames)
    let updatedFrames = [];
    for (let frame of frames) {
        // console.log(frame)
        // okay something weird is going on 
        // I need to make sure these are being added up per row.

        // yikes...? this is really stopgap for uniform move
        let newFrame: [number, Colour][] = frame.map((r, i) => r.reduce((acc: [number, Colour][], curr: Colour, idx: number) => {
            // console.log(curr)
            if (curr) {
                acc.push([i * width + idx, curr])
            }
            return acc;
        }, [] as [number, Colour][])).reduce((o, n) => o.concat(n), []);

        updatedFrames.push(newFrame);
    }

    // console.log(updatedFrames)
    return updatedFrames;

}
// okay, this seems fine...
// now I want to do something like...
// 1) check all the frames

function diffIndices(a: boolean[][], b: boolean[][]): number[] {
    const differences: number[] = [];

    // Basic safety checks — dimensions should match
    if (a.length !== b.length) {
        throw new Error("Arrays differ in number of rows.");
    }

    let index = 0;

    for (let row = 0; row < a.length; row++) {
        if (a[row].length !== b[row].length) {
            throw new Error(`Row ${row} differs in length.`);
        }

        for (let col = 0; col < a[row].length; col++) {
            if (a[row][col] !== b[row][col]) {
                differences.push(index);
            }
            index++;
        }
    }

    return differences;
}

let generateAnimationToGroupAction_old = (objects: Target[][], transitionTiming: number[], h: HardwareInterface): GroupAction[] => {
    // first, write a function that handles just a set of objects to other 
    // let framesComposed: Colour[][][][] = [...Array(transitionTiming.reduce((acc, cur) => acc + cur, 0))].map(_ => []);
    // console.log(framesComposed)
    // for (let object of objects) {
    //     for (let i = 0; i < object.length; i++) {
    //         framesComposed[i].push(object[i].draw())
    //     }
    // }

    // let frames: Colour[][][] = [];
    // // now take that and add everything togehter
    // for (let frame of framesComposed) {
    //     let finishedFrame: Colour[][] = compose(frame);
    //     if (finishedFrame && finishedFrame.length != 0) {
    //         frames.push(finishedFrame);
    //     }
    // }

    // console.log("width is ", frames[0][0].length, "heigth is ", frames[0].length)

    // // first is actually empty...
    // let emptyFrame = frames[0].map(r => r.map(c => false));
    // let allFrames = [emptyFrame, ...frames];

    // let windowFrames = toWindows(allFrames, 2);
    

    // // each effect might do something different... I should try to hook it up
    // let generateAnimationBetweenFrames = (start: boolean[][], end: boolean[][], time: number): GroupAction[] => {
    //     // let's just assume it's an instantaneous action... but we can create more of these later and hook it up properly 
    //     let flip = diffIndices(start as boolean[][], end as boolean[][]);
    //     return [new GroupAction(time, [[Action.FLIP, flip]])];
    // }



    let actions: GroupAction[] = [];
    for (let object of objects) {
        let frameNum = 0;

        let o: Target | undefined = object[0];
        console.log(o, "tagged", o.debugTag, o.frameId, frameNum)
        while (o && o.effect != undefined && frameNum <= 50) {
            console.log(o.frameId, frameNum)
            
            let fullObjects = o.effect.generateGroupActions(transitionTiming[frameNum], 1)
            // console.log(fullObjects.map(o => o.draw()))
            actions = actions.concat(fullObjects(h))
            // allFrameValues.push(fullObjects.map(o => o.draw()));
            // console.log("generated", o.debugTag, o.frameId, allFrameValues)
            o = o.effect.to;
            frameNum += 1;
            console.log("compiling!")
        }
    }
    // console.log("?")

    // let groupActions = [];
    // for (let i = 0; i < windowFrames.length; i++) {
    //     let [start, end] = windowFrames[i];
    //     let groupAction = generateAnimationBetweenFrames(start as boolean[][], end as boolean[][], transitionTiming[i])[0];
    //     groupActions.push(groupAction);
    // }

    // no need to compose because each of thse will handle a different area.
    // jsut need to "collapse" all the group actions 

    return actions;
}


let generateAnimationToGroupAction = (objects: Target[][], transitionTiming: number[], h: HardwareInterface): GroupAction[] => {
    let actions: GroupAction[] = [];
    for (let object of objects) {
        let frameNum = 0;

        // I need to start with a start object to initialize it
        let emptyFrame: Target = new PixelArtTarget(object[0].draw().map(r => r.map(c => false)), false);
        actions = actions.concat(new SnapTransition().generateGroupActions(emptyFrame, object[0], 0, h));
        console.log(actions)

        let o: Target | undefined = object[0];
        console.log(o, "tagged", o.debugTag, o.frameId, frameNum)
        while (o && o.effect != undefined && frameNum <= 50) {
            console.log(o.frameId, frameNum)
            
            // timing issue - subtract the duration
            let prev = frameNum == 0 ? 1 : transitionTiming[frameNum-1]
            console.log(prev)
            let fullObjects = o.effect.generateGroupActions(transitionTiming[frameNum] - prev, 1)
            // console.log(fullObjects.map(o => o.draw()))
            // console.log(fullObjects(h))
            let objs = fullObjects(h);
            console.log(objs)
            objs.forEach(o => o.tPlus = o.tPlus + prev)
            console.log(objs)

            actions = actions.concat(objs)
            console.log(transitionTiming[frameNum])
            // allFrameValues.push(fullObjects.map(o => o.draw()));
            // console.log("generated", o.debugTag, o.frameId, allFrameValues)
            o = o.effect.to;
            frameNum += 1;
            console.log("compiling!")
        }

    }

    console.log("times are ", actions.map(t => t.tPlus))

    // there's another thing that I must do. if a space isn't covered by any object, then I need to reset it.
    // TODO: figure out if it is or not 
    let timesToUnits: Map<number, number[]> = new Map();
    for (let action of actions) {
        let current = timesToUnits.get(action.tPlus);
        current = current ? current : [];
        timesToUnits.set(action.tPlus, current.concat(action.actions[0] as number[]))
    }



    return actions;
}


let generateAnimation = (objects: Target[][], transitionTiming: number[]): Colour[][][] => {
    console.log(objects);
    // get all the frames from the objects by traversing the tree
    let numObjects = objects.length;

    let frameToObjects = new Map();
    for (let object of objects) {
        for (let frameObj of object) {
            // scrape everything... 
            // the problem is, what if frame id isn't defined? 

            frameToObjects.set(frameObj.frameId, object);
        }
    }

    // now I should take all the frame ids and order the,
    let frameIds = [...frameToObjects.keys()];
    frameIds.sort();

    // are there any missing...?
    // okay, the next step is, is there any 

    // I need to figure out how many frames are for each transition. 

    // AHA: frame ids aren't accounted for at all... 
    console.log(objects)
    let numFramesPerObject: number[] = [];
    let objectFrames: Colour[][][][] = [];
    for (let object of objects) {
        // 
        let allFrameValues: Colour[][][] = [];
        // does each object contain every frame?
        // let fullyInterpolated = frameIds.every(f => object.map(o => o.frameId).includes(f));
        // if (!fullyInterpolated) {
        // need to to fill in the missing frames.
        // eventually, anyway...
        // but wouldn't it be better to fill everything in at once?
        // }

        // let's generate the frames 
        let frameNum = 0;

        let o: Target | undefined = object[0];
        console.log(o, "tagged", o.debugTag, o.frameId, frameNum)
        while (o && o.effect != undefined && frameNum <= 50) {
            console.log(o.frameId, frameNum)
            if (o.frameId != frameNum) {
                console.log("generated an empty for target ", o.debugTag, frameNum, transitionTiming[frameNum])
                // TODO: I think this is delaying things one frame... because there should be one less set of frames than keyframes
                allFrameValues = allFrameValues.concat([...Array(transitionTiming[frameNum])].map(_ => []));
                frameNum += 1;
                continue;
            }
            console.log("looping! frame ", frameNum, o.debugTag)
            // this works when all frames are defined. if we have break in continuity, we need to multiply number of
            let fullObjects = o.effect.generateCompleteFrames(transitionTiming[frameNum])
            // console.log(fullObjects)
            console.log(fullObjects.map(o => o.draw()))
            allFrameValues = allFrameValues.concat(fullObjects.map(o => o.draw()));
            // allFrameValues.push(fullObjects.map(o => o.draw()));
            console.log("generated", o.debugTag, o.frameId, allFrameValues)
            o = o.effect.to;
            frameNum += 1;
        }
        // console.log(object)
        numFramesPerObject.push(allFrameValues.length);
        objectFrames.push(allFrameValues);
    }
    // console.log("?")

    // console.log(objects)
    // object, allframes (row, col) -> why is it [object - 4 frames - 3 frames? ah because 3 frames per keyframe.]
    // console.log(objectFrames)

    console.log(numFramesPerObject);
    console.log(numObjects)
    // if (!numFramesPerObject.every(i => i == transitionTiming.length)) {
    //     throw new Error("Frame number mismatch: " + transitionTiming.length + " and " + numFramesPerObject);
    // }


    // this is supposed to have all objects for each frame
    // frame, object, row, column
    // need to sum all the values
    let framesComposed: Colour[][][][] = [...Array(transitionTiming.reduce((acc, cur) => acc + cur, 0))].map(_ => []);
    console.log(framesComposed)
    for (let object of objectFrames) {
        for (let i = 0; i < object.length; i++) {
            // console.log(i)
            // console.log(object)
            // object[i] should only be Colour[][] since it's per frame 
            // console.log(object[i])
            framesComposed[i].push(object[i])
        }
    }

    // if (framesComposed.length != transitionTiming.length) {
    //     throw new Error("frames composed length doesn't match number of frames");
    // }

    // if (!framesComposed.every(frame => frame.length == numObjects)) {
    //     throw new Error("frames composed number of objects per frame doesn't match number of objects at beginning")
    // }

    // okay... so now I have all the frames. 
    // I need to collapse each frame

    let frames: Colour[][][] = [];
    // now take that and add everything togehter
    for (let frame of framesComposed) {
        // console.log(framesComposed)
        // frame.forEach(x => console.log(frameDisplay(x)));
        let finishedFrame: Colour[][] = compose(frame);
        // console.log(frameDisplay(finishedFrame))
        // console.log(finishedFrame)
        if (finishedFrame && finishedFrame.length != 0) {
            frames.push(finishedFrame);
        }
    }

    console.log(frames)

    // if (frames.length != transitionTiming.length) {
    //     throw new Error("frames length mismatch")
    // }

    return frames;

}

// objects is: for a single frame, the objects in it 
let compose = (objects: Colour[][][]): Colour[][] => {
    let definitive: Colour[][] = objects[0];
    // console.log(definitive)
    // console.log(objects)
    for (let o = 1; o < objects.length; o++) {
        for (let row = 0; row < objects[o].length; row++) {
            for (let col = 0; col < objects[o][row].length; col++) {
                // console.log('ya', col)
                if (objects[o][row][col]) {
                    // console.log(objects[o][row][col])
                    definitive[row][col] = objects[o][row][col];
                }
                // }
            }
        }
    }
    // this should only be 2d!!!!
    // console.log(definitive)
    return definitive;
}

let visualizeGraph = (objects: Target[][]) => {
    // for each object...

}


// alright, how do I add interject a new node into the graph here? 

let graphModifyToAddCollision = (input: Target[][]): Target[][] => {
    let output = input.map(i => i.map(j => j));
    // I'll just add a new node that has the frame tag I want.
    let relevantInput = [input[0][2], input[1][2]]
    let collision = new Collision(relevantInput, generateFlutterCenteredEffect(5, 3, [30, 30]), false);
    let collision2 = collision.clone();
    // let strVis = frameDisplay(collision.draw()); 
    // console.log(strVis);
    // console.log(draw2(collision.draw()))
    collision.frameId = 1;
    collision.effect = new Instantaneous(collision, collision2, EffectType.Complete);
    collision2.frameId = 2;
    // new object... how many frames? 
    output.push([collision, collision2]);


    return output;
}


let graphModifyToAddPathTrace = (input: Target[][]): Target[][] => {
    let output = input.map(i => i.map(j => j));
    // I'll just add a new node that has the frame tag I want.
    console.log("Ya!")
    console.log(input);

    let objIndex = 1;
    let startFrame = 0;
    let endFrame = 2;
    let pathStartTarget = input[objIndex][startFrame].clone();
    let pathEndTarget = input[objIndex][endFrame].clone();
    let effect = new UniformMove(pathStartTarget, pathEndTarget, EffectType.Complete);
    console.log(pathStartTarget)
    let path = new TracePath(pathStartTarget, pathEndTarget, EffectType.Complete, effect);
    pathStartTarget.effect = path;
    // let strVis = frameDisplay(collision.draw()); 
    // console.log(strVis);
    // console.log(draw2(collision.draw()))
    pathStartTarget.frameId = 1;
    pathEndTarget.frameId = 2;
    // new object... how many frames? 
    output.push([pathStartTarget]);
    console.log(pathStartTarget);


    return output;
}


// example file
// timing: [1,1,1,1,1,1,1,1,1,1,1,1,1]
// filepath: /animations/etc${i}.png 
// objects: [#ffffff background] [#facade golf]
// background 1 -> instantaneous -> background 12
// golf 2 ->* interpolate ->* golf 12 // means add interpolate to each step, transitive closure
// ball-person-collision: collision(golf 2, wall 2) 2 -> instantaneous -> checker(ball-person-collision 2) // name a new object
// ball-path: path(ball 2, ball 3, ball 4, ball 5) 
// what are the semantics of these??
// name a new object. create a new "circle" and its transition. 
// named object + frame tag indexes a specific target

// generateAnimationToGroupAction
export let parseToGroupAction = async (input: string, hardware?: HardwareInterface): Promise<HardwareInterface> => {
    // todo: it'd be more robust to search for the correct tag 
    let lines = input.split("\n");
    lines = lines.map(l => l.trim());

    console.log(lines.find(l => l.startsWith("timing:"))!.slice(7).trim())
    let timing = JSON.parse(lines.find(l => l.startsWith("timing:"))!.slice(7).trim());

    let filePathIndices = timing;
    if (!Array.isArray(timing)) {
        filePathIndices = timing["frames"];
        timing = timing["frames"].concat(timing["additional"]);
        console.log("adding extra timing", timing)
    }

    let filePath = lines.find(l => l.startsWith("filepath:"))!.slice(9).trim();
    // to get all filepaths...
    let inject = (str: string, n: string) => str.replace(/\${(.*?)}/g, n);
    let files = filePathIndices.map((t: number, i: number) => inject(filePath, `${i + 1}`));

    console.log("timing is...", timing, "filepathindices", filePathIndices);

    let objDecl = lines.find(l => l.startsWith("objects:"))!.slice(8).trim();
    // the rest are objects.
    let decls = parseObjDecls(objDecl);

    let remaining = lines.slice(3);
    let [width, height, graph] = await parseGraph(files, remaining, decls, timing);

    console.log("width and height are", width, height);

    if (hardware == undefined) {
        hardware = new FlipdotSimHardware([], i => [], [height, width]);
        (hardware as FlipdotSimHardware).flipDurationMS = 1;
    }
    

    console.log(graph);
    console.log("hejsdh")

    /// 

    let frames: GroupAction[] = generateAnimationToGroupAction(graph, timing, hardware)
    console.log(frames)
    hardware.compile(frames);
    return hardware;
}


let parser = async (input: string, flipless: boolean = false) => {
    // todo: it'd be more robust to search for the correct tag 
    let lines = input.split("\n");
    lines = lines.map(l => l.trim());

    console.log(lines.find(l => l.startsWith("timing:"))!.slice(7).trim())
    let timing = JSON.parse(lines.find(l => l.startsWith("timing:"))!.slice(7).trim());

    let filePathIndices = timing;
    if (!Array.isArray(timing)) {
        filePathIndices = timing["frames"];
        timing = timing["frames"].concat(timing["additional"]);
        console.log("adding extra timing", timing)
    }

    let filePath = lines.find(l => l.startsWith("filepath:"))!.slice(9).trim();
    // to get all filepaths...
    let inject = (str: string, n: string) => str.replace(/\${(.*?)}/g, n);
    let files = filePathIndices.map((t: number, i: number) => inject(filePath, `${i + 1}`));

    console.log("timing is...", timing, "filepathindices", filePathIndices);

    let objDecl = lines.find(l => l.startsWith("objects:"))!.slice(8).trim();
    // the rest are objects.
    let decls = parseObjDecls(objDecl);

    let remaining = lines.slice(3);
    let [width, height, graph] = await parseGraph(files, remaining, decls, timing);
    console.log(graph);
    console.log("hejsdh")

    /// 

    let frames: Colour[][][] = generateAnimation(graph, timing)

    // randomly add new timings...
    if (false) {
        frames = frames.reduce((acc: Colour[][][], f: Colour[][], i: number) => {
            acc.push(f);
            if (i % 2 == 0) {
                acc.push(f);
            }
            return acc;
        }, [])
    }


    // let frames: Colour[][][] = generateAnimation(res, [...Array(9)].map(_ => 3))
    frames.forEach(f => console.log(frameDisplay(f)));
    let indices: [number, Colour][][] = frameToIndices(frames, width);
    // console.log(width)
    // console.log(indices)    
    // indices.forEach(i => console.log(indicesDisplay(i, width, height)))

    let colourToDotFlipOption = (colour: Colour) => colour ? DotFlipOptions.Front : DotFlipOptions.Back;
    // how about generating the language? 
    let hardwareProg = indices.map(frame => new DotFlipFrame(frame.map(dot => new DotFlipInstruction(dot[0], colourToDotFlipOption(dot[1]))), 500));


    let indicesWithStates: [number, FlipDotState][][] = indices.map(frame => frame.map(([i, c]: [number, Colour]) => [i, new FlipDotState(c as boolean)] as [number, FlipDotState]));
    // console.log(indicesWithStates)
    let hardware = new SimulationHardware(width, height);
    if (flipless) {
        hardware.sim.numFramesRotating = 1;
    }
    if (false) {
        hardware.programSequence(indicesWithStates);
    } else {
        hardware.programSequenceFromLanguage(hardwareProg);
    }

    let programText = document.createElement("div")
    programText.innerHTML = input.replaceAll("\n", "<br>");
    programText.classList.add("code-snippet");
    document.getElementById("render")!.appendChild(programText)
}

let parseObjDecls = (input: string): Map<string, string> => {
    let colourToObjName: Map<string, string> = new Map();

    const regexp = /(#[\w]+)\s([\w-]+)/g;
    const matches = input.matchAll(regexp);

    for (const match of matches) {
        let colour = match[1];
        let name = match[2];
        colourToObjName.set(name, colour);
    }

    return colourToObjName
}

let parseGraph = async (files: string[], effects: string[], names: Map<string, string>, timings: number[]): Promise<[number, number, Target[][]]> => {
    // start by creating every declared objet.

    let parsedInstructions: [string, [[TargetString, number], string, [TargetString, number]][]][] = effects.map(line => parseInsts(line))

    let targets: Target[][] = [];
    let w, h: number;

    // take each frame and make objects out of it 
    let data = await getImages(files);
    let [width, height, rgbFrames] = data;
    w = width;
    h = height;

    let frames: string[][][] = [];
    // for frames... should I preprocess into colours?
    // because what I want is actually... to go by object, parse all frames for all objects.

    console.log(rgbFrames)
    for (let frame of rgbFrames) {
        let newFrame = [];
        for (let row of frame) {
            let newRow = [];
            for (let col of row) {
                newRow.push(rgb2Hex(...col));
            }
            newFrame.push(newRow);
        }
        console.log(newFrame)
        frames.push(newFrame);
    }

    // let's divide the instructions in two...
    let baseInstructions: [string, [[TargetString, number], string, [TargetString, number]][]][] = [];
    let derivedInstructions: [string, [[TargetString, number], string, [TargetString, number]][]][] = [];


    parsedInstructions.forEach(obj => {
        console.log(names)
        if ([...names.keys()].includes(obj[0])) {
            baseInstructions.push(obj);
        } else {
            console.log(obj)
            derivedInstructions.push(obj);
        }
    });

    console.log(baseInstructions);
    console.log(derivedInstructions);

    let namesToObjects: Map<string, Target[]> = new Map();

    for (let [obj, colour] of names) {
        let targets = [];
        for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
            let frame = frames[frameIdx];
            console.log(obj, colour)
            targets.push(new PixelArtTarget(frame.map(r => r.map(c => c == colour)), false));
            console.log(frameDisplay(frame.map(r => r.map(c => c == colour))))
        }

        namesToObjects.set(obj, targets);
    }

    for (let [obj, steps] of baseInstructions) {
        // okay great.
        // for each object, let me get all the frames first.
        let colour = names.get(obj);

        // now...
        let perColourFrames = [];
        let perFrameObjs: Map<number, Target> = new Map();
        console.log(frames)
        for (let frame of frames) {
            console.log(obj, colour)
            perColourFrames.push(frame.map(r => r.map(c => c == colour)));
            console.log(frameDisplay(frame.map(r => r.map(c => c == colour))))
        }


        console.log(steps)
        for (let step of steps) {
            console.log("see n2o", namesToObjects)
            // wait, do I need to use namesToObjects here...?
            let [start, effect, end] = step;
            let [startObj, startFrame] = start;
            let [endObj, endFrame] = end;
            if (typeof startObj === 'string' && typeof endObj == "string") { // d\o I nd to check endObj
                // I'll just make an object that's a frame

                // TODO: just steal from nametoobjects 
                let obj = (perFrameObjs.has(startFrame)) ? perFrameObjs.get(startFrame)! : namesToObjects.get(startObj)![startFrame];
                let eo = (perFrameObjs.has(endFrame)) ? perFrameObjs.get(endFrame)! : namesToObjects.get(endObj)![endFrame];

                // console.log(frameDisplay(obj.draw()))

                if (effect == "path") {
                    // don't modify the start and end stuff
                    console.log("n2o 3", namesToObjects)
                    let newTarget = namesToObjects.get(startObj)!.find(o => o.frameId == startFrame)!.clone();
                    // thi smight not be true... 
                    let newEndTarget = namesToObjects.get(endObj as string)!.find(o => o.frameId == endFrame)!.clone();


                    if (!newTarget || newTarget.effect == undefined) {
                        console.log(newTarget);
                        console.log(namesToObjects)
                        throw new Error("Cannot use derivative effect before original effect is defined")
                    }

                    let t = new TracePath(newTarget, newEndTarget, EffectType.Complete, newTarget.effect);
                    newTarget.effect = t;
                    newTarget.debugTag = startObj + ":" + effect
                    console.log("tgts", targets);
                    targets.push([newTarget]);

                } else {

                    let t = effect == "instantaneous" ? new Instantaneous(obj, eo, EffectType.Complete) :
                        effect == "wipe" ? new Wipe(obj, eo, EffectType.Complete, WipeDirection.TTB) :
                            effect == "grow" ? new GrowWipe(obj, eo, EffectType.Complete, [Math.round(width / 2), Math.round(height / 2)]) :
                                effect == "move" ? new UniformMove(obj, eo, EffectType.Complete) :
                                effect == "motion" ? new MotionFlipTo(obj, eo, EffectType.Complete) :
                                effect == "sparkle" ? new Sparkle(obj, eo, EffectType.Complete) : 
                                    new DrawingHeadWipe(obj, eo, EffectType.Complete, [Math.round(width / 2), Math.round(height / 2)]);



                    obj.effect = t;

                    if (!perFrameObjs.has(startFrame)) {
                        obj.frameId = startFrame;
                        obj.debugTag = startObj + ":" + effect
                        perFrameObjs.set(startFrame, obj);
                        console.log("setting shape!!!!", obj);
                    }

                    if (!perFrameObjs.has(endFrame)) {
                        eo.frameId = endFrame;
                        eo.debugTag = endObj + ":" + effect
                        perFrameObjs.set(endFrame, eo);
                    }

                    if (effect == "move") {
                        console.log("abcd", step);
                        console.log("abcd. from:" + t.from!.frameId);
                        console.log("abcd. to:" + t.to!.frameId);
                    }
                }

            } else {
                // it's more complicated... we will deal with it after!
                throw new Error("not in this case");
            }

        }
        console.log("tgts", targets);

        // namesToObjects.set(obj, [...perFrameObjs.values()]);
        // console.log("n2o, 2, ", namesToObjects)
        // if ([...perFrameObjs].length != 0) {
        //     targets.push([...perFrameObjs.values()]);
        // }

        console.log("n2o, 2, ", namesToObjects)
        if ([...perFrameObjs].length != 0) {
            // swap this aroudn... 
            namesToObjects.set(obj, [...perFrameObjs.values()]);
            targets.push([...perFrameObjs.values()]);
        }

    }

    for (let [obj, steps] of derivedInstructions) {
        console.log("derived: ", obj, steps)
        let perFrameObjs: Map<number, Target> = new Map();

        for (let step of steps) {
            let [start, effect, end] = step;
            let [startObj, startFrame] = start;
            let [endObj, endFrame] = end;
            // basically... 
            // I need to 

            console.log(step)
            let startTarget, endTarget;
            if (typeof startObj === 'string') {
                // this is just a normal selector.
                startTarget = namesToObjects.get(startObj)!.find(o => o.frameId == startFrame)!;
                console.log(namesToObjects.get(startObj)!)
                startTarget.debugTag = startObj;
            } else {
                // it's constructed.
                if (startObj[0] == "collision") {
                    let args = startObj[1].map(([n, f]) => namesToObjects.get(n)![f]);
                    startTarget = new Collision(args, generateFlutterCenteredEffect(collisionStats[0], collisionStats[1], [width, height]), false);
                } else if (startObj[0] == "checkerboard") {
                    let arg = namesToObjects.get(startObj[1][0][0] as string)![startObj[1][0][1] as number];
                    console.log(arg);

                    startTarget = new Checkerboard(arg, startFrame % 2 == 1);
                    startTarget.debugTag = "checkerboard-start " + startFrame
                    console.log("checkerboard start")
                } else if (startObj[0] == "noise") {
                    let arg = namesToObjects.get(startObj[1][0][0] as string)![startObj[1][0][1] as number];
                    console.log("making noise!", arg, timings.length);
                    // should be customizable lol 
                    startTarget = new Noise(arg, 1 - (startFrame / (timings.length)));
                    startTarget.debugTag = `noise(${arg.debugTag})`

                } else if (startObj[0] == "noop") { // TODO: just a bandaid solution here to not being able to go from derivedobject to baseobject in instr line
                    startTarget = namesToObjects.get(startObj[1][0][0])![startObj[1][0][1]];
                    startTarget.debugTag = `noop(${startTarget.debugTag})`

                }
            }

            if (typeof endObj === 'string') {
                // this is just a normal selector.
                endTarget = namesToObjects.get(endObj)!.find(o => o.frameId == endFrame)!;
                endTarget.debugTag = endObj;
            } else {
                if (endObj[0] == "collision") {
                    let args = endObj[1].map(([n, f]) => namesToObjects.get(n)![f]);
                    endTarget = new Collision(args, generateFlutterCenteredEffect(collisionStats[0], collisionStats[1], [width, height]), false);
                } else if (endObj[0] == "checkerboard") {
                    let arg = namesToObjects.get(endObj[1][0][0] as string)![endObj[1][0][1] as number];
                    console.log(arg);

                    endTarget = new Checkerboard(arg, endFrame % 2 == 1);
                    endTarget.debugTag = "checkerboard-end " + endFrame
                    console.log("checkerboard end")
                } else if (endObj[0] == "noise") {
                    let arg = namesToObjects.get(startObj[1][0][0] as string)![endObj[1][0][1] as number];
                    console.log("making noise!", arg, timings.length);
                    // should be customizable lol 
                    // let's include the startarg?
                    endTarget = new Noise(arg, 1 - (endFrame / timings.length), startTarget);
                    endTarget.debugTag = `noise(${arg.debugTag})`

                } else if (endObj[0] == "noop") {
                    endTarget = namesToObjects.get(startObj[1][0][0])![endObj[1][0][1]];
                    endTarget.debugTag = `noop(${endTarget.debugTag})`
                }
            }


            // what to do if this is a temporal transition?
            if (effect == "path") {
                // don't modify the start and end stuff
                if (!startTarget || startTarget.effect == undefined) {
                    console.log(startTarget);
                    console.log(namesToObjects)
                    throw new Error("Cannot use derivative effect before original effect is defined")
                }
                let newTarget = startTarget.clone();
                let newEndTarget = endTarget!.clone();

                let t = new TracePath(newTarget, newEndTarget, EffectType.Complete, startTarget.effect);
                newTarget.effect = t;
                newTarget.debugTag = startObj + ":" + effect
                perFrameObjs.set(endFrame, newEndTarget!);
                perFrameObjs.set(startFrame, newTarget!);

            } else {

                let t = effect == "instantaneous" ? new Instantaneous(startTarget, endTarget, EffectType.Complete) :
                    effect == "wipe" ? new Wipe(startTarget, endTarget, EffectType.Complete, WipeDirection.TTB) :
                        effect == "grow" ? new GrowWipe(startTarget, endTarget, EffectType.Complete, [Math.round(width / 2), Math.round(height / 2)]) :
                            effect == "move" ? new UniformMove(startTarget, endTarget, EffectType.Complete) :
                            effect == "motion" ? new MotionFlipTo(startTarget, endTarget, EffectType.Complete) :
                            effect == "sparkle" ? new Sparkle(startTarget, endTarget, EffectType.Complete) : 
                                new DrawingHeadWipe(startTarget, endTarget, EffectType.Complete, [Math.round(width / 2), Math.round(height / 2)])

                // the transition might have arguments.
                // but don't we actually use the input to find that? 
                // like, maybe the input is like: golfballpath: golfball 1 -> path -> golfball 10
                // do I need to clone the start and end targets?



                startTarget!.effect = t;
                console.log("setting ", startTarget, " transition to ", t)

                // I see... why shouldn't I rewrite it though? 
                // yeah... what actually are the semantics?
                // basically, this needs to have the trasition updated at the very least 
                if (!perFrameObjs.has(startFrame)) {
                    startTarget!.frameId = startFrame;
                    startTarget!.debugTag = startObj + ":" + effect;
                    console.log("setting startframe ", startFrame)
                    perFrameObjs.set(startFrame, startTarget!);
                } else {
                    perFrameObjs.get(startFrame)!.effect = t;
                }

                if (!perFrameObjs.has(endFrame)) {
                    endTarget!.frameId = endFrame;
                    endTarget!.debugTag = endObj + ":" + effect;
                    console.log("setting enframe", endFrame)
                    perFrameObjs.set(endFrame, endTarget!);
                }


                if (effect == "move") {
                    console.log(step);
                    console.log("abcd. from:" + t.from!.frameId);
                    console.log("abcd. to:" + t.to!.frameId);
                }
            }
        }

        // is it right to also save this line?
        console.log("n2o, 2, ", namesToObjects)
        if ([...perFrameObjs].length != 0) {
            namesToObjects.set(obj, [...perFrameObjs.values()]);
            targets.push([...perFrameObjs.values()]);
        }

        // targets.push([...perFrameObjs.values()]);

    }

    return [w!, h!, targets];

    // parseImagesIntoFrames(files).then(data => {
    //     // parseImagesIntoFrames([1, 2, 3].map(i => `/animations/slide-normal${i + 1}.png`)).then(data => {
    //     let res = data[0];
    //     let width = data[1];
    //     let height = data[2];
    //     let colours = data[3];

    //     // now, res is a bunch of targets.
    //     // except instead of instantaneous transitions, I want to do something else.
    // }

}

// parseObjDecls("[#ffffff background] [#facade golf-ball]")


let parseSelector = (input: string): [string, number] => {
    let pieces = input.trim().split(" ");
    let name = pieces[0];
    let frameNum = pieces[1];
    return [name, parseInt(frameNum)];
}
// 
// Selector ::= Target Frame
// Target ::= object | DerivedTarget | TemporalTarget
// EffectType ::= instantaneous | linear | ... 
// DerivedTarget ::= collision(Selector, Selector) 
// TemporalTarget ::= path(Selector*)
// ArrowType ::= -> | ->*
// Effect ::= ArrowType EffectType ArrowType 
// Lineage ::= Selector | Selector Effect Lineage // single selector would be something that goes away
type TargetString = string | [string, [string, number][]]
let parseInsts = (line: string): [string, [[TargetString, number], string, [TargetString, number]][]] => {
    // first thing is the selector...
    line = line.trim();

    if (line.length == 0 || line.startsWith("//")) {
        return ["", []]
    }

    let objName: string = "";
    let steps: [[TargetString, number], string, [TargetString, number]][] = [];



    let fromStep: number = 0;
    let fromTarget: TargetString = "";
    let effect: string = "";
    let transitive = false;

    let simpleSelector = /^([\w]+\s[\d]+)/g;
    // group 1 is name, subsequent group are targets
    let constructorSelector = /^([\w-]+)\((([\w-]+[\s]*[\d],?[\s]*)+)\)[\s]*([\d]+)/g;
    // second group is name and arguments (if any)
    let effectTypeSelector = /^([\s]*->\*?[\s]*)([\w\d()]+)([\s]*->\*?[\s]*)/g;
    // just the tag 
    let newObjectTagSelector = /^([\w\d-]+):/g;

    let count = 0;
    while ((line.length != 0 || !line.startsWith("//")) && count <= 50) {
        console.log(count)
        // while (count <= 10) {
        let a = simpleSelector.exec(line);
        let b = constructorSelector.exec(line);
        let c = effectTypeSelector.exec(line);
        let d = newObjectTagSelector.exec(line);
        if (a) {
            console.log("match simple", a[0])
            let [name, frameNum] = parseSelector(a[1]);
            line = line.slice(a[0].length);

            if (objName.length == 0) {
                objName = name;
            }

            if (fromTarget.length == 0) {
                fromTarget = name;
                fromStep = frameNum;
            } else {
                // this was the end...

                if (effect.length == 0) {
                    console.log(effect);
                    console.log(fromTarget);
                    console.log(fromStep)
                    throw new Error("??");

                }

                // but also... what if it's transitive?
                if (transitive) {
                    console.log("transitive!", fromStep, frameNum)
                    // I should loop around
                    for (let i = fromStep; i < frameNum; i++) {
                        let step: [[TargetString, number], string, [TargetString, number]] = [[fromTarget, fromStep], effect, [name, fromStep + 1]];
                        steps.push(step);
                        // objectsPerFrame.push(name);

                        fromStep = i;
                        console.log(fromStep, frameNum)
                    }
                }



                let step: [[TargetString, number], string, [TargetString, number]] = [[fromTarget, fromStep], effect, [name, frameNum]];
                steps.push(step);
                // objectsPerFrame.push(name);

                fromStep = frameNum;
                fromTarget = name;
                effect = "";
            }

        } else if (b) {
            console.log("match construcotr", b[0], "- current transition ", effect)

            let constructorName = b[1];
            console.log(b.length);
            // these selectors can't be constructors on their own 
            console.log
            let argSelectors = b[2].split(",").map(l => parseSelector(l));
            let frameNum = parseInt(b[b.length - 1]);
            line = line.slice(b[0].length);

            console.log(constructorName, argSelectors, frameNum, effect)

            // just copied from above unfortunately....

            if (fromTarget.length == 0) {
                fromTarget = [constructorName, argSelectors];
                fromStep = frameNum;
            } else {
                // this was the end...
                if (effect.length == 0) {
                    throw new Error("??");
                }

                // but also... what if it's transitive?
                if (transitive) {
                    // I should loop around
                    // also behaviour is undefined if it's not a name-based selector here...
                    for (let i = fromStep; i < frameNum - 1; i++) {
                        let step: [[TargetString, number], string, [TargetString, number]] = [[fromTarget, i], effect, [constructorName, i + 1]];
                        steps.push(step);
                        // objectsPerFrame.push(name);

                        fromStep = i;
                    }
                }

                let step: [[TargetString, number], string, [TargetString, number]] =
                    [[fromTarget, fromStep], effect, [[constructorName, argSelectors], frameNum]];
                steps.push(step);
                // objectsPerFrame.push([constructorName, argSelectors.map(s => parseSelector(s))]);

                fromStep = frameNum;
                fromTarget = [constructorName, argSelectors];
                effect = "";
            }

        } else if (c) {
            console.log("match transition", c[0])
            // let arguments = match;
            // console.log(c)
            // console.log(name)
            console.log(c[0])
            if (c[0].includes("->*")) { // ie it's transitive
                transitive = true;
            } else {
                transitive = false;
            }

            let effectType = c[2];
            line = line.slice(c[0].length);

            effect = effectType;


        } else if (d) {
            console.log("match newobj", d[0])
            line = line.slice(d[0].length);

            objName = d[1];
            console.log(line)
        } else if (line.startsWith("//")) {
            line = "";
        }

        console.log(line)
        line = line.trim();
        count++;
    }

    console.log(objName);
    console.log(steps);

    return [objName, steps];
}





let testStr = `background 1 -> instantaneous -> background 12
golf 2 ->* interpolate ->* golf 12 // means add interpolate to each step, transitive closure
ball-person-collision: collision(golf 2, wall 2) 2 -> instantaneous -> checker(ball-person-collision 2) 3 // name a new object
ball-path: path(ball 2, ball 3, ball 4, ball 5) 1 -> instantaneous -> ball 2`

// testStr.split("\n").slice(2).map(l => parseInsts(l));
// testStr.split("\n").map(l => parseInsts(l));

let testStr2 = "timing: [1,1,1,1]\nfilepath: /animations/golf-coloured${i}.png \nobjects: [#000000 golfstick] [#5fcde4 golfer]\n\
golfstick 0 -> instantaneous -> golfstick 1 -> instantaneous -> golfstick 2 -> instantaneous -> golfstick 3\n\
golfer 0 -> instantaneous -> golfer 1 -> instantaneous -> golfer 2 -> instantaneous -> golfer 3"






console.log("hi")
// let [imagePath, numKeyframes] = [(i: number) => `/animations/golf-coloured${i + 1}.png`, 9];
// let [imagePath, numKeyframes] = [(i: number) => `/animations/basic-2c${i+1}.png`, 3];
// let [imagePath, numKeyframes] = [(i: number) => `/animations/golf${i+1}.png`, 9];
// let [imagePath, numKeyframes] = [(i: number) => `/animations/slide-normal${i+1}.png`, 3];
let [imagePath, numKeyframes] = [(i: number) => `/animations/slide-2obj${i + 1}.png`, 3];
// let [imagePath, numKeyframes] = [(i: number) => `/animations/basic${i+1}.png`, 6];
let tweenFrameNumber = 10;

if (false)
    // parseImagesIntoFrames([1,2,3,4,5,6,7,8,9].map(i => `/animations/golf-coloured${i}.png`)).then(data => {
    parseImagesIntoFrames([...new Array(numKeyframes)].map((_, i) => imagePath(i))).then(data => {
        // parseImagesIntoFrames([1, 2, 3].map(i => `/animations/slide-normal${i + 1}.png`)).then(data => {
        let res = data[0];
        let width = data[1];
        let height = data[2];
        console.log(res)
        console.log(width, height);
        // console.log(res.map(f => f.map(o => o.frameId)))
        // let frames = generateAnimation(res, [...Array(3)].map(_ => 4))

        // todo: I want to add a PathTrace here 
        // duplicate two of the objects, then plug in a transition that uses their transition 
        res = graphModifyToAddPathTrace(res);
        // res = graphModifyToAddCollision(res);
        console.log(res)

        // console.log(frames)
        console.log(res.map(r => r.map(i => i.position)))

        // res = [res[2]]
        console.log(res)
        console.log(res[2])
        console.log(res.map((perObj, o) => perObj.map((perFrame, f) => { console.log(`obj ${o}, frame ${f}`); console.log(frameDisplay(perFrame.draw())) })))
        console.log(res.map((perObj, o) => perObj.map((perFrame, f) => { console.log(`!!!obj ${o}, frame ${f}`); console.log(perFrame.draw()) })))
        let frames: Colour[][][] = generateAnimation(res, [...Array(numKeyframes - 1)].map(_ => tweenFrameNumber))
        // let frames: Colour[][][] = generateAnimation(res, [...Array(9)].map(_ => 3))
        frames.forEach(f => console.log(frameDisplay(f)));
        // maybe I just duplicate?
        frames.push(frames[frames.length - 1]);
        let indices: [number, Colour][][] = frameToIndices(frames, width);
        indices.forEach(i => console.log(indicesDisplay(i, width, height)))
        let indicesWithStates: [number, FlipDotState][][] = indices.map(frame => frame.map(([i, c]: [number, Colour]) => [i, new FlipDotState(c as boolean)] as [number, FlipDotState]));
        // console.log(indicesWithStates)
        let hardware = new SimulationHardware(width, height);
        hardware.programSequence(indicesWithStates);


        console.log(allCollisionPoints([[[true, false], [true, false]], [[false, true], [false, true]]], false));

    })









// front 32
// front 64
// front 57
// pause 100


/*
let noiseEmergeExample = "timing: {\"frames\": [1,2], \"additional\": [2]}\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] [#ffffff background]\n\
noop(background 0) 0 -> noise(background 1) 1 -> noop(background 0) 2\n\
noop(rectangle 0) 0 -> instantaneous -> noise(rectangle 1) 1 -> instantaneous -> noise(rectangle 1) 2 -> instantaneous -> noop(rectangle 1) 3";
parser(noiseEmergeExample);


// randomly agitate 
let noiseStepsExample = "timing: {\"frames\": [1,1], \"additional\":[1,1,1]}\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] [#ffffff background]\n\
noise(rectangle 1) 0 -> instantaneous -> noise(rectangle 1) 1 -> instantaneous -> noise(rectangle 1) 2 -> instantaneous -> noise(rectangle 1) 3 -> instantaneous -> noop(rectangle 1) 4";
parser(noiseStepsExample);
*/


/*

let golfPathExample = "timing: [1,1,1,1,3,4,4,4,4]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 8\n\
golfer 0 ->* instantaneous ->* golfer 8\n\
ball 4 ->* move ->* ball 8\n\
ball 4 ->* path -> ball 8"
// path1: ball 5 -> path -> ball 6\n\
// path2: path1 6 -> path -> ball 7\n\"
parser(golfPathExample);

*/

/*

let testStr3 = "timing: [1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 8\n\
golfer 0 ->* instantaneous ->* golfer 8\n\
ball 0 ->* instantaneous ->* ball 8\n\
collision: collision(ball 4, golfstick 4) 3 -> instantaneous -> collision(ball 4, golfstick 4) 4" // should be 4 and 5 rather than 3 and 4
parser(testStr3);


let testStr4 = "timing: [1,1,1,1,1,1,1,1]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 7\n\
golfer 0 ->* instantaneous ->* golfer 7\n\
ball 0 ->* instantaneous ->* ball 7"
parser(testStr4);

let wipeExample = "timing: [15,2]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
rectangle 0 -> wipe -> rectangle 1";
parser(wipeExample);
// parser(wipeExample, true);

let flipExample = "timing: [15,2]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
rectangle 0 -> instantaneous -> rectangle 1";
parser(flipExample);

let growExample = "timing: [15,2]\n\
filepath: /animations/e${i}.png \n\
objects: [#000000 rectangle] \n\
rectangle 0 -> grow -> rectangle 1";
// parser(growExample);
// parser(growExample, true);



let headExample = "timing: [30,2]\n\
filepath: /animations/e${i}.png \n\
objects: [#000000 rectangle] \n\
rectangle 0 -> drawingHead -> rectangle 1";
// parser(headExample);

let pathExample =  "timing: [4,4,4,4]\n\
filepath: /animations/slide-2obj${i}.png \n\
objects: [#000000 wall] [#d77bba rectangle] \n\
wall 0 ->* instantaneous ->* wall 3\n\
rectangle 0 ->* move ->* rectangle 3\n\
rectangle 0 ->* path ->* rectangle 3"
// parser(pathExample);

let golfPathExample = "timing: [4,4,4,4,4,4,4,4,4]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 8\n\
golfer 0 ->* instantaneous ->* golfer 8\n\
ball 4 ->* move ->* ball 8\n\
ball 4 -> path -> ball 5\n\
ball 4 -> path -> ball 6\n\
ball 4 -> path -> ball 7\n\
ball 4 -> path -> ball 8"
// ball 4 -> path -> ball 5 -> path -> ball 6 -> path -> ball 7 -> path -> ball 8" // should be 4 and 5 rather than 3 and 4
parser(golfPathExample);



let goflMoveExample = "timing: [4,4,4,4,4,4,4,4,4]\n\
filepath: /animations/golf-collide${i}.png \n\
objects: [#000000 golfstick] [#5fcde4 golfer] [#5b6ee1 ball] \n\
golfstick 0 ->* instantaneous ->* golfstick 8\n\
golfer 0 ->* instantaneous ->* golfer 8\n\
ball 4 ->* move ->* ball 8"
parser(goflMoveExample);

// what about temporal derivative objects? 
// tracepath(name f1, name2 f2) and that should come later... or at least let's assume it's declared later



let checkerboardExample = "timing: [1,1]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
checkerboard(rectangle 1) 0 -> instantaneous -> checkerboard(rectangle 1) 1";
parser(checkerboardExample);
// parser(wipeExample, true);


let noiseEmergeExample = "timing: [1,1]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
noop(rectangle 0) 0 -> instantaneous -> noise(rectangle 1) 1";
// parser(noiseEmergeExample);


let noiseStepsExample = "timing: {\"frames\": [1,1], \"additional\":[1,1,1]}\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
noop(rectangle 0) 0 -> instantaneous -> noise(rectangle 1) 1 -> instantaneous -> noise(rectangle 1) 2 -> instantaneous -> noise(rectangle 1) 3 -> instantaneous -> noise(rectangle 1) 4";
parser(noiseStepsExample);

let checkerboardAppearBgExample = "timing: [3,3]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] [#ffffff background]\n\
checkerboard(background 0) 0 -> instantaneous -> checkerboard(background 1) 1 -> instantaneous -> checkerboard(background 0) 1\n\
checkerboard(rectangle 0) 0 -> instantaneous -> checkerboard(rectangle 1) 1 -> instantaneous -> noop(rectangle 1) 1 ";
parser(checkerboardAppearBgExample);

let checkerboardAppearExample = "timing: [2,2]\n\
filepath: /animations/wipe${i}.png \n\
objects: [#000000 rectangle] \n\
noop(rectangle 0) 0 -> instantaneous -> checkerboard(rectangle 1) 0 -> instantaneous -> noop(rectangle 1) 2";
parser(checkerboardAppearExample);


collisionStats = [10,2] // I need to make this configurable to make a bigger collision
let fishExample = "timing: [1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/fish${i}.png \n\
objects: [#5b6ee1 water] [#df7126 fish] \n\
fish 0 ->* instantaneous ->* fish 9\n\
checkerboard(water 0) 0 -> instantaneous -> checkerboard(water 1) 1 -> instantaneous -> checkerboard(water 2) 2 -> instantaneous -> checkerboard(water 3) 3 -> instantaneous -> checkerboard(water 4) 4  -> instantaneous -> checkerboard(water 5) 5 -> instantaneous -> checkerboard(water 6) 6 -> instantaneous -> checkerboard(water 7) 7  -> instantaneous -> checkerboard(water 8) 8 -> instantaneous -> checkerboard(water 9) 9"
// collision: collision(water 5, fish 5) 5 -> instantaneous -> collision(water 5, fish 5) 6";
parser(fishExample);

let fishSimpleExample = "timing: [1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/fish${i}.png \n\
objects: [#5b6ee1 water] [#df7126 fish] \n\
fish 0 ->* instantaneous ->* fish 9\n\
water 0 ->* instantaneous ->* water 9"
// collision: collision(water 5, fish 5) 5 -> instantaneous -> collision(water 5, fish 5) 6";
parser(fishSimpleExample);


let teapotExample = "timing: [1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/teapot${i}.png \n\
objects: [#000000 teapot] \n\
teapot 0 ->* instantaneous ->* teapot 9"
// parser(teapotExample);

// [2,2,2,2,2,2,2,2,2,2,2,2,2,2]
let stelaeExample = "timing: [1,1,1,1,1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/stelae${i}.png \n\
objects: [#000000 eyes] [#5b6ee1 face] [#ac3232 eyebrow]\n\
face 0 ->* instantaneous ->* face 13\n\
eyes 0 ->* wipe ->* eyes 13\n\
eyebrow 0 ->* instantaneous ->* eyebrow 13"
parser(stelaeExample);

let stelaeSkipExample = "timing: [2,2,2,2,2,2,2]\n\
filepath: /animations/stelae${i}.png \n\
objects: [#000000 eyes] [#5b6ee1 face] [#ac3232 eyebrow]\n\
face 0 -> instantaneous -> face 6\n\
eyes 0 -> wipe -> eyes 6\n\
eyebrow 0 -> instantaneous -> eyebrow 6"
parser(stelaeSkipExample);


let fireworksExample = "timing: [1,1,1,1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/firework${i}.png \n\
objects: [#000000 bit]\n\
bit 0 ->* instantaneous ->* bit 12"
parser(fireworksExample);


let footballExample = "timing: [1,1,1,1,1,1,1,1,1,1]\n\
filepath: /animations/football${i}.png \n\
objects: [#000000 bit]\n\
bit 0 ->* instantaneous ->* bit 9"
parser(footballExample);

let dripWhiteExample = "timing: [2,2,2,2,2,2,2]\n\
filepath: /animations/drip-white${i}.png \n\
objects: [#5fcde4 drip]\n\
drip 0 ->* instantaneous ->* drip 6"
parser(dripWhiteExample);

let dripBlackExample = "timing: [2,2,2,2,2,2,2]\n\
filepath: /animations/drip-black${i}.png \n\
objects: [#99e550 drip]\n\
drip 0 ->* instantaneous ->* drip 6"
parser(dripBlackExample);


*/