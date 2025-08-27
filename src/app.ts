import { ImageBitmapLoader } from "three";
import { AnimationStrategy, AreaEffect, Background, Colour, DerivedTarget, Effect, FlipDotState, MovingNoise, Noise, PixelArtTarget, SimulationHardware, Static, Target, UniformInterpolateStrategy } from "./language";

let latestIndices: [number, number][][] = [];
let frameIndices: [number, number][][][] = [];
let frameEffects: [DerivedTarget | Background | Effect, number][][] = []; // this should include the ordering that this effect is applied over
// but this doesn't work on shapes... and the shapes don't exist until we try to animate! 

// let endFrameIndices: [number, number][][] = [];
let activeFrameIdx = 0;
// let width = 30;
// let height = 30;
let width = 100;
let height = 50;
let pixelSize = 6;

let numFrames = 6;

let drawingMode = "line";
// todo: problem is that select is always drawn "behind" other shapes
let selectedArea: string | undefined = undefined;

let selectedPixels: [number, number][] = [];
let activeShapeIdx = 0;
let selectedShapeIdx = 0;

let shapeColourCycleHex = [
    "#4269d0", // blue
    "#efb118", // orange
    "#ff725c", // red
    "#6cc5b0", // cyan
    "#3ca951", // green
    "#ff8ab7", // pink
    "#a463f2", // purple
    "#97bbf5", // light blue
    "#9c6b4e", // brown
    "#9498a0"  // gray
];

let shapeColourCycle: [number, number, number][] = shapeColourCycleHex.map(c => hex2Rgb(c)!);

let shapeButtons: HTMLButtonElement[] = [];
let frameButtons: HTMLButtonElement[] = [];

let backgroundEffect = (frames: boolean[][][]) => {
    return frames.map(f => f.map(r => r.map(c => false)));
}

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


let module = new SimulationHardware(width, height);

let target = undefined;

let getShapeFrames = (indices: [number, number][], interp: AnimationStrategy): boolean[][][] => {

    // need to figure out boundaries 
    let xMin = Math.min(...indices.map(x => x[0]));
    let yMin = Math.min(...indices.map(x => x[1]));
    let start: [number, number] = [xMin, yMin];
    let xSize = Math.max(...indices.map(x => x[0])) - xMin;
    let ySize = Math.max(...indices.map(x => x[1])) - yMin;

    let inputShape: [number, number][] = indices.map(x => [x[0] - xMin, x[1] - yMin]);

    console.log(xSize, ySize)
    target = new PixelArtTarget(inputShape, [xSize, ySize], [width, height]);
    target.setStartAt(start)
    // let interp = new AccelerateInterpolationStrategy(numFrames, hardware);
    let framesColour = interp.generateFrames(target, start, start);
    // let bgFrames = framesColour.map(f => bg.drawBackground([f]));
    // wait, how do these things get combined...?
    console.log(framesColour)

    return framesColour as boolean[][][];
}



