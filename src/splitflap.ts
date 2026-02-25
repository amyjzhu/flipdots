// trying to replicate the physics of a real split flap is kinda complicated
// for one, there are a bunch of flaps on a wheel, so they need to obey gravity at the right time
// instead, maybe we should have just one split flap, and load the texture of the front and back at the right time.
// then just simulate it falling down
import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { ALPHABET_WITH_EXCLAMATION, FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING, SPLIT_FLAP_CYCLE_LENGTH } from './constants';

let rotFlapBack = -0.5;

export class SplitFlapDisplay {
    width: number;
    height: number;
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    listener: THREE.AudioListener;

    dummy = new THREE.Object3D();
    instanced: THREE.InstancedMesh | undefined;

    audios: THREE.Object3D[] = [];

    flaps: [THREE.Object3D, THREE.Object3D, THREE.Object3D][] = [];
    // canvases: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement][] = [];
    // canvases: [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D][] = [];

    setNextFlips: (f: number) => (i: number) => [number | undefined, number | undefined] = f => i => [undefined, undefined];
    canvases: THREE.Material[] = [];
    canvasBacks: THREE.Material[] = [];
    flipCycle: number[][] = [];
    flapPos: number[] = [];

    animationFrameCounters: number[] = [];
    flipCycles: number[] = [];

    // updateIdxs: (number[] = [];

    basicMaterial = new THREE.MeshBasicMaterial({ color: "black" });

    numFramesRotating = NUM_FRAMES_ROTATING;
    splitFlapCycleLength = SPLIT_FLAP_CYCLE_LENGTH;

    // this should be just the offsets 
    perPixelPauses: (number | undefined)[] = [];
    perPixelCycleLength: (number | undefined)[] = [];

    constructor(width: number, height: number, numFramesRotating?: number, splitFlapCycleLength?: number) {
        if (numFramesRotating) {
            this.numFramesRotating = numFramesRotating;
        }

        if (splitFlapCycleLength) {
            this.splitFlapCycleLength = splitFlapCycleLength;
        }


        this.width = width;
        this.height = height;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        // create an AudioListener and add it to the camera
        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        // where to put the camera? depends... 
        // not really sure how to automatically calculate z...
        this.camera.position.z = 100;
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setAnimationLoop(this.animate);
        document.body.appendChild(this.renderer.domElement);

        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        this.initScene();

        this.makeRowsOfSplitFlaps(width, height);

        this.makeAlphabetCycle();
        this.setUpAlphabetRolls();

        this.animate();


    }

