import { RowOfDiscs } from "./flipdisc";
import { WIDTH, HEIGHT, ANIMATION_PATHS,  INV_Y_ON_LOAD, BAD_APPLE, ALL_ANIMATIONS, REVERSE_ANIM, CONTROL_ANIM } from "./constants";

import * as THREE from 'three';
import { BAD_APPLE_STRING_10FPS_32x24 } from "./programs";
import { SplitFlapDisplay } from "./splitflap";

let rowOfDiscs = new RowOfDiscs(WIDTH, HEIGHT);

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
            let newFrame = endFrame.map((row,i) => row.map((cell,j) => cell != startFrame[i][j]))
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

        let updated = {"k": false};
        

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


// should be [[],[],[1],[],[3],[],[]]
console.log(new VideoIndexGenerator().convertFromIndexMode([[1, 2], [3, 4]])) 
new VideoIndexGenerator().loadImages(ANIMATION_PATHS);
// new VideoIndexGenerator().loadImages(["./public/smiley0.png", "./public/smiley.png", "./public/smiley2.png"]);

// new VideoIndexGenerator().loadVideoFromStr(BAD_APPLE_STRING_10FPS_32x24.replace(/\'/g,''));
// new VideoIndexGenerator().loadVideoFromStr(BAD_APPLE.replace(/\'/g,''));

// new VideoIndexGenerator().loadImages(ALL_ANIMATIONS);

new SplitFlapDisplay(10,20);
