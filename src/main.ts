import { RowOfDiscs } from "./flipdisc";
import { WIDTH, HEIGHT, ANIMATION_PATHS, INV_Y_ON_LOAD, BAD_APPLE, ALL_ANIMATIONS, REVERSE_ANIM, CONTROL_ANIM, GOLF_STRETCH, GOLF_CAMERA, GOLF_PATH, GOLF_IMPACT, GOLF_ANIM, NUM_FRAMES_ROTATING, SPLIT_FLAP_CYCLE_LENGTH, ALPHABET_WITH_EXCLAMATION } from "./constants";

import * as THREE from 'three';
import { CINDERELLA_BASIC } from './cinderella';
import { BAD_APPLE_STRING_10FPS_32x24 } from "./programs";
import { SplitFlapDisplay } from "./splitflap";
import { STLLoader } from "three/addons/loaders/STLLoader";





// new SplitFlapDisplay(10,20, 60, 120);
console.log([...new Array(5 % 50)])
// let display = new SplitFlapDisplay(5, 10, 30, 60);


// let's generate a function that 
let frames1to10 = [...new Array(50).keys()];
let frame11 = [...new Array(50).keys()];
frame11.splice(25, 1);
frame11.splice(24, 1);

let frame12 = [...new Array(50).keys()];
frame12.splice(26, 1);
frame12.splice(25, 1);
frame12.splice(24, 1);
frame12.splice(23, 1);

let frame13 = [...new Array(50).keys()];
frame13.splice(27, 1);
frame13.splice(26, 1);
frame13.splice(25, 1);
frame13.splice(24, 1);
frame13.splice(23, 1);

let newGenerator = (i: number) => [frames1to10, frames1to10, frames1to10, frames1to10, frame11, frame11, frame12, frame12, frame13, frame13][i % 10];
// display.resetAnimation(newGenerator);
// display.resetAnimation(i => [...new Array(i % 50).keys()]);


