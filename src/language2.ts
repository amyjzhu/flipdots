
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
// we have something called Transition which takes two frames and a time length and the transitions for each object?
// or we have something called Universe which takes the whole universe...? at each time point? 
// animation...

import { Colour, DColour, FlipDotState, SimulationHardware } from "./language";



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


interface Target {
    position: [number, number];
    draw(): Colour[][];
    clone(): Target;

    frameId: FrameId | undefined;
    transition: Transition | undefined;
}

interface DerivedTarget extends Target {
    parentTargets: Target[];
}

interface DrawableTarget extends Target {
    shape: Colour[][];
}

class PixelArtTarget implements DrawableTarget {
    position: [number, number];
    // this specification of shape should be the full size
    // ah, but colour can't be colourless though... 
    shape: Colour[][];
    // the problem is, I don't know which colour is the default...
    extractedShape: Colour[][];
    defaultColour: Colour;

    frameId: number | undefined;
    transition: Transition | undefined;


    constructor(position: [number, number], shape: Colour[][], defaultColour: Colour) {


        this.position = position;
        this.shape = shape;
        this.defaultColour = defaultColour;

        let allMins = shape.map(x => x.findIndex(c => c != defaultColour))
        // find the smallest entry
        let xMin = Math.min(...allMins.filter(x => x != -1));
        // the first entry that isn't -1
        let yMin = allMins.findIndex(e => e != -1);

        console.log(shape)
        let allMax = shape.map(x => Math.max(...x.map((c, i) => c != defaultColour ? i : -1)));
        let xMax = Math.max(...allMax.filter(x => x != -1));
        let yMax = allMax.sort()[allMax.length - 1]; // this should be right> 

        console.log(allMax)
        console.log(xMin, yMin, xMax, yMax);
        let extracted = [];
        // now, I need to move everything backwards... 
        for (let i = yMin; i < yMax + 1; i++) {
            let row = [];
            for (let j = xMin; j < xMax + 1; j++) {
                console.log(i, j)
                row.push(shape[i][j]);
            }
            extracted.push(row);
        }
        this.extractedShape = extracted;
    }

    draw(): Colour[][] {
        let dimensions: [number, number] = [this.shape[0].length, this.shape.length];
        let blank = [...Array(dimensions[1])].map(_ => [...Array(dimensions[0])].map(_ => this.defaultColour));

        for (let i = 0; i < this.extractedShape.length; i++) {
            let row = this.extractedShape[i];
            for (let j = 0; j < row.length; j++) {
                let c = row[j];

                if (c != this.defaultColour && inBounds([i, j], dimensions)) {
                    blank[i + this.position[1]][j + this.position[0]] = c;
                }
            }

        }

        console.log(frameDisplay(blank));
        console.log(this.shape)
        console.log(this.extractedShape)
        return blank;
    }

    clone(): Target {
        return new PixelArtTarget(this.position, this.shape, this.defaultColour);
    }
}

let inBounds = (coord: [number, number], bounds: [number, number]): boolean => {
    let [x, y] = coord;
    return (x >= 0 && x < bounds[0] && y >= 0 && y < bounds[1]);
}


enum TransitionType {
    Complete,
    Disappearing,
    Appearing,
    Unspecified
}
// right, it's not that transitions take time, it;s that keyframes have time between them
interface Transition {
    from: Target | undefined;
    to: Target | undefined;
    type: TransitionType;
    generateDisappearingFrames(numFrames: number): Target[];
    generateAppearingFrames(numFrames: number): Target[];
    generateCompleteFrames(numFrames: number): Target[];
}

class UniformMove implements Transition {
    from: Target | undefined;
    to: Target | undefined;
    type: TransitionType;

    constructor(from: Target | undefined, to: Target | undefined, type: TransitionType) {
        this.from = from;
        this.to = to;
        this.type = type;
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

class Instantaneous implements Transition {
    from: Target | undefined;
    to: Target | undefined;
    type: TransitionType;
    constructor(from: Target | undefined, to: Target | undefined, type: TransitionType) {
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
            throw new Error("Transition isn't actually complete")
        }

        let transitionPoint = Math.floor(numFrames / 2);
        // if it's zero, then I don't actually have enough frames.
        // just flip to the second one
        if (transitionPoint == 0) {
            return [this.to];
        } else {
            console.log(numFrames - transitionPoint)
            console.log(this.to!)
            return [...Array(transitionPoint)].map(_ => this.from!).concat([...Array(numFrames - transitionPoint)].map(_ => this.to!));
        }
    }

}


// okay. so now, I basically get a bunch of objects that reflect the status at each synced keyframe
// when I compile, I'm creating syncedframes for every frame.


// we can traverse the keyframes to get syncedkeyframe
//

// class SyncedFrame {
//     objects: Target[]
//     globalTime: number 
//     nextKeyframe: SyncedFrame
// }


let generate = (objects: Target[], frameTimings: number[]) => {
    // basically
    // traverse a graph to find all the keyframes... 
    // maybe the keyframes are actually tags on the graph?
    // the thing is, objects aren't actually connected to each other. so maybe we do need...

    let startingObjects = objects.filter(o => o.frameId == 0);
    // something like, what is the timing between frames?
    for (let i = 0; i < frameTimings.length; i++) {
        // we start with objects
        // but where are the transitions? hmmmm
        let resultingObjects = startingObjects.map(s => (s, s.transition?.to));
        // we need to find the next one 
        // honestly would be easier to just scape them all off the bat anyway
        // also there's no "collection" of objects
        // anyway the goal is to create a bunch of sub-frames where each of the objects have positions 
        // 
    }
}

// actually, it's really tricky to figure out what the inputs and outputs should be
// instead, why don't we actually generate a golf graph first in the system

// first, I'm going to parse the input into different objects.


function hex2Rgb(hex: string): [number, number, number] | undefined {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ] : undefined;
}



