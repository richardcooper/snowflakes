// Texture width for simulation
var COMPUTATION_WIDTH = 701;
var COMPUTATION_HEIGHT = 701;

var camera, scene, renderer;

var snowflakeSimulation;
var snowflakeData;
var snowflakeObject;

var stats;

preset_params = {
    "preset": "Fernlike",
    "remembered": {
        "Fernlike":         {"0": {"rho": 0.635, "beta": 1.6,  "alpha": 0.4,   "theta": 0.025, "kappa": 0.005, "mu": 0.015, "gamma": 0.0005  }},
        "Stellar Dendrite": {"0": {"rho": 0.8,   "beta": 2.6,  "alpha": 0.004, "theta": 0.001, "kappa": 0.05,  "mu": 0.015, "gamma": 0.0001  }},
        "Fig 9a":           {"0": {"rho": 0.4,   "beta": 1.3,  "alpha": 0.08,  "theta": 0.025, "kappa": 0.003, "mu": 0.070, "gamma": 0.00005 }},
        "Ribbed Plate":     {"0": {"rho": 0.37,  "beta": 1.09, "alpha": 0.02,  "theta": 0.09,  "kappa": 0.003, "mu": 0.12,  "gamma": 0.000001}},
    },
    "closed": false,
    "folders": {},
}


snowflakeRenderVertexShader = `

    varying vec2 textureCoord;
	void main() {
        mat3 shear;
        shear[0] = vec3(1.0, 0.0, 0.0);
        shear[1] = vec3(-0.50, 1.0, 0);
        shear[2] = vec3(0.0, 0.0, 1.0);

        mat3 squash;
        squash[0] = vec3(1.0, 0.0, 0.0);
        squash[1] = vec3(0.0, 2.0/sqrt(3.0), 0.0);
        squash[2] = vec3(0.0, 0.0, 1.0);

        mat3 translate;
        translate[0] = vec3(1.0, 0.0, 0.0);
        translate[1] = vec3(0.0, 1.0, 0.0);
        translate[2] = vec3(0.25, (1.0-2.0/sqrt(3.0))/2.0, 1.0);

        mat3 textureTransformMatrix = shear * squash * translate;

        textureCoord = (textureTransformMatrix * vec3(uv, 1.0)).xy;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`


snowflakeRenderFragmentShader = `
    uniform float maxC;
    uniform float maxD;

    #define darkCrystal  (vec4(0.06, 0.01, 0.45, 1.0))
    #define lightCrystal (vec4(0.90, 0.90, 1.00, 1.0))
    #define darkVapour  (vec4(0.66, 0.66, 0.66, 1.0))
    #define lightVapour (vec4(1.00, 1.00, 1.00, 1.0))

    uniform sampler2D snowflake;
	varying vec2 textureCoord;

	void main() {
		vec4 cell = texture2D(snowflake, textureCoord);
        float percent = 0.0;

        if (bool(cell.a)) {
            // Inside snowflake
            percent = cell.g / maxC;
            gl_FragColor = mix(lightCrystal, darkCrystal, percent);
        } else {
            // Outside snowflake
            percent = cell.r / maxD;
            gl_FragColor = mix(lightVapour, darkVapour, percent);
        }
	}
`