let unveilText = (textPerLine: string[], height: number, width: number): [number[][], number[][], (f: number) => (i: number) => [number | undefined, number | undefined]] => {
    // what is the way to specify the input?
    if (textPerLine.length != height) {
        throw new Error("not one text per line");
    }

    if (textPerLine.some(l => l.length >= width)) {
        throw new Error("one of these lines has too many characters");
    }

    // map text pieces to indices

    let finalFrame = [];
    let flipOrdering = [];
    for (let line of textPerLine) {
        // depends on the scheme... but maybe I should do this:

        let leftPadding = Math.floor((width - line.length) / 2);
        let rightPadding = Math.ceil((width - line.length) / 2);

        let widthHalfMax = Math.ceil(width / 2);
        let widthHalfMin = Math.floor(width / 2)

        let forward, reversed = [];
        if (widthHalfMax == widthHalfMin) {
            forward = [...new Array(widthHalfMin).keys()];
            reversed = forward.map(i => i);
        } else {
            forward = [...new Array(widthHalfMax).keys()];
            reversed = [...new Array(widthHalfMin).keys()];
        }
        reversed.reverse();
        flipOrdering.push(forward.concat(reversed));

        let finalLine: string[] = [];
        finalLine = finalLine.concat([...new Array(leftPadding)].map(_ => ""))
        for (let i = 0; i < line.length; i++) {
            finalLine.push(line[i]);
        }
        finalLine = finalLine.concat([...new Array(rightPadding)].map(_ => ""))
        finalFrame.push(finalLine);
    }

    console.log(finalFrame);

    // now I want to compute how many flips I need
    let flipsTo = finalFrame.map(line => line.map(char => char == "" ? undefined : ALPHABET_WITH_EXCLAMATION.split("").findIndex(c => c == char)!));

    console.log(flipsTo);
    console.log(flipOrdering);

    // okay, now I need to combine these two. 
    // let's make a list called adjustedFlips
    // for each character inside finalFrame

    let maxFlipsPerOrdinal: Map<number, number> = new Map();
    for (let i = 0; i < finalFrame.length; i++) {
        for (let j = 0; j < finalFrame[i].length; j++) {
            let char = finalFrame[i][j];
            if (char != "") {
                let flipOrder = flipOrdering[i][j];
                let numFlips = flipsTo[i][j];
                if (numFlips != undefined) {
                    if (maxFlipsPerOrdinal.has(flipOrder)) {
                        maxFlipsPerOrdinal.set(flipOrder, Math.max(maxFlipsPerOrdinal.get(flipOrder)!, numFlips))
                    } else {
                        maxFlipsPerOrdinal.set(flipOrder, numFlips);
                    }
                }
            }
        }
    }

    console.log(maxFlipsPerOrdinal);


    let syncedVersion = generateSynced(flipsTo, maxFlipsPerOrdinal, flipOrdering);


    let finalFlipsTo = [];
    // now I go back: if I have less than numFlips, I need to add 27 to it 
    for (let i = 0; i < finalFrame.length; i++) {
        let finalFlipsToLine = [];
        for (let j = 0; j < finalFrame[i].length; j++) {
            let flipOrder = flipOrdering[i][j]; // 0, 1, 2, 3, 4 etc
            let numFlips = flipsTo[i][j]; // alphabet letters

            console.log(numFlips)
            if (flipOrder > 0) {
                let max = Math.max(...[...new Array(flipOrder).keys()].map(i => maxFlipsPerOrdinal.get(i) != undefined ? maxFlipsPerOrdinal.get(i)! : 0));
                console.log(max);
                if (numFlips && max >= numFlips) {
                    finalFlipsToLine.push(numFlips + 27);
                } else if (numFlips) {
                    finalFlipsToLine.push(numFlips);
                } else {
                    finalFlipsToLine.push(undefined);
                }
            } else {
                if (numFlips) {
                    finalFlipsToLine.push(numFlips);
                } else {
                    finalFlipsToLine.push(undefined);
                }
            }

        }
        finalFlipsTo.push(finalFlipsToLine);
    }

    console.log(finalFlipsTo);
    // okay, now I'll use this to make a sequence.
    finalFlipsTo = finalFlipsTo.map(l => l.map(x => x != undefined ? x + 3 : undefined)) // dumb

    // let biggestNum = Math.max(...finalFlipsTo.map(line => Math.max(...line.filter(x => x != undefined))));
    // let finalSequence: number[][] = [...new Array(biggestNum + 2)].map(_ => []); // arbitrary 
    // for (let i = 0; i < finalFrame.length; i++) {
    //     for (let j = 0; j < finalFrame[i].length; j++) {
    //         if (finalFlipsTo[i][j] == undefined) {
    //             for (let idx = 0; idx < finalSequence.length; idx++) {
    //                 // flip this every time
    //                 finalSequence[idx].push(i * width + j)
    //             }
    //         } else {
    //             // otherwise, flip up to (excluding) the number of flips.
    //             let numFlips = finalFlipsTo[i][j]!;
    //             for (let idx = 0; idx < numFlips; idx++) {
    //                 finalSequence[idx].push(i * width + j);
    //             }
    //         }
    //     }
    // }

    console.log(flipOrdering)
    return [convertNumFlipsToSequence(finalFlipsTo, width), convertNumFlipsToSequence(flipsTo.map(l => l.map(x => x != undefined ? x + 3 : undefined)), width), syncedVersion]

    // console.log(finalSequence)

    // return [finalSequence, flipOrdering];
}

let convertNumFlipsToSequence = (flipsTo: (number | undefined)[][], width: number): number[][] => {
    console.log(flipsTo)
    let biggestNum = Math.max(...flipsTo.map(line => Math.max(...line.filter(x => x != undefined))));
    let finalSequence: number[][] = [...new Array(biggestNum + 2)].map(_ => []); // arbitrary 
    for (let i = 0; i < flipsTo.length; i++) {
        for (let j = 0; j < flipsTo[i].length; j++) {
            // console.log(flipsTo[i])
            if (flipsTo[i][j] == undefined) {
                for (let idx = 0; idx < finalSequence.length; idx++) {
                    // flip this every time
                    finalSequence[idx].push(i * width + j)
                }
            } else {
                // otherwise, flip up to (excluding) the number of flips.
                let numFlips = flipsTo[i][j]!;
                for (let idx = 0; idx < numFlips; idx++) {
                    finalSequence[idx].push(i * width + j);
                }
            }
        }
    }
    console.log(finalSequence)
    return finalSequence;
}


