// trying to replicate the physics of a real split flap is kinda complicated
// for one, there are a bunch of flaps on a wheel, so they need to obey gravity at the right time
// instead, maybe we should have just one split flap, and load the texture of the front and back at the right time.
// then just simulate it falling down
import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';
import { FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING, SPLIT_FLAP_CYCLE_LENGTH } from './constants';

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

    nextLetter = "A";
    canvases: THREE.Material[] = [];
    canvasBacks: THREE.Material[] = [];
    flipCycle: number[][] = [];
    flapPos: number[] = [];

    animationFrameCounter = 0;
    flipCycles: number[] = [];

    updateIdxs: number[] = [];

    basicMaterial = new THREE.MeshBasicMaterial({ color: "black" });

    numFramesRotating = NUM_FRAMES_ROTATING;
    splitFlapCycleLength = SPLIT_FLAP_CYCLE_LENGTH;

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

        this.makeRowsOfSplitFlaps(5, 7);

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
        for (let letter of 'abcdefg'.split('')) {
            // this is so stupid... has to be multiples of three
            // for (let letter of 'abcdefghijklmnopqrstuvwxyz!'.split('')) {
            for (let top of [true, false]) {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d")!;
                ctx.font = "100px Arial";
                // ctx.font = "250px Arial";
                ctx.fillStyle = "red";
                let texture;
                if (top) {
                    // ctx.fillText(letter, 70, 250);
                    ctx.fillText("F" + letter, 70, 70);
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
                    ctx.fillText("B" + letter, 70, 70);

                    // ctx.fillText(letter, 70, 100);
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
            this.flipCycle.push([...new Array(6).keys()]);
            // this.flipCycle.push([...new Array(27).keys()]);
            this.flapPos.push(0);
        }
    }

    generateCanvasTexture(colour: string, top: boolean): [THREE.Texture, HTMLCanvasElement] {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = "250px Arial";
        ctx.fillStyle = colour;
        if (top) {
            ctx.fillText(this.nextLetter, 70, 250);
        } else {
            ctx.fillText(this.nextLetter, 70, 100);
        }
        // document.body.appendChild(canvas);

        let texture = new THREE.CanvasTexture(canvas);

        return [texture, canvas];
    }

    SPACING_X = 7;
    SPACING_Y = 15;
    WIDTH = 5;
    HEIGHT = 7;

    makeRowsOfSplitFlaps(numTall: number, numWide: number) {
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
                this.updateIdxs = [0];


                // this.dummy.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);
                // this.dummy.updateMatrix();

                // // may have to update colours here in the future
                // this.instanced!.setMatrixAt(j * this.width + i, this.dummy.matrix);
                // // instanced.setColorAt()

            }

            this.flipCycles = this.flaps.map(_ => 0);
        }

        let backing = new THREE.BoxGeometry(numWide * this.SPACING_X + backingBorder, numTall * this.SPACING_Y + backingBorder, 4);
        let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 })
        let backingPiece = new THREE.Mesh(backing, backingMaterial);
        this.scene.add(backingPiece)
        // should be behind the discs.
        backingPiece.position.set(this.WIDTH * numWide - this.WIDTH - backingBorder / 2, this.HEIGHT * numTall - this.HEIGHT - backingBorder / 2, offsetZ)
    }

    makePiece = (top: boolean): [THREE.Mesh, HTMLCanvasElement, HTMLCanvasElement] => {
        let geometry = new THREE.BoxGeometry(this.WIDTH, this.HEIGHT, 0.5);

        let [frontTexture, c] = this.generateCanvasTexture("white", top);

        let [backTexture, c2] = this.generateCanvasTexture("green", top);

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

    // makeSplitFlapPiece = (top: boolean): [THREE.Mesh, HTMLCanvasElement, HTMLCanvasElement] => {
    //     let geometry = new THREE.BoxGeometry(this.WIDTH, this.HEIGHT, 0.5);

    //     let [frontTexture, c] = this.generateCanvasTexture("white", top);

    //     let [backTexture, c2] = this.generateCanvasTexture("green", top);

    //     let basicMaterial = new THREE.MeshBasicMaterial({ color: "black" });
    //     var material = new THREE.MeshBasicMaterial({
    //         map: frontTexture
    //     });

    //     // the back texture should actually be flipped and reversed... 
    //     let backMaterial = new THREE.MeshBasicMaterial({
    //         map: backTexture
    //     });

    //     let obj = new THREE.Mesh(geometry, [basicMaterial, basicMaterial, basicMaterial, basicMaterial, material, backMaterial]);
    //     return [obj, c, c2];

    // }

    // makeSplitFlap() {
    //     let geometry = new THREE.BoxGeometry(this.WIDTH, this.HEIGHT, 1);
    //     // it should be skinny and long
    //     // now, I need to apply the correct texture on all sides/.. 

    //     let makePiece = (top: boolean): [THREE.Mesh, CanvasRenderingContext2D, CanvasRenderingContext2D] => {

    //         let [frontTexture, c] = this.generateCanvasTexture("white", top);

    //         let [backTexture, c2] = this.generateCanvasTexture("green", top);

    //         let basicMaterial = new THREE.MeshBasicMaterial();
    //         var material = new THREE.MeshBasicMaterial({
    //             map: frontTexture
    //         });

    //         // the back texture should actually be flipped and reversed... 
    //         let backMaterial = new THREE.MeshBasicMaterial({
    //             map: backTexture
    //         });

    //         let obj = new THREE.Mesh(geometry, [basicMaterial, basicMaterial, basicMaterial, basicMaterial, material, backMaterial]);
    //         return [obj, c, c2];

    //     }

    //     let [obj1, c1, c2] = makePiece(true);
    //     let pivot = new THREE.Object3D();
    //     obj1.position.set(0,3.5,0)
    //     pivot.add(obj1);
    //     pivot.position.set(0, -3.5, 0)
    //     this.scene.add(pivot)

    //     let [obj2, c3, c4] = makePiece(false);
    //     let pivot2 = new THREE.Object3D();
    //     obj2.position.set(0, -3.5, 0);
    //     pivot2.add(obj2);
    //     pivot2.position.set(0, -3.5, 0);
    //     this.scene.add(pivot2)

    //     // let obj3 = makePiece(false)
    //     // obj3.position.set(0, 0, 0)
    //     // this.scene.add(obj3)

    //     this.flaps.push([pivot, pivot2]);
    //     this.canvases.push([c1, c2, c3, c4]);
    //     this.updateIdxs = [0];
    // }



    animate = () => {
        let OFFSET = this.numFramesRotating / 3;
        let rotationRate = Math.PI / this.numFramesRotating;

        // this.renderer.render(this.scene, this.camera);
        let done = false;

        for (let i = 0; i < this.updateIdxs.length; i++) {
            console.log()
            let idx = this.updateIdxs[i];
            let [falling, rising, stepping] = this.flaps[idx];

            // during each flip, I want to do three things.
            // the step flap will move forward. (during OFFSET) - angle / num frames for offset -> bcames stepping
            // the flap that is falling will fall to the bottom (after OFFSET) - angle change / num frames minus offset -> becomes falling
            // the flap that is at the bottom will move to step position (after OFFSET) -> becomes rising 

            if (this.animationFrameCounter < OFFSET) {
                // todo?
                stepping.rotation.x += rotFlapBack * -1 / OFFSET;
                // console.log(rotFlapBack, OFFSET)
                // console.log("rot flap back", rotFlapBack / OFFSET);
            } else if (this.animationFrameCounter >= OFFSET && this.animationFrameCounter < this.numFramesRotating) {
                // falling.rotation.x += rotationRate;
                // console.log("rotation rate", rotationRate)
                // rising.rotation.x += rotFlapBack / this.numFramesRotating;
                rising.rotation.x += (Math.PI - (rotFlapBack * -1)) / (this.numFramesRotating - OFFSET);
                falling.rotation.x += Math.PI / (this.numFramesRotating - OFFSET)
                // this one is negative 
                // console.log("rot flap back / num frames rotating", rotFlapBack / this.numFramesRotating);
            }

            if (this.animationFrameCounter >= this.splitFlapCycleLength) {
                
                
                // idk why but I need this?
                this.flipCycles[idx] += 1;
                // reset the rising falling etc 

                let nextIdx = this.flapPos[i] + 1 >= this.flipCycle[i].length ? 0 : this.flapPos[i] + 1;

                let front = this.canvases[this.flipCycle[i][this.flapPos[i]]];
                let back = this.canvasBacks[this.flipCycle[i][nextIdx]];
                // let front = this.canvases[this.flipCycle[i][this.flapPos[i]]];
                // let back = this.canvasBacks[this.flipCycle[i][this.flapPos[i]]];
                

                ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[4] = front;
                ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[5] = back;
                // console.log(this.flipCycles[idx])
                // this is just dumb as fuck but idc 
                if (this.flipCycles[idx] % 3 == 0) {
                    // front.toneMapped.flipY = false;

                    let texture = (front as THREE.MeshBasicMaterial).map!;
                    // texture.center.set(0.5, 0.5);  // rotate around the center
                    // texture.rotation = -Math.PI/5;    // 180 degrees
                    // texture.needsUpdate = true;


                    let backTexture = (back as THREE.MeshBasicMaterial).map!;
                    // Flip vertically
                    // backTexture.flipY = false;
                    backTexture.center.set(0.5, 0.5);  // rotate around the center
                    backTexture.rotation = Math.PI;    // 180 degrees
                    backTexture.needsUpdate = true;



                } else if (this.flipCycles[idx] % 3 == 1) { // 0, 2
                    // ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[4] = this.canvasBacks[this.flipCycle[i][nextIdx]];

                    // ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[5] = this.canvases[this.flipCycle[i][this.flapPos[i]]];


                    let texture = (front as THREE.MeshBasicMaterial).map!;
                    texture.center.set(0.5, 0.5);  // rotate around the center
                    texture.rotation = Math.PI;    // 180 degrees
                    texture.needsUpdate = true;

                    // front.toneMapped.flipY = false;

                    let backTexture = (back as THREE.MeshBasicMaterial).map!;
                    // Flip vertically
                    // backTexture.flipY = false;

                    // I wonder if the rotation is supposed to alternate...
                    // backTexture.center.set(0.5, 0.5);  // rotate around the center
                    // backTexture.rotation = Math.PI;    // 180 degrees
                    // backTexture.needsUpdate = true;



                    ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[4] = back;

                    ((rising.children[0] as THREE.Mesh).material as THREE.Material[])[5] = front;



                } else if (this.flipCycles[idx] % 3 == 2) {

                    // front.toneMapped.flipY = false;


                    let texture = (front as THREE.MeshBasicMaterial).map!;
                    // texture.center.set(0.5, 0.5);  // rotate around the center
                    // texture.rotation = Math.PI/5;    // 180 degrees
                    // texture.needsUpdate = true;


                    let backTexture = (back as THREE.MeshBasicMaterial).map!;
                    // Flip vertically
                    // backTexture.flipY = false;
                    backTexture.center.set(0.5, 0.5);  // rotate around the center
                    backTexture.rotation = Math.PI;    // 180 degrees
                    backTexture.needsUpdate = true;

                }

                // console.log("UPDATING RISING TO: ", this.flipCycle[i][this.flapPos[i]], this.flipCycle[i][nextIdx])
                this.flapPos[i] = nextIdx;
                this.flaps[idx] = [stepping, falling, rising];

                // console.log("flip complete")
                // done = true;
                // continue;

            }

        }

        // if (done) {
        if ( this.animationFrameCounter >= this.splitFlapCycleLength) {
            console.log("all done")
            this.animationFrameCounter = 0;


            if (this.updateIdxs.length < this.flaps.length) {
                this.updateIdxs.push(this.updateIdxs[this.updateIdxs.length-1] + 1);
                console.log(this.updateIdxs)
            }
            // if (this.animationFrameCounter >= this.splitFlapCycleLength) {
            //     console.log('flip complete');
            //     this.flipCycles = 0;
            //     this.animationFrameCounter = 0;
            // }

        } else {
            this.animationFrameCounter += 1;
        }
        this.renderer.render(this.scene, this.camera);

    }
}