snowflakeComputationFragmentShader = `
    uniform float beta;
    uniform float alpha;
    uniform float theta;
    uniform float kappa;
    uniform float mu;
    uniform float gamma;

    uniform int step;

    float inBoundary(vec4 cell, vec4 n[6]) {
		float neighbourCount = n[0].a + n[1].a + n[2].a + n[3].a + n[4].a + n[5].a - 6.0*cell.a;
        neighbourCount = max(neighbourCount, 0.0);
        return min(neighbourCount, 1.0);
        //TODO do this with a clamp
    }

    vec4 diffusion(vec4 cell, vec4 n[6]) {
		float neighbourCount = n[0].a + n[1].a + n[2].a + n[3].a + n[4].a + n[5].a - 6.0*cell.a;
        neighbourCount = max(neighbourCount, 0.0);
        float inBoundary = min(neighbourCount, 1.0);

        // 1. Diffusion
        cell.r = ((n[0].r+n[1].r+n[2].r+n[3].r+n[4].r+n[5].r+cell.r)/7.0)*(1.0-cell.a) + neighbourCount*cell.r/7.0;

		return cell;
    }

    vec4 freezing(vec4 cell, vec4 n[6]) {
        // 2. Freezing
        float inBoundary = inBoundary(cell, n);
        cell.b += inBoundary * cell.r * (1.0-kappa);
        cell.g += inBoundary * cell.r * kappa;
        cell.r -= inBoundary * cell.r;

		return cell;
    }

    vec4 attachment(vec4 cell, vec4 n[6]) {
        // 3. Attachment
		float neighbourCount = n[0].a + n[1].a + n[2].a + n[3].a + n[4].a + n[5].a - 6.0*cell.a;
        neighbourCount = max(neighbourCount, 0.0);
        float inBoundary = min(neighbourCount, 1.0);

        // (3a)  - A boundary site with 1 or 2 attached neighbors needs boundary
        // mass at least β to join the crystal:
        cell.a = max(cell.a, float(((neighbourCount == 1.0) || (neighbourCount == 2.0)) && (cell.b > beta)));

        // (3b) A boundary site with 3 attached neighbors joins the crystal if
        // either:
        //  - it has boundary mass ≥ 1, or
        cell.a = max(cell.a, float((neighbourCount == 3.0) && (cell.b >= 1.0)));
        //  - it has diffusive mass < θ in its neighborhood and it has boundary mass ≥ α:
        float nearbyVapour = n[0].r+n[1].r+n[2].r+n[3].r+n[4].r+n[5].r;
        cell.a = max(cell.a, float((neighbourCount == 3.0) && (cell.b >= alpha) && (nearbyVapour < theta)));

        // (3c) Finally, boundary sites with 4 or more attached neighbors join
        // the crystal automatically
        cell.a = max(cell.a, float(neighbourCount >= 4.0));

        // Once a site is attached, its boundary mass becomes crystal mass:
        cell.g += inBoundary * cell.a * cell.b;
        cell.b -= inBoundary * cell.a * cell.b;

		return cell;
    }

    vec4 melting(vec4 cell, vec4 n[6]) {
        // 4. Melting
        // Proportion μ of the boundary mass and proportion γ of the crystal
        // mass at each boundary site become diffusive mass.
        float inBoundary = inBoundary(cell, n);
        cell.r += inBoundary * (cell.b*mu + cell.g*gamma);
        cell.b -= inBoundary * cell.b * mu;
        cell.g -= inBoundary * cell.g * gamma;

		return cell;
    }

    void main() {
		vec2 cellSize = 1.0 / resolution.xy;
		vec2 uv = gl_FragCoord.xy * cellSize;
		vec4 cell = texture2D(snowflake, uv);
		vec4 n[6];
        n[0] = texture2D(snowflake, uv + vec2(-cellSize.x, cellSize.y));
        n[1] = texture2D(snowflake, uv + vec2(0.0, cellSize.y));
        n[2] = texture2D(snowflake, uv + vec2(cellSize.x, 0.0));
        n[3] = texture2D(snowflake, uv + vec2(cellSize.x, -cellSize.y));
        n[4] = texture2D(snowflake, uv + vec2(0.0, -cellSize.y));
        n[5] = texture2D(snowflake, uv + vec2(-cellSize.x, 0.0));
        //float d = cell.r; // diffuse (vapor) mass
		//float c = cell.g; // crystal (ice) mass
		//float b = cell.b; // boundary (water) mass
		//float a = cell.a; // attachment (actually a bool but more convient to leave as an float for multiplications)

        if (step==1){
            cell = diffusion(cell, n);
            gl_FragColor = freezing(cell, n);
        } else if (step==2){
            gl_FragColor = attachment(cell, n);
        } else if (step==3){
            gl_FragColor = melting(cell, n);
        }
    }
`


function init() {
    var params = Object.assign({}, preset_params["remembered"][preset_params["preset"]]["0"]);

    initRenderer();
    initScene();
    initGUI(params);
    initSimulation(params);
    initStats();
    setUniforms(params);
}


function initRenderer() {
    var canvas = document.getElementById("snowflake-canvas");
    renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.width, canvas.height);
}