// pause and cycle might be specific to the frame
// frames, then indices
let convertSyncedSequence = (frames: number[][], pauses: number[][], cycles: number[][]): (f: number) => (i: number) => [number | undefined, number | undefined] => {

    let countSinceLastFrame: number[] = pauses[0].map(_ => 0);

    // maybe I don't need undefined, it's just the end of the list?
    // this one is arranged OBJECT then FRAME
    let perPixelReturn: number[][] = pauses[0].map(_ => []);
    let cyclesReturn: number[][] = pauses[0].map(_ => []);

    for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
        for (let i = 0; i < pauses[frameIdx].length; i++) {
            // console.log(frameIdx)
            // console.log(i)
            if (frames[frameIdx].includes(i)) {
                // each thing that appears should reset the count...
                let count = i > 0 ? countSinceLastFrame[i - 1] : countSinceLastFrame[i];
                // or should this be according to the previous one?

                perPixelReturn[i].push((count + 1) * pauses[frameIdx - count][i]);
                cyclesReturn[i].push((count + 1) * cycles[frameIdx - count][i]);
                countSinceLastFrame[i] = 0;
            } else {
                // console.log("no included in: ", i, frames[frameIdx]);
                countSinceLastFrame[i] += 1;
            }
        }
    }

    console.log(perPixelReturn);
    console.log(cyclesReturn)

    // this only lets things loop once!
    let fn = (f: number) => (i: number) => [f < perPixelReturn[i].length ? perPixelReturn[i][f] : undefined, f < cyclesReturn[i].length ? cyclesReturn[i][f] : undefined] as [number | undefined, number | undefined];

    return fn;
}


let generateSynced = (numFlips: (number | undefined)[][], maxFlipsPerOrdinal: Map<number, number>, ordering: number[][]) => {
    // first of all -- are any more than double?
    // but if I do adjust for that.... then I might have to adjust all of them...
    let newFlips = numFlips.map(l => l.map(i => i));
    let done = false;
    // while (!done) {
    //     done = true
    //     for (let i = 0; i < numFlips.length; i++) {
    //         for (let j = 0; j < numFlips[i].length; j++) {
    //             let order = ordering[i][j]
    //             let flips = newFlips[i][j]
    //             if (flips && (maxFlipsPerOrdinal.get(order)! / flips) > 2) {
    //                 newFlips[i][j] = flips + 27;
    //                 done = false;
    //             }
    //         }
    //     }
    // }

    console.log(newFlips);


    // I need to convert numFlips to frames ... 

    let numRotationFrames = 30;
    let minimumPause = 5;
    // the max we can do is speed it up by half.

    // cool, now we can set the spacing
    // if same, we choose the same value 
    // if A has fewer rotations than B, then make it so that A's pause is longer
    // in general, I want to rotate 4 times when 
    let pauses = numFlips.map(l => l.map(i => i));
    for (let i = 0; i < newFlips.length; i++) {
        for (let j = 0; j < newFlips[i].length; j++) {
            let order = ordering[i][j]
            let flips = newFlips[i][j]
            let max = maxFlipsPerOrdinal.get(order)!
            if (flips && (max == flips)) {
                pauses[i][j] = minimumPause;
            } else if (flips) {
                // let's say this is 7 and max is 23
                let totalMin = numRotationFrames + minimumPause;
                let ratio = max / flips;
                // oh no, might not be a whole number
                let totalPauseFrames = (ratio * totalMin) - numRotationFrames;
                pauses[i][j] = totalPauseFrames;
            }
        }
    }

    let fn = (f: number) => (i: number) => [f < pauses[i].length ? pauses[i][f] : undefined, 0] as [number | undefined, number | undefined];
    return fn;

}

let [sequence, sequence2, sequence3] = unveilText(["", "world", "hello", ""], 4, 7);
let display = new SplitFlapDisplay(4, 7, 30, 60);
// let display = new SplitFlapDisplay(4, 7, 8, 16);
// let me se the timing a bit differently

let newTimingFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 30 : 0);
// let newTimingFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 30 : 10);