addEventListener("load", () => {
    latestIndices.push([]);
    // endFrameIndices.push([]);
    frameIndices.push([]);
    frameIndices[activeFrameIdx].push([]);
    frameEffects.push([]);

    let canvas: HTMLCanvasElement = document.getElementById("drawing-canvas")! as HTMLCanvasElement;
    canvas.setAttribute("width", "" + width * pixelSize)
    canvas.setAttribute("height", "" + height * pixelSize)

    let selectionCanvas: HTMLCanvasElement = document.getElementById("selection-canvas")! as HTMLCanvasElement;
    selectionCanvas.setAttribute("width", "" + width * pixelSize)
    selectionCanvas.setAttribute("height", "" + height * pixelSize)
    let selectionCtx = selectionCanvas.getContext("2d");

    let endFrameCanvas: HTMLCanvasElement = document.getElementById("end-frame")! as HTMLCanvasElement;
    endFrameCanvas.setAttribute("width", "" + width * pixelSize)
    endFrameCanvas.setAttribute("height", "" + height * pixelSize)
    let endFrameCtx = endFrameCanvas.getContext("2d");

    let ctx = canvas.getContext("2d");



    let createShapeButton = (selfShape: number): HTMLButtonElement => {
        // also, make a way to access the shape 
        let newButton = document.createElement("button");
        newButton.textContent = `Shape ${activeShapeIdx}`;
        newButton.style.setProperty("color", shapeColourCycleHex[activeShapeIdx]);

        newButton.addEventListener("click", e => {
            shapeButtons[activeShapeIdx].classList.remove("btn-selected");
            newButton.classList.add("btn-selected");
            console.log(selfShape)

            activeShapeIdx = selfShape;
        })

        return newButton
    }

    let createFrameButton = (selfFrame: number): HTMLButtonElement => {
        let newButton = document.createElement("button");
        newButton.textContent = `Frame ${selfFrame}`;
        newButton.style.setProperty("color", shapeColourCycleHex[selfFrame]);

        newButton.addEventListener("click", e => {
            frameButtons[activeFrameIdx].classList.remove("btn-selected");
            newButton.classList.add("btn-selected");
            console.log(selfFrame)

            activeFrameIdx = selfFrame;
            drawOnEndFrameCanvas();
            drawOnSelectionCanvas();
        })

        return newButton;
    }

    let setMode = document.getElementsByClassName("set-drawmode");
    for (let i = 0; i < setMode.length; i++) {
        setMode[i].addEventListener("click", function () {
            let oldElement = document.getElementById(drawingMode);
            oldElement?.classList.remove("btn-selected");
            drawingMode = setMode[i].id;
            setMode[i].classList.add("btn-selected")
        })
    }
    // setLine?.addEventListener("click", () => { drawingMode = "line"; });
    // let setSquare = document.getElementById("square");
    // setSquare?.addEventListener("click", () => { drawingMode = "square"; });




    let updateSimulation = (frames: number[][]) => {
        module.clear();

        let drawFrame = (frame: number[]) => {
            frame.forEach(pix => {
                module.draw(pix, FlipDotState.coloured());
            });
            module.refresh();
        }

        console.log(frames)
        frames.forEach(frame => drawFrame(frame));

        // somehow this just works, I think it's because there have been no updates since last call 
        // but since no updates, it adds an extr aframe... 
        // module.refresh()
    }

    let putBackgroundOn = (indices: [number, number][], effect?: Effect) => {

        let interp = new UniformInterpolateStrategy(numFrames, module);

        let framesColour = getShapeFrames(indices, interp);

        let flutter: Effect = new Static(2);
        if (effect) {
            flutter = effect;
        }

        let bg = new Background([width, height], framesColour);
        let bgFrames = framesColour.map(f => bg.drawBackground([f]));

        let withEffect = flutter.apply(bgFrames);
        let composed = bg.compose([framesColour], withEffect as boolean[][][]);

        let frames = interp.convertColourToUpdateIdx(composed);

        // let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(obj, startAt, endAt, hardware);
        updateSimulation(frames);
    }

    let indicesToBooleanUtil = (indices: [number, number][], starting?: boolean[][]): boolean[][] => {
        let basic = [...Array(height)].map(_ => [...Array(width)].map(_ => false));
        if (starting) {
            basic = starting;
        } 

        for (let [x,y] of indices) {
            basic[y][x] = true;
        }

        return basic;

    }

    let putShapeOn = (indices: [number, number][], effect?: Effect) => {
        let interp = new UniformInterpolateStrategy(numFrames, module);

        let framesColour = getShapeFrames(indices, interp);



        let flutter: Effect = new Static(2);
        if (effect) {
            flutter = effect;
        }

        let composed = flutter.apply(framesColour)
        let frames = interp.convertColourToUpdateIdx(composed as boolean[][][]);

        // let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(obj, startAt, endAt, hardware);
        updateSimulation(frames);

        // let previousFrameEffect = frameEffects[activeFrameIdx];

        // since it's after the animation is done... each sub-frame should have its own static 
        
        // actually, what this should do is add and modify new targets
        // frameEffects[activeFrameIdx] = [idxs => {
        //     // basically, if it's involved in indexes, you can modify it
        //     let relevantComponents = indicesToBooleanUtil(indices);
        //     // let ground = previousFrameEffect(idxs);
        //     if (effect) {
        //         relevantComponents = effect.apply([relevantComponents] as boolean[][][])[0] as boolean[][];
        //     }
        //     // return previousFrameEffect(relevantComponents);
        //     return relevantComponents;
        // }, 0]



    }

    let putAreaOn = (indices: [number, number][], radius: number, effect?: Effect) => {

        let interp = new UniformInterpolateStrategy(numFrames, module);
        let framesColour = getShapeFrames(indices, interp);
        let flutter: Effect = new Static(2);
        if (effect) {
            flutter = effect;
        }

        // let bg = new Background([width, height], framesColour);

        let area = new AreaEffect([2, 2], [width, height]);
        let areaFrame = framesColour.map(f => { area.setDrawableTargetSingle(f); return area.draw() });
        console.log(areaFrame)
        let composed = flutter.apply(areaFrame);

        // let composed = bg.compose([framesColour], withEffect);
        // console.log(composed)

        let frames = interp.convertColourToUpdateIdx(composed as boolean[][][]);

        // let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(obj, startAt, endAt, hardware);
        updateSimulation(frames);
    }

    let button = document.getElementById("convert");
    button?.addEventListener("click", () => {
        // flicker indices
        putShapeOn(latestIndices[activeShapeIdx]);
    })


    let shapeSelectArea = document.getElementById("shape-select")!;
    let makeNewShapeButton = document.getElementById("new-shape")!;
    makeNewShapeButton.addEventListener("click", () => {
        let selfShape = activeShapeIdx + 1;
        activeShapeIdx = selfShape;
        latestIndices.push([]);
        frameIndices[activeFrameIdx].push([]);

        let newButton = createShapeButton(selfShape);

        shapeButtons.push(newButton);
        shapeSelectArea.appendChild(newButton);
    })

    // where does area get its shape spec from? need to check that it's SELECTION not drawing id
    let newButton = createShapeButton(0);
    shapeButtons.push(newButton);
    shapeSelectArea.appendChild(newButton);

    let applyEffectButton = document.getElementsByClassName("apply-effect")!;
    for (let i = 0; i < applyEffectButton.length; i++) {
        let effect: Effect | undefined = applyEffectButton[i].id == "noise" ? new Noise("", [width, height]) : undefined;
        applyEffectButton[i].addEventListener("click", () => {
            // take selected pixels...
            // or just take the type..
            // TODO: this is a bad way to implement this, I should homogenize at some point
            if (applyEffectButton[i].id == "noise-bg") {
                backgroundEffect = (frames: boolean[][][]) => {
                    return new Noise("", [width, height]).apply(frames);
                };
                return;
            } 

            if (selectedArea == "foreground") {
                putShapeOn(frameIndices[activeFrameIdx][selectedShapeIdx], effect);
                // frameEffects[activeFrameIdx] = i => effect!.apply(i); // apply TODO 
                // here I need to just
                // I should re-architect all this... 
                // frameIndices[activeFrameIdx][selectedShapeIdx].push([new Shape]);
                if (effect) {
                    frameEffects[activeFrameIdx].push([effect, selectedShapeIdx]);
                }
            } else if (selectedArea == "background") {
                // ahah
                // 
                putBackgroundOn(frameIndices[activeFrameIdx][selectedShapeIdx], effect);
                // how do I access the background?
                frameEffects[activeFrameIdx].push([new Background([width, height], []), -1])

            } else if (selectedArea == "area") {
                putAreaOn(frameIndices[activeFrameIdx][selectedShapeIdx], 2, effect);
                let newEffect = new AreaEffect([2], [width, height]);
                if (effect) {
                    newEffect.style = effect;
                }
                frameEffects[activeFrameIdx].push([newEffect, selectedShapeIdx])
            } 
        })
    }

    

    let addSelections = document.getElementsByClassName("special-select");
    for (let i = 0; i < addSelections.length; i++) {
        addSelections[i].addEventListener("click", () => {
            selectedArea = "area";
            drawOnSelectionCanvas();
        })
    }


    let frameSelectArea = document.getElementById("frame-select")!;
    let makeNewFrameButton = document.getElementById("new-frame")!;
    makeNewFrameButton.addEventListener("click", () => {
        let selfFrame = activeFrameIdx + 1;
        activeFrameIdx = selfFrame;
        // TODO: this is weird, because if you haven't touched a shape between frames, it disappears?
        frameIndices.push(frameIndices[activeFrameIdx - 1].map(o => o.map(r => r)));
        frameEffects.push([])


        // also, make a way to access the shape 
        let newButton = createFrameButton(selfFrame);
        frameButtons.push(newButton);
        frameSelectArea.appendChild(newButton);
    })

    // also, make a way to access the shape 
    let newFrameButton = createFrameButton(0)
    frameButtons.push(newFrameButton);
    frameSelectArea.appendChild(newFrameButton);


    let animate = document.getElementsByClassName("animate");
    console.log(animate);
    for (let bi = 0; bi < animate.length; bi++) {
        animate[bi].addEventListener("click", () => {
            module.clear();

            for (let f = 0; f < frameIndices.length; f++) {
                console.log("=--==--=-=-=-=~~~~~~~~~~")
                console.log(f)
                // take the diff between each object... for now it's better to only support one object maybe
                // okay, I'll make every thing an individual object first...

                let interp = new UniformInterpolateStrategy(numFrames, module);
                let objs = [];

                let frame = frameIndices[f];
                for (let i = 0; i < latestIndices.length; i++) {
                    let indices = latestIndices[i];
                    if (f != 0) {
                        indices = frameIndices[f - 1][i];
                    }

                    let endIndices = frame[i];
                    // need to figure out boundaries 
                    let xMin = Math.min(...indices.map(x => x[0]));
                    let yMin = Math.min(...indices.map(x => x[1]));
                    let start: [number, number] = [xMin, yMin];
                    let xSize = Math.max(...indices.map(x => x[0])) - xMin;
                    let ySize = Math.max(...indices.map(x => x[1])) - yMin;

                    console.log(`this shape has xmin adn ymin ${xMin} ${yMin} at frame ${f}`)

                    let xMinEnd = Math.min(...endIndices.map(x => x[0]));
                    let yMinEnd = Math.min(...endIndices.map(x => x[1]));
                    let end: [number, number] = [xMinEnd, yMinEnd];

                    console.log(start, end)
                    let inputShape: [number, number][] = indices.map(x => [x[0] - xMin, x[1] - yMin]);

                    console.log(xSize, ySize)
                    let target = new PixelArtTarget(inputShape, [xSize, ySize], [width, height]);
                


                    let framesColour = interp.generateFrames(target, start, end);

                    // here, object style and schedule style might collide...
                    // framesColour = frameEffects[f][i](framesColour);

                    console.log(animate[bi])
                    if (animate[bi].id == "slide-noise") {
                        /// ... do something here to apply the effect onto each frame
                        // but also... it doesn't necessarily move the noise... 
                        // it might just be scrolling across the noise...

                        let effect = new Noise("", [width, height]);
                        framesColour = effect.apply(framesColour);
                        console.log("hei")
                    }

                    if (animate[bi].id == "move-noise") {
                        /// ... do something here to apply the effect onto each frame
                        // but also... it doesn't necessarily move the noise... 
                        // it might just be scrolling across the noise...

                        let effect = new MovingNoise("", [], [width, height]);
                        framesColour = effect.apply(framesColour);
                        console.log("hei")
                    }

                    function isEffect(tgt: Target | Effect): tgt is Effect {
                       return (<Effect>tgt).apply !== undefined;
                    }

                    function isDerviedTarget(tgt: DerivedTarget | Background | Effect): tgt is DerivedTarget {
                       return (<DerivedTarget>tgt).setTargetFrames !== undefined;
                    }

                    let effect = frameEffects[f].find(([e,z]) => i == z);
                    if (effect && isEffect(effect[0])) {
                        framesColour = effect[0].apply(framesColour) as boolean[][][];
                    } else if (effect && isDerviedTarget(effect[0])) {
                        // maybe this is a select, in which case... 
                        let area = effect[0] as DerivedTarget; // background must have index -1 anyway
                        let areaFrame = framesColour.map(f => { area.setTargetFrames([f]); return area.draw() });
                        if (area.style) {
                            areaFrame = area.style.apply(areaFrame) as boolean[][][];
                        }

                        objs.push(areaFrame);
                    }

                    console.log(framesColour);
                    objs.push(framesColour);
                    
                }
                // let interp = new AccelerateInterpolationStrategy(numFrames, hardware);

                let bg = new Background(module.dimensions, objs[0]);

                // also, background

                // but it's not organized by frame...
                console.log(objs)
                let objsByFrame = [...Array(numFrames).keys()].map(i => objs.map(o => o[i]));
                console.log(objsByFrame)
                
                let bgFrames = objsByFrame.map(f => bg.drawBackground(f));
                // wait, how do these things get combined...?
                bgFrames = backgroundEffect(bgFrames);


                let composed = bg.compose(objs, bgFrames);
                // let frames = interp.convertColourToUpdateIdx(framesColour);
                console.log(composed);

                // frame effects... are they also per tween frame? it's based on the selection in the original frame 
                // composed = composed.map(frame => frameEffects[f][0](frame));

                // the thing is, the selection is not moving... 
                // I should redo this.
                let frames = interp.convertColourToUpdateIdx(composed);


                // let frames = new AccelerateInterpolationStrategy(numFrames).generateFrames(obj, startAt, endAt, hardware);

                let drawFrame = (frame: number[]) => {
                    frame.forEach(pix => {
                        module.draw(pix, FlipDotState.coloured());
                    });
                    module.refresh();
                }

                // console.log(frames)
                frames.forEach(frame => drawFrame(frame));

                // somehow this just works, I think it's because there have been no updates since last call 
                module.refresh()
            }

        })

    }


    let dragStart: [number, number] | undefined = undefined;
    let dragIdx: number | undefined = undefined;
    endFrameCanvas.addEventListener("mousedown", (event) => {
        let rect = endFrameCanvas.getBoundingClientRect();
        let newX = Math.floor((event.x - rect.left) / pixelSize);
        let newY = Math.floor((event.y - rect.top) / pixelSize);
        dragStart = [newX, newY]

        // which thing was supposed to be dragged?

        for (let i = 0; i < latestIndices.length; i++) {
            if (latestIndices[latestIndices.length - i - 1].filter(i => i[0] == newX && i[1] == newY).length != 0) {
                console.log(newX, newY)

                // console.log("do it!!")
                // selection is the foreground
                dragIdx = latestIndices.length - i - 1;
                // this is really overcorrecting 
                break;
            }
        }
        console.log(dragIdx)
    })

    endFrameCanvas.addEventListener("mouseup", (event) => {
        let rect = endFrameCanvas.getBoundingClientRect();
        let newX = Math.floor((event.x - rect.left) / pixelSize);
        let newY = Math.floor((event.y - rect.top) / pixelSize);


        let deltaX = newX - dragStart![0];
        let deltaY = newY - dragStart![1];

        console.log(deltaX, deltaY)
        console.log(frameIndices[activeFrameIdx])
        let newIdxes: [number, number][] = [];
        for (let i = 0; i < frameIndices[activeFrameIdx][dragIdx!].length; i++) {
            // console.log("old: ", endFrameIndices[dragIdx!][i])
            newIdxes.push([frameIndices[activeFrameIdx][dragIdx!][i][0] + deltaX, frameIndices[activeFrameIdx][dragIdx!][i][1] + deltaY]);
            // console.log("new ", newIdxes[i]);

        }

        console.log(newIdxes)
        frameIndices[activeFrameIdx][dragIdx!] = newIdxes;

        console.log(frameIndices[activeFrameIdx])
        drawOnEndFrameCanvas();
        drawOnSelectionCanvas();
    })

    let drawOnEndFrameCanvas = () => {
        endFrameCtx?.clearRect(0, 0, endFrameCanvas.width, endFrameCanvas.height);
        for (let i = 0; i < frameIndices[activeFrameIdx].length; i++) {
            for (let [j0, j1] of frameIndices[activeFrameIdx][i]) {

                let colour = generatePixelData(shapeColourCycle[i % shapeColourCycle.length]);
                endFrameCtx?.putImageData(new ImageData(colour, pixelSize), j0 * pixelSize, j1 * pixelSize);
            }
        }
    }

    let reloadDrawingCanvs = () => {
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < latestIndices.length; i++) {
            for (let [j0, j1] of latestIndices[i]) {

                let colour = generatePixelData(shapeColourCycle[i % shapeColourCycle.length]);
                ctx?.putImageData(new ImageData(colour, pixelSize), j0 * pixelSize, j1 * pixelSize);
            }
        }
    }

    let mouseDownAt: [number, number] | undefined = undefined;

    let selectedArr = generatePixelData([120, 0, 0]);
    let drawOnSelectionCanvas = () => {
        console.log("drawing ", frameIndices[activeFrameIdx]);
        console.log(selectedArea)
        selectionCtx?.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

        console.log(selectedPixels)
        console.log(activeFrameIdx)
        if (selectedPixels.length == 0) {

            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    // todo: all shapes 
                    if (frameIndices[activeFrameIdx][selectedShapeIdx].filter(i => i[0] == x && i[1] == y).length != 0) {
                        if (selectedArea == "foreground") {
                            selectedPixels.push([x, y])
                        } else if (selectedArea == "area") {
                            let temp: [number, number][] = [];
                            for (let i = 0; i < 2; i++) {
                                for (let j = 0; j < 2; j++) {
                                    temp.push([x - i, y - j]);
                                    temp.push([x - i, y + j]);
                                    temp.push([x + i, y - j]);
                                    temp.push([x + i, y + j]);
                                }
                            }
                            temp = temp.filter(t => t[0] >= 0 && t[0] < width && t[1] >= 0 && t[1] < height);
                            selectedPixels = selectedPixels.concat(temp);
                        }
                    } else if (frameIndices[activeFrameIdx].flat().filter(i => i[0] == x && i[1] == y).length == 0) {
                        // if I select background, it should really be because NONE of the shapes intersected...
                        if (selectedArea == "background") {
                            selectedPixels.push([x, y])
                        }
                    }
                }
            }
        }

        // the order somewhat matters...
        for (let i = 0; i < frameIndices[activeFrameIdx].length; i++) {
            for (let [j0, j1] of frameIndices[activeFrameIdx][i]) {
                let colour = generatePixelData(shapeColourCycle[i % shapeColourCycle.length]);
                selectionCtx?.putImageData(new ImageData(colour, pixelSize), j0 * pixelSize, j1 * pixelSize);
            }
        }


        for (let [j0, j1] of selectedPixels) {
            selectionCtx?.putImageData(new ImageData(selectedArr, pixelSize), j0 * pixelSize, j1 * pixelSize);
        }

        if (selectedArea == "area") {
            for (let i = 0; i < frameIndices[activeFrameIdx].length; i++) {
                for (let [j0, j1] of frameIndices[activeFrameIdx][i]) {

                    let colour = generatePixelData(shapeColourCycle[i % shapeColourCycle.length]);
                    selectionCtx?.putImageData(new ImageData(colour, pixelSize), j0 * pixelSize, j1 * pixelSize);
                }
            }
        }


        selectedPixels = [];
    }

    canvas.addEventListener("mousedown", (event) => {

        let rect = canvas.getBoundingClientRect();
        let adjustedX = Math.floor((event.x - rect.left) / pixelSize);
        let adjustedY = Math.floor((event.y - rect.top) / pixelSize);

        let data = generatePixelData(shapeColourCycle[activeShapeIdx]);
        ctx?.putImageData(new ImageData(data, pixelSize), adjustedX * pixelSize, adjustedY * pixelSize);
        latestIndices[activeShapeIdx].push([adjustedX, adjustedY]);
        frameIndices[activeFrameIdx][activeShapeIdx].push([adjustedX, adjustedY]);
        drawOnSelectionCanvas();
        mouseDownAt = [adjustedX, adjustedY];
    });

    selectionCanvas.addEventListener("mousedown", (event) => {


        // something baout selection isn't quite right here... it's slightly off 
        // IF you draw once and draw again...

        var rect = selectionCanvas.getBoundingClientRect();
        let newX = Math.floor((event.x - rect.left) / pixelSize);
        let newY = Math.floor((event.y - rect.top) / pixelSize);

        // need to figure out which index actually belongs 
        let found = false;
        for (let i = 0; i < frameIndices[activeFrameIdx].length; i++) {
            if (frameIndices[activeFrameIdx][i].filter(i => i[0] == newX && i[1] == newY).length != 0) {
                console.log("do it!!")
                // selection is the foreground
                selectedArea = "foreground";
                selectedShapeIdx = i;
                found = true;
            }
        }
        if (!found) {

            console.log("did it")
            // selection is the background
            selectedArea = "background";

        }



        drawOnSelectionCanvas();
        drawOnEndFrameCanvas();
    })

    canvas.addEventListener("mouseup", (event) => {
        if (mouseDownAt != undefined) {

            let rect = canvas.getBoundingClientRect();
            let adjustedX = Math.floor((event.x - rect.left) / pixelSize);
            let adjustedY = Math.floor((event.y - rect.top) / pixelSize);
            let change: [number, number][] = [];
            if (drawingMode == "line") {
                change = line(mouseDownAt[0], mouseDownAt[1], adjustedX, adjustedY);

            } else if (drawingMode == "square") {
                // why is this so big? hmmm 
                change = square(mouseDownAt[0], mouseDownAt[1], adjustedX, adjustedY);
            }

            let data = generatePixelData(shapeColourCycle[activeShapeIdx]);
            for (let [j0, j1] of change) {

                ctx?.putImageData(new ImageData(data, pixelSize), j0 * pixelSize, j1 * pixelSize);

                latestIndices[activeShapeIdx].push([j0, j1])
                frameIndices[activeFrameIdx][activeShapeIdx].push([j0, j1])
            }
            drawOnSelectionCanvas();
            drawOnEndFrameCanvas();

            mouseDownAt = undefined;
            console.log(latestIndices)
        }
    });

    // we should have a duplicate canvas - a drawing canvas and a selection canvas

    // canvas.addEventListener("")


    let parseImagesIntoFrames = async (urls: string[]) => {

        let loader = new ImageBitmapLoader();
        // loader.setOptions({ imageOrientation: 'flipY' })

        var canvas = document.createElement('canvas');
        let context2d = canvas.getContext('2d', { willReadFrequently: true })!;
        canvas.width = width;
        canvas.height = height;
        let frames = [];
        // can't use for loop here or order will be disrupted?
        let promises = urls.map(async url => {
            return await loader.loadAsync(url);
        })

        frames = await Promise.all(promises);

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
        let allShapesAllFrames: [number, number][][][] = [...rgbToId.keys()].map(id => []);
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
                let indices: [number, number][] = booleanFrame.map((row, i) => row.map((c, j) => c ? [j,i] as [number, number] : undefined)).flat(1).filter((i: [number, number] | undefined) => i != undefined);
                // let shapeFrame = getShapeFrames(indices, interp);
                // allFrameData.push(shapeFrame);
                // okay!
                eachFrameData.push(indices);
                allShapesAllFrames[id].push(indices);
            }
            allFramesAllShapes.push(eachFrameData);
        }

        // frameIndices = allShapesAllFrames;
        frameIndices = allFramesAllShapes;
        frameEffects = allFramesAllShapes.map(_ => []);
        if (allFramesAllShapes.length >= 1) {
            latestIndices = frameIndices[0];
        }

        for (let i = 1; i < frameIndices.length; i++) {
            let newButton = createFrameButton(i);
            frameSelectArea.appendChild(newButton);
            frameButtons.push(newButton);
        }

        for (let [id, rgb] of rgbToId) {
            if (id > 0) {
                console.log(id)
                let button = createShapeButton(id);

                shapeSelectArea.appendChild(button);
                shapeButtons.push(button);
            }
        }

        drawOnEndFrameCanvas();
        drawOnSelectionCanvas();
        reloadDrawingCanvs();


        // cool, this basically acts as intermediate frames.
        // i'll set the first one 

        // the thing is... I want to load these into different frames. 
        // now I need to add the appropriate buttons... 

    }

    document.getElementById("golf")!.addEventListener("click", () => {
        parseImagesIntoFrames([1,2,3,4,5,6,7,8,9].map(i => `/animations/golf${i}.png`));
    })

    document.getElementById("golf2")!.addEventListener("click", () => {
        parseImagesIntoFrames([1,2,3,4,5,6,7,8,9].map(i => `/animations/golf-coloured${i}.png`));
    })
});