    initScene() {

        // skybox
        const geometry = new THREE.BoxGeometry(450, 450, 450);
        var materials = [
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Left.bmp'),
                side: THREE.BackSide,
            }),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Right.bmp'),
                side: THREE.BackSide,
            }),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Top.bmp'),
                side: THREE.BackSide,
            }),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Bottom.bmp'),
                side: THREE.BackSide,
            }),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Back.bmp'),
                side: THREE.BackSide,
            }),
            new THREE.MeshBasicMaterial({
                map: new THREE.TextureLoader().load('/skybox/Daylight Box_Front.bmp'),
                side: THREE.BackSide,
            }),
        ];
        const cube = new THREE.Mesh(geometry, materials);

        this.scene.add(cube);

        const ambientLight = new THREE.AmbientLight(0x404040); // Soft white light
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight2.position.set(1, 1, -1);
        this.scene.add(directionalLight2);

        // const axesHelper = new THREE.AxesHelper( 5 );
        // scene.add( axesHelper );

        // var vnh = new VertexNormalsHelper( cube, 1, 0xff0000 );
        // this.scene.add( vnh );
    }

    makeAlphabetCycle() {
        // for (let letter of 'abcdefg'.split('')) {
        // this is so stupid... has to be multiples of three
        for (let letter of ALPHABET_WITH_EXCLAMATION.split('')) {
            for (let top of [true, false]) {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d")!;
                // ctx.font = "100px Arial";
                ctx.font = "250px Arial";
                let textColour = "white"; // "red"
                ctx.fillStyle = textColour;
                let texture;
                if (top) {
                    ctx.fillText(letter, 70, 250);
                    // ctx.fillText("F" + letter, 70, 70);
                    texture = new THREE.CanvasTexture(canvas);

                    let material = new THREE.MeshBasicMaterial({
                        map: texture
                    });
                    this.canvases.push(material);
                } else {
                    // ctx.scale(-1,1);
                    // ctx.translate(canvas.width, 0);
                    // ctx.translate(0, canvas.height);
                    // ctx.scale(-1, 1);
                    // ctx.fillText("B" + letter, 70, 70);

                    ctx.fillText(letter, 70, 100);
                    texture = new THREE.CanvasTexture(canvas);

                    // texture.flipY = false;

                    let material = new THREE.MeshBasicMaterial({
                        map: texture
                    });
                    this.canvasBacks.push(material);
                }
                document.body.appendChild(canvas);

            }
        }
    }

    setUpAlphabetRolls() {
        for (let _ of this.flaps) {
            // this.flipCycle.push([...new Array(6).keys()]);
            this.flipCycle.push([...new Array(28).keys()]);
            this.flapPos.push(0);
        }
    }

    resetAnimation = (newFlip: (f: number) => (i: number) => [number | undefined, number | undefined]) => {
        
        for (let idx of this.flaps) {
            let [falling, rising, stepping] = idx;
            console.log("resetting: ", falling.rotation.x, rising.rotation.x, stepping.rotation.x)
            // "about to start" doing what we say
            rising.rotation.x = 0;
            falling.rotation.x = 0;
            stepping.rotation.x =  rotFlapBack;

        }
        // console.log(this.flipCycles)
        // console.log(this.idxToUpdate)
        this.animationFrameCounters = this.flaps.map(_ => 0);
        this.setNextFlips = newFlip;
        console.log("I'm setting perPixelPauses")
        this.perPixelPauses = this.flaps.map((f, i) => newFlip(0)(i)[0]);
        // I assume I should reset this?
        this.flipCycles = this.flaps.map(_ => 0);

    }

    generateCanvasTexture(colour: string): [THREE.Texture, HTMLCanvasElement] {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = "250px Arial";
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // if (top) {
        //     ctx.fillStyle = "blue";
        //     ctx.fillRect(0, 0, canvas.width, canvas.height);
        // } else {
        //     ctx.fillStyle = "white";
        //     ctx.fillRect(0, 0, canvas.width, canvas.height);
        // }
        
        // document.body.appendChild(canvas);

        let texture = new THREE.CanvasTexture(canvas);

        return [texture, canvas];
    }

    SPACING_X = 7;
    SPACING_Y = 15;
    WIDTH = 5;
    HEIGHT = 7;

    makeRowsOfSplitFlaps(numWide: number, numTall: number) {
        let backingBorder = 10;
        let offsetZ = -5;

        for (let j = 0; j < numTall; j++) {
            // let row = [];
            for (let i = 0; i < numWide; i++) {



                let [obj1, c1, c2] = this.makePiece(true);
                let pivot = new THREE.Object3D();
                obj1.position.set(0, 3.75, 0)
                pivot.add(obj1);
                pivot.position.set(i * this.SPACING_X, j * this.SPACING_Y - 3.5, 0)
                this.scene.add(pivot)

                let [obj2, c3, c4] = this.makePiece(false);
                let pivot2 = new THREE.Object3D();
                obj2.position.set(0, -3.75, 0);
                pivot2.add(obj2);
                pivot2.position.set(i * this.SPACING_X, j * this.SPACING_Y - 3.5, 0);
                this.scene.add(pivot2)

                // this will be the third piece that movees down/up 
                let [obj3, c5, c6] = this.makePiece(true);
                let pivot3 = new THREE.Object3D();
                obj3.position.set(0, 3.75, 0);
                pivot3.add(obj3);
                pivot3.position.set(i * this.SPACING_X, j * this.SPACING_Y - 3.5, 0);
                pivot3.rotation.x = rotFlapBack;
                this.scene.add(pivot3)

                // let obj3 = makePiece(false)
                // obj3.position.set(0, 0, 0)
                // this.scene.add(obj3)

                this.flaps.push([pivot, pivot2, pivot3]);
                // this.canvases.push([c1, c2, c3, c4, c5, c6]);



                // this.dummy.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);
                // this.dummy.updateMatrix();

                // // may have to update colours here in the future
                // this.instanced!.setMatrixAt(j * this.width + i, this.dummy.matrix);
                // // instanced.setColorAt()

            }

            this.flipCycles = this.flaps.map(_ => 0);
            this.animationFrameCounters = this.flaps.map(_ => 0);
        }

        let backing = new THREE.BoxGeometry(numWide * this.SPACING_X + backingBorder, numTall * this.SPACING_Y + backingBorder, 4);
        let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 })
        let backingPiece = new THREE.Mesh(backing, backingMaterial);
        this.scene.add(backingPiece)
        // should be behind the discs.
        backingPiece.position.set((this.SPACING_X * numWide - backingBorder)/2, (this.SPACING_Y * numTall - backingBorder)/2, offsetZ)
    }

    makePiece = (top: boolean): [THREE.Mesh, HTMLCanvasElement, HTMLCanvasElement] => {
        let geometry = new THREE.BoxGeometry(this.WIDTH, this.HEIGHT, 0.5);

        let [frontTexture, c] = this.generateCanvasTexture("white");

        let [backTexture, c2] = this.generateCanvasTexture("black");

        let basicMaterial = this.basicMaterial;
        var material = new THREE.MeshBasicMaterial({
            map: frontTexture
        });

        // the back texture should actually be flipped and reversed... 
        let backMaterial = new THREE.MeshBasicMaterial({
            map: backTexture
        });

        let obj = new THREE.Mesh(geometry, [basicMaterial, basicMaterial, basicMaterial, basicMaterial, material, backMaterial]);
        return [obj, c, c2];

    }

    makeTexture = (imageFront: HTMLCanvasElement, imageBack: HTMLCanvasElement) => {
        let basicMaterial = new THREE.MeshBasicMaterial({ color: "black" });
        var material = new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(imageFront)
        });

        // the back texture should actually be flipped and reversed... 
        let backMaterial = new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(imageBack)
        });

        return [basicMaterial, basicMaterial, basicMaterial, basicMaterial, material, backMaterial]
    }

    runningCount = 0;
    animate = () => {
        // let OFFSET = this.numFramesRotating / 3;

        let PAUSE_DEFAULT = Math.floor(this.numFramesRotating / 3);

        // what's going on? why is this like 100?
        // if (this.animationFrameCounters.filter(a => a != 0).length != 0) console.log("inside animate", this.animationFrameCounters.filter(a => a != 0))
        for (let idx = 0; idx < this.flaps.length; idx++) {
            
            let perPixelPause = this.perPixelPauses.length > idx ? this.perPixelPauses[idx] : PAUSE_DEFAULT;
           // let perPixelCycleLength = this.perPixelCycleLength.length > idx ? this.perPixelCycleLength[idx] : this.splitFlapCycleLength;

            if (perPixelPause == undefined) {
                // skip this one
                // console.log("undefined")
                continue;
            }
            
            let perPixelCycleLength = perPixelPause + this.numFramesRotating;
            
            let [falling, rising, stepping] = this.flaps[idx];
            let rad2deg = (r: number) => r *  180 / Math.PI;
            
            // console.log(rad2deg(stepping.rotation.x))
            if (perPixelPause + this.numFramesRotating > perPixelCycleLength) {
                throw new Error("pause is too long")
            }

            // during each flip, I want to do three things.
            // the step flap will move forward. (during OFFSET) - angle / num frames for offset -> bcames stepping
            // the flap that is falling will fall to the bottom (after OFFSET) - angle change / num frames minus offset -> becomes falling
            // the flap that is at the bottom will move to step position (after OFFSET) -> becomes rising 
            

            if (this.animationFrameCounters[idx] < perPixelPause) {
                // this doesn't seem super consistent?
                // todo?
                // why does this move it doubly up?
                // console.log("inside offset ", this.animationFrameCounters[idx], rad2deg(rotFlapBack * -1 / perPixelPause), rad2deg(stepping.rotation.x));
                // countOffset += 1;
                // console.log("completing (offset): ", this.animationFrameCounters[idx], perPixelPause, rad2deg(rotFlapBack * -1 / perPixelPause),rad2deg(stepping.rotation.x))

                stepping.rotation.x += rotFlapBack * -1 / perPixelPause;
            } else if (this.animationFrameCounters[idx] >= perPixelPause && this.animationFrameCounters[idx] < perPixelCycleLength) {
                // console.log("inside rotate", this.animationFrameCounters[idx])
                // countRotate += 1;
            // } else if (this.animationFrameCounters[idx] >= perPixelPause && this.animationFrameCounters[idx] < this.numFramesRotating + perPixelPause) {
                rising.rotation.x += (Math.PI - (rotFlapBack * -1)) / (this.numFramesRotating);
                falling.rotation.x += Math.PI / (this.numFramesRotating)
            } else if (this.animationFrameCounters[idx] >= perPixelCycleLength) {
                // console.log("completing: ",  this.flaps[idx].map(f => rad2deg(f.rotation.x)))
                let nextIdx = this.flapPos[idx] + 1 >= this.flipCycle[idx].length ? 0 : this.flapPos[idx] + 1;
                
                let front = this.canvases[this.flipCycle[idx][this.flapPos[idx]]];
                let back = this.canvasBacks[this.flipCycle[idx][nextIdx]];
                this.flapPos[idx] = nextIdx;
                
                ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[4] = front;
                ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[5] = back;
                 
                if (this.flapPos[idx] % 3 == 0) {
                    let backTexture = (back as THREE.MeshBasicMaterial).map!;
                    backTexture.center.set(0.5, 0.5);  // rotate around the center
                    backTexture.rotation = Math.PI;    // 180 degrees
                    backTexture.needsUpdate = true;
                
                } else if (this.flapPos[idx] % 3 == 1) { 
                    let texture = (front as THREE.MeshBasicMaterial).map!;
                    texture.center.set(0.5, 0.5);  // rotate around the center
                    texture.rotation = Math.PI;    // 180 degrees
                    texture.needsUpdate = true;
                    ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[4] = back;
                    ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[5] = front;

                } else if (this.flapPos[idx] % 3 == 2) {
                    let backTexture = (back as THREE.MeshBasicMaterial).map!;
                    backTexture.center.set(0.5, 0.5);  // rotate around the center
                    backTexture.rotation = Math.PI;    // 180 degrees
                    backTexture.needsUpdate = true;
                }

                // I need to figure out something about how to advance this.
                // start with the first next flips... 
                this.flaps[idx] = [stepping, falling, rising];

                let [newPause, newCycle] = this.setNextFlips(this.flapPos[idx])(idx);
                this.perPixelPauses[idx] = newPause;
            }

            if (this.animationFrameCounters[idx] >= perPixelCycleLength) {
                // console.log("all done ", this.animationFrameCounters[idx])
                // console.log(rad2deg(rotFlapBack), rad2deg((Math.PI - (rotFlapBack * -1)) / (this.numFramesRotating)), rad2deg(Math.PI / (this.numFramesRotating)), rad2deg( rotFlapBack * -1 / perPixelPause / 2), rad2deg( rotFlapBack * -1 / perPixelPause), this.flaps[idx].map(f => rad2deg(f.rotation.x)))
                console.log(this.flaps[idx].map(x => x.rotation.x / Math.PI))
                this.animationFrameCounters[idx] = 0;
                // rising, falling, stepping
                this.flaps[idx][0].rotation.x = Math.PI
                this.flaps[idx][1].rotation.x = 0;
                this.flaps[idx][2].rotation.x = -1 * rotFlapBack;
                console.log("perpixelcyclelength is", perPixelCycleLength, this.animationFrameCounters[idx], perPixelPause, this.numFramesRotating);

                
            } else {

                this.animationFrameCounters[idx] += 1;
            }

        }

        this.renderer.render(this.scene, this.camera);

    }
}