// let newTimingFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 30 : 30 / 4);
// let newCycleFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 60 : 60);

let newCycleFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 60 : 40);

// let newTimingFunc = [...new Array(4 * 7).keys()].map(i => i % 2 ? 30 : 30);
// display.perPixelPauses = newTimingFunc;
// wait... if I can change cycle ending time then when do I pull updates????
// display.perPixelCycleLength = newCycleFunc;
// display.resetAnimation(i => i >= sequence2.length ? [] : sequence2[i])



let newFunction = convertSyncedSequence(sequence, sequence.map(_ => newTimingFunc), sequence.map(_ => newCycleFunc))

// hmm, as soon as I let things go longer, the spinning gets all messed up...
// probably related to implicit assumptions about offset and splitflapcyclelength.
// like, offset is duplicated. 
// let basicSequence = [...new Array(5)].map(_ => [...new Array(2).keys()]).concat([...new Array(5)].map(_ => [])).concat([...new Array(5)].map(_ => [...new Array(2).keys()]));
let basicSequence = [...new Array(5)].map(_ => [...new Array(28).keys()]).concat([...new Array(5)].map(_ => [...new Array(15).keys()])).concat([...new Array(5)].map(_ => [...new Array(27).keys()]));
console.log(basicSequence)
let basicFunction = convertSyncedSequence(basicSequence, basicSequence.map(_ => newTimingFunc), basicSequence.map(_ => newCycleFunc));

// display.resetAnimation(basicFunction)
display.resetAnimation(sequence3 as (f: number) => (i: number) => [number | undefined, number | undefined])
// display.resetAnimation(newFunction)
// display.resetAnimation(i => i >= sequence.length ? [] : sequence[i])


// OFFSET - the amount of time to pause before the next one begins
// CYCLE LENGTH - how 
/// hmm... annoying that there are two
// how do I choose one variable to control both?
// if I have the pause... why is there even two offsets 

//==========================================================


let rowOfDiscs = new RowOfDiscs(WIDTH, HEIGHT, false);

type RGB = [number, number, number];


class VideoIndexGenerator {
    // imagine we have a simple image...
    loader: THREE.ImageBitmapLoader;
    context2d: CanvasRenderingContext2D;

    constructor() {
        this.loader = new THREE.ImageBitmapLoader();
        this.loader.setOptions({ imageOrientation: 'flipY' })

        var canvas = document.createElement('canvas');
        this.context2d = canvas.getContext('2d', { willReadFrequently: true })!;
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
    }

    convertFromIndexMode(input: [number, number][]): number[][] {
        // take every (x,y) coordinate pair
        // and convert it to [[1,2,3],[1,3],[],[1,2,3]] type format idk what it's called

        // what are the input dimensions?

        let ret: number[][] = [...Array(HEIGHT)].map(_ => []);
        // console.log(ret)
        for (let [a, b] of input) {
            // because this isn't row, column but x,y in the input
            ret[b].push(a);
        }

        for (let row of ret) {
            row.sort();
        }

        return ret;
    }

    readBitmapVideoState(str: string): boolean[][][] {
        let frames: boolean[][][] = [];
        let lines = str.split("\n").filter(s => s.trim() != "");
        for (let line of lines) {
            let ndarray: boolean[][] = JSON.parse(line);
            if (INV_Y_ON_LOAD) {
                ndarray.reverse();
            }
            frames.push(ndarray);
        };

        // frames.forEach(frame => console.log(frame.map(row => row.map(cel => cel ? "1" : "0").join("")).join("\n")))
        return frames;
    }

    generateFlipBitmap(input: RGB[][], a: RGB): boolean[][] {
        // let the first colour encountered
        let result: boolean[][] = [];
        for (let row of input) {
            let curRow: boolean[] = [];
            for (let col of row) {
                if (col[0] == a[0] && col[1] == a[1] && col[2] == a[2]) {
                    curRow.push(false);
                } else {
                    curRow.push(true);
                }
            }
            result.push(curRow);
        }

        return result;
    }

    generateFlipsFromBitmap(input: boolean[][]): number[][] {
        // let the first colour encountered
        let result: number[][] = [];
        for (let row of input) {
            let curRow: number[] = [];
            for (let colIdx = 0; colIdx < row.length; colIdx++) {
                if (row[colIdx]) {
                    curRow.push(colIdx);
                }
            }
            result.push(curRow);
        }

        return result;
    }

