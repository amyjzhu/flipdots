import * as THREE from 'three';
// need to figure out what to do for the type defns 
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';


import { FULL_CYCLE_LENGTH, NUM_FRAMES_ROTATING, CAMERA_DISTANCE, SOUND_ENABLED, USE_X_DISC, DISC_SIDE_COLOUR, DISC_FRONT_COLOUR, DISC_BACK_COLOUR, PERFORMANT_SOUND_ENABLED, PERFORMANT_NUM_X_SPEAKERS, PERFORMANT_NUM_Y_SPEAKERS, RENDERER_SIZE_SCALEDOWN } from './constants';
import { buildFaceAdjacency, computeFaceGeodesicDistances, faceMostExtremeInDirection, faceMostExtremeInDirectionSubset, selectGeodesicDiskFaces, selectGeodesicRingFaces } from './util';

export class RowOfDiscs {
    width: number;
    height: number;
    count: number;
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    listener: THREE.AudioListener;

    SPACING = 7;
    DEPTH = 0.5;
    RADX = 3
    RADY = 3;
    rowsOfDiscs: THREE.Mesh[][] = []

    numFramesRotating = NUM_FRAMES_ROTATING;

    discStates: boolean[][] = []

    frame1Flips: number[][];
    frame2Flips: number[][];
    frame3Flips: number[][];
    frame4Flips: number[][];
    nextFlipGenerator: (i: number) => number[][] | undefined;

    groupSnapshot: number[] = [];

    idxToUpdate: number[][] = [];

    dummy = new THREE.Object3D();
    instanced: THREE.InstancedMesh | undefined;
    clock = new THREE.Clock();

    audios: THREE.Object3D[] = [];


    constructor(width: number, height: number, flat: boolean = true) {

        this.width = width;
        this.height = height;
        this.count = this.width * this.height;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        // create an AudioListener and add it to the camera
        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        // where to put the camera? depends... 
        // not really sure how to automatically calculate z...
        this.camera.position.z = CAMERA_DISTANCE;
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth / RENDERER_SIZE_SCALEDOWN, window.innerHeight / RENDERER_SIZE_SCALEDOWN);
        this.renderer.setAnimationLoop(this.animate);
        document.getElementById("render")!.appendChild(this.renderer.domElement);
        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        this.initScene();
        if (flat) {
            this.makeRowOfDiscs(this.width, this.height);
        } else {
            this.makeArbitraryMeshDiscSetup("public/lowpolybunny.stl");
            this.height = 1;
        }

        // performant takes precedence 
        if (PERFORMANT_SOUND_ENABLED) {
            this.addPerformantAudio()
        } else if (SOUND_ENABLED) {
            this.addAudio();
        }