function componentToHex(c: number) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgb2Hex(r: number, g: number, b: number) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}
import * as THREE from 'three';



let parseImagesIntoFrames = async (urls: string[]): Promise<[Target[][], number, number]> => {

    let loader = new THREE.ImageBitmapLoader();
    // loader.setOptions({ imageOrientation: 'flipY' })

    var canvas = document.createElement('canvas');
    let context2d = canvas.getContext('2d', { willReadFrequently: true })!;

    let frames = [];
    // can't use for loop here or order will be disrupted?
    let promises = urls.map(async url => {
        return await loader.loadAsync(url);
    })

    frames = await Promise.all(promises);
    let width = frames[0].width;
    let height = frames[0].height;

    canvas.width = width;
    canvas.height = height;
    let images: [number, number, number][][][] = [];
    for (let imageBitmap of frames) {
        context2d.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);
        let rgba = context2d.getImageData(0, 0, imageBitmap.width, imageBitmap.height).data;
        console.log(rgba)
        let resultingImg: [number, number, number][][] = [];
        for (let i = 0; i < imageBitmap.height; i++) {
            let curRow: [number, number, number][] = [];
            for (let j = 0; j < imageBitmap.width; j++) {
                curRow.push([rgba[(i * imageBitmap.width + j) * 4], rgba[(i * imageBitmap.width + j) * 4 + 1], rgba[(i * imageBitmap.width + j) * 4 + 2]]);
            }
            resultingImg.push(curRow);
        }
        images.push(resultingImg);
        console.log(resultingImg.length)
        console.log(resultingImg[0].length)
        // nextFlips.push(this.generateFlipBitmap(resultingImg, [255, 255, 255]));
    }



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
            let indices: [number, number][] = booleanFrame.map((row, i) => row.map((c, j) => c ? [j, i] as [number, number] : undefined)).flat(1).filter((i: [number, number] | undefined) => i != undefined);
            // let shapeFrame = getShapeFrames(indices, interp);
            // allFrameData.push(shapeFrame);
            // okay!

            // need to figure out boundaries 
            let xMin = Math.min(...indices.map(x => x[0]));
            let yMin = Math.min(...indices.map(x => x[1]));

            let inputShape: [number, number][] = indices.map(x => [x[0] - xMin, x[1] - yMin]);

            let frame = [...Array(height)].map(_ => [...Array(width)].map(_ => false))
            for (let obj of indices) {
                let x = obj[0] + xMin;
                let y = obj[1] + yMin;
                // console.log(x, y)
                if (inBounds([x, y], [width, height])) {
                    frame[y][x] = true;
                }
            }

            let target = new PixelArtTarget([xMin, yMin], frame, false);
            target.frameId = allShapesAllFrames[id].length

            eachFrameData.push(target);
            allShapesAllFrames[id].push(target);
        }
        allFramesAllShapes.push(eachFrameData);
    }

    // now I have a bunch of objects at each frame
    // let me hook them up!
    for (let i = 0; i < allShapesAllFrames.length; i++) {
        let makeTransitionsFor = toWindows<Target>(allShapesAllFrames[i], 2);
        // for each id, I need to hook up stuff for each frame
        for (let [o1, o2] of makeTransitionsFor) {
            let newTransition = new Instantaneous(o1, o2, TransitionType.Complete);
            // let newTransition = new UniformMove(o1, o2, TransitionType.Complete);
            o1.transition = newTransition;
        }
    }

    console.log(allFramesAllShapes)
    return [allShapesAllFrames, width, height]
}

function toWindows<T>(inputArray: T[], size: number) {
    return Array.from(
        { length: inputArray.length - (size - 1) }, //get the appropriate length
        (_, index) => inputArray.slice(index, index + size) //create the windows
    )
}


