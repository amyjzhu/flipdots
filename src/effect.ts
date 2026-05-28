import { HardwareInterface, GroupAction } from "./hardware";
import { Merged, Moved, PixelArtTarget, Target, toWindows } from "./language2";
import { GrowFromCentre, BottomUp, GrowAlongContour, AllAtOnce } from "./order";
import { FlipTransition, KeepFlippingTransition, OffsetFlipImage, OneByOneKeepFlipping, SnapTransition, StochasticTransition, WaveTransition } from "./transitions";
import { inBounds } from "./util";

export enum EffectType {
    Complete,
    Disappearing,
    Appearing,
    Unspecified
}
// right, it's not that transitions take time, it;s that keyframes have time between them
export interface Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;
    generateDisappearingFrames(numFrames: number): Target[];
    generateAppearingFrames(numFrames: number): Target[];
    generateCompleteFrames(numFrames: number): Target[];
    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[];
}

export class UniformMove implements Effect {
    from: Target | undefined;
    to: Target | undefined;
    type: EffectType;

    constructor(from: Target | undefined, to: Target | undefined, type: EffectType) {
        this.from = from;
        this.to = to;
        this.type = type;
    }

    generateGroupActions(time: number, flips: number): (h: HardwareInterface) => GroupAction[] {
        let frames = this.generateCompleteFrames(flips) // not sure how to translate this exactly...
        
        console.log(frames, flips)
        let allFrames: Target[] = [this.from!, ...frames];

        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);

        return h => {
            // why was this 3?
            let perStep = 2;
            let actions = windowFrames.map(w => new FlipTransition().generateGroupActions(w[0], w[1], perStep, h)).flat();
            for (let action of actions) {
                action.tPlus = action.tPlus + perStep;
            }
            return actions;
        };
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

        console.log(numFrames)

        let endAt = this.to.position;
        let startAt = this.from.position;

        let xInc = (endAt[0] - startAt[0]) / numFrames;
        let yInc = (endAt[1] - startAt[1]) / numFrames;

        let newObjects = [];
        for (let i = 0; i < numFrames; i++) {

            // drawFrame(rectSize, [, ], hardware);


            let x = Math.round(startAt[0] + xInc * i);
            let y = Math.round(startAt[1] + yInc * i);

            // let obj = this.from.clone();
            // console.log([x, y])

            // obj.position = [x, y];

            let obj = new Moved(this.from, [Math.round(xInc * i), Math.round(yInc * i)])
            newObjects.push(obj);

        }

        return newObjects;
    }

}


export class CtsFlipEffect implements Effect {
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
        

        // console.log(allFrames)
        console.log(frames)
        let windowFrames: Target[][] = toWindows<Target>(frames, 2);
        // let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);

        // return h => windowFrames.map(w => new KeepFlippingTransition().generateGroupActions(w[0], w[1], time, h)).flat();
        
        return h => windowFrames.map(w => new FlipTransition().generateGroupActions(w[0], w[1], time, h)).flat();

    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        return [this.from!, this.to!]
    }

}


export class FlipEffect implements Effect {
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

        return h => windowFrames.map(w => new OffsetFlipImage().generateGroupActions(w[0], w[1], time, h)).flat();
        // return h => windowFrames.map(w => new FlipTransition().generateGroupActions(w[0], w[1], time, h)).flat();

    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        return [this.from!, this.to!]
    }

}


interface DerivedEffect extends Effect {

}

export class TracePath implements DerivedEffect {
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
        let frames = this.generateCompleteFrames(flips) // not sure how to translate this exactly...
        
        let allFrames: Target[] = [this.from!, ...frames];

        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);

        return h => {
            let actions = windowFrames.map(w => new FlipTransition().generateGroupActions(w[0], w[1], time / (flips-1), h)).flat();
            for (let action of actions) {
                action.tPlus = action.tPlus + time + 1;
            }
            return actions;
        };
    }

    generateDisappearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateAppearingFrames(numFrames: number): Target[] {
        throw new Error("Method not implemented.");
    }
    generateCompleteFrames(numFrames: number): Target[] {
        // how do I use the other transition? well, I just generate the frames first
        // WHY only one frame?
        console.log(this.effect)
        let referenceFrames = this.effect.generateCompleteFrames(numFrames);

        // for path, I actually just need to build up all the frames I've seen so far...
        // but at some point we should also interpolate 
        // also right now I don't think transitions are named

        /*
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
        }*/

        
        let allFrames: Target[] = [];

        console.log(referenceFrames)
        for (let i = 1; i <= numFrames; i++) {
            allFrames.push(new Merged(referenceFrames.slice(0, i)))
        }
        return allFrames;
    }

}



export class MotionFlipTo implements Effect {
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

export class Instantaneous implements Effect {
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

export enum WipeDirection {
    LTR,
    RTL,
    TTB,
    BTT,
}



export class Sparkle implements Effect {
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

        // // find the centre of the to
        // let centre = this.to?.draw();
        // let idxes = centre?.map((r, i) => r.map((c, j) => {
        //     if (c) {
        //         return [i, j]
        //     } else {
        //         return undefined;
        //     }
        // })).flat().filter(i => i != undefined);

        // if (idxes.length == 0) {
        //     idxes = [this.from.position];
        // }

        // let midPointX = Math.round((idxes.map(x => x[0]).reduce((acc, x) => acc + x, 0)) / idxes.length);
        // let midPointY = Math.round((idxes.map(x => x[1]).reduce((acc, x) => acc + x, 0)) / idxes.length);



        return h => {
            // it's okay since I know what kind of thing this is for...
            // let dists = idxes.map(idx => Math.sqrt((midPointX - idx[0]) ** 2 + (midPointY - idx[1]) ** 2));
            // let max = dists.reduce((max: [number, number], dist: number, i: number) => dist > max[1] ? [i, dist] as [number, number] : max, [0, dists[0]]);
            // let closestUnit = h.coordToIndex(idxes[max[0]] as [number, number]);

            // return new StochasticTransition(closestUnit).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            // return new WaveTransition(new GrowFromCentre(idxes[max[0]] as [number, number])).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            // TODO: this point needs to consider that this is th global max and we work with a mask later 
            // TODO: this would be a cool way to do the density of the shape, but...
            // return new StochasticTransition(new GrowFromCentre(idxes[max[0]] as [number, number])).generateGroupActions(frames[0], frames[frames.length-1], time, h);
            return new StochasticTransition(new GrowFromCentre((w, h) => [Math.round(w / 2), Math.round(h / 2)] as [number, number])).generateGroupActions(frames[0], frames[frames.length - 1], time, h);
        }
    }

}

// let's try to re-express these effects in terms of transitions
// and also build effects on top of effects 
// there are like two types of effects really...
// some effects 
export class RotateReveal implements Effect {

}
 

// what's something else that could use it 

export class Wipe implements Effect {
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
        let allFrames: Target[] = [this.from!, this.to!];
        let windowFrames: Target[][] = toWindows<Target>(allFrames, 2);
        
        // take all the intermediate frames and run the transition
        // we should also show some examples of mixing and matching the original transitions
        // like reusing the transitions for different effects
        return h => {
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



export class DrawingHeadWipe implements Effect {
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
        let allFrames: Target[] = [this.from!, this.to!];

        return h => new WaveTransition(new GrowAlongContour([0,0])).generateGroupActions(allFrames[0], allFrames[allFrames.length-1], time, h);
        
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
}

export class OldDrawingHeadWipe implements Effect {
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


export class GrowWipe implements Effect {
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