    generateFlipsFromBWImage(input: RGB[][], a: RGB): number[][] {
        // let the first colour encountered
        let result: number[][] = [];
        for (let row of input) {
            let curRow: number[] = [];
            for (let colIdx = 0; colIdx < row.length; colIdx++) {
                let col = row[colIdx];
                if (col[0] == a[0] && col[1] == a[1] && col[2] == a[2]) {
                    curRow.push(colIdx);
                }
            }
            result.push(curRow);
        }

        return result;
    }

    takeFlipSequenceDifference(inputFrames: boolean[][][]): boolean[][][] {
        if (inputFrames.length < 2) {
            // only one frame means nothing to do
            return inputFrames;
        }

        let start = 0;
        let end = 1;

        // always start with the first one because our starting position is all unflipped
        let newSequence: boolean[][][] = [inputFrames[start]];

        while (end < inputFrames.length) {
            let startFrame = inputFrames[start];
            let endFrame = inputFrames[end];
            // I basically need to do a big XOR, I guess this would be easier with pytorch
            let newFrame = endFrame.map((row, i) => row.map((cell, j) => cell != startFrame[i][j]))
            // let changes = newFrame.map(rows => rows.map(a => a ? "1" : "0").join("")).join("\n");
            // console.log(changes)
            newSequence.push(newFrame);
            start++;
            end++;
        }

        // for each pair, only flip what actually must be flipped. 
        return newSequence;

    }

    generateUniformFlipFunctionForSequence(inputFrames: number[][][]): (i: number) => number[][] {
        return (seq: number) => {
            return inputFrames[seq % inputFrames.length];
        };
    }

    generateUndulatingFlipFunctionForSequence(inputFrames: number[][][]): (i: number) => number[][] {
        let totalLength = inputFrames.length * 2;
        let turnAroundAt = inputFrames.length;
        return (seq: number) => {
            let seqNumber = seq % totalLength;
            // now just go backwards once the max has been reached.
            if (seqNumber >= turnAroundAt) {
                // how far am I into the second half of the sequence?
                return inputFrames[inputFrames.length - (seqNumber - inputFrames.length) - 1];

            } else {
                return inputFrames[seqNumber];

            }
        };
    }

    // TODO: not sure how to propagate this down... 
    generateKeyPressSequence(inputFrames: number[][][]): (i: number) => number[][] {
        let currentIdx = 0;
        let usableFrames: number[][][] = [];

        let body = document.getElementById("app");
        body!.addEventListener("keydown", e => {
            console.log(e)
            if (e.key == " ") {
                usableFrames[0] = inputFrames[currentIdx];
                currentIdx++;
                updated["k"] = true;
                console.log("making updated")
            }
        })

        let updated = { "k": false };


        return (seq: number) => {
            if (updated["k"]) {
                console.log("huh")
                updated["k"] = false;
                return usableFrames[0];
            } else {
                return [...Array(HEIGHT)].map(_ => []);
            }
        };
    }

    loadVideoFromStr(str: string) {
        let frames = this.readBitmapVideoState(str);
        // frames.forEach(frame => console.log(frame.map(row => row.map(cel => cel ? "1" : "0").join("")).join("\n")))
        let boolFrames = this.takeFlipSequenceDifference(frames);
        // console.log(boolFrames.filter(x => x.filter(y => y.some(a => !a)).length != 0));
        let sequence = boolFrames.map(frame => this.generateFlipsFromBitmap(frame));
        // console.log(sequence)
        rowOfDiscs.resetAnimation(this.generateUniformFlipFunctionForSequence(sequence));
    }

