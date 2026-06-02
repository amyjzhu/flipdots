import * as THREE from 'three';
// need to figure out what to do for the type defns
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Recorder } from './recorder';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VertexNormalsHelper } from 'three/addons/helpers/VertexNormalsHelper.js';
import { mergeGeometries, mergeGroups } from 'three/addons/utils/BufferGeometryUtils.js';


import { NUM_FRAMES_ROTATING, CAMERA_DISTANCE, SOUND_ENABLED, USE_X_DISC, DISC_SIDE_COLOUR, DISC_FRONT_COLOUR, DISC_BACK_COLOUR, PERFORMANT_SOUND_ENABLED, PERFORMANT_NUM_X_SPEAKERS, PERFORMANT_NUM_Y_SPEAKERS, RENDERER_SIZE_SCALEDOWN } from './constants';
import { buildFaceAdjacency, computeFaceGeodesicDistances, faceMostExtremeInDirection, faceMostExtremeInDirectionSubset, selectGeodesicDiskFaces, selectGeodesicRingFaces } from './util';

// Async variant of RowOfDiscs: each disc owns its own animation state and may
// be mid-flip while neighbours are idle (or starting/finishing).
//
// nextFlipGenerator(frame) is called every animate() tick, where `frame` is
// the global frame counter. It returns the discs that should START flipping
// on this frame (per-row indices), or undefined to reset. Discs that are
// asked to flip while still mid-flip are queued and start the moment they
// return to idle.
export class RowOfDiscsAsync {
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

    // -1 = idle, otherwise the number of rotation frames already applied
    // to this disc's current in-progress flip (0 .. numFramesRotating-1).
    discFrameCounters: number[][] = [];

    // discs that have been scheduled to flip but couldn't start yet because
    // they were mid-flip. Stored as a Set per row to dedupe.
    pendingFlips: Set<number>[] = [];

    frame1Flips: number[][];
    frame2Flips: number[][];
    frame3Flips: number[][];
    frame4Flips: number[][];
    nextFlipGenerator: (i: number) => number[][] | undefined;

    groupSnapshot: number[] = [];

    dummy = new THREE.Object3D();
    instanced: THREE.InstancedMesh | undefined;
    clock = new THREE.Clock();

    audios: THREE.Object3D[] = [];

    meshGeometry: THREE.BufferGeometry | undefined;
    mesh: THREE.Mesh | undefined;
    units: THREE.Vector3[] | undefined

    recorder: Recorder | undefined;

    constructor(width: number, height: number, flat: boolean = true, meshPath?: string) {

        this.width = width;
        this.height = height;
        this.count = this.width * this.height;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

        this.listener = new THREE.AudioListener();
        this.camera.add(this.listener);

        this.camera.position.z = CAMERA_DISTANCE;
        this.renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
        this.renderer.setSize(window.innerWidth / RENDERER_SIZE_SCALEDOWN, window.innerHeight / RENDERER_SIZE_SCALEDOWN);
        this.renderer.setAnimationLoop(this.animate);
        document.getElementById("render")!.appendChild(this.renderer.domElement);
        const controls = new OrbitControls(this.camera, this.renderer.domElement);

        this.initScene();
        if (flat) {
            this.makeRowOfDiscs(this.width, this.height);
        } else {
            if (meshPath == undefined) {
                console.log("Undefined mesh path, defaulting to bunny")
                meshPath = "public/lowpolybunny.stl";
            }
            this.makeArbitraryMeshDiscSetup(meshPath);
            this.height = 1;
        }

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

        this.animate();

    }

    initScene() {
        const geometry = new THREE.BoxGeometry(900, 900, 900);
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

        const ambientLight = new THREE.AmbientLight(0x404040);
        this.scene.add(ambientLight);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 3);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight2.position.set(1, 1, -1);
        this.scene.add(directionalLight2);
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

        let backMaterial = new THREE.MeshLambertMaterial();