function generatePixelData(rgb: [number, number, number]) {
    const arr = new Uint8ClampedArray(pixelSize * pixelSize * 4);

    // Fill the array with the same RGBA values
    for (let i = 0; i < arr.length; i += 4) {
        arr[i + 0] = rgb[0]; // R value
        arr[i + 1] = rgb[1]; // G value 
        arr[i + 2] = rgb[2]; // B value
        arr[i + 3] = 255; // A value
    }

    return arr;
}

const { abs, sign } = Math;

function square(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    // need to ensure that the start and end are ordered properly for this.
    let startX = x0 < x1 ? x0 : x1;
    let startY = y0 < y1 ? y0 : y1;

    let endX = x0 > x1 ? x0 : x1;
    let endY = y0 > y1 ? y0 : y1;


    let result: [number, number][] = [];
    for (let x = startX; x < endX; x++) {
        for (let y = startY; y < endY; y++) {
            result.push([x, y]);
        }
    }

    return result;
}

function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    let coords: [number, number][] = []
    const dx = abs(x1 - x0);
    const dy = abs(y1 - y0);
    const sx = sign(x1 - x0);
    const sy = sign(y1 - y0);
    let err = dx - dy;

    while (true) {
        coords.push([x0, y0]);
        // setPixel(x0, y0); // Do what you need to for this

        if (x0 === x1 && y0 === y1) break;

        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return coords;
}
// I should write a target parser...
// take in different colours and make different objects with them (that deform over time)
// also, add multiple frames to the existing...