    // wait, but this isn't right. it just loads the frames that should be flipped.
    // we actually need to do a difference from frame to frame.
    // 
    async loadImages(urls: string[]) {
        let frames = [];
        // can't use for loop here or order will be disrupted?
        let promises = urls.map(async url => {
            return await this.loader.loadAsync(url);
        })

        frames = await Promise.all(promises);

        let nextFlips: boolean[][][] = [];
        for (let imageBitmap of frames) {
            this.context2d.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);
            let rgba = this.context2d.getImageData(0, 0, imageBitmap.width, imageBitmap.height).data;
            console.log(rgba)
            let resultingImg: RGB[][] = [];
            for (let i = 0; i < imageBitmap.height; i++) {
                let curRow: [number, number, number][] = [];
                for (let j = 0; j < imageBitmap.width; j++) {
                    curRow.push([rgba[(i * imageBitmap.width + j) * 4], rgba[(i * imageBitmap.width + j) * 4 + 1], rgba[(i * imageBitmap.width + j) * 4 + 2]]);
                }
                resultingImg.push(curRow);
            }
            console.log(resultingImg);
            nextFlips.push(this.generateFlipBitmap(resultingImg, [255, 255, 255]));
        }

        nextFlips.push([...Array(nextFlips[0].length)].map(_ => [...Array(nextFlips[0][0].length)].map(_ => false)));
        console.log(nextFlips)

        let sequence = this.takeFlipSequenceDifference(nextFlips).map(frame => this.generateFlipsFromBitmap(frame));
        console.log(sequence)
        if (CONTROL_ANIM) {
            rowOfDiscs.resetAnimation(this.generateKeyPressSequence(sequence));
        }
        else if (REVERSE_ANIM) {
            rowOfDiscs.resetAnimation(this.generateUndulatingFlipFunctionForSequence(sequence));
        } else {
            rowOfDiscs.resetAnimation(this.generateUniformFlipFunctionForSequence(sequence));
        }

    }

}


let numfaces = 290;
let sequentialOnOneRow = [...new Array(numfaces).keys()]
console.log(rowOfDiscs.adjacentOrder);

const loader = new STLLoader();
// const object = await loader.loadAsync('public/lowpolysphere.stl');

// console.log(object.attributes)

loader.load("public/lowpolybunny.stl", (geometry) => {
    let geometryStripes = rowOfDiscs.computeGeomStripes(geometry);
    rowOfDiscs.resetAnimation(i => [[geometryStripes[numfaces - (i % numfaces)]]])

});

// rowOfDiscs.resetAnimation(i => [[sequentialOnOneRow[numfaces - (i % numfaces)]]])
// rowOfDiscs.resetAnimation(i => [[sequentialOnOneRow[numfaces - (i % numfaces)]]])


// should be [[],[],[1],[],[3],[],[]]
// console.log(new VideoIndexGenerator().convertFromIndexMode([[1, 2], [3, 4]]))

// new VideoIndexGenerator().loadImages(ANIMATION_PATHS);

// new VideoIndexGenerator().loadImages(["./public/smiley0.png", "./public/smiley.png", "./public/smiley2.png"]);

// new VideoIndexGenerator().loadVideoFromStr(BAD_APPLE_STRING_10FPS_32x24.replace(/\'/g,''));
// new VideoIndexGenerator().loadVideoFromStr(BAD_APPLE.replace(/\'/g,''));

// new VideoIndexGenerator().loadImages(ALL_ANIMATIONS);



// let golf_opts = [GOLF_ANIM, GOLF_STRETCH, GOLF_CAMERA, GOLF_PATH, GOLF_IMPACT];
// let golf_captions = ["default", "stretch", "zoom", "path", "impact"]
// let buttons = document.createElement("div");
// for (let i = 0; i < golf_opts.length; i++) {
//     let btn = document.createElement("button");
//     btn.textContent = golf_captions[i];
//     btn.addEventListener('click', () => {
//         rowOfDiscs.clear();
//         new VideoIndexGenerator().loadImages(golf_opts[i])
//     })
//     buttons.appendChild(btn);
// }
// document.body.append(buttons)


// new VideoIndexGenerator().loadVideoFromStr(CINDERELLA_BASIC.replace(/\'/g,''));


// new VideoIndexGenerator().loadImages(GOLF_STRETCH);
// new VideoIndexGenerator().loadImages(GOLF_CAMERA);
// new VideoIndexGenerator().loadImages(GOLF_PATH);
// new VideoIndexGenerator().loadImages(GOLF_IMPACT);


// white red or green black.

// how to set my own example...
// make noise patterns that overlay more and more of the object... 