        backMaterial.onBeforeCompile = shader => {
            shader.vertexShader = `attribute vec3 instanceBackColour;
varying vec3 vColor;
` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(`void main() {`,
                `void main() {
            vColor = instanceBackColour;`)

            shader.fragmentShader = `varying vec3 vColor;
` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(`vec4 diffuseColor = vec4( diffuse, opacity );`,
                `vec4 diffuseColor = vec4( vColor, opacity );`
            )

            backMaterial.userData.shader = shader;
        };


        let frontMaterial = new THREE.MeshLambertMaterial();

        frontMaterial.onBeforeCompile = shader => {
            shader.vertexShader = `attribute vec3 instanceFrontColour;
varying vec3 vColor;
` + shader.vertexShader;

            shader.vertexShader = shader.vertexShader.replace(`void main() {`,
                `void main() {
                vColor = instanceFrontColour;`)

            shader.fragmentShader = `varying vec3 vColor;
` + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(`vec4 diffuseColor = vec4( diffuse, opacity );`,
                `vec4 diffuseColor = vec4( vColor, opacity );`
            )

            frontMaterial.userData.shader = shader;
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
            frontMaterial,
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
            this.groupSnapshot = [group1.start, group2Start - group1.start, group2Start, group1.count - group2Start, group3.start, group3.count];
        }

        setThreeDiscGroups(geometry);
        const cube = new THREE.Mesh(geometry, materials);