        let basic: number[][] = [...Array(this.height)].map(_ => [...Array(this.width)].map((_, i) => i));
        this.frame1Flips = basic.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1));
        this.frame2Flips = basic.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1) : []);
        this.frame3Flips = basic.map((row, idx) => idx % 2 ? row.map((_, i) => i % 2 ? i : -1).filter(i => i != -1) : []);
        this.frame4Flips = basic.map((row, idx) => idx % 2 ? [] : row.map((_, i) => i % 2 ? -1 : i).filter(i => i != -1));
        this.nextFlipGenerator = i => [...Array(this.height)].map(_ => []);
        // this.nextFlipGenerator = i => this.getNextFlip(i)(i);

        this.animate();

    }

    initScene() {

        // skybox
        const geometry = new THREE.BoxGeometry(900, 900, 900);
        // const geometry = new THREE.BoxGeometry(450, 450, 450);
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

        // https://stackoverflow.com/questions/65974267/instancedmesh-with-unique-texture-per-instance/65975558#65975558 2024 answer 

        // maybe worth trying to merge these two 

        let backMaterial = new THREE.MeshLambertMaterial();
        // lol this is slightly cursed: https://threejs.org/examples/webgl_materials_modified

        backMaterial.onBeforeCompile = shader => {
            // console.log(shader.vertexShader);
            shader.vertexShader = `attribute vec3 instanceBackColour;
varying vec3 vColor;
` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(`void main() {`,
                `void main() {
            vColor = instanceBackColour;`)

            // console.log(shader.fragmentShader)
            shader.fragmentShader = `varying vec3 vColor;
` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(`vec4 diffuseColor = vec4( diffuse, opacity );`,
                `vec4 diffuseColor = vec4( vColor, opacity );`
            )

            backMaterial.userData.shader = shader;
            console.log(shader)
        };


        let frontMaterial = new THREE.MeshLambertMaterial();
        // lol this is slightly cursed: https://threejs.org/examples/webgl_materials_modified

        frontMaterial.onBeforeCompile = shader => {
            // console.log(shader.vertexShader);
            shader.vertexShader = `attribute vec3 instanceFrontColour;
varying vec3 vColor;
` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(`void main() {`,
                `void main() {
                vColor = instanceFrontColour;`)

            // console.log(shader.fragmentShader)
            shader.fragmentShader = `varying vec3 vColor;
` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(`vec4 diffuseColor = vec4( diffuse, opacity );`,
                `vec4 diffuseColor = vec4( vColor, opacity );`
            )

            frontMaterial.userData.shader = shader;
            console.log(shader)
        };


        let count = this.count;

        var instanceBackColours = new Float32Array(count * 3);
        var instanceFrontColours = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            let backColour = DISC_BACK_COLOUR(i);
            instanceBackColours[i * 3] = backColour[0];
            instanceBackColours[i * 3 + 1] = backColour[1];
            instanceBackColours[i * 3 + 2] = backColour[2];

            let frontColour = DISC_FRONT_COLOUR(i);
            instanceFrontColours[i * 3] = frontColour[0];
            instanceFrontColours[i * 3 + 1] = frontColour[1];
            instanceFrontColours[i * 3 + 2] = frontColour[2];
        }

        frontMaterial.side = THREE.DoubleSide;
        backMaterial.side = THREE.DoubleSide;

        geometry.setAttribute('instanceBackColour',
            new THREE.InstancedBufferAttribute(instanceBackColours, 3));
        geometry.setAttribute('instanceFrontColour',
            new THREE.InstancedBufferAttribute(instanceFrontColours, 3));


        const materials = [
            // frontMaterialL,
            frontMaterial,
            // new THREE.MeshLambertMaterial({ color: 0xff0110 }),
            // new THREE.MeshLambertMaterial({ color: DISC_FRONT_COLOUR }),
            // new THREE.MeshLambertMaterial({ color: DISC_BACK_COLOUR }),
            backMaterial,
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

    computeGeomStripes(geometry: THREE.BufferGeometry) {
        const pos = geometry.attributes.position.array;
        const faceCount: number = pos.length / 9; // 3 verts per face, 3 coords per vert

        for (let f = 0; f < faceCount; f++) {
            const a = f * 9;
            const tri = [
                [pos[a + 0], pos[a + 1], pos[a + 2]],
                [pos[a + 3], pos[a + 4], pos[a + 5]],
                [pos[a + 6], pos[a + 7], pos[a + 8]],
            ];
        }

        const vertexMap = new Map<String, number>();
        const canonicalIndex: number[] = [];
        let nextId = 0;

        for (let i = 0; i < pos.length; i += 3) {
            const key = `${pos[i].toFixed(5)}_${pos[i + 1].toFixed(5)}_${pos[i + 2].toFixed(5)}`;
            // round to tolerance to handle floating error
            if (!vertexMap.has(key)) vertexMap.set(key, nextId++);
            canonicalIndex.push(vertexMap.get(key)!);
        }

        const faceNeighbors = Array.from({ length: faceCount }, () => new Set<number>());
        const edgeToFaces = new Map<String, number[]>();

        for (let f = 0; f < faceCount; f++) {
            const a = canonicalIndex[3 * f + 0];
            const b = canonicalIndex[3 * f + 1];
            const c = canonicalIndex[3 * f + 2];
            const edges = [[a, b], [b, c], [c, a]];

            for (const [i, j] of edges) {
                const key = i < j ? `${i}_${j}` : `${j}_${i}`;
                if (!edgeToFaces.has(key)) edgeToFaces.set(key, []);
                edgeToFaces.get(key)!.push(f);
            }
        }

        for (const faces of edgeToFaces.values()) {
            if (faces.length === 2) {
                const [f1, f2] = faces;
                faceNeighbors[f1].add(f2);
                faceNeighbors[f2].add(f1);
            }
        }

        function dfsOrder(
            startFace: number,
            faceNeighbors: Set<number>[]
        ): number[] {
            const visited = new Set<number>();
            const order: number[] = [];

            function visit(f: number): void {
                visited.add(f);
                order.push(f);
                for (const n of faceNeighbors[f]) {
                    if (!visited.has(n)) visit(n);
                }
            }

            visit(startFace);
            return order;
        }


        const order = dfsOrder(0, faceNeighbors);

        return order;

    }

    moveCircleAcrossMesh(geometry: THREE.BufferGeometry): number[][] {
        // build neighbors
        
        const neighbors = buildFaceAdjacency(geometry);

        console.log(neighbors)
        // find starting face pointing most in +X
        let startFace = faceMostExtremeInDirection(geometry, new THREE.Vector3(1, 0, 0));
        console.log(startFace)
        
        // select ring at radius r

        let allFaces = [];
        for (let i = 0; i < 5; i++) {
            
            // compute geodesic distances
            // this is so inefficient lol 
            let info = computeFaceGeodesicDistances(startFace, neighbors, geometry);

            let r = 20
            let ringFaces = selectGeodesicDiskFaces(info, r);
            allFaces.push(ringFaces);

            startFace = faceMostExtremeInDirectionSubset(geometry, new THREE.Vector3(-1, 0, 1), ringFaces);
            console.log(startFace)
        }
        // const ringFaces = selectGeodesicRingFaces(info, r);

        // loops is Vec3[][] where each inner array is an ordered polyline (closed or open)
        // You can visualize by creating THREE.Line objects.

        return allFaces;
    }

    async makeArbitraryMeshDiscSetup(meshPath: string) {
        const loader = new STLLoader();
        // const object = await loader.loadAsync('public/lowpolysphere.stl');

        // console.log(object.attributes)

        loader.load(meshPath, (geometry) => {
            geometry.computeVertexNormals(); // make sure normals exist
            // geometry.scale(10, 10, 10)
            geometry.rotateX(-Math.PI / 2)

            let geometryStripes = this.computeGeomStripes(geometry);
            console.log(geometryStripes);


            // 4. Create InstancedMesh
            const faceCount = geometry.attributes.position.count / 3; // 3 verts per face
            console.log("face count is", faceCount)
            this.count = faceCount;

            let basicGeometry = USE_X_DISC ? this.makeXDiscGeometry() : this.makeDiscGeometry();
            // basicGeometry.material.side = THREE.DoubleSide;
            this.instanced = new THREE.InstancedMesh(basicGeometry.geometry, basicGeometry.material, faceCount);
            this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(this.instanced);


            // 5. Temporary objects for math
            const pos = geometry.attributes.position;
            const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
            const faceCenter = new THREE.Vector3();
            const faceNormal = new THREE.Vector3();
            const up = new THREE.Vector3(0, 1, 0);
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion();

            // 6. Loop through faces
            for (let i = 0; i < faceCount; i++) {
                vA.fromBufferAttribute(pos, i * 3 + 0);
                vB.fromBufferAttribute(pos, i * 3 + 1);
                vC.fromBufferAttribute(pos, i * 3 + 2);

                // Face center
                faceCenter.addVectors(vA, vB).add(vC).divideScalar(3);

                // Face normal
                faceNormal.subVectors(vB, vA).cross(vC.clone().sub(vA)).normalize();

                // Align instance to face normal (using Y-up as reference)
                const tempQuat = new THREE.Quaternion();
                const rotationFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // rotate 90° around X
                tempQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceNormal);
                quaternion.multiplyQuaternions(tempQuat, rotationFix);

                // Set instance matrix
                matrix.compose(faceCenter, quaternion, new THREE.Vector3(1, 1, 1));
                this.instanced.setMatrixAt(i, matrix);

                // reset reusable vectors
                faceCenter.set(0, 0, 0);
            }

            this.instanced.instanceMatrix.needsUpdate = true;



            let offsetZ = -5;
            let backingBorder = 2;
            // also, make a black rectangle behind it
            geometry.scale(0.99, 0.99, 0.99)

            let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 })
            let backingPiece = new THREE.Mesh(geometry, backingMaterial);
            this.scene.add(backingPiece)

            // I think we want an ambient light because of the shape
            this.scene.add(new THREE.AmbientLight(0x404040))
            // should be behind the discs.
            // backingPiece.position.set(-this.RADX - backingBorder / 2, -this.RADY - backingBorder / 2, offsetZ)


        });

        // I think if we want this mode, we assume there's only one "row" and everything is a column
        this.idxToUpdate = [...Array(this.height)].map(_ => []);
        this.discStates = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => false));
    }


    makeRowOfDiscs(numWide: number, numTall: number) {

        let basicGeometry = USE_X_DISC ? this.makeXDiscGeometry() : this.makeDiscGeometry();
        this.instanced = new THREE.InstancedMesh(basicGeometry.geometry, basicGeometry.material, this.width * this.height);
        this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.instanced);

        let offsetX = this.width * this.SPACING / 2;
        let offsetY = this.height * this.SPACING / 2
        for (let j = 0; j < numTall; j++) {
            // let row = [];
            for (let i = 0; i < numWide; i++) {

                this.dummy.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);
                this.dummy.updateMatrix();

                // may have to update colours here in the future
                this.instanced!.setMatrixAt(j * this.width + i, this.dummy.matrix);
                // instanced.setColorAt()

            }
        }

        // this.idxToUpdate = this.rowsOfDiscs.map(row => []);
        this.idxToUpdate = [...Array(this.height)].map(_ => []);
        this.discStates = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => false));
        console.log(this.idxToUpdate)

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

    addAudio() {
        let offsetX = this.width * this.SPACING / 2;
        let offsetY = this.height * this.SPACING / 2;
        // console.log(numXSpeakers)

        for (let j = 0; j < this.width; j++) {
            // let row = [];
            for (let i = 0; i < this.height; i++) {
                // create the PositionalAudio object (passing in the listener)
                let audio = new THREE.Object3D();
                audio.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0)

                const sound = new THREE.PositionalAudio(this.listener);

                // load a sound and set it as the PositionalAudio object's buffer
                const audioLoader = new THREE.AudioLoader();
                audioLoader.load('click.mp3', function (buffer) {
                    sound.setBuffer(buffer);
                    sound.setRefDistance(20);
                    // sound.play();
                });

                audio.add(sound);
                this.audios.push(audio)
            }
        }
    }

    addPerformantAudio() {
        let newXSpacing = Math.floor(this.width * this.SPACING / PERFORMANT_NUM_X_SPEAKERS);
        let newYSpacing = Math.floor(this.height * this.SPACING / PERFORMANT_NUM_Y_SPEAKERS);

        for (let j = 0; j < PERFORMANT_NUM_X_SPEAKERS; j++) {
            // let row = [];
            for (let i = 0; i < PERFORMANT_NUM_Y_SPEAKERS; i++) {
                // create the PositionalAudio object (passing in the listener)
                let audio = new THREE.Object3D();
                audio.position.set(i * newYSpacing, j * newXSpacing, 0)

                const sound = new THREE.PositionalAudio(this.listener);

                // load a sound and set it as the PositionalAudio object's buffer
                const audioLoader = new THREE.AudioLoader();
                audioLoader.load('click.mp3', function (buffer) {
                    sound.setBuffer(buffer);
                    sound.setRefDistance(20);
                    // sound.play();
                });

                audio.add(sound);
                this.audios.push(audio)
            }
        }
    }


    clear = () => {
        for (let row = 0; row < this.height; row++) {
            for (let idx = 0; idx < this.width; idx++) {

                this.instanced!.getMatrixAt(row * this.width + idx, this.dummy.matrix);
                // this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);

                // let rot = (!this.discStates[row][idx] ? -1 : 1) * ratio

                this.discStates[row][idx] = false;
                // console.log("ya")

                this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);

                // Step 3: Reset rotation (quaternion to identity)
                this.dummy.quaternion.identity();

                // Step 4: Recompose matrix
                this.dummy.updateMatrix();

                // Step 5: Write it back
                this.instanced!.setMatrixAt(row * this.width + idx, this.dummy.matrix);

                // Step 6: Mark update
                this.instanced!.instanceMatrix.needsUpdate = true;



                // let pos = new THREE.Vector3();
                // let quat = new THREE.Quaternion();
                // let scale = new THREE.Vector3();
                // this.dummy.matrix.decompose(pos, quat, scale);

                // let newQuat = new THREE.Quaternion(0,0,0,0);
                // this.dummy.matrix.compose(pos, newQuat, scale);
                // // let rotation = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sqrt(2) / 2, Math.sqrt(2) / 2, 0), rot)
                // // console.log(t)
                // // this.dummy.rotation.y += this.rotationRate;
                // // this.dummy.matrix.multiply(rotation)
                // // this.dummy.updateMatrix();

                // this.instanced!.setMatrixAt(row * this.width + idx, this.dummy.matrix);
                // this.instanced!.instanceMatrix.needsUpdate = true;
            }
        }
        this.renderer.render(this.scene, this.camera);

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

    resetAnimation = (newFlip: (i: number) => number[][] | undefined) => {
        for (let row of this.rowsOfDiscs) {
            for (let disc of row) {
                disc.rotation.y = 0;
            }
        }

        this.flipCycles = 0;
        // console.log(this.flipCycles)
        // console.log(this.idxToUpdate)
        this.animationFrameCounter = 0;
        this.nextFlipGenerator = newFlip;
    }

    setFlipSequenceWithoutResetting = (newFlip: (i: number) => number[][]) => {


        this.flipCycles = 0;
        // console.log(this.flipCycles)
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
    flipCycles = 0;
    animate = () => {
        let rotationRate = Math.PI / this.numFramesRotating;

        // okay, so if it's like, 15 flips per second...
        let t = this.clock.getElapsedTime();
        // let fullFlip = Math.PI;
        // // how much should I flip? If the requisite time has elapsed, I flip the whole amount. 
        // let ratio = t * fullFlip / (30 / NUM_FRAMES_ROTATING);
        // console.log(t)
        // console.log(ratio)

        // this could work... but I think it's like, 
        // if (SOUND_ENABLED) {
        //     // console.log(this.idxToUpdate.reduce((a,b) => a + b.length,0))
        //     // console.log(this.audios.length)
        //     for (let i = 0; i < this.audios.length && i < this.idxToUpdate.reduce((a,b) => a + b.length, 0); i++) {
        //         // todo: at some point, figure out which audio is closest
        //         let audio = this.audios[i];
        //         // let audio = this.audios[row * WIDTH + idx];
        //         (audio.children[0] as THREE.PositionalAudio).stop();
        //         let randDelay = (Math.random() / 100);
        //         (audio.children[0] as THREE.PositionalAudio).play(randDelay);
        //     }
        // }




        for (let row = 0; row < this.height; row++) {
            // console.log(this.idxToUpdate)
            // console.log(row)
            // console.log(this.idxToUpdate[row])
            for (let idx of this.idxToUpdate[row]) {
                if (this.animationFrameCounter < this.numFramesRotating) {
                    this.instanced!.getMatrixAt(row * this.width + idx, this.dummy.matrix);
                    // this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);

                    // let rot = (!this.discStates[row][idx] ? -1 : 1) * ratio
                    let rot = (!this.discStates[row][idx] ? -1 : 1) * rotationRate

                    let rotation = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sqrt(2) / 2, Math.sqrt(2) / 2, 0), rot)
                    // console.log(t)
                    // this.dummy.rotation.y += this.rotationRate;
                    this.dummy.matrix.multiply(rotation)
                    // this.dummy.updateMatrix();

                    this.instanced!.setMatrixAt(row * this.width + idx, this.dummy.matrix);
                    this.instanced!.instanceMatrix.needsUpdate = true;

                    if (SOUND_ENABLED) {
                        // console.log(this.idxToUpdate.reduce((a,b) => a + b.length,0))
                        // console.log(this.audios.length)
                        // for (let i = 0; i < this.audios.length && i < this.idxToUpdate.reduce((a,b) => a + b.length, 0); i++) {
                        // todo: at some point, figure out which audio is closest
                        // let audio = this.audios[i];
                        let audio = this.audios[row * this.width + idx];
                        (audio.children[0] as THREE.PositionalAudio).stop();
                        let randDelay = (Math.random() / 100);
                        (audio.children[0] as THREE.PositionalAudio).play(randDelay);

                    } else if (PERFORMANT_SOUND_ENABLED) {
                        // have two sets to give them time to play out.
                        let cutoff = Math.floor(this.audios.length / 2);
                        for (let i = 0; i < cutoff && i < this.idxToUpdate.reduce((a, b) => a + b.length, 0); i++) {
                            let audio = this.audios[i + cutoff]
                            if (this.animationFrameCounter % 2 == 0) {
                                audio = this.audios[i];
                            }
                            (audio.children[0] as THREE.PositionalAudio).stop();
                            let randDelay = (Math.random() / 100);
                            (audio.children[0] as THREE.PositionalAudio).play(randDelay);
                        }
                    }

                } // else do nothing 


            }
        }

        // how many frames for a full cycle?
        if (this.animationFrameCounter >= FULL_CYCLE_LENGTH) {
            this.clock.stop()
            this.animationFrameCounter = 0;
            // setNextToUpdate(flipCycles);

            let next = this.nextFlipGenerator(this.flipCycles);
            // console.log(need a way to set reset in this)
            // for each...

            if (next == undefined) {
                // console.log("next is undefined, whil flipcycles is ", this.flipCycles)
                this.flipCycles = 0;
                // should have reset it... 
                this.idxToUpdate = [...Array(this.height)].map(_ => []);
                this.clear();
            } else {
                this.idxToUpdate = next;

                this.idxToUpdate.forEach((row, idx) => row.forEach(i => this.discStates[idx][i] = !this.discStates[idx][i]))
                this.flipCycles += 1;
                this.clock.start()
            }

        } else {
            this.animationFrameCounter += 1;
        }


        this.renderer.render(this.scene, this.camera);

    }

}