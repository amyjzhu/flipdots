import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';


import { WIDTH, HEIGHT, FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING, CAMERA_DISTANCE, SOUND_ENABLED, USE_X_DISC, DISC_SIDE_COLOUR, DISC_FRONT_COLOUR, DISC_BACK_COLOUR } from './constants';

export class RowOfDiscs {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    listener: THREE.AudioListener;
    
    SPACING = 7;
    DEPTH = 0.5;
    RADX = 3
    RADY = 3;
    rowsOfDiscs: THREE.Mesh[][] = []
    
    frame1Flips: number[][];
    frame2Flips: number[][];
    frame3Flips: number[][];
    frame4Flips: number[][];
    nextFlipGenerator: (i: number) => number[][];
    
    groupSnapshot: number[] = [];

    idxToUpdate: number[][] = [];
    constructor() {
        
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        // create an AudioListener and add it to the camera
        this.listener = new THREE.AudioListener();
        this.camera.add( this.listener );

        // where to put the camera? depends... 
        // not really sure how to automatically calculate z...
        this.camera.position.z = CAMERA_DISTANCE;
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setAnimationLoop(this.animate);
        document.body.appendChild(this.renderer.domElement);
        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        this.initScene();
        this.makeRowOfDiscs(WIDTH, HEIGHT);


        
        this.frame1Flips = this.rowsOfDiscs.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1));
        this.frame2Flips = this.rowsOfDiscs.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1) : []);
        this.frame3Flips = this.rowsOfDiscs.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1) : []);
        this.frame4Flips = this.rowsOfDiscs.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1));
        this.nextFlipGenerator = i => this.getNextFlip(i)(i);

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

    makeDiscGeometry(): THREE.Mesh {
        let circleShape = new THREE.Shape();
        circleShape.ellipse(0, 0, this.RADX, this.RADY, 0, 2 * 3.14);

        const extrudeSettings = {
            steps: 2,
            depth: this.DEPTH,
            bevelEnabled: false
        };

        const geometry = new THREE.ExtrudeGeometry(circleShape, extrudeSettings);

        const materials = [
            new THREE.MeshLambertMaterial({ color: DISC_FRONT_COLOUR }),
            new THREE.MeshLambertMaterial({ color: DISC_BACK_COLOUR }),
            new THREE.MeshLambertMaterial({ color: DISC_SIDE_COLOUR })
        ];

        let setThreeDiscGroups = (geometry: any) => {
            geometry.computeVertexNormals();
            let normals = geometry.getAttribute("normal");

            let group1 = geometry.groups[0];
            let group3 = geometry.groups[1];

            let group2Start = 0;
            let startingPositive = normals.getZ(0) > 0
            for (let i = 0; i < group1.count; i++) {
                let nz = normals.getZ(i);

                if (nz < -0.8 && startingPositive) {
                    group2Start = i;
                    break;
                } else if (nz > 0.8 && !startingPositive) {
                    group2Start = i;
                    break;
                }

            }

            geometry.clearGroups();
            geometry.addGroup(group1.start, group2Start - group1.start, 0);
            geometry.addGroup(group2Start, group1.count - group2Start, 1);
            geometry.addGroup(group3.start, group3.count, 2);
            // theoretically these should be the same for each disk.
            this.groupSnapshot = [group1.start, group2Start - group1.start, group2Start, group1.count - group2Start, group3.start, group3.count];

            // geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ));
        }

        setThreeDiscGroups(geometry);
        const cube = new THREE.Mesh(geometry, materials);

        return cube;
    }

    makeXDiscGeometry() {
        // make two discs
        let disc1 = this.makeDiscGeometry()
        let disc2 = this.makeDiscGeometry();
        // disc2.position.set(3,4,2,)
        disc2.geometry.rotateY(Math.PI / 2)
        // disc2.rotation.y = Math.PI / 2;

        let newGeom = mergeGeometries([disc1.geometry, disc2.geometry], true);
        newGeom.clearGroups()
        newGeom.addGroup(this.groupSnapshot[0], this.groupSnapshot[1], 0)
        newGeom.addGroup(this.groupSnapshot[2], this.groupSnapshot[3], 1)
        newGeom.addGroup(this.groupSnapshot[4], this.groupSnapshot[5], 2)
        // the second group should have everything added...
        let startingIdx = this.groupSnapshot[4] + this.groupSnapshot[5];
        newGeom.addGroup(startingIdx, this.groupSnapshot[2], 3)
        newGeom.addGroup(startingIdx + this.groupSnapshot[2], this.groupSnapshot[4], 4)
        newGeom.addGroup(startingIdx + this.groupSnapshot[2] + this.groupSnapshot[4], this.groupSnapshot[5], 5)

        console.log(newGeom.groups)

        const materials = [
            new THREE.MeshLambertMaterial({ color: 0xffeaf3 }),
            new THREE.MeshLambertMaterial({ color: 0x02f516 }),
            new THREE.MeshLambertMaterial({ color: 0x000000 }),
            new THREE.MeshLambertMaterial({ color: 0xffeaf3 }),
            new THREE.MeshLambertMaterial({ color: 0x02f516 }),
            new THREE.MeshLambertMaterial({ color: 0x000000 }),
        ];

        let newShape = new THREE.Mesh(newGeom, materials);


        return newShape;
        
    }


    makeRowOfDiscs(numWide: number, numTall: number) {

        let offsetX = WIDTH * this.SPACING / 2;
        let offsetY = HEIGHT * this.SPACING / 2
        for (let j = 0; j < numTall; j++) {
            let row = [];
            for (let i = 0; i < numWide; i++) {
                let mesh;
                if (USE_X_DISC) {
                    mesh = this.makeXDiscGeometry();
                } else {
                    mesh = this.makeDiscGeometry();
                }

                this.scene.add(mesh);
                mesh.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);

                // create the PositionalAudio object (passing in the listener)
                const sound = new THREE.PositionalAudio( this.listener );

                // load a sound and set it as the PositionalAudio object's buffer
                const audioLoader = new THREE.AudioLoader();
                audioLoader.load( 'click.mp3', function( buffer ) {
                	sound.setBuffer( buffer );
                	sound.setRefDistance( 20 );
                	// sound.play();
                });
            
                // finally add the sound to the mesh
                mesh.add( sound );
        

                row.push(mesh);
            }
            this.rowsOfDiscs.push(row);
        }

        // this.idxToUpdate = this.rowsOfDiscs.map(row => []);
        this.idxToUpdate = this.rowsOfDiscs.map(row => row.map((_, i) => i));

        let offsetZ = -5; 
        let backingBorder = 2;
        // also, make a black rectangle behind it
        let backing = new THREE.BoxGeometry(numWide * this.SPACING + backingBorder, numTall * this.SPACING + backingBorder, 4);
        let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 })
        let backingPiece = new THREE.Mesh(backing, backingMaterial);
        this.scene.add(backingPiece)
        // should be behind the discs.
        backingPiece.position.set(-this.RADX - backingBorder / 2, -this.RADY - backingBorder / 2, offsetZ)
    }



    getNextFlip = (i: number): (f: number) => number[][] => {
        let setNextToUpdate = (i: number): number[][] => {
            if (i % 4 == 0) {
                return this.frame1Flips;
            } else if (i % 4 == 1) {
                return this.frame2Flips;
            } else if (i % 4 == 2) {
                return this.frame3Flips;
            } else {
                return this.frame4Flips;
            }
        }

        let setNextRipple = (i: number): number[][] => {
            if (i % 6 == 0) {
                return [[0, 1, 2], [], [], [], [], [], []];
            } else if (i % 6 == 1) {
                return [[0, 1, 2, 3, 4], [0, 1, 2], [0, 1], [], [], [], []];
            } else if (i % 6 == 2) {
                return [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1], [0], [], []];
            } else if (i % 6 == 3) {
                return [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2], [0, 1], [0]];
            } else if (i % 6 == 4) {
                return [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3], [0, 1, 2]];
            } else {
                return [[0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4]];
            }
        }

        return setNextToUpdate;
        if (i > 10) {
            return setNextToUpdate;
        } else {
            return setNextRipple; // temporarily ignore as it only works for 5x7
        }
    }

    resetAnimation = (newFlip: (i: number) => number[][]) => {
        for (let row of this.rowsOfDiscs) {
            for (let disc of row) {
                disc.rotation.y = 0;
            }
        }

        this.flipCycles = 0;
        console.log(this.flipCycles)
        // console.log(this.idxToUpdate)
        this.animationFrameCounter = 0;
        this.nextFlipGenerator = newFlip;
    }

    // what's the easiest way to make it two-colours?
    // probably some kind of texturing setup...

    // let rotationRate = 0.1;
    // let rotationRate = 0.01;
    animationFrameCounter = 0;

    
    // I need to make a half rotation in 20 frames. How much do I rotate by?
    rotationRate = Math.PI / NUM_FRAMES_ROTATING;
    flipCycles = 0;
    animate = () => {
        for (let row in this.rowsOfDiscs) {
            // console.log(this.idxToUpdate)
            for (let idx of this.idxToUpdate[row]) {
                if (this.animationFrameCounter < NUM_FRAMES_ROTATING) {
                    let disc = this.rowsOfDiscs[row][idx];
                    disc.rotation.y += this.rotationRate;
                    if (SOUND_ENABLED) {
                        (disc.children[0] as THREE.PositionalAudio).stop();
                        let randDelay = (Math.random() / 100);
                        (disc.children[0] as THREE.PositionalAudio).play(randDelay);
                    }
                } // else do nothing 

            }
        }

        // how many frames for a full cycle?
        if (this.animationFrameCounter >= FULL_CYCLE_LENGTH) {
            this.animationFrameCounter = 0;
            // setNextToUpdate(flipCycles);
            this.idxToUpdate = this.nextFlipGenerator(this.flipCycles);
            this.flipCycles += 1;
            
        } else {
            this.animationFrameCounter += 1;
        }


        this.renderer.render(this.scene, this.camera);

    }

}