        return cube;
    }

    makeXDiscGeometry() {
        let disc1 = this.makeDiscGeometry()
        let disc2 = this.makeDiscGeometry();
        disc2.geometry.rotateY(Math.PI / 2)

        let newGeom = mergeGeometries([disc1.geometry, disc2.geometry], true);
        newGeom.clearGroups()
        newGeom.addGroup(this.groupSnapshot[0], this.groupSnapshot[1], 0)
        newGeom.addGroup(this.groupSnapshot[2], this.groupSnapshot[3], 1)
        newGeom.addGroup(this.groupSnapshot[4], this.groupSnapshot[5], 2)
        let startingIdx = this.groupSnapshot[4] + this.groupSnapshot[5];
        newGeom.addGroup(startingIdx, this.groupSnapshot[2], 3)
        newGeom.addGroup(startingIdx + this.groupSnapshot[2], this.groupSnapshot[4], 4)
        newGeom.addGroup(startingIdx + this.groupSnapshot[2] + this.groupSnapshot[4], this.groupSnapshot[5], 5)

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
        const faceCount: number = pos.length / 9;

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
        const neighbors = buildFaceAdjacency(geometry);

        let startFace = faceMostExtremeInDirection(geometry, new THREE.Vector3(1, 0, 0));

        let allFaces = [];
        for (let i = 0; i < 5; i++) {
            let info = computeFaceGeodesicDistances(startFace, neighbors, geometry);

            let r = 40
            let ringFaces = selectGeodesicDiskFaces(info, r);
            allFaces.push(ringFaces);

            startFace = faceMostExtremeInDirectionSubset(geometry, new THREE.Vector3(-1, 0, 1), ringFaces);
        }

        return allFaces;
    }

    async makeArbitraryMeshDiscSetup(meshPath: string): Promise<any> {
        const loader = new STLLoader();

        loader.load(meshPath, (geometry) => {
            geometry.computeVertexNormals();
            geometry.rotateX(-Math.PI / 2)

            let geometryStripes = this.computeGeomStripes(geometry);

            const faceCount = geometry.attributes.position.count / 3;
            this.count = faceCount;

            let basicGeometry = USE_X_DISC ? this.makeXDiscGeometry() : this.makeDiscGeometry();
            this.instanced = new THREE.InstancedMesh(basicGeometry.geometry, basicGeometry.material, faceCount);
            this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.scene.add(this.instanced);


            const pos = geometry.attributes.position;
            const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
            const faceCenter = new THREE.Vector3();
            const faceNormal = new THREE.Vector3();
            const up = new THREE.Vector3(0, 1, 0);
            const matrix = new THREE.Matrix4();
            const quaternion = new THREE.Quaternion();

            let units = [];
            for (let i = 0; i < faceCount; i++) {
                vA.fromBufferAttribute(pos, i * 3 + 0);
                vB.fromBufferAttribute(pos, i * 3 + 1);
                vC.fromBufferAttribute(pos, i * 3 + 2);

                faceCenter.addVectors(vA, vB).add(vC).divideScalar(3);

                faceNormal.subVectors(vB, vA).cross(vC.clone().sub(vA)).normalize();

                const tempQuat = new THREE.Quaternion();
                const rotationFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
                tempQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceNormal);
                quaternion.multiplyQuaternions(tempQuat, rotationFix);

                matrix.compose(faceCenter, quaternion, new THREE.Vector3(1, 1, 1));
                this.instanced.setMatrixAt(i, matrix);
                units.push(faceCenter);

                faceCenter.set(0, 0, 0);
            }

            this.instanced.instanceMatrix.needsUpdate = true;

            let offsetZ = -5;
            let backingBorder = 2;
            geometry.scale(0.99, 0.99, 0.99)

            let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 })
            let backingPiece = new THREE.Mesh(geometry, backingMaterial);
            this.scene.add(backingPiece)

            this.scene.add(new THREE.AmbientLight(0x404040))

            this.meshGeometry = geometry;
            this.units = units;
            this.mesh = new THREE.Mesh(
                geometry,
                new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
            );

            // re-allocate per-disc state to the discovered face count
            this.discFrameCounters = [[...Array(faceCount)].map(_ => -1)];
            this.pendingFlips = [new Set<number>()];
            this.discStates = [[...Array(faceCount)].map(_ => false)];
        });

        this.discFrameCounters = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => -1));
        this.pendingFlips = [...Array(this.height)].map(_ => new Set<number>());
        this.discStates = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => false));

        return new Promise(i => i);
    }


    getProjectionFor3DHardware(rayDir: [number, number, number]): (number | undefined)[][] | undefined {
        if (this.meshGeometry == undefined) {
            return undefined;
        }

        const dir = new THREE.Vector3(...rayDir).normalize();

        function buildBasis(dir: THREE.Vector3) {
            const up = Math.abs(dir.y) < 0.99
                ? new THREE.Vector3(0, 1, 0)
                : new THREE.Vector3(1, 0, 0);

            const right = new THREE.Vector3().crossVectors(up, dir).normalize();
            const trueUp = new THREE.Vector3().crossVectors(dir, right).normalize();

            return { right, up: trueUp };
        }


        function isVisible(
            point: THREE.Vector3,
            mesh: THREE.Mesh,
            dir: THREE.Vector3
        ): boolean {
            const raycaster = new THREE.Raycaster();

            const origin = point.clone().addScaledVector(dir, 1e-4);
            raycaster.set(origin, dir.clone().negate());

            const hits = raycaster.intersectObject(mesh, false);
            if (hits.length === 0) return true;

            return hits[0].distance < 1e-3;
        }
        const { right, up } = buildBasis(dir);

        type ProjectedUnit = {
            id: number;
            u: number;
            v: number;
            depth: number;
        };

        const projected: ProjectedUnit[] = [];

        for (let i = 0; i < this.units!.length; i++) {
            let p = this.units![i];

            if (!isVisible(p, this.mesh!, dir)) continue;

            projected.push({
                id: i,
                u: p.dot(right),
                v: p.dot(up),
                depth: p.dot(dir)
            });
        }

        const us = projected.map(p => p.u);
        const vs = projected.map(p => p.v);

        const minU = Math.min(...us);
        const maxU = Math.max(...us);
        const minV = Math.min(...vs);
        const maxV = Math.max(...vs);


        function estimateUnitSpacing(points: THREE.Vector3[]): number {
            let minDist = Infinity;

            for (let i = 0; i < points.length; i++) {
                for (let j = i + 1; j < points.length; j++) {
                    const d = points[i].distanceTo(points[j]);
                    if (d > 0 && d < minDist) minDist = d;
                }
            }

            return minDist === Infinity ? 1 : minDist;
        }
        const cellSize = estimateUnitSpacing(this.units!);
        const cols = Math.ceil((maxU - minU) / cellSize);
        const rows = Math.ceil((maxV - minV) / cellSize);

        const grid: (number | undefined)[][] =
            Array.from({ length: rows }, () => Array(cols).fill(undefined));

        const depthGrid: number[][] =
            Array.from({ length: rows }, () => Array(cols).fill(Infinity));

        for (const p of projected) {
            const x = Math.floor((p.u - minU) / cellSize);
            const y = Math.floor((p.v - minV) / cellSize);

            if (x < 0 || y < 0 || x >= cols || y >= rows) continue;

            if (p.depth < depthGrid[y][x]) {
                depthGrid[y][x] = p.depth;
                grid[y][x] = p.id;
            }
        }

        return grid;

    }


    makeRowOfDiscs(numWide: number, numTall: number) {

        let basicGeometry = USE_X_DISC ? this.makeXDiscGeometry() : this.makeDiscGeometry();
        this.instanced = new THREE.InstancedMesh(basicGeometry.geometry, basicGeometry.material, this.width * this.height);
        this.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.instanced);

        let offsetX = this.width * this.SPACING / 2;
        let offsetY = this.height * this.SPACING / 2
        for (let j = 0; j < numTall; j++) {
            for (let i = 0; i < numWide; i++) {
                this.dummy.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0);
                this.dummy.updateMatrix();
                this.instanced!.setMatrixAt(j * this.width + i, this.dummy.matrix);
            }
        }

        this.discFrameCounters = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => -1));
        this.pendingFlips = [...Array(this.height)].map(_ => new Set<number>());
        this.discStates = [...Array(this.height)].map(_ => [...Array(this.width)].map(_ => false));

        let offsetZ = -5;
        let backingBorder = 2;
        let backing = new THREE.BoxGeometry(numWide * this.SPACING + backingBorder, numTall * this.SPACING + backingBorder, 4);
        let backingMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 })
        let backingPiece = new THREE.Mesh(backing, backingMaterial);
        this.scene.add(backingPiece)
        backingPiece.position.set(-this.RADX - backingBorder / 2, -this.RADY - backingBorder / 2, offsetZ)
    }

    addAudio() {
        let offsetX = this.width * this.SPACING / 2;
        let offsetY = this.height * this.SPACING / 2;

        for (let j = 0; j < this.width; j++) {
            for (let i = 0; i < this.height; i++) {
                let audio = new THREE.Object3D();
                audio.position.set(i * this.SPACING - offsetX, j * this.SPACING - offsetY, 0)

                const sound = new THREE.PositionalAudio(this.listener);

                const audioLoader = new THREE.AudioLoader();
                audioLoader.load('click.mp3', function (buffer) {
                    sound.setBuffer(buffer);
                    sound.setRefDistance(20);
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
            for (let i = 0; i < PERFORMANT_NUM_Y_SPEAKERS; i++) {
                let audio = new THREE.Object3D();
                audio.position.set(i * newYSpacing, j * newXSpacing, 0)

                const sound = new THREE.PositionalAudio(this.listener);

                const audioLoader = new THREE.AudioLoader();
                audioLoader.load('click.mp3', function (buffer) {
                    sound.setBuffer(buffer);
                    sound.setRefDistance(20);
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

                this.discStates[row][idx] = false;
                this.discFrameCounters[row][idx] = -1;

                this.dummy.matrix.decompose(this.dummy.position, this.dummy.quaternion, this.dummy.scale);
                this.dummy.quaternion.identity();
                this.dummy.updateMatrix();

                this.instanced!.setMatrixAt(row * this.width + idx, this.dummy.matrix);
                this.instanced!.instanceMatrix.needsUpdate = true;
            }
            this.pendingFlips[row].clear();
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

        return setNextToUpdate;
    }

    resetAnimation = (newFlip: (i: number) => number[][] | undefined) => {
        for (let row of this.rowsOfDiscs) {
            for (let disc of row) {
                disc.rotation.y = 0;
            }
        }

        this.globalFrame = 0;
        for (let row = 0; row < this.discFrameCounters.length; row++) {
            for (let idx = 0; idx < this.discFrameCounters[row].length; idx++) {
                this.discFrameCounters[row][idx] = -1;
            }
            this.pendingFlips[row]?.clear();
        }
        this.nextFlipGenerator = newFlip;
    }

    setFlipSequenceWithoutResetting = (newFlip: (i: number) => number[][]) => {
        this.globalFrame = 0;
        this.nextFlipGenerator = newFlip;
    }

    // Frame counter — increments every animate() call. Passed to
    // nextFlipGenerator so the generator can return per-frame schedules.
    globalFrame = 0;

    // Apply one frame of rotation to a disc that is mid-flip. Also handles
    // playing the click sound on the frame the flip starts (counter === 0).
    private stepDisc(row: number, idx: number) {
        let rotationRate = Math.PI / this.numFramesRotating;

        this.instanced!.getMatrixAt(row * this.width + idx, this.dummy.matrix);

        let rot = (!this.discStates[row][idx] ? -1 : 1) * rotationRate;
        let rotation = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sqrt(2) / 2, Math.sqrt(2) / 2, 0), rot);
        this.dummy.matrix.multiply(rotation);

        this.instanced!.setMatrixAt(row * this.width + idx, this.dummy.matrix);
        this.instanced!.instanceMatrix.needsUpdate = true;

        if (this.discFrameCounters[row][idx] === 0) {
            if (SOUND_ENABLED && this.audios.length > row * this.width + idx) {
                let audio = this.audios[row * this.width + idx];
                (audio.children[0] as THREE.PositionalAudio).stop();
                let randDelay = (Math.random() / 100);
                (audio.children[0] as THREE.PositionalAudio).play(randDelay);
            } else if (PERFORMANT_SOUND_ENABLED && this.audios.length > 0) {
                // pick a speaker by parity of the disc's row+idx so concurrent
                // starts spread across the speaker set.
                let cutoff = Math.floor(this.audios.length / 2);
                let pick = ((row * this.width + idx) % 2 === 0) ? (idx % cutoff) : (idx % cutoff) + cutoff;
                let audio = this.audios[pick];
                (audio.children[0] as THREE.PositionalAudio).stop();
                let randDelay = (Math.random() / 100);
                (audio.children[0] as THREE.PositionalAudio).play(randDelay);
            }
        }
    }

    animate = () => {
        // 1. Ask the generator what should START flipping at this exact
        //    frame. `undefined` is the cue to wipe state and reset.
        let next = this.nextFlipGenerator(this.globalFrame);
        if (next === undefined) {
            this.globalFrame = 0;
            for (let row = 0; row < this.height; row++) {
                this.pendingFlips[row].clear();
            }
            this.clear();
        } else {
            for (let row = 0; row < next.length && row < this.height; row++) {
                let pending = this.pendingFlips[row];
                for (let i of next[row]) {
                    pending.add(i);
                }
            }
        }

        // 2. Per-disc: if idle + pending, start a flip; if mid-flip, advance
        //    one rotation step. A pending flip that arrived while the disc
        //    was busy is held in the Set and consumed the moment the disc
        //    returns to idle.
        for (let row = 0; row < this.height; row++) {
            let pending = this.pendingFlips[row];
            for (let idx = 0; idx < this.width; idx++) {
                let counter = this.discFrameCounters[row][idx];

                if (counter === -1 && pending.has(idx)) {
                    pending.delete(idx);
                    this.discStates[row][idx] = !this.discStates[row][idx];
                    counter = 0;
                }

                if (counter >= 0 && counter < this.numFramesRotating) {
                    this.discFrameCounters[row][idx] = counter;
                    this.stepDisc(row, idx);
                    counter += 1;
                    if (counter >= this.numFramesRotating) {
                        counter = -1;
                    }
                    this.discFrameCounters[row][idx] = counter;
                }
            }
        }

        this.globalFrame += 1;
        this.renderer.render(this.scene, this.camera);
        this.recorder?.tick();
    }
}
