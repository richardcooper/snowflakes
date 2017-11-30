// Texture width for simulation
var COMPUTATION_WIDTH = 701;
var COMPUTATION_HEIGHT = 701;

var camera, scene, renderer;

var snowflakeSimulation;
var snowflakeData;
var snowflakeObject;

var stats;


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

// This doesn't quite match the algorithm in the paper because the snowflake
// data is only updated after the whole step rather than after each sub-step. So
// for example when sub-step 3 looks for `nearbyVapour` it see the state of its
// neighbours as they were before sub-step 1 rather than after sub-step 2. To
// fix this we would need to run each sub-step separately and have require
// multiple calls to `snowflakeSimulation.compute()` to complete one full step.
snowflakeComputationFragmentShader = `
    uniform float beta;
    uniform float alpha;
    uniform float theta;
    uniform float kappa;
    uniform float mu;
    uniform float gamma;

    void main()	{
		vec2 cellSize = 1.0 / resolution.xy;
		vec2 uv = gl_FragCoord.xy * cellSize;
		vec4 cell = texture2D(snowflake, uv);
		float d = cell.r; // diffuse (vapor) mass
		float c = cell.g; // crystal (ice) mass
		float b = cell.b; // boundary (water) mass
		float a = cell.a; // attachment (actually a bool but more convient to leave as an float for multiplications)

		// Get neighbours
		vec4 topLeft = texture2D(snowflake, uv + vec2(-cellSize.x, cellSize.y));
		vec4 topRight = texture2D(snowflake, uv + vec2(0.0, cellSize.y));
		vec4 right = texture2D(snowflake, uv + vec2(cellSize.x, 0.0));
		vec4 bottomRight = texture2D(snowflake, uv + vec2(cellSize.x, -cellSize.y));
		vec4 bottomLeft = texture2D(snowflake, uv + vec2(0.0, -cellSize.y));
		vec4 left = texture2D(snowflake, uv + vec2(-cellSize.x, 0.0));

		float neighbourCount = topLeft.a + topRight.a + right.a + bottomRight.a + bottomLeft.a + left.a - 6.0*a;
        neighbourCount = max(neighbourCount, 0.0);
        float inBoundary = min(neighbourCount, 1.0);

        // 1. Diffusion
		d = ((topLeft.r + topRight.r + right.r + bottomRight.r + bottomLeft.r + left.r + d)/7.0)*(1.0-a) + neighbourCount*d/7.0;

        // 2. Freezing
        b += inBoundary * d * (1.0-kappa);
        c += inBoundary * d * kappa;
        d -= inBoundary * d;

        // 3. Attachment

        // (3a)  - A boundary site with 1 or 2 attached neighbors needs boundary
        // mass at least β to join the crystal:
        a = max(a, float(((neighbourCount == 1.0) || (neighbourCount == 2.0)) && (b > beta)));

        // (3b) A boundary site with 3 attached neighbors joins the crystal if
        // either:
        //  - it has boundary mass ≥ 1, or
        a = max(a, float((neighbourCount == 3.0) && (b >= 1.0)));
        //  - it has diffusive mass < θ in its neighborhood and it has boundary mass ≥ α:
        float nearbyVapour = topLeft.r + topRight.r + right.r + bottomRight.r + bottomLeft.r + left.r + d;
        a = max(a, float((neighbourCount == 3.0) && (b >= alpha) && (nearbyVapour < theta)));

        // (3c) Finally, boundary sites with 4 or more attached neighbors join
        // the crystal automatically
        a = max(a, float(neighbourCount >= 4.0));

        // Once a site is attached, its boundary mass becomes crystal mass:
        c += inBoundary * a * b;
        b -= inBoundary * a * b;

        // 4. Melting
        // Proportion μ of the boundary mass and proportion γ of the crystal
        // mass at each boundary site become diffusive mass.

        // TODO these redefinitions will be needed if this is split out into a seperate step.
		//float neighbourCount = topLeft.a + topRight.a + right.a + bottomRight.a + bottomLeft.a + left.a - 6.0*a;
        //neighbourCount = max(neighbourCount, 0.0);
        //float inBoundary =  min(neighbourCount, 1.0);

        d += inBoundary * (b*mu + c*gamma);
        b -= inBoundary * b*mu;
        c -= inBoundary * c*gamma;

		gl_FragColor = vec4(d, c, b, a);
	}
`


function init() {
    var params = {
        rho: 0.635,
        beta: 1.6,
        alpha: 0.4,
        theta: 0.025,
        kappa: 0.005,
        mu: 0.015,
        gamma: 0.0005,
    };

    initRenderer();
    initScene();
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

    snowflakeObject.material.uniforms.maxD = {value: params.rho*1};
    snowflakeObject.material.uniforms.maxC = {value: params.beta*2};
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

    // Every animation frame we do a single step of the snowflake simulation,
    // copy the data from that into the texture for snowflake object and then
    // render the scene containing the snowflake object
    snowflakeSimulation.compute();
    snowflakeObject.material.uniforms.snowflake.value = snowflakeSimulation.getCurrentRenderTarget(snowflakeData).texture;
    renderer.render(scene, camera);

    stats.update();
}


init();
requestAnimationFrame(animate);
