import { RowOfDiscs } from "./flipdisc";
import { WIDTH, HEIGHT } from "./constants";

let rowOfDiscs = new RowOfDiscs();

type RGB = [number, number, number];


class VideoIndexGenerator {
    // imagine we have a simple image...

    convertFromIndexMode(input: [number, number][]): number[][] {
        // take every (x,y) coordinate pair
        // and convert it to [[1,2,3],[1,3],[],[1,2,3]] type format idk what it's called
        
        // what are the input dimensions?
        
        let ret: number[][] = [...Array(HEIGHT)].map(_ => []);
        console.log(ret)
        for (let [a, b] of input) {
            // because this isn't row, column but x,y in the input
            ret[b].push(a);
        }

        for (let row of ret) {
            row.sort();
        }

        return ret;
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
    
} 


// should be [[],[],[1],[],[3],[],[]]
console.log(new VideoIndexGenerator().convertFromIndexMode([[1,2],[3,4]])) 

import * as THREE from 'three';
let loader = new THREE.ImageBitmapLoader();
loader.setOptions({ imageOrientation: 'flipY' })


var canvas = document.createElement('canvas');
var context2d = canvas.getContext('2d')!;
canvas.width = WIDTH;
canvas.height = HEIGHT;

loader.load(
	// resource URL
	'./public/smiley.png',
	// onLoad callback
	function ( imageBitmap: ImageBitmap ) {
        context2d.drawImage(imageBitmap, 0, 0,imageBitmap.width, imageBitmap.height);
        let rgba = context2d.getImageData(0,0,imageBitmap.width, imageBitmap.height).data;
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
        let newPattern = new VideoIndexGenerator().generateFlipsFromBWImage(resultingImg, [255, 255, 255]);
        let newPattern2 = new VideoIndexGenerator().generateFlipsFromBWImage(resultingImg, [0,0,0]);
        console.log(newPattern);
        rowOfDiscs.resetAnimation((i) => i % 2 == 0 ? newPattern : newPattern2);
	},
	undefined,
	function ( err: any ) {
		console.log( 'An error happened' ); 
	}
);