function initScene() {
    // The size of the snowflake geometry is a little redundant in the current
    // setup because we configure the camera to cover 100% of the geometry
    // regardless of its size.
    var GEOMETRY_WIDTH = 1;
    var GEOMETRY_HEIGHT = 1;

    var geometry = new THREE.PlaneBufferGeometry(GEOMETRY_WIDTH, GEOMETRY_HEIGHT);
    var material = new THREE.ShaderMaterial({
        uniforms: {
            snowflake: {value: null}
        },
        vertexShader: snowflakeRenderVertexShader,
        fragmentShader: snowflakeRenderFragmentShader,
    });
    snowflakeObject = new THREE.Mesh(geometry, material);

    scene = new THREE.Scene();
    scene.add(snowflakeObject);

    camera = new THREE.OrthographicCamera(
        GEOMETRY_WIDTH / - 2,
        GEOMETRY_WIDTH / 2,
        GEOMETRY_HEIGHT / 2,
        GEOMETRY_HEIGHT / - 2,
        1,
        1000
    );
    camera.position.z = 2;
}


function initSimulation(params) {
    snowflakeSimulation = new GPUComputationRenderer(COMPUTATION_WIDTH, COMPUTATION_HEIGHT, renderer);
    snowflakeInitialData = getInitialData(snowflakeSimulation, params);

    snowflakeData = snowflakeSimulation.addVariable(
        "snowflake",
        snowflakeComputationFragmentShader,
        snowflakeInitialData
    );

    snowflakeSimulation.setVariableDependencies(snowflakeData, [snowflakeData]);

    var error = snowflakeSimulation.init();
    if (error !== null) {
        console.error(error);
    }
}


function setUniforms(params) {
    snowflakeData.material.uniforms.beta = {value: params.beta};
    snowflakeData.material.uniforms.alpha = {value: params.alpha};
    snowflakeData.material.uniforms.theta = {value: params.theta};
    snowflakeData.material.uniforms.kappa = {value: params.kappa};
    snowflakeData.material.uniforms.mu = {value: params.mu};
    snowflakeData.material.uniforms.gamma = {value: params.gamma};
    snowflakeData.material.uniforms.step = {value: 1};

    snowflakeObject.material.uniforms.maxD = {value: params.rho*1};
    snowflakeObject.material.uniforms.maxC = {value: params.beta*2};
}


function initGUI(params) {
    var uniformsChanger = function() {
        initSimulation(params);
        setUniforms(params);
    };

    var gui = new dat.GUI({load: preset_params});
    gui.add(params, 'rho');
    gui.add(params, 'beta').onFinishChange(uniformsChanger);
    gui.add(params, 'alpha').onFinishChange(uniformsChanger);
    gui.add(params, 'theta').onFinishChange(uniformsChanger);
    gui.add(params, 'kappa').onFinishChange(uniformsChanger);
    gui.add(params, 'mu').onFinishChange(uniformsChanger);
    gui.add(params, 'gamma').onFinishChange(uniformsChanger);
    gui.remember(params);

}


function initStats() {
    stats = new Stats();
    document.body.appendChild(stats.dom);
}


function getInitialData(snowflakeSimulation, params) {
    var texture = snowflakeSimulation.createTexture();
    var pixels = texture.image.data;
    var width = texture.image.width;
    var height = texture.image.height;

    var centreX = Math.floor(width/2);
    var centreY = Math.floor(height/2);

    // Initially all cells contain an amount of vapour equal to `rho` (d=rho).
    // There is no liquid (b=0), crystal (c=0) or attachment (a=0) ...
    for (var p=0; p < pixels.length; p+=4) {
        pixels[p + 0] = params.rho; // d
        pixels[p + 1] = 0.0; // c
        pixels[p + 2] = 0.0; // b
        pixels[p + 3] = 0.0; // a
    }

    // ... except for a single cell in the middle of the grid which is the
    // showflake seed. It is attached (a=1) and has solid crystal mass (c=1)
    // with no vapor (d=0) or liquid (b=0) mass.
    p = (centreY*width+centreX)*4;
    pixels[p + 0] = 0.0; // d
    pixels[p + 1] = 1.0; // c
    pixels[p + 2] = 0.0; // b
    pixels[p + 3] = 1; // a

    return texture
}


function animate() {
    requestAnimationFrame(animate);

    // Every animation frame we run a single generation of the snowflake
    // simulation. Each generation consists of multiple steps.
    for (var step=1; step <= 3; step++) {
        snowflakeData.material.uniforms.step.value = step;
        snowflakeSimulation.compute();
    }

    // Copy the data from the simulation into the texture for snowflake object
    // and then render the scene containing the snowflake object
    snowflakeObject.material.uniforms.snowflake.value = snowflakeSimulation.getCurrentRenderTarget(snowflakeData).texture;
    renderer.render(scene, camera);

    stats.update();
}


init();
requestAnimationFrame(animate);
