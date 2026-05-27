/**
 * Three.js — Hero chess scene with visible board pieces
 */
window.ChessScene3D = (function () {
    const IVORY = 0xf2ece1;
    const GOLD = 0xd4af6a;
    const GOLD_BRIGHT = 0xe8c98a;
    const EMERALD = 0x3a8c7a;
    const ONYX = 0x2a2e3a;
    const ONYX_DARK = 0x14171f;

    /** Starting-position pieces on board (file, rank from white side) */
    const BOARD_PIECES = [
        { type: "rook", color: IVORY, file: 0, rank: 0 },
        { type: "knight", color: IVORY, file: 1, rank: 0 },
        { type: "bishop", color: IVORY, file: 2, rank: 0 },
        { type: "queen", color: GOLD_BRIGHT, file: 3, rank: 0 },
        { type: "king", color: GOLD, file: 4, rank: 0 },
        { type: "bishop", color: IVORY, file: 5, rank: 0 },
        { type: "knight", color: IVORY, file: 6, rank: 0 },
        { type: "rook", color: IVORY, file: 7, rank: 0 },
        { type: "pawn", color: IVORY, file: 0, rank: 1 },
        { type: "pawn", color: IVORY, file: 1, rank: 1 },
        { type: "pawn", color: IVORY, file: 2, rank: 1 },
        { type: "pawn", color: IVORY, file: 3, rank: 1 },
        { type: "pawn", color: IVORY, file: 4, rank: 1 },
        { type: "pawn", color: IVORY, file: 5, rank: 1 },
        { type: "pawn", color: IVORY, file: 6, rank: 1 },
        { type: "pawn", color: IVORY, file: 7, rank: 1 },
        { type: "king", color: ONYX, file: 4, rank: 7, scale: 1.1 },
        { type: "queen", color: ONYX, file: 3, rank: 7 },
    ];

    function createPiece(type, color) {
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
            color,
            metalness: 0.55,
            roughness: 0.28,
            emissive: color,
            emissiveIntensity: 0.18,
        });

        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.22, 28), mat);
        base.position.y = 0.11;
        group.add(base);

        let top;
        const scale = 1.35;
        if (type === "king") {
            top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.32, 0.55, 20), mat);
            top.position.y = 0.5 * scale;
            const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.08), mat);
            crossH.position.y = 0.82 * scale;
            const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.08), mat);
            crossV.position.y = 0.88 * scale;
            group.add(crossH, crossV);
        } else if (type === "queen") {
            top = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 24), mat);
            top.position.y = 0.55 * scale;
            const crown = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 8), mat);
            crown.position.y = 0.85 * scale;
            group.add(crown);
        } else if (type === "bishop") {
            top = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.65, 16), mat);
            top.position.y = 0.52 * scale;
        } else if (type === "knight") {
            top = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 12), mat);
            top.position.y = 0.5 * scale;
            top.rotation.z = 0.4;
        } else if (type === "pawn") {
            top = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), mat);
            top.position.y = 0.42 * scale;
        } else {
            top = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), mat);
            top.position.y = 0.48 * scale;
        }
        if (top) group.add(top);

        group.scale.setScalar(scale);
        return group;
    }

    function createBoard() {
        const board = new THREE.Group();
        // Light squares: warm parchment cream
        const lightSq = new THREE.MeshStandardMaterial({
            color: 0xe8d9b8,
            metalness: 0.15,
            roughness: 0.7,
            emissive: 0xd4af6a,
            emissiveIntensity: 0.05,
        });
        // Dark squares: deep emerald (chess-club tradition)
        const darkSq = new THREE.MeshStandardMaterial({
            color: 0x1f4d44,
            metalness: 0.25,
            roughness: 0.65,
            emissive: 0x3a8c7a,
            emissiveIntensity: 0.04,
        });
        const geo = new THREE.BoxGeometry(0.98, 0.14, 0.98);

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sq = new THREE.Mesh(geo, (r + c) % 2 === 0 ? lightSq : darkSq);
                sq.position.set(c - 3.5, 0, r - 3.5);
                board.add(sq);
            }
        }

        // Brass-toned frame
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(9.4, 0.2, 9.4),
            new THREE.MeshStandardMaterial({
                color: 0xd4af6a,
                metalness: 0.85,
                roughness: 0.25,
                emissive: 0xd4af6a,
                emissiveIntensity: 0.08,
            })
        );
        frame.position.y = -0.12;
        board.add(frame);
        return board;
    }

    function placeOnBoard(piece, file, rank) {
        piece.position.set(file - 3.5, 0.35, rank - 3.5);
    }

    function initHero(containerId) {
        const container = document.getElementById(containerId);
        if (!container || typeof THREE === "undefined") return null;

        const w = Math.max(container.clientWidth, 320);
        const h = Math.max(container.clientHeight, 500);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0b0d12, 0.032);

        const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
        camera.position.set(9, 8, 11);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);

        // Warm ambient (candlelight tone)
        scene.add(new THREE.AmbientLight(0xb89a6f, 0.45));

        // Key light — slightly warm
        const key = new THREE.DirectionalLight(0xfff3d8, 1.15);
        key.position.set(6, 12, 8);
        key.castShadow = true;
        scene.add(key);

        // Warm rim light (parchment gold from the side)
        const goldRim = new THREE.PointLight(0xd4af6a, 1.6, 35);
        goldRim.position.set(-6, 6, 4);
        scene.add(goldRim);

        // Emerald fill from the dark side (subtle)
        const emeraldFill = new THREE.PointLight(0x3a8c7a, 0.9, 28);
        emeraldFill.position.set(6, 4, -6);
        scene.add(emeraldFill);

        // Top spot — like a chandelier above the table
        const topSpot = new THREE.PointLight(0xfde7b7, 1.0, 25);
        topSpot.position.set(0, 9, 0);
        scene.add(topSpot);

        const boardGroup = new THREE.Group();
        const board = createBoard();
        boardGroup.add(board);

        const allPieces = [];
        BOARD_PIECES.forEach((p) => {
            const piece = createPiece(p.type, p.color);
            placeOnBoard(piece, p.file, p.rank);
            if (p.scale) piece.scale.multiplyScalar(p.scale);
            boardGroup.add(piece);
            allPieces.push(piece);
        });

        boardGroup.rotation.y = Math.PI / 5;
        scene.add(boardGroup);

        // Drifting dust — fewer, dimmer, warm gold (like specks in candlelight)
        const particles = new THREE.BufferGeometry();
        const count = 180;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 28;
        particles.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const pts = new THREE.Points(
            particles,
            new THREE.PointsMaterial({
                color: 0xd4af6a,
                size: 0.06,
                transparent: true,
                opacity: 0.45,
                blending: THREE.AdditiveBlending,
            })
        );
        scene.add(pts);

        let mouseX = 0;
        let mouseY = 0;
        const onMove = (e) => {
            mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
            mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
        };
        document.addEventListener("mousemove", onMove);

        // Pause rendering when the hero scrolls offscreen or the tab is hidden.
        // RAF keeps ticking (cheap) so resuming is instant; only the render/update
        // work — the expensive part — is skipped.
        let intersecting = true;
        let io = null;
        if (typeof IntersectionObserver !== "undefined") {
            io = new IntersectionObserver(
                ([entry]) => { intersecting = entry.isIntersecting; },
                { threshold: 0 }
            );
            io.observe(container);
        }
        const isActive = () => intersecting && !document.hidden;

        const clock = new THREE.Clock();
        let animId;

        function animate() {
            animId = requestAnimationFrame(animate);
            if (!isActive()) return;

            const t = clock.getElapsedTime();

            boardGroup.rotation.y = Math.PI / 5 + t * 0.08;
            allPieces.forEach((p, i) => {
                p.position.y = 0.35 + Math.sin(t * 1.5 + i * 0.4) * 0.04;
            });
            pts.rotation.y = t * 0.015;

            camera.position.x = 9 + mouseX * 2;
            camera.position.y = 8 + mouseY * 1.2;
            camera.position.z = 11 + mouseX * 0.5;
            camera.lookAt(0, 0.5, 0);

            renderer.render(scene, camera);
        }
        animate();

        function onResize() {
            const nw = Math.max(container.clientWidth, 320);
            const nh = Math.max(container.clientHeight, 500);
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
        }
        window.addEventListener("resize", onResize);

        return {
            destroy() {
                cancelAnimationFrame(animId);
                io?.disconnect();
                document.removeEventListener("mousemove", onMove);
                window.removeEventListener("resize", onResize);
                disposeScene(scene);
                renderer.dispose();
                try { renderer.forceContextLoss?.(); } catch (_) { /* older three builds */ }
                container.innerHTML = "";
            },
        };
    }

    function initMiniBoard(containerId) {
        const container = document.getElementById(containerId);
        if (!container || typeof THREE === "undefined") return null;

        container.innerHTML = "";
        const size = Math.max(container.clientWidth || 180, 160);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
        camera.position.set(5, 6, 7);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(size, size);
        renderer.setClearColor(0x000000, 0);
        container.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xb89a6f, 0.6));
        const pl = new THREE.PointLight(0xd4af6a, 1.6, 20);
        pl.position.set(4, 6, 4);
        scene.add(pl);
        const pl2 = new THREE.PointLight(0x3a8c7a, 0.6, 16);
        pl2.position.set(-4, 3, -3);
        scene.add(pl2);

        const board = createBoard();
        board.scale.set(0.38, 0.38, 0.38);
        scene.add(board);

        const king = createPiece("king", GOLD_BRIGHT);
        king.scale.set(0.5, 0.5, 0.5);
        king.position.set(0, 0.2, 0);
        scene.add(king);

        let id;
        const clock = new THREE.Clock();
        function loop() {
            id = requestAnimationFrame(loop);
            board.rotation.y = clock.getElapsedTime() * 0.35;
            king.rotation.y = clock.getElapsedTime() * 0.5;
            renderer.render(scene, camera);
        }
        loop();

        return () => {
            cancelAnimationFrame(id);
            disposeScene(scene);
            renderer.dispose();
            try { renderer.forceContextLoss?.(); } catch (_) { /* older three builds */ }
            container.innerHTML = "";
        };
    }

    // Walk the scene graph and free GPU resources for every mesh.
    // Three.js does not reference-count geometries/materials/textures, so
    // renderer.dispose() alone leaves them resident on the GPU.
    function disposeScene(root) {
        const seenGeo = new Set();
        const seenMat = new Set();
        const seenTex = new Set();

        const disposeMaterial = (mat) => {
            if (!mat || seenMat.has(mat)) return;
            seenMat.add(mat);
            ["map", "normalMap", "roughnessMap", "metalnessMap",
             "emissiveMap", "aoMap", "envMap", "alphaMap", "bumpMap"].forEach((k) => {
                const tex = mat[k];
                if (tex && tex.dispose && !seenTex.has(tex)) {
                    seenTex.add(tex);
                    tex.dispose();
                }
            });
            mat.dispose();
        };

        root.traverse((obj) => {
            if (obj.geometry && !seenGeo.has(obj.geometry)) {
                seenGeo.add(obj.geometry);
                obj.geometry.dispose();
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
                else disposeMaterial(obj.material);
            }
        });
    }

    return { initHero, initMiniBoard };
})();
