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
    canvases: [CanvasRenderingContext2D,CanvasRenderingContext2D,CanvasRenderingContext2D,CanvasRenderingContext2D, CanvasRenderingContext2D,CanvasRenderingContext2D][] = [];

    nextLetter = "A";

    updateIdxs: number[] = [];

    constructor(width: number, height: number) {

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

        this.makeRowsOfSplitFlaps(5,7);

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

    generateCanvasTexture(colour: string, top: boolean): [THREE.Texture, CanvasRenderingContext2D] {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        ctx.font = "250px Arial";
        ctx.fillStyle = colour;
        if (top) {
            ctx.fillText(this.nextLetter, 70, 250);
        } else {
            ctx.fillText(this.nextLetter, 70, 100);
        }
        document.body.appendChild(canvas);
        
        let texture = new THREE.CanvasTexture(canvas);

        return [texture, ctx];
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
        obj1.position.set(0,3.75,0)
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
        let [obj3, c5, c6] = this.makePiece(false);
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
        this.canvases.push([c1, c2, c3, c4, c5, c6]);
        this.updateIdxs = [0];


                // this.dummy.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);
                // this.dummy.updateMatrix();

                // // may have to update colours here in the future
                // this.instanced!.setMatrixAt(j * this.width + i, this.dummy.matrix);
                // // instanced.setColorAt()

            }
        }
        
        let backing = new THREE.BoxGeometry(numWide * this.SPACING_X + backingBorder, numTall * this.SPACING_Y + backingBorder, 4);
        let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 })
        let backingPiece = new THREE.Mesh(backing, backingMaterial);
        this.scene.add(backingPiece)
        // should be behind the discs.
        backingPiece.position.set(this.WIDTH * numWide - this.WIDTH - backingBorder / 2, this.HEIGHT * numTall - this.HEIGHT - backingBorder / 2, offsetZ)
    }

    makePiece = (top: boolean): [THREE.Mesh, CanvasRenderingContext2D, CanvasRenderingContext2D] => {
        let geometry = new THREE.BoxGeometry(this.WIDTH, this.HEIGHT, 0.5);
            
            let [frontTexture, c] = this.generateCanvasTexture("white", top);
            
            let [backTexture, c2] = this.generateCanvasTexture("green", top);

            let basicMaterial = new THREE.MeshBasicMaterial();
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


    animationFrameCounter = 0;
    flipCycles = 0;

    animate = () => {
        let OFFSET = NUM_FRAMES_ROTATING / 3;
        let rotationRate = Math.PI / NUM_FRAMES_ROTATING;

        this.renderer.render(this.scene, this.camera);

        for (let i = 0; i < this.updateIdxs.length; i++) {
            
            let idx = this.updateIdxs[i];
            let [t, b, s] = this.flaps[idx];

            if (this.animationFrameCounter < NUM_FRAMES_ROTATING) {    
                t.rotation.x += rotationRate;
                s.rotation.x += rotFlapBack / NUM_FRAMES_ROTATING;
            }

            if (this.animationFrameCounter > (NUM_FRAMES_ROTATING - OFFSET) && this.animationFrameCounter <= (NUM_FRAMES_ROTATING * 2 - OFFSET)) {    
                
                b.rotation.x += rotationRate;
                s.rotation.x = rotFlapBack;
            }

            // how many frames for a full cycle?
            if (this.animationFrameCounter >= SPLIT_FLAP_CYCLE_LENGTH) {
                this.animationFrameCounter = 0;
                this.flipCycles += 1;
                
                let [tfront, tback, bfront, bback] = this.canvases[idx];
                tfront.fillText("B", 70, 250);
                tback.fillText("C", 70, 250);
                bfront.fillText("D", 70, 100);
                bback.fillText("E", 70, 100);

            } else {
                this.animationFrameCounter += 1;
            }


            this.renderer.render(this.scene, this.camera);

        }

    }
}