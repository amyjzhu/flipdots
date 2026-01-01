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

export class BrixelDisplay {
    width: number;
    height: number;
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    listener: THREE.AudioListener;

    timelines: { times: number[], angles: number[] }[] = [];
    framesPerMs: number = 1;

    unitWidth = 7;
    unitHeight = 14;
    unitThickness = 5;

    SPACING_X = this.unitWidth + 1;
    SPACING_Y = this.unitHeight + 1;

    dummy = new THREE.Object3D();
    instanced: THREE.InstancedMesh | undefined;

    audios: THREE.Object3D[] = [];

    bricks: THREE.Object3D[] = [];
    // canvases: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement][] = [];
    // canvases: [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D][] = [];

    setNextFlips: (f: number) => (i: number) => [number | undefined, number | undefined] = f => i => [undefined, undefined];

    animationFrameCounters: number[] = [];
    flipCycles: number[] = [];

    // updateIdxs: (number[] = [];

    basicMaterial = new THREE.MeshBasicMaterial({ color: "black" });

    numFramesRotating = NUM_FRAMES_ROTATING;
    splitFlapCycleLength = SPLIT_FLAP_CYCLE_LENGTH;

    // this should be just the offsets 
    perPixelPauses: (number | undefined)[] = [];
    perPixelCycleLength: (number | undefined)[] = [];

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

        this.setUpBrixels();

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

    setUpBrixels = () => {
        for (let j = 0; j < this.height; j++) {
            // let row = [];
            for (let i = 0; i < this.width; i++) {
                let obj = this.makePiece();
                this.bricks.push(obj);
                this.scene.add(obj);
                obj.position.set(i * this.SPACING_X, j * this.SPACING_Y - 3.5, 0)
            }
        }

        this.timelines = this.bricks.map(() => ({ times: [0], angles: [0] }));


    }

    makePiece = (): THREE.Object3D => {
        // idea: I'll just make two pieces that stick to each other that are different colours
        let geometry = new THREE.BoxGeometry(this.unitWidth, this.unitHeight, this.unitThickness / 2);
        let backGeometry = new THREE.BoxGeometry(this.unitWidth, this.unitHeight, this.unitThickness / 2);

        let frontTexture = new THREE.MeshPhongMaterial({ color: "red" });
        let obj = new THREE.Mesh(geometry, frontTexture);

        let backTexture = new THREE.MeshPhongMaterial({ color: "blue" });
        let backObj = new THREE.Mesh(backGeometry, backTexture);

        let domino = new THREE.Object3D();
        domino.add(obj);
        domino.add(backObj);
        backObj.position.set(0, 0, this.unitThickness / 2);
        this.scene.add(domino);

        return domino
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


    // unit id, time, angle
    setAnimationSequence(keyframes: [number, number, number][]) {
        // interpolate each position, so that for each time, 
        // I have all units and angles. 

        console.log(this.bricks)
        this.timelines = this.bricks.map(() => ({ times: [0], angles: [0] }));
        // this.timelines = this.bricks.map(() => ({ times: [], angles: [] }));

        // Populate
        console.log(this.timelines.length)
        for (const kf of keyframes) {
            const tl = this.timelines[kf[0]];
            // console.log(kf[0])
            // convert timing to frames
            tl.times.push(kf[1] * this.framesPerMs);
            tl.angles.push(kf[2] * Math.PI / 180);
        }

        // Sort each timeline by time
        for (const tl of this.timelines) {
            const zipped = tl.times.map((t, i) => ({ t, a: tl.angles[i] }))
                .sort((a, b) => a.t - b.t);

            tl.times = zipped.map(z => z.t);
            tl.angles = zipped.map(z => z.a);
        }

        console.log(this.timelines)
    }

    runningCount = 0;
    currentFrame = 0;
    animate = () => {
        function lerp(a: number, b: number, t: number): number {
            return a + (b - a) * t;
        }

        function findSegment(times: number[], now: number): number {
            let lo = 0;
            let hi = times.length - 1;

            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (times[mid] <= now) lo = mid + 1;
                else hi = mid - 1;
            }

            return hi;
        }

        const now = this.currentFrame;


        for (let i = 0; i < this.bricks.length; i++) {
            const tl = this.timelines[i];
            // console.log(tl)
            if (tl.times.length === 0) continue;

            // Before first keyframe
            if (now <= tl.times[0]) {
                this.bricks[i].rotation.x = tl.angles[0];
                continue;
            }

            // After last keyframe
            const last = tl.times.length - 1;
            if (now >= tl.times[last]) {
                this.bricks[i].rotation.x = tl.angles[last];
                // console.log("after last")
                continue;
            }

            // TODO: they keep rotating after they should stop... 

            // Interpolate between keyframes
            const idx = findSegment(tl.times, now);
            const t0 = tl.times[idx];
            const t1 = tl.times[idx + 1];
            const a0 = tl.angles[idx];
            const a1 = tl.angles[idx + 1];

            const alpha = (now - t0) / (t1 - t0);
            this.bricks[i].rotation.x = lerp(a0, a1, alpha);
        }

        this.renderer.render(this.scene, this.camera);
        this.currentFrame += 1;

    }
}