console.log("hi")
// parseImagesIntoFrames([1,2,3,4,5,6,7,8,9].map(i => `/animations/golf-coloured${i}.png`)).then(data => {
parseImagesIntoFrames([1, 2, 3, 4, 5].map(i => `/animations/basic${i}.png`)).then(data => {
// parseImagesIntoFrames([1, 2, 3].map(i => `/animations/slide-normal${i + 1}.png`)).then(data => {
    let res = data[0];
    let width = data[1];
    let height = data[2];
    console.log(res.map(f => f.map(o => o.frameId)))
    // let frames = generateAnimation(res, [...Array(3)].map(_ => 4))
    // console.log(frames)
    let frames: Colour[][][] = generateAnimation(res, [...Array(4)].map(_ => 3))
    // let frames: Colour[][][] = generateAnimation(res, [...Array(9)].map(_ => 3))
    frames.forEach(f => console.log(frameDisplay(f)));
    let indices: [number, Colour][][] = frameToIndices(frames, width);
    indices.forEach(i => console.log(indicesDisplay(i, width, height)))
    let indicesWithStates: [number, FlipDotState][][] = indices.map(frame => frame.map(([i, c]: [number, Colour]) => [i, new FlipDotState(c as boolean)] as [number, FlipDotState]));
    console.log(indicesWithStates)
    let hardware = new SimulationHardware(width, height);
    hardware.programSequence(indicesWithStates);
})

function frameDisplay(frame: Colour[][]): string { 
    let str = "";
    for (let row of frame) {
        let strRow = "";
        for (let col of row) {
            // console.log(col)
            strRow += ` ${col == true ? "O" : "X"}`
            // strRow + col;
        }
        str += strRow + "\n"
    }
    return str;
}

function indicesDisplay(indices: [number, Colour][], width: number, height: number) {
    let str = [...Array(height)].map(_ => [...Array(width)].map(_ => "X"));
    console.log(indices)
    for (let [idx, col] of indices) { 
        // str[Math.floor(idx / width)][idx % width] = `${col}`;
        console.log(col)
        str[Math.floor(idx / width)][idx % width] = col == true ? "O" : "X";
    }

    return str.map(row => row.join(" ")).join("\n")
}


function frameToIndices(frames: Colour[][][], width: number) {
    console.log(frames)
    let updatedFrames = [];
    for (let frame of frames) {
        console.log(frame)
        // okay something weird is going on 
        // I need to make sure these are being added up per row.
        let newFrame: [number, Colour][] = frame.map((r, i) => r.reduce((acc: [number, Colour][], curr: Colour, idx: number) => {
            console.log(curr)
            if (curr) {
                acc.push([i * width + idx, curr])
            }
            return acc;
        }, [] as [number, Colour][])).reduce((o, n) => o.concat(n), []);

        updatedFrames.push(newFrame);
    }

    console.log(updatedFrames)
    return updatedFrames;

}
// okay, this seems fine...
// now I want to do something like...
// 1) check all the frames

let generateAnimation = (objects: Target[][], transitionTiming: number[]): Colour[][][] => {
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
        console.log(o)
        while (o && o.transition != undefined) {
            console.log("looping! frame ", frameNum)
            // this works when all frames are defined. if we have break in continuity, we need to multiply number of
            let fullObjects = o.transition.generateCompleteFrames(transitionTiming[frameNum])
            console.log(fullObjects)
            console.log(fullObjects.map(o => o.draw()))
            allFrameValues = allFrameValues.concat(fullObjects.map(o => o.draw()));
            // allFrameValues.push(fullObjects.map(o => o.draw()));
            o = o.transition.to;
            frameNum++;
        }
        console.log(object)
        numFramesPerObject.push(allFrameValues.length);
        objectFrames.push(allFrameValues);
    }
    console.log("?")

    console.log(objects)
    // object, allframes (row, col) -> why is it [object - 4 frames - 3 frames? ah because 3 frames per keyframe.]
    console.log(objectFrames)

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
            console.log(i)
            console.log(object)
            // object[i] should only be Colour[][] since it's per frame 
            console.log(object[i])
            framesComposed[i].push(object[i])
        }
    }

    // if (framesComposed.length != transitionTiming.length) {
    //     throw new Error("frames composed length doesn't match number of frames");
    // }

    if (!framesComposed.every(frame => frame.length == numObjects)) {
        throw new Error("frames composed number of objects per frame doesn't match number of objects at beginning")
    }

    // okay... so now I have all the frames. 
    // I need to collapse each frame

    let frames: Colour[][][] = [];
    // now take that and add everything togehter
    for (let frame of framesComposed) {
        console.log(framesComposed)
        let finishedFrame: Colour[][] = compose(frame, false as Colour);
        console.log(finishedFrame)
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
let compose = (objects: Colour[][][], defaultColour: Colour): Colour[][] => {
    let definitive: Colour[][] = objects[0];
    console.log(definitive)
    console.log(objects)
    for (let o = 1; o < objects.length; o++) {
        for (let row = 0; row < objects[o].length; row++) {
            for (let col = 0; col < objects[o][row].length; col++) {
                if (objects[o][row][col] != defaultColour) {
                    console.log(objects[o][row][col])
                    definitive[row][col] = objects[o][row][col];
                }
            }
        }
    }
    // this should only be 2d!!!!
    console.log(definitive)
    return definitive;
}

let visualizeGraph = (objects: Target[][]) => {
    // for each object...

}


